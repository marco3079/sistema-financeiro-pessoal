import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import {
  arredondar,
  atualizarStatusDasFaturas,
  contaDTO,
  dataSchema,
  faturaDTO,
  hoje,
  INCLUIR_NA_TRANSACAO,
  inteiroQuery,
  num,
  numOuNulo,
  paraData,
  registrarPosicaoPatrimonio,
  transacaoDTO,
} from '../../lib/financas';

const router = Router();

const INCLUIR_CONTA = { conta: { select: { nome: true } } } as const;

const pagarSchema = z.object({
  pagaEm: dataSchema.optional(),
  contaPagamentoId: z.number().int().positive().optional(),
});

// Resumo de cada cartão ativo com a fatura que ainda não foi paga e o percentual do limite usado.
router.get(
  '/cartoes',
  asyncHandler(async (_req, res) => {
    await atualizarStatusDasFaturas();
    const cartoes = await prisma.conta.findMany({
      where: { tipo: 'CARTAO', ativo: true },
      orderBy: { nome: 'asc' },
    });
    const resposta = await Promise.all(
      cartoes.map(async (c) => {
        const fatura = await prisma.fatura.findFirst({
          where: { contaId: c.id, status: { not: 'PAGA' } },
          orderBy: { vencimento: 'asc' },
          include: INCLUIR_CONTA,
        });
        const limite = numOuNulo(c.limite);
        const percentualUsado = limite === null || limite === 0 ? null : Math.round((num(c.saldo) / limite) * 100);
        return {
          conta: contaDTO(c),
          faturaAtual: fatura ? faturaDTO(fatura) : null,
          percentualUsado,
        };
      })
    );
    res.json(resposta);
  })
);

router.get(
  '/faturas',
  asyncHandler(async (req, res) => {
    await atualizarStatusDasFaturas();
    const contaId = inteiroQuery(req.query.contaId);
    const lista = await prisma.fatura.findMany({
      where: contaId !== undefined ? { contaId } : {},
      orderBy: { vencimento: 'desc' },
      include: INCLUIR_CONTA,
      take: 60,
    });
    res.json(lista.map(faturaDTO));
  })
);

router.get(
  '/faturas/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const fatura = await prisma.fatura.findUnique({ where: { id }, include: INCLUIR_CONTA });
    if (!fatura) throw new HttpError(404, 'Fatura não encontrada');
    const lista = await prisma.transacao.findMany({
      where: { faturaId: id },
      include: INCLUIR_NA_TRANSACAO,
      orderBy: [{ data: 'desc' }, { id: 'desc' }],
    });

    // Despesas da fatura por categoria (sem transferências), da maior para a menor.
    const grupos = new Map<number, { nome: string; cor: string; total: number }>();
    for (const t of lista) {
      if (t.tipo !== 'DESPESA' || t.transferencia) continue;
      const chave = t.categoriaId ?? 0;
      const grupo = grupos.get(chave) ?? {
        nome: t.categoria?.nome ?? 'Sem categoria',
        cor: t.categoria?.cor ?? '#64748b',
        total: 0,
      };
      grupo.total += num(t.valor);
      grupos.set(chave, grupo);
    }
    const porCategoria = [...grupos.values()]
      .map((g) => ({ ...g, total: arredondar(g.total) }))
      .sort((a, b) => b.total - a.total);

    res.json({ fatura: faturaDTO(fatura), transacoes: lista.map(transacaoDTO), porCategoria });
  })
);

router.post(
  '/faturas/:id/pagar',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(pagarSchema, req.body);

    const fatura = await prisma.fatura.findUnique({ where: { id }, include: { conta: true } });
    if (!fatura) throw new HttpError(404, 'Fatura não encontrada');
    if (fatura.origem === 'OPEN_FINANCE') {
      throw new HttpError(400, 'Este registro vem do Open Finance e é atualizado automaticamente.');
    }
    if (fatura.status === 'PAGA') throw new HttpError(400, 'Esta fatura já está paga');

    const dataPagamento = dados.pagaEm ? paraData(dados.pagaEm) : hoje();
    const total = num(fatura.total);

    let contaPagamentoId: number | null = null;
    if (dados.contaPagamentoId !== undefined) {
      const contaPagamento = await prisma.conta.findUnique({ where: { id: dados.contaPagamentoId } });
      if (!contaPagamento) throw new HttpError(400, 'Conta de pagamento não encontrada');
      if (contaPagamento.origem !== 'MANUAL' || contaPagamento.tipo === 'CARTAO') {
        throw new HttpError(400, 'Escolha uma conta manual que não seja cartão');
      }
      contaPagamentoId = contaPagamento.id;
    }

    const atualizada = await prisma.$transaction(async (db) => {
      const paga = await db.fatura.update({
        where: { id },
        data: { status: 'PAGA', pagaEm: dataPagamento },
        include: INCLUIR_CONTA,
      });
      // A dívida do cartão diminui, sem ficar negativa.
      const novoSaldo = Math.max(0, arredondar(num(fatura.conta.saldo) - total));
      await db.conta.update({ where: { id: fatura.contaId }, data: { saldo: novoSaldo } });
      if (contaPagamentoId !== null && total > 0) {
        await db.transacao.create({
          data: {
            contaId: contaPagamentoId,
            data: dataPagamento,
            descricao: 'Pagamento da fatura ' + fatura.conta.nome,
            valor: total,
            tipo: 'DESPESA',
            transferencia: true,
          },
        });
        await db.conta.update({ where: { id: contaPagamentoId }, data: { saldo: { decrement: total } } });
      }
      return paga;
    });

    await registrarPosicaoPatrimonio();
    res.json(faturaDTO(atualizada));
  })
);

export default router;
