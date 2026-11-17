// Formato comum dos conectores de API direta (conta PJ). Cada banco traduz a resposta dele para isto.

export interface LancamentoDoBanco {
  idExterno: string; // id do lançamento no banco (não repete)
  data: string; // 'AAAA-MM-DD'
  descricao: string;
  valor: number; // sempre positivo
  tipo: 'RECEITA' | 'DESPESA';
}

// Campo que a pessoa preenche ao conectar. 'arquivo' é lido no navegador (texto PEM; .pfx vai em base64).
export interface CampoCredencial {
  nome: string;
  rotulo: string;
  tipo: 'texto' | 'segredo' | 'arquivo';
  obrigatorio: boolean;
  ajuda?: string;
  aceita?: string; // extensões do arquivo, ex.: '.crt,.pem'
}

export type Credenciais = Record<string, string>;

export interface Conector {
  id: string;
  nome: string;
  cor: string;
  campos: CampoCredencial[];
  comoObter: string[]; // passo a passo para gerar as credenciais no banco
  observacao?: string;
  // Saldo atual da conta, ou null se a API não informar.
  saldo(credenciais: Credenciais, chaveCache: string): Promise<number | null>;
  // Lançamentos entre as datas (inclusive), 'AAAA-MM-DD'.
  extrato(credenciais: Credenciais, de: string, ate: string, chaveCache: string): Promise<LancamentoDoBanco[]>;
}

// Token de acesso guardado em memória até perto de vencer (por conexão).
const tokens = new Map<string, { token: string; vence: number }>();

export async function tokenEmCache(chave: string, obter: () => Promise<{ token: string; segundos: number }>): Promise<string> {
  const atual = tokens.get(chave);
  if (atual && atual.vence > Date.now()) return atual.token;
  const novo = await obter();
  tokens.set(chave, { token: novo.token, vence: Date.now() + Math.max(30, novo.segundos - 60) * 1000 });
  return novo.token;
}

export function esquecerToken(chave: string): void {
  tokens.delete(chave);
}

// Divide [de, ate] em janelas de no máximo `dias` dias (as APIs limitam o período por consulta).
export function janelas(de: string, ate: string, dias: number): { de: string; ate: string }[] {
  const DIA = 86_400_000;
  const fim = Date.parse(ate + 'T00:00:00Z');
  const saida: { de: string; ate: string }[] = [];
  for (let ini = Date.parse(de + 'T00:00:00Z'); ini <= fim; ini += dias * DIA) {
    const ateJanela = Math.min(fim, ini + (dias - 1) * DIA);
    saida.push({ de: new Date(ini).toISOString().slice(0, 10), ate: new Date(ateJanela).toISOString().slice(0, 10) });
  }
  return saida;
}

export function textoLimpo(...partes: (string | null | undefined)[]): string {
  const t = partes
    .map((p) => (p ?? '').replace(/\s+/g, ' ').trim())
    .filter((p, i, todas) => p !== '' && todas.indexOf(p) === i)
    .join(' - ');
  return (t || 'Lançamento').slice(0, 200);
}

export function numero(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

// Certificado a partir dos campos 'certificado' e 'chave' (PEM) ou 'pfx' (base64) + 'senhaCertificado'.
export function certificadoDe(c: Credenciais) {
  if (c.pfx) return { pfx: Buffer.from(c.pfx, 'base64'), senha: c.senhaCertificado || undefined };
  return { cert: c.certificado, key: c.chave, senha: c.senhaCertificado || undefined };
}
