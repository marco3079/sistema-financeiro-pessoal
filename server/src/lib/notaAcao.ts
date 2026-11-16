// Indicadores de uma ação calculados com o balanço anual da CVM (lib/cvmBalancos.ts), as ações e os proventos da
// B3 (lib/b3Companhia.ts) e a cotação; e uma nota de 0 a 100 no mesmo formato da nota dos FIIs (lib/notaFii.ts):
// cada indicador cai numa faixa, ganha pontos e pesa na nota. As faixas são as que costumam ser consideradas
// saudáveis para empresas em geral; bancos e holdings fogem do padrão em alguns indicadores (banco não tem EBITDA nem
// liquidez corrente) e o indicador sem dado fica de fora da conta. Não é recomendação de compra ou venda.

import type { Avaliacao, Indicador } from './notaFii';
import type { Balanco } from './cvmBalancos';
import type { ProventoAcao } from './b3Companhia';

export interface AnaliseAcao {
  nota: number | null;
  faixa: 'BOA' | 'ATENCAO' | 'FRACA' | null;
  indicadores: Indicador[];
  pesoConsiderado: number;
  dataCvm: string | null; // fim do exercício do balanço usado
}

function arred(v: number, casas = 2): number {
  const f = 10 ** casas;
  return Math.round(v * f) / f;
}

function pontuar(valor: number | null, peso: number, faixas: [(v: number) => boolean, number, Avaliacao][]): { pontos: number; avaliacao: Avaliacao | null } {
  if (valor === null || !Number.isFinite(valor)) return { pontos: 0, avaliacao: null };
  for (const [teste, fracao, avaliacao] of faixas) if (teste(valor)) return { pontos: arred(peso * fracao, 1), avaliacao };
  return { pontos: 0, avaliacao: 'RUIM' };
}

function divisao(a: number | null, b: number | null): number | null {
  return a === null || b === null || b === 0 ? null : a / b;
}

export function analisarAcao(entrada: {
  balanco: Balanco | null;
  lucro5AnosAntes: number | null;
  preco: number | null; // da ação (ou unit) consultada: usado no dividend yield
  valorDeMercado: number | null; // ações ON × preço da ON + ações PN × preço da PN
  proventos: ProventoAcao[]; // da classe da ação
  hoje: string;
}): AnaliseAcao & { valores: Record<string, number | null> } {
  const { balanco: b, lucro5AnosAntes, preco, valorDeMercado, proventos, hoje } = entrada;
  const ebitda = b?.ebit !== null && b?.ebit !== undefined ? b.ebit + (b.depreciacao ?? 0) : null;
  const dividaLiquida = b?.dividaBruta !== null && b?.dividaBruta !== undefined ? b.dividaBruta - (b.caixa ?? 0) : null;
  const umAnoAtras = `${Number(hoje.slice(0, 4)) - 1}${hoje.slice(4)}`;
  const porAcao12m = proventos.filter((p) => p.dataPagamento > umAnoAtras && p.dataPagamento <= hoje).reduce((s, p) => s + p.valorPorAcao, 0);

  const pl = b && b.lucro !== null && b.lucro > 0 ? divisao(valorDeMercado, b.lucro) : b && b.lucro !== null && b.lucro <= 0 ? -1 : null;
  const pvp = b?.patrimonioLiquido && b.patrimonioLiquido > 0 ? divisao(valorDeMercado, b.patrimonioLiquido) : null;
  const dy = preco && proventos.length > 0 ? (porAcao12m / preco) * 100 : null;
  const roe = b?.patrimonioLiquido && b.patrimonioLiquido > 0 && b.lucro !== null ? (b.lucro / b.patrimonioLiquido) * 100 : null;
  const dividaEbitda = ebitda !== null && ebitda > 0 ? divisao(dividaLiquida, ebitda) : null;
  const margem = b?.receita && b.receita > 0 && b.lucro !== null ? (b.lucro / b.receita) * 100 : null;
  const cagr =
    b?.lucro && lucro5AnosAntes && b.lucro > 0 && lucro5AnosAntes > 0 ? (Math.pow(b.lucro / lucro5AnosAntes, 1 / 5) - 1) * 100 : null;
  const liquidez = divisao(b?.ativoCirculante ?? null, b?.passivoCirculante ?? null);

  const indicadores: Indicador[] = [];
  const add = (i: Omit<Indicador, 'pontos' | 'avaliacao'>, faixas: [(v: number) => boolean, number, Avaliacao][]) => {
    const valor = i.valor === null ? null : arred(i.valor);
    const { pontos, avaliacao } = pontuar(valor, i.peso, faixas);
    indicadores.push({ ...i, valor, pontos, avaliacao });
  };

  add(
    {
      chave: 'pl',
      nome: 'P/L (preço sobre lucro)',
      valor: pl,
      formato: 'NUMERO',
      referencia: 'Entre 3 e 15',
      peso: 15,
      explicacao: 'Valor de mercado sobre o lucro do último ano: quantos anos de lucro pagam a empresa. −1 indica prejuízo.',
    },
    [
      [(x) => x >= 3 && x <= 15, 1, 'BOM'],
      [(x) => (x > 15 && x <= 25) || (x > 0 && x < 3), 0.5, 'ATENCAO'],
      [() => true, 0.1, 'RUIM'],
    ]
  );
  add(
    {
      chave: 'pvp',
      nome: 'P/VP (preço sobre valor patrimonial)',
      valor: pvp,
      formato: 'NUMERO',
      referencia: 'Entre 0,5 e 2',
      peso: 10,
      explicacao: 'Valor de mercado sobre o patrimônio dos acionistas. Empresas muito lucrativas costumam valer mais que o patrimônio.',
    },
    [
      [(x) => x >= 0.5 && x <= 2, 1, 'BOM'],
      [(x) => (x > 2 && x <= 4) || (x > 0 && x < 0.5), 0.5, 'ATENCAO'],
      [() => true, 0.1, 'RUIM'],
    ]
  );
  add(
    {
      chave: 'dy',
      nome: 'Dividend yield (12 meses)',
      valor: dy,
      formato: 'PERCENTUAL',
      referencia: 'Entre 5% e 12% ao ano',
      peso: 15,
      explicacao: 'Dividendos e JCP (brutos) pagos em 12 meses por esta classe de ação, sobre a cotação.',
    },
    [
      [(x) => x >= 5 && x <= 12, 1, 'BOM'],
      [(x) => (x >= 2 && x < 5) || (x > 12 && x <= 18), 0.5, 'ATENCAO'],
      [() => true, 0.15, 'RUIM'],
    ]
  );
  add(
    {
      chave: 'roe',
      nome: 'ROE (retorno sobre o patrimônio)',
      valor: roe,
      formato: 'PERCENTUAL',
      referencia: 'Acima de 15%',
      peso: 20,
      explicacao: 'Lucro do ano sobre o patrimônio dos acionistas: quanto a empresa rende com o dinheiro dela.',
    },
    [
      [(x) => x >= 15, 1, 'BOM'],
      [(x) => x >= 8, 0.5, 'ATENCAO'],
      [() => true, 0.1, 'RUIM'],
    ]
  );
  add(
    {
      chave: 'divida',
      nome: 'Dívida líquida / EBITDA',
      valor: dividaEbitda,
      formato: 'NUMERO',
      referencia: 'Até 2 (negativo é caixa sobrando)',
      peso: 15,
      explicacao: 'Em quantos anos a geração de caixa operacional paga a dívida líquida. Bancos e seguradoras não têm esse indicador.',
    },
    [
      [(x) => x <= 2, 1, 'BOM'],
      [(x) => x <= 3.5, 0.5, 'ATENCAO'],
      [() => true, 0.1, 'RUIM'],
    ]
  );
  add(
    {
      chave: 'margem',
      nome: 'Margem líquida',
      valor: margem,
      formato: 'PERCENTUAL',
      referencia: 'Acima de 10%',
      peso: 10,
      explicacao: 'Quanto de cada R$ 100 de receita vira lucro. Holdings podem passar de 100% (o lucro vem das empresas investidas).',
    },
    [
      [(x) => x >= 10, 1, 'BOM'],
      [(x) => x >= 5, 0.5, 'ATENCAO'],
      [() => true, 0.1, 'RUIM'],
    ]
  );
  add(
    {
      chave: 'cagr',
      nome: 'Crescimento do lucro (5 anos, ao ano)',
      valor: cagr,
      formato: 'PERCENTUAL',
      referencia: 'Acima de 10% ao ano',
      peso: 10,
      explicacao: 'Quanto o lucro cresceu por ano, em média, em 5 anos (balanços da CVM). Sem número quando um dos anos teve prejuízo.',
    },
    [
      [(x) => x >= 10, 1, 'BOM'],
      [(x) => x >= 0, 0.5, 'ATENCAO'],
      [() => true, 0.1, 'RUIM'],
    ]
  );
  add(
    {
      chave: 'liquidez',
      nome: 'Liquidez corrente',
      valor: liquidez,
      formato: 'NUMERO',
      referencia: 'Acima de 1,5',
      peso: 5,
      explicacao: 'Ativo circulante sobre passivo circulante. Abaixo de 1, a empresa deve no curto prazo mais do que tem.',
    },
    [
      [(x) => x >= 1.5, 1, 'BOM'],
      [(x) => x >= 1, 0.5, 'ATENCAO'],
      [() => true, 0.1, 'RUIM'],
    ]
  );

  const comDado = indicadores.filter((i) => i.avaliacao !== null);
  const pesoConsiderado = comDado.reduce((s, i) => s + i.peso, 0);
  const nota = pesoConsiderado >= 50 ? Math.round((comDado.reduce((s, i) => s + i.pontos, 0) / pesoConsiderado) * 100) : null;
  return {
    nota,
    faixa: nota === null ? null : nota >= 70 ? 'BOA' : nota >= 45 ? 'ATENCAO' : 'FRACA',
    indicadores,
    pesoConsiderado,
    dataCvm: b?.exercicio ?? null,
    valores: {
      valorDeMercado: valorDeMercado === null ? null : arred(valorDeMercado, 0),
      lucro: b?.lucro ?? null,
      receita: b?.receita ?? null,
      patrimonioLiquido: b?.patrimonioLiquido ?? null,
      ebitda: ebitda === null ? null : arred(ebitda, 0),
      dividaLiquida: dividaLiquida === null ? null : arred(dividaLiquida, 0),
      proventosPorAcao12m: proventos.length > 0 ? arred(porAcao12m, 4) : null,
    },
  };
}
