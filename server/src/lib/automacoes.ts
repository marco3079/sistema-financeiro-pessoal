// Automações: condições + ação aplicadas aos lançamentos do perfil financeiro (ver docs/plano/lote5-automacoes.md).
// Precisa rodar dentro do perfil financeiro (comPerfil). Lê os candidatos uma vez e casa tudo em memória.
// Um lançamento usado por uma automação não é usado por outra na mesma rodada.

import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from './prisma';
import { arredondar, dataISO, num } from './financas';

const DIA_MS = 24 * 60 * 60 * 1000;
const FOLGA_VALOR = 0.005;
const TAMANHO_LOTE = 1000;

export const TIPOS_AUTOMACAO = ['PAR_CONTAS', 'PAR_MESMA_CONTA', 'FATURA', 'INVESTIMENTO', 'ESTORNO', 'TEXTO', 'COMBINADA'] as const;
export type TipoAutomacao = (typeof TIPOS_AUTOMACAO)[number];
export const ACOES_AUTOMACAO = ['TRANSFERENCIA', 'CATEGORIA', 'ESCONDER'] as const;
export type AcaoAutomacao = (typeof ACOES_AUTOMACAO)[number];

// Condições (todos os campos são opcionais).
export interface ConfigAutomacao {
  contaIds?: number[]; // limita a estas contas (vazio ou ausente = todas)
  tipoLancamento?: 'RECEITA' | 'DESPESA'; // só TEXTO e COMBINADA
  textos?: string[]; // a descrição contém QUALQUER um (sem acento, sem maiúsculas)
  textosEntrada?: string[]; // nos pares: exigido da perna de entrada (RECEITA)
  textosSaida?: string[]; // nos pares: exigido da perna de saída (DESPESA)
  valorMin?: number; // >= 0
  valorMax?: number; // >= valorMin
  diasMax?: number; // inteiro 0..60
  tolerancia?: number; // diferença de valor aceita, em reais, 0..5
}

const trechoSchema = z
  .string()
  .trim()
  .min(2, 'Cada trecho precisa ter de 2 a 60 caracteres')
  .max(60, 'Cada trecho precisa ter de 2 a 60 caracteres');
const trechosSchema = z.array(trechoSchema).max(20, 'No máximo 20 trechos de texto');

// Formato de config (strict: campo desconhecido é erro).
export const configSchema: z.ZodType<ConfigAutomacao> = z
  .strictObject({
    contaIds: z.array(z.number().int().positive()).optional(),
    tipoLancamento: z.enum(['RECEITA', 'DESPESA']).optional(),
    textos: trechosSchema.optional(),
    textosEntrada: trechosSchema.optional(),
    textosSaida: trechosSchema.optional(),
    valorMin: z.number().finite().min(0).optional(),
    valorMax: z.number().finite().min(0).optional(),
    diasMax: z.number().int().min(0).max(60).optional(),
    tolerancia: z.number().finite().min(0).max(5).optional(),
  })
  .refine(
    (c) => c.valorMin === undefined || c.valorMax === undefined || c.valorMax >= c.valorMin,
    'O valor máximo precisa ser maior ou igual ao valor mínimo'
  );

export interface LancamentoProposto {
  id: number;
  data: string;
  descricao: string;
  valor: number;
  tipo: 'RECEITA' | 'DESPESA';
  contaNome: string;
}

// Um grupo de 1 ou 2 lançamentos que a automação faria.
export interface Proposta {
  automacaoId: number;
  automacaoNome: string;
  acao: string;
  lancamentos: LancamentoProposto[];
}

export interface OpcoesAvaliacao {
  desde?: Date;
  automacaoId?: number;
  incluirInativas?: boolean;
}

export interface ResultadoAplicacao {
  aplicados: number;
  porAutomacao: { id: number; nome: string; lancamentos: number }[];
}

// Dias padrão por tipo quando diasMax não é informado.
const DIAS_PADRAO: Record<TipoAutomacao, number> = {
  PAR_CONTAS: 1,
  PAR_MESMA_CONTA: 2,
  FATURA: 5,
  INVESTIMENTO: 3,
  ESTORNO: 30,
  TEXTO: 0,
  COMBINADA: 0,
};

// Conjunto padrão (chave = padrao da automação).
const CONJUNTO_PADRAO: {
  chave: string;
  nome: string;
  tipo: TipoAutomacao;
  acao: AcaoAutomacao;
  config: ConfigAutomacao;
  ativa: boolean;
}[] = [
  {
    chave: 'pix-no-credito',
    nome: 'Pix pago no crédito',
    tipo: 'PAR_MESMA_CONTA',
    acao: 'TRANSFERENCIA',
    config: { textosEntrada: ['valor adicionado'], diasMax: 2 },
    ativa: true,
  },
  {
    chave: 'pagamento-de-fatura',
    nome: 'Pagamento de fatura',
    tipo: 'FATURA',
    acao: 'TRANSFERENCIA',
    config: { textos: ['pagamento de fatura', 'pagamento da fatura', 'pgto fatura', 'pagto fatura'], diasMax: 5 },
    ativa: true,
  },
  {
    chave: 'entre-contas',
    nome: 'Transferência entre minhas contas',
    tipo: 'PAR_CONTAS',
    acao: 'TRANSFERENCIA',
    config: { diasMax: 1 },
    ativa: true,
  },
  {
    chave: 'investimentos',
    nome: 'Aplicação e resgate de investimento',
    tipo: 'INVESTIMENTO',
    acao: 'TRANSFERENCIA',
    config: { diasMax: 3 },
    ativa: false,
  },
  {
    chave: 'estorno',
    nome: 'Compra e estorno',
    tipo: 'ESTORNO',
    acao: 'TRANSFERENCIA',
    config: { diasMax: 30 },
    ativa: false,
  },
];

// ---------- Auxiliares ----------

export function ehTipo(valor: string): valor is TipoAutomacao {
  return (TIPOS_AUTOMACAO as readonly string[]).includes(valor);
}

export function ehAcao(valor: string): valor is AcaoAutomacao {
  return (ACOES_AUTOMACAO as readonly string[]).includes(valor);
}

// Config salva no banco -> objeto validado (ou {} se estiver inválida).
export function lerConfig(valor: unknown): ConfigAutomacao {
  const lido = configSchema.safeParse(valor);
  return lido.success ? lido.data : {};
}

// Tem pelo menos uma condição preenchida (exigido pela COMBINADA).
export function temCondicao(config: ConfigAutomacao): boolean {
  return (
    (config.contaIds ?? []).length > 0 ||
    config.tipoLancamento !== undefined ||
    (config.textos ?? []).length > 0 ||
    config.valorMin !== undefined ||
    config.valorMax !== undefined
  );
}

function semAcento(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function palavrasDe(descNorm: string): string[] {
  return descNorm.split(/[^a-z0-9]+/).filter((p) => p !== '');
}

function diasEntre(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / DIA_MS);
}

// Descrição contém algum dos trechos (lista vazia ou ausente = nenhum).
function contem(descNorm: string, trechos: string[] | undefined): boolean {
  return (trechos ?? []).some((t) => descNorm.includes(semAcento(t)));
}

// Filtro opcional: sem lista, passa; com lista, precisa conter um.
function atende(descNorm: string, trechos: string[] | undefined): boolean {
  return (trechos ?? []).length === 0 || contem(descNorm, trechos);
}

// Primeira posição de uma lista ordenada por valor com valor >= `valor`.
function primeiroAPartirDe<T extends { valor: number }>(lista: T[], valor: number): number {
  let lo = 0;
  let hi = lista.length;
  while (lo < hi) {
    const meio = (lo + hi) >> 1;
    if (lista[meio].valor < valor) lo = meio + 1;
    else hi = meio;
  }
  return lo;
}

// Descrições "parecidas": a primeira palavra com 4+ letras de uma aparece na outra.
function parecidas(a: Lancamento, b: Lancamento): boolean {
  const primeiraA = a.palavras.find((p) => p.length >= 4);
  const primeiraB = b.palavras.find((p) => p.length >= 4);
  return (
    (primeiraA !== undefined && b.palavras.includes(primeiraA)) ||
    (primeiraB !== undefined && a.palavras.includes(primeiraB))
  );
}

// ---------- Motor ----------

interface Lancamento {
  id: number;
  data: Date;
  descricao: string;
  descNorm: string;
  palavras: string[];
  valor: number;
  tipo: 'RECEITA' | 'DESPESA';
  contaId: number;
  contaNome: string;
  cartao: boolean;
  transferencia: boolean;
  categoriaId: number | null;
}

interface Movimento {
  id: number;
  tipo: string;
  valor: number;
  data: Date;
}

interface Contexto {
  faturas: { total: number; vencimento: Date }[];
  movimentos: Movimento[]; // ordenados por valor
}

type Grupo = Lancamento[];

interface Valida {
  id: number;
  nome: string;
  tipo: TipoAutomacao;
  acao: AcaoAutomacao;
  categoriaId: number | null;
  config: ConfigAutomacao;
}

interface PropostaInterna extends Proposta {
  categoriaId: number | null;
}

// Pares (uma perna de cada lado) por valor próximo e dentro de `aceita`; cada lançamento entra em no máximo um par.
// Entre os candidatos, vale o de menor `dias` e, no empate, o de menor id.
function parear(
  esquerdos: Lancamento[],
  direitos: Lancamento[],
  tol: number,
  aceita: (e: Lancamento, d: Lancamento) => number | null
): Grupo[] {
  const ordenados = [...direitos].sort((x, y) => x.valor - y.valor || x.id - y.id);
  const candidatos: { e: Lancamento; d: Lancamento; dias: number }[] = [];
  for (const e of esquerdos) {
    for (let i = primeiroAPartirDe(ordenados, e.valor - tol - FOLGA_VALOR); i < ordenados.length; i++) {
      const d = ordenados[i];
      if (d.valor > e.valor + tol + FOLGA_VALOR) break;
      if (Math.abs(e.valor - d.valor) > tol + FOLGA_VALOR) continue;
      const dias = aceita(e, d);
      if (dias !== null) candidatos.push({ e, d, dias });
    }
  }
  candidatos.sort((p, q) => p.dias - q.dias || p.e.id - q.e.id || p.d.id - q.d.id);
  const usados = new Set<number>();
  const grupos: Grupo[] = [];
  for (const c of candidatos) {
    if (usados.has(c.e.id) || usados.has(c.d.id)) continue;
    usados.add(c.e.id);
    usados.add(c.d.id);
    grupos.push([c.e, c.d]);
  }
  return grupos;
}

// Lançamento (aplicação ou resgate) casado com um movimento de investimento de mesmo valor, dentro de `diasMax`.
function casarMovimentos(alvos: Lancamento[], movimentos: Movimento[], tol: number, diasMax: number): Grupo[] {
  const candidatos: { l: Lancamento; m: Movimento; dias: number }[] = [];
  for (const l of alvos) {
    const tipoMovimento = l.tipo === 'DESPESA' ? 'APLICACAO' : 'RESGATE';
    for (let i = primeiroAPartirDe(movimentos, l.valor - tol - FOLGA_VALOR); i < movimentos.length; i++) {
      const m = movimentos[i];
      if (m.valor > l.valor + tol + FOLGA_VALOR) break;
      if (m.tipo !== tipoMovimento || Math.abs(m.valor - l.valor) > tol + FOLGA_VALOR) continue;
      const dias = Math.abs(diasEntre(l.data, m.data));
      if (dias <= diasMax) candidatos.push({ l, m, dias });
    }
  }
  candidatos.sort((a, b) => a.dias - b.dias || a.l.id - b.l.id || a.m.id - b.m.id);
  const usadosMov = new Set<number>();
  const usadosLanc = new Set<number>();
  const grupos: Grupo[] = [];
  for (const c of candidatos) {
    if (usadosMov.has(c.m.id) || usadosLanc.has(c.l.id)) continue;
    usadosMov.add(c.m.id);
    usadosLanc.add(c.l.id);
    grupos.push([c.l]);
  }
  return grupos;
}

// Aplica a regra do tipo sobre os lançamentos que sobraram para esta automação.
function casar(tipo: TipoAutomacao, pool: Lancamento[], config: ConfigAutomacao, ctx: Contexto): Grupo[] {
  const tol = config.tolerancia ?? 0;
  const diasMax = config.diasMax ?? DIAS_PADRAO[tipo];
  const despesas = pool.filter((l) => l.tipo === 'DESPESA');
  const receitas = pool.filter((l) => l.tipo === 'RECEITA');

  switch (tipo) {
    case 'PAR_CONTAS':
      return parear(
        despesas.filter((l) => !l.cartao && atende(l.descNorm, config.textosSaida)),
        receitas.filter((l) => !l.cartao && atende(l.descNorm, config.textosEntrada)),
        tol,
        (e, d) => {
          if (e.contaId === d.contaId) return null;
          const dias = Math.abs(diasEntre(e.data, d.data));
          return dias <= diasMax ? dias : null;
        }
      );

    case 'PAR_MESMA_CONTA':
      return parear(
        despesas.filter((l) => !l.cartao && atende(l.descNorm, config.textosSaida)),
        receitas.filter((l) => !l.cartao && atende(l.descNorm, config.textosEntrada)),
        tol,
        (e, d) => {
          if (e.contaId !== d.contaId) return null;
          // Entrada e saída a até diasMax dias uma da outra, em qualquer ordem: no arquivo do banco o crédito do
          // cartão vem no mesmo dia do Pix, mas pelo Open Finance ele às vezes chega um dia depois.
          const dias = Math.abs(diasEntre(d.data, e.data));
          return dias <= diasMax ? dias : null;
        }
      );

    case 'ESTORNO':
      return parear(despesas, receitas, tol, (e, d) => {
        if (e.contaId !== d.contaId) return null;
        // A receita (estorno) vem de 0 a diasMax dias depois da despesa.
        const dias = diasEntre(e.data, d.data);
        return dias >= 0 && dias <= diasMax && parecidas(e, d) ? dias : null;
      });

    case 'FATURA': {
      // (c) Despesa numa conta comum + receita de um cartão, de mesmo valor: primeiro os pares.
      const pares = parear(
        despesas.filter((l) => !l.cartao),
        receitas.filter((l) => l.cartao),
        tol,
        (e, d) => {
          const dias = Math.abs(diasEntre(e.data, d.data));
          return dias <= diasMax ? dias : null;
        }
      );
      const nosPares = new Set(pares.flat().map((l) => l.id));
      // (a) descrição contém um dos trechos, ou (b) valor igual ao total de uma fatura de cartão no prazo.
      const sozinhos = despesas
        .filter((l) => !l.cartao && !nosPares.has(l.id))
        .filter(
          (l) =>
            contem(l.descNorm, config.textos) ||
            ctx.faturas.some(
              (f) =>
                f.total > 0 &&
                Math.abs(f.total - l.valor) <= tol + FOLGA_VALOR &&
                Math.abs(diasEntre(l.data, f.vencimento)) <= diasMax
            )
        );
      return [...pares, ...sozinhos.map((l): Grupo => [l])];
    }

    case 'INVESTIMENTO':
      return casarMovimentos(
        pool.filter((l) => !l.cartao && atende(l.descNorm, config.textos)),
        ctx.movimentos,
        tol,
        diasMax
      );

    case 'TEXTO':
      return pool
        .filter((l) => contem(l.descNorm, config.textos) && (!config.tipoLancamento || l.tipo === config.tipoLancamento))
        .map((l): Grupo => [l]);

    case 'COMBINADA':
      if (!temCondicao(config)) return [];
      return pool
        .filter((l) => (!config.tipoLancamento || l.tipo === config.tipoLancamento) && atende(l.descNorm, config.textos))
        .map((l): Grupo => [l]);

    default:
      return [];
  }
}

async function calcular(opcoes: OpcoesAvaliacao): Promise<PropostaInterna[]> {
  const soAtivas = !(opcoes.automacaoId !== undefined && opcoes.incluirInativas === true);
  const automacoes = await prisma.automacao.findMany({
    where: {
      ...(opcoes.automacaoId !== undefined ? { id: opcoes.automacaoId } : {}),
      ...(soAtivas ? { ativa: true } : {}),
    },
    orderBy: [{ ordem: 'asc' }, { id: 'asc' }],
  });

  // Automação com tipo, ação ou config inválidos é ignorada.
  const validas: Valida[] = [];
  for (const a of automacoes) {
    if (!ehTipo(a.tipo) || !ehAcao(a.acao)) continue;
    const lido = configSchema.safeParse(a.config);
    if (!lido.success) continue;
    validas.push({ id: a.id, nome: a.nome, tipo: a.tipo, acao: a.acao, categoriaId: a.categoriaId, config: lido.data });
  }
  if (validas.length === 0) return [];

  const candidatos = await prisma.transacao.findMany({
    where: {
      automacaoId: null,
      provento: false,
      oculto: false,
      ...(opcoes.desde ? { data: { gte: opcoes.desde } } : {}),
    },
    orderBy: [{ data: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      data: true,
      descricao: true,
      valor: true,
      tipo: true,
      contaId: true,
      transferencia: true,
      categoriaId: true,
      conta: { select: { nome: true, tipo: true } },
    },
  });
  const lancamentos: Lancamento[] = candidatos.map((t) => {
    const descNorm = semAcento(t.descricao);
    return {
      id: t.id,
      data: t.data,
      descricao: t.descricao,
      descNorm,
      palavras: palavrasDe(descNorm),
      valor: num(t.valor),
      tipo: t.tipo,
      contaId: t.contaId,
      contaNome: t.conta.nome,
      cartao: t.conta.tipo === 'CARTAO',
      transferencia: t.transferencia,
      categoriaId: t.categoriaId,
    };
  });

  // Só carrega o que alguma automação precisa.
  const ctx: Contexto = { faturas: [], movimentos: [] };
  if (validas.some((v) => v.tipo === 'FATURA')) {
    const faturas = await prisma.fatura.findMany({
      where: { conta: { tipo: 'CARTAO' } },
      select: { total: true, vencimento: true },
    });
    ctx.faturas = faturas.map((f) => ({ total: num(f.total), vencimento: f.vencimento }));
  }
  if (validas.some((v) => v.tipo === 'INVESTIMENTO')) {
    const movimentos = await prisma.movimentoInvestimento.findMany({
      where: { tipo: { in: ['APLICACAO', 'RESGATE'] } },
      select: { id: true, tipo: true, valor: true, data: true },
    });
    ctx.movimentos = movimentos
      .map((m) => ({ id: m.id, tipo: m.tipo, valor: num(m.valor), data: m.data }))
      .sort((a, b) => a.valor - b.valor || a.id - b.id);
  }
  const tipoDaCategoria = new Map<number, string>();
  if (validas.some((v) => v.acao === 'CATEGORIA')) {
    const categorias = await prisma.categoria.findMany({ select: { id: true, tipo: true } });
    for (const c of categorias) tipoDaCategoria.set(c.id, c.tipo);
  }

  const usados = new Set<number>();
  const resultado: PropostaInterna[] = [];
  for (const v of validas) {
    // Ação CATEGORIA com categoria nula, inexistente: a automação não faz nada.
    const tipoCategoria = v.acao === 'CATEGORIA' && v.categoriaId !== null ? tipoDaCategoria.get(v.categoriaId) : undefined;
    if (v.acao === 'CATEGORIA' && tipoCategoria === undefined) continue;

    const contas = v.config.contaIds ?? [];
    const pool = lancamentos.filter((l) => {
      if (usados.has(l.id)) return false;
      if (v.acao === 'CATEGORIA') {
        if (l.categoriaId !== null || l.tipo !== tipoCategoria) return false;
      } else if (l.transferencia) {
        return false;
      }
      if (contas.length > 0 && !contas.includes(l.contaId)) return false;
      if (v.config.valorMin !== undefined && l.valor < v.config.valorMin) return false;
      if (v.config.valorMax !== undefined && l.valor > v.config.valorMax) return false;
      return true;
    });

    for (const grupo of casar(v.tipo, pool, v.config, ctx)) {
      for (const l of grupo) usados.add(l.id);
      const ordenado = [...grupo].sort((a, b) => a.data.getTime() - b.data.getTime() || a.id - b.id);
      resultado.push({
        automacaoId: v.id,
        automacaoNome: v.nome,
        acao: v.acao,
        categoriaId: v.acao === 'CATEGORIA' ? v.categoriaId : null,
        lancamentos: ordenado.map((l) => ({
          id: l.id,
          data: dataISO(l.data),
          descricao: l.descricao,
          valor: arredondar(l.valor),
          tipo: l.tipo,
          contaNome: l.contaNome,
        })),
      });
    }
  }
  return resultado;
}

// Prévia: o que cada automação mudaria. Não grava nada.
export async function avaliarAutomacoes(opcoes: OpcoesAvaliacao = {}): Promise<Proposta[]> {
  const internas = await calcular(opcoes);
  return internas.map((p) => ({
    automacaoId: p.automacaoId,
    automacaoNome: p.automacaoNome,
    acao: p.acao,
    lancamentos: p.lancamentos,
  }));
}

function dadosDaAcao(acao: string, categoriaId: number | null, automacaoId: number): Prisma.TransacaoUncheckedUpdateManyInput {
  if (acao === 'CATEGORIA') return { categoriaId, automacaoId };
  if (acao === 'ESCONDER') return { transferencia: true, oculto: true, automacaoId };
  return { transferencia: true, automacaoId };
}

// Grava o que as automações propõem, em uma transação. Só mexe em lançamento sem automacaoId.
export async function aplicarAutomacoes(opcoes: { desde?: Date; automacaoId?: number } = {}): Promise<ResultadoAplicacao> {
  const propostas = await calcular({ desde: opcoes.desde, automacaoId: opcoes.automacaoId });
  const grupos = new Map<number, { nome: string; acao: string; categoriaId: number | null; ids: number[] }>();
  for (const p of propostas) {
    const grupo = grupos.get(p.automacaoId) ?? { nome: p.automacaoNome, acao: p.acao, categoriaId: p.categoriaId, ids: [] };
    for (const l of p.lancamentos) grupo.ids.push(l.id);
    grupos.set(p.automacaoId, grupo);
  }

  return prisma.$transaction(
    async (tx) => {
      const porAutomacao: { id: number; nome: string; lancamentos: number }[] = [];
      for (const [id, grupo] of grupos) {
        let lancamentos = 0;
        const dados = dadosDaAcao(grupo.acao, grupo.categoriaId, id);
        for (let i = 0; i < grupo.ids.length; i += TAMANHO_LOTE) {
          const lote = grupo.ids.slice(i, i + TAMANHO_LOTE);
          const gravados = await tx.transacao.updateMany({
            where: { id: { in: lote }, automacaoId: null },
            data: dados,
          });
          lancamentos += gravados.count;
        }
        porAutomacao.push({ id, nome: grupo.nome, lancamentos });
      }
      return { aplicados: porAutomacao.reduce((soma, a) => soma + a.lancamentos, 0), porAutomacao };
    },
    { timeout: 60000 }
  );
}

// Cria as automações do conjunto padrão que ainda não existem neste perfil. Devolve quantas criou.
export async function criarAutomacoesPadrao(): Promise<number> {
  const existentes = await prisma.automacao.findMany({ where: { padrao: { not: null } }, select: { padrao: true } });
  const jaTem = new Set(existentes.map((a) => a.padrao));
  const novas = CONJUNTO_PADRAO.map((p, i) => ({ ...p, ordem: i + 1 })).filter((p) => !jaTem.has(p.chave));
  if (novas.length === 0) return 0;
  await prisma.automacao.createMany({
    data: novas.map((p) => ({
      nome: p.nome,
      tipo: p.tipo,
      acao: p.acao,
      config: p.config as Prisma.InputJsonValue,
      ativa: p.ativa,
      ordem: p.ordem,
      padrao: p.chave,
    })),
  });
  return novas.length;
}
