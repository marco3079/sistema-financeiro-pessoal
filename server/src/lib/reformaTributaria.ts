// Reforma Tributária do Consumo (LC 214/2025): alíquotas por ano e tratamento de cada tipo de gasto.
//
// As alíquotas de referência oficiais só existem para 2026 (ano de teste). De 2027 em diante são ESTIMATIVAS
// (a CBS de 8,8% e o IBS cheio de 17,7% são as referências citadas pelo governo; o Senado fixa as definitivas).
// A divisão do IBS entre estado e município (75% / 25%) também é aproximada. Tudo aqui é para simulação.
//
// Importante: CBS e IBS SUBSTITUEM PIS, Cofins, ICMS e ISS (e boa parte do IPI). O "imposto embutido" calculado
// não é um custo novo somado ao que já existe: é quanto do preço vai para esses tributos no ano escolhido.

export interface AliquotasDoAno {
  ano: number;
  cbs: number; // %
  ibsUf: number; // %
  ibsMun: number; // %
  oficial: boolean; // true só em 2026 (alíquota de referência publicada)
  nota: string;
}

const IBS_CHEIO = 17.7;
const CBS_CHEIA = 8.8;

function ibs(fracao: number): { ibsUf: number; ibsMun: number } {
  const total = IBS_CHEIO * fracao;
  return { ibsUf: Math.round(total * 0.75 * 100) / 100, ibsMun: Math.round(total * 0.25 * 100) / 100 };
}

export const ALIQUOTAS_POR_ANO: AliquotasDoAno[] = [
  { ano: 2026, cbs: 0.9, ibsUf: 0.1, ibsMun: 0, oficial: true, nota: 'Ano de teste: o valor é compensado com PIS e Cofins, sem custo a mais.' },
  { ano: 2027, cbs: CBS_CHEIA, ibsUf: 0.05, ibsMun: 0.05, oficial: false, nota: 'CBS cheia; PIS e Cofins acabam. IBS ainda simbólico.' },
  { ano: 2028, cbs: CBS_CHEIA, ibsUf: 0.05, ibsMun: 0.05, oficial: false, nota: 'Igual a 2027.' },
  { ano: 2029, cbs: CBS_CHEIA, ...ibs(0.1), oficial: false, nota: 'IBS em 10% do cheio; ICMS e ISS caem 10%.' },
  { ano: 2030, cbs: CBS_CHEIA, ...ibs(0.2), oficial: false, nota: 'IBS em 20% do cheio.' },
  { ano: 2031, cbs: CBS_CHEIA, ...ibs(0.3), oficial: false, nota: 'IBS em 30% do cheio.' },
  { ano: 2032, cbs: CBS_CHEIA, ...ibs(0.4), oficial: false, nota: 'IBS em 40% do cheio.' },
  { ano: 2033, cbs: CBS_CHEIA, ...ibs(1), oficial: false, nota: 'Sistema novo completo; ICMS e ISS deixam de existir.' },
];

export function aliquotasDoAno(ano: number): AliquotasDoAno {
  return ALIQUOTAS_POR_ANO.find((a) => a.ano === ano) ?? ALIQUOTAS_POR_ANO[ALIQUOTAS_POR_ANO.length - 1];
}

// Como um tipo de gasto é tributado. fator = parte da alíquota cheia que se aplica (1 - redução).
export const TRATAMENTOS = {
  INTEGRAL: { rotulo: 'Alíquota cheia', fator: 1, exemplo: 'Compras em geral, eletrônicos, roupas, assinaturas' },
  REDUCAO_40: { rotulo: 'Redução de 40%', fator: 0.6, exemplo: 'Bares e restaurantes, hotelaria' },
  REDUCAO_60: { rotulo: 'Redução de 60%', fator: 0.4, exemplo: 'Alimentos, saúde, remédios, educação, transporte coletivo' },
  REDUCAO_70: { rotulo: 'Redução de 70%', fator: 0.3, exemplo: 'Aluguel residencial' },
  ZERO: { rotulo: 'Alíquota zero', fator: 0, exemplo: 'Cesta básica nacional, alguns remédios' },
  FORA: { rotulo: 'Fora da CBS/IBS', fator: 0, exemplo: 'Juros, tarifas bancárias, impostos, salários' },
} as const;

export type Tratamento = keyof typeof TRATAMENTOS;

export function ehTratamento(v: unknown): v is Tratamento {
  return typeof v === 'string' && v in TRATAMENTOS;
}

function semAcento(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Palpite pelo nome da categoria (a pessoa pode trocar na tela).
const PALPITES: { trechos: string[]; tratamento: Tratamento }[] = [
  { trechos: ['imposto', 'taxa', 'tarifa', 'juros', 'iof', 'multa', 'banco', 'seguro', 'investimento', 'emprestimo', 'financiamento'], tratamento: 'FORA' },
  { trechos: ['restaurante', 'bar', 'lanche', 'delivery', 'ifood', 'hotel', 'viagem'], tratamento: 'REDUCAO_40' },
  { trechos: ['aluguel', 'moradia', 'condominio'], tratamento: 'REDUCAO_70' },
  { trechos: ['mercado', 'supermercado', 'alimenta', 'feira', 'padaria', 'saude', 'farmacia', 'remedio', 'medic', 'educa', 'escola', 'curso', 'faculdade', 'onibus', 'metro'], tratamento: 'REDUCAO_60' },
];

export function tratamentoPeloNome(nome: string): Tratamento {
  const n = semAcento(nome);
  return PALPITES.find((p) => p.trechos.some((t) => n.includes(t)))?.tratamento ?? 'INTEGRAL';
}

// Parte do preço pago que é CBS + IBS: os tributos novos são "por fora", então dentro de um preço p
// com alíquota efetiva t o imposto é p * t / (1 + t).
export function impostoEmbutido(valorPago: number, tratamento: Tratamento, ano: number): { cbs: number; ibs: number; total: number; aliquotaEfetiva: number } {
  const a = aliquotasDoAno(ano);
  const fator = TRATAMENTOS[tratamento].fator;
  const tCbs = (a.cbs / 100) * fator;
  const tIbs = ((a.ibsUf + a.ibsMun) / 100) * fator;
  const t = tCbs + tIbs;
  const total = t === 0 ? 0 : (valorPago * t) / (1 + t);
  const cbs = t === 0 ? 0 : total * (tCbs / t);
  return {
    cbs: Math.round(cbs * 100) / 100,
    ibs: Math.round((total - cbs) * 100) / 100,
    total: Math.round(total * 100) / 100,
    aliquotaEfetiva: Math.round(t * 10000) / 100,
  };
}
