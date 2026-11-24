import { Router } from 'express';
import { permitir } from '../../lib/auth';
import { asyncHandler } from '../../lib/erros';
import { estadoDoAcesso, pedirEntrada, sairDaConta } from '../../lib/acessoSeguro';

// Acesso seguro (HTTPS) pelo contêiner do Tailscale: estado, link de entrada na conta e saída. Só o titular.

const router = Router();

router.get(
  '/acesso-seguro',
  permitir('TITULAR'),
  asyncHandler(async (_req, res) => {
    res.json(await estadoDoAcesso());
  })
);

router.post(
  '/acesso-seguro/entrar',
  permitir('TITULAR'),
  asyncHandler(async (_req, res) => {
    res.json(await pedirEntrada());
  })
);

router.post(
  '/acesso-seguro/sair',
  permitir('TITULAR'),
  asyncHandler(async (_req, res) => {
    res.json(await sairDaConta());
  })
);

export default router;
