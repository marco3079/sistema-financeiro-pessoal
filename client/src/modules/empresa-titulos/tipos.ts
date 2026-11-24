// Tipos das telas Contas a pagar e Contas a receber. Os formatos são os da API /titulos (lote 6, seção e2).
// Dinheiro é number (reais); datas "só dia" são 'AAAA-MM-DD'; mês é 'AAAA-MM'.

export type Natureza = 'PAGAR' | 'RECEBER';
export type SituacaoTitulo = 'ABERTO' | 'PARCIAL' | 'QUITADO' | 'VENCIDO' | 'CANCELADO';

export interface TituloDTO {
  id: number;
  natureza: Natureza;
  descricao: string;
  parceiroId: number | null;
  parceiroNome: string | null;
  categoriaId: number | null;
  categoriaNome: string | null;
  categoriaCor: string | null;
  centroDeCustoId: number | null;
  centroDeCustoNome: string | null;
  contaId: number | null;
  contaNome: string | null;
  valor: number;
  pago: number;
  saldo: number;
  emissao: string; // 'AAAA-MM-DD'
  vencimento: string; // 'AAAA-MM-DD'
  documento: string | null;
  parcela: number | null;
  totalParcelas: number | null;
  grupo: string | null;
  recorrente: boolean;
  observacao: string | null;
  situacao: SituacaoTitulo;
  diasDeAtraso: number; // 0 se não vencido
  anexos: number; // quantidade de anexos
}

export interface BaixaDTO {
  id: number;
  data: string;
  valor: number;
  juros: number;
  multa: number;
  desconto: number;
  total: number;
  contaId: number;
  contaNome: string | null;
  observacao: string | null;
}

export interface AnexoResumo {
  id: number;
  nome: string;
  tipo: string;
  tamanho: number; // bytes
}

export interface TituloDetalhe extends TituloDTO {
  baixas: BaixaDTO[];
  anexosLista: AnexoResumo[];
}

export interface ResumoTitulos {
  emAberto: number;
  vencido: number;
  aVencer7dias: number;
  quitadoNoPeriodo: number;
  quantidade: number;
}

export interface RespostaTitulos {
  itens: TituloDTO[];
  resumo: ResumoTitulos;
}

// Item de GET /parceiros (só os campos usados aqui).
export interface ParceiroLista {
  id: number;
  nome: string;
  tipo: 'CLIENTE' | 'FORNECEDOR' | 'AMBOS';
  ativo: boolean;
}

// Item de GET /centros-de-custo.
export interface CentroLista {
  id: number;
  nome: string;
  cor: string;
  ativo: boolean;
}

export const TIPOS_ANEXO: string[] = ['application/pdf', 'image/png', 'image/jpeg'];
export const LIMITE_ANEXO_BYTES = 2 * 1024 * 1024;
export const MAX_ANEXOS = 5;
export const LIMITE_LISTA = 1000;
