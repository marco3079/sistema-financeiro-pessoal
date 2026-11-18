import { Router } from 'express';
import { z } from 'zod';
import type { Automacao, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import {
  ACOES_AUTOMACAO,
  TIPOS_AUTOMACAO,
  aplicarAutomacoes,
  avaliarAutomacoes,
  configSchema,
  criarAutomacoesPadrao,
  ehAcao,
  ehTipo,
  lerConfig,
  temCondicao,
} from '../../lib/automacoes';
import type { AcaoAutomacao, ConfigAutomacao, TipoAutomacao } from '../../lib/automacoes';

// Automações: condições + ação aplicadas aos lançamentos. A lógica de casamento fica em lib/automacoes.ts.

const router = Router();

const LIMITE_POR_PERFIL = 50;
const LIMITE_PREVIA = 300;

const nomeSchema = z.string().trim().min(1, 'Informe o nome da automação').max(80, 'O nome pode ter no máximo 80 caracteres');
const categoriaIdSchema = z.number().int().positive().nullable().optional();

const criarSchema = z.object({
  nome: nomeSchema,
  tipo: z.enum(TIPOS_AUTOMACAO),
  acao: z.enum(ACOES_AUTOMACAO),
  categoriaId: categoriaIdSchema,
  config: configSchema,
  ativa: z.boolean().optional(),
});

const atualizarSchema = z.object({
  nome: nomeSchema.optional(),
  tipo: z.enum(TIPOS_AUTOMACAO).optional(),
  acao: z.enum(ACOES_AUTOMACAO).optional(),
  categoriaId: categoriaIdSchema,
  config: configSchema.optional(),
  ativa: z.boolean().optional(),
  ordem: z.number().int().min(0).max(999999).optional(),
});

const automacaoIdSchema = z.object({
  automacaoId: z.number().int().positive().optional(),
});

interface AutomacaoDTO {
  id: number;
  nome: string;
  tipo: string;
  acao: string;
  categoriaId: number | null;
  categoriaNome: string | null;
  config: ConfigAutomacao;
  ativa: boolean;
  ordem: number;
  padrao: string | null;
  aplicados: number;
}

// Formato da resposta: inclui o nome da categoria e quantos lançamentos cada automação já alterou.
async function paraDTOs(lista: Automacao[]): Promise<AutomacaoDTO[]> {
  const idsDeCategoria = lista.flatMap((a) => (a.categoriaId !== null ? [a.categoriaId] : []));
  const [categorias, contagens] = await Promise.all([
    prisma.categoria.findMany({ where: { id: { in: idsDeCategoria } }, select: { id: true, nome: true } }),
    prisma.transacao.groupBy({
      by: ['automacaoId'],
      where: { automacaoId: { not: null } },
      _count: { _all: true },
    }),
  ]);
  const nomePorCategoria = new Map<number, string>(categorias.map((c) => [c.id, c.nome] as const));
  const aplicadosPor = new Map<number, number>();
  for (const g of contagens) {
    if (g.automacaoId !== null) aplicadosPor.set(g.automacaoId, g._count._all);
  }
  return lista.map((a) => ({
    id: a.id,
    nome: a.nome,
    tipo: a.tipo,
    acao: a.acao,
    categoriaId: a.categoriaId,
    categoriaNome: a.categoriaId !== null ? (nomePorCategoria.get(a.categoriaId) ?? null) : null,
    config: lerConfig(a.config),
    ativa: a.ativa,
    ordem: a.ordem,
    padrao: a.padrao,
    aplicados: aplicadosPor.get(a.id) ?? 0,
  }));
}

// Regras que dependem de mais de um campo (mesmas valem na criação e na edição).
async function conferir(dados: {
  tipo: TipoAutomacao;
  acao: AcaoAutomacao;
  categoriaId: number | null;
  config: ConfigAutomacao;
}): Promise<void> {
  if (dados.tipo === 'TEXTO' && (dados.config.textos ?? []).length === 0) {
    throw new HttpError(400, 'Informe pelo menos um trecho da descrição');
  }
  if (dados.tipo === 'COMBINADA' && !temCondicao(dados.config)) {
    throw new HttpError(400, 'Informe pelo menos uma condição');
  }
  if (dados.acao === 'CATEGORIA' && ['PAR_CONTAS', 'PAR_MESMA_CONTA', 'ESTORNO'].includes(dados.tipo)) {
    throw new HttpError(
      400,
      'A ação de definir categoria não funciona com automações de par. Use Descrição contém, Condições combinadas, Pagamento de fatura ou Investimento.'
    );
  }
  if (dados.acao === 'CATEGORIA') {
    if (dados.categoriaId === null) throw new HttpError(400, 'Escolha a categoria da ação');
    const categoria = await prisma.categoria.findUnique({ where: { id: dados.categoriaId }, select: { id: true } });
    if (!categoria) throw new HttpError(400, 'Categoria não encontrada');
  }
}

// Ação que cada automação desfaz: o que ela mudou nos lançamentos volta ao normal.
function dadosDoDesfazer(acao: string): Prisma.TransacaoUncheckedUpdateManyInput {
  if (acao === 'CATEGORIA') return { categoriaId: null, automacaoId: null };
  if (acao === 'ESCONDER') return { transferencia: false, oculto: false, automacaoId: null };
  return { transferencia: false, automacaoId: null };
}

async function garantirExiste(id: number): Promise<Automacao> {
  const automacao = await prisma.automacao.findUnique({ where: { id } });
  if (!automacao) throw new HttpError(404, 'Automação não encontrada');
  return automacao;
}

router.get(
  '/automacoes',
  asyncHandler(async (_req, res) => {
    const lista = await prisma.automacao.findMany({ orderBy: [{ ordem: 'asc' }, { id: 'asc' }] });
    res.json(await paraDTOs(lista));
  })
);

router.post(
  '/automacoes',
  asyncHandler(async (req, res) => {
    const dados = validar(criarSchema, req.body);
    const total = await prisma.automacao.count();
    if (total >= LIMITE_POR_PERFIL) {
      throw new HttpError(400, `Limite de ${LIMITE_POR_PERFIL} automações por perfil atingido`);
    }
    const categoriaId = dados.acao === 'CATEGORIA' ? (dados.categoriaId ?? null) : null;
    await conferir({ tipo: dados.tipo, acao: dados.acao, categoriaId, config: dados.config });
    const maior = await prisma.automacao.aggregate({ _max: { ordem: true } });
    const criada = await prisma.automacao.create({
      data: {
        nome: dados.nome,
        tipo: dados.tipo,
        acao: dados.acao,
        categoriaId,
        config: dados.config as Prisma.InputJsonValue,
        ativa: dados.ativa ?? true,
        ordem: (maior._max.ordem ?? 0) + 1,
      },
    });
    const [dto] = await paraDTOs([criada]);
    res.status(201).json(dto);
  })
);

// Cria as automações padrão que ainda não existem. Vem antes de /automacoes/:id.
router.post(
  '/automacoes/padrao',
  asyncHandler(async (_req, res) => {
    res.status(201).json({ criadas: await criarAutomacoesPadrao() });
  })
);

router.post(
  '/automacoes/previa',
  asyncHandler(async (req, res) => {
    const { automacaoId } = validar(automacaoIdSchema, req.body ?? {});
    if (automacaoId !== undefined) await garantirExiste(automacaoId);
    // Com automacaoId, avalia só ela, mesmo desligada. Sem desde: todo o histórico. Não grava.
    const propostas = await avaliarAutomacoes({ automacaoId, incluirInativas: automacaoId !== undefined });
    res.json({
      propostas: propostas.slice(0, LIMITE_PREVIA),
      total: propostas.length,
      lancamentos: propostas.reduce((soma, p) => soma + p.lancamentos.length, 0),
    });
  })
);

router.post(
  '/automacoes/aplicar',
  asyncHandler(async (req, res) => {
    const { automacaoId } = validar(automacaoIdSchema, req.body ?? {});
    if (automacaoId !== undefined) {
      const automacao = await garantirExiste(automacaoId);
      if (!automacao.ativa) throw new HttpError(400, 'Ative a automação antes de aplicar');
    }
    res.json(await aplicarAutomacoes({ automacaoId }));
  })
);

router.post(
  '/automacoes/:id/desfazer',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const automacao = await garantirExiste(id);
    if (automacao.acao === 'CATEGORIA') {
      // A categoria que a pessoa trocou à mão depois da automação fica: o lançamento só deixa de ser dela.
      await prisma.transacao.updateMany({
        where: { automacaoId: id, NOT: { categoriaId: automacao.categoriaId } },
        data: { automacaoId: null },
      });
    }
    const desfeitos = await prisma.transacao.updateMany({
      where: { automacaoId: id },
      data: dadosDoDesfazer(automacao.acao),
    });
    res.json({ desfeitos: desfeitos.count });
  })
);

router.put(
  '/automacoes/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(atualizarSchema, req.body);
    const atual = await garantirExiste(id);
    if (!ehTipo(atual.tipo) || !ehAcao(atual.acao)) {
      throw new HttpError(400, 'Automação com dados inválidos. Apague e crie de novo.');
    }
    const tipo: TipoAutomacao = dados.tipo ?? atual.tipo;
    const acao: AcaoAutomacao = dados.acao ?? atual.acao;
    if (acao !== atual.acao) {
      const usadas = await prisma.transacao.count({ where: { automacaoId: id } });
      if (usadas > 0) throw new HttpError(400, 'Desfaça o que a automação fez antes de trocar a ação');
    }
    const categoriaAtual = dados.categoriaId !== undefined ? dados.categoriaId : atual.categoriaId;
    const categoriaId = acao === 'CATEGORIA' ? (categoriaAtual ?? null) : null;
    const config = dados.config ?? lerConfig(atual.config);
    await conferir({ tipo, acao, categoriaId, config });
    const atualizada = await prisma.automacao.update({
      where: { id },
      data: {
        nome: dados.nome,
        tipo,
        acao,
        categoriaId,
        config: config as Prisma.InputJsonValue,
        ativa: dados.ativa,
        ordem: dados.ordem,
      },
    });
    const [dto] = await paraDTOs([atualizada]);
    res.json(dto);
  })
);

// Apaga a automação. Os lançamentos dela continuam como estão, só perdem a marca de automação.
router.delete(
  '/automacoes/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const automacao = await garantirExiste(id);
    await prisma.$transaction(async (tx) => {
      // Esconder sem desfazer deixaria lançamentos ocultos sem volta: desfaz antes de apagar.
      const dados: Prisma.TransacaoUncheckedUpdateManyInput =
        automacao.acao === 'ESCONDER'
          ? { transferencia: false, oculto: false, automacaoId: null }
          : { automacaoId: null };
      await tx.transacao.updateMany({ where: { automacaoId: id }, data: dados });
      await tx.automacao.delete({ where: { id } });
    });
    res.status(204).end();
  })
);

export default router;
