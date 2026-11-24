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
import { perfilAtual, prisma, prismaSemPerfil } from '../../lib/prisma';
import { acessosDoMembro } from '../../lib/perfil';

// Notificações no celular (Web Push): chave pública, inscrição do aparelho, preferências e teste.
// Tudo é do usuário logado (não do perfil financeiro). O verificador roda em segundo plano.

const router = Router();

iniciarVerificador();

const IDS = TIPOS_NOTIFICACAO.map((t) => t.id) as [string, ...string[]];

// Perfis financeiros que o usuário enxerga: o titular, todos; o membro, os que foram liberados para ele.
async function perfisDoUsuario(usuario: { id: number; perfil: string }): Promise<{ id: number; nome: string; cor: string }[]> {
  const todos = await prismaSemPerfil.perfilFinanceiro.findMany({ orderBy: { id: 'asc' }, select: { id: true, nome: true, cor: true } });
  if (usuario.perfil === 'TITULAR') return todos;
  const acessos = await acessosDoMembro(usuario.id);
  return todos.filter((p) => acessos.has(p.id));
}

router.get(
  '/notificacoes/push',
  asyncHandler(async (req, res) => {
    const [{ publica }, preferencias, aparelhos, perfis] = await Promise.all([
      chavesVapid(),
      lerPreferencias(req.usuario.id),
      prisma.inscricaoPush.count({ where: { usuarioId: req.usuario.id } }),
      perfisDoUsuario(req.usuario),
    ]);
    // Só contam os perfis que a pessoa ainda enxerga (um perfil apagado ou um acesso tirado some da lista).
    const visiveis = new Set(perfis.map((p) => p.id));
    preferencias.perfisLigados = preferencias.perfisLigados.filter((id) => visiveis.has(id));
    res.json({
      chavePublica: publica,
      tipos: TIPOS_NOTIFICACAO,
      preferencias,
      aparelhos,
      perfis: perfis.map((p) => ({ ...p, ligado: preferencias.perfisLigados.includes(p.id) })),
    });
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
    // Quem liga as notificações sem ter escolhido perfil nenhum passa a receber do perfil em que está agora.
    const pref = await lerPreferencias(req.usuario.id);
    const atual = perfilAtual();
    if (pref.perfisLigados.length === 0 && atual !== null && (await perfisDoUsuario(req.usuario)).some((p) => p.id === atual)) {
      await salvarPreferencias(req.usuario.id, { ...pref, perfisLigados: [atual] });
    }
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
  perfisLigados: z.array(z.number().int().positive()).max(50).optional(),
  silencioAtivo: z.boolean(),
  silencioInicio: z.number().int().min(0).max(23),
  silencioFim: z.number().int().min(0).max(23),
});

router.put(
  '/notificacoes/push/preferencias',
  asyncHandler(async (req, res) => {
    const d = validar(preferenciasSchema, req.body);
    // Só valem perfis que a pessoa enxerga; sem o campo, a escolha de perfis fica como estava.
    const visiveis = new Set((await perfisDoUsuario(req.usuario)).map((p) => p.id));
    const anteriores = await lerPreferencias(req.usuario.id);
    const perfisLigados = (d.perfisLigados ?? anteriores.perfisLigados).filter((id) => visiveis.has(id));
    await salvarPreferencias(req.usuario.id, { ...d, perfisLigados } as Parameters<typeof salvarPreferencias>[1]);
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
