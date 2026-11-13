import { Router } from 'express';
import { z } from 'zod';
import type { ContaFixa } from '@prisma/client';
import { prisma, perfilAtual } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { chamarApiInterna } from '../../lib/mcp';
import {
  arredondar,
  dataISO,
  dinheiroSchema,
  hoje,
  inteiroQuery,
  intervaloDoMes,
  mesAtual,
  mesSchema,
  num,
  somarMeses,
  textoCurto,
  textoQuery,
} from '../../lib/financas';

// Agenda: contas a pagar e a receber de cada mês (faturas e contas fixas), e o fluxo de caixa projetado.
// Contas fixas são só cadastro e marca de "paga" por mês: nenhum lançamento é criado.

const router = Router();

// ---------- Contas fixas ----------

const contaFixaSchema = z.object({
  descricao: textoCurto,
  tipo: z.enum(['DESPESA', 'RECEITA']),
  valor: dinheiroSchema.refine((v) => v > 0, 'O valor deve ser maior que zero'),
  diaDoMes: z.number().int().min(1).max(31),
  categoriaId: z.number().int().positive().nullable().optional(),
  contaId: z.number().int().positive().nullable().optional(),
  ativa: z.boolean().optional(),
});

const mesCorpoSchema = z.object({ mes: mesSchema });

function contaFixaDTO(c: ContaFixa) {
  return {
    id: c.id,
    descricao: c.descricao,
    tipo: c.tipo,
    valor: num(c.valor),
    diaDoMes: c.diaDoMes,
    categoriaId: c.categoriaId,
    contaId: c.contaId,
    ativa: c.ativa,
  };
}

// Confere que a categoria e a conta informadas existem (o filtro por perfil já vale aqui).
async function conferirReferencias(dados: { categoriaId?: number | null; contaId?: number | null }): Promise<void> {
  if (dados.categoriaId) {
    const categoria = await prisma.categoria.findUnique({ where: { id: dados.categoriaId }, select: { id: true } });
    if (!categoria) throw new HttpError(400, 'Categoria não encontrada');
  }
  if (dados.contaId) {
    const conta = await prisma.conta.findUnique({ where: { id: dados.contaId }, select: { id: true } });
    if (!conta) throw new HttpError(400, 'Conta não encontrada');
  }
}

router.get(
  '/contas-fixas',
  asyncHandler(async (_req, res) => {
    const lista = await prisma.contaFixa.findMany({ orderBy: [{ diaDoMes: 'asc' }, { id: 'asc' }] });
    res.json(lista.map(contaFixaDTO));
  })
);

router.post(
  '/contas-fixas',
  asyncHandler(async (req, res) => {
    const dados = validar(contaFixaSchema, req.body);
    await conferirReferencias(dados);
    const criada = await prisma.contaFixa.create({
      data: {
        descricao: dados.descricao,
        tipo: dados.tipo,
        valor: dados.valor,
        diaDoMes: dados.diaDoMes,
        categoriaId: dados.categoriaId ?? null,
        contaId: dados.contaId ?? null,
        ativa: dados.ativa ?? true,
      },
    });
    res.status(201).json(contaFixaDTO(criada));
  })
);

router.put(
  '/contas-fixas/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(contaFixaSchema, req.body);
    const existe = await prisma.contaFixa.findUnique({ where: { id }, select: { id: true } });
    if (!existe) throw new HttpError(404, 'Conta fixa não encontrada');
    await conferirReferencias(dados);
    const atualizada = await prisma.contaFixa.update({
      where: { id },
      data: {
        descricao: dados.descricao,
        tipo: dados.tipo,
        valor: dados.valor,
        diaDoMes: dados.diaDoMes,
        categoriaId: dados.categoriaId ?? null,
        contaId: dados.contaId ?? null,
        ativa: dados.ativa,
      },
    });
    res.json(contaFixaDTO(atualizada));
  })
);

router.delete(
  '/contas-fixas/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    // Sem chave estrangeira: apaga também as marcas de "paga" para não sobrar lixo no banco.
    await prisma.$transaction(async (db) => {
      await db.pagamentoContaFixa.deleteMany({ where: { contaFixaId: id } });
      await db.contaFixa.deleteMany({ where: { id } });
    });
    res.status(204).end();
  })
);

router.post(
  '/contas-fixas/:id/pagar',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const { mes } = validar(mesCorpoSchema, req.body);
    const existe = await prisma.contaFixa.findUnique({ where: { id }, select: { id: true } });
    if (!existe) throw new HttpError(404, 'Conta fixa não encontrada');
    const jaPaga = await prisma.pagamentoContaFixa.findFirst({ where: { contaFixaId: id, mes }, select: { id: true } });
    if (!jaPaga) await prisma.pagamentoContaFixa.create({ data: { contaFixaId: id, mes } });
    res.json({ contaFixaId: id, mes, paga: true });
  })
);

router.delete(
  '/contas-fixas/:id/pagar',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const mes = textoQuery(req.query.mes);
    if (!mes || !mesSchema.safeParse(mes).success) throw new HttpError(400, 'Mês inválido');
    await prisma.pagamentoContaFixa.deleteMany({ where: { contaFixaId: id, mes } });
    res.status(204).end();
  })
);

// ---------- Agenda do mês ----------

type Situacao = 'PAGA' | 'ABERTA' | 'ATRASADA';

interface ItemAgenda {
  chave: string;
  origem: 'FATURA' | 'CONTA_FIXA';
  id: number;
  descricao: string;
  tipo: 'DESPESA' | 'RECEITA';
  valor: number;
  data: string;
  situacao: Situacao;
  contaFixaId?: number;
  faturaId?: number;
}

router.get(
  '/agenda',
  asyncHandler(async (req, res) => {
    const mes = textoQuery(req.query.mes) ?? mesAtual();
    if (!mesSchema.safeParse(mes).success) throw new HttpError(400, 'Mês inválido');
    const { inicio, fim } = intervaloDoMes(mes);
    const [ano, numeroDoMes] = mes.split('-').map(Number);
    const ultimoDia = new Date(Date.UTC(ano, numeroDoMes, 0)).getUTCDate();
    const hojeTexto = dataISO(hoje());

    const [faturas, contasFixas, pagamentos] = await Promise.all([
      prisma.fatura.findMany({
        where: { vencimento: { gte: inicio, lt: fim } },
        include: { conta: { select: { nome: true } } },
        orderBy: { vencimento: 'asc' },
      }),
      prisma.contaFixa.findMany({ where: { ativa: true }, orderBy: [{ diaDoMes: 'asc' }, { id: 'asc' }] }),
      prisma.pagamentoContaFixa.findMany({ where: { mes }, select: { contaFixaId: true } }),
    ]);

    const itens: ItemAgenda[] = [];

    for (const f of faturas) {
      itens.push({
        chave: `FATURA-${f.id}`,
        origem: 'FATURA',
        id: f.id,
        faturaId: f.id,
        descricao: `Fatura ${f.conta.nome}`,
        tipo: 'DESPESA',
        valor: arredondar(num(f.total)),
        data: dataISO(f.vencimento),
        situacao: f.status === 'PAGA' ? 'PAGA' : f.status === 'ATRASADA' ? 'ATRASADA' : 'ABERTA',
      });
    }

    const pagas = new Set(pagamentos.map((p) => p.contaFixaId));
    for (const c of contasFixas) {
      // Em mês curto, dia 31 cai no último dia do mês.
      const data = dataISO(new Date(Date.UTC(ano, numeroDoMes - 1, Math.min(c.diaDoMes, ultimoDia))));
      const paga = pagas.has(c.id);
      itens.push({
        chave: `CONTA_FIXA-${c.id}-${mes}`,
        origem: 'CONTA_FIXA',
        id: c.id,
        contaFixaId: c.id,
        descricao: c.descricao,
        tipo: c.tipo,
        valor: arredondar(num(c.valor)),
        data,
        situacao: paga ? 'PAGA' : data < hojeTexto ? 'ATRASADA' : 'ABERTA',
      });
    }

    itens.sort((a, b) => (a.data !== b.data ? (a.data < b.data ? -1 : 1) : a.descricao.localeCompare(b.descricao, 'pt-BR')));

    const soma = (filtro: (i: ItemAgenda) => boolean) =>
      arredondar(itens.filter(filtro).reduce((total, i) => total + i.valor, 0));

    res.json({
      mes,
      itens,
      aPagar: soma((i) => i.tipo === 'DESPESA' && i.situacao !== 'PAGA'),
      aReceber: soma((i) => i.tipo === 'RECEITA' && i.situacao !== 'PAGA'),
      pago: soma((i) => i.situacao === 'PAGA'),
      emAberto: soma((i) => i.situacao !== 'PAGA'),
    });
  })
);

// ---------- Fluxo de caixa projetado ----------

const previsaoSchema = z.object({
  meses: z.array(z.object({ mes: z.string(), total: z.number() })),
});

router.get(
  '/fluxo',
  asyncHandler(async (req, res) => {
    const quantos = inteiroQuery(req.query.meses) ?? 6;
    if (![3, 6, 12].includes(quantos)) throw new HttpError(400, 'Use 3, 6 ou 12 meses');
    const mesInicial = mesAtual();
    const meses = Array.from({ length: quantos }, (_, i) => somarMeses(mesInicial, i));

    const [saldoContas, fixas, pagamentos, previsaoBruta] = await Promise.all([
      prisma.conta.aggregate({ where: { ativo: true, tipo: { not: 'CARTAO' } }, _sum: { saldo: true } }),
      prisma.contaFixa.findMany({ where: { ativa: true } }),
      prisma.pagamentoContaFixa.findMany({ where: { mes: { in: meses } }, select: { contaFixaId: true, mes: true } }),
      chamarApiInterna(perfilAtual() ?? 1, 'GET', '/cartoes/previsao'),
    ]);

    const previsao = previsaoSchema.safeParse(previsaoBruta);
    if (!previsao.success) throw new HttpError(500, 'Não consegui ler a previsão das faturas');

    // Faturas: a previsão já soma as faturas não pagas com as parcelas futuras de cada mês (sem contar em dobro).
    const faturaDoMes = new Map(previsao.data.meses.map((m) => [m.mes, m.total]));
    const pagas = new Set(pagamentos.map((p) => `${p.contaFixaId}|${p.mes}`));

    let saldo = num(saldoContas._sum.saldo);
    const saldoInicial = arredondar(saldo);

    const linhas = meses.map((mes) => {
      let entradas = 0;
      let saidas = 0;
      for (const c of fixas) {
        if (pagas.has(`${c.id}|${mes}`)) continue;
        if (c.tipo === 'RECEITA') entradas += num(c.valor);
        else saidas += num(c.valor);
      }
      const faturas = faturaDoMes.get(mes) ?? 0;
      saldo = arredondar(saldo + entradas - saidas - faturas);
      return {
        mes,
        entradas: arredondar(entradas),
        saidas: arredondar(saidas),
        faturas: arredondar(faturas),
        saldoFinal: saldo,
      };
    });

    res.json({ saldoInicial, meses: linhas });
  })
);

export default router;
