// Motor do simulador de investimentos. Só contas, sem React: dá para testar sozinho.
//
// O tempo corre em anos (t = 0 no começo, t = T no fim). Os juros rendem "pro rata" dentro de cada período
// de capitalização (juros simples sobre o saldo de cada trecho) e só entram no saldo no fim do período:
// os juros são pagos no mesmo cronograma da capitalização. Se o prazo terminar no meio de um período,
// os juros proporcionais entram no fim (como num resgate).
//
// Ordem no mesmo instante: juros do período que terminou, taxa de administração, depósitos, retiradas.

export type Frequencia =
  | 'diaria'
  | 'semanal'
  | 'quinzenal'
  | 'mensal'
  | 'bimestral'
  | 'trimestral'
  | 'semestral'
  | 'anual';

export type Momento = 'inicio' | 'fim';
export type TipoImposto = 'nenhum' | 'regressiva' | 'fixo15';

export interface Fluxo {
  tipo: 'deposito' | 'retirada';
  valor: number; // em reais, positivo
  frequencia: Frequencia;
  momento: Momento;
  // Aumento a cada 12 meses desde o começo do fluxo: fração (0,05 = 5%) ou "inflacao" (usa a inflação informada).
  aumentoAnual: number | 'inflacao';
  inicioMes: number; // começa depois de N meses (0 = desde o começo)
  fimMes: number | null; // para depois de N meses desde o começo da simulação (null = até o fim)
}

export interface Parametros {
  valorInicial: number;
  taxaPeriodo: number; // juros por período de capitalização (fração)
  capitalizacoesPorAno: number;
  meses: number; // prazo total em meses
  fluxos: Fluxo[];
  inflacaoAnual: number | null; // fração; null = sem inflação
  taxaAdmAnual: number; // fração do saldo por ano (administração/custódia)
  imposto: TipoImposto;
  detalhar?: boolean; // false: não monta a lista mês a mês (usado nas buscas de meta)
}

export interface PontoMes {
  mes: number; // 1..meses
  t: number; // em anos
  saldo: number;
  saldoReal: number | null; // em valor de hoje
  depositos: number; // no mês
  retiradas: number;
  juros: number;
  taxas: number;
  irRetido: number; // nas retiradas do mês
  depositosAcum: number; // desde o começo (sem o valor inicial)
  retiradasAcum: number;
  jurosAcum: number;
  taxasAcum: number;
  irRetidoAcum: number;
  irEstimado: number; // IR se resgatar tudo no fim do mês
  liquido: number; // saldo - irEstimado
  liquidoReal: number | null;
}

export interface Resultado {
  saldoFinal: number;
  totalInvestido: number; // valor inicial
  totalDepositos: number;
  totalRetiradas: number;
  jurosTotais: number;
  taxasPagas: number;
  irRetiradas: number;
  irFinal: number; // estimado no resgate total no fim
  saldoLiquido: number; // saldoFinal - irFinal
  taxaAnualEfetiva: number; // bruta, antes das taxas
  taxaAnualLiquidaDeTaxas: number; // depois da taxa de administração (antes do IR)
  inflacaoAnual: number | null;
  saldoLiquidoReal: number | null; // saldo líquido em valor de hoje
  aportesReais: number | null; // inicial + depósitos - retiradas, cada um em valor de hoje
  ganhoReal: number | null; // saldoLiquidoReal - aportesReais
  taxaRealAnual: number | null; // (1 + taxa líquida de taxas) / (1 + inflação) - 1
  esgotouNoMes: number | null; // mês em que as retiradas zeraram o saldo
  meses: PontoMes[];
}

const EPS = 1e-9;

export const ROTULO_FREQUENCIA: Record<Frequencia, string> = {
  diaria: 'Diária',
  semanal: 'Semanal',
  quinzenal: 'Quinzenal',
  mensal: 'Mensal',
  bimestral: 'Bimestral',
  trimestral: 'Trimestral',
  semestral: 'Semestral',
  anual: 'Anual',
};

// Palavra usada em "Início do mês", "Fim do trimestre"...
export const PERIODO_FREQUENCIA: Record<Frequencia, string> = {
  diaria: 'dia',
  semanal: 'semana',
  quinzenal: 'quinzena',
  mensal: 'mês',
  bimestral: 'bimestre',
  trimestral: 'trimestre',
  semestral: 'semestre',
  anual: 'ano',
};

export function vezesPorAno(f: Frequencia, diasNoAno: number): number {
  switch (f) {
    case 'diaria':
      return diasNoAno;
    case 'semanal':
      return 52;
    case 'quinzenal':
      return 26;
    case 'mensal':
      return 12;
    case 'bimestral':
      return 6;
    case 'trimestral':
      return 4;
    case 'semestral':
      return 2;
    case 'anual':
      return 1;
  }
}

// Juros por período de capitalização a partir da taxa digitada.
// "nominal": a taxa é dividida pelo número de capitalizações (12% ao ano com capitalização mensal = 1% ao mês),
//   como no app de referência. "efetiva": a taxa já é a efetiva do período (12% ao ano = 0,9489% ao mês).
export function taxaPorPeriodo(
  taxa: number,
  periodo: 'mensal' | 'anual',
  capitalizacoesPorAno: number,
  tipo: 'nominal' | 'efetiva'
): number {
  if (tipo === 'nominal') {
    const nominalAno = periodo === 'mensal' ? taxa * 12 : taxa;
    return nominalAno / capitalizacoesPorAno;
  }
  const efetivaAno = periodo === 'mensal' ? Math.pow(1 + taxa, 12) - 1 : taxa;
  return Math.pow(1 + efetivaAno, 1 / capitalizacoesPorAno) - 1;
}

export function taxaEfetivaAnual(taxaPeriodo: number, capitalizacoesPorAno: number): number {
  return Math.pow(1 + taxaPeriodo, capitalizacoesPorAno) - 1;
}

export function taxaPeriodoDaEfetiva(efetivaAnual: number, capitalizacoesPorAno: number): number {
  return Math.pow(1 + efetivaAnual, 1 / capitalizacoesPorAno) - 1;
}

// Tabela regressiva do IR na renda fixa, pelo prazo de cada aplicação em dias corridos.
export function aliquotaIR(tipo: TipoImposto, dias: number): number {
  if (tipo === 'nenhum') return 0;
  if (tipo === 'fixo15') return 0.15;
  if (dias <= 180) return 0.225;
  if (dias <= 360) return 0.2;
  if (dias <= 720) return 0.175;
  return 0.15;
}

// ---------- Eventos ----------

interface EventoFluxo {
  t: number;
  ordem: number; // 1 = depósito, 2 = retirada
  valor: number;
}

// Datas e valores de um fluxo. Os períodos contam a partir do começo do fluxo.
function eventosDoFluxo(f: Fluxo, T: number, diasNoAno: number, inflacao: number | null): EventoFluxo[] {
  const n = vezesPorAno(f.frequencia, diasNoAno);
  const inicio = Math.max(0, f.inicioMes) / 12;
  const fim = f.fimMes === null ? T : Math.min(T, Math.max(0, f.fimMes) / 12);
  const aumento = f.aumentoAnual === 'inflacao' ? inflacao ?? 0 : f.aumentoAnual;
  const eventos: EventoFluxo[] = [];
  if (!(f.valor > 0) || fim <= inicio + EPS) return eventos;
  for (let j = 0; ; j++) {
    const comeco = inicio + j / n;
    const termino = inicio + (j + 1) / n;
    if (termino > fim + EPS) break;
    const anos = Math.floor((comeco - inicio) + EPS);
    eventos.push({
      t: f.momento === 'inicio' ? comeco : termino,
      ordem: f.tipo === 'deposito' ? 1 : 2,
      valor: f.valor * Math.pow(1 + aumento, anos),
    });
  }
  return eventos;
}

// ---------- Lotes (para o IR) ----------
// Cada depósito vira um lote com o seu custo e a sua data. Rendem todos igual, então o valor de um lote é
// cotas × valor da cota. A cota sobe a cada crédito de juros (e cai com a taxa de administração).
// Lotes com mais de 720 dias pagam a menor alíquota: são juntados num lote só, para a conta não crescer.

interface Lote {
  t: number;
  custo: number;
  cotas: number;
}

const DIAS_IR_MINIMO = 720;

class Carteira {
  lotes: Lote[] = [];
  velho: Lote | null = null; // lotes com mais de 720 dias juntados
  cota = 1;
  imposto: TipoImposto;

  constructor(imposto: TipoImposto) {
    this.imposto = imposto;
  }

  aplicar(t: number, valor: number, cotaAgora: number) {
    if (this.imposto === 'nenhum' || valor <= 0) return;
    this.lotes.push({ t, custo: valor, cotas: valor / cotaAgora });
  }

  private juntarVelhos(t: number) {
    if (this.imposto !== 'regressiva') return;
    while (this.lotes.length > 0 && (t - this.lotes[0].t) * 365 > DIAS_IR_MINIMO + EPS) {
      const l = this.lotes.shift()!;
      if (!this.velho) this.velho = { t: l.t, custo: 0, cotas: 0 };
      this.velho.custo += l.custo;
      this.velho.cotas += l.cotas;
    }
  }

  private todos(): Lote[] {
    return this.velho ? [this.velho, ...this.lotes] : this.lotes;
  }

  private dias(l: Lote, t: number): number {
    return l === this.velho ? DIAS_IR_MINIMO + 1 : (t - l.t) * 365;
  }

  // Fator que leva "cotas × cota" ao saldo de verdade (corrige as pequenas diferenças do pro rata).
  private escala(saldo: number, cotaAgora: number): number {
    let total = 0;
    for (const l of this.todos()) total += l.cotas * cotaAgora;
    return total > EPS ? saldo / total : 0;
  }

  // IR se resgatar tudo agora.
  irEstimado(t: number, saldo: number, cotaAgora: number): number {
    if (this.imposto === 'nenhum' || saldo <= EPS) return 0;
    this.juntarVelhos(t);
    const k = this.escala(saldo, cotaAgora);
    let ir = 0;
    for (const l of this.todos()) {
      const ganho = l.cotas * cotaAgora * k - l.custo;
      if (ganho > 0) ir += ganho * aliquotaIR(this.imposto, this.dias(l, t));
    }
    return ir;
  }

  // Retira `valor` dos lotes mais antigos primeiro e devolve o IR retido.
  retirar(t: number, valor: number, saldo: number, cotaAgora: number): number {
    if (this.imposto === 'nenhum' || valor <= 0) return 0;
    this.juntarVelhos(t);
    const k = this.escala(saldo, cotaAgora);
    if (k <= 0) return 0;
    let falta = valor;
    let ir = 0;
    for (const l of this.todos()) {
      if (falta <= EPS) break;
      const valorLote = l.cotas * cotaAgora * k;
      if (valorLote <= EPS) continue;
      const tirar = Math.min(falta, valorLote);
      const fracao = tirar / valorLote;
      const custo = l.custo * fracao;
      const ganho = tirar - custo;
      if (ganho > 0) ir += ganho * aliquotaIR(this.imposto, this.dias(l, t));
      l.custo -= custo;
      l.cotas -= l.cotas * fracao;
      falta -= tirar;
    }
    this.lotes = this.lotes.filter((l) => l.cotas > EPS);
    return ir;
  }
}

// ---------- Simulação ----------

export function simular(p: Parametros, diasNoAno = 365): Resultado {
  const T = p.meses / 12;
  const cap = p.capitalizacoesPorAno;
  const r = p.taxaPeriodo;
  const detalhar = p.detalhar !== false;
  const inflacao = p.inflacaoAnual;
  const deflator = (t: number) => (inflacao === null ? 1 : Math.pow(1 + inflacao, t));

  const fluxos: EventoFluxo[] = [];
  for (const f of p.fluxos) fluxos.push(...eventosDoFluxo(f, T, diasNoAno, inflacao));
  fluxos.sort((a, b) => a.t - b.t || a.ordem - b.ordem);

  const carteira = new Carteira(p.imposto);
  let saldo = p.valorInicial;
  carteira.aplicar(0, p.valorInicial, 1);

  // Acumuladores
  let depositos = 0;
  let retiradas = 0;
  let juros = 0;
  let taxas = 0;
  let irRetido = 0;
  let aportesReais = p.valorInicial;
  let esgotouNoMes: number | null = null;

  // Do mês corrente (para a tabela)
  let mesDep = 0;
  let mesRet = 0;
  let mesJur = 0;
  let mesTax = 0;
  let mesIr = 0;
  const meses: PontoMes[] = [];

  // Período de capitalização corrente
  let k = 0; // número do período corrente (começa em k / cap)
  let ultimoT = 0; // última vez que a área do saldo foi somada
  let area = 0; // ∫ saldo dt dentro do período
  const comprimento = 1 / cap;

  const somarArea = (t: number) => {
    if (t > ultimoT) {
      area += saldo * (t - ultimoT);
      ultimoT = t;
    }
  };

  // Credita os juros do período corrente até `t` (o fim do período, ou o fim do prazo).
  const creditar = (t: number) => {
    somarArea(t);
    const j = (r * area) / comprimento;
    const inicioPeriodo = k / cap;
    const duracao = t - inicioPeriodo;
    // A cota sobe na mesma proporção que um real parado o período todo.
    const cotaAntes = carteira.cota;
    if (j !== 0) {
      saldo += j;
      juros += j;
      mesJur += j;
    }
    carteira.cota = cotaAntes * (1 + (r * duracao) / comprimento);
    if (p.taxaAdmAnual > 0 && saldo > 0) {
      const fator = Math.pow(1 - p.taxaAdmAnual, duracao);
      const tx = saldo * (1 - fator);
      saldo -= tx;
      taxas += tx;
      mesTax += tx;
      carteira.cota *= fator;
    }
    area = 0;
  };

  // Cota no instante t, contando os juros proporcionais ainda não creditados (preço de entrada de um depósito).
  const cotaEm = (t: number) => carteira.cota * (1 + (r * (t - k / cap)) / comprimento);

  const fecharMes = (m: number) => {
    const t = m / 12;
    if (detalhar) {
      // Na fotografia do mês, os juros do período ainda não creditados não entram no saldo.
      const ir = carteira.irEstimado(t, saldo, carteira.cota);
      const d = deflator(t);
      meses.push({
        mes: m,
        t,
        saldo,
        saldoReal: inflacao === null ? null : saldo / d,
        depositos: mesDep,
        retiradas: mesRet,
        juros: mesJur,
        taxas: mesTax,
        irRetido: mesIr,
        depositosAcum: depositos,
        retiradasAcum: retiradas,
        jurosAcum: juros,
        taxasAcum: taxas,
        irRetidoAcum: irRetido,
        irEstimado: ir,
        liquido: saldo - ir,
        liquidoReal: inflacao === null ? null : (saldo - ir) / d,
      });
    }
    mesDep = mesRet = mesJur = mesTax = mesIr = 0;
  };

  let iFluxo = 0;
  let proximoMes = 1;
  const totalPeriodos = Math.floor(T * cap + EPS);

  // Processa tudo até o instante t (inclusive), na ordem: juros, fluxos, fim de mês.
  const avancarAte = (limite: number, inclusive: boolean) => {
    // Fluxos e meses que caem antes de `limite`.
    while (true) {
      const tf = iFluxo < fluxos.length ? fluxos[iFluxo].t : Infinity;
      const tm = proximoMes <= p.meses ? proximoMes / 12 : Infinity;
      const proximo = Math.min(tf, tm);
      const dentro = inclusive ? proximo <= limite + EPS : proximo < limite - EPS;
      if (!dentro || proximo === Infinity) break;
      // Fluxo e fim de mês no mesmo instante: o fluxo entra no mês que está fechando.
      if (tf <= tm + EPS) {
        const e = fluxos[iFluxo++];
        somarArea(e.t);
        if (e.ordem === 1) {
          carteira.aplicar(e.t, e.valor, cotaEm(e.t));
          saldo += e.valor;
          depositos += e.valor;
          mesDep += e.valor;
          aportesReais += e.valor / deflator(e.t);
        } else {
          const tirar = Math.min(e.valor, Math.max(0, saldo));
          if (tirar > 0) {
            const ir = carteira.retirar(e.t, tirar, saldo, carteira.cota);
            saldo -= tirar;
            retiradas += tirar;
            mesRet += tirar;
            irRetido += ir;
            mesIr += ir;
            aportesReais -= tirar / deflator(e.t);
          }
          if (saldo <= 0.005 && esgotouNoMes === null) {
            esgotouNoMes = Math.max(1, Math.ceil(e.t * 12 - EPS));
          }
        }
      } else {
        fecharMes(proximoMes++);
      }
    }
  };

  for (k = 0; k < totalPeriodos; ) {
    const fimPeriodo = (k + 1) / cap;
    // Fluxos e meses antes do fim deste período.
    avancarAte(fimPeriodo, false);
    creditar(fimPeriodo);
    k++;
    // Fluxos e fechamentos de mês no instante do crédito (depois dos juros).
    avancarAte(fimPeriodo, true);
  }
  // Pedaço final, quando o prazo não fecha um período inteiro.
  if (T - totalPeriodos / cap > EPS) {
    avancarAte(T, false);
    creditar(T);
  }
  avancarAte(T, true);
  // Garante a fotografia do último mês.
  while (proximoMes <= p.meses) fecharMes(proximoMes++);

  const irFinal = carteira.irEstimado(T, saldo, carteira.cota);
  const saldoLiquido = saldo - irFinal;
  const efetiva = taxaEfetivaAnual(r, cap);
  const liquidaDeTaxas = (1 + efetiva) * (1 - p.taxaAdmAnual) - 1;
  const saldoLiquidoReal = inflacao === null ? null : saldoLiquido / deflator(T);

  return {
    saldoFinal: saldo,
    totalInvestido: p.valorInicial,
    totalDepositos: depositos,
    totalRetiradas: retiradas,
    jurosTotais: juros,
    taxasPagas: taxas,
    irRetiradas: irRetido,
    irFinal,
    saldoLiquido,
    taxaAnualEfetiva: efetiva,
    taxaAnualLiquidaDeTaxas: liquidaDeTaxas,
    inflacaoAnual: inflacao,
    saldoLiquidoReal,
    aportesReais: inflacao === null ? null : aportesReais,
    ganhoReal: saldoLiquidoReal === null ? null : saldoLiquidoReal - aportesReais,
    taxaRealAnual: inflacao === null ? null : (1 + liquidaDeTaxas) / (1 + inflacao) - 1,
    esgotouNoMes,
    meses,
  };
}

// ---------- Metas ----------

export type MedidaMeta = 'liquido' | 'liquidoReal';

function medida(res: Resultado, qual: MedidaMeta): number {
  return qual === 'liquidoReal' && res.saldoLiquidoReal !== null ? res.saldoLiquidoReal : res.saldoLiquido;
}

// Quanto depositar por mês (além dos fluxos já informados) para chegar a `alvo` no fim do prazo.
// Devolve 0 se já chega sem depositar, ou null se nem R$ 1 bilhão por mês chega.
export function depositoParaMeta(
  p: Parametros,
  diasNoAno: number,
  alvo: number,
  qual: MedidaMeta,
  momento: Momento
): number | null {
  const com = (d: number) =>
    medida(
      simular(
        {
          ...p,
          detalhar: false,
          fluxos: [
            ...p.fluxos,
            { tipo: 'deposito', valor: d, frequencia: 'mensal', momento, aumentoAnual: 0, inicioMes: 0, fimMes: null },
          ],
        },
        diasNoAno
      ),
      qual
    );
  const zero = com(0);
  if (zero >= alvo) return 0;
  // Quase sempre o saldo cresce em linha reta com o depósito: uma regra de três resolve com poucas simulações.
  // Quando não (retiradas que zeram o saldo), cai na busca por metades.
  const mil = com(1000);
  if (mil > zero) {
    const palpite = Math.ceil(((alvo - zero) / (mil - zero)) * 1000 * 100) / 100;
    if (palpite > 0 && palpite <= 1e9 && com(palpite) >= alvo - 0.005 && com(palpite - 0.01) < alvo) return palpite;
  }
  let baixo = 0;
  let alto = 1000;
  while (com(alto) < alvo) {
    baixo = alto;
    alto *= 4;
    if (alto > 1e9) return null;
  }
  for (let i = 0; i < 60 && alto - baixo > 0.001; i++) {
    const meio = (baixo + alto) / 2;
    if (com(meio) >= alvo) alto = meio;
    else baixo = meio;
  }
  return Math.ceil(alto * 100) / 100;
}

// Em quantos meses o saldo chega a `alvo`, mantendo os fluxos informados (até `limiteMeses`).
export function mesesParaMeta(
  p: Parametros,
  diasNoAno: number,
  alvo: number,
  qual: MedidaMeta,
  limiteMeses = 1200
): number | null {
  if (p.valorInicial >= alvo) return 0;
  const res = simular({ ...p, meses: limiteMeses, detalhar: true }, diasNoAno);
  for (const m of res.meses) {
    const v = qual === 'liquidoReal' && m.liquidoReal !== null ? m.liquidoReal : m.liquido;
    if (v >= alvo - 0.005) return m.mes;
  }
  return null;
}
