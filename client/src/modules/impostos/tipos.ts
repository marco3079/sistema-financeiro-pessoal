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
}

export interface IrDTO {
  ano: number;
  proventos: { id: number; codigo: string; nome: string; total: number }[];
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
