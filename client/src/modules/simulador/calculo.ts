// Motor do simulador de investimentos. Só contas, sem React: dá para testar sozinho.
//
// O tempo corre em anos (t = 0 no começo, t = T no fim). Os juros rendem "pro rata" dentro de cada período
// de capitalização (juros simples sobre o saldo de cada trecho) e só entram no saldo no fim do período:
// os juros são pagos no mesmo cronograma da capitalização. Se o prazo terminar no meio de um período,
// os juros proporcionais entram no fim (como num resgate).
//
// Renda variável: a "taxa" é a valorização do preço (mensal), que pode mudar mês a mês (`retornos`, usado na
// faixa de resultados). Dividendos são pagos sobre o saldo e podem ser reinvestidos (comprando mais, com o
// custo de compra) ou recebidos (saem do investimento).
//
// Ordem no mesmo instante: juros/valorização do período que terminou, taxa de administração, dividendos,
// depósitos, retiradas.

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
export type TipoImposto = 'nenhum' | 'regressiva' | 'fixo15' | 'fixo20';

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

export interface Dividendos {
  taxaAnual: number; // fração do saldo por ano (dividend yield)
  porAno: number; // pagamentos por ano
  reinvestir: boolean;
}

export interface Parametros {
  valorInicial: number;
  taxaPeriodo: number; // juros (ou valorização) por período de capitalização (fração)
  capitalizacoesPorAno: number;
  meses: number; // prazo total em meses
  fluxos: Fluxo[];
  inflacaoAnual: number | null; // fração; null = sem inflação
  taxaAdmAnual: number; // fração do saldo por ano (administração/custódia)
  imposto: TipoImposto;
  detalhar?: boolean; // false: não monta a lista mês a mês (usado nas buscas de meta e na faixa)
  retornos?: number[]; // taxa de cada período (substitui taxaPeriodo onde houver)
  dividendos?: Dividendos | null;
  custoCompra?: number; // fração cobrada em cada compra (corretagem, emolumentos)
  isencaoVendasMes?: number; // vendas no mês até este valor não pagam IR (ações: R$ 20 mil)
}

export interface PontoMes {
  mes: number; // 1..meses
  t: number; // em anos
  saldo: number;
  saldoReal: number | null; // em valor de hoje
  depositos: number; // no mês
  retiradas: number;
  juros: number;
  dividendos: number;
  taxas: number; // administração + custo de compra
  irRetido: number; // nas retiradas do mês
  depositosAcum: number; // desde o começo (sem o valor inicial)
  retiradasAcum: number;
  dividendosRecebidosAcum: number; // dividendos que saíram do investimento
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
  jurosTotais: number; // juros (renda fixa) ou valorização (renda variável)
  dividendos: number; // todos os dividendos pagos
  dividendosRecebidos: number; // os que não foram reinvestidos
  taxasPagas: number; // administração
  custosCompra: number; // corretagem e emolumentos
  irRetiradas: number;
  irFinal: number; // estimado no resgate total no fim
  saldoLiquido: number; // saldoFinal - irFinal
  taxaAnualEfetiva: number; // juros, ou valorização + dividendos reinvestidos, antes das taxas
  taxaAnualPreco: number; // só a parte dos juros/valorização
  taxaAnualLiquidaDeTaxas: number; // depois da taxa de administração (antes do IR)
  inflacaoAnual: number | null;
  saldoLiquidoReal: number | null; // saldo líquido em valor de hoje
  aportesReais: number | null; // inicial + depósitos - retiradas - dividendos recebidos, cada um em valor de hoje
  ganhoReal: number | null; // saldoLiquidoReal - aportesReais
  taxaRealAnual: number | null; // (1 + taxa líquida de taxas) / (1 + inflação) - 1
  esgotouNoMes: number | null; // mês em que as retiradas zeraram o saldo
  saldosMes: number[]; // saldo no fim de cada mês (sempre preenchido; barato)
  meses: PontoMes[]; // detalhe mês a mês (só com detalhar)
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

// Alíquota do IR sobre o ganho. Regressiva (renda fixa): pelo prazo de cada aplicação em dias corridos.
export function aliquotaIR(tipo: TipoImposto, dias: number): number {
  if (tipo === 'nenhum') return 0;
  if (tipo === 'fixo15') return 0.15;
  if (tipo === 'fixo20') return 0.2;
  if (dias <= 180) return 0.225;
  if (dias <= 360) return 0.2;
  if (dias <= 720) return 0.175;
  return 0.15;
}

// ---------- Eventos ----------

interface EventoFluxo {
  t: number;
  ordem: number; // 0 = dividendo, 1 = depósito, 2 = retirada
  valor: number; // dividendo: taxa do pagamento sobre o saldo
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
    const anos = Math.floor(comeco - inicio + EPS);
    eventos.push({
      t: f.momento === 'inicio' ? comeco : termino,
      ordem: f.tipo === 'deposito' ? 1 : 2,
      valor: f.valor * Math.pow(1 + aumento, anos),
    });
  }
  return eventos;
}

// ---------- Lotes (para o IR) ----------
// Cada compra vira um lote com o seu custo e a sua data. Rendem todos igual, então o valor de um lote é
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

  // `custo`: quanto conta como custo de compra no IR; `aplicado`: quanto entrou no saldo (custo menos corretagem).
  aplicar(t: number, custo: number, aplicado: number, cotaAgora: number) {
    if (this.imposto === 'nenhum' || aplicado <= 0) return;
    this.lotes.push({ t, custo, cotas: aplicado / cotaAgora });
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

  // Retira `valor` dos lotes mais antigos primeiro e devolve o IR sobre o ganho (a isenção fica com quem chama).
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
  const detalhar = p.detalhar !== false;
  const inflacao = p.inflacaoAnual;
  const deflator = (t: number) => (inflacao === null ? 1 : Math.pow(1 + inflacao, t));
  const custoCompra = p.custoCompra ?? 0;
  const isencao = p.isencaoVendasMes ?? 0;
  const div = p.dividendos && p.dividendos.taxaAnual > 0 && p.dividendos.porAno > 0 ? p.dividendos : null;
  const taxaDe = (periodo: number) => p.retornos?.[periodo] ?? p.taxaPeriodo;

  const fluxos: EventoFluxo[] = [];
  for (const f of p.fluxos) fluxos.push(...eventosDoFluxo(f, T, diasNoAno, inflacao));
  if (div) {
    const pagamentos = Math.floor(T * div.porAno + EPS);
    for (let j = 1; j <= pagamentos; j++) fluxos.push({ t: j / div.porAno, ordem: 0, valor: div.taxaAnual / div.porAno });
  }
  fluxos.sort((a, b) => a.t - b.t || a.ordem - b.ordem);

  const carteira = new Carteira(p.imposto);
  const custoInicial = p.valorInicial * custoCompra;
  let saldo = p.valorInicial - custoInicial;
  carteira.aplicar(0, p.valorInicial, saldo, 1);

  // Acumuladores
  let depositos = 0;
  let retiradas = 0;
  let juros = 0;
  let dividendos = 0;
  let dividendosRecebidos = 0;
  let taxas = 0;
  let custos = custoInicial;
  let irRetido = 0;
  let aportesReais = p.valorInicial;
  let esgotouNoMes: number | null = null;

  // Do mês corrente (para a tabela)
  let mesDep = 0;
  let mesRet = 0;
  let mesJur = 0;
  let mesDiv = 0;
  let mesTax = custoInicial;
  let mesIr = 0;
  // Isenção de vendas no mês: vale para o mês inteiro. Enquanto o total vendido no mês fica no limite, o IR das
  // vendas fica guardado em `irDispensadoMes`; se o mês passar do limite, ele é cobrado junto da venda que passou.
  let vendasMes = 0;
  let irDispensadoMes = 0;
  let ultimoMes = { vendas: 0, dispensado: 0 }; // do último mês fechado (para o resgate total no fim do prazo)
  const meses: PontoMes[] = [];
  const saldosMes: number[] = [];

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
    const r = taxaDe(k);
    const j = (r * area) / comprimento;
    const duracao = t - k / cap;
    if (j !== 0) {
      saldo += j;
      juros += j;
      mesJur += j;
    }
    // A cota sobe na mesma proporção que um real parado o período todo.
    carteira.cota *= 1 + (r * duracao) / comprimento;
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

  // Cota no instante t, contando os juros proporcionais ainda não creditados (preço de entrada de uma compra).
  const cotaEm = (t: number) => carteira.cota * (1 + (taxaDe(k) * (t - k / cap)) / comprimento);

  // IR se resgatar tudo em `t`, somando o resgate às vendas do mês: dentro do limite, isento; acima, paga também
  // o IR que as vendas anteriores do mês tinham dispensado.
  const irAgora = (t: number, vendas: number, dispensado: number) =>
    isencao > 0 && vendas + saldo <= isencao + EPS ? 0 : carteira.irEstimado(t, saldo, carteira.cota) + dispensado;

  const fecharMes = (m: number) => {
    const t = m / 12;
    saldosMes.push(saldo);
    if (detalhar) {
      // Na fotografia do mês, os juros do período ainda não creditados não entram no saldo.
      const ir = irAgora(t, vendasMes, irDispensadoMes);
      const d = deflator(t);
      meses.push({
        mes: m,
        t,
        saldo,
        saldoReal: inflacao === null ? null : saldo / d,
        depositos: mesDep,
        retiradas: mesRet,
        juros: mesJur,
        dividendos: mesDiv,
        taxas: mesTax,
        irRetido: mesIr,
        depositosAcum: depositos,
        retiradasAcum: retiradas,
        dividendosRecebidosAcum: dividendosRecebidos,
        jurosAcum: juros,
        taxasAcum: taxas + custos,
        irRetidoAcum: irRetido,
        irEstimado: ir,
        liquido: saldo - ir,
        liquidoReal: inflacao === null ? null : (saldo - ir) / d,
      });
    }
    ultimoMes = { vendas: vendasMes, dispensado: irDispensadoMes };
    mesDep = mesRet = mesJur = mesDiv = mesTax = mesIr = vendasMes = irDispensadoMes = 0;
  };

  // Compra: tira o custo de compra e cria o lote do IR.
  const comprar = (t: number, valor: number) => {
    const custo = valor * custoCompra;
    carteira.aplicar(t, valor, valor - custo, cotaEm(t));
    saldo += valor - custo;
    custos += custo;
    mesTax += custo;
  };

  let iFluxo = 0;
  let proximoMes = 1;
  const totalPeriodos = Math.floor(T * cap + EPS);

  // Processa fluxos e fins de mês até `limite` (inclusive ou não), na ordem do tempo.
  const avancarAte = (limite: number, inclusive: boolean) => {
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
        if (e.ordem === 0) {
          const valor = Math.max(0, saldo) * e.valor;
          if (valor > 0) {
            dividendos += valor;
            mesDiv += valor;
            if (div?.reinvestir) {
              comprar(e.t, valor);
            } else {
              dividendosRecebidos += valor;
              aportesReais -= valor / deflator(e.t);
            }
          }
        } else if (e.ordem === 1) {
          comprar(e.t, e.valor);
          depositos += e.valor;
          mesDep += e.valor;
          aportesReais += e.valor / deflator(e.t);
        } else {
          const tirar = Math.min(e.valor, Math.max(0, saldo));
          if (tirar > 0) {
            let ir = carteira.retirar(e.t, tirar, saldo, carteira.cota);
            saldo -= tirar;
            vendasMes += tirar;
            if (isencao > 0 && vendasMes <= isencao + EPS) {
              irDispensadoMes += ir;
              ir = 0;
            } else {
              ir += irDispensadoMes;
              irDispensadoMes = 0;
            }
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

  // O resgate total no fim cai no último mês: conta com as vendas que já houve nele.
  const irFinal = p.meses > 0 ? irAgora(T, ultimoMes.vendas, ultimoMes.dispensado) : irAgora(T, vendasMes, irDispensadoMes);
  const saldoLiquido = saldo - irFinal;
  const taxaAnualPreco = taxaEfetivaAnual(p.taxaPeriodo, cap);
  // Dividendos reinvestidos também rendem: entram na taxa efetiva.
  const efetiva =
    div && div.reinvestir ? (1 + taxaAnualPreco) * Math.pow(1 + div.taxaAnual / div.porAno, div.porAno) - 1 : taxaAnualPreco;
  const liquidaDeTaxas = (1 + efetiva) * (1 - p.taxaAdmAnual) - 1;
  const saldoLiquidoReal = inflacao === null ? null : saldoLiquido / deflator(T);

  return {
    saldoFinal: saldo,
    totalInvestido: p.valorInicial,
    totalDepositos: depositos,
    totalRetiradas: retiradas,
    jurosTotais: juros,
    dividendos,
    dividendosRecebidos,
    taxasPagas: taxas,
    custosCompra: custos,
    irRetiradas: irRetido,
    irFinal,
    saldoLiquido,
    taxaAnualEfetiva: efetiva,
    taxaAnualPreco,
    taxaAnualLiquidaDeTaxas: liquidaDeTaxas,
    inflacaoAnual: inflacao,
    saldoLiquidoReal,
    aportesReais: inflacao === null ? null : aportesReais,
    ganhoReal: saldoLiquidoReal === null ? null : saldoLiquidoReal - aportesReais,
    taxaRealAnual: inflacao === null ? null : (1 + liquidaDeTaxas) / (1 + inflacao) - 1,
    esgotouNoMes,
    saldosMes,
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
  // Quando não (retiradas que zeram o saldo, isenção de IR), cai na busca por metades.
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

// ---------- Faixa de resultados (renda variável) ----------
// Sorteia muitos caminhos de valorização mês a mês e mostra os resultados ruins, típicos e bons.
// Cada mês: ln(1 + retorno) tem distribuição normal com desvio σ/√12, centrada na valorização informada:
// o caminho mediano cresce à taxa informada, como o retorno ao ano de um histórico (média geométrica).
// A semente é fixa: os mesmos dados dão sempre a mesma faixa.

export interface Faixa {
  caminhos: number;
  mesesPorPonto: number[]; // meses de cada ponto do gráfico (0, 12, 24...)
  p10: number[]; // saldo (bruto) em cada ponto
  p50: number[];
  p90: number[];
  final: { p10: number; p50: number; p90: number }; // na medida pedida (líquido ou em valor de hoje)
  chanceMeta: number | null; // fração dos caminhos que chegam ao alvo
  chancePerda: number; // fração que termina com menos do que entrou
}

function sorteador(semente: number) {
  // mulberry32
  let a = semente >>> 0;
  const uniforme = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let guardado: number | null = null;
  const normal = () => {
    if (guardado !== null) {
      const g = guardado;
      guardado = null;
      return g;
    }
    let u = 0;
    while (u === 0) u = uniforme();
    const v = uniforme();
    const raio = Math.sqrt(-2 * Math.log(u));
    guardado = raio * Math.sin(2 * Math.PI * v);
    return raio * Math.cos(2 * Math.PI * v);
  };
  return normal;
}

function percentil(ordenados: number[], q: number): number {
  if (ordenados.length === 0) return 0;
  const pos = (ordenados.length - 1) * q;
  const i = Math.floor(pos);
  const resto = pos - i;
  return i + 1 < ordenados.length ? ordenados[i] * (1 - resto) + ordenados[i + 1] * resto : ordenados[i];
}

// `p` precisa ter capitalização mensal (12 por ano): a valorização de cada mês é sorteada.
export function simularFaixa(
  p: Parametros,
  volatilidadeAnual: number,
  opcoes: { caminhos?: number; semente?: number; alvo?: number | null; medida?: MedidaMeta } = {}
): Faixa {
  const caminhos = opcoes.caminhos ?? 1000;
  const normal = sorteador(opcoes.semente ?? 20261124);
  const sigma = volatilidadeAnual / Math.sqrt(12);
  const media = Math.log(1 + p.taxaPeriodo);
  const passo = p.meses <= 36 ? 1 : 12;
  const mesesPorPonto: number[] = [0];
  for (let m = passo; m <= p.meses; m += passo) mesesPorPonto.push(m);
  if (mesesPorPonto[mesesPorPonto.length - 1] !== p.meses) mesesPorPonto.push(p.meses);

  const porPonto: number[][] = mesesPorPonto.map(() => []);
  const finais: number[] = [];
  let chegam = 0;
  let perdem = 0;
  for (let c = 0; c < caminhos; c++) {
    const retornos: number[] = new Array(p.meses);
    for (let m = 0; m < p.meses; m++) retornos[m] = Math.exp(media + sigma * normal()) - 1;
    const res = simular({ ...p, retornos, detalhar: false });
    mesesPorPonto.forEach((m, i) => porPonto[i].push(m === 0 ? res.totalInvestido : res.saldosMes[m - 1]));
    const v = opcoes.medida === 'liquidoReal' && res.saldoLiquidoReal !== null ? res.saldoLiquidoReal : res.saldoLiquido;
    finais.push(v);
    if (opcoes.alvo && v >= opcoes.alvo) chegam++;
    const saiu = res.saldoLiquido + res.totalRetiradas + res.dividendosRecebidos;
    if (saiu < res.totalInvestido + res.totalDepositos - 0.005) perdem++;
  }
  const ordenar = (xs: number[]) => xs.slice().sort((a, b) => a - b);
  const ordenadosPorPonto = porPonto.map(ordenar);
  const finaisOrdenados = ordenar(finais);
  return {
    caminhos,
    mesesPorPonto,
    p10: ordenadosPorPonto.map((xs) => percentil(xs, 0.1)),
    p50: ordenadosPorPonto.map((xs) => percentil(xs, 0.5)),
    p90: ordenadosPorPonto.map((xs) => percentil(xs, 0.9)),
    final: {
      p10: percentil(finaisOrdenados, 0.1),
      p50: percentil(finaisOrdenados, 0.5),
      p90: percentil(finaisOrdenados, 0.9),
    },
    chanceMeta: opcoes.alvo ? chegam / caminhos : null,
    chancePerda: perdem / caminhos,
  };
}
