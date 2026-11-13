import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, HttpError, validar } from '../../lib/erros';
import { perfilAtual } from '../../lib/prisma';
import {
  enviarAvisosPendentes,
  iniciarAvisosDiarios,
  lerConfigAvisos,
  salvarConfigAvisos,
  smtpConfigurado,
  testarAvisos,
} from '../../lib/avisos';

// Avisos por e-mail e Telegram: configuração da plataforma e envio manual. O envio diário é agendado ao carregar.

const router = Router();

iniciarAvisosDiarios();

const configSchema = z.object({
  ativos: z.boolean(),
  email: z.union([z.email().max(120), z.literal('')]).nullable().optional(),
  telegramToken: z.string().trim().max(200).nullable().optional(),
  telegramChatId: z.string().trim().max(40).nullable().optional(),
  apagarToken: z.boolean().optional(),
});

function perfilDaRequisicao(): number {
  const perfilId = perfilAtual();
  if (perfilId === null) throw new HttpError(400, 'Escolha um perfil financeiro');
  return perfilId;
}

router.get(
  '/avisos/config',
  asyncHandler(async (_req, res) => {
    const config = await lerConfigAvisos();
    res.json({
      ativos: config.ativos,
      email: config.email,
      telegramConfigurado: config.telegramConfigurado,
      telegramChatId: config.telegramChatId,
      emailDisponivel: await smtpConfigurado(),
    });
  })
);

router.put(
  '/avisos/config',
  asyncHandler(async (req, res) => {
    const dados = validar(configSchema, req.body);
    const email = dados.email && dados.email !== '' ? dados.email : null;
    const chatId = dados.telegramChatId && dados.telegramChatId !== '' ? dados.telegramChatId : null;
    await salvarConfigAvisos({
      ativos: dados.ativos,
      email,
      telegramChatId: chatId,
      telegramToken: dados.telegramToken ?? null,
      apagarToken: dados.apagarToken ?? false,
    });
    res.json({ ok: true });
  })
);

router.post(
  '/avisos/testar',
  asyncHandler(async (_req, res) => {
    res.json(await testarAvisos(perfilDaRequisicao()));
  })
);

router.post(
  '/avisos/enviar',
  asyncHandler(async (_req, res) => {
    res.json(await enviarAvisosPendentes(perfilDaRequisicao()));
  })
);

export default router;
