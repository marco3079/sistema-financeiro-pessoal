// Tipos da API de automações (ver docs/plano/lote5-automacoes.md, seção a1) e regras de formulário.
import { formatarReais, lerValor, valorParaCampo } from '../../lib/financas';
import type { TipoTransacao } from '../../lib/financas';

export type TipoAutomacao = 'PAR_CONTAS' | 'PAR_MESMA_CONTA' | 'FATURA' | 'INVESTIMENTO' | 'ESTORNO' | 'TEXTO' | 'COMBINADA';
export type AcaoAutomacao = 'TRANSFERENCIA' | 'CATEGORIA' | 'ESCONDER';

export interface ConfigAutomacao {
  contaIds?: number[];
  tipoLancamento?: TipoTransacao;
  textos?: string[];
  textosEntrada?: string[];
  textosSaida?: string[];
  valorMin?: number;
  valorMax?: number;
  diasMax?: number;
  tolerancia?: number;
}

export interface AutomacaoDTO {
  id: number;
  nome: string;
  tipo: TipoAutomacao;
  acao: AcaoAutomacao;
  categoriaId: number | null;
  categoriaNome: string | null;
  config: ConfigAutomacao;
  ativa: boolean;
  ordem: number;
  padrao: string | null;
  aplicados: number;
}

// Corpo de POST e PUT. `categoriaId` só vai quando a ação é CATEGORIA.
export interface DadosAutomacao {
  nome: string;
  tipo: TipoAutomacao;
  acao: AcaoAutomacao;
  categoriaId?: number;
  config: ConfigAutomacao;
  ativa: boolean;
}

export interface LancamentoProposto {
  id: number;
  data: string;
  descricao: string;
  valor: number;
  tipo: TipoTransacao;
  contaNome: string;
}

export interface PropostaDTO {
  automacaoId: number;
  automacaoNome: string;
  acao: string;
  lancamentos: LancamentoProposto[];
}

export interface PreviaDTO {
  propostas: PropostaDTO[];
  total: number; // quantos grupos no total
  lancamentos: number; // quantos lançamentos no total
}

export interface ResultadoAplicarDTO {
  aplicados: number;
  porAutomacao: { id: number; nome: string; lancamentos: number }[];
}

// Campos do formulário que cada tipo usa.
export interface CamposTipo {
  diasMax: boolean;
  tolerancia: boolean;
  entradaSaida: boolean;
  valor: boolean;
  tipoLancamento: boolean;
  textos: boolean;
  textosObrigatorio: boolean;
  contas: 'comuns' | 'todas' | null; // 'comuns' = sem cartões
}

export interface InfoTipo {
  rotulo: string;
  explicacao: string;
  resumo: string;
  campos: CamposTipo;
}

export const INFO_TIPO: Record<TipoAutomacao, InfoTipo> = {
  PAR_CONTAS: {
    rotulo: 'Transferência entre minhas contas',
    explicacao: 'Uma saída numa conta sua e uma entrada de mesmo valor em outra conta sua.',
    resumo: 'Saída e entrada de mesmo valor entre contas',
    campos: { diasMax: true, tolerancia: true, entradaSaida: true, valor: true, tipoLancamento: false, textos: false, textosObrigatorio: false, contas: 'comuns' },
  },
  PAR_MESMA_CONTA: {
    rotulo: 'Entrada e saída na mesma conta',
    explicacao: 'Uma entrada e uma saída de mesmo valor na mesma conta, uma depois da outra. Bom para Pix pago no crédito.',
    resumo: 'Entrada e saída de mesmo valor na mesma conta',
    campos: { diasMax: true, tolerancia: true, entradaSaida: true, valor: true, tipoLancamento: false, textos: false, textosObrigatorio: false, contas: 'comuns' },
  },
  FATURA: {
    rotulo: 'Pagamento de fatura',
    explicacao: 'Saída que paga a fatura do cartão: pela descrição ou pelo valor da fatura.',
    resumo: 'Pagamento de fatura de cartão',
    campos: { diasMax: true, tolerancia: true, entradaSaida: false, valor: false, tipoLancamento: false, textos: true, textosObrigatorio: false, contas: null },
  },
  INVESTIMENTO: {
    rotulo: 'Aplicação e resgate de investimento',
    explicacao: 'Saída igual a uma aplicação ou entrada igual a um resgate de investimento.',
    resumo: 'Aplicação ou resgate de investimento',
    campos: { diasMax: true, tolerancia: true, entradaSaida: false, valor: false, tipoLancamento: false, textos: true, textosObrigatorio: false, contas: null },
  },
  ESTORNO: {
    rotulo: 'Compra e estorno',
    explicacao: 'Uma compra e o estorno dela, de mesmo valor, na mesma conta, com descrição parecida.',
    resumo: 'Compra e estorno de mesmo valor',
    campos: { diasMax: true, tolerancia: true, entradaSaida: false, valor: true, tipoLancamento: false, textos: false, textosObrigatorio: false, contas: 'todas' },
  },
  TEXTO: {
    rotulo: 'Descrição contém',
    explicacao: 'Lançamentos cuja descrição contém um dos trechos escritos.',
    resumo: 'Descrição com um dos trechos',
    campos: { diasMax: false, tolerancia: false, entradaSaida: false, valor: false, tipoLancamento: true, textos: true, textosObrigatorio: true, contas: 'todas' },
  },
  COMBINADA: {
    rotulo: 'Combinada',
    explicacao: 'Junta condições: todas as que você escolher precisam valer ao mesmo tempo.',
    resumo: 'Lançamento que cumpre todas as condições',
    campos: { diasMax: false, tolerancia: false, entradaSaida: false, valor: true, tipoLancamento: true, textos: true, textosObrigatorio: false, contas: 'todas' },
  },
};

export const TIPOS_AUTOMACAO: TipoAutomacao[] = [
  'PAR_CONTAS',
  'PAR_MESMA_CONTA',
  'FATURA',
  'INVESTIMENTO',
  'ESTORNO',
  'TEXTO',
  'COMBINADA',
];

export const ROTULO_ACAO: Record<AcaoAutomacao, string> = {
  TRANSFERENCIA: 'Marcar como transferência',
  CATEGORIA: 'Definir categoria',
  ESCONDER: 'Tirar da lista de lançamentos',
};

export const ACOES_AUTOMACAO: AcaoAutomacao[] = ['TRANSFERENCIA', 'CATEGORIA', 'ESCONDER'];

// Nos pares entre contas e no estorno, o servidor não aceita a ação de categoria.
const TIPOS_SEM_CATEGORIA: TipoAutomacao[] = ['PAR_CONTAS', 'PAR_MESMA_CONTA', 'ESTORNO'];

export function acoesDoTipo(tipo: TipoAutomacao): AcaoAutomacao[] {
  return TIPOS_SEM_CATEGORIA.includes(tipo) ? ACOES_AUTOMACAO.filter((a) => a !== 'CATEGORIA') : ACOES_AUTOMACAO;
}

// Dias usados quando o campo "Em até quantos dias" fica em branco.
export const DIAS_PADRAO: Partial<Record<TipoAutomacao, number>> = {
  PAR_CONTAS: 1,
  PAR_MESMA_CONTA: 2,
  FATURA: 5,
  INVESTIMENTO: 3,
  ESTORNO: 30,
};

export function plural(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`;
}

export function rotuloAcao(a: AutomacaoDTO): string {
  if (a.acao === 'CATEGORIA') return `Definir categoria: ${a.categoriaNome ?? 'categoria não encontrada'}`;
  return ROTULO_ACAO[a.acao];
}

// Texto digitado com trechos separados por vírgula -> lista sem vazios.
export function textosDoCampo(texto: string): string[] {
  return texto
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

export function textosParaCampo(lista: string[] | undefined): string {
  return lista ? lista.join(', ') : '';
}

// Resumo de uma frase das condições, para a lista.
export function resumoCondicoes(a: AutomacaoDTO): string {
  const c = a.config;
  const partes: string[] = [INFO_TIPO[a.tipo].resumo];
  if (c.contaIds && c.contaIds.length > 0) partes.push('só nas contas escolhidas');
  if (c.tipoLancamento) partes.push(c.tipoLancamento === 'RECEITA' ? 'só entradas' : 'só saídas');
  if (c.diasMax !== undefined) partes.push(`em até ${plural(c.diasMax, 'dia', 'dias')}`);
  if (c.tolerancia !== undefined && c.tolerancia > 0) partes.push(`diferença de até ${formatarReais(c.tolerancia)}`);
  if (c.valorMin !== undefined && c.valorMax !== undefined) {
    partes.push(`valor de ${formatarReais(c.valorMin)} a ${formatarReais(c.valorMax)}`);
  } else if (c.valorMin !== undefined) {
    partes.push(`valor de pelo menos ${formatarReais(c.valorMin)}`);
  } else if (c.valorMax !== undefined) {
    partes.push(`valor de até ${formatarReais(c.valorMax)}`);
  }
  if (c.textos && c.textos.length > 0) partes.push(`descrição contém: ${c.textos.join(', ')}`);
  if (c.textosEntrada && c.textosEntrada.length > 0) partes.push(`entrada contém: ${c.textosEntrada.join(', ')}`);
  if (c.textosSaida && c.textosSaida.length > 0) partes.push(`saída contém: ${c.textosSaida.join(', ')}`);
  return partes.join(' · ');
}

// Valores do formulário, todos como texto (como o usuário digitou).
export interface Rascunho {
  nome: string;
  tipo: TipoAutomacao;
  acao: AcaoAutomacao;
  categoriaId: string;
  ativa: boolean;
  diasMax: string;
  tolerancia: string;
  textos: string;
  textosEntrada: string;
  textosSaida: string;
  valorMin: string;
  valorMax: string;
  tipoLancamento: '' | TipoTransacao;
  contaIds: number[];
}

export function rascunhoDe(a: AutomacaoDTO | null): Rascunho {
  const c: ConfigAutomacao = a?.config ?? {};
  return {
    nome: a?.nome ?? '',
    tipo: a?.tipo ?? 'PAR_CONTAS',
    acao: a?.acao ?? 'TRANSFERENCIA',
    categoriaId: a && a.categoriaId !== null ? String(a.categoriaId) : '',
    ativa: a?.ativa ?? true,
    diasMax: c.diasMax !== undefined ? String(c.diasMax) : '',
    tolerancia: c.tolerancia !== undefined ? valorParaCampo(c.tolerancia) : '',
    textos: textosParaCampo(c.textos),
    textosEntrada: textosParaCampo(c.textosEntrada),
    textosSaida: textosParaCampo(c.textosSaida),
    valorMin: c.valorMin !== undefined ? valorParaCampo(c.valorMin) : '',
    valorMax: c.valorMax !== undefined ? valorParaCampo(c.valorMax) : '',
    tipoLancamento: c.tipoLancamento ?? '',
    contaIds: c.contaIds ? [...c.contaIds] : [],
  };
}

// Trechos: 2 a 60 caracteres cada um, no máximo 20.
function validarTextos(lista: string[], rotulo: string): string | null {
  if (lista.length > 20) return `${rotulo}: use no máximo 20 trechos.`;
  if (lista.some((t) => t.length < 2 || t.length > 60)) return `${rotulo}: cada trecho precisa ter de 2 a 60 letras.`;
  return null;
}

// Monta o config só com os campos que o tipo escolhido usa e que foram preenchidos.
export function montarConfig(r: Rascunho): { config: ConfigAutomacao } | { erro: string } {
  const campos = INFO_TIPO[r.tipo].campos;
  const c: ConfigAutomacao = {};

  if (campos.contas !== null && r.contaIds.length > 0) c.contaIds = [...r.contaIds];
  if (campos.tipoLancamento && r.tipoLancamento !== '') c.tipoLancamento = r.tipoLancamento;

  if (campos.diasMax && r.diasMax.trim() !== '') {
    const dias = Number(r.diasMax);
    if (!Number.isInteger(dias) || dias < 0 || dias > 60) {
      return { erro: 'Em até quantos dias: use um número inteiro de 0 a 60.' };
    }
    c.diasMax = dias;
  }

  if (campos.tolerancia && r.tolerancia.trim() !== '') {
    const tolerancia = lerValor(r.tolerancia);
    if (tolerancia === null || tolerancia < 0 || tolerancia > 5) {
      return { erro: 'Diferença de valor aceita: use um valor de 0 a 5 reais.' };
    }
    c.tolerancia = tolerancia;
  }

  if (campos.valor) {
    const min = r.valorMin.trim() === '' ? null : lerValor(r.valorMin);
    const max = r.valorMax.trim() === '' ? null : lerValor(r.valorMax);
    if (r.valorMin.trim() !== '' && (min === null || min < 0)) {
      return { erro: 'Valor mínimo: use um valor igual ou maior que zero.' };
    }
    if (r.valorMax.trim() !== '' && (max === null || max < 0)) {
      return { erro: 'Valor máximo: use um valor igual ou maior que zero.' };
    }
    if (min !== null && max !== null && max < min) {
      return { erro: 'O valor máximo precisa ser igual ou maior que o mínimo.' };
    }
    if (min !== null) c.valorMin = min;
    if (max !== null) c.valorMax = max;
  }

  if (campos.entradaSaida) {
    const entrada = textosDoCampo(r.textosEntrada);
    const saida = textosDoCampo(r.textosSaida);
    const erroEntrada = validarTextos(entrada, 'Entrada contém');
    if (erroEntrada) return { erro: erroEntrada };
    const erroSaida = validarTextos(saida, 'Saída contém');
    if (erroSaida) return { erro: erroSaida };
    if (entrada.length > 0) c.textosEntrada = entrada;
    if (saida.length > 0) c.textosSaida = saida;
  }

  if (campos.textos) {
    const textos = textosDoCampo(r.textos);
    if (campos.textosObrigatorio && textos.length === 0) {
      return { erro: 'Escreva pelo menos um trecho em "Descrição contém".' };
    }
    const erroTextos = validarTextos(textos, 'Descrição contém');
    if (erroTextos) return { erro: erroTextos };
    if (textos.length > 0) c.textos = textos;
  }

  if (r.tipo === 'COMBINADA' && Object.keys(c).length === 0) {
    return { erro: 'Escolha pelo menos uma condição.' };
  }

  return { config: c };
}

export function montarDados(r: Rascunho, config: ConfigAutomacao): DadosAutomacao {
  const dados: DadosAutomacao = {
    nome: r.nome.trim(),
    tipo: r.tipo,
    acao: r.acao,
    config,
    ativa: r.ativa,
  };
  if (r.acao === 'CATEGORIA') dados.categoriaId = Number(r.categoriaId);
  return dados;
}
