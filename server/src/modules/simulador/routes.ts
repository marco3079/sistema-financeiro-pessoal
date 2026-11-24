import { Router } from 'express';
import { asyncHandler } from '../../lib/erros';
import { carregarSerie, garantirIndices, hojeISO, posicaoEm, somarDias } from '../../lib/indices';
import type { Serie } from '../../lib/indices';

// Taxas de referência para preencher o simulador: IPCA dos últimos 12 meses, Selic atual (ao ano) e o
// histórico do Ibovespa e do IFIX (retorno médio ao ano e oscilação). Lê as séries já gravadas pelo módulo de
// rendimento (lib/indices.ts). Se faltar dado, pede a busca: o IPCA espera alguns segundos; o histórico da bolsa
// (um pedido por ano à B3) segue em segundo plano e aparece numa próxima visita.

const router = Router();
const ESPERA_MS = 8000;
const ANOS_HISTORICO = 10;
const ANOS_MINIMOS = 3;

interface Taxa {
  taxa: number;
  ate: string;
}

interface Historico {
  retornoAnual: number; // média geométrica ao ano (o índice já inclui os proventos reinvestidos)
  volatilidade: number; // desvio dos retornos mensais × √12
  anos: number;
  de: string;
  ate: string;
}

function ipcaDozeMeses(serie: Serie): Taxa | null {
  const n = serie.valores.length;
  // Um ponto por mês (último dia do mês de referência): 12 meses = 13 pontos.
  if (n < 13 || serie.valores[n - 13] <= 0) return null;
  return { taxa: serie.valores[n - 1] / serie.valores[n - 13] - 1, ate: serie.datas[n - 1] };
}

function selicAnual(serie: Serie): Taxa | null {
  const n = serie.valores.length;
  // Um ponto por dia útil, com o nível acumulado: o fator de um dia elevado a 252 dias úteis.
  if (n < 2 || serie.valores[n - 2] <= 0) return null;
  const fatorDia = serie.valores[n - 1] / serie.valores[n - 2];
  return { taxa: Math.pow(fatorDia, 252) - 1, ate: serie.datas[n - 1] };
}

// Nível no fim de cada mês, do mais antigo ao mais novo, nos últimos `anos` anos.
function fechamentosMensais(serie: Serie, anos: number): { data: string; valor: number }[] {
  const n = serie.datas.length;
  if (n === 0) return [];
  const ultima = serie.datas[n - 1];
  const [a, m] = ultima.split('-').map(Number);
  const pontos: { data: string; valor: number }[] = [];
  for (let k = anos * 12; k >= 0; k--) {
    // Último dia do mês (m - k): dia 0 do mês seguinte.
    const fim = new Date(Date.UTC(a, m - k, 0)).toISOString().slice(0, 10);
    const i = posicaoEm(serie, k === 0 ? ultima : fim);
    if (i < 0) continue;
    const ponto = { data: serie.datas[i], valor: serie.valores[i] };
    if (pontos.length === 0 || pontos[pontos.length - 1].data !== ponto.data) pontos.push(ponto);
  }
  return pontos;
}

function historico(serie: Serie): Historico | null {
  const pontos = fechamentosMensais(serie, ANOS_HISTORICO);
  if (pontos.length < ANOS_MINIMOS * 12 + 1) return null;
  const primeiro = pontos[0];
  const ultimo = pontos[pontos.length - 1];
  const dias = (Date.parse(ultimo.data) - Date.parse(primeiro.data)) / 86400000;
  const anos = dias / 365.25;
  if (anos < ANOS_MINIMOS || primeiro.valor <= 0) return null;
  const logs: number[] = [];
  for (let i = 1; i < pontos.length; i++) {
    if (pontos[i - 1].valor > 0 && pontos[i].valor > 0) logs.push(Math.log(pontos[i].valor / pontos[i - 1].valor));
  }
  const media = logs.reduce((s, x) => s + x, 0) / logs.length;
  const variancia = logs.reduce((s, x) => s + (x - media) ** 2, 0) / Math.max(1, logs.length - 1);
  return {
    retornoAnual: Math.pow(ultimo.valor / primeiro.valor, 1 / anos) - 1,
    volatilidade: Math.sqrt(variancia * 12),
    anos: Math.round(anos * 10) / 10,
    de: primeiro.data,
    ate: ultimo.data,
  };
}

router.get(
  '/simulador/indices',
  asyncHandler(async (_req, res) => {
    let ipca = await carregarSerie('IPCA');
    const desdeBolsa = somarDias(hojeISO(), -Math.ceil((ANOS_HISTORICO + 0.2) * 365.25));
    const [ibov0, ifix0] = await Promise.all([carregarSerie('IBOV'), carregarSerie('IFIX')]);
    const faltaBolsa = [ibov0, ifix0].some((s) => s.datas.length === 0 || s.datas[0] > somarDias(desdeBolsa, 45));
    if (ipca.valores.length < 13 || faltaBolsa) {
      const busca = garantirIndices(faltaBolsa ? desdeBolsa : somarDias(hojeISO(), -800));
      if (ipca.valores.length < 13) {
        await Promise.race([busca, new Promise((ok) => setTimeout(ok, ESPERA_MS))]);
        ipca = await carregarSerie('IPCA');
      }
    }
    const [selic, ibov, ifix] = await Promise.all([carregarSerie('SELIC'), carregarSerie('IBOV'), carregarSerie('IFIX')]);
    res.json({
      ipca12m: ipcaDozeMeses(ipca),
      selic: selicAnual(selic),
      ibov: historico(ibov),
      ifix: historico(ifix),
    });
  })
);

export default router;
