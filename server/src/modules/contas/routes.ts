import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import {
  contaDTO,
  corSchema,
  dinheiroComSinalSchema,
  dinheiroSchema,
  registrarPosicaoPatrimonio,
  textoCurto,
  textoOpcional,
  totaisPatrimonio,
} from '../../lib/financas';

const router = Router();

const MSG_OPEN_FINANCE = 'Este registro vem do Open Finance e é atualizado automaticamente.';
const MSG_FATURA_NEGATIVA = 'A fatura em aberto não pode ser negativa';

const tipoSchema = z.enum(['CORRENTE', 'POUPANCA', 'CARTEIRA', 'CARTAO', 'INVESTIMENTO']);
const diaSchema = z.number().int().min(1).max(31);

const criarSchema = z.object({
  nome: textoCurto,
  tipo: tipoSchema,
  instituicao: textoOpcional,
  numero: textoOpcional,
  saldo: dinheiroComSinalSchema.optional(),
  cor: corSchema.optional(),
  bandeira: textoOpcional,
  limite: dinheiroSchema.nullable().optional(),
  diaFechamento: diaSchema.nullable().optional(),
  diaVencimento: diaSchema.nullable().optional(),
});

const atualizarSchema = z.object({
  nome: textoCurto.optional(),
  instituicao: textoOpcional,
  numero: textoOpcional,
  cor: corSchema.optional(),
  ativo: z.boolean().optional(),
  bandeira: textoOpcional,
  limite: dinheiroSchema.nullable().optional(),
  diaFechamento: diaSchema.nullable().optional(),
  diaVencimento: diaSchema.nullable().optional(),
});

const saldoSchema = z.object({ saldo: dinheiroComSinalSchema });

// Campos que a tela pode mudar numa conta do Open Finance.
const CAMPOS_OPEN_FINANCE = ['nome', 'cor', 'ativo'];

// GET /contas
router.get(
  '/contas',
  asyncHandler(async (req, res) => {
    const where: Prisma.ContaWhereInput = {};
    if (req.query.inativas !== 'true') where.ativo = true;
    const tipo = tipoSchema.safeParse(req.query.tipo);
    if (tipo.success) where.tipo = tipo.data;
    const lista = await prisma.conta.findMany({
      where,
      orderBy: [{ tipo: 'asc' }, { nome: 'asc' }],
    });
    res.json(lista.map(contaDTO));
  })
);

// Declarada antes de /contas/:id.
router.get(
  '/contas/resumo',
  asyncHandler(async (_req, res) => {
    res.json(await totaisPatrimonio());
  })
);

router.post(
  '/contas',
  asyncHandler(async (req, res) => {
    const dados = validar(criarSchema, req.body);
    const ehCartao = dados.tipo === 'CARTAO';
    if (ehCartao && dados.saldo !== undefined && dados.saldo < 0) {
      throw new HttpError(400, MSG_FATURA_NEGATIVA);
    }
    const criada = await prisma.conta.create({
      data: {
        nome: dados.nome,
        tipo: dados.tipo,
        instituicao: dados.instituicao ?? null,
        numero: dados.numero ?? null,
        saldo: dados.saldo ?? 0,
        cor: dados.cor ?? '#2563eb',
        bandeira: ehCartao ? (dados.bandeira ?? null) : null,
        limite: ehCartao ? (dados.limite ?? null) : null,
        diaFechamento: ehCartao ? (dados.diaFechamento ?? null) : null,
        diaVencimento: ehCartao ? (dados.diaVencimento ?? null) : null,
      },
    });
    await registrarPosicaoPatrimonio();
    res.status(201).json(contaDTO(criada));
  })
);

router.put(
  '/contas/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const conta = await prisma.conta.findUnique({ where: { id } });
    if (!conta) throw new HttpError(404, 'Conta não encontrada');

    // Corpo bruto: qualquer chave fora de nome, cor e ativo é recusada numa conta do Open Finance.
    const corpo: Record<string, unknown> = typeof req.body === 'object' && req.body !== null ? req.body : {};
    if (conta.origem === 'OPEN_FINANCE') {
      const outras = Object.keys(corpo).filter(
        (chave) => !CAMPOS_OPEN_FINANCE.includes(chave) && corpo[chave] !== undefined
      );
      if (outras.length > 0) throw new HttpError(400, MSG_OPEN_FINANCE);
    }

    const dados = validar(atualizarSchema, req.body);
    const alteracoes: Prisma.ContaUpdateInput = {};
    if (dados.nome !== undefined) alteracoes.nome = dados.nome;
    if (dados.instituicao !== undefined) alteracoes.instituicao = dados.instituicao;
    if (dados.numero !== undefined) alteracoes.numero = dados.numero;
    if (dados.cor !== undefined) alteracoes.cor = dados.cor;
    if (dados.ativo !== undefined) alteracoes.ativo = dados.ativo;
    if (dados.bandeira !== undefined) alteracoes.bandeira = dados.bandeira;
    if (dados.limite !== undefined) alteracoes.limite = dados.limite;
    if (dados.diaFechamento !== undefined) alteracoes.diaFechamento = dados.diaFechamento;
    if (dados.diaVencimento !== undefined) alteracoes.diaVencimento = dados.diaVencimento;

    const atualizada = await prisma.conta.update({ where: { id }, data: alteracoes });
    await registrarPosicaoPatrimonio();
    res.json(contaDTO(atualizada));
  })
);

router.put(
  '/contas/:id/saldo',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const conta = await prisma.conta.findUnique({ where: { id } });
    if (!conta) throw new HttpError(404, 'Conta não encontrada');
    if (conta.origem === 'OPEN_FINANCE') throw new HttpError(400, MSG_OPEN_FINANCE);

    const { saldo } = validar(saldoSchema, req.body);
    if (conta.tipo === 'CARTAO' && saldo < 0) throw new HttpError(400, MSG_FATURA_NEGATIVA);

    const atualizada = await prisma.conta.update({ where: { id }, data: { saldo } });
    await registrarPosicaoPatrimonio();
    res.json(contaDTO(atualizada));
  })
);

router.delete(
  '/contas/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const conta = await prisma.conta.findUnique({ where: { id } });
    if (!conta) throw new HttpError(404, 'Conta não encontrada');
    if (conta.origem === 'OPEN_FINANCE') {
      throw new HttpError(400, 'Esta conta vem do Open Finance. Para removê-la, remova a conexão em Conexões.');
    }
    await prisma.conta.delete({ where: { id } });
    await registrarPosicaoPatrimonio();
    res.status(204).end();
  })
);

export default router;
