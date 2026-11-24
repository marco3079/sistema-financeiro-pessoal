// Contas a pagar e a receber (perfil Empresa): situação de cada título e o formato (DTO) da API.
// Usado pelas rotas de /titulos e pelos relatórios da empresa. Tudo em lote: nenhuma consulta por título.

import type { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { arredondar, dataISO, hoje, num } from './financas';

export type SituacaoTitulo = 'ABERTO' | 'PARCIAL' | 'QUITADO' | 'VENCIDO' | 'CANCELADO';

export interface TituloDTO {
  id: number;
  natureza: 'PAGAR' | 'RECEBER';
  descricao: string;
  parceiroId: number | null;
  parceiroNome: string | null;
  categoriaId: number | null;
  categoriaNome: string | null;
  categoriaCor: string | null;
  centroDeCustoId: number | null;
  centroDeCustoNome: string | null;
  contaId: number | null;
  contaNome: string | null;
  valor: number;
  pago: number;
  saldo: number;
  emissao: string;
  vencimento: string;
  documento: string | null;
  parcela: number | null;
  totalParcelas: number | null;
  grupo: string | null;
  recorrente: boolean;
  observacao: string | null;
  situacao: SituacaoTitulo;
  diasDeAtraso: number;
  anexos: number;
}

export interface BaixaDTO {
  id: number;
  data: string;
  valor: number;
  juros: number;
  multa: number;
  desconto: number;
  total: number;
  contaId: number;
  contaNome: string | null;
  observacao: string | null;
}

const DIA_MS = 24 * 60 * 60 * 1000;

// Situação de um título. `pago` é a soma das baixas (só o valor, sem juros e multa).
// `hojeData` é o dia de hoje como meia-noite UTC (ver `hoje()` em lib/financas.ts).
export function situacaoDoTitulo(
  titulo: { valor: Prisma.Decimal | number; cancelado: boolean; vencimento: Date },
  pago: number,
  hojeData: Date
): SituacaoTitulo {
  if (titulo.cancelado) return 'CANCELADO';
  const saldo = num(titulo.valor) - pago;
  if (saldo <= 0.005) return 'QUITADO';
  if (titulo.vencimento.getTime() < hojeData.getTime()) return 'VENCIDO';
  if (pago > 0) return 'PARCIAL';
  return 'ABERTO';
}

function semRepeticao(lista: (number | null)[]): number[] {
  return Array.from(new Set(lista.filter((v): v is number => v !== null)));
}

// Lista os títulos que casam com `where`, já no formato da API (ordem: vencimento, id).
export async function listarTitulosDTO(where: Prisma.TituloWhereInput): Promise<TituloDTO[]> {
  const titulos = await prisma.titulo.findMany({ where, orderBy: [{ vencimento: 'asc' }, { id: 'asc' }] });
  if (titulos.length === 0) return [];

  const ids = titulos.map((t) => t.id);
  const parceiroIds = semRepeticao(titulos.map((t) => t.parceiroId));
  const categoriaIds = semRepeticao(titulos.map((t) => t.categoriaId));
  const centroIds = semRepeticao(titulos.map((t) => t.centroDeCustoId));
  const contaIds = semRepeticao(titulos.map((t) => t.contaId));

  const [baixas, anexos, parceiros, categorias, centros, contas] = await Promise.all([
    prisma.baixaTitulo.groupBy({ by: ['tituloId'], where: { tituloId: { in: ids } }, _sum: { valor: true } }),
    prisma.anexoTitulo.groupBy({ by: ['tituloId'], where: { tituloId: { in: ids } }, _count: { id: true } }),
    prisma.parceiro.findMany({ where: { id: { in: parceiroIds } }, select: { id: true, nome: true } }),
    prisma.categoria.findMany({ where: { id: { in: categoriaIds } }, select: { id: true, nome: true, cor: true } }),
    prisma.centroDeCusto.findMany({ where: { id: { in: centroIds } }, select: { id: true, nome: true } }),
    prisma.conta.findMany({ where: { id: { in: contaIds } }, select: { id: true, nome: true } }),
  ]);

  const pagos = new Map<number, number>();
  for (const b of baixas) pagos.set(b.tituloId, arredondar(num(b._sum.valor)));

  const anexosPorTitulo = new Map<number, number>();
  for (const a of anexos) anexosPorTitulo.set(a.tituloId, a._count.id);

  const parceiroPorId = new Map<number, string>(parceiros.map((p) => [p.id, p.nome] as const));
  const categoriaPorId = new Map<number, { nome: string; cor: string }>(
    categorias.map((c) => [c.id, { nome: c.nome, cor: c.cor }] as const)
  );
  const centroPorId = new Map<number, string>(centros.map((c) => [c.id, c.nome] as const));
  const contaPorId = new Map<number, string>(contas.map((c) => [c.id, c.nome] as const));

  const hojeData = hoje();

  return titulos.map((t): TituloDTO => {
    const pago = pagos.get(t.id) ?? 0;
    const valor = arredondar(num(t.valor));
    const situacao = situacaoDoTitulo(t, pago, hojeData);
    const parceiroNome = t.parceiroId !== null ? parceiroPorId.get(t.parceiroId) : undefined;
    const categoria = t.categoriaId !== null ? categoriaPorId.get(t.categoriaId) : undefined;
    const centroNome = t.centroDeCustoId !== null ? centroPorId.get(t.centroDeCustoId) : undefined;
    const contaNome = t.contaId !== null ? contaPorId.get(t.contaId) : undefined;
    return {
      id: t.id,
      natureza: t.natureza === 'PAGAR' ? 'PAGAR' : 'RECEBER',
      descricao: t.descricao,
      parceiroId: parceiroNome !== undefined ? t.parceiroId : null,
      parceiroNome: parceiroNome ?? null,
      categoriaId: categoria !== undefined ? t.categoriaId : null,
      categoriaNome: categoria?.nome ?? null,
      categoriaCor: categoria?.cor ?? null,
      centroDeCustoId: centroNome !== undefined ? t.centroDeCustoId : null,
      centroDeCustoNome: centroNome ?? null,
      contaId: contaNome !== undefined ? t.contaId : null,
      contaNome: contaNome ?? null,
      valor,
      pago,
      saldo: arredondar(valor - pago),
      emissao: dataISO(t.emissao),
      vencimento: dataISO(t.vencimento),
      documento: t.documento,
      parcela: t.parcela,
      totalParcelas: t.totalParcelas,
      grupo: t.grupo,
      recorrente: t.recorrente,
      observacao: t.observacao,
      situacao,
      diasDeAtraso: situacao === 'VENCIDO' ? Math.round((hojeData.getTime() - t.vencimento.getTime()) / DIA_MS) : 0,
      anexos: anexosPorTitulo.get(t.id) ?? 0,
    };
  });
}
