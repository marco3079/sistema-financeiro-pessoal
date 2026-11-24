// Estado da tela do simulador: o que a pessoa digitou (texto), valores padrão, memória no navegador
// e a conversão para os parâmetros do cálculo.
import { lerValor } from '../../lib/financas';
import { taxaPorPeriodo, vezesPorAno } from './calculo';
import type { Fluxo, Frequencia, Momento, Parametros, TipoImposto } from './calculo';

export type Modo = 'basico' | 'avancado';
export type TipoAumento = 'nenhum' | 'inflacao' | 'fixo';
export type TipoInvestimento = 'fixa' | 'variavel';
export type Ativo = 'acoes' | 'fiis' | 'etfs';

export interface FluxoForm {
  id: string;
  tipo: 'deposito' | 'retirada';
  frequencia: Frequencia;
  momento: Momento;
  valor: string;
  aumento: TipoAumento;
  aumentoPct: string;
  inicioMes: string; // vazio = desde o começo
  fimMes: string; // vazio = até o fim
}

export interface Formulario {
  modo: Modo;
  tipoInvestimento: TipoInvestimento;
  valorInicial: string;
  taxa: string;
  taxaPeriodo: 'mensal' | 'anual';
  duracao: string;
  duracaoUnidade: 'anos' | 'meses';
  // Modo avançado
  diasNoAno: '360' | '365';
  capitalizacao: Frequencia;
  tipoTaxa: 'nominal' | 'efetiva';
  fluxos: FluxoForm[];
  // Modo básico
  depositoMensal: string;
  momentoBasico: Momento;
  aumentoBasico: TipoAumento;
  aumentoBasicoPct: string;
  // Renda variável
  ativo: Ativo;
  valorizacao: string; // % ao ano
  dividendos: string; // % ao ano
  freqDividendos: Frequencia;
  reinvestir: boolean;
  volatilidade: string; // % ao ano
  custoCompra: string; // % de cada compra
  rvImposto: boolean;
  // Inflação, imposto e taxas (os dois modos)
  inflacao: string;
  imposto: TipoImposto;
  taxaAdm: string;
  // Meta
  metaValor: string;
  metaReal: boolean;
}

export const DURACAO_MAXIMA_ANOS = 100;
export const INFLACAO_RESERVA = 4.5; // % ao ano, quando o sistema ainda não tem o IPCA

export function novoId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function novoFluxo(tipo: 'deposito' | 'retirada', valor = ''): FluxoForm {
  return {
    id: novoId(),
    tipo,
    frequencia: 'mensal',
    momento: tipo === 'deposito' ? 'inicio' : 'fim',
    valor,
    aumento: 'nenhum',
    aumentoPct: '',
    inicioMes: '',
    fimMes: '',
  };
}

// Valores padrão de cada tipo de ativo (a pessoa pode trocar). Valorização sem os proventos.
export const PADRAO_ATIVO: Record<
  Ativo,
  Pick<Formulario, 'valorizacao' | 'dividendos' | 'freqDividendos' | 'volatilidade' | 'custoCompra'>
> = {
  acoes: { valorizacao: '6', dividendos: '5', freqDividendos: 'trimestral', volatilidade: '25', custoCompra: '0,03' },
  fiis: { valorizacao: '1', dividendos: '10', freqDividendos: 'mensal', volatilidade: '12', custoCompra: '0,03' },
  etfs: { valorizacao: '10', dividendos: '0', freqDividendos: 'trimestral', volatilidade: '22', custoCompra: '0,03' },
};

export const ROTULO_ATIVO: Record<Ativo, string> = {
  acoes: 'Ações',
  fiis: 'Fundos imobiliários (FIIs)',
  etfs: 'ETFs',
};

// Vendas de ações de até R$ 20 mil no mês não pagam IR sobre o ganho.
export const ISENCAO_ACOES_MES = 20000;

export const FORMULARIO_PADRAO: Formulario = {
  modo: 'basico',
  tipoInvestimento: 'fixa',
  valorInicial: '',
  taxa: '1',
  taxaPeriodo: 'mensal',
  duracao: '10',
  duracaoUnidade: 'anos',
  diasNoAno: '365',
  capitalizacao: 'mensal',
  tipoTaxa: 'nominal',
  fluxos: [novoFluxo('deposito')],
  depositoMensal: '',
  momentoBasico: 'inicio',
  aumentoBasico: 'nenhum',
  aumentoBasicoPct: '',
  ativo: 'acoes',
  ...PADRAO_ATIVO.acoes,
  reinvestir: true,
  rvImposto: true,
  inflacao: '',
  imposto: 'nenhum',
  taxaAdm: '',
  metaValor: '',
  metaReal: false,
};

// ---------- Memória no navegador ----------

const CHAVE = 'simulador:v2';

export function lerSalvo(): Formulario | null {
  try {
    const texto = localStorage.getItem(CHAVE);
    if (!texto) return null;
    const salvo = JSON.parse(texto) as Partial<Formulario>;
    if (!salvo || typeof salvo !== 'object') return null;
    const fluxos = Array.isArray(salvo.fluxos)
      ? salvo.fluxos.map((f) => ({ ...novoFluxo(f?.tipo === 'retirada' ? 'retirada' : 'deposito'), ...f }))
      : FORMULARIO_PADRAO.fluxos;
    return { ...FORMULARIO_PADRAO, ...salvo, fluxos };
  } catch {
    return null;
  }
}

export function salvar(form: Formulario): void {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(form));
  } catch {
    // Navegador sem armazenamento (janela anônima, bloqueio): a tela funciona igual, só não lembra.
  }
}

export function esquecer(): void {
  try {
    localStorage.removeItem(CHAVE);
  } catch {
    // idem
  }
}

// ---------- Conversão ----------

export interface Entrada {
  params: Parametros;
  diasNoAno: number;
  momentoMeta: Momento;
  variavel: boolean;
  volatilidade: number; // renda variável: oscilação ao ano (fração); renda fixa: 0
}

function percentual(texto: string): number | null {
  const n = lerValor(texto.replace('%', ''));
  return n === null ? null : n / 100;
}

function mesOpcional(texto: string): number | null | 'erro' {
  const t = texto.trim();
  if (t === '') return null;
  if (!/^\d+$/.test(t)) return 'erro';
  return Number(t);
}

function aumentoDe(tipo: TipoAumento, pct: string): { valor: number | 'inflacao' } | { erro: string } {
  if (tipo === 'nenhum') return { valor: 0 };
  if (tipo === 'inflacao') return { valor: 'inflacao' };
  const n = percentual(pct);
  if (n === null || n <= -1) return { erro: 'Confira o aumento anual (%).' };
  return { valor: n };
}

// Devolve os parâmetros do cálculo ou o texto do primeiro problema encontrado.
// `semDepositoBasico`: ignora o depósito do modo básico (a meta calcula justamente esse valor).
export function lerEntrada(f: Formulario, semDepositoBasico = false): Entrada | string {
  const valorInicial = f.valorInicial.trim() === '' ? 0 : lerValor(f.valorInicial);
  if (valorInicial === null || valorInicial < 0) return 'Confira o valor inicial (zero ou mais).';

  const taxa = f.tipoInvestimento === 'variavel' ? 0 : percentual(f.taxa);
  if (taxa === null || taxa <= -1) return 'Confira a taxa de juros.';

  const duracaoTexto = f.duracao.trim();
  const duracao = /^\d+$/.test(duracaoTexto) ? Number(duracaoTexto) : NaN;
  const meses = f.duracaoUnidade === 'anos' ? duracao * 12 : duracao;
  if (!(meses >= 1 && meses <= DURACAO_MAXIMA_ANOS * 12)) {
    return f.duracaoUnidade === 'anos'
      ? `Informe uma duração de 1 a ${DURACAO_MAXIMA_ANOS} anos.`
      : `Informe uma duração de 1 a ${DURACAO_MAXIMA_ANOS * 12} meses.`;
  }

  let inflacaoAnual: number | null = null;
  if (f.inflacao.trim() !== '') {
    inflacaoAnual = percentual(f.inflacao);
    if (inflacaoAnual === null || inflacaoAnual <= -1) return 'Confira a previsão de inflação.';
  }

  let taxaAdmAnual = 0;
  if (f.taxaAdm.trim() !== '') {
    const t = percentual(f.taxaAdm);
    if (t === null || t < 0 || t >= 1) return 'Confira a taxa de administração (de 0% a 99%).';
    taxaAdmAnual = t;
  }

  const avancado = f.modo === 'avancado';
  const variavel = f.tipoInvestimento === 'variavel';

  // Renda variável: valorização ao ano (efetiva) vira uma taxa mensal; dividendos, custo de compra e o IR do tipo.
  let rv: Pick<Parametros, 'dividendos' | 'custoCompra' | 'isencaoVendasMes' | 'imposto'> | null = null;
  let valorizacao = 0;
  let volatilidade = 0;
  if (variavel) {
    const v = percentual(f.valorizacao);
    if (v === null || v <= -1) return 'Confira a valorização esperada.';
    valorizacao = v;
    const dy = f.dividendos.trim() === '' ? 0 : percentual(f.dividendos);
    if (dy === null || dy < 0 || dy >= 1) return 'Confira os dividendos (de 0% a 99% ao ano).';
    const vol = f.volatilidade.trim() === '' ? 0 : percentual(f.volatilidade);
    if (vol === null || vol < 0 || vol > 2) return 'Confira a oscilação (de 0% a 200% ao ano).';
    volatilidade = vol;
    const custo = f.custoCompra.trim() === '' ? 0 : percentual(f.custoCompra);
    if (custo === null || custo < 0 || custo >= 0.5) return 'Confira o custo de cada compra (de 0% a 50%).';
    rv = {
      dividendos: dy > 0 ? { taxaAnual: dy, porAno: vezesPorAno(f.freqDividendos, 365), reinvestir: f.reinvestir } : null,
      custoCompra: custo,
      imposto: f.rvImposto ? (f.ativo === 'fiis' ? 'fixo20' : 'fixo15') : 'nenhum',
      isencaoVendasMes: f.rvImposto && f.ativo === 'acoes' ? ISENCAO_ACOES_MES : 0,
    };
  }

  const diasNoAno = variavel ? 365 : avancado ? Number(f.diasNoAno) : 360;
  const capitalizacao: Frequencia = !variavel && avancado ? f.capitalizacao : 'mensal';
  const capitalizacoesPorAno = vezesPorAno(capitalizacao, diasNoAno);
  const taxaPeriodo = variavel
    ? taxaPorPeriodo(valorizacao, 'anual', 12, 'efetiva')
    : taxaPorPeriodo(taxa, f.taxaPeriodo, capitalizacoesPorAno, avancado ? f.tipoTaxa : 'nominal');

  const fluxos: Fluxo[] = [];
  if (avancado) {
    const contagem = { deposito: 0, retirada: 0 };
    for (const ff of f.fluxos) {
      contagem[ff.tipo]++;
      const nome = `${ff.tipo === 'deposito' ? 'Depósito' : 'Retirada'} ${contagem[ff.tipo]}`;
      if (ff.valor.trim() === '') continue;
      const valor = lerValor(ff.valor);
      if (valor === null || valor < 0) return `${nome}: confira o valor.`;
      const aumento = aumentoDe(ff.aumento, ff.aumentoPct);
      if ('erro' in aumento) return `${nome}: ${aumento.erro.toLowerCase()}`;
      const inicioMes = mesOpcional(ff.inicioMes);
      const fimMes = mesOpcional(ff.fimMes);
      if (inicioMes === 'erro') return `${nome}: o começo é um número de meses (0 ou mais).`;
      if (fimMes === 'erro') return `${nome}: o fim é um número de meses.`;
      if (fimMes !== null && fimMes <= (inicioMes ?? 0)) return `${nome}: o fim precisa ser depois do começo.`;
      fluxos.push({
        tipo: ff.tipo,
        valor,
        frequencia: ff.frequencia,
        momento: ff.momento,
        aumentoAnual: aumento.valor,
        inicioMes: inicioMes ?? 0,
        fimMes,
      });
    }
  } else if (!semDepositoBasico && f.depositoMensal.trim() !== '') {
    const valor = lerValor(f.depositoMensal);
    if (valor === null || valor < 0) return 'Confira o depósito mensal.';
    const aumento = aumentoDe(f.aumentoBasico, f.aumentoBasicoPct);
    if ('erro' in aumento) return aumento.erro;
    fluxos.push({
      tipo: 'deposito',
      valor,
      frequencia: 'mensal',
      momento: f.momentoBasico,
      aumentoAnual: aumento.valor,
      inicioMes: 0,
      fimMes: null,
    });
  }

  return {
    params: {
      valorInicial,
      taxaPeriodo,
      capitalizacoesPorAno,
      meses,
      fluxos,
      inflacaoAnual,
      taxaAdmAnual,
      imposto: f.imposto,
      ...rv,
    },
    diasNoAno,
    momentoMeta: avancado ? 'inicio' : f.momentoBasico,
    variavel,
    volatilidade,
  };
}

// Número para preencher um campo de percentual ("4,68").
export function percentualParaCampo(fracao: number, casas = 2): string {
  return (fracao * 100).toLocaleString('pt-BR', { maximumFractionDigits: casas, useGrouping: false });
}
