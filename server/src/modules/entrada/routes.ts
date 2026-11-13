import { Router } from 'express';
import { asyncHandler } from '../../lib/erros';
import { idsDosPerfis } from '../../lib/perfil';
import { iniciarEntrada, processarEntrada, situacaoDaEntrada } from '../../lib/entrada';

// Pasta de entrada: arquivos .csv e .ofx postos na pasta "financas-pessoais/entrada" do Drive são importados
// sozinhos. A lógica está em lib/entrada.ts.

const router = Router();

iniciarEntrada();

router.get(
  '/entrada',
  asyncHandler(async (_req, res) => {
    res.json(await situacaoDaEntrada());
  })
);

router.post(
  '/entrada/processar',
  asyncHandler(async (_req, res) => {
    // A pasta é uma só: a rodada manual usa o mesmo perfil do laço automático (o primeiro).
    const ids = await idsDosPerfis();
    if (ids.length > 0) await processarEntrada(ids[0]);
    res.json(await situacaoDaEntrada());
  })
);

export default router;
