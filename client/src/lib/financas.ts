// Tipos e funções compartilhados pelas telas financeiras.
// Os formatos (DTO) são os mesmos devolvidos pela API (server/src/lib/financas.ts).
// Convenções: dinheiro é number (reais); datas "só dia" são texto 'AAAA-MM-DD'; mês é 'AAAA-MM'.

export type Origem = 'MANUAL' | 'OPEN_FINANCE';
export type TipoConta = 'CORRENTE' | 'POUPANCA' | 'CARTEIRA' | 'CARTAO' | 'INVESTIMENTO';
export type TipoTransacao = 'RECEITA' | 'DESPESA';
export type StatusFatura = 'ABERTA' | 'FECHADA' | 'PAGA' | 'ATRASADA';
export type TipoInvestimento =
  | 'RENDA_FIXA'
  | 'FUNDO'
  | 'ACAO'
  | 'FII'
  | 'ETF'
  | 'PREVIDENCIA'
  | 'CRIPTO'
  | 'OUTRO';
export type TipoMovimentoInvestimento = 'APLICACAO' | 'RESGATE' | 'RENDIMENTO' | 'IMPOSTO';
export type StatusConexao = 'ATUALIZADA' | 'ATUALIZANDO' | 'ERRO_LOGIN' | 'ERRO';

export interface ContaDTO {
  id: number;
  nome: string;
  tipo: TipoConta;
  instituicao: string | null;
  numero: string | null;
  saldo: number; // em CARTAO é a dívida em aberto (positivo)
  cor: string;
  ativo: boolean;
  bandeira: string | null;
  limite: number | null;
  limiteDisponivel: number | null;
  diaFechamento: number | null;
  diaVencimento: number | null;
  origem: Origem;
  conexaoId: number | null;
}

export interface CategoriaDTO {
  id: number;
  nome: string;
  tipo: TipoTransacao;
  cor: string;
}

export interface TransacaoDTO {
  id: number;
  contaId: number;
  contaNome: string;
  contaTipo: TipoConta;
  data: string;
  descricao: string;
  valor: number; // sempre positivo; o sentido vem de `tipo`
  tipo: TipoTransacao;
  transferencia: boolean;
  pendente: boolean;
  categoriaId: number | null;
  categoriaNome: string | null;
  categoriaCor: string | null;
  faturaId: number | null;
  parcela: number | null;
  totalParcelas: number | null;
  observacao: string | null;
  origem: Origem;
}

export interface FaturaDTO {
  id: number;
  contaId: number;
  contaNome: string;
  vencimento: string;
  fechamento: string | null;
  total: number;
  minimo: number | null;
  status: StatusFatura;
  pagaEm: string | null;
  origem: Origem;
}

export interface InvestimentoDTO {
  id: number;
  nome: string;
  codigo: string | null;
  tipo: TipoInvestimento;
  subtipo: string | null;
  instituicao: string | null;
  emissor: string | null;
  valorAplicado: number;
  saldo: number;
  saldoLiquido: number | null;
  rendimento: number; // saldo - valorAplicado
  rentabilidade: number | null; // percentual sobre o aplicado
  quantidade: number | null;
  taxa: string | null;
  vencimento: string | null;
  dataPosicao: string; // ISO completo
  ativo: boolean;
  origem: Origem;
  conexaoId: number | null;
}

export interface MovimentoInvestimentoDTO {
  id: number;
  investimentoId: number;
  data: string;
  tipo: TipoMovimentoInvestimento;
  valor: number;
  quantidade: number | null;
  descricao: string | null;
}

export interface OrcamentoDTO {
  id: number;
  categoriaId: number;
  categoriaNome: string;
  categoriaCor: string;
  limite: number;
  gasto: number;
  percentual: number; // gasto / limite * 100, arredondado
}

export interface MetaDTO {
  id: number;
  nome: string;
  valorAlvo: number;
  valorAtual: number;
  prazo: string | null;
  cor: string;
  concluida: boolean;
  percentual: number; // 0 a 100
}

export interface ConexaoDTO {
  id: number;
  instituicao: string;
  instituicaoLogo: string | null;
  instituicaoCor: string | null;
  status: StatusConexao;
  erro: string | null;
  ultimaSincronizacao: string | null; // ISO completo
  criadoEm: string;
  contas: number; // quantas contas e cartões vieram desta conexão
  investimentos: number;
}

// ---------- Rótulos ----------

type CorSelo = 'verde' | 'amarelo' | 'vermelho' | 'azul' | 'cinza';

export const TIPOS_CONTA: { valor: TipoConta; rotulo: string }[] = [
  { valor: 'CORRENTE', rotulo: 'Conta corrente' },
  { valor: 'POUPANCA', rotulo: 'Poupança' },
  { valor: 'CARTEIRA', rotulo: 'Carteira (dinheiro)' },
  { valor: 'INVESTIMENTO', rotulo: 'Conta de investimento' },
  { valor: 'CARTAO', rotulo: 'Cartão de crédito' },
];

export const TIPOS_TRANSACAO: { valor: TipoTransacao; rotulo: string }[] = [
  { valor: 'DESPESA', rotulo: 'Despesa' },
  { valor: 'RECEITA', rotulo: 'Receita' },
];

export const TIPOS_INVESTIMENTO: { valor: TipoInvestimento; rotulo: string }[] = [
  { valor: 'RENDA_FIXA', rotulo: 'Renda fixa' },
  { valor: 'FUNDO', rotulo: 'Fundos' },
  { valor: 'ACAO', rotulo: 'Ações' },
  { valor: 'FII', rotulo: 'Fundos imobiliários' },
  { valor: 'ETF', rotulo: 'ETFs' },
  { valor: 'PREVIDENCIA', rotulo: 'Previdência' },
  { valor: 'CRIPTO', rotulo: 'Criptomoedas' },
  { valor: 'OUTRO', rotulo: 'Outros' },
];

export const TIPOS_MOVIMENTO: { valor: TipoMovimentoInvestimento; rotulo: string }[] = [
  { valor: 'APLICACAO', rotulo: 'Aplicação' },
  { valor: 'RESGATE', rotulo: 'Resgate' },
  { valor: 'RENDIMENTO', rotulo: 'Rendimento' },
  { valor: 'IMPOSTO', rotulo: 'Imposto' },
];

export const STATUS_FATURA: Record<StatusFatura, { rotulo: string; cor: CorSelo }> = {
  ABERTA: { rotulo: 'Aberta', cor: 'azul' },
  FECHADA: { rotulo: 'Fechada', cor: 'amarelo' },
  PAGA: { rotulo: 'Paga', cor: 'verde' },
  ATRASADA: { rotulo: 'Atrasada', cor: 'vermelho' },
};

export const STATUS_CONEXAO: Record<StatusConexao, { rotulo: string; cor: CorSelo }> = {
  ATUALIZADA: { rotulo: 'Atualizada', cor: 'verde' },
  ATUALIZANDO: { rotulo: 'Atualizando', cor: 'azul' },
  ERRO_LOGIN: { rotulo: 'Reconectar', cor: 'vermelho' },
  ERRO: { rotulo: 'Erro', cor: 'amarelo' },
};

// Cor fixa de cada tipo de investimento nos gráficos de alocação.
export const COR_TIPO_INVESTIMENTO: Record<TipoInvestimento, string> = {
  RENDA_FIXA: '#2563eb',
  FUNDO: '#7c3aed',
  ACAO: '#10b981',
  FII: '#f59e0b',
  ETF: '#06b6d4',
  PREVIDENCIA: '#ec4899',
  CRIPTO: '#f97316',
  OUTRO: '#64748b',
};

// Paleta oferecida ao escolher a cor de uma conta, categoria ou meta.
export const CORES_PALETA: string[] = [
  '#2563eb',
  '#7c3aed',
  '#10b981',
  '#f59e0b',
  '#dc2626',
  '#06b6d4',
  '#ec4899',
  '#f97316',
  '#84cc16',
  '#64748b',
];

export function rotuloDe<T extends string>(lista: { valor: T; rotulo: string }[], valor: string): string {
  return lista.find((i) => i.valor === valor)?.rotulo ?? valor;
}

// ---------- Datas ----------

const MESES_LONGOS = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

function doisDigitos(n: number): string {
  return String(n).padStart(2, '0');
}

// Hoje como 'AAAA-MM-DD' (relógio do aparelho).
export function hojeISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}-${doisDigitos(d.getDate())}`;
}

// Mês atual como 'AAAA-MM'.
export function mesAtual(): string {
  return hojeISO().slice(0, 7);
}

// 'AAAA-MM' + delta meses -> 'AAAA-MM'.
export function somarMeses(mes: string, delta: number): string {
  const [ano, m] = mes.split('-').map(Number);
  const d = new Date(ano, m - 1 + delta, 1);
  return `${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}`;
}

// 'AAAA-MM' -> 'Novembro de 2026'.
export function rotuloMes(mes: string): string {
  const [ano, m] = mes.split('-').map(Number);
  return `${MESES_LONGOS[m - 1] ?? mes} de ${ano}`;
}

// 'AAAA-MM-DD' -> 'DD/MM/AAAA' (sem passar por Date, para não mudar o dia pelo fuso).
export function formatarDia(data: string | null | undefined): string {
  if (!data) return '—';
  const [ano, mes, dia] = data.slice(0, 10).split('-');
  return `${dia}/${mes}/${ano}`;
}

// ---------- Dinheiro ----------

export function formatarReais(valor: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor);
}

// Texto digitado ("1.234,56", "1234.56", "R$ 10") -> number, ou null se não for número.
export function lerValor(texto: string): number | null {
  let limpo = texto.replace(/[R$\s]/g, '');
  if (limpo === '') return null;
  if (limpo.includes(',')) limpo = limpo.replace(/\./g, '').replace(',', '.');
  const n = Number(limpo);
  return Number.isFinite(n) ? n : null;
}

// number -> texto para preencher um campo de valor ("1234,56").
export function valorParaCampo(valor: number | null | undefined): string {
  if (valor === null || valor === undefined) return '';
  return valor.toFixed(2).replace('.', ',');
}

export function formatarPercentual(valor: number): string {
  return `${valor.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

// ---------- Diversos ----------

export function mensagemErro(e: unknown): string {
  return e instanceof Error ? e.message : 'Erro inesperado';
}

// Monta a query string ignorando valores vazios: queryString({ mes: '2026-11', busca: '' }) -> '?mes=2026-11'.
export function queryString(params: Record<string, string | number | null | undefined>): string {
  const partes = Object.entries(params)
    .filter(([, v]) => v !== '' && v !== null && v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return partes.length > 0 ? `?${partes.join('&')}` : '';
}
