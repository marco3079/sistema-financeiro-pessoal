import type { TipoInvestimento } from '../../lib/financas';

// Contratos de GET /carteira e GET /carteira/proventos. Todos os percentuais já vêm em % (12.34 = 12,34%).

export type ClasseCarteira = 'RENDA_VARIAVEL' | 'RENDA_FIXA' | 'FUNDOS' | 'OUTROS';

export interface Comparado {
  carteira: number | null;
  cdi: number | null;
  ibov: number | null;
  ipca: number | null;
  ifix: number | null;
}

export interface CarteiraDTO {
  geradoEm: string;
  desde: string | null; // data da primeira aplicação
  classe: 'TODAS' | ClasseCarteira;
  periodo: { meses: number; inicio: string | null };
  resumo: {
    saldo: number;
    aplicado: number;
    ganhoDeCapital: number; // saldo menos o que foi pago pelos ativos atuais
    proventos: number; // recebidos desde o início
    ativos: number;
    ganhoDeCapitalNoMes: number;
    rentabilidadeNoMes: number | null;
    cdiNoMes: number | null;
    ibovNoMes: number | null;
    percentualDoCdiNoMes: number | null; // rentabilidade do mês como % do CDI do mês
    rentabilidadeDoInicio: number | null;
  };
  periodos: ({ chave: 'MES' | 'SEIS_MESES' | 'ANO' | 'DOZE_MESES' | 'INICIO'; rotulo: string } & Comparado)[];
  // Rentabilidade acumulada dia a dia desde o início da janela (todas as listas têm o mesmo tamanho).
  diario: { datas: string[]; carteira: number[]; cdi: number[]; ibov: number[]; ipca: number[]; ifix: number[] };
  // Um item por mês da janela, do mais antigo para o mais novo. `acumulado` = rentabilidade da carteira até o mês.
  mensal: ({ mes: string; patrimonio: number; ganhoDeCapital: number; proventos: number; acumulado: number | null } & Comparado)[];
  anual: ({ ano: number } & Comparado)[];
  extremos: {
    piorDia: { data: string; valor: number } | null;
    melhorDia: { data: string; valor: number } | null;
    piorMes: { mes: string; valor: number } | null;
    melhorMes: { mes: string; valor: number } | null;
    piorAno: { ano: number; valor: number } | null;
    melhorAno: { ano: number; valor: number } | null;
  };
  estatisticas: {
    mesesPositivos: number;
    mesesNegativos: number;
    mesesAcimaDoCdi: number;
    mesesAbaixoDoCdi: number;
    maior: number | null;
    menor: number | null;
    media: number | null;
  };
  classes: { chave: ClasseCarteira; rotulo: string; saldo: number; parte: number }[];
  instituicoes: { nome: string; saldo: number; parte: number; mes: number | null; ano: number | null; acumulada: number | null }[];
  ativos: {
    id: number;
    nome: string;
    codigo: string | null;
    classe: string; // já é o rótulo: "Renda variável"
    instituicao: string | null;
    saldo: number;
    parte: number;
    quantidade: number | null;
    precoMedio: number | null;
    precoAtual: number | null;
    rentabilidade: number | null; // acumulada desde a primeira compra, com proventos
    percentualDoCdi: number | null;
  }[];
  avisos: string[];
}

export interface ItemAgenda {
  data: string; // 'AAAA-MM-DD'
  id: number; // id do investimento
  rotulo: string; // código do ativo
  valor: number;
  situacao: 'RECEBIDO' | 'PREVISTO';
}

export interface ProventosDTO {
  geradoEm: string;
  meses: number;
  total: number; // no período pedido
  mediaMensal: number;
  ultimosDozeMeses: number;
  rendimentoSobreOCusto: number | null; // proventos de 12 meses sobre o valor aplicado, em %
  historico: { mes: string; total: number }[];
  // Mapa de calor: 12 meses (colunas) por ativo (linhas); valores[i] corresponde a meses[i].
  mapa: { meses: string[]; linhas: { id: number; rotulo: string; valores: number[]; total: number }[] };
  porAtivo: {
    id: number;
    rotulo: string;
    nome: string;
    tipo: TipoInvestimento;
    total: number;
    parte: number;
    pagamentos: number;
    ultimoValor: number | null;
    ultimaData: string | null;
    rendimentoSobreOCusto: number | null;
  }[];
  agenda: {
    esteMes: { recebido: number; previsto: number };
    proximosTresMeses: number; // previstos
    proximosDozeMeses: number;
    itens: ItemAgenda[]; // recebidos dos últimos 12 meses e previstos dos próximos 12, em ordem de data
  };
}

// Funções de formatação usadas por todas as abas.
export function pct(valor: number | null | undefined): string {
  if (valor === null || valor === undefined) return '—';
  return (valor > 0 ? '+' : '') + valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
}

export function classeDoSinal(valor: number | null | undefined): string {
  if (valor === null || valor === undefined || valor === 0) return '';
  return valor > 0 ? 'cart-positivo' : 'cart-negativo';
}

const MESES_CURTOS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

// '2026-11' -> 'Nov/26'
export function mesCurto(mes: string): string {
  return `${MESES_CURTOS[Number(mes.slice(5, 7)) - 1] ?? ''}/${mes.slice(2, 4)}`;
}

// '2026-11-12' -> '12/11/26'
export function diaCurto(data: string): string {
  return `${data.slice(8, 10)}/${data.slice(5, 7)}/${data.slice(2, 4)}`;
}
