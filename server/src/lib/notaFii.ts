// Indicadores de um fundo imobiliário e uma nota de 0 a 100. Cada indicador é comparado com uma faixa que costuma
// ser considerada saudável para FIIs de tijolo e papel, ganha pontos conforme a faixa e pesa na nota. A conta é
// mecânica e aberta (a tela mostra cada faixa e os pontos): não é recomendação de compra ou venda e não olha a
// qualidade dos imóveis, dos inquilinos ou dos créditos.

import type { FundoB3 } from './proventosAnunciados';
import type { FundoCvm } from './cvmFii';

export type Avaliacao = 'BOM' | 'ATENCAO' | 'RUIM';

export interface Indicador {
  chave: string;
  nome: string;
  valor: number | null;
  formato: 'PERCENTUAL' | 'NUMERO' | 'REAIS' | 'REAIS_GRANDE' | 'INTEIRO';
  referencia: string; // a faixa considerada boa, em texto
  avaliacao: Avaliacao | null; // null: sem dado
  pontos: number;
  peso: number;
  explicacao: string;
}

export interface AnaliseFii {
  nota: number | null; // 0 a 100, sobre os indicadores que têm dado
  faixa: 'BOA' | 'ATENCAO' | 'FRACA' | null;
  indicadores: Indicador[];
  pesoConsiderado: number; // soma dos pesos com dado (de 100)
  dataCvm: string | null; // mês do informe da CVM usado
}

function arred(v: number, casas = 2): number {
  const f = 10 ** casas;
  return Math.round(v * f) / f;
}

// Pontos pela primeira faixa que vale (faixas na ordem, cada uma com [teste, fração do peso, avaliação]).
function pontuar(valor: number | null, peso: number, faixas: [(v: number) => boolean, number, Avaliacao][]): { pontos: number; avaliacao: Avaliacao | null } {
  if (valor === null || !Number.isFinite(valor)) return { pontos: 0, avaliacao: null };
  for (const [teste, fracao, avaliacao] of faixas) if (teste(valor)) return { pontos: arred(peso * fracao, 1), avaliacao };
  return { pontos: 0, avaliacao: 'RUIM' };
}

function variacao(atual: number | null | undefined, antes: number | null | undefined): number | null {
  if (atual === null || atual === undefined || antes === null || antes === undefined || antes === 0) return null;
  return arred((atual / antes - 1) * 100);
}

export function analisarFii(entrada: { fundo: FundoB3; cvm: FundoCvm | null; preco: number | null; preco12m: number | null; hoje: string }): AnaliseFii {
  const { fundo, cvm, preco, preco12m, hoje } = entrada;
  const indicadores: Indicador[] = [];
  const add = (i: Omit<Indicador, 'pontos' | 'avaliacao'>, faixas: [(v: number) => boolean, number, Avaliacao][]) => {
    const { pontos, avaliacao } = pontuar(i.valor, i.peso, faixas);
    indicadores.push({ ...i, pontos, avaliacao });
  };

  const ultimoCvm = cvm?.meses.filter((m) => m.valorPatrimonialCota !== null).at(-1) ?? null;
  const mesUltimo = ultimoCvm?.mes ?? null;
  const ha12 = mesUltimo
    ? cvm?.meses.find((m) => m.mes === `${Number(mesUltimo.slice(0, 4)) - 1}${mesUltimo.slice(4)}`) ?? null
    : null;

  // 1. P/VP
  const pvp = preco !== null && ultimoCvm?.valorPatrimonialCota ? arred(preco / ultimoCvm.valorPatrimonialCota) : null;
  add(
    {
      chave: 'pvp',
      nome: 'P/VP (preço sobre valor patrimonial)',
      valor: pvp,
      formato: 'NUMERO',
      referencia: 'Entre 0,85 e 1,05',
      peso: 20,
      explicacao:
        'Quanto o mercado paga por R$ 1 de patrimônio do fundo. Perto de 1 é o comum; muito abaixo pode ser oportunidade, mas quase sempre indica desconfiança do mercado sobre os ativos ou a gestão; muito acima, cota cara.',
    },
    [
      [(v) => v >= 0.85 && v <= 1.05, 1, 'BOM'],
      [(v) => (v >= 0.75 && v < 0.85) || (v > 1.05 && v <= 1.15), 0.65, 'ATENCAO'],
      [(v) => (v >= 0.6 && v < 0.75) || (v > 1.15 && v <= 1.3), 0.35, 'ATENCAO'],
      [(v) => v < 0.6, 0.15, 'RUIM'],
    ]
  );

  // 2. DY dos últimos 12 meses (proventos pagos / cotação)
  const umAnoAtras = `${Number(hoje.slice(0, 4)) - 1}${hoje.slice(4)}`;
  const doAno = fundo.proventos.filter((p) => p.dataPagamento > umAnoAtras && p.dataPagamento <= hoje && p.tipo === 'RENDIMENTO');
  const porCota12m = doAno.reduce((s, p) => s + p.valorPorCota, 0);
  const dy = preco && doAno.length > 0 ? arred((porCota12m / preco) * 100) : null;
  add(
    {
      chave: 'dy',
      nome: 'Dividend yield (12 meses)',
      valor: dy,
      formato: 'PERCENTUAL',
      referencia: 'Entre 8% e 15% ao ano',
      peso: 15,
      explicacao:
        'Rendimentos pagos nos últimos 12 meses sobre a cotação de hoje. Muito alto costuma vir de cota que caiu muito, e o rendimento pode não se sustentar.',
    },
    [
      [(v) => v >= 8 && v <= 15, 1, 'BOM'],
      [(v) => v >= 6 && v < 8, 0.5, 'ATENCAO'],
      [(v) => v > 15 && v <= 20, 0.5, 'ATENCAO'],
      [(v) => v > 20, 0.2, 'RUIM'],
      [(v) => v < 6, 0.2, 'RUIM'],
    ]
  );

  // 3. Tendência dos rendimentos: média dos 3 últimos contra a dos 9 anteriores
  const pagos = fundo.proventos.filter((p) => p.dataPagamento <= hoje && p.tipo === 'RENDIMENTO').slice(0, 12);
  const media = (l: typeof pagos) => (l.length ? l.reduce((s, p) => s + p.valorPorCota, 0) / l.length : null);
  const tendencia = pagos.length >= 6 ? variacao(media(pagos.slice(0, 3)), media(pagos.slice(3))) : null;
  add(
    {
      chave: 'tendencia',
      nome: 'Tendência dos rendimentos',
      valor: tendencia,
      formato: 'PERCENTUAL',
      referencia: 'Estável ou subindo (queda de até 5%)',
      peso: 20,
      explicacao: 'Média dos 3 últimos rendimentos por cota comparada à dos 9 anteriores. Quedas seguidas indicam caixa mais apertado.',
    },
    [
      [(v) => v >= -5, 1, 'BOM'],
      [(v) => v >= -15, 0.6, 'ATENCAO'],
      [(v) => v >= -30, 0.25, 'RUIM'],
    ]
  );

  // 4. Valor patrimonial da cota em 12 meses
  const variacaoVp = variacao(ultimoCvm?.valorPatrimonialCota, ha12?.valorPatrimonialCota);
  add(
    {
      chave: 'vp12m',
      nome: 'Valor patrimonial da cota (12 meses)',
      valor: variacaoVp,
      formato: 'PERCENTUAL',
      referencia: 'Estável ou subindo',
      peso: 15,
      explicacao: 'Quanto o patrimônio por cota mudou em um ano (informe da CVM). Queda indica imóveis reavaliados para baixo ou rendimento pago acima do resultado.',
    },
    [
      [(v) => v >= 0, 1, 'BOM'],
      [(v) => v >= -5, 0.65, 'ATENCAO'],
      [(v) => v >= -10, 0.3, 'RUIM'],
    ]
  );

  // 5. Cotação em 12 meses
  const variacaoCota = variacao(preco, preco12m);
  add(
    {
      chave: 'cota12m',
      nome: 'Cotação (12 meses)',
      valor: variacaoCota,
      formato: 'PERCENTUAL',
      referencia: 'Estável ou subindo (queda de até 10%)',
      peso: 10,
      explicacao: 'Variação do preço da cota em um ano, sem contar os rendimentos.',
    },
    [
      [(v) => v >= 0, 1, 'BOM'],
      [(v) => v >= -10, 0.7, 'ATENCAO'],
      [(v) => v >= -25, 0.3, 'RUIM'],
    ]
  );

  // 6. Tamanho (patrimônio líquido)
  const pl = ultimoCvm?.patrimonioLiquido ?? null;
  add(
    {
      chave: 'pl',
      nome: 'Patrimônio líquido',
      valor: pl,
      formato: 'REAIS_GRANDE',
      referencia: 'Acima de R$ 1 bilhão',
      peso: 10,
      explicacao: 'Fundos maiores costumam ter mais imóveis ou créditos (menos risco concentrado) e mais liquidez na bolsa.',
    },
    [
      [(v) => v >= 1e9, 1, 'BOM'],
      [(v) => v >= 5e8, 0.75, 'BOM'],
      [(v) => v >= 2e8, 0.45, 'ATENCAO'],
      [() => true, 0.2, 'RUIM'],
    ]
  );

  // 7. Cotistas em 12 meses
  const variacaoCotistas = variacao(ultimoCvm?.cotistas, ha12?.cotistas);
  add(
    {
      chave: 'cotistas',
      nome: `Cotistas (12 meses)${ultimoCvm?.cotistas ? ` · ${Math.round(ultimoCvm.cotistas).toLocaleString('pt-BR')} hoje` : ''}`,
      valor: variacaoCotistas,
      formato: 'PERCENTUAL',
      referencia: 'Estável ou crescendo',
      peso: 10,
      explicacao: 'Quantos investidores entraram ou saíram do fundo em um ano. Saída grande costuma acompanhar perda de confiança.',
    },
    [
      [(v) => v >= 0, 1, 'BOM'],
      [(v) => v >= -10, 0.6, 'ATENCAO'],
      [() => true, 0.2, 'RUIM'],
    ]
  );

  const comDado = indicadores.filter((i) => i.avaliacao !== null);
  const pesoConsiderado = comDado.reduce((s, i) => s + i.peso, 0);
  // Com menos da metade dos pesos com dado, a nota não diz muito: fica sem nota.
  const nota = pesoConsiderado >= 50 ? Math.round((comDado.reduce((s, i) => s + i.pontos, 0) / pesoConsiderado) * 100) : null;
  return {
    nota,
    faixa: nota === null ? null : nota >= 70 ? 'BOA' : nota >= 45 ? 'ATENCAO' : 'FRACA',
    indicadores,
    pesoConsiderado,
    dataCvm: mesUltimo,
  };
}
