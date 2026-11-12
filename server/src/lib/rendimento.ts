// Rendimento dos investimentos atuais comparado com Selic, IPCA, Ibovespa e IFIX.
// Três contas, todas a partir dos movimentos gravados (aplicações, resgates e proventos):
//   1. Comparação: quanto os mesmos aportes e retiradas valeriam hoje se tivessem seguido cada índice.
//   2. Renda fixa: saldo estimado pela taxa do título (% do CDI/Selic, IPCA + taxa ou prefixado).
//   3. Projeção: quanto a carteira vale em 12 meses se cada classe repetir o que o seu índice rendeu nos últimos 12.

import type { Investimento, MovimentoInvestimento, TipoInvestimento } from '@prisma/client';
import { prisma } from './prisma';
import { emCadaPerfil } from './perfil';
import { arredondar, dataISO, num, registrarPosicaoPatrimonio } from './financas';
import {
  INDICES,
  ROTULO_INDICE,
  carregarSeries,
  diasUteisEntre,
  fatorEntre,
  garantirIndices,
  hojeISO,
  posicaoEm,
  somarDias,
} from './indices';
import type { Indice, Serie } from './indices';

type Series = Record<Indice, Serie>;
type InvestimentoComMovimentos = Investimento & { movimentos: MovimentoInvestimento[] };

const CODIGO_NEGOCIADO = /^[A-Z]{4}\d{1,2}$/;

// Índice de referência de cada classe de ativo.
const INDICE_DA_CLASSE: Record<TipoInvestimento, Indice> = {
  ACAO: 'IBOV',
  ETF: 'IBOV',
  FII: 'IFIX',
  RENDA_FIXA: 'SELIC',
  FUNDO: 'SELIC',
  PREVIDENCIA: 'SELIC',
  CRIPTO: 'SELIC',
  OUTRO: 'SELIC',
};

function percentual(fracao: number | null): number | null {
  return fracao === null || !Number.isFinite(fracao) ? null : Math.round(fracao * 10000) / 100;
}

function negociadoEmBolsa(i: Investimento): boolean {
  return (i.tipo === 'ACAO' || i.tipo === 'FII' || i.tipo === 'ETF') && CODIGO_NEGOCIADO.test((i.codigo ?? '').toUpperCase());
}

// ---------- Fluxos de caixa ----------

// valor > 0: dinheiro que entrou no investimento (aplicação). valor < 0: dinheiro que saiu (resgate ou provento recebido).
export interface Fluxo {
  data: string;
  valor: number;
}

interface Historico {
  fluxos: Fluxo[];
  aportes: number;
  retiradas: number;
  proventos: number;
  desde: string | null; // data da primeira aplicação
}

function historicoDe(i: InvestimentoComMovimentos): Historico {
  const bolsa = negociadoEmBolsa(i);
  const h: Historico = { fluxos: [], aportes: 0, retiradas: 0, proventos: 0, desde: null };
  for (const m of i.movimentos) {
    const data = dataISO(m.data);
    const valor = num(m.valor);
    if (m.tipo === 'APLICACAO') {
      h.fluxos.push({ data, valor });
      h.aportes += valor;
      if (h.desde === null || data < h.desde) h.desde = data;
    } else if (m.tipo === 'RESGATE') {
      h.fluxos.push({ data, valor: -valor });
      h.retiradas += valor;
    } else if (m.tipo === 'RENDIMENTO' && bolsa) {
      // Dividendo, JCP ou rendimento de fundo: dinheiro que caiu na conta. Na renda fixa o rendimento já está no saldo.
      h.fluxos.push({ data, valor: -valor });
      h.proventos += valor;
    }
  }
  h.fluxos.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
  return h;
}

// Quanto os fluxos valeriam hoje seguindo o índice. null quando o índice não tem dados.
export function valorSeguindoIndice(fluxos: Fluxo[], serie: Serie, hoje: string): number | null {
  if (serie.datas.length === 0) return null;
  let total = 0;
  for (const f of fluxos) {
    const fator = f.data >= hoje ? 1 : fatorEntre(serie, f.data, hoje);
    if (fator === null) return null;
    total += f.valor * fator;
  }
  return total;
}

function anosEntre(de: string, ate: string): number {
  return (new Date(ate + 'T00:00:00Z').getTime() - new Date(de + 'T00:00:00Z').getTime()) / (365.25 * 86400000);
}

// Taxa anual que iguala os fluxos ao valor final (taxa interna de retorno, ponderada pelo dinheiro e pelo tempo).
// null quando o histórico tem menos de 30 dias ou a conta não fecha.
export function taxaAnual(fluxos: Fluxo[], valorFinal: number, hoje: string): number | null {
  if (fluxos.length === 0 || valorFinal < 0) return null;
  const inicio = fluxos[0].data;
  if (anosEntre(inicio, hoje) < 30 / 365.25) return null;
  // Visão de quem investe: aplicar é pagar (negativo), resgatar e o valor final são receber (positivo).
  const caixa = fluxos.map((f) => ({ t: anosEntre(inicio, f.data), v: -f.valor }));
  caixa.push({ t: anosEntre(inicio, hoje), v: valorFinal });
  const valorPresente = (taxa: number) => caixa.reduce((soma, c) => soma + c.v / Math.pow(1 + taxa, c.t), 0);
  let baixo = -0.99;
  let alto = 10;
  let vBaixo = valorPresente(baixo);
  const vAlto = valorPresente(alto);
  if (!Number.isFinite(vBaixo) || !Number.isFinite(vAlto) || vBaixo * vAlto > 0) return null;
  for (let i = 0; i < 100; i++) {
    const meio = (baixo + alto) / 2;
    const vMeio = valorPresente(meio);
    if (vBaixo * vMeio <= 0) {
      alto = meio;
    } else {
      baixo = meio;
      vBaixo = vMeio;
    }
  }
  return (baixo + alto) / 2;
}

// ---------- Renda fixa pela taxa ----------

export type Regra =
  | { tipo: 'POS'; percentual: number; spread: number } // percentual do CDI/Selic (1 = 100%) e taxa somada ao ano
  | { tipo: 'IPCA'; spread: number }
  | { tipo: 'PRE'; taxa: number };

function semAcento(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function numero(texto: string): number {
  return Number(texto.replace(',', '.'));
}

const NUM = '(\\d{1,3}(?:[.,]\\d+)?)';

// Lê a taxa escrita pelo usuário ("110% do CDI", "CDI + 2%", "IPCA + 6,2%", "12,5% a.a.") ou deduz pelo nome
// ("Tesouro Selic"). null quando não dá para saber.
export function regraDe(i: Pick<Investimento, 'taxa' | 'nome' | 'subtipo'>): Regra | null {
  const taxa = semAcento(i.taxa ?? '');
  const nome = semAcento(i.nome + ' ' + (i.subtipo ?? ''));
  if (/\b(cdi|selic|di)\b/.test(taxa)) {
    const doIndice = new RegExp(NUM + '\\s*%\\s*(?:do|da|de)?\\s*(?:cdi|selic|di)\\b').exec(taxa);
    if (doIndice) return { tipo: 'POS', percentual: numero(doIndice[1]) / 100, spread: 0 };
    const mais = new RegExp('(?:cdi|selic|di)\\s*\\+\\s*' + NUM).exec(taxa);
    if (mais) return { tipo: 'POS', percentual: 1, spread: numero(mais[1]) / 100 };
    return { tipo: 'POS', percentual: 1, spread: 0 };
  }
  if (/\bipca\b/.test(taxa)) {
    const mais = new RegExp('ipca\\s*\\+\\s*' + NUM).exec(taxa);
    return { tipo: 'IPCA', spread: mais ? numero(mais[1]) / 100 : 0 };
  }
  const pre = new RegExp(NUM + '\\s*%').exec(taxa);
  if (pre) return { tipo: 'PRE', taxa: numero(pre[1]) / 100 };
  if (/tesouro selic|\blft\b/.test(nome)) return { tipo: 'POS', percentual: 1, spread: 0 };
  return null;
}

export function rotuloDaRegra(r: Regra): string {
  const n = (fracao: number) => (Math.round(fracao * 10000) / 100).toLocaleString('pt-BR');
  if (r.tipo === 'POS') {
    const base = r.percentual === 1 ? 'Selic' : `${n(r.percentual)}% da Selic`;
    return r.spread > 0 ? `${base} + ${n(r.spread)}% ao ano` : r.percentual === 1 ? '100% da Selic' : base;
  }
  if (r.tipo === 'IPCA') return r.spread > 0 ? `IPCA + ${n(r.spread)}% ao ano` : 'IPCA';
  return `${n(r.taxa)}% ao ano`;
}

// Quanto 1 real aplicado em `de` vale em `ate` pela regra. null quando falta o índice.
export function fatorDaRegra(regra: Regra, series: Series, de: string, ate: string): number | null {
  if (de >= ate) return 1;
  const uteis = diasUteisEntre(series.SELIC, de, ate);
  if (regra.tipo === 'PRE') return Math.pow(1 + regra.taxa, uteis / 252);
  if (regra.tipo === 'IPCA') {
    const inflacao = fatorEntre(series.IPCA, de, ate);
    return inflacao === null ? null : inflacao * Math.pow(1 + regra.spread, uteis / 252);
  }
  const selic = series.SELIC;
  if (selic.datas.length === 0) return null;
  let fator: number;
  if (regra.percentual === 1) {
    fator = fatorEntre(selic, de, ate) ?? 1;
  } else {
    // Percentual do CDI: aplica o percentual sobre a taxa de cada dia útil.
    fator = 1;
    const fim = posicaoEm(selic, ate);
    for (let p = Math.max(1, posicaoEm(selic, de) + 1); p <= fim; p++) {
      fator *= 1 + (selic.valores[p] / selic.valores[p - 1] - 1) * regra.percentual;
    }
  }
  return fator * Math.pow(1 + regra.spread, uteis / 252);
}

interface Estimativa {
  saldo: number | null;
  regra: Regra | null;
  motivo: string | null; // por que não deu para estimar
}

function estimar(i: InvestimentoComMovimentos, series: Series, hoje: string): Estimativa {
  const regra = regraDe(i);
  if (!regra) {
    return { saldo: null, regra: null, motivo: 'Informe a taxa (por exemplo "110% do CDI", "IPCA + 6%" ou "12% a.a.").' };
  }
  const aplicacoes = i.movimentos.filter((m) => m.tipo === 'APLICACAO');
  if (aplicacoes.length === 0) return { saldo: null, regra, motivo: 'Registre a aplicação com a data em que foi feita.' };
  let saldo = 0;
  for (const m of i.movimentos) {
    if (m.tipo !== 'APLICACAO' && m.tipo !== 'RESGATE') continue;
    const fator = fatorDaRegra(regra, series, dataISO(m.data), hoje);
    if (fator === null) return { saldo: null, regra, motivo: 'O índice desta taxa não pôde ser buscado.' };
    saldo += (m.tipo === 'APLICACAO' ? 1 : -1) * num(m.valor) * fator;
  }
  if (saldo <= 0) return { saldo: null, regra, motivo: 'Os resgates registrados cobrem tudo o que foi aplicado.' };
  return { saldo: arredondar(saldo), regra, motivo: null };
}

export interface ResultadoRendaFixa {
  estimados: { id: number; nome: string; regra: string; saldo: number }[];
  semEstimativa: { id: number; nome: string; motivo: string }[];
}

// Corrige o saldo dos títulos de renda fixa cadastrados à mão (ou vindos da planilha da B3) pela taxa de cada um.
async function atualizarRendaFixaCom(series: Series, hoje: string): Promise<ResultadoRendaFixa> {
  const titulos = await prisma.investimento.findMany({
    where: { ativo: true, origem: 'MANUAL', tipo: 'RENDA_FIXA' },
    include: { movimentos: true },
    orderBy: { nome: 'asc' },
  });
  const resultado: ResultadoRendaFixa = { estimados: [], semEstimativa: [] };
  let mudou = false;
  for (const titulo of titulos) {
    const estimativa = estimar(titulo, series, hoje);
    if (estimativa.saldo === null || estimativa.regra === null) {
      resultado.semEstimativa.push({ id: titulo.id, nome: titulo.nome, motivo: estimativa.motivo ?? '' });
      continue;
    }
    resultado.estimados.push({
      id: titulo.id,
      nome: titulo.nome,
      regra: rotuloDaRegra(estimativa.regra),
      saldo: estimativa.saldo,
    });
    if (Math.abs(estimativa.saldo - num(titulo.saldo)) >= 0.01) {
      const agora = new Date();
      await prisma.investimento.update({
        where: { id: titulo.id },
        data: { saldo: estimativa.saldo, dataPosicao: agora, estimadoEm: agora },
      });
      mudou = true;
    }
  }
  if (mudou) await registrarPosicaoPatrimonio();
  return resultado;
}

// ---------- Relatório ----------

export interface ComparacaoIndice {
  indice: Indice;
  rotulo: string;
  valorHoje: number | null; // quanto os mesmos aportes e retiradas valeriam hoje no índice
  ganho: number | null;
  taxaAnual: number | null; // % ao ano
  diferenca: number | null; // carteira menos índice (positivo = a carteira rendeu mais)
}

export interface LinhaRendimento {
  aportes: number;
  retiradas: number;
  proventos: number;
  saldo: number;
  ganho: number; // saldo + retiradas + proventos - aportes
  rentabilidade: number | null; // ganho sobre o total aplicado, em %
  taxaAnual: number | null; // % ao ano
  desde: string | null;
}

export interface AtivoRendimento extends LinhaRendimento {
  id: number;
  nome: string;
  codigo: string | null;
  tipo: TipoInvestimento;
  indice: Indice;
  rotuloIndice: string;
  valorNoIndice: number | null;
  taxaAnualDoIndice: number | null;
  diferenca: number | null;
}

export interface ClasseRendimento extends LinhaRendimento {
  tipo: TipoInvestimento;
  ativos: number;
  indice: Indice;
  rotuloIndice: string;
  valorNoIndice: number | null;
  taxaAnualDoIndice: number | null;
  diferenca: number | null;
}

export interface ProjecaoClasse {
  tipo: TipoInvestimento;
  saldo: number;
  referencia: string; // de onde vem a taxa
  taxa: number | null; // % esperado em 12 meses
  projetado: number;
}

export interface RelatorioRendimento {
  geradoEm: string;
  indices: { indice: Indice; rotulo: string; ultimaData: string | null; retorno12m: number | null; retornoNoAno: number | null }[];
  carteira: LinhaRendimento & { ativos: number; comparacao: ComparacaoIndice[] };
  classes: ClasseRendimento[];
  ativos: AtivoRendimento[];
  semHistorico: { id: number; nome: string; saldo: number }[];
  rendaFixa: ResultadoRendaFixa;
  projecao: { classes: ProjecaoClasse[]; saldo: number; projetado: number; ganho: number; taxa: number | null };
  avisos: string[];
}

function linha(h: Historico, saldo: number, hoje: string): LinhaRendimento {
  const ganho = saldo + h.retiradas + h.proventos - h.aportes;
  return {
    aportes: arredondar(h.aportes),
    retiradas: arredondar(h.retiradas),
    proventos: arredondar(h.proventos),
    saldo: arredondar(saldo),
    ganho: arredondar(ganho),
    rentabilidade: h.aportes > 0 ? percentual(ganho / h.aportes) : null,
    taxaAnual: percentual(taxaAnual(h.fluxos, saldo, hoje)),
    desde: h.desde,
  };
}

function juntar(lista: Historico[]): Historico {
  const total: Historico = { fluxos: [], aportes: 0, retiradas: 0, proventos: 0, desde: null };
  for (const h of lista) {
    total.fluxos.push(...h.fluxos);
    total.aportes += h.aportes;
    total.retiradas += h.retiradas;
    total.proventos += h.proventos;
    if (h.desde !== null && (total.desde === null || h.desde < total.desde)) total.desde = h.desde;
  }
  total.fluxos.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
  return total;
}

function contraIndice(h: Historico, saldo: number, serie: Serie, hoje: string) {
  const valor = valorSeguindoIndice(h.fluxos, serie, hoje);
  return {
    valorNoIndice: valor === null ? null : arredondar(valor),
    taxaAnualDoIndice: valor === null || valor <= 0 ? null : percentual(taxaAnual(h.fluxos, valor, hoje)),
    diferenca: valor === null ? null : arredondar(saldo - valor),
  };
}

function retornoEntre(serie: Serie, de: string, ate: string): number | null {
  if (serie.datas.length === 0 || serie.datas[0] > de) return null;
  const fator = fatorEntre(serie, de, ate);
  return fator === null ? null : fator - 1;
}

// Taxa esperada de um ativo para os próximos 12 meses: a taxa do título, ou o que o índice da classe rendeu em 12 meses.
function taxaEsperada(i: Investimento, ultimos12: Record<Indice, number | null>): { taxa: number | null; referencia: string } {
  if (i.tipo === 'RENDA_FIXA') {
    const regra = regraDe(i);
    if (regra?.tipo === 'PRE') return { taxa: regra.taxa, referencia: 'Taxa do título' };
    if (regra?.tipo === 'IPCA') {
      const ipca = ultimos12.IPCA;
      return { taxa: ipca === null ? null : (1 + ipca) * (1 + regra.spread) - 1, referencia: 'IPCA + taxa do título' };
    }
    if (regra?.tipo === 'POS') {
      const selic = ultimos12.SELIC;
      return {
        taxa: selic === null ? null : (1 + selic * regra.percentual) * (1 + regra.spread) - 1,
        referencia: 'Selic e taxa do título',
      };
    }
  }
  const indice = INDICE_DA_CLASSE[i.tipo];
  return { taxa: ultimos12[indice], referencia: ROTULO_INDICE[indice] + ' dos últimos 12 meses' };
}

// Monta o relatório completo. Busca os índices que faltam (ou todos, com `forcar`) e corrige a renda fixa antes.
export async function montarRelatorio(forcar = false): Promise<RelatorioRendimento> {
  const hoje = hojeISO();
  const primeiro = await prisma.movimentoInvestimento.findFirst({
    where: { investimento: { ativo: true } },
    orderBy: { data: 'asc' },
    select: { data: true },
  });
  // Os índices começam no ano do movimento mais antigo e cobrem pelo menos os dois últimos anos.
  const doisAnosAtras = Number(hoje.slice(0, 4)) - 2;
  const anoInicial = Math.min(primeiro ? primeiro.data.getUTCFullYear() : doisAnosAtras, doisAnosAtras);
  const { erros } = await garantirIndices(`${anoInicial}-01-01`, forcar);
  const series = await carregarSeries();
  const rendaFixa = await atualizarRendaFixaCom(series, hoje);

  const investimentos = await prisma.investimento.findMany({
    where: { ativo: true },
    include: { movimentos: true },
    orderBy: { saldo: 'desc' },
  });

  const ativos: AtivoRendimento[] = [];
  const semHistorico: RelatorioRendimento['semHistorico'] = [];
  const historicos: { investimento: InvestimentoComMovimentos; historico: Historico }[] = [];
  for (const investimento of investimentos) {
    const historico = historicoDe(investimento);
    const saldo = num(investimento.saldo);
    if (historico.aportes <= 0) {
      if (saldo > 0) semHistorico.push({ id: investimento.id, nome: investimento.nome, saldo: arredondar(saldo) });
      continue;
    }
    historicos.push({ investimento, historico });
    const indice = INDICE_DA_CLASSE[investimento.tipo];
    ativos.push({
      id: investimento.id,
      nome: investimento.nome,
      codigo: investimento.codigo,
      tipo: investimento.tipo,
      ...linha(historico, saldo, hoje),
      indice,
      rotuloIndice: ROTULO_INDICE[indice],
      ...contraIndice(historico, saldo, series[indice], hoje),
    });
  }

  const classes: ClasseRendimento[] = [];
  for (const tipo of new Set(historicos.map((h) => h.investimento.tipo))) {
    const daClasse = historicos.filter((h) => h.investimento.tipo === tipo);
    const historico = juntar(daClasse.map((h) => h.historico));
    const saldo = daClasse.reduce((soma, h) => soma + num(h.investimento.saldo), 0);
    const indice = INDICE_DA_CLASSE[tipo];
    classes.push({
      tipo,
      ativos: daClasse.length,
      ...linha(historico, saldo, hoje),
      indice,
      rotuloIndice: ROTULO_INDICE[indice],
      ...contraIndice(historico, saldo, series[indice], hoje),
    });
  }
  classes.sort((a, b) => b.saldo - a.saldo);

  const historicoTotal = juntar(historicos.map((h) => h.historico));
  const saldoTotal = historicos.reduce((soma, h) => soma + num(h.investimento.saldo), 0);
  const linhaTotal = linha(historicoTotal, saldoTotal, hoje);
  const comparacao: ComparacaoIndice[] = INDICES.map((indice) => {
    const contra = contraIndice(historicoTotal, saldoTotal, series[indice], hoje);
    return {
      indice,
      rotulo: ROTULO_INDICE[indice],
      valorHoje: contra.valorNoIndice,
      // O ganho no índice usa as mesmas retiradas e proventos da carteira, para a comparação ser justa.
      ganho:
        contra.valorNoIndice === null
          ? null
          : arredondar(contra.valorNoIndice + historicoTotal.retiradas + historicoTotal.proventos - historicoTotal.aportes),
      taxaAnual: contra.taxaAnualDoIndice,
      diferenca: contra.diferenca,
    };
  });

  const viradaDoAno = `${Number(hoje.slice(0, 4)) - 1}-12-31`;
  const ultimos12 = {} as Record<Indice, number | null>;
  const indices = INDICES.map((indice) => {
    const serie = series[indice];
    // O IPCA sai com atraso: mede os 12 meses até o último mês publicado.
    const fim = serie.datas.length > 0 && serie.datas[serie.datas.length - 1] < hoje ? serie.datas[serie.datas.length - 1] : hoje;
    // Mesmo dia do ano anterior: no IPCA (pontos no fim do mês) isso dá exatamente 12 meses de inflação.
    const inicio = indice === 'IPCA' ? `${Number(fim.slice(0, 4)) - 1}${fim.slice(4)}` : somarDias(fim, -365);
    ultimos12[indice] = retornoEntre(serie, inicio, fim);
    return {
      indice,
      rotulo: ROTULO_INDICE[indice],
      ultimaData: serie.datas.length > 0 ? serie.datas[serie.datas.length - 1] : null,
      retorno12m: percentual(ultimos12[indice]),
      retornoNoAno: percentual(retornoEntre(serie, viradaDoAno, hoje)),
    };
  });

  // Projeção para 12 meses, por classe.
  const grupos = new Map<TipoInvestimento, { saldo: number; projetado: number; referencias: Set<string>; semTaxa: boolean }>();
  for (const investimento of investimentos) {
    const saldo = num(investimento.saldo);
    if (saldo <= 0) continue;
    const { taxa, referencia } = taxaEsperada(investimento, ultimos12);
    const grupo = grupos.get(investimento.tipo) ?? { saldo: 0, projetado: 0, referencias: new Set<string>(), semTaxa: false };
    grupo.saldo += saldo;
    grupo.projetado += saldo * (1 + (taxa ?? 0));
    grupo.referencias.add(referencia);
    if (taxa === null) grupo.semTaxa = true;
    grupos.set(investimento.tipo, grupo);
  }
  const projecaoClasses: ProjecaoClasse[] = [...grupos.entries()]
    .map(([tipo, g]) => ({
      tipo,
      saldo: arredondar(g.saldo),
      referencia: [...g.referencias].join('; '),
      taxa: g.semTaxa ? null : percentual(g.projetado / g.saldo - 1),
      projetado: arredondar(g.projetado),
    }))
    .sort((a, b) => b.saldo - a.saldo);
  const saldoProjecao = projecaoClasses.reduce((soma, c) => soma + c.saldo, 0);
  const projetado = projecaoClasses.reduce((soma, c) => soma + c.projetado, 0);

  const avisos = [...erros];
  if (semHistorico.length > 0) {
    avisos.push(
      'Alguns ativos não têm aplicação registrada e ficaram fora da comparação. Importe a movimentação da B3 de um período maior ou registre a aplicação.'
    );
  }

  return {
    geradoEm: new Date().toISOString(),
    indices,
    carteira: { ...linhaTotal, ativos: historicos.length, comparacao },
    classes,
    ativos,
    semHistorico,
    rendaFixa,
    projecao: {
      classes: projecaoClasses,
      saldo: arredondar(saldoProjecao),
      projetado: arredondar(projetado),
      ganho: arredondar(projetado - saldoProjecao),
      taxa: saldoProjecao > 0 ? percentual(projetado / saldoProjecao - 1) : null,
    },
    avisos,
  };
}

const INTERVALO_MS = 8 * 60 * 60 * 1000;
const ATRASO_INICIAL_MS = 3 * 60 * 1000;
let automaticoIniciado = false;

// Mantém os índices e o saldo da renda fixa em dia: três minutos depois de o servidor subir e a cada 8 horas.
// Só trabalha quando há investimento cadastrado.
export function iniciarRendimentoAutomatico(): void {
  if (automaticoIniciado) return;
  automaticoIniciado = true;
  const rodar = () => {
    emCadaPerfil(async () => {
      if ((await prisma.investimento.count({ where: { ativo: true } })) > 0) await montarRelatorio();
    })
      .catch((erro: unknown) => {
        console.error('Falha na atualização automática dos índices:', erro instanceof Error ? erro.message : erro);
      });
  };
  setTimeout(rodar, ATRASO_INICIAL_MS).unref();
  setInterval(rodar, INTERVALO_MS).unref();
}
