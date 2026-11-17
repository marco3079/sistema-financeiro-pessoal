import { Router } from 'express';
import { z } from 'zod';
import type { ConexaoDireta } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { registrarPosicaoPatrimonio } from '../../lib/financas';
import { CONECTORES } from '../../lib/bancosDiretos/conectores';
import {
  cifrarCredenciais,
  iniciarDiretasAutomaticas,
  sincronizarDireta,
  testarCredenciais,
} from '../../lib/bancosDiretos/sincronizar';

// Conexão direta com a API do banco (contas PJ): Inter Empresas, Cora e Mercado Pago. Rotas em /api/bancos.
// As credenciais e o certificado são cifrados no banco de dados e nunca voltam para o navegador.

const router = Router();

iniciarDiretasAutomaticas();

function conexaoDTO(c: ConexaoDireta) {
  return {
    id: c.id,
    banco: c.banco,
    bancoNome: CONECTORES[c.banco]?.nome ?? c.banco,
    cor: CONECTORES[c.banco]?.cor ?? null,
    apelido: c.apelido,
    contaId: c.contaId,
    status: c.status,
    erro: c.erro,
    ultimaSincronizacao: c.ultimaSincronizacao ? c.ultimaSincronizacao.toISOString() : null,
  };
}

async function conexaoPorId(id: number): Promise<ConexaoDireta> {
  const c = await prisma.conexaoDireta.findUnique({ where: { id } });
  if (!c) throw new HttpError(404, 'Conexão não encontrada');
  return c;
}

router.get(
  '/bancos/estado',
  asyncHandler(async (_req, res) => {
    const conexoes = await prisma.conexaoDireta.findMany({ orderBy: { apelido: 'asc' } });
    res.json({
      conectores: Object.values(CONECTORES).map((c) => ({
        id: c.id,
        nome: c.nome,
        cor: c.cor,
        campos: c.campos,
        comoObter: c.comoObter,
        observacao: c.observacao ?? null,
      })),
      conexoes: conexoes.map(conexaoDTO),
    });
  })
);

const conectarSchema = z.object({
  banco: z.string().trim().min(2).max(30),
  apelido: z.string().trim().min(1).max(80),
  credenciais: z.record(z.string(), z.string().max(20_000)),
});

router.post(
  '/bancos/conexoes',
  asyncHandler(async (req, res) => {
    const dados = validar(conectarSchema, req.body);
    const conector = CONECTORES[dados.banco];
    if (!conector) throw new HttpError(400, 'Este banco ainda não tem conexão direta');
    // Só os campos do conector, sem espaços sobrando.
    const credenciais: Record<string, string> = {};
    for (const campo of conector.campos) {
      const valor = (dados.credenciais[campo.nome] ?? '').trim();
      if (campo.obrigatorio && valor === '') throw new HttpError(400, `Preencha: ${campo.rotulo}`);
      if (valor !== '') credenciais[campo.nome] = valor;
    }
    try {
      await testarCredenciais(conector.id, credenciais);
    } catch (erro) {
      const motivo = erro instanceof Error ? erro.message : 'falha desconhecida';
      throw new HttpError(400, `${conector.nome} recusou a conexão. ${motivo}`);
    }
    const criada = await prisma.conexaoDireta.create({
      data: { banco: conector.id, apelido: dados.apelido, credenciaisCifradas: cifrarCredenciais(credenciais) },
    });
    await sincronizarDireta(criada.id);
    res.status(201).json(conexaoDTO(await conexaoPorId(criada.id)));
  })
);

router.post(
  '/bancos/conexoes/:id/sincronizar',
  asyncHandler(async (req, res) => {
    const c = await conexaoPorId(idParam(req));
    await sincronizarDireta(c.id);
    res.json(conexaoDTO(await conexaoPorId(c.id)));
  })
);

router.delete(
  '/bancos/conexoes/:id',
  asyncHandler(async (req, res) => {
    const c = await conexaoPorId(idParam(req));
    const manterDados = req.query.manterDados === 'true';
    await prisma.$transaction(async (db) => {
      if (!manterDados && c.contaId) {
        await db.conta.deleteMany({ where: { id: c.contaId } }); // lançamentos saem por cascata
      }
      await db.conexaoDireta.delete({ where: { id: c.id } });
    });
    await registrarPosicaoPatrimonio();
    res.status(204).end();
  })
);

export default router;
