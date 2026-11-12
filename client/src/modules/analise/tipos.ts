import type { TipoInvestimento } from '../../lib/financas';

export interface MesAnalise { mes: string; receitas: number; despesas: number; saldo: number } // mes = 'AAAA-MM'

export interface CategoriaAnalise {
  id: number | null;         // null = "Sem categoria"
  nome: string;
  cor: string;
  total: number;             // no período
  parte: number;             // % do total do período
  mediaMensal: number;
  noMes: number;             // mês corrente
  naReferencia: number;      // último mês fechado
  mediaAnterior: number | null;
  variacao: number | null;   // % do último mês fechado contra a média dos anteriores
}

export type AreaSugestao = 'GASTOS' | 'RECEITAS' | 'INVESTIMENTOS';

export interface Sugestao {
  area: AreaSugestao;
  tom: 'alerta' | 'dica' | 'bom';
  titulo: string;
  texto: string;
  caminho: string | null;    // rota interna, ex.: '/app/orcamento'
  acao: string | null;       // texto do link
}

export interface AnaliseDTO {
  meses: MesAnalise[];       // em ordem crescente; o último é o mês corrente
  referencia: string | null; // 'AAAA-MM' do último mês fechado com dados
  resumo: {
    receitaMedia: number;
    despesaMedia: number;
    sobraMedia: number | null; // null quando não há receita registrada
    taxaDePoupanca: number | null; // %
    receitasNoMes: number;
    despesasNoMes: number;
    parceladoNoMes: number;
    aindaParcelado: number;
    recorrenteMensal: number;
    semCategoria: number;
  };
  despesasPorCategoria: CategoriaAnalise[];
  receitasPorCategoria: CategoriaAnalise[];
  maioresGastos: { descricao: string; total: number; vezes: number }[];
  recorrentes: { descricao: string; valorMensal: number; meses: number }[];
  investimentos: {
    saldo: number;
    emConta: number;
    patrimonio: number;
    classes: { tipo: TipoInvestimento; saldo: number; parte: number }[];
    proventosMensais: number;
    mesesDeReserva: number | null;
  };
  sugestoes: Sugestao[];
}
