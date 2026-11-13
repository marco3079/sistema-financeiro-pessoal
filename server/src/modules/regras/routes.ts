import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { arredondar, dataISO, num } from '../../lib/financas';

// Regras de categoria: "quando a descrição contiver X, use a categoria Y".
// A importação já aplica essas regras; aqui fica o cadastro e o reprocessamento dos lançamentos que já existem.
// Comparação de texto sempre sem acento e sem maiúsculas.

const router = Router();

const LIMITE_ITENS = 2000;
const DIA_MS = 24 * 60 * 60 * 1000;

const trechoSchema = z
  .string()
  .trim()
  .min(2, 'O trecho precisa ter pelo menos 2 caracteres')
  .max(60, 'O trecho pode ter no máximo 60 caracteres');

const criarSchema = z.object({
  trecho: trechoSchema,
  categoriaId: z.number().int().positive(),
});

const atualizarSchema = z.object({
  trecho: trechoSchema.optional(),
  categoriaId: z.number().int().positive().optional(),
});

const reprocessarSchema = z.object({
  aplicar: z.boolean(),
  sobrescrever: z.boolean(),
});

function semAcento(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Lançamentos que não são transferência, do mais antigo para o mais novo.
async function lancamentosNormais() {
  return prisma.transacao.findMany({
    where: { transferencia: false },
    orderBy: [{ data: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      data: true,
      descricao: true,
      valor: true,
      tipo: true,
      contaId: true,
      categoriaId: true,
      conta: { select: { nome: true, tipo: true } },
      categoria: { select: { nome: true } },
    },
  });
}

type Lancamento = Awaited<ReturnType<typeof lancamentosNormais>>[number];

// Regras cuja categoria ainda existe (as de categoria apagada são descartadas).
async function regrasValidas() {
  const [regras, categorias] = await Promise.all([
    prisma.regraCategoria.findMany({ orderBy: { id: 'asc' } }),
    prisma.categoria.findMany({ select: { id: true, nome: true, tipo: true, cor: true } }),
  ]);
  const categoriaPorId = new Map(categorias.map((c) => [c.id, c]));
  return regras.flatMap((regra) => {
    const categoria = categoriaPorId.get(regra.categoriaId);
    if (!categoria) return [];
    return [{ id: regra.id, trecho: regra.trecho, texto: semAcento(regra.trecho), categoria }];
  });
}

type RegraValida = Awaited<ReturnType<typeof regrasValidas>>[number];

function itemDaRegra(regra: RegraValida, lancamentos: number) {
  return {
    id: regra.id,
    trecho: regra.trecho,
    categoriaId: regra.categoria.id,
    categoriaNome: regra.categoria.nome,
    categoriaCor: regra.categoria.cor,
    categoriaTipo: regra.categoria.tipo,
    lancamentos,
  };
}

// Quantos lançamentos (não transferência) têm a descrição contendo o trecho de cada regra.
async function listarRegras() {
  const [regras, lancamentos] = await Promise.all([regrasValidas(), lancamentosNormais()]);
  const contagem = new Map<number, number>(regras.map((r) => [r.id, 0]));
  const descricoes = lancamentos.map((l) => semAcento(l.descricao));
  for (const descricao of descricoes) {
    for (const regra of regras) {
      if (descricao.includes(regra.texto)) contagem.set(regra.id, (contagem.get(regra.id) ?? 0) + 1);
    }
  }
  return regras.map((regra) => itemDaRegra(regra, contagem.get(regra.id) ?? 0));
}

// Trecho já usado por outra regra (sem acento e sem maiúsculas).
async function trechoRepetido(trecho: string, ignorarId?: number): Promise<boolean> {
  const alvo = semAcento(trecho);
  const existentes = await prisma.regraCategoria.findMany({ select: { id: true, trecho: true } });
  return existentes.some((r) => r.id !== ignorarId && semAcento(r.trecho) === alvo);
}

async function categoriaExiste(categoriaId: number): Promise<boolean> {
  return (await prisma.categoria.findUnique({ where: { id: categoriaId }, select: { id: true } })) !== null;
}

router.get(
  '/regras',
  asyncHandler(async (_req, res) => {
    res.json(await listarRegras());
  })
);

router.post(
  '/regras',
  asyncHandler(async (req, res) => {
    const dados = validar(criarSchema, req.body);
    if (!(await categoriaExiste(dados.categoriaId))) throw new HttpError(400, 'Categoria não encontrada');
    if (await trechoRepetido(dados.trecho)) throw new HttpError(409, 'Já existe uma regra com esse trecho');
    const criada = await prisma.regraCategoria.create({
      data: { trecho: dados.trecho, categoriaId: dados.categoriaId },
    });
    const item = (await listarRegras()).find((r) => r.id === criada.id);
    res.status(201).json(item ?? { id: criada.id, trecho: criada.trecho, categoriaId: criada.categoriaId, lancamentos: 0 });
  })
);

// Prévia ou aplicação da regra nos lançamentos que já existem.
router.post(
  '/regras/reprocessar',
  asyncHandler(async (req, res) => {
    const { aplicar, sobrescrever } = validar(reprocessarSchema, req.body);
    const [regras, lancamentos] = await Promise.all([regrasValidas(), lancamentosNormais()]);

    // Primeira regra (por id) que casa com a descrição e cuja categoria tem o mesmo tipo do lançamento.
    function regraPara(l: Lancamento, descricao: string): RegraValida | null {
      return regras.find((r) => r.categoria.tipo === l.tipo && descricao.includes(r.texto)) ?? null;
    }

    // 1) Categorizar: sem categoria, ou todos que mudariam quando sobrescrever.
    const categorizarInterno: { lancamento: Lancamento; regra: RegraValida }[] = [];
    for (const l of lancamentos) {
      if (l.categoriaId !== null && !sobrescrever) continue;
      const regra = regraPara(l, semAcento(l.descricao));
      if (!regra || regra.categoria.id === l.categoriaId) continue;
      categorizarInterno.push({ lancamento: l, regra });
    }

    // 2) Transferências: Pix pago no crédito (crédito "Valor adicionado ... crédito" + despesa "pix" na mesma conta).
    const creditos = lancamentos.filter((l) => {
      if (l.tipo !== 'RECEITA' || l.conta.tipo === 'CARTAO') return false;
      const d = semAcento(l.descricao);
      return d.includes('valor adicionado') && d.includes('credito');
    });
    const pixDespesas = lancamentos.filter(
      (l) => l.tipo === 'DESPESA' && l.conta.tipo !== 'CARTAO' && /\bpix\b/.test(semAcento(l.descricao))
    );

    const usados = new Set<number>();
    const pares: { credito: Lancamento; despesa: Lancamento }[] = [];
    for (const despesa of pixDespesas) {
      let melhor: Lancamento | null = null;
      let melhorDias = Infinity;
      for (const credito of creditos) {
        if (usados.has(credito.id) || credito.contaId !== despesa.contaId) continue;
        if (Math.abs(num(credito.valor) - num(despesa.valor)) > 0.005) continue;
        const dias = Math.round((despesa.data.getTime() - credito.data.getTime()) / DIA_MS);
        if (dias < 0 || dias > 2) continue;
        if (dias < melhorDias) {
          melhor = credito;
          melhorDias = dias;
        }
      }
      if (melhor) {
        usados.add(melhor.id);
        pares.push({ credito: melhor, despesa });
      }
    }

    const pernasDasTransferencias = pares
      .flatMap((p) => [p.credito, p.despesa])
      .sort((a, b) => a.data.getTime() - b.data.getTime() || a.id - b.id);

    const categorizarTodos = categorizarInterno.map(({ lancamento: l, regra }) => ({
      id: l.id,
      data: dataISO(l.data),
      descricao: l.descricao,
      valor: arredondar(num(l.valor)),
      tipo: l.tipo,
      categoriaAtual: l.categoria?.nome ?? null,
      categoriaNova: regra.categoria.nome,
    }));
    const transferenciasTodas = pernasDasTransferencias.map((l) => ({
      id: l.id,
      data: dataISO(l.data),
      descricao: l.descricao,
      valor: arredondar(num(l.valor)),
      tipo: l.tipo,
      contaNome: l.conta.nome,
    }));

    if (aplicar) {
      const porCategoria = new Map<number, number[]>();
      for (const { lancamento: l, regra } of categorizarInterno) {
        const ids = porCategoria.get(regra.categoria.id) ?? [];
        ids.push(l.id);
        porCategoria.set(regra.categoria.id, ids);
      }
      const idsTransferencia = pernasDasTransferencias.map((l) => l.id);
      await prisma.$transaction(async (tx) => {
        for (const [categoriaId, ids] of porCategoria) {
          await tx.transacao.updateMany({ where: { id: { in: ids } }, data: { categoriaId } });
        }
        if (idsTransferencia.length > 0) {
          await tx.transacao.updateMany({ where: { id: { in: idsTransferencia } }, data: { transferencia: true } });
        }
      });
    }

    res.json({
      categorizar: categorizarTodos.slice(0, LIMITE_ITENS),
      transferencias: transferenciasTodas.slice(0, LIMITE_ITENS),
      aplicado: aplicar,
    });
  })
);

router.put(
  '/regras/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(atualizarSchema, req.body);
    const existente = await prisma.regraCategoria.findUnique({ where: { id }, select: { id: true } });
    if (!existente) throw new HttpError(404, 'Regra não encontrada');
    if (dados.categoriaId !== undefined && !(await categoriaExiste(dados.categoriaId))) {
      throw new HttpError(400, 'Categoria não encontrada');
    }
    if (dados.trecho !== undefined && (await trechoRepetido(dados.trecho, id))) {
      throw new HttpError(409, 'Já existe uma regra com esse trecho');
    }
    await prisma.regraCategoria.update({
      where: { id },
      data: { trecho: dados.trecho, categoriaId: dados.categoriaId },
    });
    const item = (await listarRegras()).find((r) => r.id === id);
    res.json(item ?? null);
  })
);

router.delete(
  '/regras/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const apagadas = await prisma.regraCategoria.deleteMany({ where: { id } });
    if (apagadas.count === 0) throw new HttpError(404, 'Regra não encontrada');
    res.status(204).end();
  })
);

export default router;
