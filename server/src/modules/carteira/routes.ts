import { Router } from 'express';
import { asyncHandler } from '../../lib/erros';
import { textoQuery } from '../../lib/financas';
import { montarCarteira, montarProventos } from '../../lib/carteira';
import type { ClasseCarteira } from '../../lib/carteira';

// Carteira de investimentos: resumo, rentabilidade (por dia, mês e ano, contra os índices), relatório e proventos.
// O cálculo está em lib/carteira.ts.

const router = Router();

const CLASSES: ClasseCarteira[] = ['RENDA_VARIAVEL', 'RENDA_FIXA', 'FUNDOS', 'OUTROS'];

// meses: 6, 12, 24, 60 ou 0 (tudo). Padrão 24.
function mesesDaConsulta(valor: unknown): number {
  const n = Number(textoQuery(valor));
  return [0, 6, 12, 24, 60].includes(n) ? n : 24;
}

router.get(
  '/carteira',
  asyncHandler(async (req, res) => {
    const pedida = textoQuery(req.query.classe);
    const classe = CLASSES.find((c) => c === pedida) ?? 'TODAS';
    res.json(await montarCarteira({ meses: mesesDaConsulta(req.query.meses), classe, forcar: textoQuery(req.query.atualizar) === '1' }));
  })
);

router.get(
  '/carteira/proventos',
  asyncHandler(async (req, res) => {
    res.json(await montarProventos(mesesDaConsulta(req.query.meses)));
  })
);

export default router;
