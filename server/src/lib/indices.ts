// Índices de referência: Selic, IPCA, Ibovespa e IFIX.
// Fontes públicas, sem cadastro:
//   Selic (série 11, taxa diária) e IPCA (série 433, variação mensal): API de séries do Banco Central.
//   Ibovespa e IFIX: estatísticas históricas do site da B3 (um pedido por ano). Para o Ibovespa, o Yahoo Finance
//   serve de reserva quando a B3 não responde.
// Cada ponto é gravado como NÍVEL ACUMULADO: o retorno entre duas datas é nivel(fim) / nivel(inicio) - 1.
// Selic: o ponto do dia D vale o nível no fim do dia D. IPCA: o ponto fica no último dia do mês de referência.

import { prisma } from './prisma';

export const INDICES = ['SELIC', 'IPCA', 'IBOV', 'IFIX'] as const;
export type Indice = (typeof INDICES)[number];

export const ROTULO_INDICE: Record<Indice, string> = {
  SELIC: 'Selic',
  IPCA: 'IPCA (inflação)',
  IBOV: 'Ibovespa',
  IFIX: 'IFIX',
};

// Antes destas datas a série não existe (ou não interessa): não adianta pedir.
const PISO: Record<Indice, string> = {
  SELIC: '2000-01-01',
  IPCA: '2000-01-01',
  IBOV: '2000-01-01',
  IFIX: '2011-01-01',
};

const TEMPO_LIMITE_MS = 20000;
const VALIDADE_MS = 12 * 60 * 60 * 1000;
const NAVEGADOR = { 'User-Agent': 'Mozilla/5.0 (compatible; financas-pessoais)' };

export interface Serie {
  indice: Indice;
  datas: string[]; // 'AAAA-MM-DD', em ordem crescente
  valores: number[];
}

interface Ponto {
  data: string;
  valor: number;
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function somarDias(data: string, dias: number): string {
  return iso(new Date(new Date(data + 'T00:00:00Z').getTime() + dias * 86400000));
}

function hojeISO(): string {
  // Dia no fuso de Brasília.
  return iso(new Date(Date.now() - 3 * 60 * 60 * 1000));
}

async function buscarJSON(url: string): Promise<unknown> {
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), TEMPO_LIMITE_MS);
  try {
    const resposta = await fetch(url, { headers: NAVEGADOR, signal: controle.signal });
    if (!resposta.ok) throw new Error('resposta ' + resposta.status);
    return await resposta.json();
  } finally {
    clearTimeout(relogio);
  }
}

function pausa(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------- Banco Central ----------

function dataBR(data: string): string {
  return data.slice(8, 10) + '/' + data.slice(5, 7) + '/' + data.slice(0, 4);
}

// Variações percentuais de uma série do Banco Central entre duas datas (janelas de até 5 anos por pedido).
async function variacoesBCB(serie: number, de: string, ate: string): Promise<Ponto[]> {
  const pontos: Ponto[] = [];
  let inicio = de;
  while (inicio <= ate) {
    const fimDaJanela = somarDias(inicio, 5 * 365);
    const fim = fimDaJanela < ate ? fimDaJanela : ate;
    const url =
      `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${serie}/dados?formato=json` +
      `&dataInicial=${encodeURIComponent(dataBR(inicio))}&dataFinal=${encodeURIComponent(dataBR(fim))}`;
    let corpo: unknown;
    try {
      corpo = await buscarJSON(url);
    } catch (erro) {
      // O Banco Central responde 404 quando não há valores na janela.
      if (erro instanceof Error && erro.message === 'resposta 404') corpo = [];
      else throw erro;
    }
    if (Array.isArray(corpo)) {
      for (const linha of corpo as { data?: unknown; valor?: unknown }[]) {
        if (typeof linha.data !== 'string' || !/^\d{2}\/\d{2}\/\d{4}$/.test(linha.data)) continue;
        const valor = Number(linha.valor);
        if (!Number.isFinite(valor)) continue;
        pontos.push({ data: linha.data.slice(6, 10) + '-' + linha.data.slice(3, 5) + '-' + linha.data.slice(0, 2), valor });
      }
    }
    inicio = somarDias(fim, 1);
    if (inicio <= ate) await pausa(200);
  }
  return pontos;
}

function ultimoDiaDoMes(data: string): string {
  const ano = Number(data.slice(0, 4));
  const mes = Number(data.slice(5, 7));
  return iso(new Date(Date.UTC(ano, mes, 0)));
}

// Transforma variações percentuais em nível acumulado, continuando de um nível já gravado.
function acumular(variacoes: Ponto[], nivelInicial: number, noFimDoMes: boolean): Ponto[] {
  let nivel = nivelInicial;
  return variacoes.map((v) => {
    nivel *= 1 + v.valor / 100;
    return { data: noFimDoMes ? ultimoDiaDoMes(v.data) : v.data, valor: nivel };
  });
}

// ---------- B3 e Yahoo ----------

function numeroBR(texto: unknown): number | null {
  if (typeof texto !== 'string') return null;
  const n = Number(texto.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Fechamento diário de um índice da B3 em um ano.
async function fechamentosB3(indice: 'IBOV' | 'IFIX', ano: number): Promise<Ponto[]> {
  const parametro = Buffer.from(JSON.stringify({ index: indice, language: 'pt-br', year: String(ano) })).toString('base64');
  const corpo = (await buscarJSON(
    'https://sistemaswebb3-listados.b3.com.br/indexStatisticsProxy/IndexCall/GetPortfolioDay/' + parametro
  )) as { results?: Record<string, unknown>[] } | null;
  const pontos: Ponto[] = [];
  for (const linha of corpo?.results ?? []) {
    const dia = Number(linha.day);
    if (!Number.isInteger(dia) || dia < 1 || dia > 31) continue;
    for (let mes = 1; mes <= 12; mes++) {
      const valor = numeroBR(linha['rateValue' + mes]);
      if (valor === null) continue;
      pontos.push({ data: `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`, valor });
    }
  }
  return pontos.sort((a, b) => (a.data < b.data ? -1 : 1));
}

async function fechamentosYahoo(simbolo: string, de: string, ate: string): Promise<Ponto[]> {
  const inicio = Math.floor(new Date(de + 'T00:00:00Z').getTime() / 1000);
  const fim = Math.floor(new Date(ate + 'T23:59:59Z').getTime() / 1000);
  const corpo = (await buscarJSON(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(simbolo)}?period1=${inicio}&period2=${fim}&interval=1d`
  )) as { chart?: { result?: { timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }[] } } | null;
  const resultado = corpo?.chart?.result?.[0];
  const instantes = resultado?.timestamp ?? [];
  const fechamentos = resultado?.indicators?.quote?.[0]?.close ?? [];
  const porDia = new Map<string, number>();
  instantes.forEach((instante, i) => {
    const valor = fechamentos[i];
    if (typeof valor === 'number' && Number.isFinite(valor) && valor > 0) {
      porDia.set(iso(new Date((instante - 3 * 3600) * 1000)), valor);
    }
  });
  return [...porDia.entries()].map(([data, valor]) => ({ data, valor })).sort((a, b) => (a.data < b.data ? -1 : 1));
}

async function fechamentosDaBolsa(indice: 'IBOV' | 'IFIX', de: string, ate: string): Promise<Ponto[]> {
  try {
    const pontos: Ponto[] = [];
    for (let ano = Number(de.slice(0, 4)); ano <= Number(ate.slice(0, 4)); ano++) {
      pontos.push(...(await fechamentosB3(indice, ano)));
      await pausa(250);
    }
    const noPeriodo = pontos.filter((p) => p.data >= de && p.data <= ate);
    if (noPeriodo.length > 0 || indice === 'IFIX') return noPeriodo;
    throw new Error('sem dados');
  } catch (erro) {
    if (indice !== 'IBOV') throw erro;
    return fechamentosYahoo('^BVSP', de, ate);
  }
}

// ---------- Gravação e leitura ----------

const ultimaTentativa = new Map<Indice, number>();
const memoria = new Map<Indice, Serie>();

async function gravar(indice: Indice, pontos: Ponto[]): Promise<void> {
  for (let i = 0; i < pontos.length; i += 2000) {
    await prisma.indicePonto.createMany({
      data: pontos.slice(i, i + 2000).map((p) => ({ indice, data: new Date(p.data + 'T00:00:00Z'), valor: p.valor })),
      skipDuplicates: true,
    });
  }
  memoria.delete(indice);
}

async function atualizarUm(indice: Indice, desde: string): Promise<void> {
  const inicioDesejado = desde > PISO[indice] ? desde : PISO[indice];
  const hoje = hojeISO();
  const [primeiro, ultimo] = await Promise.all([
    prisma.indicePonto.findFirst({ where: { indice }, orderBy: { data: 'asc' } }),
    prisma.indicePonto.findFirst({ where: { indice }, orderBy: { data: 'desc' } }),
  ]);
  // Se o que está gravado começa depois do necessário, recomeça do zero para o nível acumulado ficar contínuo.
  const faltaPassado = !primeiro || iso(primeiro.data) > somarDias(inicioDesejado, 45);

  if (indice === 'SELIC' || indice === 'IPCA') {
    const serie = indice === 'SELIC' ? 11 : 433;
    const mensal = indice === 'IPCA';
    if (faltaPassado || !ultimo) {
      const variacoes = await variacoesBCB(serie, inicioDesejado, hoje);
      if (variacoes.length === 0) throw new Error('sem dados');
      await prisma.indicePonto.deleteMany({ where: { indice } });
      await gravar(indice, acumular(variacoes, 1, mensal));
      return;
    }
    const variacoes = await variacoesBCB(serie, somarDias(iso(ultimo.data), 1), hoje);
    await gravar(indice, acumular(variacoes, ultimo.valor, mensal));
    return;
  }

  if (faltaPassado || !ultimo) {
    const pontos = await fechamentosDaBolsa(indice, inicioDesejado, hoje);
    if (pontos.length === 0) throw new Error('sem dados');
    await prisma.indicePonto.deleteMany({ where: { indice } });
    await gravar(indice, pontos);
    return;
  }
  const novos = await fechamentosDaBolsa(indice, somarDias(iso(ultimo.data), 1), hoje);
  await gravar(indice, novos);
}

export interface ResultadoIndices {
  erros: string[]; // um texto por índice que não pôde ser atualizado
}

let emAndamento: Promise<ResultadoIndices> | null = null;

// Garante que os quatro índices estão gravados a partir de `desde` ('AAAA-MM-DD') e atualizados.
// Cada índice é consultado na fonte no máximo uma vez a cada 12 horas, a não ser com `forcar`.
// Nunca lança: o que falhar volta em `erros` e o cálculo segue com o que já estiver gravado.
export function garantirIndices(desde: string, forcar = false): Promise<ResultadoIndices> {
  if (emAndamento) return emAndamento;
  emAndamento = (async () => {
    const erros: string[] = [];
    for (const indice of INDICES) {
      const ultima = ultimaTentativa.get(indice) ?? 0;
      const primeiro = await prisma.indicePonto.findFirst({ where: { indice }, orderBy: { data: 'asc' } });
      const inicioDesejado = desde > PISO[indice] ? desde : PISO[indice];
      const faltaPassado = !primeiro || iso(primeiro.data) > somarDias(inicioDesejado, 45);
      if (!forcar && !faltaPassado && Date.now() - ultima < VALIDADE_MS) continue;
      // Depois de uma falha, espera 10 minutos antes de tentar a mesma fonte de novo.
      if (!forcar && faltaPassado && Date.now() - ultima < 10 * 60 * 1000) {
        erros.push(`Não consegui buscar o índice ${ROTULO_INDICE[indice]}.`);
        continue;
      }
      ultimaTentativa.set(indice, Date.now());
      try {
        await atualizarUm(indice, desde);
      } catch (erro) {
        console.error(`Falha ao atualizar o índice ${indice}:`, erro instanceof Error ? erro.message : erro);
        erros.push(`Não consegui atualizar o índice ${ROTULO_INDICE[indice]}; usei o que já estava gravado.`);
      }
    }
    return { erros };
  })().finally(() => {
    emAndamento = null;
  });
  return emAndamento;
}

export async function carregarSerie(indice: Indice): Promise<Serie> {
  const guardada = memoria.get(indice);
  if (guardada) return guardada;
  const pontos = await prisma.indicePonto.findMany({ where: { indice }, orderBy: { data: 'asc' } });
  const serie: Serie = { indice, datas: pontos.map((p) => iso(p.data)), valores: pontos.map((p) => p.valor) };
  memoria.set(indice, serie);
  return serie;
}

export async function carregarSeries(): Promise<Record<Indice, Serie>> {
  const [SELIC, IPCA, IBOV, IFIX] = await Promise.all(INDICES.map(carregarSerie));
  return { SELIC, IPCA, IBOV, IFIX };
}

// Posição do último ponto com data <= `data`; -1 quando a série começa depois.
export function posicaoEm(serie: Serie, data: string): number {
  let inicio = 0;
  let fim = serie.datas.length - 1;
  let achado = -1;
  while (inicio <= fim) {
    const meio = (inicio + fim) >> 1;
    if (serie.datas[meio] <= data) {
      achado = meio;
      inicio = meio + 1;
    } else {
      fim = meio - 1;
    }
  }
  return achado;
}

// Nível do índice em uma data (o último conhecido até ela). Antes do começo da série, usa o primeiro ponto.
export function nivelEm(serie: Serie, data: string): number | null {
  if (serie.datas.length === 0) return null;
  const i = posicaoEm(serie, data);
  return serie.valores[i < 0 ? 0 : i];
}

// Quanto 1 real vira entre duas datas seguindo o índice. null quando a série está vazia.
export function fatorEntre(serie: Serie, de: string, ate: string): number | null {
  const inicio = nivelEm(serie, de);
  const fim = nivelEm(serie, ate);
  if (inicio === null || fim === null || inicio <= 0) return null;
  return fim / inicio;
}

// Dias úteis no intervalo (de, ate]: a Selic tem um ponto por dia útil.
export function diasUteisEntre(selic: Serie, de: string, ate: string): number {
  if (selic.datas.length === 0) {
    const dias = (new Date(ate + 'T00:00:00Z').getTime() - new Date(de + 'T00:00:00Z').getTime()) / 86400000;
    return Math.max(0, Math.round((dias * 252) / 365));
  }
  return Math.max(0, posicaoEm(selic, ate) - posicaoEm(selic, de));
}

export { hojeISO, somarDias };
