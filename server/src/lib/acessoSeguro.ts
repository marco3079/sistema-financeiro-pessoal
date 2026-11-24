// Acesso seguro (HTTPS) pelo contêiner `https` (Tailscale). Ele entra na rede Tailscale da pessoa como um aparelho
// próprio e publica o site em https://<nome>.<rede>.ts.net. A API conversa com ele pelo soquete compartilhado
// (API local do Tailscale), só para ler o estado, pedir o link de entrada na conta e sair da conta.

import { promises as fs } from 'node:fs';
import http from 'node:http';

const SOQUETE = process.env.TAILSCALE_SOQUETE ?? '/var/run/tailscale/tailscaled.sock';
const TEMPO_LIMITE_MS = 4000;

export type SituacaoAcesso = 'INDISPONIVEL' | 'INICIANDO' | 'PRECISA_ENTRAR' | 'AGUARDANDO_APROVACAO' | 'LIGADO' | 'PARADO';

export interface EstadoAcesso {
  situacao: SituacaoAcesso;
  linkDeEntrada: string | null;
  endereco: string | null;
  nomeDoAparelho: string | null;
  certificado: boolean;
  conta: string | null;
  avisos: string[];
}

interface StatusTailscale {
  BackendState?: string;
  AuthURL?: string;
  CertDomains?: string[] | null;
  Self?: { DNSName?: string; HostName?: string; UserID?: number; Online?: boolean } | null;
  User?: Record<string, { LoginName?: string } | undefined> | null;
  Health?: string[] | null;
}

function chamar(metodo: 'GET' | 'POST', caminho: string): Promise<{ status: number; corpo: string }> {
  return new Promise((resolver, rejeitar) => {
    const pedido = http.request(
      { socketPath: SOQUETE, path: caminho, method: metodo, headers: { Host: 'local-tailscaled.sock', 'Sec-Tailscale': 'localapi' }, timeout: TEMPO_LIMITE_MS },
      (resposta) => {
        let corpo = '';
        resposta.setEncoding('utf8');
        resposta.on('data', (pedaco: string) => {
          if (corpo.length < 2_000_000) corpo += pedaco;
        });
        resposta.on('end', () => resolver({ status: resposta.statusCode ?? 0, corpo }));
      }
    );
    pedido.on('timeout', () => pedido.destroy(new Error('tempo esgotado')));
    pedido.on('error', rejeitar);
    pedido.end();
  });
}

const INDISPONIVEL: EstadoAcesso = {
  situacao: 'INDISPONIVEL',
  linkDeEntrada: null,
  endereco: null,
  nomeDoAparelho: null,
  certificado: false,
  conta: null,
  avisos: [],
};

// Só aceita o link de entrada oficial do Tailscale (ele vai para a tela como link clicável).
function linkSeguro(url: string | undefined): string | null {
  return typeof url === 'string' && /^https:\/\/login\.tailscale\.com\/[A-Za-z0-9/_-]+$/.test(url) ? url : null;
}

function nomeDns(bruto: string | undefined): string | null {
  const nome = (bruto ?? '').replace(/\.$/, '').toLowerCase();
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(nome) ? nome : null;
}

// Por que o serviço não respondeu, pelo que o atualizador mediu do contêiner https (atualizacao/conteineres.json).
async function motivoDaIndisponibilidade(): Promise<string[]> {
  try {
    const medicao = JSON.parse((await fs.readFile('/atualizacao/conteineres.json', 'utf8')).replace(/^\uFEFF/, '')) as {
      medidoEm?: string;
      servicos?: unknown;
      conteineres?: { servico?: string; estado?: string; detalhe?: string }[];
    };
    const recente = medicao.medidoEm && Date.now() - new Date(medicao.medidoEm).getTime() < 120_000;
    if (!recente) return ['O atualizador não está respondendo; é ele quem liga o serviço de acesso seguro.'];
    const https = (medicao.conteineres ?? []).find((c) => c.servico === 'https');
    if (!https) {
      const previsto = Array.isArray(medicao.servicos) && medicao.servicos.includes('https');
      return [
        previsto
          ? 'O contêiner do acesso seguro ainda não foi criado. O atualizador cria sozinho em cerca de um minuto; o botão Ligar o serviço faz isso agora.'
          : 'Esta instalação ainda não tem o contêiner do acesso seguro. Atualize o sistema.',
      ];
    }
    const detalhe = typeof https.detalhe === 'string' ? https.detalhe.slice(0, 120) : '';
    return [
      https.estado === 'running'
        ? 'O contêiner do acesso seguro está no ar, mas o servidor não alcança o soquete dele. Reinicie o Servidor em Status do servidor.'
        : `O contêiner do acesso seguro não está no ar (${detalhe || https.estado || 'sem detalhe'}).`,
    ];
  } catch {
    return ['Sem informação do atualizador sobre o contêiner do acesso seguro. Atualize o sistema.'];
  }
}

async function indisponivel(): Promise<EstadoAcesso> {
  return { ...INDISPONIVEL, avisos: await motivoDaIndisponibilidade() };
}

export async function estadoDoAcesso(): Promise<EstadoAcesso> {
  let status: StatusTailscale;
  try {
    const resposta = await chamar('GET', '/localapi/v0/status');
    if (resposta.status !== 200) return indisponivel();
    status = JSON.parse(resposta.corpo) as StatusTailscale;
  } catch {
    return indisponivel();
  }

  const dns = nomeDns(status.Self?.DNSName);
  const dominios = (status.CertDomains ?? []).map((d) => d.toLowerCase());
  const certificado = dns !== null && dominios.includes(dns);
  const usuario = status.Self?.UserID !== undefined ? status.User?.[String(status.Self.UserID)] : undefined;
  const base = {
    linkDeEntrada: linkSeguro(status.AuthURL),
    nomeDoAparelho: status.Self?.HostName ?? null,
    conta: usuario?.LoginName ?? null,
    certificado,
    avisos: [] as string[],
  };

  switch (status.BackendState) {
    case 'Running':
      return {
        ...base,
        linkDeEntrada: null,
        situacao: 'LIGADO',
        endereco: certificado && dns ? `https://${dns}` : null,
        avisos: certificado ? [] : ['A rede Tailscale ainda não tem os certificados HTTPS ligados.'],
      };
    case 'NeedsLogin':
      return { ...base, situacao: 'PRECISA_ENTRAR', endereco: null, conta: null };
    case 'NeedsMachineAuth':
      return { ...base, situacao: 'AGUARDANDO_APROVACAO', endereco: null };
    case 'Stopped':
      return { ...base, situacao: 'PARADO', endereco: null };
    default:
      return { ...base, situacao: 'INICIANDO', endereco: null };
  }
}

// Pede ao Tailscale um link de entrada na conta (quando ainda não há um) e devolve o estado.
export async function pedirEntrada(): Promise<EstadoAcesso> {
  const antes = await estadoDoAcesso();
  if (antes.situacao === 'INDISPONIVEL' || antes.situacao === 'LIGADO' || antes.linkDeEntrada) return antes;
  await chamar('POST', '/localapi/v0/login-interactive').catch(() => undefined);
  // O link aparece no estado um instante depois.
  for (let tentativa = 0; tentativa < 8; tentativa++) {
    await new Promise((r) => setTimeout(r, 500));
    const agora = await estadoDoAcesso();
    if (agora.linkDeEntrada || agora.situacao === 'LIGADO') return agora;
  }
  return estadoDoAcesso();
}

// Tira este aparelho da conta do Tailscale: o endereço seguro para de funcionar até entrar de novo.
export async function sairDaConta(): Promise<EstadoAcesso> {
  await chamar('POST', '/localapi/v0/logout').catch(() => undefined);
  enderecoEmCache = null;
  await new Promise((r) => setTimeout(r, 800));
  return estadoDoAcesso();
}

// Endereço seguro em uso, para o QR code de "Abrir no celular". Guardado por 30 s para não consultar a cada pedido.
let enderecoEmCache: { url: string | null; ate: number } | null = null;

export async function enderecoSeguro(): Promise<string | null> {
  const agora = Date.now();
  if (enderecoEmCache && enderecoEmCache.ate > agora) return enderecoEmCache.url;
  const estado = await estadoDoAcesso();
  enderecoEmCache = { url: estado.endereco, ate: agora + 30_000 };
  return estado.endereco;
}
