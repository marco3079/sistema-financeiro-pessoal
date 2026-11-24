import { Router } from 'express';
import { asyncHandler } from '../../lib/erros';
import { carregarSerie, garantirIndices, hojeISO, somarDias } from '../../lib/indices';
import type { Serie } from '../../lib/indices';

// Taxas de referência para preencher o simulador: IPCA dos últimos 12 meses e Selic atual (ao ano).
// Lê a série já gravada pelo módulo de rendimento (lib/indices.ts). Se ainda não houver dados, tenta buscar
// no Banco Central por alguns segundos; se não der, devolve null e a tela usa um valor fixo.

const router = Router();
const ESPERA_MS = 8000;

function ipcaDozeMeses(serie: Serie): { taxa: number; ate: string } | null {
  const n = serie.valores.length;
  // Um ponto por mês (último dia do mês de referência): 12 meses = 13 pontos.
  if (n < 13 || serie.valores[n - 13] <= 0) return null;
  return { taxa: serie.valores[n - 1] / serie.valores[n - 13] - 1, ate: serie.datas[n - 1] };
}

function selicAnual(serie: Serie): { taxa: number; ate: string } | null {
  const n = serie.valores.length;
  // Um ponto por dia útil, com o nível acumulado: o fator de um dia elevado a 252 dias úteis.
  if (n < 2 || serie.valores[n - 2] <= 0) return null;
  const fatorDia = serie.valores[n - 1] / serie.valores[n - 2];
  return { taxa: Math.pow(fatorDia, 252) - 1, ate: serie.datas[n - 1] };
}

router.get(
  '/simulador/indices',
  asyncHandler(async (_req, res) => {
    let ipca = await carregarSerie('IPCA');
    if (ipca.valores.length < 13) {
      const busca = garantirIndices(somarDias(hojeISO(), -800));
      await Promise.race([busca, new Promise((ok) => setTimeout(ok, ESPERA_MS))]);
      ipca = await carregarSerie('IPCA');
    }
    const selic = await carregarSerie('SELIC');
    res.json({ ipca12m: ipcaDozeMeses(ipca), selic: selicAnual(selic) });
  })
);

export default router;
