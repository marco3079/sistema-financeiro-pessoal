import crypto from 'crypto';
import { Router } from 'express';
import { z } from 'zod';
import type { Conta, Prisma } from '@prisma/client';
import { perfilAtual, prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { cifrar } from '../../lib/cripto';
import {
  arredondar,
  contaDTO,
  dataISO,
  dataSchema,
  dinheiroComSinalSchema,
  efeitoNoSaldo,
  hoje,
  INCLUIR_NA_TRANSACAO,
  transacaoDTO,
  num,
  paraData,
  recalcularFatura,
  registrarPosicaoPatrimonio,
} from '../../lib/financas';
import { analisarArquivo } from '../../lib/importacao/extrato';
import type { ItemLido } from '../../lib/importacao/extrato';
import { analisarPlanilhaB3 } from '../../lib/importacao/b3';
import { atualizarCotacoes, buscarCotacao, iniciarCotacoesAutomaticas, tokenDasCotacoes } from '../../lib/cotacoes';

// Importação de arquivos: fatura do cartão e extrato da conta (CSV, OFX ou PDF), planilhas da B3
// e cotações automáticas. As rotas ficam sob /api/importacao e /api/cotacoes.
// O navegador lê o arquivo e manda o texto (ou as abas da planilha); o arquivo em si não é guardado.

const router = Router();

iniciarCotacoesAutomaticas();

const MS_DIA = 24 * 60 * 60 * 1000;

function hash(texto: string): string {
  return crypto.createHash('sha1').update(texto, 'utf8').digest('hex');
}

// ---------- Fatura e extrato ----------

const itemSchema = z.object({
  data: dataSchema,
  descricao: z.string().trim().min(1).max(200),
  valor: z.number().finite().positive().max(999999999999),
  tipo: z.enum(['RECEITA', 'DESPESA']),
  transferencia: z.boolean(),
  parcela: z.number().int().min(1).max(60).nullable(),
  totalParcelas: z.number().int().min(2).max(60).nullable(),
});

// Uma chave por lançamento do arquivo: importar o mesmo arquivo (ou outro que repita a linha) não duplica.
// Linhas idênticas dentro do mesmo arquivo (duas corridas iguais no mesmo dia) recebem um número de ordem.
function chavesDosItens(contaId: number, itens: ItemLido[]): string[] {
  const vistos = new Map<string, number>();
  return itens.map((i) => {
    const base = [contaId, i.data, i.descricao.toLowerCase(), i.valor.toFixed(2), i.tipo, i.parcela ?? '', i.totalParcelas ?? ''].join('|');
    const ordem = vistos.get(base) ?? 0;
    vistos.set(base, ordem + 1);
    return hash(`arquivo|${base}|${ordem}`);
  });
}

async function chavesExistentes(chaves: string[]): Promise<Set<string>> {
  const achadas = new Set<string>();
  for (let i = 0; i < chaves.length; i += 500) {
    const lote = await prisma.transacao.findMany({
      where: { chaveImportacao: { in: chaves.slice(i, i + 500) } },
      select: { chaveImportacao: true },
    });
    for (const t of lote) if (t.chaveImportacao) achadas.add(t.chaveImportacao);
  }
  return achadas;
}

// Diz, para cada item do arquivo, se ele já está registrado na conta. Duas conferências:
//   1. pela chave do arquivo (o mesmo arquivo, ou outro que repita a linha);
//   2. por data, valor, tipo e descrição iguais em um lançamento que não veio deste arquivo
//      (digitado à mão, vindo do Open Finance ou de outro arquivo com as linhas em outra ordem).
// Cada lançamento gravado "gasta" um item só: duas compras iguais no mesmo dia continuam sendo duas.
async function itensJaRegistrados(contaId: number, itens: ItemLido[]): Promise<{ chaves: string[]; repetido: boolean[] }> {
  const chaves = chavesDosItens(contaId, itens);
  const existentes = await chavesExistentes(chaves);
  const repetido = chaves.map((c) => existentes.has(c));
  if (itens.length === 0 || repetido.every(Boolean)) return { chaves, repetido };
  const datas = itens.map((i) => i.data).sort();
  const gravados = await prisma.transacao.findMany({
    where: { contaId, data: { gte: paraData(datas[0]), lte: paraData(datas[datas.length - 1]) } },
    select: { data: true, valor: true, tipo: true, descricao: true, chaveImportacao: true },
  });
  const assinatura = (data: string, valor: number, tipo: string, descricao: string) =>
    [data, valor.toFixed(2), tipo, semAcento(descricao).replace(/\s+/g, ' ').trim()].join('|');
  const disponiveis = new Map<string, number>();
  const doArquivo = new Set(chaves);
  for (const t of gravados) {
    // Os que têm a chave deste arquivo já foram contados na primeira conferência.
    if (t.chaveImportacao && doArquivo.has(t.chaveImportacao)) continue;
    const a = assinatura(dataISO(t.data), num(t.valor), t.tipo, t.descricao);
    disponiveis.set(a, (disponiveis.get(a) ?? 0) + 1);
  }
  itens.forEach((item, i) => {
    if (repetido[i]) return;
    const a = assinatura(item.data, item.valor, item.tipo, item.descricao);
    const restam = disponiveis.get(a) ?? 0;
    if (restam > 0) {
      repetido[i] = true;
      disponiveis.set(a, restam - 1);
    }
  });
  return { chaves, repetido };
}

function semAcento(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Conta manual que parece ser do banco detectado (pelo nome ou pela instituição).
function contaDoBanco(contas: Conta[], banco: string | null): Conta | null {
  if (!banco) return contas.length === 1 ? contas[0] : null;
  const alvo = semAcento(banco);
  return contas.find((c) => semAcento(c.nome).includes(alvo) || semAcento(c.instituicao ?? '').includes(alvo)) ?? null;
}

const analisarSchema = z.object({
  nome: z.string().trim().min(1).max(200),
  formato: z.enum(['csv', 'ofx', 'pdf']),
  texto: z.string().min(1).max(4_000_000),
  documento: z.enum(['FATURA', 'EXTRATO']).nullable().optional(),
  contaId: z.number().int().positive().nullable().optional(),
});

router.post(
  '/importacao/analisar',
  asyncHandler(async (req, res) => {
    const dados = validar(analisarSchema, req.body);
    const analise = analisarArquivo({ nome: dados.nome, formato: dados.formato, texto: dados.texto, documento: dados.documento ?? null });
    const candidatas = await prisma.conta.findMany({
      where: { ativo: true, origem: 'MANUAL', tipo: analise.documento === 'FATURA' ? 'CARTAO' : { not: 'CARTAO' } },
      orderBy: { nome: 'asc' },
    });
    let escolhida =
      (dados.contaId ? candidatas.find((c) => c.id === dados.contaId) : undefined) ?? contaDoBanco(candidatas, analise.banco);
    let jaImportados: boolean[] = analise.itens.map(() => false);
    if (escolhida) {
      jaImportados = (await itensJaRegistrados(escolhida.id, analise.itens)).repetido;
    } else {
      // Sem banco identificado: procura a conta em que estes lançamentos já estão e sugere essa.
      let maisRepetidos = 0;
      for (const candidata of candidatas) {
        const { repetido } = await itensJaRegistrados(candidata.id, analise.itens);
        const quantos = repetido.filter(Boolean).length;
        if (quantos > maisRepetidos) {
          maisRepetidos = quantos;
          escolhida = candidata;
          jaImportados = repetido;
        }
      }
    }
    res.json({
      documento: analise.documento,
      banco: analise.banco,
      vencimento: analise.vencimento,
      total: analise.total,
      avisos: analise.avisos,
      itens: analise.itens.map((item, i) => ({ ...item, jaImportado: jaImportados[i] })),
      contaSugeridaId: escolhida?.id ?? null,
      contas: candidatas.map(contaDTO),
    });
  })
);

// Categoria pelo que o próprio usuário já fez (mesma descrição) e, na falta disso, por palavras conhecidas.
const PALAVRAS: { nome: string; trechos: string[] }[] = [
  { nome: 'Transporte', trechos: ['uber', '99app', '99 app', '99pop', 'posto', 'combustivel', 'estacionamento', 'pedagio', 'sem parar', 'patinete', 'metro', 'pneus', 'shell', 'ipiranga'] },
  { nome: 'Restaurantes', trechos: ['ifood', 'restaurante', 'pizza', 'lanchonete', 'burger', 'padaria', 'panificadora', 'cafeteria', 'bar ', 'churrascaria', 'rappi', 'sushi'] },
  { nome: 'Mercado', trechos: ['supermercado', 'mercado ', 'atacadao', 'assai', 'carrefour', 'pao de acucar', 'hortifruti', 'conveniencia', 'mercadinho'] },
  { nome: 'Assinaturas', trechos: ['netflix', 'spotify', 'apple.com/bill', 'amazon prime', 'amazonprime', 'amazon music', 'globoplay', 'disney', 'hbo', 'youtube', 'microsoft', 'google', 'canva', 'melimais', 'chatgpt', 'openai', 'icloud', 'deezer'] },
  { nome: 'Saúde', trechos: ['farmacia', 'drogaria', 'drogasil', 'pague menos', 'hospital', 'clinica', 'laboratorio', 'otica', 'dentista', 'unimed', 'hapvida'] },
  { nome: 'Contas da casa', trechos: ['neoenergia', 'energia', 'enel', 'cemig', 'copel', 'celpe', 'telefonica', 'vivo', 'claro', 'tim ', 'oi fibra', 'saneamento', 'compesa', 'sabesp', 'condominio', 'gas '] },
  { nome: 'Educação', trechos: ['escola', 'faculdade', 'universidade', 'curso', 'udemy', 'alura', 'hotmart', 'livraria'] },
  { nome: 'Lazer', trechos: ['cinema', 'ingresso', 'show', 'steam', 'playstation', 'xbox', 'xsolla', 'gamers club', 'hotel', 'airbnb', 'booking'] },
  { nome: 'Compras', trechos: ['mercadolivre', 'mercado livre', 'amazon', 'shopee', 'tiktok shop', 'magazine', 'magalu', 'renner', 'riachuelo', 'c&a', 'aliexpress', 'shein', 'americanas', 'casas bahia'] },
  { nome: 'Impostos e taxas', trechos: ['iof', 'anuidade', 'juros', 'multa', 'tarifa', 'encargo'] },
];

async function montarClassificador(): Promise<(item: ItemLido) => number | null> {
  const categorias = await prisma.categoria.findMany({ select: { id: true, nome: true, tipo: true } });
  const idDespesa = new Map(categorias.filter((c) => c.tipo === 'DESPESA').map((c) => [c.nome, c.id]));
  const cache = new Map<string, number | null>();
  return (item) => {
    if (item.transferencia || item.tipo !== 'DESPESA') return null;
    const d = semAcento(item.descricao);
    if (cache.has(d)) return cache.get(d) ?? null;
    const achada = PALAVRAS.find((p) => p.trechos.some((t) => d.includes(t)));
    const id = achada ? (idDespesa.get(achada.nome) ?? null) : null;
    cache.set(d, id);
    return id;
  };
}

// Categorias que o usuário já deu a lançamentos com a mesma descrição (a mais recente vence).
async function categoriasPorHistorico(descricoes: string[]): Promise<Map<string, number>> {
  const mapa = new Map<string, number>();
  const unicas = [...new Set(descricoes)];
  for (let i = 0; i < unicas.length; i += 300) {
    const lote = await prisma.transacao.findMany({
      where: { descricao: { in: unicas.slice(i, i + 300) }, categoriaId: { not: null } },
      select: { descricao: true, categoriaId: true },
      orderBy: { id: 'asc' },
    });
    for (const t of lote) if (t.categoriaId !== null) mapa.set(t.descricao, t.categoriaId);
  }
  return mapa;
}

const confirmarSchema = z.object({
  arquivo: z.string().trim().min(1).max(200),
  documento: z.enum(['FATURA', 'EXTRATO']),
  banco: z.string().trim().max(60).nullable().optional(),
  contaId: z.number().int().positive().nullable().optional(),
  novaConta: z.object({ nome: z.string().trim().min(1).max(120) }).nullable().optional(),
  vencimento: dataSchema.nullable().optional(),
  saldoFinal: dinheiroComSinalSchema.nullable().optional(),
  itens: z.array(itemSchema).min(1).max(5000),
});

router.post(
  '/importacao/confirmar',
  asyncHandler(async (req, res) => {
    const dados = validar(confirmarSchema, req.body);
    const fatura = dados.documento === 'FATURA';
    if (fatura && !dados.vencimento) {
      throw new HttpError(400, 'Informe o vencimento da fatura');
    }
    if (!dados.contaId && !dados.novaConta) {
      throw new HttpError(400, fatura ? 'Escolha o cartão desta fatura' : 'Escolha a conta deste extrato');
    }

    let conta: Conta;
    if (dados.contaId) {
      const achada = await prisma.conta.findUnique({ where: { id: dados.contaId } });
      if (!achada) throw new HttpError(404, 'Conta não encontrada');
      if (achada.origem !== 'MANUAL') {
        throw new HttpError(400, 'Esta conta vem do Open Finance: os lançamentos dela chegam sozinhos pela sincronização.');
      }
      if (fatura !== (achada.tipo === 'CARTAO')) {
        throw new HttpError(400, fatura ? 'Fatura só pode ser importada num cartão' : 'Extrato não pode ser importado num cartão');
      }
      conta = achada;
    } else {
      conta = await prisma.conta.create({
        data: {
          nome: dados.novaConta?.nome ?? 'Conta',
          tipo: fatura ? 'CARTAO' : 'CORRENTE',
          instituicao: dados.banco ?? null,
          diaVencimento: fatura && dados.vencimento ? Number(dados.vencimento.slice(8, 10)) : null,
        },
      });
    }

    const { chaves, repetido } = await itensJaRegistrados(conta.id, dados.itens);
    const classificar = await montarClassificador();
    const regras = (await prisma.regraCategoria.findMany({ orderBy: { id: 'asc' } })).map((r) => ({ trecho: semAcento(r.trecho).trim(), categoriaId: r.categoriaId }));
    // A regra só vale se a categoria dela ainda existe e é do mesmo tipo do lançamento (regra de categoria apagada
    // não pode derrubar a importação).
    const tipoDaCategoria = new Map((await prisma.categoria.findMany({ select: { id: true, tipo: true } })).map((c) => [c.id, c.tipo]));
    const pelaRegra = (descricao: string, tipo: string): number | null => {
      const d = semAcento(descricao);
      return regras.find((r) => r.trecho !== '' && d.includes(r.trecho) && tipoDaCategoria.get(r.categoriaId) === tipo)?.categoriaId ?? null;
    };
    const historico = await categoriasPorHistorico(dados.itens.map((i) => i.descricao));
    const agora = hoje();

    const resultado = await prisma.$transaction(
      async (db) => {
        let faturaId: number | null = null;
        if (fatura && dados.vencimento) {
          const vencimento = paraData(dados.vencimento);
          const existente = await db.fatura.findUnique({ where: { contaId_vencimento: { contaId: conta.id, vencimento } } });
          if (existente) {
            faturaId = existente.id;
          } else {
            const fechamento = new Date(vencimento.getTime() - 7 * MS_DIA);
            const criada = await db.fatura.create({
              data: {
                contaId: conta.id,
                vencimento,
                fechamento,
                // Fatura já vencida entra como paga; a do mês seguinte traz o pagamento.
                status: vencimento.getTime() < agora.getTime() ? 'PAGA' : fechamento.getTime() < agora.getTime() ? 'FECHADA' : 'ABERTA',
                pagaEm: vencimento.getTime() < agora.getTime() ? vencimento : null,
              },
            });
            faturaId = criada.id;
          }
        }

        const novos: Prisma.TransacaoCreateManyInput[] = [];
        let efeito = 0;
        dados.itens.forEach((item, i) => {
          if (repetido[i]) return;
          novos.push({
            contaId: conta.id,
            data: paraData(item.data),
            descricao: item.descricao,
            valor: item.valor,
            tipo: item.tipo,
            transferencia: item.transferencia,
            categoriaId: item.transferencia ? null : (pelaRegra(item.descricao, item.tipo) ?? (item.tipo === 'DESPESA' ? (historico.get(item.descricao) ?? classificar(item)) : (historico.get(item.descricao) ?? null))),
            faturaId,
            parcela: item.parcela,
            totalParcelas: item.totalParcelas,
            chaveImportacao: chaves[i],
          });
          efeito += efeitoNoSaldo(conta.tipo, item.tipo, item.valor);
        });
        if (novos.length > 0) await db.transacao.createMany({ data: novos });

        let totalDaReferencia: number;
        if (fatura && faturaId !== null) {
          await recalcularFatura(db, faturaId);
          // A dívida do cartão é o que está nas faturas ainda não pagas.
          const aberto = await db.fatura.aggregate({ where: { contaId: conta.id, status: { not: 'PAGA' } }, _sum: { total: true } });
          const saldo = Math.max(0, num(aberto._sum.total));
          await db.conta.update({
            where: { id: conta.id },
            data: {
              saldo,
              ...(conta.limite !== null ? { limiteDisponivel: Math.max(0, arredondar(num(conta.limite) - saldo)) } : {}),
              ...(conta.diaVencimento === null && dados.vencimento ? { diaVencimento: Number(dados.vencimento.slice(8, 10)) } : {}),
            },
          });
          totalDaReferencia = num((await db.fatura.findUnique({ where: { id: faturaId }, select: { total: true } }))?.total);
        } else {
          if (dados.saldoFinal !== null && dados.saldoFinal !== undefined) {
            await db.conta.update({ where: { id: conta.id }, data: { saldo: dados.saldoFinal } });
          } else if (efeito !== 0) {
            await db.conta.update({ where: { id: conta.id }, data: { saldo: { increment: arredondar(efeito) } } });
          }
          totalDaReferencia = arredondar(novos.reduce((soma, t) => soma + (t.tipo === 'RECEITA' ? Number(t.valor) : -Number(t.valor)), 0));
        }

        const datas = dados.itens.map((i) => i.data).sort();
        const registro = await db.importacao.create({
          data: {
            arquivo: dados.arquivo,
            tipo: dados.documento,
            banco: dados.banco ?? conta.instituicao,
            referencia: fatura ? dados.vencimento : `${datas[0]} a ${datas[datas.length - 1]}`,
            contaId: conta.id,
            contaNome: conta.nome,
            novos: novos.length,
            repetidos: dados.itens.length - novos.length,
            total: totalDaReferencia,
          },
        });
        const chavesNovas = novos.map((t) => t.chaveImportacao as string);
        for (let i = 0; i < chavesNovas.length; i += 1000) {
          await db.transacao.updateMany({
            where: { contaId: conta.id, importacaoId: null, chaveImportacao: { in: chavesNovas.slice(i, i + 1000) } },
            data: { importacaoId: registro.id },
          });
        }
        return { importacaoId: registro.id, faturaId, novos: novos.length, repetidos: dados.itens.length - novos.length };
      },
      { timeout: 60000 }
    );

    await registrarPosicaoPatrimonio();
    res.status(201).json({ ...resultado, contaId: conta.id, contaNome: conta.nome });
  })
);

router.get(
  '/importacao/historico',
  asyncHandler(async (_req, res) => {
    await vincularImportacoesAntigas();
    const lista = await prisma.importacao.findMany({ orderBy: { criadoEm: 'desc' }, take: 50 });
    res.json(
      lista.map((i) => ({
        id: i.id,
        criadoEm: i.criadoEm.toISOString(),
        arquivo: i.arquivo,
        tipo: i.tipo,
        banco: i.banco,
        referencia: i.referencia,
        contaNome: i.contaNome,
        novos: i.novos,
        repetidos: i.repetidos,
        total: i.total === null ? null : num(i.total),
      }))
    );
  })
);

// ---------- Planilha da B3 ----------

const celula = z.union([z.string().max(500), z.number(), z.boolean(), z.null()]);

const b3AnalisarSchema = z.object({
  nome: z.string().trim().min(1).max(200),
  planilhas: z
    .array(z.object({ nome: z.string().max(100), linhas: z.array(z.array(celula).max(60)).max(60000) }))
    .min(1)
    .max(20),
});

// Investimento manual que corresponde a uma chave da planilha (código de negociação, ou o nome).
async function investimentosPorChave(chaves: string[]): Promise<Map<string, { id: number; quantidade: number; saldo: number; valorAplicado: number }>> {
  const mapa = new Map<string, { id: number; quantidade: number; saldo: number; valorAplicado: number }>();
  if (chaves.length === 0) return mapa;
  const lista = await prisma.investimento.findMany({
    where: { origem: 'MANUAL', OR: [{ codigo: { in: chaves } }, { codigo: null, nome: { in: chaves } }] },
    orderBy: { id: 'asc' },
  });
  for (const i of lista) {
    const chave = i.codigo ?? i.nome;
    if (!mapa.has(chave)) {
      mapa.set(chave, { id: i.id, quantidade: num(i.quantidade), saldo: num(i.saldo), valorAplicado: num(i.valorAplicado) });
    }
  }
  return mapa;
}

// ---------- Histórico: ver, editar e remover uma importação ----------

// Importações feitas antes de os registros guardarem a origem: liga pelo momento da gravação (os lançamentos de um
// arquivo são criados na mesma transação do registro do histórico). Roda uma vez por perfil a cada subida do servidor.
const vinculacoes = new Map<number, Promise<void>>();
function vincularImportacoesAntigas(): Promise<void> {
  const perfil = perfilAtual() ?? 0;
  let emCurso = vinculacoes.get(perfil);
  if (!emCurso) {
    // Quem chegar enquanto a vinculação roda espera por ela; se falhar, a próxima chamada tenta de novo.
    emCurso = vincular().catch((erro: unknown) => {
      vinculacoes.delete(perfil);
      throw erro;
    });
    vinculacoes.set(perfil, emCurso);
  }
  return emCurso;
}

async function vincular(): Promise<void> {
  const importacoes = await prisma.importacao.findMany({ where: { novos: { gt: 0 } }, orderBy: { id: 'asc' } });
  for (const imp of importacoes) {
    const janela = { gte: new Date(imp.criadoEm.getTime() - 5 * 60 * 1000), lte: new Date(imp.criadoEm.getTime() + 10 * 1000) };
    if (imp.tipo === 'B3') {
      // Ativos criados pela planilha: gravados no mesmo instante do registro do histórico.
      if ((await prisma.investimento.count({ where: { importacaoId: imp.id } })) === 0) {
        await prisma.investimento.updateMany({
          where: {
            importacaoId: null,
            origem: 'MANUAL',
            criadoEm: { gte: new Date(imp.criadoEm.getTime() - 60 * 1000), lte: new Date(imp.criadoEm.getTime() + 10 * 1000) },
          },
          data: { importacaoId: imp.id },
        });
      }
      if ((await prisma.movimentoInvestimento.count({ where: { importacaoId: imp.id } })) > 0) continue;
      await prisma.movimentoInvestimento.updateMany({
        where: { importacaoId: null, chaveImportacao: { not: null }, criadoEm: janela },
        data: { importacaoId: imp.id },
      });
    } else if (imp.contaId !== null) {
      if ((await prisma.transacao.count({ where: { importacaoId: imp.id } })) > 0) continue;
      await prisma.transacao.updateMany({
        where: { importacaoId: null, chaveImportacao: { not: null }, contaId: imp.contaId, criadoEm: janela },
        data: { importacaoId: imp.id },
      });
    }
  }
}

function importacaoDTO(i: { id: number; criadoEm: Date; arquivo: string; tipo: string; banco: string | null; referencia: string | null; contaId: number | null; contaNome: string | null; novos: number; repetidos: number; total: Prisma.Decimal | null }) {
  return {
    id: i.id,
    criadoEm: i.criadoEm.toISOString(),
    arquivo: i.arquivo,
    tipo: i.tipo,
    banco: i.banco,
    referencia: i.referencia,
    contaId: i.contaId,
    contaNome: i.contaNome,
    novos: i.novos,
    repetidos: i.repetidos,
    total: i.total === null ? null : num(i.total),
  };
}

// Detalhes: o registro do histórico e tudo o que aquele arquivo trouxe e ainda existe.
router.get(
  '/importacao/:id(\\d+)',
  asyncHandler(async (req, res) => {
    await vincularImportacoesAntigas();
    const id = idParam(req);
    const imp = await prisma.importacao.findUnique({ where: { id } });
    if (!imp) throw new HttpError(404, 'Importação não encontrada');
    if (imp.tipo === 'B3') {
      const movimentos = await prisma.movimentoInvestimento.findMany({
        where: { importacaoId: id },
        include: { investimento: { select: { id: true, nome: true, codigo: true } } },
        orderBy: [{ data: 'desc' }, { id: 'desc' }],
        take: 3000,
      });
      res.json({
        importacao: importacaoDTO(imp),
        lancamentos: [],
        movimentos: movimentos.map((m) => ({
          id: m.id,
          data: dataISO(m.data),
          tipo: m.tipo,
          valor: num(m.valor),
          quantidade: m.quantidade === null ? null : num(m.quantidade),
          descricao: m.descricao,
          investimentoId: m.investimento.id,
          investimento: m.investimento.codigo ?? m.investimento.nome,
        })),
      });
      return;
    }
    const lancamentos = await prisma.transacao.findMany({
      where: { importacaoId: id },
      include: INCLUIR_NA_TRANSACAO,
      orderBy: [{ data: 'desc' }, { id: 'desc' }],
    });
    res.json({ importacao: importacaoDTO(imp), lancamentos: lancamentos.map(transacaoDTO), movimentos: [] });
  })
);

// Remove a importação: apaga os lançamentos (ou movimentos) que ela trouxe e ainda existem, acerta saldos e faturas
// e tira o registro do histórico. O que foi editado depois também sai; o que já existia antes do arquivo fica.
router.delete(
  '/importacao/:id(\\d+)',
  asyncHandler(async (req, res) => {
    await vincularImportacoesAntigas();
    const id = idParam(req);
    const imp = await prisma.importacao.findUnique({ where: { id } });
    if (!imp) throw new HttpError(404, 'Importação não encontrada');

    const resultado = await prisma.$transaction(
      async (db) => {
        if (imp.tipo === 'B3') {
          const movimentos = await db.movimentoInvestimento.findMany({ where: { importacaoId: id }, select: { investimentoId: true } });
          const ativos = [...new Set(movimentos.map((m) => m.investimentoId))];
          await db.movimentoInvestimento.deleteMany({ where: { importacaoId: id } });
          await db.eventoAtivo.deleteMany({ where: { importacaoId: id } });
          // Ativo que veio só deste arquivo (ficou sem nenhum movimento) sai junto; os demais ficam como estão.
          let investimentos = 0;
          for (const investimentoId of ativos) {
            const restam = await db.movimentoInvestimento.count({ where: { investimentoId } });
            if (restam > 0) continue;
            // Só o ativo que esta planilha criou. O que foi cadastrado à mão (ou veio de outra planilha) fica.
            const apagados = await db.investimento.deleteMany({ where: { id: investimentoId, origem: 'MANUAL', importacaoId: id } });
            investimentos += apagados.count;
          }
          await db.importacao.delete({ where: { id } });
          return { lancamentos: 0, movimentos: movimentos.length, investimentos, faturas: 0 };
        }

        const lancamentos = await db.transacao.findMany({ where: { importacaoId: id }, include: { conta: true } });
        const efeitoPorConta = new Map<number, number>();
        const faturasAfetadas = new Set<number>();
        const cartoes = new Set<number>();
        for (const t of lancamentos) {
          if (t.faturaId !== null) faturasAfetadas.add(t.faturaId);
          if (t.conta.tipo === 'CARTAO') cartoes.add(t.contaId);
          else efeitoPorConta.set(t.contaId, (efeitoPorConta.get(t.contaId) ?? 0) + efeitoNoSaldo(t.conta.tipo, t.tipo, num(t.valor)));
        }
        await db.transacao.deleteMany({ where: { importacaoId: id } });
        // Conta corrente: desfaz o efeito dos lançamentos no saldo.
        for (const [contaId, efeito] of efeitoPorConta) {
          if (efeito !== 0) await db.conta.update({ where: { id: contaId }, data: { saldo: { decrement: arredondar(efeito) } } });
        }
        // Faturas: recalcula; a que ficou vazia (veio só deste arquivo) é apagada.
        let faturas = 0;
        for (const faturaId of faturasAfetadas) {
          const restam = await db.transacao.count({ where: { faturaId } });
          if (restam === 0) {
            faturas += (await db.fatura.deleteMany({ where: { id: faturaId, origem: 'MANUAL' } })).count;
          } else {
            await recalcularFatura(db, faturaId);
          }
        }
        // Cartão: a dívida volta a ser a soma das faturas não pagas.
        for (const contaId of cartoes) {
          const aberto = await db.fatura.aggregate({ where: { contaId, status: { not: 'PAGA' } }, _sum: { total: true } });
          const conta = await db.conta.findUnique({ where: { id: contaId } });
          if (!conta) continue;
          const saldo = Math.max(0, num(aberto._sum.total));
          await db.conta.update({
            where: { id: contaId },
            data: { saldo, ...(conta.limite !== null ? { limiteDisponivel: Math.max(0, arredondar(num(conta.limite) - saldo)) } : {}) },
          });
        }
        await db.importacao.delete({ where: { id } });
        return { lancamentos: lancamentos.length, movimentos: 0, investimentos: 0, faturas };
      },
      { timeout: 120000 }
    );

    await registrarPosicaoPatrimonio();
    res.json(resultado);
  })
);

router.post(
  '/importacao/b3/analisar',
  asyncHandler(async (req, res) => {
    const dados = validar(b3AnalisarSchema, req.body);
    const analise = analisarPlanilhaB3(dados.planilhas);
    const existentes = await investimentosPorChave(analise.posicoes.map((p) => p.chave));
    const porChave = new Map<string, { proventos: number; movimentos: number }>();
    for (const m of analise.movimentos) {
      const atual = porChave.get(m.chave) ?? { proventos: 0, movimentos: 0 };
      atual.movimentos++;
      if (m.tipo === 'RENDIMENTO') atual.proventos = arredondar(atual.proventos + m.valor);
      porChave.set(m.chave, atual);
    }
    res.json({
      tipo: analise.tipo,
      periodo: analise.periodo,
      avisos: analise.avisos,
      posicoes: analise.posicoes.map((p) => ({
        ...p,
        investimentoId: existentes.get(p.chave)?.id ?? null,
        proventos: porChave.get(p.chave)?.proventos ?? 0,
      })),
      movimentos: analise.movimentos,
      encerradas: analise.encerradas,
      eventos: analise.eventos,
      totalProventos: arredondar(analise.movimentos.filter((m) => m.tipo === 'RENDIMENTO').reduce((s, m) => s + m.valor, 0)),
    });
  })
);

const posicaoSchema = z.object({
  chave: z.string().trim().min(1).max(200),
  codigo: z.string().trim().max(40).nullable(),
  nome: z.string().trim().min(1).max(200),
  tipo: z.enum(['RENDA_FIXA', 'FUNDO', 'ACAO', 'FII', 'ETF', 'PREVIDENCIA', 'CRIPTO', 'OUTRO']),
  subtipo: z.string().trim().max(60).nullable(),
  instituicao: z.string().trim().max(200).nullable(),
  quantidade: z.number().finite().positive(),
  valorAplicado: z.number().finite().min(0).nullable(),
  saldo: z.number().finite().min(0).nullable(),
  vencimento: dataSchema.nullable(),
});

const movimentoSchema = z.object({
  chave: z.string().trim().min(1).max(200),
  data: dataSchema,
  tipo: z.enum(['APLICACAO', 'RESGATE', 'RENDIMENTO', 'IMPOSTO']),
  valor: z.number().finite().positive(),
  quantidade: z.number().finite().min(0).nullable(),
  descricao: z.string().trim().max(200),
});

const eventoSchema = z.object({
  chave: z.string().trim().min(1).max(200),
  data: dataSchema,
  tipo: z.enum(['DESDOBRAMENTO', 'GRUPAMENTO', 'BONIFICACAO']),
  fator: z.number().finite().positive(),
  descricao: z.string().trim().max(200),
});

const b3ConfirmarSchema = z.object({
  arquivo: z.string().trim().min(1).max(200),
  tipo: z.enum(['MOVIMENTACAO', 'POSICAO']),
  periodo: z.object({ de: dataSchema, ate: dataSchema }).nullable().optional(),
  posicoes: z.array(posicaoSchema).max(2000),
  movimentos: z.array(movimentoSchema).max(60000),
  encerradas: z.array(z.string().max(200)).max(5000),
  eventos: z.array(eventoSchema).max(5000).default([]),
});

router.post(
  '/importacao/b3/confirmar',
  asyncHandler(async (req, res) => {
    const dados = validar(b3ConfirmarSchema, req.body);
    if (dados.posicoes.length === 0) {
      throw new HttpError(400, 'Marque pelo menos um ativo para importar');
    }
    const existentes = await investimentosPorChave([...dados.posicoes.map((p) => p.chave), ...dados.encerradas]);
    const escolhidas = new Set(dados.posicoes.map((p) => p.chave));

    const resultado = await prisma.$transaction(
      async (db) => {
        const idPorChave = new Map<string, number>();
        let criados = 0;
        let atualizados = 0;
        const idsCriados: number[] = [];
        for (const p of dados.posicoes) {
          const atual = existentes.get(p.chave);
          // Saldo: o da planilha de posição; senão mantém o preço que já havia; senão o valor aplicado (a cotação corrige depois).
          const precoAnterior = atual && atual.quantidade > 0 ? atual.saldo / atual.quantidade : null;
          const aplicado = p.valorAplicado ?? atual?.valorAplicado ?? p.saldo ?? 0;
          const saldo = p.saldo ?? (precoAnterior !== null ? arredondar(precoAnterior * p.quantidade) : aplicado);
          const campos = {
            tipo: p.tipo,
            subtipo: p.subtipo,
            instituicao: p.instituicao,
            quantidade: p.quantidade,
            valorAplicado: arredondar(aplicado),
            saldo: arredondar(saldo),
            vencimento: p.vencimento ? paraData(p.vencimento) : null,
            dataPosicao: new Date(),
            ativo: true,
          };
          if (atual) {
            await db.investimento.update({ where: { id: atual.id }, data: campos });
            idPorChave.set(p.chave, atual.id);
            atualizados++;
          } else {
            const criado = await db.investimento.create({ data: { ...campos, nome: p.nome.slice(0, 120), codigo: p.codigo } });
            idPorChave.set(p.chave, criado.id);
            idsCriados.push(criado.id);
            criados++;
          }
        }
        // Ativos que a planilha mostra zerados: saem da carteira (ficam inativos, com o histórico).
        let encerrados = 0;
        for (const chave of dados.encerradas) {
          const atual = existentes.get(chave);
          if (atual && !escolhidas.has(chave) && atual.quantidade > 0) {
            await db.investimento.update({ where: { id: atual.id }, data: { ativo: false, quantidade: 0, saldo: 0 } });
            encerrados++;
          }
        }

        // Movimentos (compras, vendas e proventos) só dos ativos importados.
        const vistos = new Map<string, number>();
        const linhas: Prisma.MovimentoInvestimentoCreateManyInput[] = [];
        for (const m of dados.movimentos) {
          const investimentoId = idPorChave.get(m.chave);
          if (investimentoId === undefined) continue;
          const base = [m.chave, m.data, m.tipo, m.valor.toFixed(2), m.quantidade ?? '', m.descricao.toLowerCase()].join('|');
          const ordem = vistos.get(base) ?? 0;
          vistos.set(base, ordem + 1);
          linhas.push({
            investimentoId,
            data: paraData(m.data),
            tipo: m.tipo,
            valor: m.valor,
            quantidade: m.quantidade,
            descricao: m.descricao || null,
            chaveImportacao: hash(`b3|${base}|${ordem}`),
          });
        }
        // Só entra o que ainda não foi importado (a chave não é única no banco: a conferência é feita aqui).
        const jaGravadas = new Set<string>();
        const todasAsChaves = linhas.map((l) => l.chaveImportacao as string);
        for (let i = 0; i < todasAsChaves.length; i += 1000) {
          const lote = await db.movimentoInvestimento.findMany({
            where: { chaveImportacao: { in: todasAsChaves.slice(i, i + 1000) } },
            select: { chaveImportacao: true },
          });
          for (const m of lote) if (m.chaveImportacao) jaGravadas.add(m.chaveImportacao);
        }
        // Movimento registrado à mão (sem chave) com o mesmo ativo, dia, tipo e valor também conta como já registrado.
        const idsDosAtivos = [...new Set(linhas.map((l) => l.investimentoId))];
        const manuais = new Map<string, number>();
        if (idsDosAtivos.length > 0) {
          const semChave = await db.movimentoInvestimento.findMany({
            where: { investimentoId: { in: idsDosAtivos }, chaveImportacao: null },
            select: { investimentoId: true, data: true, tipo: true, valor: true },
          });
          for (const m of semChave) {
            const a = [m.investimentoId, dataISO(m.data), m.tipo, num(m.valor).toFixed(2)].join('|');
            manuais.set(a, (manuais.get(a) ?? 0) + 1);
          }
        }
        const ineditas = linhas.filter((l) => {
          if (jaGravadas.has(l.chaveImportacao as string)) return false;
          const a = [l.investimentoId, dataISO(l.data as Date), l.tipo, Number(l.valor).toFixed(2)].join('|');
          const restam = manuais.get(a) ?? 0;
          if (restam > 0) {
            manuais.set(a, restam - 1);
            return false;
          }
          return true;
        });
        for (let i = 0; i < ineditas.length; i += 1000) {
          await db.movimentoInvestimento.createMany({ data: ineditas.slice(i, i + 1000) });
        }
        const movimentosNovos = ineditas.length;
        const registroB3 = await db.importacao.create({
          data: {
            arquivo: dados.arquivo,
            tipo: 'B3',
            banco: 'B3',
            referencia: dados.periodo ? `${dados.periodo.de} a ${dados.periodo.ate}` : dataISO(hoje()),
            novos: criados + movimentosNovos,
            repetidos: linhas.length - movimentosNovos,
          },
        });
        // Os ativos que esta planilha criou ficam marcados: só eles podem sair se a importação for removida.
        if (idsCriados.length > 0) {
          await db.investimento.updateMany({ where: { id: { in: idsCriados } }, data: { importacaoId: registroB3.id } });
        }
        // Desdobramentos, grupamentos e bonificações só dos ativos importados; o que já foi gravado não entra de novo.
        const linhasEventos: Prisma.EventoAtivoCreateManyInput[] = [];
        const vistosEventos = new Set<string>();
        for (const e of dados.eventos) {
          const investimentoId = idPorChave.get(e.chave);
          if (investimentoId === undefined) continue;
          const chaveEvento = hash(`b3ev|${e.chave}|${e.data}|${e.tipo}|${e.fator}`);
          if (vistosEventos.has(chaveEvento)) continue;
          vistosEventos.add(chaveEvento);
          linhasEventos.push({
            investimentoId,
            data: paraData(e.data),
            tipo: e.tipo,
            fator: e.fator,
            descricao: e.descricao || null,
            chaveImportacao: chaveEvento,
            importacaoId: registroB3.id,
          });
        }
        const chavesEventos = linhasEventos.map((l) => l.chaveImportacao as string);
        const jaGravadosEventos = new Set<string>();
        for (let i = 0; i < chavesEventos.length; i += 1000) {
          const lote = await db.eventoAtivo.findMany({
            where: { chaveImportacao: { in: chavesEventos.slice(i, i + 1000) } },
            select: { chaveImportacao: true },
          });
          for (const ev of lote) if (ev.chaveImportacao) jaGravadosEventos.add(ev.chaveImportacao);
        }
        const eventosNovos = linhasEventos.filter((l) => !jaGravadosEventos.has(l.chaveImportacao as string));
        for (let i = 0; i < eventosNovos.length; i += 1000) {
          await db.eventoAtivo.createMany({ data: eventosNovos.slice(i, i + 1000) });
        }
        const chavesDosMovimentos = ineditas.map((l) => l.chaveImportacao as string);
        for (let i = 0; i < chavesDosMovimentos.length; i += 1000) {
          await db.movimentoInvestimento.updateMany({
            where: { importacaoId: null, chaveImportacao: { in: chavesDosMovimentos.slice(i, i + 1000) } },
            data: { importacaoId: registroB3.id },
          });
        }
        return { criados, atualizados, encerrados, movimentosNovos, movimentosRepetidos: linhas.length - movimentosNovos };
      },
      { timeout: 120000 }
    );

    await registrarPosicaoPatrimonio();
    // As cotações rodam em segundo plano: a resposta não espera por elas.
    tokenDasCotacoes()
      .then(() => atualizarCotacoes())
      .catch(() => undefined);
    res.status(201).json(resultado);
  })
);

// ---------- Cotações ----------

async function estadoDasCotacoes() {
  const [credencial, comCodigo, ultima] = await Promise.all([
    tokenDasCotacoes(),
    prisma.investimento.count({ where: { ativo: true, origem: 'MANUAL', codigo: { not: null }, quantidade: { gt: 0 } } }),
    prisma.investimento.aggregate({ _max: { cotadoEm: true } }),
  ]);
  return {
    configurado: credencial !== null,
    origemToken: credencial?.origem ?? null,
    ativosComCodigo: comCodigo,
    ultimaAtualizacao: ultima._max.cotadoEm ? ultima._max.cotadoEm.toISOString() : null,
  };
}

router.get(
  '/cotacoes/estado',
  asyncHandler(async (_req, res) => {
    res.json(await estadoDasCotacoes());
  })
);

router.put(
  '/cotacoes/token',
  asyncHandler(async (req, res) => {
    const dados = validar(z.object({ token: z.string().trim().min(8).max(200) }), req.body);
    // Testa com um ativo que exige token (lança 400 se o token for recusado).
    await buscarCotacao('ITUB4', dados.token);
    const gravar = { brapiTokenCifrado: cifrar(dados.token) };
    await prisma.configuracaoPlataforma.upsert({ where: { id: 1 }, create: { id: 1, ...gravar }, update: gravar });
    res.json(await estadoDasCotacoes());
  })
);

router.delete(
  '/cotacoes/token',
  asyncHandler(async (_req, res) => {
    await prisma.configuracaoPlataforma.updateMany({ where: { id: 1 }, data: { brapiTokenCifrado: null } });
    res.json(await estadoDasCotacoes());
  })
);

router.post(
  '/cotacoes/atualizar',
  asyncHandler(async (_req, res) => {
    const resultado = await atualizarCotacoes();
    res.json({ ...resultado, estado: await estadoDasCotacoes() });
  })
);

export default router;
