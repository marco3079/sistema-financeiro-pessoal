// Dados públicos de uma companhia listada na B3 (a mesma página de "Empresas listadas" do site da B3), sem cadastro:
// código CVM (liga a ação aos balanços da CVM), quantidade de ações e os proventos em dinheiro (dividendos e JCP)
// de cada classe de ação (ON, PN, units). Guardado por 6 horas; falha de rede devolve null.

const BASE = 'https://sistemaswebb3-listados.b3.com.br/listedCompaniesProxy/CompanyCall/GetListedSupplementCompany/';
const VALIDADE_MS = 6 * 60 * 60 * 1000;
const TEMPO_LIMITE_MS = 15000;

export interface ProventoAcao {
  dataPagamento: string; // 'AAAA-MM-DD'
  dataCom: string | null;
  valorPorAcao: number;
  tipo: string; // "DIVIDENDO", "JRS CAP PROPRIO"...
  isin: string;
}

export interface CompanhiaB3 {
  codigoCvm: number;
  nomePregao: string;
  segmento: string | null; // segmento de listagem (Novo Mercado, N1...)
  acoesOrdinarias: number | null;
  acoesPreferenciais: number | null;
  acoesTotal: number | null;
  proventos: ProventoAcao[]; // de todas as classes, do mais novo para o mais antigo
}

const cache = new Map<string, { em: number; companhia: CompanhiaB3 | null }>();

function data(texto: unknown): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(texto ?? '').trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function numero(texto: unknown): number | null {
  const n = Number(String(texto ?? '').trim().replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function buscar(base: string): Promise<CompanhiaB3 | null> {
  const parametro = Buffer.from(JSON.stringify({ issuingCompany: base, language: 'pt-br' })).toString('base64');
  const resposta = await fetch(BASE + parametro, { signal: AbortSignal.timeout(TEMPO_LIMITE_MS) });
  if (!resposta.ok) return null;
  const corpo = (await resposta.json().catch(() => null)) as Record<string, unknown>[] | null;
  const c = Array.isArray(corpo) ? corpo[0] : null;
  const codigoCvm = Number(c?.codeCVM);
  if (!c || !Number.isFinite(codigoCvm) || codigoCvm <= 0) return null;
  const proventos: ProventoAcao[] = [];
  for (const p of Array.isArray(c.cashDividends) ? (c.cashDividends as Record<string, unknown>[]) : []) {
    const dataPagamento = data(p.paymentDate);
    const valorPorAcao = numero(p.rate);
    if (!dataPagamento || valorPorAcao === null) continue;
    proventos.push({
      dataPagamento,
      dataCom: data(p.lastDatePrior),
      valorPorAcao,
      tipo: String(p.label ?? '').trim().toUpperCase(),
      isin: String(p.isinCode ?? p.assetIssued ?? '').trim().toUpperCase(),
    });
  }
  proventos.sort((a, b) => (a.dataPagamento < b.dataPagamento ? 1 : -1));
  return {
    codigoCvm,
    nomePregao: String(c.tradingName ?? base).trim(),
    segmento: String(c.segment ?? '').trim() || null,
    acoesOrdinarias: numero(c.numberCommonShares),
    acoesPreferenciais: numero(c.numberPreferredShares),
    acoesTotal: numero(c.totalNumberShares),
    proventos,
  };
}

export async function companhiaNaB3(codigo: string): Promise<CompanhiaB3 | null> {
  const base = codigo.toUpperCase().slice(0, 4);
  const guardada = cache.get(base);
  if (guardada && Date.now() - guardada.em < VALIDADE_MS) return guardada.companhia;
  try {
    const companhia = await buscar(base);
    cache.set(base, { em: Date.now(), companhia });
    return companhia;
  } catch {
    return null;
  }
}

// Proventos da classe da ação pelo final do código: 3 = ON, 4 = PN, 5/6/7/8 = PNA/PNB/PNC/PND, 11 = unit.
export function proventosDaClasse(companhia: CompanhiaB3, codigo: string): ProventoAcao[] {
  const final = codigo.toUpperCase().slice(4);
  const padrao: Record<string, RegExp> = {
    '3': /ACNOR/,
    '4': /ACNPR/,
    '5': /ACNPA/,
    '6': /ACNPB/,
    '7': /ACNPC/,
    '8': /ACNPD/,
    '11': /CDAM|UNT/,
  };
  const re = padrao[final];
  const daClasse = re ? companhia.proventos.filter((p) => re.test(p.isin)) : [];
  return daClasse;
}
