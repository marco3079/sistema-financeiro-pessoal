import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import {
  arredondar,
  dataSchema,
  dinheiroSchema,
  hoje,
  investimentoDTO,
  movimentoDTO,
  num,
  paraData,
  registrarPosicaoPatrimonio,
  textoCurto,
  textoOpcional,
  textoQuery,
} from '../../lib/financas';
import type { Db } from '../../lib/financas';

const router = Router();

const TIPOS = ['RENDA_FIXA', 'FUNDO', 'ACAO', 'FII', 'ETF', 'PREVIDENCIA', 'CRIPTO', 'OUTRO'] as const;
const TIPOS_MOVIMENTO = ['APLICACAO', 'RESGATE', 'RENDIMENTO', 'IMPOSTO'] as const;
const MENSAGEM_OF = 'Este registro vem do Open Finance e é atualizado automaticamente.';

// ---------- Validação ----------

const quantidadeSchema = z.number().finite().min(0).nullable().optional();

const criarSchema = z.object({
  nome: textoCurto,
  tipo: z.enum(TIPOS),
  codigo: textoOpcional,
  subtipo: textoOpcional,
  instituicao: textoOpcional,
  emissor: textoOpcional,
  taxa: textoOpcional,
  valorAplicado: dinheiroSchema,
  saldo: dinheiroSchema.optional(),
  quantidade: quantidadeSchema,
  vencimento: dataSchema.nullable().optional(),
});

const atualizarSchema = criarSchema.partial().extend({ ativo: z.boolean().optional() });

type DadosAtualizacao = z.infer<typeof atualizarSchema>;

const movimentoSchema = z.object({
  data: dataSchema,
  tipo: z.enum(TIPOS_MOVIMENTO),
  valor: dinheiroSchema.refine((v) => v > 0, 'O valor deve ser maior que zero'),
  quantidade: quantidadeSchema,
  descricao: textoOpcional,
});

// ---------- Auxiliares ----------

type TipoMovimento = (typeof TIPOS_MOVIMENTO)[number];

// Efeito de um movimento na posição: quanto somar ao saldo e ao valor aplicado.
interface Efeito {
  saldo: number;
  aplicado: number;
}

function efeito(tipo: TipoMovimento, valor: number): Efeito {
  switch (tipo) {
    case 'APLICACAO':
      return { saldo: valor, aplicado: valor };
    case 'RESGATE':
      return { saldo: -valor, aplicado: -valor };
    case 'RENDIMENTO':
      return { saldo: valor, aplicado: 0 };
    case 'IMPOSTO':
      return { saldo: -valor, aplicado: 0 };
  }
}

function efeitoInverso(e: Efeito): Efeito {
  return { saldo: -e.saldo, aplicado: -e.aplicado };
}

function chavesDoCorpo(corpo: unknown): string[] {
  return corpo !== null && typeof corpo === 'object' ? Object.keys(corpo) : [];
}

function tipoDeInvestimento(valor: unknown): (typeof TIPOS)[number] | undefined {
  return TIPOS.find((t) => t === valor);
}

// Converte o corpo validado da atualização no formato do Prisma (só as chaves presentes).
function dadosDeAtualizacao(dados: DadosAtualizacao): Prisma.InvestimentoUpdateInput {
  const { vencimento, ...resto } = dados;
  const saida: Prisma.InvestimentoUpdateInput = { ...resto };
  if (vencimento !== undefined) {
    saida.vencimento = vencimento === null ? null : paraData(vencimento);
  }
  return saida;
}

async function aplicarEfeito(db: Db, id: number, e: Efeito): Promise<void> {
  const atual = await db.investimento.findUnique({ where: { id } });
  if (!atual) throw new HttpError(404, 'Investimento não encontrado');
  await db.investimento.update({
    where: { id },
    data: {
      saldo: Math.max(0, arredondar(num(atual.saldo) + e.saldo)),
      valorAplicado: Math.max(0, arredondar(num(atual.valorAplicado) + e.aplicado)),
      dataPosicao: new Date(),
    },
  });
}

// ---------- Rotas ----------

router.get(
  '/investimentos',
  asyncHandler(async (req, res) => {
    const inativos = textoQuery(req.query.inativos) === 'true';
    const tipo = tipoDeInvestimento(textoQuery(req.query.tipo));

    const filtro: Prisma.InvestimentoWhereInput = inativos ? {} : { ativo: true };
    if (tipo) filtro.tipo = tipo;

    const lista = await prisma.investimento.findMany({
      where: filtro,
      orderBy: [{ tipo: 'asc' }, { saldo: 'desc' }],
    });

    const total = arredondar(lista.reduce((soma, i) => soma + num(i.saldo), 0));
    const aplicado = arredondar(lista.reduce((soma, i) => soma + num(i.valorAplicado), 0));
    const rendimento = arredondar(total - aplicado);

    const somaPorTipo = new Map<string, number>();
    for (const i of lista) {
      somaPorTipo.set(i.tipo, (somaPorTipo.get(i.tipo) ?? 0) + num(i.saldo));
    }
    const porTipo = [...somaPorTipo.entries()]
      .map(([tipoItem, soma]) => ({
        tipo: tipoItem,
        total: arredondar(soma),
        percentual: total > 0 ? Math.round((soma / total) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.total - a.total);

    res.json({ itens: lista.map(investimentoDTO), total, aplicado, rendimento, porTipo });
  })
);

router.get(
  '/investimentos/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const investimento = await prisma.investimento.findUnique({ where: { id } });
    if (!investimento) throw new HttpError(404, 'Investimento não encontrado');

    const movimentos = await prisma.movimentoInvestimento.findMany({
      where: { investimentoId: id },
      orderBy: [{ data: 'desc' }, { id: 'desc' }],
      take: 200,
    });

    res.json({ investimento: investimentoDTO(investimento), movimentos: movimentos.map(movimentoDTO) });
  })
);

router.post(
  '/investimentos',
  asyncHandler(async (req, res) => {
    const dados = validar(criarSchema, req.body);

    const criado = await prisma.$transaction(async (db) => {
      const investimento = await db.investimento.create({
        data: {
          nome: dados.nome,
          tipo: dados.tipo,
          codigo: dados.codigo ?? null,
          subtipo: dados.subtipo ?? null,
          instituicao: dados.instituicao ?? null,
          emissor: dados.emissor ?? null,
          taxa: dados.taxa ?? null,
          valorAplicado: dados.valorAplicado,
          saldo: dados.saldo ?? dados.valorAplicado,
          quantidade: dados.quantidade ?? null,
          vencimento: dados.vencimento ? paraData(dados.vencimento) : null,
          dataPosicao: new Date(),
        },
      });
      if (dados.valorAplicado > 0) {
        await db.movimentoInvestimento.create({
          data: {
            investimentoId: investimento.id,
            data: hoje(),
            tipo: 'APLICACAO',
            valor: dados.valorAplicado,
            descricao: 'Aplicação inicial',
          },
        });
      }
      return investimento;
    });

    await registrarPosicaoPatrimonio();
    res.status(201).json(investimentoDTO(criado));
  })
);

router.put(
  '/investimentos/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const atual = await prisma.investimento.findUnique({ where: { id } });
    if (!atual) throw new HttpError(404, 'Investimento não encontrado');

    if (atual.origem === 'OPEN_FINANCE' && chavesDoCorpo(req.body).some((c) => c !== 'nome' && c !== 'ativo')) {
      throw new HttpError(400, MENSAGEM_OF);
    }

    const dados = validar(atualizarSchema, req.body);
    const saldoMudou = dados.saldo !== undefined && dados.saldo !== num(atual.saldo);

    const atualizado = await prisma.investimento.update({
      where: { id },
      data: {
        ...dadosDeAtualizacao(dados),
        ...(saldoMudou ? { dataPosicao: new Date() } : {}),
      },
    });

    await registrarPosicaoPatrimonio();
    res.json(investimentoDTO(atualizado));
  })
);

router.delete(
  '/investimentos/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const atual = await prisma.investimento.findUnique({ where: { id } });
    if (!atual) throw new HttpError(404, 'Investimento não encontrado');
    if (atual.origem === 'OPEN_FINANCE') {
      throw new HttpError(400, 'Este investimento vem do Open Finance. Para removê-lo, remova a conexão em Conexões.');
    }

    await prisma.investimento.delete({ where: { id } });
    await registrarPosicaoPatrimonio();
    res.status(204).end();
  })
);

router.post(
  '/investimentos/:id/movimentos',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(movimentoSchema, req.body);
    const e = efeito(dados.tipo, dados.valor);

    const resultado = await prisma.$transaction(async (db) => {
      const atual = await db.investimento.findUnique({ where: { id } });
      if (!atual) throw new HttpError(404, 'Investimento não encontrado');
      if (atual.origem === 'OPEN_FINANCE') throw new HttpError(400, MENSAGEM_OF);

      const movimento = await db.movimentoInvestimento.create({
        data: {
          investimentoId: id,
          data: paraData(dados.data),
          tipo: dados.tipo,
          valor: dados.valor,
          quantidade: dados.quantidade ?? null,
          descricao: dados.descricao ?? null,
        },
      });
      const investimento = await db.investimento.update({
        where: { id },
        data: {
          saldo: Math.max(0, arredondar(num(atual.saldo) + e.saldo)),
          valorAplicado: Math.max(0, arredondar(num(atual.valorAplicado) + e.aplicado)),
          dataPosicao: new Date(),
        },
      });
      return { investimento, movimento };
    });

    await registrarPosicaoPatrimonio();
    res.status(201).json({
      investimento: investimentoDTO(resultado.investimento),
      movimento: movimentoDTO(resultado.movimento),
    });
  })
);

router.delete(
  '/investimentos/:id/movimentos/:movimentoId',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const movimentoId = idParam(req, 'movimentoId');

    await prisma.$transaction(async (db) => {
      const investimento = await db.investimento.findUnique({ where: { id } });
      if (!investimento) throw new HttpError(404, 'Investimento não encontrado');
      if (investimento.origem === 'OPEN_FINANCE') throw new HttpError(400, MENSAGEM_OF);

      const movimento = await db.movimentoInvestimento.findUnique({ where: { id: movimentoId } });
      if (!movimento || movimento.investimentoId !== id) {
        throw new HttpError(404, 'Movimento não encontrado');
      }

      await db.movimentoInvestimento.delete({ where: { id: movimentoId } });
      const inverso = efeitoInverso(efeito(movimento.tipo, num(movimento.valor)));
      await aplicarEfeito(db, id, inverso);
    });

    await registrarPosicaoPatrimonio();
    res.status(204).end();
  })
);

export default router;
