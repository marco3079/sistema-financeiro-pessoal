import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, HttpError, validar } from '../../lib/erros';
import {
  TIPOS_NOTIFICACAO,
  chavesVapid,
  desinscrever,
  enviarParaUsuario,
  iniciarVerificador,
  inscrever,
  lerPreferencias,
  salvarPreferencias, type FalhaDeEnvio } from '../../lib/notificacoes';
import { prisma } from '../../lib/prisma';

// Notificações no celular (Web Push): chave pública, inscrição do aparelho, preferências e teste.
// Tudo é do usuário logado (não do perfil financeiro). O verificador roda em segundo plano.

const router = Router();

iniciarVerificador();

const IDS = TIPOS_NOTIFICACAO.map((t) => t.id) as [string, ...string[]];

router.get(
  '/notificacoes/push',
  asyncHandler(async (req, res) => {
    const [{ publica }, preferencias, aparelhos] = await Promise.all([
      chavesVapid(),
      lerPreferencias(req.usuario.id),
      prisma.inscricaoPush.count({ where: { usuarioId: req.usuario.id } }),
    ]);
    res.json({ chavePublica: publica, tipos: TIPOS_NOTIFICACAO, preferencias, aparelhos });
  })
);

const inscricaoSchema = z.object({
  endpoint: z.url().max(1000),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
  aparelho: z.string().trim().max(80).nullable().optional(),
});

router.post(
  '/notificacoes/push/inscricao',
  asyncHandler(async (req, res) => {
    const d = validar(inscricaoSchema, req.body);
    if (!/^https:\/\//i.test(d.endpoint)) throw new HttpError(400, 'Endereço de inscrição inválido');
    await inscrever(req.usuario.id, { endpoint: d.endpoint, p256dh: d.keys.p256dh, auth: d.keys.auth, aparelho: d.aparelho ?? null });
    res.status(204).end();
  })
);

router.post(
  '/notificacoes/push/remover',
  asyncHandler(async (req, res) => {
    const d = validar(z.object({ endpoint: z.string().max(1000) }), req.body);
    await desinscrever(req.usuario.id, d.endpoint);
    res.status(204).end();
  })
);

const preferenciasSchema = z.object({
  desligados: z.array(z.enum(IDS)).max(IDS.length),
  silencioAtivo: z.boolean(),
  silencioInicio: z.number().int().min(0).max(23),
  silencioFim: z.number().int().min(0).max(23),
});

router.put(
  '/notificacoes/push/preferencias',
  asyncHandler(async (req, res) => {
    const d = validar(preferenciasSchema, req.body);
    await salvarPreferencias(req.usuario.id, d as Parameters<typeof salvarPreferencias>[1]);
    res.json(await lerPreferencias(req.usuario.id));
  })
);

router.post(
  '/notificacoes/push/teste',
  asyncHandler(async (req, res) => {
    const falhas: FalhaDeEnvio[] = [];
    const entregues = await enviarParaUsuario(
      req.usuario.id,
      { tipo: 'seguranca', titulo: 'Notificações ligadas ✅', corpo: 'É assim que os avisos vão chegar neste aparelho.', url: '/app' },
      true,
      falhas
    );
    // As falhas vão junto para a tela dizer o motivo (ex.: "Apple 403 BadJwtToken").
    res.json({ entregues, falhas });
  })
);

export default router;
