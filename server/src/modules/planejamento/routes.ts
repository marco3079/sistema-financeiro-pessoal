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
  inteiroQuery,
  mesAtual,
  mesSchema,
  num,
  paraData,
  somarMeses,
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

interface SugestaoOrcamento {
  categoriaId: number;
  nome: string;
  cor: string;
  media: number;
  sugerido: number;
  limiteAtual: number | null;
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

// Média mensal dos últimos N meses fechados (sem o mês atual) por categoria de despesa.
// sugerido = média arredondada para cima ao múltiplo de 10.
router.get(
  '/orcamentos/sugestao',
  asyncHandler(async (req, res) => {
    const meses = inteiroQuery(req.query.meses) ?? 3;
    if (meses !== 3 && meses !== 6) throw new HttpError(400, 'Use meses=3 ou meses=6');
    const atual = mesAtual();
    const inicio = intervaloDoMes(somarMeses(atual, -meses)).inicio;
    const fim = intervaloDoMes(somarMeses(atual, -1)).fim;

    const [gastos, categorias] = await Promise.all([
      prisma.transacao.groupBy({
        by: ['categoriaId'],
        where: { tipo: 'DESPESA', transferencia: false, data: { gte: inicio, lt: fim } },
        _sum: { valor: true },
      }),
      prisma.categoria.findMany({
        where: { tipo: 'DESPESA' },
        include: { orcamento: true },
      }),
    ]);

    const gastoPorCategoria = new Map<number, number>();
    for (const g of gastos) {
      if (g.categoriaId !== null) gastoPorCategoria.set(g.categoriaId, num(g._sum.valor));
    }

    const itens: SugestaoOrcamento[] = [];
    for (const c of categorias) {
      const total = gastoPorCategoria.get(c.id) ?? 0;
      if (total <= 0) continue;
      const media = arredondar(total / meses);
      if (media <= 0) continue;
      itens.push({
        categoriaId: c.id,
        nome: c.nome,
        cor: c.cor,
        media,
        sugerido: Math.ceil(media / 10) * 10,
        limiteAtual: c.orcamento ? arredondar(num(c.orcamento.limite)) : null,
      });
    }
    itens.sort((a, b) => b.media - a.media);
    res.json(itens);
  })
);

// ---------- Metas ----------

interface SaldosLigados {
  contas: Map<number, { nome: string; saldo: number }>;
  investimentos: Map<number, { nome: string; saldo: number }>;
}

// Saldos atuais das contas (que não são cartão) e investimentos ligados às metas.
async function carregarSaldos(metas: Meta[]): Promise<SaldosLigados> {
  const idsContas = [...new Set(metas.map((m) => m.contaId).filter((v): v is number => v !== null))];
  const idsInvestimentos = [...new Set(metas.map((m) => m.investimentoId).filter((v): v is number => v !== null))];
  const contas = idsContas.length
    ? await prisma.conta.findMany({
        where: { id: { in: idsContas }, tipo: { not: 'CARTAO' } },
        select: { id: true, nome: true, saldo: true },
      })
    : [];
  const investimentos = idsInvestimentos.length
    ? await prisma.investimento.findMany({
        where: { id: { in: idsInvestimentos } },
        select: { id: true, nome: true, saldo: true },
      })
    : [];
  return {
    contas: new Map<number, { nome: string; saldo: number }>(
      contas.map((c) => [c.id, { nome: c.nome, saldo: num(c.saldo) }])
    ),
    investimentos: new Map<number, { nome: string; saldo: number }>(
      investimentos.map((i) => [i.id, { nome: i.nome, saldo: num(i.saldo) }])
    ),
  };
}

// Meta ligada: o valor atual é o saldo da conta/investimento. Se ele sumiu, usa o valor guardado.
function metaDTO(m: Meta, saldos: SaldosLigados) {
  const valorAlvo = num(m.valorAlvo);
  let valorAtual = num(m.valorAtual);
  let origem: { tipo: 'CONTA' | 'INVESTIMENTO'; id: number; nome: string } | null = null;
  const conta = m.contaId !== null ? saldos.contas.get(m.contaId) : undefined;
  const investimento = m.investimentoId !== null ? saldos.investimentos.get(m.investimentoId) : undefined;
  if (m.contaId !== null && conta) {
    origem = { tipo: 'CONTA', id: m.contaId, nome: conta.nome };
    valorAtual = conta.saldo;
  } else if (m.investimentoId !== null && investimento) {
    origem = { tipo: 'INVESTIMENTO', id: m.investimentoId, nome: investimento.nome };
    valorAtual = investimento.saldo;
  }
  valorAtual = arredondar(valorAtual);
  return {
    id: m.id,
    nome: m.nome,
    valorAlvo,
    valorAtual,
    prazo: dataISOOuNula(m.prazo),
    cor: m.cor,
    concluida: m.concluida,
    percentual: valorAlvo > 0 ? Math.min(100, Math.round((valorAtual / valorAlvo) * 100)) : 0,
    contaId: m.contaId,
    investimentoId: m.investimentoId,
    origem,
  };
}

// Confere a ligação e devolve o saldo atual (null se a meta não é ligada).
async function conferirLigacao(
  contaId: number | null | undefined,
  investimentoId: number | null | undefined
): Promise<number | null> {
  if (contaId && investimentoId) throw new HttpError(400, 'Escolha só uma conta ou um investimento para acompanhar');
  if (contaId) {
    const conta = await prisma.conta.findUnique({ where: { id: contaId }, select: { tipo: true, saldo: true } });
    if (!conta) throw new HttpError(404, 'Conta não encontrada');
    if (conta.tipo === 'CARTAO') throw new HttpError(400, 'Cartão não pode ser acompanhado por meta');
    return num(conta.saldo);
  }
  if (investimentoId) {
    const investimento = await prisma.investimento.findUnique({
      where: { id: investimentoId },
      select: { saldo: true },
    });
    if (!investimento) throw new HttpError(404, 'Investimento não encontrado');
    return num(investimento.saldo);
  }
  return null;
}

const valorAlvoSchema = dinheiroSchema.refine((v) => v > 0, 'O valor alvo deve ser maior que zero');

const ligacaoSchema = {
  contaId: z.number().int().positive().nullable().optional(),
  investimentoId: z.number().int().positive().nullable().optional(),
};

const criarMetaSchema = z.object({
  nome: textoCurto,
  valorAlvo: valorAlvoSchema,
  valorAtual: dinheiroSchema.optional(),
  prazo: dataSchema.nullable().optional(),
  cor: corSchema.optional(),
  ...ligacaoSchema,
});

// Subconjunto: só as chaves enviadas são alteradas.
const atualizarMetaSchema = z.object({
  nome: textoCurto.optional(),
  valorAlvo: valorAlvoSchema.optional(),
  valorAtual: dinheiroSchema.optional(),
  prazo: dataSchema.nullable().optional(),
  cor: corSchema.optional(),
  concluida: z.boolean().optional(),
  ...ligacaoSchema,
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
    const saldos = await carregarSaldos(metas);
    metas.sort((a, b) => {
      if (a.concluida !== b.concluida) return a.concluida ? 1 : -1;
      if (a.prazo === null && b.prazo !== null) return 1;
      if (a.prazo !== null && b.prazo === null) return -1;
      if (a.prazo && b.prazo && a.prazo.getTime() !== b.prazo.getTime()) {
        return a.prazo.getTime() - b.prazo.getTime();
      }
      return a.nome.localeCompare(b.nome, 'pt-BR');
    });
    res.json(metas.map((m) => metaDTO(m, saldos)));
  })
);

router.post(
  '/metas',
  asyncHandler(async (req, res) => {
    const dados = validar(criarMetaSchema, req.body);
    const contaId = dados.contaId ?? null;
    const investimentoId = dados.investimentoId ?? null;
    const saldo = await conferirLigacao(contaId, investimentoId);
    const criada = await prisma.meta.create({
      data: {
        nome: dados.nome,
        valorAlvo: dados.valorAlvo,
        valorAtual: saldo !== null ? saldo : dados.valorAtual,
        prazo: prazoDe(dados.prazo),
        cor: dados.cor,
        contaId,
        investimentoId,
      },
    });
    res.status(201).json(metaDTO(criada, await carregarSaldos([criada])));
  })
);

router.put(
  '/metas/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(atualizarMetaSchema, req.body);
    const existente = await prisma.meta.findUnique({ where: { id } });
    if (!existente) throw new HttpError(404, 'Meta não encontrada');
    // Sem a chave no corpo, a ligação atual é mantida.
    const contaId = dados.contaId !== undefined ? dados.contaId : existente.contaId;
    const investimentoId = dados.investimentoId !== undefined ? dados.investimentoId : existente.investimentoId;
    const saldo = await conferirLigacao(contaId, investimentoId);
    const atualizada = await prisma.meta.update({
      where: { id },
      data: {
        nome: dados.nome,
        valorAlvo: dados.valorAlvo,
        valorAtual: saldo !== null ? saldo : dados.valorAtual,
        prazo: prazoDe(dados.prazo),
        cor: dados.cor,
        concluida: dados.concluida,
        contaId: dados.contaId,
        investimentoId: dados.investimentoId,
      },
    });
    res.json(metaDTO(atualizada, await carregarSaldos([atualizada])));
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
