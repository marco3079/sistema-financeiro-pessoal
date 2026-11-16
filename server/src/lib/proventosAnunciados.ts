// Dados públicos de fundos imobiliários na B3, pela página de cada fundo no site da B3
// (sistemaswebb3-listados.b3.com.br, a mesma que a B3 mostra em "Fundos listados"). Sem token nem cadastro.
// Traz o nome de pregão, o escriturador, as cotas emitidas e cada distribuição aprovada, inclusive as que ainda
// não foram pagas (valor por cota, data com e data de pagamento), além de subscrições e desdobramentos.
// Falha de rede ou fundo não encontrado: devolve null / lista vazia, sem erro.

export interface ProventoAnunciado {
  dataPagamento: string; // 'AAAA-MM-DD'
  dataCom: string | null; // último dia com direito
  aprovadoEm: string | null;
  valorPorCota: number;
  referente: string | null; // "Outubro/2026"
  tipo: string; // "RENDIMENTO", "AMORTIZACAO"...
}

export interface SubscricaoB3 {
  dataCom: string | null;
  aprovadoEm: string | null;
  percentual: number | null; // direito de subscrição, em % das cotas
  precoPorCota: number | null;
  periodo: string | null; // "dd/mm/aaaa a dd/mm/aaaa", como a B3 informa
  dataSubscricao: string | null;
}

export interface EventoCotasB3 {
  tipo: string; // "DESDOBRAMENTO", "GRUPAMENTO", "BONIFICACAO"...
  fator: number | null;
  dataCom: string | null;
  aprovadoEm: string | null;
}

export interface FundoB3 {
  codigo: string; // 'RECR11'
  nomePregao: string | null; // nome curto do pregão
  escriturador: string | null;
  cotasEmitidas: number | null;
  listadoDesde: string | null;
  loteDeNegociacao: number | null;
  forma: string | null; // "Escritural"
  segmento: string | null; // "BOLSA"
  proventos: ProventoAnunciado[]; // do mais novo para o mais antigo
  subscricoes: SubscricaoB3[];
  eventos: EventoCotasB3[];
}

const BASE = 'https://sistemaswebb3-listados.b3.com.br/fundsProxy/fundsCall/GetListedSupplementFunds/';
const VALIDADE_MS = 6 * 60 * 60 * 1000;
const TEMPO_LIMITE_MS = 10000;
const SIMULTANEAS = 4;
// Código de FII na bolsa: 4 letras + 11 (os de final 12, 13... são direitos e recibos).
export const CODIGO_FII = /^([A-Z]{4})11$/;

const cache = new Map<string, { em: number; fundo: FundoB3 | null }>();

// '13/11/2026' -> '2026-11-13'
function data(texto: unknown): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(texto ?? '').trim());
  if (!m || m[3] === '9999') return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

// '0,85000000000' -> 0.85; '26.441.650' -> 26441650
function numero(texto: unknown): number | null {
  const n = Number(String(texto ?? '').trim().replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function texto(valor: unknown): string | null {
  const t = String(valor ?? '').trim();
  return t ? t : null;
}

// A B3 repete cada evento para recibos de subscrição (ISIN "BRXXXXR..."); quem tem a cota recebe só o do ISIN
// da cota ("BRXXXXCTF..."). Sem nenhum ISIN de cota na lista, fica tudo.
function soDaCota(itens: unknown): Record<string, unknown>[] {
  if (!Array.isArray(itens)) return [];
  const lista = itens as Record<string, unknown>[];
  const daCota = (i: Record<string, unknown>) => /^BR[A-Z]{4}CTF/.test(String(i.isinCode ?? i.assetIssued ?? ''));
  return lista.some(daCota) ? lista.filter(daCota) : lista;
}

async function buscarFundo(codigo: string): Promise<FundoB3 | null> {
  const base = CODIGO_FII.exec(codigo)?.[1] ?? '';
  const parametro = Buffer.from(JSON.stringify({ cnpj: '0', identifierFund: base, typeFund: 7 })).toString('base64');
  const resposta = await fetch(BASE + parametro, { signal: AbortSignal.timeout(TEMPO_LIMITE_MS) });
  if (!resposta.ok) return null;
  const corpo = (await resposta.json().catch(() => null)) as Record<string, unknown> | null;
  if (!corpo || (!corpo.code && !Array.isArray(corpo.cashDividends))) return null;
  // Código que não existe: a B3 responde com um registro genérico em vez de erro.
  if (/ISIN\s*GENERIC/i.test(String(corpo.fund ?? '')) || String(corpo.code ?? '').toUpperCase() !== codigo.slice(0, 4)) return null;

  const proventos: ProventoAnunciado[] = [];
  for (const item of soDaCota(corpo.cashDividends)) {
    const dataPagamento = data(item.paymentDate);
    const valorPorCota = numero(item.rate);
    if (!dataPagamento || valorPorCota === null) continue;
    proventos.push({
      dataPagamento,
      dataCom: data(item.lastDatePrior),
      aprovadoEm: data(item.approvedOn),
      valorPorCota,
      referente: texto(item.relatedTo),
      tipo: String(item.label ?? '').trim().toUpperCase() || 'RENDIMENTO',
    });
  }
  proventos.sort((a, b) => (a.dataPagamento < b.dataPagamento ? 1 : a.dataPagamento > b.dataPagamento ? -1 : 0));

  const subscricoes: SubscricaoB3[] = soDaCota(corpo.subscriptions).map((s) => ({
    dataCom: data(s.lastDatePrior),
    aprovadoEm: data(s.approvedOn),
    percentual: numero(s.percentage),
    precoPorCota: numero(s.priceUnit),
    periodo: texto(s.tradingPeriod),
    dataSubscricao: data(s.subscriptionDate),
  }));

  const eventos: EventoCotasB3[] = soDaCota(corpo.stockDividends).map((e) => ({
    tipo: String(e.label ?? '').trim().toUpperCase() || 'EVENTO',
    fator: numero(e.factor),
    dataCom: data(e.lastDatePrior),
    aprovadoEm: data(e.approvedOn),
  }));

  return {
    codigo,
    nomePregao: texto(corpo.fund),
    escriturador: texto(corpo.ifd),
    cotasEmitidas: numero(corpo.quantity),
    listadoDesde: data(corpo.quotedPer),
    loteDeNegociacao: numero(corpo.tradingLot),
    forma: texto(corpo.form),
    segmento: texto(corpo.segment),
    proventos,
    subscricoes,
    eventos,
  };
}

// Dados de cada código (só FII "XXXX11"). Os consultados nas últimas 6 horas vêm do cache.
// Código que a B3 não conhece fica de fora do mapa; falha de rede também (tenta de novo na próxima vez).
export async function fundosNaB3(codigos: string[]): Promise<Map<string, FundoB3>> {
  const resultado = new Map<string, FundoB3>();
  const pendentes: string[] = [];
  for (const codigo of new Set(codigos.map((c) => c.trim().toUpperCase()))) {
    if (!CODIGO_FII.test(codigo)) continue;
    const guardado = cache.get(codigo);
    if (guardado && Date.now() - guardado.em < VALIDADE_MS) {
      if (guardado.fundo) resultado.set(codigo, guardado.fundo);
    } else {
      pendentes.push(codigo);
    }
  }
  let proximo = 0;
  async function trabalhar() {
    while (proximo < pendentes.length) {
      const codigo = pendentes[proximo++];
      try {
        const fundo = await buscarFundo(codigo);
        cache.set(codigo, { em: Date.now(), fundo });
        if (fundo) resultado.set(codigo, fundo);
      } catch {
        // sem rede ou B3 fora do ar
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(SIMULTANEAS, pendentes.length) }, trabalhar));
  return resultado;
}

// Proventos de cada código (só FII), do mais novo para o mais antigo.
export async function proventosAnunciados(codigos: string[]): Promise<Map<string, ProventoAnunciado[]>> {
  const fundos = await fundosNaB3(codigos);
  return new Map([...fundos].map(([codigo, fundo]) => [codigo, fundo.proventos]));
}
