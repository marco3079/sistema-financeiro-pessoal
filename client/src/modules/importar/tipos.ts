// Formatos trocados com a API de importação (server/src/modules/importacao/routes.ts).
import type {
  ContaDTO,
  TipoInvestimento,
  TipoMovimentoInvestimento,
  TipoTransacao,
  TransacaoDTO,
} from '../../lib/financas';

export type FormatoArquivo = 'csv' | 'ofx' | 'pdf';
export type TipoDocumento = 'FATURA' | 'EXTRATO';

// Um lançamento lido do arquivo. `valor` é sempre positivo.
export interface ItemLido {
  data: string; // 'AAAA-MM-DD'
  descricao: string;
  valor: number;
  tipo: TipoTransacao;
  transferencia: boolean; // pagamento de fatura ou movimento entre contas próprias
  parcela: number | null;
  totalParcelas: number | null;
}

// Resposta de POST /importacao/analisar.
export interface AnaliseArquivo {
  documento: TipoDocumento;
  banco: string | null;
  vencimento: string | null; // só em FATURA
  total: number; // FATURA: compras menos estornos; EXTRATO: entradas menos saídas
  avisos: string[];
  itens: (ItemLido & { jaImportado: boolean })[];
  contaSugeridaId: number | null;
  contas: ContaDTO[]; // FATURA: cartões manuais; EXTRATO: contas manuais que não são cartão
}

// Corpo de POST /importacao/confirmar.
export interface ConfirmarArquivo {
  arquivo: string; // nome do arquivo
  documento: TipoDocumento;
  banco: string | null;
  contaId: number | null; // conta existente...
  novaConta: { nome: string } | null; // ...ou uma nova (cartão, em FATURA; conta corrente, em EXTRATO)
  vencimento: string | null; // obrigatório em FATURA
  saldoFinal: number | null; // só em EXTRATO, opcional: saldo da conta depois do último lançamento
  itens: ItemLido[]; // só os marcados, sem o campo jaImportado
}

// Resposta de POST /importacao/confirmar.
export interface ResultadoArquivo {
  importacaoId: number;
  contaId: number;
  contaNome: string;
  faturaId: number | null;
  novos: number;
  repetidos: number;
}

// ---------- Planilha da B3 ----------

export type Celula = string | number | boolean | null;

export interface Planilha {
  nome: string;
  linhas: Celula[][];
}

export interface PosicaoB3 {
  chave: string;
  codigo: string | null;
  nome: string;
  tipo: TipoInvestimento;
  subtipo: string | null;
  instituicao: string | null;
  quantidade: number;
  valorAplicado: number | null;
  saldo: number | null;
  vencimento: string | null;
  ultimoMovimento: string | null;
  suspeita: boolean; // provavelmente não está mais na carteira: vem desmarcada
  investimentoId: number | null; // já existe no sistema (será atualizado)
  proventos: number; // soma dos proventos deste ativo no arquivo
}

export interface MovimentoB3 {
  chave: string;
  data: string;
  tipo: TipoMovimentoInvestimento;
  valor: number;
  quantidade: number | null;
  descricao: string;
}

// Resposta de POST /importacao/b3/analisar.
export interface AnaliseB3 {
  tipo: 'MOVIMENTACAO' | 'POSICAO' | 'DESCONHECIDA';
  periodo: { de: string; ate: string } | null;
  avisos: string[];
  posicoes: PosicaoB3[];
  movimentos: MovimentoB3[];
  encerradas: string[];
  totalProventos: number;
}

// Corpo de POST /importacao/b3/confirmar. Em `posicoes`, mande só os campos de PosicaoB3 até `vencimento`.
export interface ConfirmarB3 {
  arquivo: string;
  tipo: 'MOVIMENTACAO' | 'POSICAO';
  periodo: { de: string; ate: string } | null;
  posicoes: Pick<
    PosicaoB3,
    'chave' | 'codigo' | 'nome' | 'tipo' | 'subtipo' | 'instituicao' | 'quantidade' | 'valorAplicado' | 'saldo' | 'vencimento'
  >[];
  movimentos: MovimentoB3[]; // só os das posições marcadas
  encerradas: string[];
}

// Resposta de POST /importacao/b3/confirmar.
export interface ResultadoB3 {
  criados: number;
  atualizados: number;
  encerrados: number;
  movimentosNovos: number;
  movimentosRepetidos: number;
}

// ---------- Cotações e histórico ----------

// Resposta de GET /cotacoes/estado, PUT /cotacoes/token e DELETE /cotacoes/token.
export interface EstadoCotacoes {
  configurado: boolean;
  origemToken: 'BANCO' | 'ENV' | null;
  ativosComCodigo: number;
  ultimaAtualizacao: string | null; // ISO completo
}

// Resposta de POST /cotacoes/atualizar.
export interface ResultadoCotacoes {
  atualizados: number;
  semCotacao: string[];
  erro: string | null;
  estado: EstadoCotacoes;
}

// Item de GET /importacao/historico.
export interface ImportacaoDTO {
  id: number;
  criadoEm: string; // ISO completo
  arquivo: string;
  tipo: 'FATURA' | 'EXTRATO' | 'B3';
  banco: string | null;
  referencia: string | null; // FATURA: vencimento 'AAAA-MM-DD'; demais: período
  contaNome: string | null;
  contaId?: number | null;
  novos: number;
  repetidos: number;
  total: number | null;
}

// Um movimento da planilha da B3 trazido por uma importação (GET /importacao/:id).
export interface MovimentoImportadoDTO {
  id: number;
  data: string; // 'AAAA-MM-DD'
  tipo: 'APLICACAO' | 'RESGATE' | 'RENDIMENTO' | 'IMPOSTO';
  valor: number;
  quantidade: number | null;
  descricao: string | null;
  investimentoId: number;
  investimento: string; // código ou nome do ativo
}

// Resposta de GET /importacao/:id.
export interface DetalheImportacaoDTO {
  importacao: ImportacaoDTO;
  lancamentos: TransacaoDTO[]; // fatura e extrato
  movimentos: MovimentoImportadoDTO[]; // planilha da B3 (até 3000)
}

// Resposta de DELETE /importacao/:id.
export interface RemocaoDTO {
  lancamentos: number;
  movimentos: number;
  investimentos: number;
  faturas: number;
}
