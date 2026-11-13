// Carteira de investimentos ao longo do tempo: patrimônio e rentabilidade por dia, mês e ano, comparados com
// CDI/Selic, Ibovespa, IPCA e IFIX; divisão por classe e por instituição; proventos recebidos e agenda estimada.
//
// Como a rentabilidade é calculada (ponderada pelo tempo): em cada dia útil,
//   retorno = (valor de hoje - aplicações + resgates + proventos recebidos) / valor de ontem - 1
// Assim, pôr ou tirar dinheiro não muda a rentabilidade; só a variação de preço e os proventos contam.
// O valor de cada dia vem da quantidade que havia naquele dia (reconstruída pelos movimentos) vezes o fechamento
// do ativo (Yahoo Finance, sem cadastro). Ativo sem preço histórico (renda fixa, fundo) cresce de forma uniforme
// do valor aplicado até o saldo de hoje.

import type { Investimento, MovimentoInvestimento, TipoInvestimento } from '@prisma/client';
import { prisma } from './prisma';
import { arredondar, dataISO, efeitoNoSaldo, num } from './financas';
import { perfilAtual } from './prisma';
import { carregarSeries, fatorEntre, garantirIndices, hojeISO, somarDias } from './indices';
import type { Indice, Serie } from './indices';

// Desdobramento, grupamento ou bonificação do ativo (fator multiplica a quantidade a partir da data).
interface FatorEvento {
  data: string;
  fator: number;
}

type Ativo = Investimento & { movimentos: MovimentoInvestimento[]; eventos: FatorEvento[] };
type Series = Record<Indice, Serie>;

const CODIGO_NEGOCIADO = /^[A-Z]{4}\d{1,2}$/;
const TEMPO_LIMITE_MS = 20000;
const VALIDADE_MS = 6 * 60 * 60 * 1000;

export type ClasseCarteira = 'RENDA_VARIAVEL' | 'RENDA_FIXA' | 'FUNDOS' | 'OUTROS';

const CLASSE_DO_TIPO: Record<TipoInvestimento, ClasseCarteira> = {
  ACAO: 'RENDA_VARIAVEL',
  FII: 'RENDA_VARIAVEL',
  ETF: 'RENDA_VARIAVEL',
  RENDA_FIXA: 'RENDA_FIXA',
  FUNDO: 'FUNDOS',
  PREVIDENCIA: 'FUNDOS',
  CRIPTO: 'OUTROS',
  OUTRO: 'OUTROS',
};

const ROTULO_CLASSE: Record<ClasseCarteira, string> = {
  RENDA_VARIAVEL: 'Renda variável',
  RENDA_FIXA: 'Renda fixa',
  FUNDOS: 'Fundos',
  OUTROS: 'Outros',
};

function pct(fracao: number | null): number | null {
  return fracao === null || !Number.isFinite(fracao) ? null : Math.round(fracao * 10000) / 100;
}

function codigoDe(a: Pick<Investimento, 'codigo' | 'tipo'>): string | null {
  const codigo = (a.codigo ?? '').toUpperCase();
  return (a.tipo === 'ACAO' || a.tipo === 'FII' || a.tipo === 'ETF') && CODIGO_NEGOCIADO.test(codigo) ? codigo : null;
}

// ---------- Preços históricos ----------

const ultimaBusca = new Map<string, number>();
// Desde quando o histórico de cada código já foi buscado nesta execução do servidor.
const coberto = new Map<string, string>();

async function fechamentosYahoo(codigo: string, de: string, ate: string): Promise<{ data: string; valor: number }[]> {
  const inicio = Math.floor(new Date(de + 'T00:00:00Z').getTime() / 1000);
  const fim = Math.floor(new Date(ate + 'T23:59:59Z').getTime() / 1000);
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), TEMPO_LIMITE_MS);
  try {
    const resposta = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(codigo)}.SA?period1=${inicio}&period2=${fim}&interval=1d`,
      { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; financas-pessoais)' }, signal: controle.signal }
    );
    if (!resposta.ok) return [];
    const corpo = (await resposta.json()) as {
      chart?: { result?: { timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }[] };
    };
    const resultado = corpo.chart?.result?.[0];
    const instantes = resultado?.timestamp ?? [];
    const fechamentos = resultado?.indicators?.quote?.[0]?.close ?? [];
    const porDia = new Map<string, number>();
    instantes.forEach((instante, i) => {
      const valor = fechamentos[i];
      if (typeof valor === 'number' && Number.isFinite(valor) && valor > 0) {
        porDia.set(new Date((instante - 3 * 3600) * 1000).toISOString().slice(0, 10), valor);
      }
    });
    return [...porDia.entries()].map(([data, valor]) => ({ data, valor }));
  } finally {
    clearTimeout(relogio);
  }
}

// Busca os fechamentos que faltam de cada código (no máximo uma vez a cada 6 horas por código). Nunca lança.
export async function garantirPrecos(codigos: string[], desde: string, forcar = false): Promise<void> {
  const hoje = hojeISO();
  for (const codigo of codigos) {
    const jaCobre = (coberto.get(codigo) ?? '9999') <= desde;
    if (!forcar && jaCobre && Date.now() - (ultimaBusca.get(codigo) ?? 0) < VALIDADE_MS) continue;
    ultimaBusca.set(codigo, Date.now());
    try {
      const [primeiro, ultimo] = await Promise.all([
        prisma.precoAtivo.findFirst({ where: { codigo }, orderBy: { data: 'asc' } }),
        prisma.precoAtivo.findFirst({ where: { codigo }, orderBy: { data: 'desc' } }),
      ]);
      // Busca de novo desde o começo quando falta passado; senão só os dias novos.
      const faltaPassado = !primeiro || (!jaCobre && dataISO(primeiro.data) > somarDias(desde, 20));
      const de = faltaPassado || !ultimo ? desde : somarDias(dataISO(ultimo.data), 1);
      if (de > hoje) continue;
      const pontos = await fechamentosYahoo(codigo, de, hoje);
      for (let i = 0; i < pontos.length; i += 2000) {
        await prisma.precoAtivo.createMany({
          data: pontos.slice(i, i + 2000).map((p) => ({ codigo, data: new Date(p.data + 'T00:00:00Z'), valor: p.valor })),
          skipDuplicates: true,
        });
      }
      if (!jaCobre) coberto.set(codigo, desde);
      await new Promise((resolve) => setTimeout(resolve, 150));
    } catch (erro) {
      console.error(`Falha ao buscar preços de ${codigo}:`, erro instanceof Error ? erro.message : erro);
    }
  }
}

// Último fechamento conhecido de um código; null quando não há preço gravado.
export async function ultimoPreco(codigo: string): Promise<number | null> {
  const ponto = await prisma.precoAtivo.findFirst({ where: { codigo }, orderBy: { data: 'desc' } });
  return ponto ? ponto.valor : null;
}

async function carregarPrecos(codigos: string[]): Promise<Map<string, Map<string, number>>> {
  const mapa = new Map<string, Map<string, number>>();
  if (codigos.length === 0) return mapa;
  const pontos = await prisma.precoAtivo.findMany({ where: { codigo: { in: codigos } }, orderBy: { data: 'asc' } });
  for (const p of pontos) {
    let doCodigo = mapa.get(p.codigo);
    if (!doCodigo) {
      doCodigo = new Map<string, number>();
      mapa.set(p.codigo, doCodigo);
    }
    doCodigo.set(dataISO(p.data), p.valor);
  }
  return mapa;
}

// ---------- Série diária ----------

interface SerieDiaria {
  valor: number[]; // patrimônio no fim de cada dia
  fluxo: number[]; // aplicações menos resgates do dia
  proventos: number[]; // dinheiro recebido no dia
  retorno: number[]; // retorno do dia (fração)
}

// Eventos (desdobramento, grupamento, bonificação) de cada ativo, em uma consulta só. Ativo sem evento não aparece no mapa.
async function eventosDosAtivos(ids: number[]): Promise<Map<number, FatorEvento[]>> {
  const mapa = new Map<number, FatorEvento[]>();
  if (ids.length === 0) return mapa;
  const lidos = await prisma.eventoAtivo.findMany({
    where: { investimentoId: { in: ids } },
    select: { investimentoId: true, data: true, fator: true },
    orderBy: { data: 'asc' },
  });
  for (const e of lidos) {
    const lista = mapa.get(e.investimentoId) ?? [];
    lista.push({ data: dataISO(e.data), fator: e.fator });
    mapa.set(e.investimentoId, lista);
  }
  return mapa;
}

// Posição (no eixo de dias) do primeiro dia >= data.
function posicaoDoDia(dias: string[], data: string): number {
  let inicio = 0;
  let fim = dias.length;
  while (inicio < fim) {
    const meio = (inicio + fim) >> 1;
    if (dias[meio] < data) inicio = meio + 1;
    else fim = meio;
  }
  return Math.min(inicio, dias.length - 1);
}

// Produto dos fatores dos eventos com data posterior à do movimento: leva a quantidade daquela data para "cotas de hoje".
function fatorDepois(eventos: FatorEvento[], data: string): number {
  let fator = 1;
  for (const e of eventos) if (e.data > data) fator *= e.fator;
  return fator;
}

function valoresDoAtivo(a: Ativo, dias: string[], precos: Map<string, number> | undefined): { valor: number[]; fluxo: number[]; proventos: number[] } {
  const n = dias.length;
  const valor = new Array<number>(n).fill(0);
  const fluxo = new Array<number>(n).fill(0);
  const proventos = new Array<number>(n).fill(0);
  const quantidade = new Array<number>(n).fill(0);
  // Mesma quantidade, já em "cotas de hoje" (cada lote multiplicado pelos desdobramentos que vieram depois dele).
  const quantidadeAjustada = new Array<number>(n).fill(0);
  const custo = new Array<number>(n).fill(0);
  const negociado = codigoDe(a) !== null;
  const comEventos = a.eventos.length > 0;
  let primeiro = -1;
  for (const m of a.movimentos) {
    const data = dataISO(m.data);
    if (data > dias[n - 1]) continue;
    const i = posicaoDoDia(dias, data);
    const v = num(m.valor);
    if (m.tipo === 'APLICACAO') {
      fluxo[i] += v;
      custo[i] += v;
      quantidade[i] += num(m.quantidade);
      if (comEventos) quantidadeAjustada[i] += num(m.quantidade) * fatorDepois(a.eventos, data);
      if (primeiro < 0 || i < primeiro) primeiro = i;
    } else if (m.tipo === 'RESGATE') {
      fluxo[i] -= v;
      custo[i] -= v;
      quantidade[i] -= num(m.quantidade);
      if (comEventos) quantidadeAjustada[i] -= num(m.quantidade) * fatorDepois(a.eventos, data);
    } else if (m.tipo === 'RENDIMENTO' && negociado) {
      proventos[i] += v;
    }
  }
  if (primeiro < 0) return { valor, fluxo, proventos };
  for (let i = 1; i < n; i++) {
    quantidade[i] += quantidade[i - 1];
    quantidadeAjustada[i] += quantidadeAjustada[i - 1];
    custo[i] += custo[i - 1];
  }
  const saldoHoje = num(a.saldo);
  const quantidadeHoje = num(a.quantidade);
  const comPreco = negociado && precos !== undefined && precos.size > 0 && quantidade[n - 1] > 0 && quantidadeHoje > 0;
  if (comPreco && precos) {
    // Com desdobramento, grupamento ou bonificação: cada dia usa a quantidade em "cotas de hoje" (o Yahoo ajusta os preços).
    // Sem eventos: a quantidade dos movimentos é ajustada uniformemente para bater com a de hoje.
    const ajuste = quantidadeHoje / quantidade[n - 1];
    let preco: number | null = null;
    for (let i = 0; i < n; i++) {
      preco = precos.get(dias[i]) ?? preco;
      const q = comEventos ? Math.max(0, quantidadeAjustada[i]) : Math.max(0, quantidade[i]) * ajuste;
      // Antes do primeiro preço conhecido, vale o que foi pago.
      valor[i] = preco === null ? Math.max(0, custo[i]) : q * preco;
    }
  } else {
    // Sem preço histórico: cresce de forma uniforme do valor aplicado até o saldo de hoje.
    const custoFinal = custo[n - 1];
    const razao = custoFinal > 0 && saldoHoje > 0 ? saldoHoje / custoFinal : 1;
    const duracao = Math.max(1, n - 1 - primeiro);
    for (let i = primeiro; i < n; i++) {
      valor[i] = Math.max(0, custo[i]) * Math.pow(razao, (i - primeiro) / duracao);
    }
  }
  return { valor, fluxo, proventos };
}

function serieDe(ativos: Ativo[], dias: string[], precos: Map<string, Map<string, number>>): SerieDiaria {
  const n = dias.length;
  const serie: SerieDiaria = {
    valor: new Array<number>(n).fill(0),
    fluxo: new Array<number>(n).fill(0),
    proventos: new Array<number>(n).fill(0),
    retorno: new Array<number>(n).fill(0),
  };
  for (const a of ativos) {
    const codigo = codigoDe(a);
    const v = valoresDoAtivo(a, dias, codigo ? precos.get(codigo) : undefined);
    for (let i = 0; i < n; i++) {
      serie.valor[i] += v.valor[i];
      serie.fluxo[i] += v.fluxo[i];
      serie.proventos[i] += v.proventos[i];
    }
  }
  for (let i = 1; i < n; i++) {
    const ontem = serie.valor[i - 1];
    if (ontem < 1) continue;
    const r = (serie.valor[i] - serie.fluxo[i] + serie.proventos[i]) / ontem - 1;
    // Variação absurda em um dia é falha de dado (preço faltando, evento societário): não entra na conta.
    serie.retorno[i] = Number.isFinite(r) && Math.abs(r) <= 0.4 ? r : 0;
  }
  return serie;
}

// Retorno acumulado no intervalo (de, ate] do eixo de dias.
function retornoNoIntervalo(serie: SerieDiaria, de: number, ate: number): number | null {
  if (ate <= de || de < 0) return null;
  let fator = 1;
  let houve = false;
  for (let i = de + 1; i <= ate; i++) {
    if (serie.valor[i - 1] >= 1) houve = true;
    fator *= 1 + serie.retorno[i];
  }
  return houve ? fator - 1 : null;
}

function retornoDoIndice(serie: Serie, de: string, ate: string): number | null {
  if (serie.datas.length === 0 || serie.datas[0] > de) return null;
  const fator = fatorEntre(serie, de, ate);
  return fator === null ? null : fator - 1;
}

// ---------- Relatório da carteira ----------

interface Comparado {
  carteira: number | null;
  cdi: number | null;
  ibov: number | null;
  ipca: number | null;
  ifix: number | null;
}

export interface CarteiraDTO {
  geradoEm: string;
  desde: string | null;
  classe: 'TODAS' | ClasseCarteira;
  periodo: { meses: number; inicio: string | null };
  resumo: {
    saldo: number;
    aplicado: number;
    ganhoDeCapital: number;
    proventos: number;
    ativos: number;
    ganhoDeCapitalNoMes: number;
    rentabilidadeNoMes: number | null;
    cdiNoMes: number | null;
    ibovNoMes: number | null;
    percentualDoCdiNoMes: number | null;
    rentabilidadeDoInicio: number | null;
  };
  periodos: ({ chave: 'MES' | 'SEIS_MESES' | 'ANO' | 'DOZE_MESES' | 'INICIO'; rotulo: string } & Comparado)[];
  diario: { datas: string[]; carteira: number[]; cdi: number[]; ibov: number[]; ipca: number[]; ifix: number[] };
  mensal: ({ mes: string; patrimonio: number; ganhoDeCapital: number; proventos: number; acumulado: number | null } & Comparado)[];
  anual: ({ ano: number } & Comparado)[];
  extremos: {
    piorDia: { data: string; valor: number } | null;
    melhorDia: { data: string; valor: number } | null;
    piorMes: { mes: string; valor: number } | null;
    melhorMes: { mes: string; valor: number } | null;
    piorAno: { ano: number; valor: number } | null;
    melhorAno: { ano: number; valor: number } | null;
  };
  estatisticas: {
    mesesPositivos: number;
    mesesNegativos: number;
    mesesAcimaDoCdi: number;
    mesesAbaixoDoCdi: number;
    maior: number | null;
    menor: number | null;
    media: number | null;
  };
  classes: { chave: ClasseCarteira; rotulo: string; saldo: number; parte: number }[];
  instituicoes: { nome: string; saldo: number; parte: number; mes: number | null; ano: number | null; acumulada: number | null }[];
  ativos: {
    id: number;
    nome: string;
    codigo: string | null;
    classe: string;
    instituicao: string | null;
    saldo: number;
    parte: number;
    quantidade: number | null;
    precoMedio: number | null;
    precoAtual: number | null;
    rentabilidade: number | null;
    percentualDoCdi: number | null;
  }[];
  avisos: string[];
}

function parte(valor: number, total: number): number {
  return total > 0 ? Math.round((valor / total) * 10000) / 100 : 0;
}

export async function montarCarteira(opcoes: { meses: number; classe: 'TODAS' | ClasseCarteira; forcar?: boolean }): Promise<CarteiraDTO> {
  const hoje = hojeISO();
  const brutos = await prisma.investimento.findMany({ where: { ativo: true }, include: { movimentos: true }, orderBy: { saldo: 'desc' } });
  const eventos = await eventosDosAtivos(brutos.map((a) => a.id));
  const todos: Ativo[] = brutos.map((a) => ({ ...a, eventos: eventos.get(a.id) ?? [] }));
  const ativos = todos.filter((a) => opcoes.classe === 'TODAS' || CLASSE_DO_TIPO[a.tipo] === opcoes.classe);
  const avisos: string[] = [];

  let primeiraData: string | null = null;
  for (const a of ativos) {
    for (const m of a.movimentos) {
      if (m.tipo !== 'APLICACAO') continue;
      const d = dataISO(m.data);
      if (primeiraData === null || d < primeiraData) primeiraData = d;
    }
  }

  const saldo = ativos.reduce((s, a) => s + num(a.saldo), 0);
  const aplicado = ativos.reduce((s, a) => s + num(a.valorAplicado), 0);
  const vazio: CarteiraDTO = {
    geradoEm: new Date().toISOString(),
    desde: primeiraData,
    classe: opcoes.classe,
    periodo: { meses: opcoes.meses, inicio: null },
    resumo: {
      saldo: arredondar(saldo),
      aplicado: arredondar(aplicado),
      ganhoDeCapital: arredondar(saldo - aplicado),
      proventos: 0,
      ativos: ativos.length,
      ganhoDeCapitalNoMes: 0,
      rentabilidadeNoMes: null,
      cdiNoMes: null,
      ibovNoMes: null,
      percentualDoCdiNoMes: null,
      rentabilidadeDoInicio: null,
    },
    periodos: [],
    diario: { datas: [], carteira: [], cdi: [], ibov: [], ipca: [], ifix: [] },
    mensal: [],
    anual: [],
    extremos: { piorDia: null, melhorDia: null, piorMes: null, melhorMes: null, piorAno: null, melhorAno: null },
    estatisticas: { mesesPositivos: 0, mesesNegativos: 0, mesesAcimaDoCdi: 0, mesesAbaixoDoCdi: 0, maior: null, menor: null, media: null },
    classes: [],
    instituicoes: [],
    ativos: [],
    avisos,
  };
  if (primeiraData === null) {
    if (ativos.length > 0) avisos.push('Os ativos não têm aplicação registrada: sem a data das compras não dá para montar o histórico.');
    return vazio;
  }

  const { erros } = await garantirIndices(`${Math.min(Number(primeiraData.slice(0, 4)), Number(hoje.slice(0, 4)) - 2)}-01-01`, opcoes.forcar);
  avisos.push(...erros);
  const series: Series = await carregarSeries();
  const codigos = [...new Set(ativos.map(codigoDe).filter((c): c is string => c !== null))];
  await garantirPrecos(codigos, primeiraData, opcoes.forcar);
  const precos = await carregarPrecos(codigos);
  const semPreco = codigos.filter((c) => (precos.get(c)?.size ?? 0) === 0);
  if (semPreco.length > 0) {
    avisos.push(`Sem preço histórico para ${semPreco.join(', ')}: esses ativos entram com crescimento uniforme do valor pago até o saldo atual.`);
  }

  // Eixo de dias: os dias úteis (os mesmos da Selic) desde a véspera da primeira aplicação, mais hoje.
  const dias = series.SELIC.datas.filter((d) => d >= somarDias(primeiraData as string, -5) && d <= hoje);
  if (dias.length === 0 || dias[dias.length - 1] < hoje) dias.push(hoje);
  const n = dias.length;
  const serie = serieDe(ativos, dias, precos);
  const fim = n - 1;

  // Janela pedida.
  const inicioPedido = opcoes.meses > 0 ? somarDias(hoje, -Math.round(opcoes.meses * 30.44)) : dias[0];
  const primeiroComValor = serie.valor.findIndex((v) => v >= 1);
  const i0 = Math.max(posicaoDoDia(dias, inicioPedido), Math.max(0, primeiroComValor));

  const comparar = (de: number, ate: number): Comparado => ({
    carteira: pct(retornoNoIntervalo(serie, de, ate)),
    cdi: pct(retornoDoIndice(series.SELIC, dias[de], dias[ate])),
    ibov: pct(retornoDoIndice(series.IBOV, dias[de], dias[ate])),
    ipca: pct(retornoDoIndice(series.IPCA, dias[de], dias[ate])),
    ifix: pct(retornoDoIndice(series.IFIX, dias[de], dias[ate])),
  });

  // Último dia antes de uma data (base do período).
  const baseAntesDe = (data: string): number => Math.max(Math.max(0, primeiroComValor), posicaoDoDia(dias, data) - 1);
  const mesAtual = hoje.slice(0, 7);
  const baseDoMes = baseAntesDe(mesAtual + '-01');
  const periodos: CarteiraDTO['periodos'] = [
    { chave: 'MES', rotulo: 'No mês', ...comparar(baseDoMes, fim) },
    { chave: 'SEIS_MESES', rotulo: '6 meses', ...comparar(baseAntesDe(somarDias(hoje, -182)), fim) },
    { chave: 'ANO', rotulo: 'No ano', ...comparar(baseAntesDe(hoje.slice(0, 4) + '-01-01'), fim) },
    { chave: 'DOZE_MESES', rotulo: '12 meses', ...comparar(baseAntesDe(somarDias(hoje, -365)), fim) },
    { chave: 'INICIO', rotulo: 'Do início', ...comparar(Math.max(0, primeiroComValor), fim) },
  ];

  // Série diária acumulada da janela (em %).
  const diario: CarteiraDTO['diario'] = { datas: [], carteira: [], cdi: [], ibov: [], ipca: [], ifix: [] };
  let acumulado = 1;
  for (let i = i0; i <= fim; i++) {
    if (i > i0) acumulado *= 1 + serie.retorno[i];
    diario.datas.push(dias[i]);
    diario.carteira.push(pct(acumulado - 1) ?? 0);
    diario.cdi.push(pct(retornoDoIndice(series.SELIC, dias[i0], dias[i])) ?? 0);
    diario.ibov.push(pct(retornoDoIndice(series.IBOV, dias[i0], dias[i])) ?? 0);
    diario.ipca.push(pct(retornoDoIndice(series.IPCA, dias[i0], dias[i])) ?? 0);
    diario.ifix.push(pct(retornoDoIndice(series.IFIX, dias[i0], dias[i])) ?? 0);
  }

  // Meses e anos da janela.
  const mensal: CarteiraDTO['mensal'] = [];
  const anual: CarteiraDTO['anual'] = [];
  let acumuladoMensal = 1;
  let inicioDoGrupo = i0;
  for (let i = i0 + 1; i <= fim + 1; i++) {
    const virouMes = i > fim || dias[i].slice(0, 7) !== dias[i - 1].slice(0, 7);
    if (!virouMes) continue;
    const ultimo = i - 1;
    // O primeiro mês da janela começa no próprio i0; os demais, no último dia do mês anterior.
    const base = inicioDoGrupo;
    if (ultimo > base) {
      const c = comparar(base, ultimo);
      let ganho = 0;
      let recebidos = 0;
      for (let k = base + 1; k <= ultimo; k++) {
        ganho += serie.valor[k] - serie.valor[k - 1] - serie.fluxo[k];
        recebidos += serie.proventos[k];
      }
      if (c.carteira !== null) acumuladoMensal *= 1 + c.carteira / 100;
      mensal.push({
        mes: dias[ultimo].slice(0, 7),
        patrimonio: arredondar(serie.valor[ultimo]),
        ganhoDeCapital: arredondar(ganho),
        proventos: arredondar(recebidos),
        acumulado: pct(acumuladoMensal - 1),
        ...c,
      });
    }
    inicioDoGrupo = ultimo;
  }
  let inicioDoAno = i0;
  for (let i = i0 + 1; i <= fim + 1; i++) {
    const virouAno = i > fim || dias[i].slice(0, 4) !== dias[i - 1].slice(0, 4);
    if (!virouAno) continue;
    const ultimo = i - 1;
    if (ultimo > inicioDoAno) anual.push({ ano: Number(dias[ultimo].slice(0, 4)), ...comparar(inicioDoAno, ultimo) });
    inicioDoAno = ultimo;
  }

  // Extremos e estatísticas.
  let piorDia: { data: string; valor: number } | null = null;
  let melhorDia: { data: string; valor: number } | null = null;
  for (let i = i0 + 1; i <= fim; i++) {
    if (serie.valor[i - 1] < 1) continue;
    const v = pct(serie.retorno[i]) ?? 0;
    if (piorDia === null || v < piorDia.valor) piorDia = { data: dias[i], valor: v };
    if (melhorDia === null || v > melhorDia.valor) melhorDia = { data: dias[i], valor: v };
  }
  const mesesValidos = mensal.filter((m): m is typeof m & { carteira: number } => m.carteira !== null);
  const anosValidos = anual.filter((a): a is typeof a & { carteira: number } => a.carteira !== null);
  const menorDe = <T extends { carteira: number }>(lista: T[]): T | null => lista.reduce<T | null>((m, x) => (m === null || x.carteira < m.carteira ? x : m), null);
  const maiorDe = <T extends { carteira: number }>(lista: T[]): T | null => lista.reduce<T | null>((m, x) => (m === null || x.carteira > m.carteira ? x : m), null);
  const piorMes = menorDe(mesesValidos);
  const melhorMes = maiorDe(mesesValidos);
  const piorAno = menorDe(anosValidos);
  const melhorAno = maiorDe(anosValidos);
  const comCdi = mesesValidos.filter((m) => m.cdi !== null);

  // Classes e instituições.
  const porClasse = new Map<ClasseCarteira, number>();
  const porInstituicao = new Map<string, Ativo[]>();
  for (const a of ativos) {
    const classe = CLASSE_DO_TIPO[a.tipo];
    porClasse.set(classe, (porClasse.get(classe) ?? 0) + num(a.saldo));
    // "XP INVESTIMENTOS CCTVM S/A" e "...S/A." são a mesma corretora: junta pelo nome sem pontuação no fim.
    const nome = (a.instituicao ?? '').trim().replace(/[\s.,;]+$/, '') || 'Sem instituição';
    porInstituicao.set(nome, [...(porInstituicao.get(nome) ?? []), a]);
  }
  const baseDoAno = baseAntesDe(hoje.slice(0, 4) + '-01-01');
  const instituicoes = [...porInstituicao.entries()]
    .map(([nome, lista]) => {
      const s = serieDe(lista, dias, precos);
      const total = lista.reduce((soma, a) => soma + num(a.saldo), 0);
      const comeco = Math.max(0, s.valor.findIndex((v) => v >= 1));
      return {
        nome,
        saldo: arredondar(total),
        parte: parte(total, saldo),
        mes: pct(retornoNoIntervalo(s, Math.max(comeco, baseDoMes), fim)),
        ano: pct(retornoNoIntervalo(s, Math.max(comeco, baseDoAno), fim)),
        acumulada: pct(retornoNoIntervalo(s, comeco, fim)),
      };
    })
    .sort((a, b) => b.saldo - a.saldo);

  // Ativo por ativo.
  const linhasDeAtivos = ativos.map((a) => {
    const s = serieDe([a], dias, precos);
    const comeco = s.valor.findIndex((v) => v >= 1);
    const rentabilidade = comeco >= 0 ? retornoNoIntervalo(s, comeco, fim) : null;
    const cdi = comeco >= 0 ? retornoDoIndice(series.SELIC, dias[comeco], dias[fim]) : null;
    const quantidade = a.quantidade === null ? null : num(a.quantidade);
    const codigo = codigoDe(a);
    const precoDeHoje = codigo ? [...(precos.get(codigo)?.values() ?? [])].pop() ?? null : null;
    return {
      id: a.id,
      nome: a.nome,
      codigo: a.codigo,
      classe: ROTULO_CLASSE[CLASSE_DO_TIPO[a.tipo]],
      instituicao: a.instituicao,
      saldo: arredondar(num(a.saldo)),
      parte: parte(num(a.saldo), saldo),
      quantidade,
      precoMedio: quantidade !== null && quantidade > 0 ? arredondar(num(a.valorAplicado) / quantidade) : null,
      precoAtual: precoDeHoje === null ? null : arredondar(precoDeHoje),
      rentabilidade: pct(rentabilidade),
      percentualDoCdi: rentabilidade !== null && cdi !== null && cdi > 0 ? pct(rentabilidade / cdi) : null,
    };
  });

  const proventosTotais = serie.proventos.reduce((s, v) => s + v, 0);
  let ganhoNoMes = 0;
  for (let k = baseDoMes + 1; k <= fim; k++) ganhoNoMes += serie.valor[k] - serie.valor[k - 1] - serie.fluxo[k];
  const noMes = periodos[0];

  return {
    ...vazio,
    periodo: { meses: opcoes.meses, inicio: dias[i0] },
    resumo: {
      ...vazio.resumo,
      proventos: arredondar(proventosTotais),
      ganhoDeCapitalNoMes: arredondar(ganhoNoMes),
      rentabilidadeNoMes: noMes.carteira,
      cdiNoMes: noMes.cdi,
      ibovNoMes: noMes.ibov,
      percentualDoCdiNoMes: noMes.carteira !== null && noMes.cdi !== null && noMes.cdi > 0 ? Math.round((noMes.carteira / noMes.cdi) * 100) : null,
      rentabilidadeDoInicio: periodos[4].carteira,
    },
    periodos,
    diario,
    mensal,
    anual,
    extremos: {
      piorDia,
      melhorDia,
      piorMes: piorMes ? { mes: piorMes.mes, valor: piorMes.carteira } : null,
      melhorMes: melhorMes ? { mes: melhorMes.mes, valor: melhorMes.carteira } : null,
      piorAno: piorAno ? { ano: piorAno.ano, valor: piorAno.carteira } : null,
      melhorAno: melhorAno ? { ano: melhorAno.ano, valor: melhorAno.carteira } : null,
    },
    estatisticas: {
      mesesPositivos: mesesValidos.filter((m) => m.carteira > 0).length,
      mesesNegativos: mesesValidos.filter((m) => m.carteira < 0).length,
      mesesAcimaDoCdi: comCdi.filter((m) => m.carteira > (m.cdi ?? 0)).length,
      mesesAbaixoDoCdi: comCdi.filter((m) => m.carteira < (m.cdi ?? 0)).length,
      maior: melhorMes ? melhorMes.carteira : null,
      menor: piorMes ? piorMes.carteira : null,
      media: mesesValidos.length > 0 ? Math.round((mesesValidos.reduce((s, m) => s + m.carteira, 0) / mesesValidos.length) * 100) / 100 : null,
    },
    classes: [...porClasse.entries()]
      .map(([chave, total]) => ({ chave, rotulo: ROTULO_CLASSE[chave], saldo: arredondar(total), parte: parte(total, saldo) }))
      .sort((a, b) => b.saldo - a.saldo),
    instituicoes,
    ativos: linhasDeAtivos,
  };
}

// ---------- Patrimônio dos meses passados ----------

const estimativas = new Map<string, { em: number; valores: Map<string, number> }>();

// Patrimônio no último dia de cada mês pedido ('AAAA-MM'), reconstruído para os meses em que o sistema ainda não
// guardava a fotografia diária: investimentos pelo preço da época (quantidade do dia × fechamento), mais o saldo
// das contas voltando os lançamentos posteriores, menos as faturas que estavam fechadas e ainda não pagas.
// Só devolve os meses a partir do primeiro registro. Usa apenas o que já está gravado (não consulta a internet).
export async function patrimonioEstimado(meses: string[]): Promise<Map<string, number>> {
  const chaveDoCache = `${perfilAtual() ?? 0}|${meses.join(',')}`;
  const guardado = estimativas.get(chaveDoCache);
  if (guardado && Date.now() - guardado.em < 10 * 60 * 1000) return guardado.valores;

  const hoje = hojeISO();
  const [brutos, contas, transacoes, faturas] = await Promise.all([
    prisma.investimento.findMany({ where: { ativo: true }, include: { movimentos: true } }),
    prisma.conta.findMany({ where: { ativo: true, tipo: { not: 'CARTAO' } }, select: { id: true, tipo: true, saldo: true } }),
    prisma.transacao.findMany({ where: { conta: { ativo: true, tipo: { not: 'CARTAO' } } }, select: { contaId: true, data: true, tipo: true, valor: true } }),
    prisma.fatura.findMany({ where: { conta: { ativo: true } }, select: { total: true, fechamento: true, vencimento: true, pagaEm: true, status: true } }),
  ]);
  const eventos = await eventosDosAtivos(brutos.map((a) => a.id));
  const ativos: Ativo[] = brutos.map((a) => ({ ...a, eventos: eventos.get(a.id) ?? [] }));

  // Primeiro dia com algum registro: antes dele não há o que mostrar.
  let primeiro: string | null = null;
  const considerar = (data: string) => {
    if (primeiro === null || data < primeiro) primeiro = data;
  };
  for (const a of ativos) for (const m of a.movimentos) if (m.tipo === 'APLICACAO') considerar(dataISO(m.data));
  for (const t of transacoes) considerar(dataISO(t.data));
  for (const f of faturas) considerar(dataISO(f.fechamento ?? f.vencimento));
  const valores = new Map<string, number>();
  if (primeiro === null) return valores;
  const inicio: string = primeiro;

  // Eixo com todos os dias corridos (o preço do fim de semana é o da sexta).
  const dias: string[] = [];
  for (let d = inicio; d <= hoje; d = somarDias(d, 1)) dias.push(d);
  const codigos = [...new Set(ativos.map(codigoDe).filter((c): c is string => c !== null))];
  const serie = serieDe(ativos, dias, await carregarPrecos(codigos));
  const tipoDaConta = new Map(contas.map((c) => [c.id, c.tipo]));
  const saldoDasContas = contas.reduce((s, c) => s + num(c.saldo), 0);

  for (const mes of meses) {
    const ano = Number(mes.slice(0, 4));
    const numeroDoMes = Number(mes.slice(5, 7));
    const fimDoMes = new Date(Date.UTC(ano, numeroDoMes, 0)).toISOString().slice(0, 10);
    if (fimDoMes < inicio || fimDoMes >= hoje) continue;
    const investido = serie.valor[posicaoDoDia(dias, fimDoMes)] ?? 0;
    // Saldo das contas naquele dia = saldo de hoje menos o efeito do que aconteceu depois.
    let depois = 0;
    for (const t of transacoes) {
      if (dataISO(t.data) <= fimDoMes) continue;
      const tipo = tipoDaConta.get(t.contaId);
      if (tipo) depois += efeitoNoSaldo(tipo, t.tipo, num(t.valor));
    }
    // Dívida do cartão naquele dia: faturas já fechadas e ainda não pagas.
    let divida = 0;
    for (const f of faturas) {
      const quitada = f.pagaEm ? dataISO(f.pagaEm) : f.status === 'PAGA' ? dataISO(f.vencimento) : '9999-12-31';
      if (dataISO(f.fechamento ?? f.vencimento) <= fimDoMes && quitada > fimDoMes) divida += num(f.total);
    }
    valores.set(mes, arredondar(investido + saldoDasContas - depois - divida));
  }
  estimativas.set(chaveDoCache, { em: Date.now(), valores });
  return valores;
}

// ---------- Proventos ----------

export interface ProventosDTO {
  geradoEm: string;
  meses: number;
  total: number;
  mediaMensal: number;
  ultimosDozeMeses: number;
  rendimentoSobreOCusto: number | null; // proventos de 12 meses sobre o valor aplicado, em %
  historico: { mes: string; total: number }[];
  mapa: { meses: string[]; linhas: { id: number; rotulo: string; valores: number[]; total: number }[] };
  porAtivo: {
    id: number;
    rotulo: string;
    nome: string;
    tipo: TipoInvestimento;
    total: number;
    parte: number;
    pagamentos: number;
    ultimoValor: number | null;
    ultimaData: string | null;
    rendimentoSobreOCusto: number | null;
  }[];
  agenda: {
    esteMes: { recebido: number; previsto: number };
    proximosTresMeses: number;
    proximosDozeMeses: number;
    itens: { data: string; id: number; rotulo: string; valor: number; situacao: 'RECEBIDO' | 'PREVISTO' }[];
  };
}

function mesesAtras(mes: string, quantos: number): string {
  const total = Number(mes.slice(0, 4)) * 12 + Number(mes.slice(5, 7)) - 1 - quantos;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

function somarMesesNaData(data: string, meses: number): string {
  const ano = Number(data.slice(0, 4));
  const mes = Number(data.slice(5, 7)) - 1 + meses;
  const ultimoDia = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  return new Date(Date.UTC(ano, mes, Math.min(Number(data.slice(8, 10)), ultimoDia))).toISOString().slice(0, 10);
}

export async function montarProventos(meses: number): Promise<ProventosDTO> {
  const hoje = hojeISO();
  const mesAtual = hoje.slice(0, 7);
  const ativos = await prisma.investimento.findMany({
    where: { ativo: true },
    include: { movimentos: { where: { tipo: 'RENDIMENTO' }, orderBy: { data: 'asc' } } },
  });
  const pagadores = ativos.filter((a) => codigoDe(a) !== null);
  const primeiroMes = meses > 0 ? mesesAtras(mesAtual, meses - 1) : null;
  const umAnoAtras = somarDias(hoje, -365);

  const porMes = new Map<string, number>();
  const mesesDoMapa = Array.from({ length: 12 }, (_, i) => mesesAtras(mesAtual, 11 - i));
  const itens: ProventosDTO['agenda']['itens'] = [];
  const porAtivo: ProventosDTO['porAtivo'] = [];
  const linhasDoMapa: ProventosDTO['mapa']['linhas'] = [];
  let total = 0;
  let dozeMeses = 0;
  let aplicado = 0;

  for (const a of pagadores) {
    const rotulo = a.codigo ?? a.nome;
    let totalDoAtivo = 0;
    let pagamentos = 0;
    let dozeDoAtivo = 0;
    const valores = mesesDoMapa.map(() => 0);
    const recentes: { data: string; valor: number }[] = [];
    for (const m of a.movimentos) {
      const data = dataISO(m.data);
      if (data > hoje) continue; // lançamento com data futura não é provento recebido
      const valor = num(m.valor);
      const mes = data.slice(0, 7);
      if (data > umAnoAtras && data <= hoje) {
        dozeDoAtivo += valor;
        recentes.push({ data, valor });
        itens.push({ data, id: a.id, rotulo, valor: arredondar(valor), situacao: 'RECEBIDO' });
      }
      const noMapa = mesesDoMapa.indexOf(mes);
      if (noMapa >= 0) valores[noMapa] += valor;
      if (primeiroMes !== null && mes < primeiroMes) continue;
      porMes.set(mes, (porMes.get(mes) ?? 0) + valor);
      totalDoAtivo += valor;
      pagamentos++;
    }
    total += totalDoAtivo;
    dozeMeses += dozeDoAtivo;
    aplicado += num(a.valorAplicado);
    const ultimo = a.movimentos[a.movimentos.length - 1];
    if (totalDoAtivo > 0 || dozeDoAtivo > 0) {
      porAtivo.push({
        id: a.id,
        rotulo,
        nome: a.nome,
        tipo: a.tipo,
        total: arredondar(totalDoAtivo),
        parte: 0,
        pagamentos,
        ultimoValor: ultimo ? arredondar(num(ultimo.valor)) : null,
        ultimaData: ultimo ? dataISO(ultimo.data) : null,
        rendimentoSobreOCusto: num(a.valorAplicado) > 0 ? pct(dozeDoAtivo / num(a.valorAplicado)) : null,
      });
      linhasDoMapa.push({ id: a.id, rotulo, valores: valores.map(arredondar), total: arredondar(valores.reduce((s, v) => s + v, 0)) });
    }

    // Agenda estimada: quem pagou quase todo mês repete o último valor todo mês; os demais repetem o calendário
    // do último ano. Só para ativos que ainda estão na carteira.
    if (num(a.quantidade) <= 0 || recentes.length === 0) continue;
    const mesesComPagamento = new Set(recentes.map((r) => r.data.slice(0, 7))).size;
    const jaPagouEsteMes = recentes.some((r) => r.data.slice(0, 7) === mesAtual);
    if (mesesComPagamento >= 9) {
      const ultimos = recentes.slice(-3);
      const valor = ultimos.reduce((s, r) => s + r.valor, 0) / ultimos.length;
      const dia = recentes[recentes.length - 1].data.slice(8, 10);
      for (let k = jaPagouEsteMes ? 1 : 0; k <= 12; k++) {
        const data = somarMesesNaData(`${mesAtual}-${dia}`, k);
        if (data <= hoje) continue;
        itens.push({ data, id: a.id, rotulo, valor: arredondar(valor), situacao: 'PREVISTO' });
      }
    } else {
      for (const r of recentes) {
        const data = somarMesesNaData(r.data, 12);
        // Quem já pagou neste mês não tem outro pagamento previsto para o mesmo mês.
        if (jaPagouEsteMes && data.slice(0, 7) === mesAtual) continue;
        if (data > hoje) itens.push({ data, id: a.id, rotulo, valor: arredondar(r.valor), situacao: 'PREVISTO' });
      }
    }
  }

  for (const p of porAtivo) p.parte = parte(p.total, total);
  porAtivo.sort((a, b) => b.total - a.total);
  linhasDoMapa.sort((a, b) => b.total - a.total);
  itens.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));

  const mesesDoHistorico: string[] = [];
  const mesesComDados = [...porMes.keys()].sort();
  const inicioDoHistorico = primeiroMes ?? mesesComDados[0] ?? mesAtual;
  for (let m = inicioDoHistorico; m <= mesAtual; m = mesesAtras(m, -1)) mesesDoHistorico.push(m);
  const previstoAte = (limite: string) => itens.filter((i) => i.situacao === 'PREVISTO' && i.data <= limite).reduce((s, i) => s + i.valor, 0);
  const doMes = itens.filter((i) => i.data.slice(0, 7) === mesAtual);

  return {
    geradoEm: new Date().toISOString(),
    meses,
    total: arredondar(total),
    mediaMensal: arredondar(mesesDoHistorico.length > 0 ? total / mesesDoHistorico.length : 0),
    ultimosDozeMeses: arredondar(dozeMeses),
    rendimentoSobreOCusto: aplicado > 0 ? pct(dozeMeses / aplicado) : null,
    historico: mesesDoHistorico.map((mes) => ({ mes, total: arredondar(porMes.get(mes) ?? 0) })),
    mapa: { meses: mesesDoMapa, linhas: linhasDoMapa },
    porAtivo,
    agenda: {
      esteMes: {
        recebido: arredondar(doMes.filter((i) => i.situacao === 'RECEBIDO').reduce((s, i) => s + i.valor, 0)),
        previsto: arredondar(doMes.filter((i) => i.situacao === 'PREVISTO').reduce((s, i) => s + i.valor, 0)),
      },
      proximosTresMeses: arredondar(previstoAte(somarMesesNaData(hoje, 3))),
      proximosDozeMeses: arredondar(previstoAte(somarMesesNaData(hoje, 12))),
      itens,
    },
  };
}
