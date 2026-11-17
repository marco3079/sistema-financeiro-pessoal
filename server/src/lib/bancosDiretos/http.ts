import https from 'https';

// Requisição HTTPS com certificado de cliente (mTLS), que as APIs PJ dos bancos exigem. O fetch do Node não aceita
// certificado de cliente, por isso o módulo https. Nada daqui vai para log: corpo e cabeçalhos levam segredos.

export interface Certificado {
  cert?: string; // PEM
  key?: string; // PEM
  pfx?: Buffer; // .pfx/.p12
  senha?: string; // senha do .pfx ou da chave
}

export interface Pedido {
  url: string;
  metodo?: 'GET' | 'POST';
  cabecalhos?: Record<string, string>;
  formulario?: Record<string, string>; // corpo application/x-www-form-urlencoded
  certificado?: Certificado;
}

export class ErroDoBanco extends Error {
  constructor(
    mensagem: string,
    readonly status: number | null,
  ) {
    super(mensagem);
  }
  // 401/403: credencial, certificado ou permissão recusados.
  get deLogin(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

const TEMPO_LIMITE_MS = 30_000;

// Devolve o JSON da resposta. Lança ErroDoBanco com o status e um trecho da mensagem do banco.
export function pedirJson<T>(pedido: Pedido): Promise<T> {
  const corpo = pedido.formulario ? new URLSearchParams(pedido.formulario).toString() : undefined;
  const cabecalhos: Record<string, string> = { Accept: 'application/json', ...(pedido.cabecalhos ?? {}) };
  if (corpo !== undefined) {
    cabecalhos['Content-Type'] = 'application/x-www-form-urlencoded';
    cabecalhos['Content-Length'] = String(Buffer.byteLength(corpo));
  }
  const c = pedido.certificado;
  return new Promise<T>((resolve, reject) => {
    let requisicao: ReturnType<typeof https.request>;
    try {
      requisicao = https.request(
        pedido.url,
        {
          method: pedido.metodo ?? 'GET',
          headers: cabecalhos,
          timeout: TEMPO_LIMITE_MS,
          ...(c?.pfx ? { pfx: c.pfx, passphrase: c.senha } : {}),
          ...(c?.cert ? { cert: c.cert, key: c.key, passphrase: c.senha } : {}),
        },
        (resposta) => {
          const partes: Buffer[] = [];
          resposta.on('data', (p: Buffer) => partes.push(p));
          resposta.on('end', () => {
            const texto = Buffer.concat(partes).toString('utf8');
            const status = resposta.statusCode ?? 0;
            if (status < 200 || status >= 300) {
              reject(new ErroDoBanco(`O banco respondeu ${status}${resumoDoErro(texto)}`, status));
              return;
            }
            try {
              resolve((texto.trim() === '' ? {} : JSON.parse(texto)) as T);
            } catch {
              reject(new ErroDoBanco('O banco respondeu algo que não é JSON', status));
            }
          });
        },
      );
    } catch (erro) {
      reject(new ErroDoBanco(mensagemDeCertificado(erro), null));
      return;
    }
    requisicao.on('timeout', () => requisicao.destroy(new Error('O banco não respondeu em 30 segundos')));
    requisicao.on('error', (erro) => reject(new ErroDoBanco(mensagemDeCertificado(erro), null)));
    if (corpo !== undefined) requisicao.write(corpo);
    requisicao.end();
  });
}

// Só a mensagem que o banco escreveu (campos comuns), curta. Nunca o corpo inteiro.
function resumoDoErro(texto: string): string {
  try {
    const j = JSON.parse(texto) as Record<string, unknown>;
    const msg = [j.title, j.detail, j.message, j.error_description, j.error, j.mensagem]
      .find((v) => typeof v === 'string' && v.trim() !== '') as string | undefined;
    return msg ? `: ${msg.slice(0, 200)}` : '';
  } catch {
    return '';
  }
}

function mensagemDeCertificado(erro: unknown): string {
  const texto = erro instanceof Error ? erro.message : String(erro);
  if (/PEM|asn1|key values mismatch|mac verify|pkcs12|bad decrypt/i.test(texto)) {
    return 'O certificado ou a chave privada não abriram. Confira se enviou o par certo (e a senha, se houver).';
  }
  return `Falha ao falar com o banco: ${texto.slice(0, 200)}`;
}
