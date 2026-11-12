import type { TipoInvestimento } from '../../lib/financas';

export type Indice = 'SELIC' | 'IPCA' | 'IBOV' | 'IFIX';

export interface LinhaRendimento {
  aportes: number;      // tudo o que foi aplicado
  retiradas: number;    // resgates e vendas
  proventos: number;    // dividendos, JCP e rendimentos recebidos em dinheiro
  saldo: number;        // valor hoje
  ganho: number;        // saldo + retiradas + proventos - aportes
  rentabilidade: number | null; // % sobre o total aplicado
  taxaAnual: number | null;     // % ao ano
  desde: string | null;         // 'AAAA-MM-DD' da primeira aplicação
}

export interface ComparacaoIndice {
  indice: Indice;
  rotulo: string;
  valorHoje: number | null;  // quanto os mesmos aportes e retiradas valeriam hoje no índice
  ganho: number | null;
  taxaAnual: number | null;  // % ao ano
  diferenca: number | null;  // carteira menos índice (positivo = a carteira rendeu mais)
}

interface ContraIndice {
  indice: Indice;
  rotuloIndice: string;
  valorNoIndice: number | null;
  taxaAnualDoIndice: number | null;
  diferenca: number | null;
}

export interface AtivoRendimento extends LinhaRendimento, ContraIndice {
  id: number;
  nome: string;
  codigo: string | null;
  tipo: TipoInvestimento;
}

export interface ClasseRendimento extends LinhaRendimento, ContraIndice {
  tipo: TipoInvestimento;
  ativos: number;
}

export interface ProjecaoClasse {
  tipo: TipoInvestimento;
  saldo: number;
  referencia: string;   // de onde vem a taxa, ex.: "Ibovespa dos últimos 12 meses"
  taxa: number | null;  // % esperado em 12 meses
  projetado: number;
}

export interface RelatorioRendimento {
  geradoEm: string;
  indices: { indice: Indice; rotulo: string; ultimaData: string | null; retorno12m: number | null; retornoNoAno: number | null }[];
  carteira: LinhaRendimento & { ativos: number; comparacao: ComparacaoIndice[] };
  classes: ClasseRendimento[];
  ativos: AtivoRendimento[];
  semHistorico: { id: number; nome: string; saldo: number }[];
  rendaFixa: {
    estimados: { id: number; nome: string; regra: string; saldo: number }[];
    semEstimativa: { id: number; nome: string; motivo: string }[];
  };
  projecao: { classes: ProjecaoClasse[]; saldo: number; projetado: number; ganho: number; taxa: number | null };
  avisos: string[];
}
