import { randomUUID } from 'crypto';
import express, { Router } from 'express';
import type { BaixaTitulo, Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import {
  arredondar,
  dataISO,
  dataSchema,
  dinheiroSchema,
  efeitoNoSaldo,
  hoje,
  inteiroQuery,
  num,
  paraData,
  registrarPosicaoPatrimonio,
  textoQuery,
  type Db,
} from '../../lib/financas';
import { listarTitulosDTO } from '../../lib/titulos';
import type { BaixaDTO, SituacaoTitulo, TituloDTO } from '../../lib/titulos';

const router = Router();

const DIA_MS = 24 * 60 * 60 * 1000;
const LIMITE_ITENS = 1000;
const MAX_ANEXOS = 5;
const LIMITE_ANEXO_BYTES = 2 * 1024 * 1024;
// Base64 de 2 MB dá ~2,8 milhões de caracteres: margem para o texto não passar disso.
const LIMITE_BASE64_CARACTERES = 2800000;

const NATUREZAS = ['PAGAR', 'RECEBER'] as const;
type Natureza = (typeof NATUREZAS)[number];
const naturezaSchema = z.enum(NATUREZAS);

const situacaoSchema = z.enum(['ABERTO', 'PARCIAL', 'QUITADO', 'VENCIDO', 'CANCELADO']);

const valorPositivo = dinheiroSchema.refine((v) => v > 0, 'O valor deve ser maior que zero');
const idOpcional = z.number().int().positive().nullable().optional();
const textoOpcionalLongo = (max: number) => z.string().trim().max(max).nullable().optional();

const criarTituloSchema = z.object({
  natureza: naturezaSchema,
  descricao: z.string().trim().min(1).max(200),
  valor: valorPositivo,
  emissao: dataSchema.optional(),
  vencimento: dataSchema,
  parceiroId: idOpcional,
  categoriaId: idOpcional,
  centroDeCustoId: idOpcional,
  contaId: idOpcional,
  documento: textoOpcionalLongo(60),
  observacao: textoOpcionalLongo(500),
  parcelas: z.number().int().min(1).max(60).optional(),
  recorrenciaMeses: z.number().int().min(0).max(36).optional(),
});

const editarTituloSchema = z.object({
  descricao: z.string().trim().min(1).max(200).optional(),
  valor: valorPositivo.optional(),
  emissao: dataSchema.optional(),
  vencimento: dataSchema.optional(),
  parceiroId: idOpcional,
  categoriaId: idOpcional,
  centroDeCustoId: idOpcional,
  contaId: idOpcional,
  documento: textoOpcionalLongo(60),
  observacao: textoOpcionalLongo(500),
});

const baixaSchema = z.object({
  data: dataSchema,
  valor: valorPositivo,
  juros: dinheiroSchema.optional(),
  multa: dinheiroSchema.optional(),
  desconto: dinheiroSchema.optional(),
  contaId: z.number().int().positive(),
  observacao: textoOpcionalLongo(500),
});

const anexoSchema = z.object({
  nome: z.string().trim().min(1).max(120),
  tipo: z.enum(['application/pdf', 'image/png', 'image/jpeg']),
  dados: z.string().min(1).max(LIMITE_BASE64_CARACTERES),
});

// ---------- Auxiliares ----------

function naturezaQuery(valor: unknown): Natureza | undefined {
  const resultado = naturezaSchema.safeParse(valor);
  return resultado.success ? resultado.data : undefined;
}

// Lê `situacao=ABERTO,VENCIDO` em um conjunto; vazio quando ausente.
function situacoesQuery(valor: unknown): Set<SituacaoTitulo> {
  const texto = textoQuery(valor);
  const situacoes = new Set<SituacaoTitulo>();
  if (texto === undefined) return situacoes;
  for (const parte of texto.split(',').map((p) => p.trim()).filter((p) => p !== '')) {
    const resultado = situacaoSchema.safeParse(parte);
    if (!resultado.success) throw new HttpError(400, 'Situação inválida');
    situacoes.add(resultado.data);
  }
  return situacoes;
}

// Resumo da lista: sem cancelados. "A vencer em 7 dias" = em aberto e vence de hoje até daqui a 7 dias.
function resumoDosTitulos(lista: TituloDTO[]) {
  const validos = lista.filter((t) => t.situacao !== 'CANCELADO');
  const limite7 = dataISO(new Date(hoje().getTime() + 7 * DIA_MS));
  let emAberto = 0;
  let vencido = 0;
  let aVencer7dias = 0;
  let quitadoNoPeriodo = 0;
  for (const t of validos) {
    if (t.situacao === 'QUITADO') {
      quitadoNoPeriodo += t.valor;
      continue;
    }
    emAberto += t.saldo;
    if (t.situacao === 'VENCIDO') vencido += t.saldo;
    else if (t.vencimento <= limite7) aVencer7dias += t.saldo;
  }
  return {
    emAberto: arredondar(emAberto),
    vencido: arredondar(vencido),
    aVencer7dias: arredondar(aVencer7dias),
    quitadoNoPeriodo: arredondar(quitadoNoPeriodo),
    quantidade: validos.length,
  };
}

async function dtoDoTitulo(id: number): Promise<TituloDTO> {
  const [titulo] = await listarTitulosDTO({ id });
  if (!titulo) throw new HttpError(404, 'Título não encontrado');
  return titulo;
}

// Quanto já foi pago do título: soma das baixas (sem juros e multa).
// Trava a linha do título até o fim da transação e devolve o estado atual dele.
// Sem isso, duas baixas ao mesmo tempo passariam as duas na conferência do saldo.
async function travarTitulo(db: Db, tituloId: number): Promise<{ valor: number; cancelado: boolean }> {
  await db.$queryRaw`SELECT id FROM "Titulo" WHERE id = ${tituloId} FOR UPDATE`;
  const atual = await db.titulo.findFirst({ where: { id: tituloId }, select: { valor: true, cancelado: true } });
  if (!atual) throw new HttpError(404, 'Título não encontrado');
  return { valor: arredondar(num(atual.valor)), cancelado: atual.cancelado };
}

async function somaDasBaixas(db: Db, tituloId: number): Promise<number> {
  const soma = await db.baixaTitulo.aggregate({ where: { tituloId }, _sum: { valor: true } });
  return arredondar(num(soma._sum.valor));
}

// Confere que os cadastros informados existem. A categoria tem de ser do tipo da natureza (PAGAR: despesa).
async function conferirReferencias(
  db: Db,
  natureza: Natureza,
  referencias: {
    parceiroId?: number | null;
    categoriaId?: number | null;
    centroDeCustoId?: number | null;
    contaId?: number | null;
  }
): Promise<void> {
  if (referencias.parceiroId) {
    const parceiro = await db.parceiro.findFirst({ where: { id: referencias.parceiroId }, select: { id: true } });
    if (!parceiro) throw new HttpError(404, 'Cliente ou fornecedor não encontrado');
  }
  if (referencias.categoriaId) {
    const categoria = await db.categoria.findFirst({ where: { id: referencias.categoriaId }, select: { tipo: true } });
    const tipoEsperado = natureza === 'PAGAR' ? 'DESPESA' : 'RECEITA';
    if (!categoria || categoria.tipo !== tipoEsperado) {
      throw new HttpError(400, natureza === 'PAGAR' ? 'Escolha uma categoria de despesa' : 'Escolha uma categoria de receita');
    }
  }
  if (referencias.centroDeCustoId) {
    const centro = await db.centroDeCusto.findFirst({ where: { id: referencias.centroDeCustoId }, select: { id: true } });
    if (!centro) throw new HttpError(404, 'Centro de custo não encontrado');
  }
  if (referencias.contaId) {
    const conta = await db.conta.findFirst({ where: { id: referencias.contaId }, select: { id: true } });
    if (!conta) throw new HttpError(404, 'Conta não encontrada');
  }
}

// Vencimento da parcela/repetição de ordem `deslocamento` (0 = a primeira). Dia 31 em mês curto vira o último dia.
function somarMesesData(base: Date, deslocamento: number): Date {
  const ano = base.getUTCFullYear();
  const mesAlvo = base.getUTCMonth() + deslocamento;
  const ultimoDia = new Date(Date.UTC(ano, mesAlvo + 1, 0)).getUTCDate();
  return new Date(Date.UTC(ano, mesAlvo, Math.min(base.getUTCDate(), ultimoDia)));
}

// Valor da parcela k (1 a n). A última leva o resto do arredondamento, para a soma fechar no total.
function valorDaParcela(total: number, n: number, k: number): number {
  const parcela = arredondar(total / n);
  return k < n ? parcela : arredondar(total - parcela * (n - 1));
}

function baixaDTO(baixa: BaixaTitulo, nomeDaConta: Map<number, string>): BaixaDTO {
  const valor = arredondar(num(baixa.valor));
  const juros = arredondar(num(baixa.juros));
  const multa = arredondar(num(baixa.multa));
  const desconto = arredondar(num(baixa.desconto));
  return {
    id: baixa.id,
    data: dataISO(baixa.data),
    valor,
    juros,
    multa,
    desconto,
    total: arredondar(valor + juros + multa - desconto),
    contaId: baixa.contaId,
    contaNome: nomeDaConta.get(baixa.contaId) ?? null,
    observacao: baixa.observacao,
  };
}

// Nome do arquivo no cabeçalho: só letras, números e alguns sinais.
function nomeDoArquivo(nome: string): string {
  return nome.replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 120) || 'anexo';
}

// ---------- Títulos ----------

router.get(
  '/titulos',
  asyncHandler(async (req, res) => {
    const natureza = naturezaQuery(req.query.natureza);
    if (!natureza) throw new HttpError(400, 'Informe a natureza: PAGAR ou RECEBER');
    const where: Prisma.TituloWhereInput = { natureza };

    const de = textoQuery(req.query.de);
    const ate = textoQuery(req.query.ate);
    if (de !== undefined || ate !== undefined) {
      if (de !== undefined && !dataSchema.safeParse(de).success) throw new HttpError(400, 'Período inválido');
      if (ate !== undefined && !dataSchema.safeParse(ate).success) throw new HttpError(400, 'Período inválido');
      where.vencimento = {
        ...(de !== undefined ? { gte: paraData(de) } : {}),
        ...(ate !== undefined ? { lte: paraData(ate) } : {}),
      };
    }

    const parceiroId = inteiroQuery(req.query.parceiroId);
    if (parceiroId !== undefined) where.parceiroId = parceiroId;

    const grupo = textoQuery(req.query.grupo);
    if (grupo !== undefined) where.grupo = grupo;

    const busca = textoQuery(req.query.busca);
    if (busca !== undefined) {
      where.OR = [
        { descricao: { contains: busca, mode: 'insensitive' } },
        { documento: { contains: busca, mode: 'insensitive' } },
      ];
    }

    const situacoes = situacoesQuery(req.query.situacao);
    const todos = await listarTitulosDTO(where);
    const filtrados = situacoes.size > 0 ? todos.filter((t) => situacoes.has(t.situacao)) : todos;

    res.json({
      itens: filtrados.slice(0, LIMITE_ITENS),
      resumo: resumoDosTitulos(filtrados),
    });
  })
);

router.get(
  '/titulos/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const titulo = await dtoDoTitulo(id);

    const baixas = await prisma.baixaTitulo.findMany({
      where: { tituloId: id },
      orderBy: [{ data: 'asc' }, { id: 'asc' }],
    });
    const idsDeContas = Array.from(new Set(baixas.map((b) => b.contaId)));
    const contas = await prisma.conta.findMany({ where: { id: { in: idsDeContas } }, select: { id: true, nome: true } });
    const nomeDaConta = new Map<number, string>(contas.map((c) => [c.id, c.nome] as const));

    const anexos = await prisma.anexoTitulo.findMany({
      where: { tituloId: id },
      select: { id: true, nome: true, tipo: true, tamanho: true },
      orderBy: { id: 'asc' },
    });

    res.json({
      ...titulo,
      baixas: baixas.map((b) => baixaDTO(b, nomeDaConta)),
      anexosLista: anexos,
    });
  })
);

router.post(
  '/titulos',
  asyncHandler(async (req, res) => {
    const dados = validar(criarTituloSchema, req.body);
    const parcelas = dados.parcelas ?? 1;
    const repeticoes = dados.recorrenciaMeses ?? 0;
    if (parcelas > 1 && repeticoes > 0) {
      throw new HttpError(400, 'Parcelar e repetir todo mês não podem ser usados juntos');
    }
    const valor = arredondar(dados.valor);
    if (valor <= 0) throw new HttpError(400, 'O valor deve ser maior que zero');
    if (parcelas > 1 && (arredondar(valor / parcelas) < 0.01 || valorDaParcela(valor, parcelas, parcelas) <= 0)) {
      throw new HttpError(400, 'O valor é pequeno demais para dividir em tantas parcelas');
    }

    const emissao = dados.emissao ? paraData(dados.emissao) : hoje();
    const vencimento = paraData(dados.vencimento);
    const quantidade = parcelas > 1 ? parcelas : repeticoes + 1;
    const grupo = quantidade > 1 ? randomUUID() : null;
    const documento = dados.documento || null;
    const observacao = dados.observacao || null;

    const ids = await prisma.$transaction(async (db) => {
      await conferirReferencias(db, dados.natureza, dados);
      const criados: number[] = [];
      for (let k = 0; k < quantidade; k++) {
        const criado = await db.titulo.create({
          data: {
            natureza: dados.natureza,
            descricao: dados.descricao,
            parceiroId: dados.parceiroId ?? null,
            categoriaId: dados.categoriaId ?? null,
            centroDeCustoId: dados.centroDeCustoId ?? null,
            contaId: dados.contaId ?? null,
            valor: parcelas > 1 ? valorDaParcela(valor, parcelas, k + 1) : valor,
            emissao,
            vencimento: somarMesesData(vencimento, k),
            documento,
            parcela: parcelas > 1 ? k + 1 : null,
            totalParcelas: parcelas > 1 ? parcelas : null,
            grupo,
            recorrente: repeticoes > 0,
            observacao,
          },
          select: { id: true },
        });
        criados.push(criado.id);
      }
      return criados;
    });

    const criados = await listarTitulosDTO({ id: { in: ids } });
    res.status(201).json({ criados });
  })
);

router.put(
  '/titulos/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(editarTituloSchema, req.body);

    const atual = await prisma.titulo.findFirst({ where: { id }, select: { natureza: true, cancelado: true } });
    if (!atual) throw new HttpError(404, 'Título não encontrado');
    if (atual.cancelado) throw new HttpError(400, 'Título cancelado não se edita');
    const natureza: Natureza = atual.natureza === 'PAGAR' ? 'PAGAR' : 'RECEBER';

    await prisma.$transaction(async (db) => {
      const travado = await travarTitulo(db, id);
      if (travado.cancelado) throw new HttpError(400, 'Título cancelado não se edita');
      await conferirReferencias(db, natureza, dados);
      if (dados.valor !== undefined) {
        const pago = await somaDasBaixas(db, id);
        if (arredondar(dados.valor) < pago) throw new HttpError(400, 'O valor não pode ser menor que o já pago');
      }

      const alteracoes: Prisma.TituloUncheckedUpdateInput = {};
      if (dados.descricao !== undefined) alteracoes.descricao = dados.descricao;
      if (dados.valor !== undefined) alteracoes.valor = arredondar(dados.valor);
      if (dados.emissao !== undefined) alteracoes.emissao = paraData(dados.emissao);
      if (dados.vencimento !== undefined) alteracoes.vencimento = paraData(dados.vencimento);
      if (dados.parceiroId !== undefined) alteracoes.parceiroId = dados.parceiroId;
      if (dados.categoriaId !== undefined) alteracoes.categoriaId = dados.categoriaId;
      if (dados.centroDeCustoId !== undefined) alteracoes.centroDeCustoId = dados.centroDeCustoId;
      if (dados.contaId !== undefined) alteracoes.contaId = dados.contaId;
      if (dados.documento !== undefined) alteracoes.documento = dados.documento || null;
      if (dados.observacao !== undefined) alteracoes.observacao = dados.observacao || null;

      await db.titulo.update({ where: { id }, data: alteracoes });
    });

    res.json(await dtoDoTitulo(id));
  })
);

router.post(
  '/titulos/:id/cancelar',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const titulo = await prisma.titulo.findFirst({ where: { id }, select: { id: true } });
    if (!titulo) throw new HttpError(404, 'Título não encontrado');
    await prisma.$transaction(async (db) => {
      await travarTitulo(db, id);
      const baixas = await db.baixaTitulo.count({ where: { tituloId: id } });
      if (baixas > 0) throw new HttpError(400, 'Estorne as baixas antes de cancelar');
      await db.titulo.update({ where: { id }, data: { cancelado: true } });
    });
    res.json(await dtoDoTitulo(id));
  })
);

router.post(
  '/titulos/:id/reabrir',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const titulo = await prisma.titulo.findFirst({ where: { id }, select: { id: true } });
    if (!titulo) throw new HttpError(404, 'Título não encontrado');
    await prisma.titulo.update({ where: { id }, data: { cancelado: false } });
    res.json(await dtoDoTitulo(id));
  })
);

router.delete(
  '/titulos/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const titulo = await prisma.titulo.findFirst({ where: { id }, select: { id: true, grupo: true } });
    if (!titulo) throw new HttpError(404, 'Título não encontrado');
    const baixas = await prisma.baixaTitulo.count({ where: { tituloId: id } });
    if (baixas > 0) throw new HttpError(400, 'Estorne as baixas antes de excluir');

    const apagar: number[] = [id];
    if (textoQuery(req.query.grupo) === 'true' && titulo.grupo) {
      // Os outros títulos do grupo entram só se não têm baixa.
      const irmaos = await prisma.titulo.findMany({
        where: { grupo: titulo.grupo, id: { not: id } },
        select: { id: true },
      });
      const idsIrmaos = irmaos.map((t) => t.id);
      if (idsIrmaos.length > 0) {
        const comBaixa = await prisma.baixaTitulo.groupBy({
          by: ['tituloId'],
          where: { tituloId: { in: idsIrmaos } },
        });
        const ocupados = new Set(comBaixa.map((b) => b.tituloId));
        for (const irmao of idsIrmaos) {
          if (!ocupados.has(irmao)) apagar.push(irmao);
        }
      }
    }

    const apagados = await prisma.$transaction(async (db) => {
      await db.anexoTitulo.deleteMany({ where: { tituloId: { in: apagar } } });
      const resultado = await db.titulo.deleteMany({ where: { id: { in: apagar } } });
      return resultado.count;
    });

    res.json({ apagados });
  })
);

// ---------- Baixas ----------

router.post(
  '/titulos/:id/baixas',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(baixaSchema, req.body);
    const juros = arredondar(dados.juros ?? 0);
    const multa = arredondar(dados.multa ?? 0);
    const desconto = arredondar(dados.desconto ?? 0);
    if (desconto > dados.valor) throw new HttpError(400, 'O desconto não pode ser maior que o valor');
    const valor = arredondar(dados.valor);
    const lancamento = arredondar(valor + juros + multa - desconto);
    if (lancamento <= 0) throw new HttpError(400, 'O total do lançamento deve ser maior que zero');

    const titulo = await prisma.titulo.findFirst({
      where: { id },
      select: {
        id: true,
        natureza: true,
        descricao: true,
        valor: true,
        cancelado: true,
        parceiroId: true,
        categoriaId: true,
        centroDeCustoId: true,
        parcela: true,
        totalParcelas: true,
      },
    });
    if (!titulo) throw new HttpError(404, 'Título não encontrado');
    if (titulo.cancelado) throw new HttpError(400, 'Título cancelado não recebe baixa');

    const conta = await prisma.conta.findFirst({ where: { id: dados.contaId }, select: { id: true, tipo: true, origem: true } });
    if (!conta) throw new HttpError(404, 'Conta não encontrada');
    if (conta.tipo === 'CARTAO' || conta.origem === 'OPEN_FINANCE') {
      throw new HttpError(400, 'Escolha uma conta comum cadastrada à mão');
    }

    const parceiro =
      titulo.parceiroId !== null
        ? await prisma.parceiro.findFirst({ where: { id: titulo.parceiroId }, select: { nome: true } })
        : null;
    const categoria =
      titulo.categoriaId !== null
        ? await prisma.categoria.findFirst({ where: { id: titulo.categoriaId }, select: { id: true } })
        : null;

    let descricao = titulo.descricao;
    if (titulo.parcela !== null && titulo.totalParcelas !== null) {
      descricao += ` (parcela ${titulo.parcela}/${titulo.totalParcelas})`;
    }
    if (parceiro) descricao += ` · ${parceiro.nome}`;
    descricao = descricao.slice(0, 200);

    const tipo = titulo.natureza === 'PAGAR' ? 'DESPESA' : 'RECEITA';
    const data = paraData(dados.data);

    await prisma.$transaction(async (db) => {
      const travado = await travarTitulo(db, id);
      if (travado.cancelado) throw new HttpError(400, 'Título cancelado não recebe baixa');
      const pago = await somaDasBaixas(db, id);
      const saldo = arredondar(travado.valor - pago);
      if (valor > saldo + 0.005) throw new HttpError(400, 'O valor passa do saldo do título');

      const transacao = await db.transacao.create({
        data: {
          contaId: conta.id,
          data,
          descricao,
          valor: lancamento,
          tipo,
          transferencia: false,
          categoriaId: categoria ? categoria.id : null,
          centroDeCustoId: titulo.centroDeCustoId,
          origem: 'MANUAL',
        },
        select: { id: true },
      });

      await db.conta.update({
        where: { id: conta.id },
        data: { saldo: { increment: efeitoNoSaldo(conta.tipo, tipo, lancamento) } },
      });

      await db.baixaTitulo.create({
        data: {
          tituloId: id,
          data,
          valor,
          juros,
          multa,
          desconto,
          contaId: conta.id,
          transacaoId: transacao.id,
          observacao: dados.observacao || null,
        },
      });
    });

    await registrarPosicaoPatrimonio();
    res.status(201).json(await dtoDoTitulo(id));
  })
);

router.delete(
  '/titulos/:id/baixas/:baixaId',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const baixaId = idParam(req, 'baixaId');
    const baixa = await prisma.baixaTitulo.findFirst({
      where: { id: baixaId, tituloId: id },
      select: { id: true, transacaoId: true },
    });
    if (!baixa) throw new HttpError(404, 'Baixa não encontrada');

    await prisma.$transaction(async (db) => {
      if (baixa.transacaoId !== null) {
        const lancamento = await db.transacao.findFirst({
          where: { id: baixa.transacaoId },
          select: { id: true, tipo: true, valor: true, contaId: true, conta: { select: { tipo: true } } },
        });
        // Se o lançamento já foi apagado à mão, o saldo já voltou por lá: não se devolve de novo.
        if (lancamento) {
          await db.transacao.delete({ where: { id: lancamento.id } });
          await db.conta.update({
            where: { id: lancamento.contaId },
            data: {
              saldo: {
                increment: -efeitoNoSaldo(lancamento.conta.tipo, lancamento.tipo, num(lancamento.valor)),
              },
            },
          });
        }
      }
      await db.baixaTitulo.delete({ where: { id: baixa.id } });
    });

    await registrarPosicaoPatrimonio();
    res.json(await dtoDoTitulo(id));
  })
);

// ---------- Anexos ----------

// Antes do limite de 1 MB do app.ts, o corpo com o arquivo precisa de mais espaço.
router.post(
  '/titulos/:id/anexos',
  express.json({ limit: '3mb' }),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const corpo = validar(anexoSchema, req.body);

    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(corpo.dados) || corpo.dados.length % 4 !== 0) {
      throw new HttpError(400, 'Arquivo inválido');
    }
    const bytes = Buffer.from(corpo.dados, 'base64');
    if (bytes.length === 0) throw new HttpError(400, 'Arquivo vazio');
    if (bytes.length > LIMITE_ANEXO_BYTES) throw new HttpError(400, 'O arquivo passa de 2 MB');
    if (bytes.toString('base64') !== corpo.dados) throw new HttpError(400, 'Arquivo inválido');

    const criado = await prisma.$transaction(async (db) => {
      const titulo = await db.titulo.findFirst({ where: { id }, select: { id: true } });
      if (!titulo) throw new HttpError(404, 'Título não encontrado');
      const existentes = await db.anexoTitulo.count({ where: { tituloId: id } });
      if (existentes >= MAX_ANEXOS) {
        throw new HttpError(400, 'Este título já tem 5 anexos. Remova um para enviar outro.');
      }
      return db.anexoTitulo.create({
        data: { tituloId: id, nome: corpo.nome, tipo: corpo.tipo, tamanho: bytes.length, dados: bytes },
        select: { id: true, nome: true, tipo: true, tamanho: true },
      });
    });

    res.status(201).json(criado);
  })
);

router.get(
  '/titulos/:id/anexos/:anexoId',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const anexoId = idParam(req, 'anexoId');
    const anexo = await prisma.anexoTitulo.findFirst({ where: { id: anexoId, tituloId: id } });
    if (!anexo) throw new HttpError(404, 'Anexo não encontrado');

    res.setHeader('Content-Type', anexo.tipo);
    res.setHeader('Content-Disposition', `inline; filename="${nomeDoArquivo(anexo.nome)}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(Buffer.from(anexo.dados));
  })
);

router.delete(
  '/titulos/:id/anexos/:anexoId',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const anexoId = idParam(req, 'anexoId');
    const apagados = await prisma.anexoTitulo.deleteMany({ where: { id: anexoId, tituloId: id } });
    if (apagados.count === 0) throw new HttpError(404, 'Anexo não encontrado');
    res.status(204).end();
  })
);

export default router;
