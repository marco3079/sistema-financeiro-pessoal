import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { arredondar, dataISO, num, textoQuery } from '../../lib/financas';

// Divisão de gastos: a parte de um lançamento que outra pessoa deve a você.
// Não há chave estrangeira em Divisao: divisões cujo lançamento foi apagado são descartadas ao ler.

const router = Router();

const NOME_PESSOA_MAXIMO = 40;
const TETO_VALOR = 999999999999;
const LIMITE_BUSCA = 30;

const parteSchema = z.object({
  pessoa: z
    .string()
    .trim()
    .min(1, 'Informe o nome da pessoa')
    .max(NOME_PESSOA_MAXIMO, `O nome pode ter até ${NOME_PESSOA_MAXIMO} caracteres`),
  valor: z
    .number()
    .finite()
    .max(TETO_VALOR)
    .refine((v) => arredondar(v) > 0, 'O valor precisa ser maior que zero'),
});

const criarSchema = z.object({
  transacaoId: z.number().int().positive(),
  partes: z.array(parteSchema).min(1, 'Informe pelo menos uma pessoa'),
});

// Trabalha em centavos inteiros para não errar soma de decimais.
function centavos(valor: number): number {
  return Math.round(valor * 100);
}

// Fila em memória por lançamento: pedidos ao mesmo transacaoId rodam um após o outro (o servidor é um processo só),
// assim duas gravações simultâneas não leem a mesma soma das partes.
const filas = new Map<number, Promise<unknown>>();

function emFila<T>(transacaoId: number, fn: () => Promise<T>): Promise<T> {
  const anterior = filas.get(transacaoId) ?? Promise.resolve();
  const atual = anterior.catch(() => undefined).then(fn);
  filas.set(transacaoId, atual);
  const limpar = () => {
    if (filas.get(transacaoId) === atual) filas.delete(transacaoId);
  };
  atual.then(limpar, limpar);
  return atual;
}

// Lista das pessoas com o que cada uma deve a você.
router.get(
  '/divisoes',
  asyncHandler(async (_req, res) => {
    const divisoes = await prisma.divisao.findMany({ orderBy: { id: 'asc' } });
    const ids = [...new Set(divisoes.map((d) => d.transacaoId))];
    const lancamentos = await prisma.transacao.findMany({
      where: { id: { in: ids } },
      select: { id: true, data: true, descricao: true, valor: true },
    });
    const porId = new Map(lancamentos.map((l) => [l.id, l]));

    const grupos = new Map<
      string,
      {
        pessoa: string;
        itens: { id: number; transacaoId: number; data: string; descricao: string; valorDoLancamento: number; valor: number; quitadoEm: string | null; ordemData: number }[];
      }
    >();

    for (const d of divisoes) {
      const lancamento = porId.get(d.transacaoId);
      if (!lancamento) continue;
      const chave = d.pessoa.trim().toLowerCase();
      let grupo = grupos.get(chave);
      if (!grupo) {
        grupo = { pessoa: d.pessoa.trim(), itens: [] };
        grupos.set(chave, grupo);
      }
      grupo.itens.push({
        id: d.id,
        transacaoId: d.transacaoId,
        data: dataISO(lancamento.data),
        descricao: lancamento.descricao,
        valorDoLancamento: arredondar(num(lancamento.valor)),
        valor: arredondar(num(d.valor)),
        quitadoEm: d.quitadoEm ? d.quitadoEm.toISOString() : null,
        ordemData: lancamento.data.getTime(),
      });
    }

    let totalEmAberto = 0;
    const pessoas = [...grupos.values()]
      .map((g) => {
        // Do mais recente para o mais antigo (data do lançamento, depois id).
        const itens = g.itens
          .sort((a, b) => b.ordemData - a.ordemData || b.id - a.id)
          .map(({ ordemData: _ordem, ...item }) => item);
        const emAberto = arredondar(
          itens.filter((i) => i.quitadoEm === null).reduce((t, i) => t + centavos(i.valor), 0) / 100
        );
        const quitado = arredondar(
          itens.filter((i) => i.quitadoEm !== null).reduce((t, i) => t + centavos(i.valor), 0) / 100
        );
        totalEmAberto += emAberto;
        return { pessoa: g.pessoa, emAberto, quitado, itens };
      })
      .sort((a, b) => a.pessoa.localeCompare(b.pessoa, 'pt-BR'));

    res.json({ pessoas, totalEmAberto: arredondar(totalEmAberto) });
  })
);

// Despesas recentes (sem transferências) para escolher o lançamento a dividir.
router.get(
  '/divisoes/lancamentos',
  asyncHandler(async (req, res) => {
    const busca = textoQuery(req.query.busca);
    const where: Prisma.TransacaoWhereInput = { tipo: 'DESPESA', transferencia: false };
    if (busca !== undefined) where.descricao = { contains: busca, mode: 'insensitive' };

    const lancamentos = await prisma.transacao.findMany({
      where,
      orderBy: [{ data: 'desc' }, { id: 'desc' }],
      take: LIMITE_BUSCA,
      select: { id: true, data: true, descricao: true, valor: true, conta: { select: { nome: true } } },
    });
    const somas = await prisma.divisao.groupBy({
      by: ['transacaoId'],
      where: { transacaoId: { in: lancamentos.map((l) => l.id) } },
      _sum: { valor: true },
    });
    const jaPorId = new Map(somas.map((s) => [s.transacaoId, num(s._sum.valor)]));

    res.json(
      lancamentos.map((l) => ({
        id: l.id,
        data: dataISO(l.data),
        descricao: l.descricao,
        valor: arredondar(num(l.valor)),
        contaNome: l.conta.nome,
        jaDividido: arredondar(jaPorId.get(l.id) ?? 0),
      }))
    );
  })
);

// Divide um lançamento de despesa entre pessoas. A soma das partes (com as que já existem) não pode passar do valor.
router.post(
  '/divisoes',
  asyncHandler(async (req, res) => {
    const dados = validar(criarSchema, req.body);
    const criadas = await emFila(dados.transacaoId, () =>
      prisma.$transaction(async (tx) => {
        const lancamento = await tx.transacao.findUnique({
          where: { id: dados.transacaoId },
          select: { tipo: true, valor: true },
        });
        if (!lancamento) throw new HttpError(404, 'Lançamento não encontrado');
        if (lancamento.tipo !== 'DESPESA') throw new HttpError(400, 'Só dá para dividir despesas');

        const soma = await tx.divisao.aggregate({
          where: { transacaoId: dados.transacaoId },
          _sum: { valor: true },
        });
        const jaDividido = centavos(num(soma._sum.valor));
        const novas = dados.partes.reduce((t, p) => t + centavos(arredondar(p.valor)), 0);
        if (jaDividido + novas > centavos(num(lancamento.valor))) {
          throw new HttpError(400, 'As partes passam do valor do lançamento');
        }

        await tx.divisao.createMany({
          data: dados.partes.map((p) => ({
            transacaoId: dados.transacaoId,
            pessoa: p.pessoa,
            valor: arredondar(p.valor),
          })),
        });
        return dados.partes.length;
      })
    );
    res.status(201).json({ criadas });
  })
);

async function alterarQuitacao(id: number, quitadoEm: Date | null) {
  const existente = await prisma.divisao.findUnique({ where: { id }, select: { id: true } });
  if (!existente) throw new HttpError(404, 'Divisão não encontrada');
  const atualizada = await prisma.divisao.update({
    where: { id },
    data: { quitadoEm },
    select: { id: true, quitadoEm: true },
  });
  return { id: atualizada.id, quitadoEm: atualizada.quitadoEm ? atualizada.quitadoEm.toISOString() : null };
}

router.post(
  '/divisoes/:id/quitar',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    res.json(await alterarQuitacao(id, new Date()));
  })
);

router.post(
  '/divisoes/:id/reabrir',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    res.json(await alterarQuitacao(id, null));
  })
);

router.delete(
  '/divisoes/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const existente = await prisma.divisao.findUnique({ where: { id }, select: { id: true } });
    if (!existente) throw new HttpError(404, 'Divisão não encontrada');
    await prisma.divisao.delete({ where: { id } });
    res.status(204).end();
  })
);

export default router;
