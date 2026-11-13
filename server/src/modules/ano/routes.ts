import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { HttpError, asyncHandler } from '../../lib/erros';
import { arredondar, hoje, inteiroQuery, intervaloDoMes, num, textoQuery } from '../../lib/financas';

// Visão do ano: receitas e despesas de cada mês do ano, por categoria, com comparação com o ano anterior.
// Não entram transferências. Crédito em conta CARTAO abate das despesas do mês (não é receita).

const router = Router();

const MESES = 12;

interface Grupo {
  categoriaId: number | null;
  nome: string;
  cor: string;
  atual: number[];
  anterior: number[];
  ocorreu: boolean; // houve algum lançamento no ano pedido
}

interface Linha {
  categoriaId: number | null;
  nome: string;
  cor: string;
  meses: number[];
  total: number;
  media: number;
  totalAnoAnterior: number;
  variacao: number | null;
}

function zeros(): number[] {
  return Array.from({ length: MESES }, () => 0);
}

function soma(valores: number[]): number {
  return valores.reduce((s, v) => s + v, 0);
}

function linhasDe(mapa: Map<string, Grupo>): Linha[] {
  const linhas: Linha[] = [];
  for (const g of mapa.values()) {
    if (!g.ocorreu) continue;
    const meses = g.atual.map(arredondar);
    const total = arredondar(soma(meses));
    const totalAnoAnterior = arredondar(soma(g.anterior));
    const mesesComValor = meses.filter((v) => v !== 0).length;
    const media = mesesComValor > 0 ? arredondar(total / mesesComValor) : 0;
    const variacao = totalAnoAnterior === 0 ? null : arredondar(((total - totalAnoAnterior) / Math.abs(totalAnoAnterior)) * 100);
    linhas.push({ categoriaId: g.categoriaId, nome: g.nome, cor: g.cor, meses, total, media, totalAnoAnterior, variacao });
  }
  return linhas.sort((a, b) => b.total - a.total || a.nome.localeCompare('pt-BR'));
}

// Soma mês a mês das linhas, já com os valores arredondados: assim a soma das linhas bate com o total.
function totaisDe(linhas: Linha[]): number[] {
  return Array.from({ length: MESES }, (_, i) => arredondar(linhas.reduce((s, l) => s + l.meses[i], 0)));
}

function grupoDe(mapa: Map<string, Grupo>, categoriaId: number | null, nome: string, cor: string): Grupo {
  const chave = categoriaId === null ? 'sem' : String(categoriaId);
  let g = mapa.get(chave);
  if (!g) {
    g = { categoriaId, nome, cor, atual: zeros(), anterior: zeros(), ocorreu: false };
    mapa.set(chave, g);
  }
  return g;
}

router.get(
  '/ano',
  asyncHandler(async (req, res) => {
    const bruto = textoQuery(req.query.ano);
    const ano = bruto === undefined ? hoje().getUTCFullYear() : (inteiroQuery(bruto) ?? NaN);
    if (!Number.isInteger(ano) || ano < 1900 || ano > 2100) throw new HttpError(400, 'Ano inválido (use AAAA)');

    const inicio = intervaloDoMes(`${ano - 1}-01`).inicio;
    const fim = intervaloDoMes(`${ano}-12`).fim;

    const [transacoes, faixa] = await Promise.all([
      prisma.transacao.findMany({
        where: { transferencia: false, data: { gte: inicio, lt: fim } },
        select: {
          data: true,
          valor: true,
          tipo: true,
          categoria: { select: { id: true, nome: true, cor: true } },
          conta: { select: { tipo: true } },
        },
      }),
      prisma.transacao.aggregate({ _min: { data: true }, _max: { data: true } }),
    ]);

    const receitas = new Map<string, Grupo>();
    const despesas = new Map<string, Grupo>();
    const anteriorTotais = { receitas: zeros(), despesas: zeros() };

    for (const t of transacoes) {
      const anoT = t.data.getUTCFullYear();
      const indiceMes = t.data.getUTCMonth();
      const valor = num(t.valor);
      const noCartao = t.conta.tipo === 'CARTAO';
      // Crédito no cartão abate as despesas do mês; não é receita.
      const ehReceita = t.tipo === 'RECEITA' && !noCartao;
      const sinal = t.tipo === 'RECEITA' && noCartao ? -1 : 1;
      const mapa = ehReceita ? receitas : despesas;
      const grupo = grupoDe(mapa, t.categoria?.id ?? null, t.categoria?.nome ?? 'Sem categoria', t.categoria?.cor ?? '#64748b');

      if (anoT === ano) {
        grupo.atual[indiceMes] += sinal * valor;
        grupo.ocorreu = true;
      } else if (anoT === ano - 1) {
        grupo.anterior[indiceMes] += sinal * valor;
        anteriorTotais[ehReceita ? 'receitas' : 'despesas'][indiceMes] += sinal * valor;
      }
    }

    const linhasReceitas = linhasDe(receitas);
    const linhasDespesas = linhasDe(despesas);
    const totaisReceitas = totaisDe(linhasReceitas);
    const totaisDespesas = totaisDe(linhasDespesas);

    // Anos com lançamentos (da primeira à última data do perfil), sempre incluindo o ano pedido.
    const anos = new Set<number>([ano]);
    if (faixa._min.data && faixa._max.data) {
      for (let a = faixa._min.data.getUTCFullYear(); a <= faixa._max.data.getUTCFullYear(); a++) anos.add(a);
    }

    res.json({
      ano,
      anos: [...anos].sort((a, b) => a - b),
      despesas: linhasDespesas,
      receitas: linhasReceitas,
      totais: {
        receitas: totaisReceitas,
        despesas: totaisDespesas,
        saldo: totaisReceitas.map((r, i) => arredondar(r - totaisDespesas[i])),
      },
      anterior: {
        receitas: anteriorTotais.receitas.map(arredondar),
        despesas: anteriorTotais.despesas.map(arredondar),
      },
    });
  })
);

export default router;
