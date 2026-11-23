// Formatos de resposta de /api/impostos e /api/ir usados pela área Impostos.

export interface Componentes {
  icms: number;
  pisCofins: number;
  ipi: number;
  iss: number;
  outros: number;
}

export interface TipoGastoDTO {
  id: string;
  rotulo: string;
  exemplo: string;
  componentes: Componentes;
  total: number;
}

export interface TiposDTO {
  tipos: TipoGastoDTO[];
  diretos: { id: string; rotulo: string }[];
}

export interface LinhaCategoriaDTO {
  categoriaId: number;
  nome: string;
  cor: string;
  tipo: string;
  tipoEscolhido: boolean;
  aliquota: number;
  aliquotaPropria: number | null;
  aliquotaDoTipo: number;
  gasto: number;
  lancamentos: number;
  imposto: number;
  componentes: Componentes;
}

export interface LancamentoDiretoDTO {
  id: string;
  data: string;
  descricao: string;
  valor: number;
  tipo: string;
  categoria: string | null;
}

export interface EventoCalendarioDTO {
  data: string;
  titulo: string;
  detalhe: string;
  valor: number | null;
  tipo: string;
  estimado: boolean;
}

export interface ResumoDTO {
  ano: number;
  anos: number[];
  periodo: { de: string; ate: string; dias: number; completo: boolean };
  totais: {
    gasto: number;
    renda: number;
    proventos: number;
    indireto: number;
    direto: number;
    imposto: number;
    percentualGasto: number;
    percentualRenda: number | null;
    semCategoria: number;
    componentes: Componentes;
  };
  meses: { mes: string; gasto: number; indireto: number; direto: number; renda: number }[];
  categorias: LinhaCategoriaDTO[];
  diretos: { porTipo: { tipo: string; rotulo: string; total: number; quantidade: number }[]; lancamentos: LancamentoDiretoDTO[] };
  reforma: {
    consumoHoje: number;
    outrosHoje: number;
    porAno: { ano: number; antigos: number; novos: number; total: number }[];
    porCategoria: { categoriaId: number; nome: string; cor: string; gasto: number; hoje: number; depois: number; diferenca: number }[];
  };
  dias: { dias: number | null; diasNoAno: number; libertacao: string | null; fracao: number | null };
  calendario: EventoCalendarioDTO[];
  impostometro: { total: number; projecao: number; porDia: number; completo: boolean };
  meta: { valor: null } | { valor: number; acumulado: number; esperadoHoje: number; projecao: number; percentual: number | null; noRitmo: boolean };
  mesMaisPesado: {
    mes: string;
    imposto: number;
    media: number;
    direto: number;
    motivos: { nome: string; cor: string; imposto: number; acimaDaMedia: number }[];
  } | null;
  esferas: { uniao: number; estado: number; municipio: number; outras: number };
  combustivel: { gasto: number; imposto: number; lancamentos: number; aliquota: number };
}

export interface IrDTO {
  ano: number;
  proventos: { id: number; codigo: string; nome: string; total: number }[];
  posicoes: IrPosicaoDTO[];
  totais: { vendas: number; resultado: number; proventos: number };
  imposto: {
    meses: { mes: string; classe: string; resultado: number; prejuizoCompensado: number; base: number; aliquota: number; imposto: number }[];
    totalNoAno: number;
    prejuizoAcumulado: Record<string, number>;
  };
  incompletos: { codigo: string; motivo: string }[];
}

export const COMPONENTES: { chave: keyof Componentes; rotulo: string; cor: string; descricao: string }[] = [
  { chave: 'icms', rotulo: 'ICMS', cor: '#3b82f6', descricao: 'Estadual, sobre mercadorias, energia, combustível e telecom.' },
  { chave: 'pisCofins', rotulo: 'PIS/Cofins', cor: '#8b5cf6', descricao: 'Federais, sobre o faturamento das empresas.' },
  { chave: 'ipi', rotulo: 'IPI', cor: '#f59e0b', descricao: 'Federal, sobre produtos industrializados.' },
  { chave: 'iss', rotulo: 'ISS', cor: '#06b6d4', descricao: 'Municipal, sobre serviços.' },
  { chave: 'outros', rotulo: 'Outros embutidos', cor: '#94a3b8', descricao: 'IRPJ, CSLL, encargos sobre salários, CIDE e IOF que as empresas repassam no preço.' },
];

export const COR_DIRETO = '#ef4444';
export const COR_INDIRETO = 'var(--cor-primaria)';

export const CORES_DIRETO: Record<string, string> = {
  IOF: '#ef4444',
  IPVA: '#f97316',
  IPTU: '#eab308',
  IR: '#22c55e',
  INSS: '#14b8a6',
  INVESTIMENTOS: '#6366f1',
  OUTROS: '#94a3b8',
};

export interface IrpfDTO {
  ano: number;
  completo: boolean;
  periodo: { de: string; ate: string };
  fonte: string;
  parametros: {
    porDependente: number;
    limiteEducacao: number;
    tetoSimplificado: number;
    descontoSimplificado: number;
    limitePrevidencia: number;
    faixas: { ate: number | null; aliquota: number; deducao: number }[];
    reducao: { isentoAte: number; ate: number } | null;
  };
  config: { rendaBruta: number | null; irRetido: number | null; inss: number | null; dependentes: number };
  entradas: { receitasLancadas: number; rendaBruta: number; rendaEstimada: boolean; proventosIsentos: number; irRetido: number };
  dedutiveis: {
    saude: number;
    educacao: number;
    educacaoLimite: number;
    previdencia: number;
    previdenciaLimite: number;
    porCategoria: { categoriaId: number; nome: string; cor: string; dedutivel: string; escolhido: boolean; total: number }[];
    lancamentos: { id: number; data: string; descricao: string; valor: number; tipo: string; categoria: string | null }[];
    tipos: { id: string; rotulo: string }[];
  };
  deducoes: { inss: number; dependentes: number; saude: number; educacao: number; previdencia: number };
  modelos: {
    completo: { base: number; deducoes: number; imposto: number; aliquotaMarginal: number; reducao: number };
    simplificado: { base: number; desconto: number; imposto: number; aliquotaMarginal: number; reducao: number };
    melhor: 'COMPLETO' | 'SIMPLIFICADO';
  };
  devido: number;
  resultado: number;
  aliquotaEfetiva: number;
  pgbl: { espaco: number; economia: number };
}

export interface EstabelecimentosDTO {
  ano: number;
  totalGasto: number;
  totalImposto: number;
  quantidade: number;
  estabelecimentos: {
    nome: string;
    gasto: number;
    imposto: number;
    aliquota: number;
    lancamentos: number;
    ultima: string;
    categoria: { nome: string; cor: string } | null;
  }[];
}

export const CORES_DEDUTIVEL: Record<string, string> = {
  SAUDE: '#22c55e',
  EDUCACAO: '#3b82f6',
  PREVIDENCIA: '#8b5cf6',
  NAO: '#94a3b8',
};

export interface IofTarifasDTO {
  ano: number;
  totais: { iof: number; tarifas: number; total: number };
  tipos: { tipo: string; rotulo: string; total: number; quantidade: number }[];
  meses: { mes: string; iof: number; tarifas: number }[];
  lancamentos: { id: number; data: string; descricao: string; valor: number; tipo: string; categoria: string | null }[];
}

export interface RendaFixaDTO {
  ativos: {
    id: number;
    nome: string;
    tipo: string;
    subtipo: string | null;
    aplicado: number;
    saldo: number;
    rendimento: number;
    dias: number;
    isento: boolean;
    aliquota: number | null;
    irEstimado: number | null;
    comeCotas: { data: string; aliquota: number } | null;
    vencimento: string | null;
  }[];
  totais: { saldo: number; rendimento: number; irEstimado: number };
  proximoComeCotas: string;
}

export interface InvestimentosListaDTO {
  itens: { id: number; nome: string; codigo: string | null; tipo: string; saldo: number; quantidade: number | null }[];
}

export interface IrPosicaoDTO {
  id: number;
  codigo: string;
  nome: string;
  tipo: string;
  quantidade: number;
  custoTotal: number;
  custoMedio: number;
}

export const CORES_IOF: Record<string, string> = {
  INTERNACIONAL: '#f97316',
  CAMBIO: '#eab308',
  CREDITO: '#8b5cf6',
  ROTATIVO: '#ef4444',
  INVESTIMENTO: '#06b6d4',
  TARIFA: '#64748b',
};
