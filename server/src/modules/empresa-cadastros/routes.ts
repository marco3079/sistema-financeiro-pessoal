import { Router } from 'express';
import type { CentroDeCusto, Parceiro } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import {
  arredondar,
  corSchema,
  dataISO,
  dataSchema,
  intervaloDoMes,
  mesAtual,
  num,
  paraData,
  textoQuery,
} from '../../lib/financas';

// Clientes, fornecedores e centros de custo da empresa.
// O filtro por perfil financeiro é automático (lib/prisma.ts): nunca escreva perfilId aqui.

const router = Router();

const TIPOS_PARCEIRO = ['CLIENTE', 'FORNECEDOR', 'AMBOS'] as const;
const COR_PADRAO = '#64748b';
const DIA_MS = 24 * 60 * 60 * 1000;

// ---------- Esquemas ----------

const parceiroBaseSchema = z.object({
  nome: z.string().trim().min(1, 'Informe o nome').max(120, 'Nome: no máximo 120 caracteres'),
  tipo: z.enum(TIPOS_PARCEIRO),
  documento: z.string().max(30, 'Documento: use até 30 caracteres').nullable().optional(),
  email: z.string().max(120, 'E-mail: no máximo 120 caracteres').nullable().optional(),
  telefone: z.string().max(30, 'Telefone: no máximo 30 caracteres').nullable().optional(),
  observacao: z.string().max(500, 'Observação: no máximo 500 caracteres').nullable().optional(),
});

const atualizarParceiroSchema = parceiroBaseSchema.partial().extend({
  ativo: z.boolean().optional(),
});

const centroSchema = z.object({
  nome: z.string().trim().min(1, 'Informe o nome').max(60, 'Nome: no máximo 60 caracteres'),
  cor: corSchema.optional(),
  ativo: z.boolean().optional(),
});

const atualizarCentroSchema = centroSchema.partial();

const lancamentosSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1, 'Escolha ao menos um lançamento').max(500, 'No máximo 500 lançamentos por vez'),
  centroDeCustoId: z.number().int().positive().nullable(),
});

// ---------- Auxiliares ----------

// Texto opcional: vazio vira null; undefined continua undefined (não mexe no campo).
function limpar(valor: string | null | undefined): string | null | undefined {
  if (valor === undefined) return undefined;
  if (valor === null) return null;
  const limpo = valor.trim();
  return limpo === '' ? null : limpo;
}

// CPF ou CNPJ: guarda só os dígitos. Aceita vazio; com texto, precisa de 11 ou 14 números.
function documentoDe(valor: string | null | undefined): string | null | undefined {
  if (valor === undefined) return undefined;
  const bruto = (valor ?? '').trim();
  if (bruto === '') return null;
  const digitos = bruto.replace(/\D/g, '');
  if (digitos.length !== 11 && digitos.length !== 14) {
    throw new HttpError(400, 'CPF ou CNPJ: informe 11 ou 14 números');
  }
  return digitos;
}

// Outro cadastro com o mesmo nome (sem diferenciar maiúsculas). Conta os inativos também.
async function nomeRepetido(nome: string, ignorarId?: number): Promise<boolean> {
  const alvo = nome.trim().toLowerCase();
  const existentes = await prisma.parceiro.findMany({ select: { id: true, nome: true } });
  return existentes.some((p) => p.id !== ignorarId && p.nome.trim().toLowerCase() === alvo);
}

interface Aberto {
  titulos: number;
  saldo: number;
}

// Em aberto por parceiro: títulos não cancelados com saldo > 0. Duas consultas, para todos os parceiros de uma vez.
async function emAbertoPorParceiro(parceiroIds: number[]): Promise<Map<number, Aberto>> {
  const mapa = new Map<number, Aberto>();
  if (parceiroIds.length === 0) return mapa;

  const titulos = await prisma.titulo.findMany({
    where: { cancelado: false, parceiroId: { in: parceiroIds } },
    select: { id: true, parceiroId: true, valor: true },
  });
  if (titulos.length === 0) return mapa;

  const baixas = await prisma.baixaTitulo.groupBy({
    by: ['tituloId'],
    where: { tituloId: { in: titulos.map((t) => t.id) } },
    _sum: { valor: true },
  });
  const pagoPorTitulo = new Map(baixas.map((b) => [b.tituloId, num(b._sum.valor)]));

  for (const t of titulos) {
    if (t.parceiroId === null) continue;
    const saldo = arredondar(num(t.valor) - (pagoPorTitulo.get(t.id) ?? 0));
    if (saldo <= 0) continue;
    const atual = mapa.get(t.parceiroId) ?? { titulos: 0, saldo: 0 };
    atual.titulos += 1;
    atual.saldo = arredondar(atual.saldo + saldo);
    mapa.set(t.parceiroId, atual);
  }
  return mapa;
}

function parceiroDTO(p: Parceiro, aberto?: Aberto) {
  return {
    id: p.id,
    nome: p.nome,
    tipo: p.tipo,
    documento: p.documento,
    email: p.email,
    telefone: p.telefone,
    observacao: p.observacao,
    ativo: p.ativo,
    titulosEmAberto: aberto?.titulos ?? 0,
    saldoEmAberto: aberto?.saldo ?? 0,
  };
}

function centroDTO(c: CentroDeCusto) {
  return { id: c.id, nome: c.nome, cor: c.cor, ativo: c.ativo };
}

// ---------- Clientes e fornecedores ----------

router.get(
  '/parceiros',
  asyncHandler(async (req, res) => {
    const tipo = textoQuery(req.query.tipo);
    if (tipo !== undefined && tipo !== 'CLIENTE' && tipo !== 'FORNECEDOR') throw new HttpError(400, 'Tipo inválido');
    const busca = textoQuery(req.query.busca)?.toLowerCase();
    const inativos = req.query.inativos === 'true';

    // CLIENTE traz CLIENTE e AMBOS; FORNECEDOR traz FORNECEDOR e AMBOS.
    const where: { ativo?: boolean; tipo?: { in: string[] } } = {};
    if (!inativos) where.ativo = true;
    if (tipo === 'CLIENTE') where.tipo = { in: ['CLIENTE', 'AMBOS'] };
    if (tipo === 'FORNECEDOR') where.tipo = { in: ['FORNECEDOR', 'AMBOS'] };

    const parceiros = await prisma.parceiro.findMany({ where, orderBy: [{ nome: 'asc' }, { id: 'asc' }] });
    const filtrados = busca ? parceiros.filter((p) => p.nome.toLowerCase().includes(busca)) : parceiros;
    const abertos = await emAbertoPorParceiro(filtrados.map((p) => p.id));
    res.json(filtrados.map((p) => parceiroDTO(p, abertos.get(p.id))));
  })
);

router.post(
  '/parceiros',
  asyncHandler(async (req, res) => {
    const dados = validar(parceiroBaseSchema, req.body);
    const documento = documentoDe(dados.documento) ?? null;
    if (await nomeRepetido(dados.nome)) throw new HttpError(409, 'Já existe um cadastro com esse nome');
    const criado = await prisma.parceiro.create({
      data: {
        nome: dados.nome,
        tipo: dados.tipo,
        documento,
        email: limpar(dados.email) ?? null,
        telefone: limpar(dados.telefone) ?? null,
        observacao: limpar(dados.observacao) ?? null,
      },
    });
    res.status(201).json(parceiroDTO(criado));
  })
);

router.put(
  '/parceiros/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(atualizarParceiroSchema, req.body);
    const existente = await prisma.parceiro.findUnique({ where: { id }, select: { id: true } });
    if (!existente) throw new HttpError(404, 'Cadastro não encontrado');
    if (dados.nome !== undefined && (await nomeRepetido(dados.nome, id))) {
      throw new HttpError(409, 'Já existe um cadastro com esse nome');
    }
    const atualizado = await prisma.parceiro.update({
      where: { id },
      data: {
        nome: dados.nome,
        tipo: dados.tipo,
        documento: documentoDe(dados.documento),
        email: limpar(dados.email),
        telefone: limpar(dados.telefone),
        observacao: limpar(dados.observacao),
        ativo: dados.ativo,
      },
    });
    const abertos = await emAbertoPorParceiro([id]);
    res.json(parceiroDTO(atualizado, abertos.get(id)));
  })
);

router.delete(
  '/parceiros/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const existente = await prisma.parceiro.findUnique({ where: { id }, select: { id: true } });
    if (!existente) throw new HttpError(404, 'Cadastro não encontrado');
    const ligados = await prisma.titulo.count({ where: { parceiroId: id } });
    if (ligados > 0) throw new HttpError(409, 'Há contas ligadas a este cadastro; desative em vez de excluir');
    await prisma.parceiro.deleteMany({ where: { id } });
    res.status(204).end();
  })
);

// ---------- Centros de custo ----------

router.get(
  '/centros-de-custo',
  asyncHandler(async (req, res) => {
    const inativos = req.query.inativos === 'true';
    const centros = await prisma.centroDeCusto.findMany({
      where: inativos ? {} : { ativo: true },
      orderBy: [{ nome: 'asc' }, { id: 'asc' }],
    });
    res.json(centros.map(centroDTO));
  })
);

// Resultado por centro no período (padrão: mês atual). Só lançamentos reais: sem transferência, provento ou oculto.
router.get(
  '/centros-de-custo/resultado',
  asyncHandler(async (req, res) => {
    const { inicio, fim } = intervaloDoMes(mesAtual());
    const de = validar(dataSchema, textoQuery(req.query.de) ?? dataISO(inicio));
    const ate = validar(dataSchema, textoQuery(req.query.ate) ?? dataISO(new Date(fim.getTime() - DIA_MS)));
    if (de > ate) throw new HttpError(400, 'A data inicial é depois da final');

    const [centros, transacoes] = await Promise.all([
      prisma.centroDeCusto.findMany({ orderBy: [{ nome: 'asc' }, { id: 'asc' }] }),
      prisma.transacao.findMany({
        where: {
          transferencia: false,
          provento: false,
          oculto: false,
          data: { gte: paraData(de), lte: paraData(ate) },
        },
        select: { centroDeCustoId: true, tipo: true, valor: true },
      }),
    ]);

    type Soma = { receitas: number; despesas: number; lancamentos: number };
    const linhas = centros.map((c) => ({ centro: c, soma: { receitas: 0, despesas: 0, lancamentos: 0 } as Soma }));
    const porId = new Map(linhas.map((l) => [l.centro.id, l.soma]));
    const semCentro: Soma = { receitas: 0, despesas: 0, lancamentos: 0 };

    for (const t of transacoes) {
      const alvo = (t.centroDeCustoId !== null ? porId.get(t.centroDeCustoId) : undefined) ?? semCentro;
      const valor = num(t.valor);
      if (t.tipo === 'RECEITA') alvo.receitas += valor;
      else alvo.despesas += valor;
      alvo.lancamentos += 1;
    }

    const fechar = (s: Soma) => ({
      receitas: arredondar(s.receitas),
      despesas: arredondar(s.despesas),
      resultado: arredondar(s.receitas - s.despesas),
      lancamentos: s.lancamentos,
    });

    res.json({
      centros: linhas.map(({ centro, soma }) => ({ id: centro.id, nome: centro.nome, cor: centro.cor, ...fechar(soma) })),
      semCentro: fechar(semCentro),
    });
  })
);

// Põe (ou tira) o centro de vários lançamentos de uma vez. Declarada antes de /centros-de-custo/:id.
router.put(
  '/centros-de-custo/lancamentos',
  asyncHandler(async (req, res) => {
    const dados = validar(lancamentosSchema, req.body);
    if (dados.centroDeCustoId !== null) {
      const existe = await prisma.centroDeCusto.findUnique({
        where: { id: dados.centroDeCustoId },
        select: { id: true },
      });
      if (!existe) throw new HttpError(400, 'Centro de custo não encontrado');
    }
    const resultado = await prisma.transacao.updateMany({
      where: { id: { in: dados.ids } },
      data: { centroDeCustoId: dados.centroDeCustoId },
    });
    res.json({ alterados: resultado.count });
  })
);

router.post(
  '/centros-de-custo',
  asyncHandler(async (req, res) => {
    const dados = validar(centroSchema, req.body);
    const criado = await prisma.centroDeCusto.create({
      data: { nome: dados.nome, cor: dados.cor ?? COR_PADRAO, ativo: dados.ativo ?? true },
    });
    res.status(201).json(centroDTO(criado));
  })
);

router.put(
  '/centros-de-custo/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(atualizarCentroSchema, req.body);
    const existente = await prisma.centroDeCusto.findUnique({ where: { id }, select: { id: true } });
    if (!existente) throw new HttpError(404, 'Centro de custo não encontrado');
    const atualizado = await prisma.centroDeCusto.update({
      where: { id },
      data: { nome: dados.nome, cor: dados.cor, ativo: dados.ativo },
    });
    res.json(centroDTO(atualizado));
  })
);

// Apagar um centro tira o centro dos títulos e lançamentos dele (ficam em "Sem centro").
router.delete(
  '/centros-de-custo/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const existente = await prisma.centroDeCusto.findUnique({ where: { id }, select: { id: true } });
    if (!existente) throw new HttpError(404, 'Centro de custo não encontrado');
    await prisma.$transaction(async (tx) => {
      await tx.titulo.updateMany({ where: { centroDeCustoId: id }, data: { centroDeCustoId: null } });
      await tx.transacao.updateMany({ where: { centroDeCustoId: id }, data: { centroDeCustoId: null } });
      await tx.centroDeCusto.deleteMany({ where: { id } });
    });
    res.status(204).end();
  })
);

export default router;
