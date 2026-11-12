import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import {
  arredondar,
  categoriaDTO,
  dataSchema,
  efeitoNoSaldo,
  garantirFatura,
  inteiroQuery,
  INCLUIR_NA_TRANSACAO,
  intervaloDoMes,
  mesSchema,
  num,
  paraData,
  recalcularFatura,
  registrarPosicaoPatrimonio,
  dinheiroSchema,
  textoCurto,
  textoOpcional,
  textoQuery,
  transacaoDTO,
  TransacaoCompleta,
  corSchema,
} from '../../lib/financas';

const router = Router();

const TIPOS = ['RECEITA', 'DESPESA'] as const;
const tipoSchema = z.enum(TIPOS);

const valorPositivo = dinheiroSchema.refine((v) => v > 0, 'O valor deve ser maior que zero');

// Campos que um lançamento do Open Finance aceita alterar (ver CONTRATOS.md, regra de ouro).
const CAMPOS_LIBERADOS_OPEN_FINANCE = new Set(['categoriaId', 'observacao', 'transferencia']);
const MSG_OPEN_FINANCE = 'Este registro vem do Open Finance e é atualizado automaticamente.';

const criarTransacaoSchema = z.object({
  contaId: z.number().int().positive(),
  data: dataSchema,
  descricao: textoCurto,
  valor: valorPositivo,
  tipo: tipoSchema,
  categoriaId: z.number().int().positive().nullable().optional(),
  transferencia: z.boolean().optional(),
  observacao: textoOpcional,
  totalParcelas: z.number().int().min(2).max(48).optional(),
});

const atualizarTransacaoSchema = z.object({
  data: dataSchema.optional(),
  descricao: textoCurto.optional(),
  valor: valorPositivo.optional(),
  tipo: tipoSchema.optional(),
  categoriaId: z.number().int().positive().nullable().optional(),
  transferencia: z.boolean().optional(),
  observacao: textoOpcional,
});

const criarCategoriaSchema = z.object({
  nome: textoCurto,
  tipo: tipoSchema,
  cor: corSchema.optional(),
});

const atualizarCategoriaSchema = z.object({
  nome: textoCurto.optional(),
  cor: corSchema.optional(),
});

// Lê o parâmetro `tipo` da query; devolve undefined quando ausente ou inválido.
function tipoQuery(valor: unknown): (typeof TIPOS)[number] | undefined {
  const resultado = tipoSchema.safeParse(valor);
  return resultado.success ? resultado.data : undefined;
}

// Confere que a categoria existe quando um id é informado.
async function confirmarCategoria(categoriaId: number | null | undefined): Promise<void> {
  if (categoriaId === null || categoriaId === undefined) return;
  const existe = await prisma.categoria.findUnique({ where: { id: categoriaId }, select: { id: true } });
  if (!existe) throw new HttpError(400, 'Categoria não encontrada');
}

// Data da parcela de ordem `deslocamento` (0 = a primeira), `deslocamento` meses depois de `base` ('AAAA-MM-DD').
// Se o dia não existir naquele mês, usa o último dia do mês.
function dataDaParcela(base: string, deslocamento: number): Date {
  const [ano, mes, dia] = base.split('-').map(Number);
  const mesAlvo = mes - 1 + deslocamento;
  const ultimoDia = new Date(Date.UTC(ano, mesAlvo + 1, 0)).getUTCDate();
  return new Date(Date.UTC(ano, mesAlvo, Math.min(dia, ultimoDia)));
}

// ---------- Categorias ----------

router.get(
  '/categorias',
  asyncHandler(async (req, res) => {
    const tipo = tipoQuery(req.query.tipo);
    const lista = await prisma.categoria.findMany({
      where: tipo ? { tipo } : undefined,
      orderBy: [{ tipo: 'asc' }, { nome: 'asc' }],
    });
    res.json(lista.map(categoriaDTO));
  })
);

router.post(
  '/categorias',
  asyncHandler(async (req, res) => {
    const dados = validar(criarCategoriaSchema, req.body);
    const criada = await prisma.categoria.create({
      data: { nome: dados.nome, tipo: dados.tipo, cor: dados.cor },
    });
    res.status(201).json(categoriaDTO(criada));
  })
);

router.put(
  '/categorias/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(atualizarCategoriaSchema, req.body);
    const atualizada = await prisma.categoria.update({
      where: { id },
      data: { nome: dados.nome, cor: dados.cor },
    });
    res.json(categoriaDTO(atualizada));
  })
);

router.delete(
  '/categorias/:id',
  asyncHandler(async (req, res) => {
    await prisma.categoria.delete({ where: { id: idParam(req) } });
    res.status(204).end();
  })
);

// ---------- Lançamentos ----------

router.get(
  '/transacoes',
  asyncHandler(async (req, res) => {
    const where: Prisma.TransacaoWhereInput = {};

    const mes = textoQuery(req.query.mes);
    const de = textoQuery(req.query.de);
    const ate = textoQuery(req.query.ate);
    if (mes !== undefined) {
      const mesValido = mesSchema.safeParse(mes);
      if (!mesValido.success) throw new HttpError(400, 'Período inválido');
      const { inicio, fim } = intervaloDoMes(mesValido.data);
      where.data = { gte: inicio, lt: fim };
    } else if (de !== undefined || ate !== undefined) {
      if (de !== undefined && !dataSchema.safeParse(de).success) throw new HttpError(400, 'Período inválido');
      if (ate !== undefined && !dataSchema.safeParse(ate).success) throw new HttpError(400, 'Período inválido');
      where.data = {
        ...(de !== undefined ? { gte: paraData(de) } : {}),
        ...(ate !== undefined ? { lte: paraData(ate) } : {}),
      };
    }

    const contaId = inteiroQuery(req.query.contaId);
    if (contaId !== undefined) where.contaId = contaId;

    const faturaId = inteiroQuery(req.query.faturaId);
    if (faturaId !== undefined) where.faturaId = faturaId;

    const categoriaId = inteiroQuery(req.query.categoriaId);
    if (categoriaId !== undefined) where.categoriaId = categoriaId === 0 ? null : categoriaId;

    const tipo = tipoQuery(req.query.tipo);
    if (tipo !== undefined) where.tipo = tipo;

    const busca = textoQuery(req.query.busca);
    if (busca !== undefined) where.descricao = { contains: busca, mode: 'insensitive' };

    const pagina = Math.max(1, inteiroQuery(req.query.pagina) ?? 1);
    const porPagina = Math.max(1, Math.min(inteiroQuery(req.query.porPagina) ?? 50, 200));

    const [lista, total, somas] = await Promise.all([
      prisma.transacao.findMany({
        where,
        include: INCLUIR_NA_TRANSACAO,
        orderBy: [{ data: 'desc' }, { id: 'desc' }],
        skip: (pagina - 1) * porPagina,
        take: porPagina,
      }),
      prisma.transacao.count({ where }),
      prisma.transacao.groupBy({
        by: ['tipo'],
        where: { ...where, transferencia: false },
        _sum: { valor: true },
      }),
    ]);

    res.json({
      itens: lista.map(transacaoDTO),
      total,
      receitas: num(somas.find((s) => s.tipo === 'RECEITA')?._sum.valor),
      despesas: num(somas.find((s) => s.tipo === 'DESPESA')?._sum.valor),
    });
  })
);

router.post(
  '/transacoes',
  asyncHandler(async (req, res) => {
    const dados = validar(criarTransacaoSchema, req.body);

    const conta = await prisma.conta.findUnique({ where: { id: dados.contaId } });
    if (!conta) throw new HttpError(404, 'Conta não encontrada');
    if (conta.origem === 'OPEN_FINANCE') {
      throw new HttpError(
        400,
        'Esta conta vem do Open Finance: os lançamentos dela chegam sozinhos pela sincronização.'
      );
    }

    await confirmarCategoria(dados.categoriaId);

    // Parcelas só valem para despesa em cartão de crédito.
    const parcelas = conta.tipo === 'CARTAO' && dados.tipo === 'DESPESA' ? (dados.totalParcelas ?? 1) : 1;
    const parcelado = parcelas > 1;

    // A última parcela recebe o resto do arredondamento, para a soma fechar em `valor`.
    const valorDaParcela = (k: number): number =>
      k < parcelas ? arredondar(dados.valor / parcelas) : arredondar(dados.valor - arredondar(dados.valor / parcelas) * (parcelas - 1));

    const criadas = await prisma.$transaction(async (db) => {
      const lista: TransacaoCompleta[] = [];
      const faturas = new Set<number>();

      for (let k = 1; k <= parcelas; k++) {
        const dataParcela = dataDaParcela(dados.data, k - 1);
        const faturaId = conta.tipo === 'CARTAO' ? await garantirFatura(db, conta, dataParcela) : null;
        if (faturaId !== null) faturas.add(faturaId);

        const criada = await db.transacao.create({
          data: {
            contaId: conta.id,
            data: dataParcela,
            descricao: dados.descricao,
            valor: valorDaParcela(k),
            tipo: dados.tipo,
            transferencia: dados.transferencia ?? false,
            categoriaId: dados.categoriaId ?? null,
            observacao: dados.observacao ?? null,
            faturaId,
            parcela: parcelado ? k : null,
            totalParcelas: parcelado ? parcelas : null,
          },
          include: INCLUIR_NA_TRANSACAO,
        });
        lista.push(criada);
      }

      await db.conta.update({
        where: { id: conta.id },
        data: { saldo: { increment: efeitoNoSaldo(conta.tipo, dados.tipo, dados.valor) } },
      });

      for (const faturaId of faturas) {
        await recalcularFatura(db, faturaId);
      }

      return lista;
    });

    await registrarPosicaoPatrimonio();
    res.status(201).json(transacaoDTO(criadas[0]));
  })
);

router.put(
  '/transacoes/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(atualizarTransacaoSchema, req.body);

    const transacao = await prisma.transacao.findUnique({ where: { id }, include: { conta: true } });
    if (!transacao) throw new HttpError(404, 'Lançamento não encontrado');

    if (transacao.origem === 'OPEN_FINANCE' && Object.keys(dados).some((c) => !CAMPOS_LIBERADOS_OPEN_FINANCE.has(c))) {
      throw new HttpError(400, MSG_OPEN_FINANCE);
    }

    await confirmarCategoria(dados.categoriaId);

    const conta = transacao.conta;
    const manual = transacao.origem === 'MANUAL';
    const mudouValorOuTipo = manual && (dados.valor !== undefined || dados.tipo !== undefined);
    const mudouData = manual && conta.tipo === 'CARTAO' && dados.data !== undefined;

    const atualizada = await prisma.$transaction(async (db) => {
      if (mudouValorOuTipo) {
        const novoTipo = dados.tipo ?? transacao.tipo;
        const novoValor = dados.valor ?? num(transacao.valor);
        const incremento =
          efeitoNoSaldo(conta.tipo, novoTipo, novoValor) -
          efeitoNoSaldo(conta.tipo, transacao.tipo, num(transacao.valor));
        await db.conta.update({ where: { id: conta.id }, data: { saldo: { increment: incremento } } });
      }

      const alteracoes: Prisma.TransacaoUncheckedUpdateInput = {};
      if (dados.data !== undefined) alteracoes.data = paraData(dados.data);
      if (dados.descricao !== undefined) alteracoes.descricao = dados.descricao;
      if (dados.valor !== undefined) alteracoes.valor = dados.valor;
      if (dados.tipo !== undefined) alteracoes.tipo = dados.tipo;
      if (dados.categoriaId !== undefined) alteracoes.categoriaId = dados.categoriaId;
      if (dados.transferencia !== undefined) alteracoes.transferencia = dados.transferencia;
      if (dados.observacao !== undefined) alteracoes.observacao = dados.observacao;
      if (mudouData && dados.data !== undefined) {
        alteracoes.faturaId = await garantirFatura(db, conta, paraData(dados.data));
      }

      const gravada = await db.transacao.update({ where: { id }, data: alteracoes, include: INCLUIR_NA_TRANSACAO });

      const faturas = new Set<number>();
      if (transacao.faturaId !== null) faturas.add(transacao.faturaId);
      if (gravada.faturaId !== null) faturas.add(gravada.faturaId);
      for (const faturaId of faturas) {
        await recalcularFatura(db, faturaId);
      }

      return gravada;
    });

    await registrarPosicaoPatrimonio();
    res.json(transacaoDTO(atualizada));
  })
);

router.delete(
  '/transacoes/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req);

    const transacao = await prisma.transacao.findUnique({ where: { id }, include: { conta: true } });
    if (!transacao) throw new HttpError(404, 'Lançamento não encontrado');
    if (transacao.origem === 'OPEN_FINANCE') throw new HttpError(400, MSG_OPEN_FINANCE);

    await prisma.$transaction(async (db) => {
      await db.transacao.delete({ where: { id } });
      await db.conta.update({
        where: { id: transacao.contaId },
        data: {
          saldo: { increment: -efeitoNoSaldo(transacao.conta.tipo, transacao.tipo, num(transacao.valor)) },
        },
      });
      if (transacao.faturaId !== null) {
        await recalcularFatura(db, transacao.faturaId);
      }
    });

    await registrarPosicaoPatrimonio();
    res.status(204).end();
  })
);

export default router;
