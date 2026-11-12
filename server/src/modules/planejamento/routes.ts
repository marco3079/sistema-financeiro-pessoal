import { Router } from 'express';
import { z } from 'zod';
import type { Meta } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import {
  arredondar,
  corSchema,
  dataISOOuNula,
  dataSchema,
  dinheiroSchema,
  intervaloDoMes,
  mesAtual,
  mesSchema,
  num,
  paraData,
  textoCurto,
  textoQuery,
} from '../../lib/financas';

const router = Router();

// ---------- Orçamento ----------

const limiteSchema = z.object({
  limite: dinheiroSchema.refine((v) => v > 0, 'O limite deve ser maior que zero'),
});

interface ItemOrcamento {
  id: number;
  categoriaId: number;
  categoriaNome: string;
  categoriaCor: string;
  limite: number;
  gasto: number;
  percentual: number;
}

interface SemOrcamento {
  categoriaId: number;
  categoriaNome: string;
  categoriaCor: string;
  gasto: number;
}

router.get(
  '/orcamentos',
  asyncHandler(async (req, res) => {
    const mes = textoQuery(req.query.mes) ?? mesAtual();
    if (!mesSchema.safeParse(mes).success) throw new HttpError(400, 'Mês inválido');
    const { inicio, fim } = intervaloDoMes(mes);

    const [gastos, categorias] = await Promise.all([
      prisma.transacao.groupBy({
        by: ['categoriaId'],
        where: { tipo: 'DESPESA', transferencia: false, data: { gte: inicio, lt: fim } },
        _sum: { valor: true },
      }),
      prisma.categoria.findMany({
        where: { tipo: 'DESPESA' },
        include: { orcamento: true },
        orderBy: { nome: 'asc' },
      }),
    ]);

    const gastoPorCategoria = new Map<number, number>();
    for (const g of gastos) {
      if (g.categoriaId !== null) gastoPorCategoria.set(g.categoriaId, num(g._sum.valor));
    }

    const itens: ItemOrcamento[] = [];
    const semOrcamento: SemOrcamento[] = [];
    for (const c of categorias) {
      const gasto = arredondar(gastoPorCategoria.get(c.id) ?? 0);
      if (c.orcamento) {
        const limite = num(c.orcamento.limite);
        itens.push({
          id: c.orcamento.id,
          categoriaId: c.id,
          categoriaNome: c.nome,
          categoriaCor: c.cor,
          limite,
          gasto,
          percentual: limite > 0 ? Math.round((gasto / limite) * 100) : 0,
        });
      } else if (gasto > 0) {
        semOrcamento.push({ categoriaId: c.id, categoriaNome: c.nome, categoriaCor: c.cor, gasto });
      }
    }

    itens.sort((a, b) => b.percentual - a.percentual);
    semOrcamento.sort((a, b) => b.gasto - a.gasto);

    res.json({
      mes,
      itens,
      totalLimite: arredondar(itens.reduce((soma, i) => soma + i.limite, 0)),
      totalGasto: arredondar(itens.reduce((soma, i) => soma + i.gasto, 0)),
      semOrcamento,
    });
  })
);

router.put(
  '/orcamentos/:categoriaId',
  asyncHandler(async (req, res) => {
    const categoriaId = idParam(req, 'categoriaId');
    const { limite } = validar(limiteSchema, req.body);
    const categoria = await prisma.categoria.findUnique({ where: { id: categoriaId }, select: { tipo: true } });
    if (!categoria) throw new HttpError(404, 'Categoria não encontrada');
    if (categoria.tipo !== 'DESPESA') throw new HttpError(400, 'Só categorias de despesa têm orçamento');
    const orcamento = await prisma.orcamento.upsert({
      where: { categoriaId },
      create: { categoriaId, limite },
      update: { limite },
    });
    res.json({ categoriaId, limite: num(orcamento.limite) });
  })
);

router.delete(
  '/orcamentos/:categoriaId',
  asyncHandler(async (req, res) => {
    await prisma.orcamento.deleteMany({ where: { categoriaId: idParam(req, 'categoriaId') } });
    res.status(204).end();
  })
);

// ---------- Metas ----------

function metaDTO(m: Meta) {
  const valorAlvo = num(m.valorAlvo);
  const valorAtual = num(m.valorAtual);
  return {
    id: m.id,
    nome: m.nome,
    valorAlvo,
    valorAtual,
    prazo: dataISOOuNula(m.prazo),
    cor: m.cor,
    concluida: m.concluida,
    percentual: valorAlvo > 0 ? Math.min(100, Math.round((valorAtual / valorAlvo) * 100)) : 0,
  };
}

const valorAlvoSchema = dinheiroSchema.refine((v) => v > 0, 'O valor alvo deve ser maior que zero');

const criarMetaSchema = z.object({
  nome: textoCurto,
  valorAlvo: valorAlvoSchema,
  valorAtual: dinheiroSchema.optional(),
  prazo: dataSchema.nullable().optional(),
  cor: corSchema.optional(),
});

// Subconjunto: só as chaves enviadas são alteradas.
const atualizarMetaSchema = z.object({
  nome: textoCurto.optional(),
  valorAlvo: valorAlvoSchema.optional(),
  valorAtual: dinheiroSchema.optional(),
  prazo: dataSchema.nullable().optional(),
  cor: corSchema.optional(),
  concluida: z.boolean().optional(),
});

// undefined = não mexer; null = limpar; texto = data.
function prazoDe(prazo: string | null | undefined): Date | null | undefined {
  if (prazo === undefined) return undefined;
  return prazo === null ? null : paraData(prazo);
}

router.get(
  '/metas',
  asyncHandler(async (_req, res) => {
    const metas = await prisma.meta.findMany();
    metas.sort((a, b) => {
      if (a.concluida !== b.concluida) return a.concluida ? 1 : -1;
      if (a.prazo === null && b.prazo !== null) return 1;
      if (a.prazo !== null && b.prazo === null) return -1;
      if (a.prazo && b.prazo && a.prazo.getTime() !== b.prazo.getTime()) {
        return a.prazo.getTime() - b.prazo.getTime();
      }
      return a.nome.localeCompare(b.nome, 'pt-BR');
    });
    res.json(metas.map(metaDTO));
  })
);

router.post(
  '/metas',
  asyncHandler(async (req, res) => {
    const dados = validar(criarMetaSchema, req.body);
    const criada = await prisma.meta.create({
      data: {
        nome: dados.nome,
        valorAlvo: dados.valorAlvo,
        valorAtual: dados.valorAtual,
        prazo: prazoDe(dados.prazo),
        cor: dados.cor,
      },
    });
    res.status(201).json(metaDTO(criada));
  })
);

router.put(
  '/metas/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(atualizarMetaSchema, req.body);
    const existe = await prisma.meta.findUnique({ where: { id }, select: { id: true } });
    if (!existe) throw new HttpError(404, 'Meta não encontrada');
    const atualizada = await prisma.meta.update({
      where: { id },
      data: {
        nome: dados.nome,
        valorAlvo: dados.valorAlvo,
        valorAtual: dados.valorAtual,
        prazo: prazoDe(dados.prazo),
        cor: dados.cor,
        concluida: dados.concluida,
      },
    });
    res.json(metaDTO(atualizada));
  })
);

router.delete(
  '/metas/:id',
  asyncHandler(async (req, res) => {
    await prisma.meta.deleteMany({ where: { id: idParam(req) } });
    res.status(204).end();
  })
);

export default router;
