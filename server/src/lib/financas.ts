// Código compartilhado pelos módulos financeiros: datas, dinheiro, validação,
// formatos de resposta (DTO) e as regras de saldo e de fatura.
// Convenções (ver também prisma/schema.prisma):
// - Datas "só dia" trafegam como texto 'AAAA-MM-DD' e ficam no banco como meia-noite UTC.
// - Dinheiro trafega como number (reais). Transacao.valor é sempre positivo.

import type {
  Categoria,
  Conta,
  Fatura,
  Investimento,
  MovimentoInvestimento,
  Prisma,
  TipoConta,
  TipoTransacao,
  Transacao,
} from '@prisma/client';
import { z } from 'zod';
import { prisma } from './prisma';

// Cliente do Prisma ou o cliente de dentro de um prisma.$transaction.
export type Db = Prisma.TransactionClient;

// ---------- Dinheiro ----------

export function num(valor: Prisma.Decimal | number | null | undefined): number {
  return valor === null || valor === undefined ? 0 : Number(valor);
}

export function numOuNulo(valor: Prisma.Decimal | number | null | undefined): number | null {
  return valor === null || valor === undefined ? null : Number(valor);
}

export function arredondar(valor: number): number {
  return Math.round(valor * 100) / 100;
}

export function moeda(valor: number): string {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// ---------- Datas ----------

export const MESES_CURTOS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function doisDigitos(n: number): string {
  return String(n).padStart(2, '0');
}

// Date (meia-noite UTC) -> 'AAAA-MM-DD'.
export function dataISO(data: Date): string {
  return `${data.getUTCFullYear()}-${doisDigitos(data.getUTCMonth() + 1)}-${doisDigitos(data.getUTCDate())}`;
}

export function dataISOOuNula(data: Date | null | undefined): string | null {
  return data ? dataISO(data) : null;
}

// 'AAAA-MM-DD' -> Date à meia-noite UTC.
export function paraData(texto: string): Date {
  const [ano, mes, dia] = texto.split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia));
}

// O dia de hoje (pelo relógio do servidor) como meia-noite UTC.
export function hoje(): Date {
  const agora = new Date();
  return new Date(Date.UTC(agora.getFullYear(), agora.getMonth(), agora.getDate()));
}

// Date -> 'AAAA-MM'.
export function mesDe(data: Date): string {
  return `${data.getUTCFullYear()}-${doisDigitos(data.getUTCMonth() + 1)}`;
}

export function mesAtual(): string {
  return mesDe(hoje());
}

// 'AAAA-MM' + delta meses -> 'AAAA-MM'.
export function somarMeses(mes: string, delta: number): string {
  const [ano, m] = mes.split('-').map(Number);
  return mesDe(new Date(Date.UTC(ano, m - 1 + delta, 1)));
}

// Primeiro dia do mês (inclusive) e primeiro dia do mês seguinte (exclusive).
export function intervaloDoMes(mes: string): { inicio: Date; fim: Date } {
  const [ano, m] = mes.split('-').map(Number);
  return { inicio: new Date(Date.UTC(ano, m - 1, 1)), fim: new Date(Date.UTC(ano, m, 1)) };
}

// 'AAAA-MM' -> 'Nov'.
export function rotuloMesCurto(mes: string): string {
  return MESES_CURTOS[Number(mes.split('-')[1]) - 1] ?? mes;
}

// Dia `dia` do mês indicado, limitado ao último dia do mês (31 em fevereiro vira 28/29).
function diaNoMes(ano: number, mesIndice: number, dia: number): Date {
  const ultimo = new Date(Date.UTC(ano, mesIndice + 1, 0)).getUTCDate();
  return new Date(Date.UTC(ano, mesIndice, Math.min(dia, ultimo)));
}

// ---------- Validação (zod) ----------

export const dataSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (use AAAA-MM-DD)');
export const mesSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mês inválido (use AAAA-MM)');
export const dinheiroSchema = z.number().finite().min(0).max(999999999999);
export const dinheiroComSinalSchema = z.number().finite().min(-999999999999).max(999999999999);
export const corSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida (use #rrggbb)');
export const textoCurto = z.string().trim().min(1).max(120);
export const textoOpcional = z.string().trim().max(200).nullable().optional();

// Lê um parâmetro de query como texto não vazio, ou undefined.
export function textoQuery(valor: unknown): string | undefined {
  if (typeof valor !== 'string') return undefined;
  const limpo = valor.trim();
  return limpo === '' ? undefined : limpo;
}

// Lê um parâmetro de query como inteiro positivo, ou undefined.
export function inteiroQuery(valor: unknown): number | undefined {
  const texto = textoQuery(valor);
  if (texto === undefined || !/^\d+$/.test(texto)) return undefined;
  return Number(texto);
}

// ---------- Formatos de resposta (DTO) ----------
// Os mesmos formatos estão em client/src/lib/financas.ts.

export function contaDTO(c: Conta) {
  return {
    id: c.id,
    nome: c.nome,
    tipo: c.tipo,
    instituicao: c.instituicao,
    numero: c.numero,
    saldo: num(c.saldo),
    cor: c.cor,
    ativo: c.ativo,
    bandeira: c.bandeira,
    limite: numOuNulo(c.limite),
    limiteDisponivel: numOuNulo(c.limiteDisponivel),
    diaFechamento: c.diaFechamento,
    diaVencimento: c.diaVencimento,
    origem: c.origem,
    conexaoId: c.conexaoId,
  };
}

export function categoriaDTO(c: Categoria) {
  return { id: c.id, nome: c.nome, tipo: c.tipo, cor: c.cor };
}

// Use sempre com include: INCLUIR_NA_TRANSACAO.
export const INCLUIR_NA_TRANSACAO = {
  conta: { select: { nome: true, tipo: true } },
  categoria: { select: { nome: true, cor: true } },
} as const;

export type TransacaoCompleta = Transacao & {
  conta: { nome: string; tipo: TipoConta };
  categoria: { nome: string; cor: string } | null;
};

export function transacaoDTO(t: TransacaoCompleta) {
  return {
    id: t.id,
    contaId: t.contaId,
    contaNome: t.conta.nome,
    contaTipo: t.conta.tipo,
    data: dataISO(t.data),
    descricao: t.descricao,
    valor: num(t.valor),
    tipo: t.tipo,
    transferencia: t.transferencia,
    pendente: t.pendente,
    categoriaId: t.categoriaId,
    categoriaNome: t.categoria?.nome ?? null,
    categoriaCor: t.categoria?.cor ?? null,
    faturaId: t.faturaId,
    parcela: t.parcela,
    totalParcelas: t.totalParcelas,
    observacao: t.observacao,
    origem: t.origem,
  };
}

// Use sempre com include: { conta: { select: { nome: true } } }.
export function faturaDTO(f: Fatura & { conta: { nome: string } }) {
  return {
    id: f.id,
    contaId: f.contaId,
    contaNome: f.conta.nome,
    vencimento: dataISO(f.vencimento),
    fechamento: dataISOOuNula(f.fechamento),
    total: num(f.total),
    minimo: numOuNulo(f.minimo),
    status: f.status,
    pagaEm: dataISOOuNula(f.pagaEm),
    origem: f.origem,
  };
}

export function investimentoDTO(i: Investimento) {
  const saldo = num(i.saldo);
  const aplicado = num(i.valorAplicado);
  return {
    id: i.id,
    nome: i.nome,
    codigo: i.codigo,
    tipo: i.tipo,
    subtipo: i.subtipo,
    instituicao: i.instituicao,
    emissor: i.emissor,
    valorAplicado: aplicado,
    saldo,
    saldoLiquido: numOuNulo(i.saldoLiquido),
    rendimento: arredondar(saldo - aplicado),
    // Percentual sobre o valor aplicado; null quando não há valor aplicado.
    rentabilidade: aplicado > 0 ? Math.round(((saldo - aplicado) / aplicado) * 1000) / 10 : null,
    quantidade: numOuNulo(i.quantidade),
    taxa: i.taxa,
    vencimento: dataISOOuNula(i.vencimento),
    dataPosicao: i.dataPosicao.toISOString(),
    ativo: i.ativo,
    origem: i.origem,
    conexaoId: i.conexaoId,
  };
}

export function movimentoDTO(m: MovimentoInvestimento) {
  return {
    id: m.id,
    investimentoId: m.investimentoId,
    data: dataISO(m.data),
    tipo: m.tipo,
    valor: num(m.valor),
    quantidade: numOuNulo(m.quantidade),
    descricao: m.descricao,
  };
}

// ---------- Regras de saldo ----------

// Quanto o saldo da conta muda quando a transação ENTRA (para desfazer, use o valor negativo).
// Conta comum: receita soma, despesa subtrai. Cartão (saldo = dívida): despesa soma, receita subtrai.
export function efeitoNoSaldo(tipoConta: TipoConta, tipo: TipoTransacao, valor: number): number {
  const entrada = tipo === 'RECEITA' ? valor : -valor;
  return tipoConta === 'CARTAO' ? -entrada : entrada;
}

// ---------- Regras de fatura (cartões manuais) ----------

const DIA_VENCIMENTO_PADRAO = 10;
const DIAS_ENTRE_FECHAMENTO_E_VENCIMENTO = 7;

// Datas de fechamento e de vencimento da fatura que recebe uma compra feita em `data`.
export function cicloDaFatura(
  data: Date,
  diaFechamento: number | null,
  diaVencimento: number | null
): { fechamento: Date; vencimento: Date } {
  const diaVenc = diaVencimento ?? DIA_VENCIMENTO_PADRAO;
  const diaFech = diaFechamento ?? ((diaVenc - DIAS_ENTRE_FECHAMENTO_E_VENCIMENTO + 27) % 28) + 1;
  const ano = data.getUTCFullYear();
  const mes = data.getUTCMonth();
  // Fecha neste mês se a compra foi até o dia de fechamento; senão, no mês seguinte.
  let fechamento = diaNoMes(ano, mes, diaFech);
  if (data.getTime() > fechamento.getTime()) {
    fechamento = diaNoMes(ano, mes + 1, diaFech);
  }
  // Vence no primeiro dia `diaVenc` depois do fechamento.
  let vencimento = diaNoMes(fechamento.getUTCFullYear(), fechamento.getUTCMonth(), diaVenc);
  if (vencimento.getTime() <= fechamento.getTime()) {
    vencimento = diaNoMes(fechamento.getUTCFullYear(), fechamento.getUTCMonth() + 1, diaVenc);
  }
  return { fechamento, vencimento };
}

// Devolve o id da fatura (criando se preciso) que recebe uma compra feita em `data` num cartão manual.
export async function garantirFatura(
  db: Db,
  cartao: { id: number; diaFechamento: number | null; diaVencimento: number | null },
  data: Date
): Promise<number> {
  const { fechamento, vencimento } = cicloDaFatura(data, cartao.diaFechamento, cartao.diaVencimento);
  const existente = await db.fatura.findUnique({
    where: { contaId_vencimento: { contaId: cartao.id, vencimento } },
    select: { id: true },
  });
  if (existente) return existente.id;
  const agora = hoje().getTime();
  const status = vencimento.getTime() < agora ? 'ATRASADA' : fechamento.getTime() < agora ? 'FECHADA' : 'ABERTA';
  const criada = await db.fatura.create({
    data: { contaId: cartao.id, vencimento, fechamento, status },
    select: { id: true },
  });
  return criada.id;
}

// Refaz o total de uma fatura MANUAL: compras menos estornos. Faturas do Open Finance não são tocadas.
export async function recalcularFatura(db: Db, faturaId: number): Promise<void> {
  const fatura = await db.fatura.findUnique({ where: { id: faturaId }, select: { origem: true } });
  if (!fatura || fatura.origem !== 'MANUAL') return;
  const somas = await db.transacao.groupBy({
    by: ['tipo'],
    where: { faturaId, transferencia: false },
    _sum: { valor: true },
  });
  const despesas = num(somas.find((s) => s.tipo === 'DESPESA')?._sum.valor);
  const receitas = num(somas.find((s) => s.tipo === 'RECEITA')?._sum.valor);
  await db.fatura.update({ where: { id: faturaId }, data: { total: arredondar(despesas - receitas) } });
}

// Passa as faturas ABERTA para FECHADA depois do fechamento e FECHADA/ABERTA para ATRASADA depois do vencimento.
export async function atualizarStatusDasFaturas(): Promise<void> {
  const agora = hoje();
  await prisma.fatura.updateMany({
    where: { status: { in: ['ABERTA', 'FECHADA'] }, vencimento: { lt: agora }, total: { gt: 0 } },
    data: { status: 'ATRASADA' },
  });
  await prisma.fatura.updateMany({
    where: { status: 'ABERTA', fechamento: { lt: agora } },
    data: { status: 'FECHADA' },
  });
}

// ---------- Patrimônio ----------

export interface TotaisPatrimonio {
  contas: number; // saldo somado das contas que não são cartão
  investimentos: number;
  cartoes: number; // dívida somada dos cartões
  patrimonio: number; // contas + investimentos - cartoes
}

export async function totaisPatrimonio(): Promise<TotaisPatrimonio> {
  const [contas, cartoes, investimentos] = await Promise.all([
    prisma.conta.aggregate({ where: { ativo: true, tipo: { not: 'CARTAO' } }, _sum: { saldo: true } }),
    prisma.conta.aggregate({ where: { ativo: true, tipo: 'CARTAO' }, _sum: { saldo: true } }),
    prisma.investimento.aggregate({ where: { ativo: true }, _sum: { saldo: true } }),
  ]);
  const c = num(contas._sum.saldo);
  const k = num(cartoes._sum.saldo);
  const i = num(investimentos._sum.saldo);
  return { contas: c, investimentos: i, cartoes: k, patrimonio: arredondar(c + i - k) };
}

// Grava (ou atualiza) a fotografia de hoje do patrimônio. Nunca lança.
export async function registrarPosicaoPatrimonio(): Promise<void> {
  try {
    const t = await totaisPatrimonio();
    const data = hoje();
    const valores = { contas: t.contas, investimentos: t.investimentos, cartoes: t.cartoes };
    await prisma.posicaoPatrimonio.upsert({ where: { data }, create: { data, ...valores }, update: valores });
  } catch (erro) {
    console.error('Falha ao registrar a posição do patrimônio:', erro instanceof Error ? erro.message : erro);
  }
}
