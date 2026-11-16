// Proventos anunciados de fundos imobiliários, pela página pública de cada fundo no site da B3
// (sistemaswebb3-listados.b3.com.br, a mesma que a B3 mostra em "Fundos listados"). Sem token nem cadastro.
// A lista traz cada distribuição aprovada, inclusive as que ainda não foram pagas: valor por cota, data com
// e data de pagamento. Falha de rede ou fundo não encontrado: devolve lista vazia, sem erro.

export interface ProventoAnunciado {
  dataPagamento: string; // 'AAAA-MM-DD'
  dataCom: string | null; // último dia com direito
  valorPorCota: number;
  referente: string | null; // "Outubro/2026"
  tipo: string; // "RENDIMENTO", "AMORTIZACAO"...
}

const BASE = 'https://sistemaswebb3-listados.b3.com.br/fundsProxy/fundsCall/GetListedSupplementFunds/';
const VALIDADE_MS = 6 * 60 * 60 * 1000;
const TEMPO_LIMITE_MS = 10000;
const SIMULTANEAS = 4;
// Código de FII na bolsa: 4 letras + 11 (ou 12, 13... para direitos e recibos, que não interessam aqui).
const CODIGO_FII = /^([A-Z]{4})11$/;

const cache = new Map<string, { em: number; lista: ProventoAnunciado[] }>();

// '13/11/2026' -> '2026-11-13'
function data(texto: unknown): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(texto ?? '').trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

// '0,85000000000' -> 0.85
function numero(texto: unknown): number | null {
  const n = Number(String(texto ?? '').trim().replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function buscarFundo(base: string): Promise<ProventoAnunciado[]> {
  const parametro = Buffer.from(JSON.stringify({ cnpj: '0', identifierFund: base, typeFund: 7 })).toString('base64');
  const resposta = await fetch(BASE + parametro, { signal: AbortSignal.timeout(TEMPO_LIMITE_MS) });
  if (!resposta.ok) return [];
  const corpo = (await resposta.json()) as { cashDividends?: unknown };
  if (!Array.isArray(corpo.cashDividends)) return [];
  const lista: ProventoAnunciado[] = [];
  // A lista repete a distribuição para recibos de subscrição (ISIN "BRXXXXR..."); quem tem a cota recebe só a do
  // ISIN da cota ("BRXXXXCTF..."). Sem nenhum ISIN de cota na lista, fica tudo.
  const itens = corpo.cashDividends as Record<string, unknown>[];
  const daCota = (i: Record<string, unknown>) => /^BR[A-Z]{4}CTF/.test(String(i.isinCode ?? i.assetIssued ?? ''));
  const temCota = itens.some(daCota);
  for (const item of itens) {
    if (temCota && !daCota(item)) continue;
    const dataPagamento = data(item.paymentDate);
    const valorPorCota = numero(item.rate);
    if (!dataPagamento || valorPorCota === null) continue;
    lista.push({
      dataPagamento,
      dataCom: data(item.lastDatePrior),
      valorPorCota,
      referente: typeof item.relatedTo === 'string' && item.relatedTo.trim() ? item.relatedTo.trim() : null,
      tipo: String(item.label ?? '').trim().toUpperCase() || 'RENDIMENTO',
    });
  }
  return lista;
}

// Proventos de cada código (só FII "XXXX11"). Os já consultados nas últimas 6 horas vêm do cache.
export async function proventosAnunciados(codigos: string[]): Promise<Map<string, ProventoAnunciado[]>> {
  const resultado = new Map<string, ProventoAnunciado[]>();
  const pendentes: string[] = [];
  for (const codigo of new Set(codigos.map((c) => c.trim().toUpperCase()))) {
    if (!CODIGO_FII.test(codigo)) continue;
    const guardado = cache.get(codigo);
    if (guardado && Date.now() - guardado.em < VALIDADE_MS) resultado.set(codigo, guardado.lista);
    else pendentes.push(codigo);
  }
  let proximo = 0;
  async function trabalhar() {
    while (proximo < pendentes.length) {
      const codigo = pendentes[proximo++];
      const base = CODIGO_FII.exec(codigo)?.[1] ?? '';
      try {
        const lista = await buscarFundo(base);
        cache.set(codigo, { em: Date.now(), lista });
        resultado.set(codigo, lista);
      } catch {
        // sem rede ou B3 fora do ar: fica sem anúncio (tenta de novo na próxima consulta)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(SIMULTANEAS, pendentes.length) }, trabalhar));
  return resultado;
}
