import { Router } from 'express';
import { z } from 'zod';
import type { ConexaoBancaria } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { cifrar } from '../../lib/cripto';
import { registrarPosicaoPatrimonio } from '../../lib/financas';
import {
  apagarItem,
  autenticarNaPluggy,
  credenciaisPluggy,
  criarConnectToken,
  esquecerChavePluggy,
  obterItem,
} from '../../lib/pluggy';
import { iniciarSincronizacaoAutomatica, sincronizarConexao, sincronizarTudo } from '../../lib/sincronizacao';

// Open Finance (Pluggy): credenciais, token do widget, conexões e sincronização.
// As rotas ficam sob /api/openfinance. O módulo liga a sincronização automática ao ser carregado.

const router = Router();

iniciarSincronizacaoAutomatica();

// ---------- Formatos ----------

type ConexaoComContagem = ConexaoBancaria & { _count: { contas: number; investimentos: number } };

const CONTAR = { _count: { select: { contas: true, investimentos: true } } } as const;

function conexaoDTO(c: ConexaoComContagem) {
  return {
    id: c.id,
    instituicao: c.instituicao,
    instituicaoLogo: c.instituicaoLogo,
    instituicaoCor: c.instituicaoCor,
    status: c.status,
    erro: c.erro,
    ultimaSincronizacao: c.ultimaSincronizacao ? c.ultimaSincronizacao.toISOString() : null,
    criadoEm: c.criadoEm.toISOString(),
    contas: c._count.contas,
    investimentos: c._count.investimentos,
  };
}

async function conexaoPorId(id: number): Promise<ConexaoComContagem> {
  const conexao = await prisma.conexaoBancaria.findUnique({ where: { id }, include: CONTAR });
  if (!conexao) {
    throw new HttpError(404, 'Conexão não encontrada');
  }
  return conexao;
}

async function estado() {
  const [credenciais, conexoes] = await Promise.all([
    credenciaisPluggy(),
    prisma.conexaoBancaria.findMany({ include: CONTAR, orderBy: { instituicao: 'asc' } }),
  ]);
  return {
    configurado: credenciais !== null,
    origemCredenciais: credenciais?.origem ?? null,
    clientId: credenciais?.clientId ?? null,
    sandbox: credenciais?.sandbox ?? false,
    conexoes: conexoes.map(conexaoDTO),
  };
}

// ---------- Estado e credenciais ----------

router.get(
  '/openfinance/estado',
  asyncHandler(async (_req, res) => {
    res.json(await estado());
  })
);

const credenciaisSchema = z.object({
  clientId: z.string().trim().min(8).max(100),
  clientSecret: z.string().trim().min(8).max(200).optional(),
  sandbox: z.boolean(),
});

router.put(
  '/openfinance/credenciais',
  asyncHandler(async (req, res) => {
    const dados = validar(credenciaisSchema, req.body);
    const atuais = await credenciaisPluggy();
    // Sem segredo novo, vale o que já está gravado no banco para o mesmo Client ID.
    const segredo =
      dados.clientSecret ??
      (atuais && atuais.origem === 'BANCO' && atuais.clientId === dados.clientId ? atuais.clientSecret : undefined);
    if (!segredo) {
      throw new HttpError(400, 'Informe o Client Secret');
    }
    // Testa na Pluggy antes de gravar (lança 400 com o motivo se forem recusadas).
    await autenticarNaPluggy(dados.clientId, segredo);
    const gravar = {
      pluggyClientId: dados.clientId,
      pluggyClientSecretCifrado: cifrar(segredo),
      pluggySandbox: dados.sandbox,
    };
    await prisma.configuracaoPlataforma.upsert({ where: { id: 1 }, create: { id: 1, ...gravar }, update: gravar });
    esquecerChavePluggy();
    res.json(await estado());
  })
);

router.delete(
  '/openfinance/credenciais',
  asyncHandler(async (_req, res) => {
    await prisma.configuracaoPlataforma.updateMany({
      where: { id: 1 },
      data: { pluggyClientId: null, pluggyClientSecretCifrado: null, pluggySandbox: false },
    });
    esquecerChavePluggy();
    res.json(await estado());
  })
);

// ---------- Token do widget ----------

const tokenSchema = z.object({ conexaoId: z.number().int().positive().optional() });

router.post(
  '/openfinance/token',
  asyncHandler(async (req, res) => {
    const dados = validar(tokenSchema, req.body ?? {});
    const credenciais = await credenciaisPluggy();
    if (!credenciais) {
      throw new HttpError(400, 'O Open Finance ainda não foi configurado. Informe as credenciais da Pluggy.');
    }
    let itemId: string | null = null;
    if (dados.conexaoId !== undefined) {
      itemId = (await conexaoPorId(dados.conexaoId)).pluggyItemId;
    }
    const accessToken = await criarConnectToken(itemId ?? undefined);
    res.json({ accessToken, sandbox: credenciais.sandbox, itemId });
  })
);

// ---------- Conexões ----------

const conexaoSchema = z.object({ itemId: z.string().trim().min(8).max(100) });

router.post(
  '/openfinance/conexoes',
  asyncHandler(async (req, res) => {
    const dados = validar(conexaoSchema, req.body);
    // Confere na Pluggy que o item existe e pertence a estas credenciais.
    const item = await obterItem(dados.itemId);
    const conexao = await prisma.conexaoBancaria.upsert({
      where: { pluggyItemId: item.id },
      create: {
        pluggyItemId: item.id,
        instituicao: item.connector?.name?.trim().slice(0, 120) || 'Instituição',
        instituicaoLogo: item.connector?.imageUrl ?? null,
      },
      update: { status: 'ATUALIZANDO', erro: null },
    });
    await sincronizarConexao(conexao.id);
    res.status(201).json(conexaoDTO(await conexaoPorId(conexao.id)));
  })
);

router.post(
  '/openfinance/sincronizar',
  asyncHandler(async (_req, res) => {
    await sincronizarTudo({ pedirAtualizacao: true });
    const conexoes = await prisma.conexaoBancaria.findMany({ include: CONTAR, orderBy: { instituicao: 'asc' } });
    res.json(conexoes.map(conexaoDTO));
  })
);

router.post(
  '/openfinance/conexoes/:id/sincronizar',
  asyncHandler(async (req, res) => {
    const conexao = await conexaoPorId(idParam(req));
    await sincronizarConexao(conexao.id, { pedirAtualizacao: true });
    res.json(conexaoDTO(await conexaoPorId(conexao.id)));
  })
);

router.delete(
  '/openfinance/conexoes/:id',
  asyncHandler(async (req, res) => {
    const conexao = await conexaoPorId(idParam(req));
    const manterDados = req.query.manterDados === 'true';
    // Revoga o consentimento na Pluggy. Se ela não responder, a conexão sai do sistema mesmo assim.
    await apagarItem(conexao.pluggyItemId).catch((erro: unknown) => {
      console.error('Falha ao apagar o item na Pluggy:', erro instanceof Error ? erro.message : erro);
    });
    await prisma.$transaction(async (db) => {
      const contas = await db.conta.findMany({ where: { conexaoId: conexao.id }, select: { id: true } });
      const idsContas = contas.map((c) => c.id);
      if (manterDados) {
        // Os registros viram manuais: param de ser atualizados e passam a aceitar edição.
        await db.transacao.updateMany({
          where: { contaId: { in: idsContas } },
          data: { origem: 'MANUAL', pluggyTransactionId: null },
        });
        await db.fatura.updateMany({
          where: { contaId: { in: idsContas } },
          data: { origem: 'MANUAL', pluggyBillId: null },
        });
        await db.conta.updateMany({
          where: { id: { in: idsContas } },
          data: { origem: 'MANUAL', pluggyAccountId: null, conexaoId: null },
        });
        await db.movimentoInvestimento.updateMany({
          where: { investimento: { conexaoId: conexao.id } },
          data: { pluggyId: null },
        });
        await db.investimento.updateMany({
          where: { conexaoId: conexao.id },
          data: { origem: 'MANUAL', pluggyInvestmentId: null, conexaoId: null },
        });
      } else {
        await db.conta.deleteMany({ where: { id: { in: idsContas } } }); // lançamentos e faturas saem por cascata
        await db.investimento.deleteMany({ where: { conexaoId: conexao.id } });
      }
      await db.conexaoBancaria.delete({ where: { id: conexao.id } });
    });
    await registrarPosicaoPatrimonio();
    res.status(204).end();
  })
);

export default router;
