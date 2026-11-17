import crypto from 'crypto';
import { HttpError } from './erros';
import { aliquotasDoAno } from './reformaTributaria';

// Cliente da calculadora oficial da Reforma Tributária (Receita Federal), que roda no contêiner "calculadora"
// (só a API enxerga). Cálculo por item com o modo "observabilidade": um item com erro não derruba os outros.
// Até 2026 valem as alíquotas de referência do banco da calculadora; de 2027 em diante a API exige as alíquotas,
// e mandamos as estimativas de lib/reformaTributaria (o resultado sai como "simulado").

const BASE = (process.env.CALCULADORA_RTC_URL ?? 'http://calculadora:8080/api/calculadora').replace(/\/$/, '');
const TEMPO_LIMITE_MS = 30_000;

async function pedir(caminho: string, opcoes: RequestInit = {}, tempo = TEMPO_LIMITE_MS): Promise<Response> {
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), tempo);
  try {
    return await fetch(BASE + caminho, { ...opcoes, signal: controle.signal });
  } catch {
    throw new HttpError(503, 'A calculadora da Reforma Tributária não respondeu. Ela pode estar iniciando: tente de novo em um minuto.');
  } finally {
    clearTimeout(relogio);
  }
}

async function json<T>(caminho: string, opcoes: RequestInit = {}): Promise<T> {
  const r = await pedir(caminho, opcoes);
  if (r.status === 404) throw new HttpError(404, 'Não encontrado na tabela oficial');
  if (!r.ok) {
    let detalhe = '';
    try {
      const corpo = (await r.json()) as { detail?: string; title?: string; message?: string };
      detalhe = corpo.detail ?? corpo.title ?? corpo.message ?? '';
    } catch {
      // sem corpo legível
    }
    throw new HttpError(r.status === 422 || r.status === 400 ? 400 : 502, detalhe || `A calculadora respondeu ${r.status}`);
  }
  return (await r.json()) as T;
}

function dataDoAno(ano: number): string {
  // Para 2026, a data de hoje se já estivermos nele (a referência pode mudar no ano); senão, o meio do ano.
  const hoje = new Date().toISOString().slice(0, 10);
  return hoje.startsWith(String(ano)) ? hoje : `${ano}-06-15`;
}

export async function calculadoraDisponivel(): Promise<boolean> {
  try {
    const r = await pedir('/dados-abertos/versao', {}, 3_000);
    return r.ok;
  } catch {
    return false;
  }
}

export async function municipiosDaUf(uf: string): Promise<{ codigo: number; nome: string }[]> {
  const lista = await json<{ codigo?: number; codigoMunicipio?: number; nome?: string; nomeMunicipio?: string }[]>(
    `/dados-abertos/ufs/municipios?siglaUf=${encodeURIComponent(uf)}`
  );
  return lista
    .map((m) => ({ codigo: Number(m.codigo ?? m.codigoMunicipio), nome: String(m.nome ?? m.nomeMunicipio ?? '') }))
    .filter((m) => Number.isFinite(m.codigo) && m.nome !== '')
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

export async function consultarNcm(ncm: string, ano: number): Promise<Record<string, unknown>> {
  return json<Record<string, unknown>>(`/dados-abertos/ncm?ncm=${ncm}&data=${dataDoAno(ano)}`);
}

// ---------- Classificações tributárias ----------

interface ClassificacaoApi {
  codigo: string;
  descricao: string;
  nomenclatura?: string | null;
  percentualReducaoCbs?: number | null;
  percentualReducaoIbsUf?: number | null;
  percentualReducaoIbsMun?: number | null;
}

export interface ClassificacaoDoItem {
  codigo: string;
  descricao: string;
  reducaoCbs: number;
  reducaoIbs: number;
  paraConsumidor: boolean; // vale numa compra comum de pessoa física (não depende de quem compra ou de regime especial)
}

// Classificações com lista de NCM que valem numa compra comum (alimentos, remédios, higiene, bares e restaurantes...).
// As demais dependem de quem compra (governo, produtor rural), de regime especial ou de exportação.
const PARA_CONSUMIDOR = new Set([
  '200003', '200004', '200007', '200009', '200013', '200014', '200030', '200031', '200032', '200033', '200034',
  '200035', '200036', '200047', '200053',
]);

const cacheClassificacoes = new Map<string, { lista: ClassificacaoApi[]; ate: number }>();

async function classificacoes(ano: number): Promise<ClassificacaoApi[]> {
  const data = dataDoAno(ano);
  const c = cacheClassificacoes.get(data);
  if (c && c.ate > Date.now()) return c.lista;
  const lista = await json<ClassificacaoApi[]>(`/dados-abertos/classificacoes-tributarias/cbs-ibs?data=${data}`);
  cacheClassificacoes.set(data, { lista, ate: Date.now() + 24 * 3_600_000 });
  return lista;
}

function paraItem(c: ClassificacaoApi): ClassificacaoDoItem {
  return {
    codigo: c.codigo,
    descricao: c.descricao,
    reducaoCbs: Number(c.percentualReducaoCbs ?? 0),
    reducaoIbs: Number(c.percentualReducaoIbsUf ?? 0),
    paraConsumidor: c.codigo === INTEGRAL || PARA_CONSUMIDOR.has(c.codigo),
  };
}

const INTEGRAL = '000001';
const NCM_CONTROLE = '84713012'; // notebook: sem nenhum benefício na reforma
const cacheDoNcm = new Map<string, ClassificacaoDoItem[]>();
const cacheAceitas = new Map<string, Set<string>>();

// Códigos das classificações que a calculadora aceita para o NCM (testa todas de uma vez, 100 por pedido).
async function aceitasPara(ncm: string, ano: number, candidatas: ClassificacaoApi[]): Promise<Set<string>> {
  const chave = `${ncm}|${dataDoAno(ano)}`;
  const guardada = cacheAceitas.get(chave);
  if (guardada) return guardada;
  const aceitas = new Set<string>();
  for (let i = 0; i < candidatas.length; i += 100) {
    const lote = candidatas.slice(i, i + 100);
    const resposta = await observabilidade({
      ano,
      uf: 'SP',
      municipio: 3550308,
      itens: lote.map((c) => ({ ncm, cClassTrib: c.codigo, valor: 100, quantidade: 1, unidade: 'UN', impostoSeletivo: 0 })),
    });
    resposta.objetos?.forEach((o) => {
      const c = lote[(o.nObj ?? 0) - 1];
      if (c && (o.estadoItem === 'CALCULADO' || o.estadoItem === 'CALCULO_SIMULADO')) aceitas.add(c.codigo);
    });
  }
  cacheAceitas.set(chave, aceitas);
  return aceitas;
}

// Quais classificações valem para o NCM: as que têm lista de NCM são testadas de uma vez na calculadora (as que
// não dão "NCM não vinculada" valem). A tributação integral (000001) sempre entra. A de maior redução vem primeiro.
export async function classificacoesDoNcm(ncm: string, ano: number): Promise<ClassificacaoDoItem[]> {
  const chave = `${ncm}|${dataDoAno(ano)}`;
  const guardada = cacheDoNcm.get(chave);
  if (guardada) return guardada;
  const todas = await classificacoes(ano);
  const candidatas = todas.filter((c) => (c.nomenclatura ?? '').toUpperCase() === 'NCM' && c.codigo !== INTEGRAL);
  const doNcm = await aceitasPara(ncm, ano, candidatas);
  // Algumas classificações não conferem o NCM (dependem de condição, como registro na Anvisa): passam para
  // qualquer produto. As que passam também para um NCM sem benefício (notebook) não são benefício deste produto.
  const controle = await aceitasPara(NCM_CONTROLE, ano, candidatas);
  const validas = candidatas
    .filter((c) => doNcm.has(c.codigo))
    .map((c) => {
      const item = paraItem(c);
      return controle.has(c.codigo) ? { ...item, paraConsumidor: false } : item;
    });
  // Primeiro as de consumidor (maior redução antes), depois a integral, por último as de situações especiais.
  const porReducao = (a: ClassificacaoDoItem, b: ClassificacaoDoItem) => b.reducaoCbs + b.reducaoIbs - (a.reducaoCbs + a.reducaoIbs);
  const integral = todas.find((c) => c.codigo === INTEGRAL);
  const lista = [
    ...validas.filter((c) => c.paraConsumidor).sort(porReducao),
    ...(integral ? [paraItem(integral)] : []),
    ...validas.filter((c) => !c.paraConsumidor).sort(porReducao),
  ];
  cacheDoNcm.set(chave, lista);
  return lista;
}

// ---------- Cálculo ----------

export interface ItemOperacao {
  descricao?: string;
  ncm: string;
  cClassTrib: string;
  valor: number;
  quantidade: number;
  unidade: string;
  impostoSeletivo?: number; // % ad valorem, para NCM sujeito ao Imposto Seletivo (2027 em diante); padrão 0
}

export interface Operacao {
  ano: number;
  uf: string;
  municipio: number;
  itens: ItemOperacao[];
}

interface GrupoAliquota {
  pRedAliq?: string;
  pAliqEfet?: string;
}

interface ObjetoApi {
  nObj?: number;
  estadoItem?: string;
  erros?: { code?: string; title?: string; detail?: string }[];
  tribCalc?: {
    IS?: { pIS?: string; vIS?: string };
    IBSCBS?: {
      CST?: string;
      cClassTrib?: string;
      gIBSCBS?: {
        vBC?: string;
        gIBSUF?: { pIBSUF?: string; gRed?: GrupoAliquota; vIBSUF?: string };
        gIBSMun?: { pIBSMun?: string; gRed?: GrupoAliquota; vIBSMun?: string };
        vIBS?: string;
        gCBS?: { pCBS?: string; gRed?: GrupoAliquota; vCBS?: string };
      };
      memoriaCalculo?: string;
    };
  };
}

interface RespostaObservabilidade {
  objetos?: ObjetoApi[];
  total?: { tribCalc?: { ISTot?: { vIS?: string }; IBSCBSTot?: { vBCIBSCBS?: string; gIBS?: { vIBS?: string }; gCBS?: { vCBS?: string } } } };
}

const cacheSeletivo = new Map<string, boolean>();

// O NCM paga Imposto Seletivo? (bebidas alcoólicas e açucaradas, cigarro, veículos, minerais...)
async function sujeitoAoSeletivo(ncm: string, ano: number): Promise<boolean> {
  const chave = `${ncm}|${ano}`;
  const guardado = cacheSeletivo.get(chave);
  if (guardado !== undefined) return guardado;
  let sujeito = false;
  try {
    sujeito = (await consultarNcm(ncm, ano)).tributadoPeloImpostoSeletivo === true;
  } catch {
    sujeito = false;
  }
  cacheSeletivo.set(chave, sujeito);
  return sujeito;
}

async function corpoDaOperacao(op: Operacao) {
  const a = aliquotasDoAno(op.ano);
  const nominais = op.ano >= 2027 ? { aliquotasNominais: { cbs: a.cbs, ibsEstadual: a.ibsUf, ibsMunicipal: a.ibsMun } } : {};
  return {
    id: crypto.randomBytes(16).toString('hex'),
    versao: '1.0.0',
    dhFatoGerador: `${dataDoAno(op.ano)}T12:00:00-03:00`,
    municipio: op.municipio,
    uf: op.uf,
    itens: await Promise.all(
      op.itens.map(async (item, i) => {
        const base = Math.round(item.valor * 100) / 100;
        const unidade = item.unidade.toUpperCase();
        const seletivo = op.ano >= 2027 && (await sujeitoAoSeletivo(item.ncm, op.ano));
        return {
          numero: i + 1,
          ncm: item.ncm,
          cst: item.cClassTrib.slice(0, 3), // o CST são os 3 primeiros dígitos da classificação
          cClassTrib: item.cClassTrib,
          baseCalculo: base,
          quantidade: item.quantidade,
          unidade,
          ...(seletivo ? { impostoSeletivo: { cst: '000', cClassTrib: '000001', baseCalculo: base, quantidade: item.quantidade, unidade } } : {}),
          ...('aliquotasNominais' in nominais
            ? {
                aliquotasNominais: {
                  ...nominais.aliquotasNominais,
                  ...(seletivo ? { impostoSeletivo: { adValorem: item.impostoSeletivo ?? 0 } } : {}),
                },
              }
            : {}),
        };
      })
    ),
  };
}

async function observabilidade(op: Operacao): Promise<RespostaObservabilidade> {
  return json<RespostaObservabilidade>('/observabilidade/regime-geral', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(await corpoDaOperacao(op)),
  });
}

const n = (v: string | undefined): number => (v === undefined ? 0 : Number(v) || 0);

export async function calcularOperacao(op: Operacao) {
  const resposta = await observabilidade(op);
  const itens = op.itens.map((item, i) => {
    const o = resposta.objetos?.find((x) => x.nObj === i + 1);
    const g = o?.tribCalc?.IBSCBS?.gIBSCBS;
    const calculado = o?.estadoItem === 'CALCULADO' || o?.estadoItem === 'CALCULO_SIMULADO';
    const cbs = n(g?.gCBS?.vCBS);
    const ibs = n(g?.vIBS) || n(g?.gIBSUF?.vIBSUF) + n(g?.gIBSMun?.vIBSMun);
    const aliquota = (grupo: { gRed?: GrupoAliquota } | undefined, nominal: string | undefined) =>
      grupo?.gRed?.pAliqEfet !== undefined ? n(grupo.gRed.pAliqEfet) : n(nominal);
    const efetiva = aliquota(g?.gCBS, g?.gCBS?.pCBS) + aliquota(g?.gIBSUF, g?.gIBSUF?.pIBSUF) + aliquota(g?.gIBSMun, g?.gIBSMun?.pIBSMun);
    const seletivo = n(o?.tribCalc?.IS?.vIS);
    // Embutido no preço: os tributos são "por fora" (somados ao valor). Num preço pago igual ao valor informado,
    // a parte que é tributo é valor * T / (valor + T), com T = IS + CBS + IBS calculados sobre o valor.
    const tributos = cbs + ibs + seletivo;
    return {
      numero: i + 1,
      descricao: item.descricao ?? null,
      ncm: item.ncm,
      cClassTrib: item.cClassTrib,
      valor: item.valor,
      estado: o?.estadoItem ?? 'FALHA_TECNICA',
      calculado,
      erros: (o?.erros ?? []).map((e) => e.detail ?? e.title ?? e.code ?? 'Erro'),
      cbs,
      ibs: Math.round(ibs * 100) / 100,
      seletivo,
      total: Math.round(tributos * 100) / 100,
      aliquotaEfetiva: Math.round(efetiva * 100) / 100,
      reducao: n(g?.gCBS?.gRed?.pRedAliq),
      embutido: calculado && tributos > 0 ? Math.round(((item.valor * tributos) / (item.valor + tributos)) * 100) / 100 : 0,
      memoria: o?.tribCalc?.IBSCBS?.memoriaCalculo ?? null,
    };
  });
  const tot = resposta.total?.tribCalc?.IBSCBSTot;
  return {
    ano: op.ano,
    simulado: op.ano >= 2027,
    aliquotas: aliquotasDoAno(op.ano),
    itens,
    total: {
      base: n(tot?.vBCIBSCBS),
      cbs: n(tot?.gCBS?.vCBS),
      ibs: n(tot?.gIBS?.vIBS),
      seletivo: n(resposta.total?.tribCalc?.ISTot?.vIS),
      imposto: Math.round((n(tot?.gCBS?.vCBS) + n(tot?.gIBS?.vIBS) + n(resposta.total?.tribCalc?.ISTot?.vIS)) * 100) / 100,
      embutido: Math.round(itens.reduce((s, i) => s + i.embutido, 0) * 100) / 100,
    },
  };
}

// XML do grupo de tributação (NF-e) a partir do cálculo oficial (sem observabilidade: falha se algum item tiver erro).
export async function gerarXml(op: Operacao): Promise<string> {
  const resultado = await json<unknown>('/regime-geral', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(await corpoDaOperacao(op)),
  });
  const r = await pedir('/xml/generate?tipo=nfe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(resultado),
  });
  if (!r.ok) throw new HttpError(502, `A calculadora não gerou o XML (${r.status})`);
  return r.text();
}

// Imposto de uma lista de itens de cupom (NCM provável): escolhe a classificação de cada NCM e calcula para o ano.
export async function impostoDosItens(
  itens: { descricao: string; ncm: string | null; valor: number; quantidade: number }[],
  ano: number,
  uf = 'SP',
  municipio = 3550308
) {
  const comNcm = itens.filter((i) => i.ncm && /^\d{8}$/.test(i.ncm) && i.valor > 0);
  if (comNcm.length === 0) return null;
  const operacao: Operacao = { ano, uf, municipio, itens: [] };
  for (const i of comNcm) {
    let cClassTrib = INTEGRAL;
    try {
      cClassTrib = (await classificacoesDoNcm(i.ncm as string, ano)).find((c) => c.paraConsumidor)?.codigo ?? INTEGRAL;
    } catch {
      // sem a lista, calcula pela tributação integral
    }
    operacao.itens.push({ descricao: i.descricao, ncm: i.ncm as string, cClassTrib, valor: i.valor, quantidade: i.quantidade || 1, unidade: 'UN' });
  }
  return calcularOperacao(operacao);
}
