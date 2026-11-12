import { Router } from 'express';
import { asyncHandler } from '../../lib/erros';
import { iniciarRendimentoAutomatico, montarRelatorio } from '../../lib/rendimento';

// Rendimento dos investimentos comparado com Selic, IPCA, Ibovespa e IFIX, saldo da renda fixa pela taxa
// e projeção para 12 meses. O cálculo está em lib/rendimento.ts.

const router = Router();

iniciarRendimentoAutomatico();

// Relatório completo. Busca os índices na primeira vez (pode levar alguns segundos) e depois a cada 12 horas.
router.get(
  '/rendimento',
  asyncHandler(async (_req, res) => {
    res.json(await montarRelatorio());
  })
);

// Busca os índices de novo agora e devolve o relatório recalculado.
router.post(
  '/rendimento/atualizar',
  asyncHandler(async (_req, res) => {
    res.json(await montarRelatorio(true));
  })
);

export default router;
