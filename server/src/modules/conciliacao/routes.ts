import { Router } from 'express';
import type { Conta } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam } from '../../lib/erros';
import { arredondar, dataISO, num, recalcularFatura } from '../../lib/financas';

// Conciliação dos cartões: confere se a dívida de cada cartão (Conta.saldo) bate com as faturas não pagas,
// e se o total de cada fatura bate com a soma dos lançamentos dela. A regra de soma é a mesma de
// recalcularFatura (lib/financas.ts): transferências ficam de fora; despesa soma e receita subtrai.

const router = Router();

// Diferenças até este valor (em reais) são arredondamento e não contam.
const TOLERANCIA = 0.01;

interface FaturaConciliada {
  id: number;
  vencimento: string;
  status: string;
  total: number;
  somaDosLancamentos: number;
  diferenca: number;
}

interface LancamentoSemFatura {
  id: number;
  data: string;
  descricao: string;
  valor: number;
  tipo: string;
}

interface CartaoConciliado {
  contaId: number;
  nome: string;
  origem: string;
  saldo: number;
  faturasNaoPagas: number;
  diferenca: number;
  faturas: FaturaConciliada[];
  semFatura: LancamentoSemFatura[];
}

function divergiu(valor: number): boolean {
  return Math.abs(valor) > TOLERANCIA;
}

function temDivergencia(cartao: CartaoConciliado): boolean {
  return divergiu(cartao.diferenca) || cartao.faturas.some((f) => divergiu(f.diferenca));
}

// Monta a conciliação de cada cartão recebido (com as faturas não pagas e os lançamentos sem fatura).
async function montarCartoes(contas: Conta[]): Promise<CartaoConciliado[]> {
  if (contas.length === 0) return [];
  const contaIds = contas.map((c) => c.id);

  const faturas = await prisma.fatura.findMany({
    where: { contaId: { in: contaIds }, status: { not: 'PAGA' } },
    orderBy: { vencimento: 'asc' },
  });
  const faturaIds = faturas.map((f) => f.id);

  // Soma dos lançamentos de cada fatura, separada por tipo (transferências ficam de fora, como em recalcularFatura).
  const somas = faturaIds.length
    ? await prisma.transacao.groupBy({
        by: ['faturaId', 'tipo'],
        where: { faturaId: { in: faturaIds }, transferencia: false },
        _sum: { valor: true },
      })
    : [];
  const somaPorFatura = new Map<number, number>();
  for (const s of somas) {
    if (s.faturaId === null) continue;
    const valor = num(s._sum.valor);
    const atual = somaPorFatura.get(s.faturaId) ?? 0;
    somaPorFatura.set(s.faturaId, atual + (s.tipo === 'DESPESA' ? valor : -valor));
  }

  // Lançamentos do cartão que não entraram em nenhuma fatura.
  const semFaturaRows = await prisma.transacao.findMany({
    where: { contaId: { in: contaIds }, faturaId: null },
    select: { id: true, contaId: true, data: true, descricao: true, valor: true, tipo: true },
    orderBy: [{ data: 'desc' }, { id: 'desc' }],
  });
  const semFaturaPorConta = new Map<number, LancamentoSemFatura[]>();
  for (const t of semFaturaRows) {
    const lista = semFaturaPorConta.get(t.contaId) ?? [];
    lista.push({ id: t.id, data: dataISO(t.data), descricao: t.descricao, valor: num(t.valor), tipo: t.tipo });
    semFaturaPorConta.set(t.contaId, lista);
  }

  return contas.map((c) => {
    const faturasDoCartao: FaturaConciliada[] = faturas
      .filter((f) => f.contaId === c.id)
      .map((f) => {
        const total = arredondar(num(f.total));
        const somaDosLancamentos = arredondar(somaPorFatura.get(f.id) ?? 0);
        return {
          id: f.id,
          vencimento: dataISO(f.vencimento),
          status: f.status,
          total,
          somaDosLancamentos,
          diferenca: arredondar(total - somaDosLancamentos),
        };
      });
    const saldo = arredondar(num(c.saldo));
    const faturasNaoPagas = arredondar(faturasDoCartao.reduce((soma, f) => soma + f.total, 0));
    return {
      contaId: c.id,
      nome: c.nome,
      origem: c.origem,
      saldo,
      faturasNaoPagas,
      diferenca: arredondar(saldo - faturasNaoPagas),
      faturas: faturasDoCartao,
      semFatura: semFaturaPorConta.get(c.id) ?? [],
    };
  });
}

router.get(
  '/conciliacao',
  asyncHandler(async (_req, res) => {
    const contas = await prisma.conta.findMany({
      where: { tipo: 'CARTAO', ativo: true },
      orderBy: { nome: 'asc' },
    });
    const cartoes = await montarCartoes(contas);
    res.json({
      cartoes,
      divergencias: cartoes.filter(temDivergencia).length,
    });
  })
);

// Recalcula os totais das faturas do cartão manual e grava a dívida (saldo) como a soma das faturas não pagas.
router.post(
  '/conciliacao/:contaId/corrigir',
  asyncHandler(async (req, res) => {
    const contaId = idParam(req, 'contaId');
    const conta = await prisma.conta.findUnique({ where: { id: contaId } });
    if (!conta) throw new HttpError(404, 'Cartão não encontrado');
    if (conta.tipo !== 'CARTAO') throw new HttpError(400, 'Só cartões podem ser corrigidos aqui');
    if (conta.origem !== 'MANUAL') throw new HttpError(400, 'Este cartão é atualizado pelo Open Finance');

    const atualizada = await prisma.$transaction(async (db) => {
      const faturas = await db.fatura.findMany({ where: { contaId }, select: { id: true } });
      for (const f of faturas) {
        await recalcularFatura(db, f.id);
      }
      const naoPagas = await db.fatura.aggregate({
        where: { contaId, status: { not: 'PAGA' } },
        _sum: { total: true },
      });
      const saldo = arredondar(num(naoPagas._sum.total));
      const dados: { saldo: number; limiteDisponivel?: number } = { saldo };
      if (conta.limite !== null) {
        dados.limiteDisponivel = Math.max(0, arredondar(num(conta.limite) - saldo));
      }
      return db.conta.update({ where: { id: contaId }, data: dados });
    });

    const [item] = await montarCartoes([atualizada]);
    res.json(item);
  })
);

export default router;
