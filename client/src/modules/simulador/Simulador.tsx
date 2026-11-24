import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { formatarReais, lerValor, valorParaCampo } from '../../lib/financas';
import { useDados } from '../../lib/useDados';
import { Abas, Aviso, Botao, Caixa, Campo, Cartao, Pagina, Selecao, Tabela } from '../../ui';
import type { ColunaTabela } from '../../ui';
import { ResumoItem } from '../../ui/financas';
import { GraficoBarras, GraficoLinhas } from '../../ui/graficos';
import { Icone } from '../../ui/icones';
import {
  PERIODO_FREQUENCIA,
  ROTULO_FREQUENCIA,
  depositoParaMeta,
  mesesParaMeta,
  simular,
  simularFaixa,
  taxaPeriodoDaEfetiva,
} from './calculo';
import type { Faixa, Frequencia, PontoMes, Resultado } from './calculo';
import {
  FORMULARIO_PADRAO,
  INFLACAO_RESERVA,
  ISENCAO_ACOES_MES,
  PADRAO_ATIVO,
  ROTULO_ATIVO,
  esquecer,
  lerEntrada,
  lerSalvo,
  novoFluxo,
  percentualParaCampo,
  salvar,
} from './formulario';
import type { Ativo, FluxoForm, Formulario, TipoAumento, TipoInvestimento } from './formulario';
import './simulador.css';

interface ResumoContas {
  investimentos: number;
}

interface TaxaReferencia {
  taxa: number;
  ate: string;
}

interface Historico {
  retornoAnual: number;
  volatilidade: number;
  anos: number;
  de: string;
  ate: string;
}

interface Indices {
  ipca12m: TaxaReferencia | null;
  selic: TaxaReferencia | null;
  ibov?: Historico | null;
  ifix?: Historico | null;
}

const CAMINHOS_FAIXA = 1000;

// ---------- Formatação ----------

function pct(fracao: number, casas = 2): string {
  return `${(fracao * 100).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;
}

function formatarEixo(valor: number): string {
  return valor.toLocaleString('pt-BR', { notation: 'compact', style: 'currency', currency: 'BRL', maximumFractionDigits: 1 });
}

function duracaoEmTexto(meses: number): string {
  const anos = Math.floor(meses / 12);
  const resto = meses % 12;
  const partes: string[] = [];
  if (anos > 0) partes.push(`${anos} ${anos === 1 ? 'ano' : 'anos'}`);
  if (resto > 0) partes.push(`${resto} ${resto === 1 ? 'mês' : 'meses'}`);
  return partes.join(' e ') || '0 meses';
}

function mesDoAno(iso: string): string {
  const [ano, mes] = iso.split('-');
  return `${mes}/${ano}`;
}

// Rótulo do eixo X: meses quando o prazo é curto, anos quando é longo.
function rotuloPonto(mes: number, emMeses: boolean): string {
  if (emMeses) return String(mes);
  return mes % 12 === 0 ? String(mes / 12) : (mes / 12).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
}

// ---------- Opções ----------

const FREQUENCIAS: Frequencia[] = ['diaria', 'semanal', 'quinzenal', 'mensal', 'bimestral', 'trimestral', 'semestral', 'anual'];

function opcoesCapitalizacao(dias: string) {
  return FREQUENCIAS.map((f) => {
    const n = f === 'diaria' ? Number(dias) : { semanal: 52, quinzenal: 26, mensal: 12, bimestral: 6, trimestral: 4, semestral: 2, anual: 1 }[f];
    return { valor: f, rotulo: `${ROTULO_FREQUENCIA[f]} (${n} ${n === 1 ? 'vez' : 'vezes'} por ano)` };
  });
}

const OPCOES_FREQUENCIA = FREQUENCIAS.map((f) => ({ valor: f, rotulo: ROTULO_FREQUENCIA[f] }));

const OPCOES_FREQ_DIVIDENDOS = (['mensal', 'trimestral', 'semestral', 'anual'] as Frequencia[]).map((f) => ({
  valor: f,
  rotulo: ROTULO_FREQUENCIA[f],
}));

const OPCOES_ATIVO = (Object.keys(ROTULO_ATIVO) as Ativo[]).map((a) => ({ valor: a, rotulo: ROTULO_ATIVO[a] }));

function opcoesMomento(f: Frequencia) {
  const p = PERIODO_FREQUENCIA[f];
  const artigo = ['semana', 'quinzena'].includes(p) ? 'da' : 'do';
  return [
    { valor: 'inicio', rotulo: `Início ${artigo} ${p}` },
    { valor: 'fim', rotulo: `Fim ${artigo} ${p}` },
  ];
}

const OPCOES_AUMENTO = [
  { valor: 'nenhum', rotulo: 'Sem aumento' },
  { valor: 'inflacao', rotulo: 'Pela inflação' },
  { valor: 'fixo', rotulo: 'Percentual fixo' },
];

const OPCOES_IMPOSTO = [
  { valor: 'nenhum', rotulo: 'Não considerar (isento: LCI, LCA, poupança)' },
  { valor: 'regressiva', rotulo: 'Tabela regressiva (CDB, Tesouro, fundos)' },
  { valor: 'fixo15', rotulo: '15% sobre o ganho' },
];

const NOTA_IMPOSTO_ATIVO: Record<Ativo, string> = {
  acoes: `*Ações: 15% sobre o ganho na venda. Vendas de até ${formatarReais(ISENCAO_ACOES_MES)} no mês são isentas. Dividendos tratados como isentos (a retenção de 10% criada em 2026 só vale acima de R$ 50 mil por mês da mesma empresa).`,
  fiis: '*FIIs: 20% sobre o ganho na venda, sem isenção. Os rendimentos mensais são isentos para pessoa física.',
  etfs: '*ETFs de ações: 15% sobre o ganho na venda, sem a isenção de R$ 20 mil.',
};

// ---------- Pedaços da tela ----------

// Campo com um seletor ao lado (taxa + "mensal/anual", duração + "anos/meses"), como no app de referência.
function Par({ children }: { children: ReactNode }) {
  return <div className="sim-par">{children}</div>;
}

function Nota({ children }: { children: ReactNode }) {
  return <p className="sim-nota">{children}</p>;
}

function Numero({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <dt>{rotulo}</dt>
      <dd>{valor}</dd>
    </div>
  );
}

function CampoAumento({
  tipo,
  pctTexto,
  aoMudarTipo,
  aoMudarPct,
  rotulo = 'Aumento anual',
}: {
  tipo: TipoAumento;
  pctTexto: string;
  aoMudarTipo: (t: TipoAumento) => void;
  aoMudarPct: (v: string) => void;
  rotulo?: string;
}) {
  return (
    <Par>
      <Selecao rotulo={rotulo} valor={tipo} aoMudar={(v) => aoMudarTipo(v as TipoAumento)} opcoes={OPCOES_AUMENTO} />
      {tipo === 'fixo' ? <Campo rotulo="% ao ano" valor={pctTexto} aoMudar={aoMudarPct} /> : <span />}
    </Par>
  );
}

function CartaoFluxo({
  fluxo,
  numero,
  aoMudar,
  aoRemover,
}: {
  fluxo: FluxoForm;
  numero: number;
  aoMudar: (f: FluxoForm) => void;
  aoRemover: () => void;
}) {
  const nome = `${fluxo.tipo === 'deposito' ? 'Depósito' : 'Retirada'} ${numero}`;
  const mudar = <K extends keyof FluxoForm>(campo: K) => (valor: FluxoForm[K]) => aoMudar({ ...fluxo, [campo]: valor });
  return (
    <div className={`sim-fluxo sim-fluxo-${fluxo.tipo}`}>
      <div className="sim-fluxo-cabecalho">
        <strong>{nome}</strong>
        <button type="button" className="sim-remover" aria-label={`Remover ${nome}`} title={`Remover ${nome}`} onClick={aoRemover}>
          <Icone nome="menos" tamanho={18} />
        </button>
      </div>
      <div className="sim-grade">
        <Par>
          <Selecao
            rotulo="Frequência"
            valor={fluxo.frequencia}
            aoMudar={(v) => mudar('frequencia')(v as Frequencia)}
            opcoes={OPCOES_FREQUENCIA}
          />
          <Selecao
            rotulo={fluxo.tipo === 'deposito' ? 'Depósitos são feitos no' : 'Retiradas são feitas no'}
            valor={fluxo.momento}
            aoMudar={(v) => mudar('momento')(v as 'inicio' | 'fim')}
            opcoes={opcoesMomento(fluxo.frequencia)}
          />
        </Par>
        <Campo rotulo="Valor (R$)" valor={fluxo.valor} aoMudar={mudar('valor')} />
        <CampoAumento
          tipo={fluxo.aumento}
          pctTexto={fluxo.aumentoPct}
          aoMudarTipo={mudar('aumento')}
          aoMudarPct={mudar('aumentoPct')}
        />
        <Par>
          <Campo rotulo="Começa após (meses)" valor={fluxo.inicioMes} aoMudar={mudar('inicioMes')} tipo="number" />
          <Campo rotulo="Termina no mês" valor={fluxo.fimMes} aoMudar={mudar('fimMes')} tipo="number" />
        </Par>
      </div>
    </div>
  );
}

// ---------- Tabela ----------

interface Linha {
  chave: string;
  periodo: string;
  depositos: number;
  retiradas: number;
  juros: number;
  dividendos: number;
  taxas: number;
  irRetido: number;
  saldo: number;
  saldoReal: number | null;
  liquido: number;
}

function linhaDoMes(m: PontoMes): Linha {
  return {
    chave: `m${m.mes}`,
    periodo: `Mês ${m.mes}`,
    depositos: m.depositos,
    retiradas: m.retiradas,
    juros: m.juros,
    dividendos: m.dividendos,
    taxas: m.taxas,
    irRetido: m.irRetido,
    saldo: m.saldo,
    saldoReal: m.saldoReal,
    liquido: m.liquido,
  };
}

function linhasPorAno(meses: PontoMes[]): Linha[] {
  const linhas: Linha[] = [];
  for (let i = 0; i < meses.length; i += 12) {
    const bloco = meses.slice(i, i + 12);
    const ultimo = bloco[bloco.length - 1];
    const ano = i / 12 + 1;
    const soma = (f: (m: PontoMes) => number) => bloco.reduce((s, m) => s + f(m), 0);
    linhas.push({
      chave: `a${ano}`,
      periodo: bloco.length === 12 ? `Ano ${ano}` : `Ano ${ano} (${bloco.length} ${bloco.length === 1 ? 'mês' : 'meses'})`,
      depositos: soma((m) => m.depositos),
      retiradas: soma((m) => m.retiradas),
      juros: soma((m) => m.juros),
      dividendos: soma((m) => m.dividendos),
      taxas: soma((m) => m.taxas),
      irRetido: soma((m) => m.irRetido),
      saldo: ultimo.saldo,
      saldoReal: ultimo.saldoReal,
      liquido: ultimo.liquido,
    });
  }
  return linhas;
}

// ---------- Tela ----------

export function Simulador() {
  const resumo = useDados<ResumoContas>('/contas/resumo');
  const indices = useDados<Indices>('/simulador/indices');
  const salvo = useRef(lerSalvo());
  const [form, setForm] = useState<Formulario>(salvo.current ?? FORMULARIO_PADRAO);
  // Com valores lembrados, as sugestões (saldo dos investimentos, IPCA) não sobrescrevem o que a pessoa deixou.
  const valorEditado = useRef(salvo.current !== null);
  const inflacaoEditada = useRef(salvo.current !== null);
  const [visaoTabela, setVisaoTabela] = useState<'anos' | 'meses'>('anos');
  const [anoTabela, setAnoTabela] = useState('1');

  useEffect(() => {
    if (resumo.dados && !valorEditado.current) {
      const investimentos = resumo.dados.investimentos;
      setForm((f) => ({ ...f, valorInicial: investimentos > 0 ? valorParaCampo(investimentos) : f.valorInicial }));
    }
  }, [resumo.dados]);

  // Inflação padrão: IPCA dos últimos 12 meses; sem ele, um valor fixo.
  useEffect(() => {
    if (inflacaoEditada.current || indices.carregando) return;
    const ipca = indices.dados?.ipca12m?.taxa;
    setForm((f) => ({ ...f, inflacao: ipca !== undefined ? percentualParaCampo(ipca) : percentualParaCampo(INFLACAO_RESERVA / 100) }));
  }, [indices.dados, indices.carregando]);

  useEffect(() => {
    salvar(form);
  }, [form]);

  function mudar<K extends keyof Formulario>(campo: K) {
    return (valor: Formulario[K]) => {
      if (campo === 'valorInicial') valorEditado.current = true;
      if (campo === 'inflacao') inflacaoEditada.current = true;
      setForm((f) => ({ ...f, [campo]: valor }));
    };
  }

  function mudarFluxo(id: string, novo: FluxoForm) {
    setForm((f) => ({ ...f, fluxos: f.fluxos.map((x) => (x.id === id ? novo : x)) }));
  }

  // Trocar o tipo de ativo preenche os valores típicos dele.
  function mudarAtivo(ativo: Ativo) {
    setForm((f) => ({ ...f, ativo, ...PADRAO_ATIVO[ativo] }));
  }

  function limpar() {
    esquecer();
    valorEditado.current = false;
    inflacaoEditada.current = false;
    const investimentos = resumo.dados?.investimentos ?? 0;
    const ipca = indices.dados?.ipca12m?.taxa;
    setForm({
      ...FORMULARIO_PADRAO,
      modo: form.modo,
      tipoInvestimento: form.tipoInvestimento,
      fluxos: [novoFluxo('deposito')],
      valorInicial: investimentos > 0 ? valorParaCampo(investimentos) : '',
      inflacao: percentualParaCampo(ipca ?? INFLACAO_RESERVA / 100),
    });
  }

  function usarSelic() {
    const selic = indices.dados?.selic?.taxa;
    if (selic === undefined) return;
    // Taxa mensal equivalente: com capitalização mensal, dá exatamente a Selic ao ano.
    setForm((f) => ({
      ...f,
      taxa: percentualParaCampo(Math.pow(1 + selic, 1 / 12) - 1, 4),
      taxaPeriodo: 'mensal',
      tipoTaxa: 'efetiva',
    }));
  }

  // Histórico do índice de referência do tipo de ativo. O índice já inclui os proventos reinvestidos:
  // a valorização do preço é o retorno do índice sem a parte dos dividendos informados.
  const historicoAtivo: { nome: string; dados: Historico } | null = (() => {
    const h = form.ativo === 'fiis' ? indices.dados?.ifix : indices.dados?.ibov;
    return h ? { nome: form.ativo === 'fiis' ? 'IFIX' : 'Ibovespa', dados: h } : null;
  })();

  function usarHistorico() {
    if (!historicoAtivo) return;
    const h = historicoAtivo.dados;
    setForm((f) => {
      const etf = f.ativo === 'etfs';
      const dy = etf ? 0 : (lerValor(f.dividendos.replace('%', '')) ?? 0) / 100;
      return {
        ...f,
        valorizacao: percentualParaCampo((1 + h.retornoAnual) / (1 + dy) - 1),
        volatilidade: percentualParaCampo(h.volatilidade, 1),
        dividendos: etf ? '0' : f.dividendos,
      };
    });
  }

  // ---------- Contas ----------

  const variavel = form.tipoInvestimento === 'variavel';
  const entrada = useMemo(() => lerEntrada(form), [form]);
  const resultado: Resultado | null = useMemo(
    () => (typeof entrada === 'string' ? null : simular(entrada.params, entrada.diasNoAno)),
    [entrada]
  );

  // Cenários: a taxa de juros (renda fixa) ou a valorização (renda variável) 2 pontos abaixo e acima.
  const cenarios = useMemo(() => {
    if (typeof entrada === 'string' || !resultado) return null;
    const base = resultado.taxaAnualPreco;
    const nome = entrada.variavel ? 'Valorização' : 'Taxa';
    return [
      { rotulo: `${nome} 2 pontos abaixo`, efetiva: base - 0.02 },
      { rotulo: `${nome} informada`, efetiva: base },
      { rotulo: `${nome} 2 pontos acima`, efetiva: base + 0.02 },
    ]
      .filter((c) => c.efetiva > -1)
      .map((c) => ({
        ...c,
        res:
          c.efetiva === base
            ? resultado
            : simular(
                {
                  ...entrada.params,
                  detalhar: false,
                  taxaPeriodo: taxaPeriodoDaEfetiva(c.efetiva, entrada.params.capitalizacoesPorAno),
                },
                entrada.diasNoAno
              ),
      }));
  }, [entrada, resultado]);

  const metaValor = lerValor(form.metaValor);
  const temInflacao = resultado?.inflacaoAnual !== null && resultado?.inflacaoAnual !== undefined;
  const medidaMeta = form.metaReal && temInflacao ? 'liquidoReal' : 'liquido';

  const meta = useMemo(() => {
    if (metaValor === null || metaValor <= 0) return null;
    const semBasico = lerEntrada(form, true);
    if (typeof semBasico === 'string' || typeof entrada === 'string') return null;
    return {
      deposito: depositoParaMeta(semBasico.params, semBasico.diasNoAno, metaValor, medidaMeta, semBasico.momentoMeta),
      meses: mesesParaMeta(entrada.params, entrada.diasNoAno, metaValor, medidaMeta),
    };
  }, [form, entrada, metaValor, medidaMeta]);

  // Faixa de resultados (renda variável com oscilação): mil caminhos sorteados. É a conta mais pesada da tela,
  // então espera a pessoa parar de digitar.
  const [faixa, setFaixa] = useState<Faixa | null>(null);
  const [calculandoFaixa, setCalculandoFaixa] = useState(false);
  useEffect(() => {
    if (typeof entrada === 'string' || !entrada.variavel || entrada.volatilidade <= 0) {
      setFaixa(null);
      setCalculandoFaixa(false);
      return;
    }
    setCalculandoFaixa(true);
    const relogio = setTimeout(() => {
      setFaixa(
        simularFaixa(entrada.params, entrada.volatilidade, {
          caminhos: CAMINHOS_FAIXA,
          alvo: metaValor !== null && metaValor > 0 ? metaValor : null,
          medida: medidaMeta,
        })
      );
      setCalculandoFaixa(false);
    }, 450);
    return () => clearTimeout(relogio);
  }, [entrada, metaValor, medidaMeta]);

  function usarDepositoDaMeta(valor: number) {
    if (form.modo === 'basico') {
      setForm((f) => ({ ...f, depositoMensal: valorParaCampo(valor) }));
    } else {
      setForm((f) => ({ ...f, fluxos: [...f.fluxos, novoFluxo('deposito', valorParaCampo(valor))] }));
    }
  }

  // ---------- Gráficos e tabela ----------

  const pontosGrafico = useMemo(() => {
    if (!resultado || typeof entrada === 'string') return null;
    const meses = resultado.meses;
    const emMeses = meses.length <= 36;
    const escolhidos = meses.filter((m, i) => emMeses || (i + 1) % 12 === 0 || i === meses.length - 1);
    const inicial = entrada.params.valorInicial;
    const pontos = [
      { rotulo: '0', saldo: inicial, real: temInflacao ? inicial : null, aportado: inicial },
      ...escolhidos.map((m) => ({
        rotulo: rotuloPonto(m.mes, emMeses),
        saldo: m.saldo,
        real: m.saldoReal,
        aportado: inicial + m.depositosAcum - m.retiradasAcum - m.dividendosRecebidosAcum,
      })),
    ];
    return { emMeses, pontos };
  }, [resultado, entrada, temInflacao]);

  const linhasTabela = useMemo(() => {
    if (!resultado) return [];
    if (visaoTabela === 'anos') return linhasPorAno(resultado.meses);
    const ano = Math.max(1, Number(anoTabela) || 1);
    return resultado.meses.slice((ano - 1) * 12, ano * 12).map(linhaDoMes);
  }, [resultado, visaoTabela, anoTabela]);

  const anosNaTabela = resultado ? Math.ceil(resultado.meses.length / 12) : 0;
  useEffect(() => {
    if (Number(anoTabela) > anosNaTabela && anosNaTabela > 0) setAnoTabela(String(anosNaTabela));
  }, [anosNaTabela, anoTabela]);

  const temRetiradas = (resultado?.totalRetiradas ?? 0) > 0;
  const temIR = typeof entrada !== 'string' && entrada.params.imposto !== 'nenhum';
  const temTaxas = (resultado?.taxasPagas ?? 0) + (resultado?.custosCompra ?? 0) > 0;
  const temDividendos = (resultado?.dividendos ?? 0) > 0;
  const nomeJuros = variavel ? 'Valorização' : 'Juros';

  const colunas: ColunaTabela<Linha>[] = [
    { titulo: 'Período', celula: (l) => l.periodo },
    { titulo: 'Depósitos', celula: (l) => formatarReais(l.depositos), alinhar: 'direita' },
    ...(temRetiradas ? [{ titulo: 'Retiradas', celula: (l: Linha) => formatarReais(l.retiradas), alinhar: 'direita' as const }] : []),
    { titulo: nomeJuros, celula: (l) => formatarReais(l.juros), alinhar: 'direita' },
    ...(temDividendos ? [{ titulo: 'Dividendos', celula: (l: Linha) => formatarReais(l.dividendos), alinhar: 'direita' as const }] : []),
    ...(temTaxas ? [{ titulo: 'Taxas e custos', celula: (l: Linha) => formatarReais(l.taxas), alinhar: 'direita' as const }] : []),
    ...(temIR && temRetiradas
      ? [{ titulo: 'IR nas retiradas', celula: (l: Linha) => formatarReais(l.irRetido), alinhar: 'direita' as const }]
      : []),
    { titulo: 'Saldo', celula: (l) => formatarReais(l.saldo), alinhar: 'direita' },
    ...(temIR ? [{ titulo: 'Líquido se resgatar', celula: (l: Linha) => formatarReais(l.liquido), alinhar: 'direita' as const }] : []),
    ...(temInflacao
      ? [{ titulo: 'Saldo em valor de hoje', celula: (l: Linha) => (l.saldoReal === null ? '' : formatarReais(l.saldoReal)), alinhar: 'direita' as const }]
      : []),
  ];

  const avancado = form.modo === 'avancado';
  const ipca = indices.dados?.ipca12m ?? null;
  const selic = indices.dados?.selic ?? null;
  const contagem = { deposito: 0, retirada: 0 };

  const camposDeposito = avancado ? null : (
    <>
      <Par>
        <Campo rotulo="Depósito mensal (R$)" valor={form.depositoMensal} aoMudar={mudar('depositoMensal')} />
        <Selecao
          rotulo="Depósitos são feitos no"
          valor={form.momentoBasico}
          aoMudar={(v) => mudar('momentoBasico')(v as 'inicio' | 'fim')}
          opcoes={opcoesMomento('mensal')}
        />
      </Par>
      <CampoAumento
        rotulo="Aumento anual do depósito"
        tipo={form.aumentoBasico}
        pctTexto={form.aumentoBasicoPct}
        aoMudarTipo={mudar('aumentoBasico')}
        aoMudarPct={mudar('aumentoBasicoPct')}
      />
    </>
  );

  const campoDuracao = (
    <Par>
      <Campo rotulo="Duração" valor={form.duracao} aoMudar={mudar('duracao')} tipo="number" />
      <Selecao
        rotulo="A duração é em"
        valor={form.duracaoUnidade}
        aoMudar={(v) => mudar('duracaoUnidade')(v as 'anos' | 'meses')}
        opcoes={[
          { valor: 'anos', rotulo: 'Ano(s)' },
          { valor: 'meses', rotulo: 'Mês(es)' },
        ]}
      />
    </Par>
  );

  return (
    <Pagina
      titulo="Simulador de investimentos"
      acoes={
        <Botao variante="secundario" aoClicar={limpar}>
          Limpar
        </Botao>
      }
    >
      <p className="sim-explicacao">
        Renda fixa ou renda variável, com depósitos, retiradas, inflação, imposto e taxas. Os valores ficam guardados neste
        navegador.
      </p>

      <div className="sim-topo">
        <Abas
          abas={[
            { id: 'fixa', rotulo: 'Renda fixa' },
            { id: 'variavel', rotulo: 'Renda variável' },
          ]}
          ativa={form.tipoInvestimento}
          aoMudar={(id) => mudar('tipoInvestimento')(id as TipoInvestimento)}
        />
        <Abas
          abas={[
            { id: 'basico', rotulo: 'Básico' },
            { id: 'avancado', rotulo: 'Avançado' },
          ]}
          ativa={form.modo}
          aoMudar={(id) => mudar('modo')(id as 'basico' | 'avancado')}
        />
      </div>

      <div className="sim-colunas">
        <div className="sim-entrada">
          <Cartao titulo={variavel ? 'Dados do investimento (renda variável)' : 'Dados do investimento (renda fixa)'}>
            {variavel ? (
              <>
                <div className="sim-grade">
                  <Campo rotulo="Valor inicial (R$)" valor={form.valorInicial} aoMudar={mudar('valorInicial')} />
                  <Selecao rotulo="Tipo de ativo" valor={form.ativo} aoMudar={(v) => mudarAtivo(v as Ativo)} opcoes={OPCOES_ATIVO} />
                  <div>
                    <Par>
                      <Campo rotulo="Valorização esperada (% ao ano)" valor={form.valorizacao} aoMudar={mudar('valorizacao')} />
                      <Campo rotulo="Oscilação (% ao ano)" valor={form.volatilidade} aoMudar={mudar('volatilidade')} />
                    </Par>
                    {historicoAtivo ? (
                      <p className="sim-dica">
                        {historicoAtivo.nome} nos últimos {historicoAtivo.dados.anos.toLocaleString('pt-BR')} anos (até{' '}
                        {mesDoAno(historicoAtivo.dados.ate)}): {pct(historicoAtivo.dados.retornoAnual)} ao ano com proventos,
                        oscilação de {pct(historicoAtivo.dados.volatilidade, 1)}.{' '}
                        <button type="button" className="sim-link" onClick={usarHistorico}>
                          Usar o histórico
                        </button>
                      </p>
                    ) : (
                      !indices.carregando && (
                        <p className="sim-dica">
                          O histórico do {form.ativo === 'fiis' ? 'IFIX' : 'Ibovespa'} ainda não está no sistema. A busca começou;
                          volte em alguns minutos.
                        </p>
                      )
                    )}
                  </div>
                  <Par>
                    <Campo rotulo="Dividendos (% ao ano)" valor={form.dividendos} aoMudar={mudar('dividendos')} />
                    <Selecao
                      rotulo="Pagos"
                      valor={form.freqDividendos}
                      aoMudar={(v) => mudar('freqDividendos')(v as Frequencia)}
                      opcoes={OPCOES_FREQ_DIVIDENDOS}
                    />
                  </Par>
                  <div className="sim-caixa">
                    <Caixa rotulo="Reinvestir os dividendos" marcado={form.reinvestir} aoMudar={mudar('reinvestir')} />
                  </div>
                  {campoDuracao}
                  <Campo rotulo="Custo de cada compra (% corretagem e B3)" valor={form.custoCompra} aoMudar={mudar('custoCompra')} />
                  {camposDeposito}
                </div>
                <Nota>
                  *Valorização é só a alta do preço; os dividendos vêm à parte. Oscilação é o quanto o retorno varia de um ano
                  para outro (desvio-padrão): ela não muda o cálculo fixo, só a faixa de resultados.
                </Nota>
                <Nota>
                  *Sem oscilação, o cálculo usa a valorização todos os meses (juros compostos mensais). O custo de compra vale
                  para o valor inicial, os depósitos e os dividendos reinvestidos.
                </Nota>
              </>
            ) : (
              <>
                <div className="sim-grade">
                  <Campo rotulo="Valor inicial (R$)" valor={form.valorInicial} aoMudar={mudar('valorInicial')} />
                  <div>
                    <Par>
                      <Campo rotulo="Taxa de juros (%)" valor={form.taxa} aoMudar={mudar('taxa')} />
                      <Selecao
                        rotulo="A taxa de juros é"
                        valor={form.taxaPeriodo}
                        aoMudar={(v) => mudar('taxaPeriodo')(v as 'mensal' | 'anual')}
                        opcoes={[
                          { valor: 'mensal', rotulo: 'Mensal' },
                          { valor: 'anual', rotulo: 'Anual' },
                        ]}
                      />
                    </Par>
                    {selic && (
                      <p className="sim-dica">
                        Selic hoje: {pct(selic.taxa)} ao ano.{' '}
                        <button type="button" className="sim-link" onClick={usarSelic}>
                          Usar
                        </button>
                      </p>
                    )}
                  </div>
                  {campoDuracao}
                  {avancado ? (
                    <>
                      <Selecao
                        rotulo="Tipo de ano"
                        valor={form.diasNoAno}
                        aoMudar={(v) => mudar('diasNoAno')(v as '360' | '365')}
                        opcoes={[
                          { valor: '365', rotulo: 'Anos com 365 dias' },
                          { valor: '360', rotulo: 'Anos com 360 dias' },
                        ]}
                      />
                      <Selecao
                        rotulo="Frequência de capitalização"
                        valor={form.capitalizacao}
                        aoMudar={(v) => mudar('capitalizacao')(v as Frequencia)}
                        opcoes={opcoesCapitalizacao(form.diasNoAno)}
                      />
                      <Selecao
                        rotulo="Como ler a taxa"
                        valor={form.tipoTaxa}
                        aoMudar={(v) => mudar('tipoTaxa')(v as 'nominal' | 'efetiva')}
                        opcoes={[
                          { valor: 'nominal', rotulo: 'Nominal (dividida pela capitalização)' },
                          { valor: 'efetiva', rotulo: 'Efetiva (juros sobre juros equivalentes)' },
                        ]}
                      />
                    </>
                  ) : (
                    camposDeposito
                  )}
                </div>
                {avancado ? (
                  <>
                    <Nota>*Juros são pagos no mesmo cronograma da frequência de capitalização.</Nota>
                    <Nota>
                      *Taxa nominal: 12% ao ano com capitalização mensal vira 1% ao mês (como no app de referência). Taxa
                      efetiva: 12% ao ano rendem exatamente 12% em um ano, como o CDI e o Tesouro.
                    </Nota>
                  </>
                ) : (
                  <Nota>*Os cálculos do modo básico assumem meses de 30 dias e uma frequência de capitalização mensal.</Nota>
                )}
              </>
            )}
          </Cartao>

          {avancado && (
            <Cartao titulo="Depósitos e retiradas">
              {form.fluxos.length === 0 && <p className="sim-dica">Nenhum depósito ou retirada. Use os botões abaixo.</p>}
              <div className="sim-fluxos">
                {form.fluxos.map((f) => {
                  contagem[f.tipo]++;
                  return (
                    <CartaoFluxo
                      key={f.id}
                      fluxo={f}
                      numero={contagem[f.tipo]}
                      aoMudar={(novo) => mudarFluxo(f.id, novo)}
                      aoRemover={() => setForm((x) => ({ ...x, fluxos: x.fluxos.filter((y) => y.id !== f.id) }))}
                    />
                  );
                })}
              </div>
              <div className="sim-botoes">
                <Botao variante="secundario" aoClicar={() => setForm((x) => ({ ...x, fluxos: [...x.fluxos, novoFluxo('deposito')] }))}>
                  + Depósito
                </Botao>
                <Botao variante="secundario" aoClicar={() => setForm((x) => ({ ...x, fluxos: [...x.fluxos, novoFluxo('retirada')] }))}>
                  + Retirada
                </Botao>
              </div>
              <Nota>
                *"Começa após" e "Termina no mês" contam a partir do início da simulação (vazio = do começo ao fim). O aumento anual
                vale a cada 12 meses desde o primeiro depósito ou retirada. Retirada maior que o saldo leva só o que houver.
              </Nota>
            </Cartao>
          )}

          <Cartao titulo="Inflação, imposto e taxas">
            <div className="sim-grade">
              <div>
                <Campo rotulo="Previsão de inflação (% ao ano)" valor={form.inflacao} aoMudar={mudar('inflacao')} />
                <p className="sim-dica">
                  {ipca ? (
                    <>
                      IPCA dos últimos 12 meses: {pct(ipca.taxa)} (até {mesDoAno(ipca.ate)}).{' '}
                      {form.inflacao !== percentualParaCampo(ipca.taxa) && (
                        <button type="button" className="sim-link" onClick={() => mudar('inflacao')(percentualParaCampo(ipca.taxa))}>
                          Usar
                        </button>
                      )}
                    </>
                  ) : indices.carregando ? (
                    'Buscando o IPCA...'
                  ) : (
                    `Sem o IPCA no sistema: sugestão de ${percentualParaCampo(INFLACAO_RESERVA / 100)}% ao ano. Deixe vazio para não considerar.`
                  )}
                </p>
              </div>
              {variavel ? (
                <div className="sim-caixa">
                  <Caixa rotulo="Considerar o imposto de renda" marcado={form.rvImposto} aoMudar={mudar('rvImposto')} />
                </div>
              ) : (
                <Selecao
                  rotulo="Imposto de renda"
                  valor={form.imposto}
                  aoMudar={(v) => mudar('imposto')(v as Formulario['imposto'])}
                  opcoes={OPCOES_IMPOSTO}
                />
              )}
              <Campo
                rotulo={variavel ? 'Taxa de administração ou custódia (% ao ano; ETFs)' : 'Taxa de administração ou custódia (% ao ano)'}
                valor={form.taxaAdm}
                aoMudar={mudar('taxaAdm')}
              />
            </div>
            {variavel && form.rvImposto && (
              <Nota>{NOTA_IMPOSTO_ATIVO[form.ativo]} Prejuízos não são compensados na simulação.</Nota>
            )}
            {!variavel && form.imposto === 'regressiva' && (
              <Nota>
                *IR sobre o ganho de cada depósito, pelo tempo aplicado: 22,5% até 180 dias, 20% até 360, 17,5% até 720 e 15% acima.
                Não inclui IOF (resgates com menos de 30 dias) nem come-cotas.
              </Nota>
            )}
          </Cartao>
        </div>

        <div className="sim-saida">
          {typeof entrada === 'string' && <Aviso tipo="info">{entrada}</Aviso>}

          {resultado && (
            <Cartao titulo={variavel ? 'Resultados (sem oscilação)' : 'Resultados'}>
              <div className="sim-destaque">
                <span>Saldo final{temIR ? ' (bruto)' : ''}</span>
                <strong>{formatarReais(resultado.saldoFinal)}</strong>
                {temIR && (
                  <span>
                    Líquido de IR: <strong>{formatarReais(resultado.saldoLiquido)}</strong>
                  </span>
                )}
              </div>
              <dl className="sim-numeros">
                <Numero rotulo="Total investido" valor={formatarReais(resultado.totalInvestido)} />
                <Numero
                  rotulo={variavel ? 'Valorização total' : 'Juros totais recebidos'}
                  valor={formatarReais(resultado.jurosTotais)}
                />
                <Numero rotulo="Total de depósitos" valor={formatarReais(resultado.totalDepositos)} />
                <Numero
                  rotulo={variavel ? 'Retorno anual esperado' : 'Taxa anual efetiva'}
                  valor={pct(resultado.taxaAnualEfetiva, 3)}
                />
                {temDividendos && <Numero rotulo="Dividendos" valor={formatarReais(resultado.dividendos)} />}
                {resultado.dividendosRecebidos > 0 && (
                  <Numero rotulo="Dividendos recebidos (não reinvestidos)" valor={formatarReais(resultado.dividendosRecebidos)} />
                )}
                {temRetiradas && <Numero rotulo="Total de retiradas" valor={formatarReais(resultado.totalRetiradas)} />}
                {resultado.taxasPagas > 0 && <Numero rotulo="Taxa de administração paga" valor={formatarReais(resultado.taxasPagas)} />}
                {resultado.custosCompra > 0 && <Numero rotulo="Custos de compra" valor={formatarReais(resultado.custosCompra)} />}
                {resultado.taxasPagas > 0 && (
                  <Numero rotulo="Rendimento anual após a taxa" valor={pct(resultado.taxaAnualLiquidaDeTaxas, 3)} />
                )}
                {temIR && <Numero rotulo="IR no resgate (estimado)" valor={formatarReais(resultado.irFinal)} />}
                {temIR && temRetiradas && <Numero rotulo="IR retido nas retiradas" valor={formatarReais(resultado.irRetiradas)} />}
              </dl>
              {resultado.esgotouNoMes !== null && (
                <Aviso tipo="erro">
                  As retiradas zeram o saldo no mês {resultado.esgotouNoMes} ({duracaoEmTexto(resultado.esgotouNoMes)}).
                </Aviso>
              )}
            </Cartao>
          )}

          {resultado && temInflacao && resultado.saldoLiquidoReal !== null && (
            <Cartao titulo="Em valor de hoje">
              <div className="resumo">
                <ResumoItem
                  icone="calendario"
                  cor="laranja"
                  valor={formatarReais(resultado.saldoLiquidoReal)}
                  rotulo={temIR ? 'Saldo líquido em valor de hoje' : 'Saldo final em valor de hoje'}
                />
                <ResumoItem
                  icone="grafico"
                  cor={(resultado.ganhoReal ?? 0) >= 0 ? 'verde' : 'vermelho'}
                  valor={formatarReais(resultado.ganhoReal ?? 0)}
                  rotulo="Ganho real (acima da inflação)"
                />
                <ResumoItem
                  icone="investimentos"
                  cor={(resultado.taxaRealAnual ?? 0) >= 0 ? 'azul' : 'vermelho'}
                  valor={pct(resultado.taxaRealAnual ?? 0)}
                  rotulo={variavel ? 'Retorno real ao ano (antes do IR)' : 'Juro real ao ano (antes do IR)'}
                />
              </div>
              <Nota>
                *Com inflação de {pct(resultado.inflacaoAnual ?? 0)} ao ano. O ganho real compara o saldo de hoje com o que entrou
                (valor inicial e depósitos, menos retiradas{resultado.dividendosRecebidos > 0 ? ' e dividendos recebidos' : ''}),
                cada um corrigido para o valor de hoje.
              </Nota>
            </Cartao>
          )}

          {variavel && typeof entrada !== 'string' && entrada.volatilidade > 0 && (
            <Cartao titulo="Faixa de resultados">
              {faixa ? (
                <>
                  <dl className="sim-numeros sim-faixa-numeros">
                    <Numero rotulo="Pessimista (10% piores)" valor={formatarReais(faixa.final.p10)} />
                    <Numero rotulo="Mediano" valor={formatarReais(faixa.final.p50)} />
                    <Numero rotulo="Otimista (10% melhores)" valor={formatarReais(faixa.final.p90)} />
                    <Numero rotulo="Chance de terminar com menos do que aplicou" valor={pct(faixa.chancePerda, 0)} />
                    {faixa.chanceMeta !== null && <Numero rotulo="Chance de chegar à meta" valor={pct(faixa.chanceMeta, 0)} />}
                  </dl>
                  <Nota>
                    *{faixa.caminhos.toLocaleString('pt-BR')} simulações com oscilação de {pct(entrada.volatilidade, 1)} ao ano.
                    Valores {temIR ? 'líquidos de IR' : 'finais'}
                    {medidaMeta === 'liquidoReal' ? ', em valor de hoje' : ''}. O mediano costuma ficar abaixo do cálculo fixo: as
                    quedas pesam mais que as altas do mesmo tamanho.
                  </Nota>
                </>
              ) : (
                <p className="sim-dica">Calculando as simulações...</p>
              )}
              {calculandoFaixa && faixa && <p className="sim-dica">Atualizando...</p>}
            </Cartao>
          )}
        </div>
      </div>

      {resultado && pontosGrafico && (
        <div className="sim-graficos">
          <Cartao titulo="Evolução do saldo">
            <GraficoLinhas
              rotulos={pontosGrafico.pontos.map((p) => p.rotulo)}
              series={[
                { nome: 'Saldo', cor: 'var(--cor-primaria)', valores: pontosGrafico.pontos.map((p) => p.saldo) },
                ...(temInflacao
                  ? [{ nome: 'Saldo em valor de hoje', cor: 'var(--cor-laranja)', valores: pontosGrafico.pontos.map((p) => p.real) }]
                  : []),
                { nome: 'Dinheiro aplicado', cor: 'var(--cor-texto-suave)', valores: pontosGrafico.pontos.map((p) => p.aportado) },
              ]}
              formato={formatarEixo}
              area
              descricao="Saldo, saldo em valor de hoje e dinheiro aplicado ao longo do tempo."
            />
            <Nota>{pontosGrafico.emMeses ? 'Eixo em meses.' : 'Eixo em anos.'}</Nota>
          </Cartao>
          <Cartao titulo={variavel ? 'Aportes x rendimento' : 'Aportes x juros'}>
            <GraficoBarras
              rotulos={pontosGrafico.pontos.slice(1).map((p) => p.rotulo)}
              series={[
                {
                  nome: 'Dinheiro aplicado',
                  cor: 'var(--cor-primaria)',
                  valores: pontosGrafico.pontos.slice(1).map((p) => Math.max(0, Math.min(p.aportado, p.saldo))),
                },
                {
                  nome: variavel ? 'Valorização e dividendos' : 'Juros',
                  cor: 'var(--cor-verde)',
                  valores: pontosGrafico.pontos.slice(1).map((p) => Math.max(0, p.saldo - Math.max(0, p.aportado))),
                },
              ]}
              formato={formatarEixo}
              empilhar
              descricao="Quanto do saldo é dinheiro aplicado e quanto é rendimento."
            />
          </Cartao>
          {faixa && resultado && (
            <Cartao titulo="Faixa do saldo ao longo do tempo">
              <GraficoLinhas
                rotulos={faixa.mesesPorPonto.map((m) => rotuloPonto(m, pontosGrafico.emMeses))}
                series={[
                  { nome: 'Otimista', cor: 'var(--cor-verde)', valores: faixa.p90 },
                  { nome: 'Mediano', cor: 'var(--cor-primaria)', valores: faixa.p50 },
                  { nome: 'Pessimista', cor: 'var(--cor-perigo)', valores: faixa.p10 },
                  {
                    nome: 'Sem oscilação',
                    cor: 'var(--cor-texto-suave)',
                    valores: faixa.mesesPorPonto.map((m) => (m === 0 ? resultado.totalInvestido : resultado.saldosMes[m - 1])),
                  },
                ]}
                formato={formatarEixo}
                descricao="Saldo bruto nos cenários pessimista, mediano e otimista, e no cálculo sem oscilação."
              />
              <Nota>*Saldo bruto em cada momento: 10% dos caminhos ficam abaixo da linha pessimista e 10% acima da otimista.</Nota>
            </Cartao>
          )}
        </div>
      )}

      {resultado && cenarios && (
        <>
          <h2 className="sim-subtitulo">Cenários</h2>
          <div className="sim-cenarios">
            {cenarios.map((c) => (
              <Cartao key={c.rotulo} titulo={c.rotulo}>
                <p>
                  {variavel ? 'Valorização' : 'Taxa efetiva'}: {pct(c.efetiva)} ao ano
                </p>
                <p>
                  {temIR ? 'Saldo líquido' : 'Saldo final'}: <strong>{formatarReais(c.res.saldoLiquido)}</strong>
                </p>
                <p>
                  {nomeJuros}: {formatarReais(c.res.jurosTotais)}
                </p>
                {c.res.saldoLiquidoReal !== null && <p>Em valor de hoje: {formatarReais(c.res.saldoLiquidoReal)}</p>}
              </Cartao>
            ))}
          </div>
        </>
      )}

      {resultado && (
        <Cartao titulo="Meta">
          <div className="sim-grade">
            <Campo rotulo="Quero chegar a (R$)" valor={form.metaValor} aoMudar={mudar('metaValor')} />
            {temInflacao && (
              <div className="sim-caixa">
                <Caixa rotulo="Valor em dinheiro de hoje (descontar a inflação)" marcado={form.metaReal} aoMudar={mudar('metaReal')} />
              </div>
            )}
          </div>
          {meta && metaValor !== null && (
            <div className="sim-metas">
              <div className="sim-meta">
                <span className="sim-meta-titulo">
                  {avancado ? 'Depósito mensal a mais (além dos informados)' : 'Depósito mensal necessário'}
                </span>
                {meta.deposito === null ? (
                  <strong>Não dá para chegar com depósitos mensais neste prazo.</strong>
                ) : meta.deposito === 0 ? (
                  <strong>{avancado ? 'Você já chega lá sem depósito a mais.' : 'Você já chega lá sem depositar.'}</strong>
                ) : (
                  <>
                    <strong>{formatarReais(meta.deposito)} por mês</strong>
                    <span className="sim-dica">
                      Por {duracaoEmTexto(typeof entrada === 'string' ? 0 : entrada.params.meses)}, no{' '}
                      {avancado ? 'início' : form.momentoBasico === 'inicio' ? 'início' : 'fim'} de cada mês.
                    </span>
                    <button type="button" className="sim-link" onClick={() => usarDepositoDaMeta(meta.deposito ?? 0)}>
                      {avancado ? 'Adicionar este depósito' : 'Usar este valor'}
                    </button>
                  </>
                )}
              </div>
              <div className="sim-meta">
                <span className="sim-meta-titulo">Em quanto tempo, com os valores de agora</span>
                {meta.meses === null ? (
                  <strong>Não chega em 100 anos.</strong>
                ) : (
                  <>
                    <strong>{duracaoEmTexto(meta.meses)}</strong>
                    <span className="sim-dica">Mês {meta.meses} da simulação, mantendo os depósitos e retiradas.</span>
                  </>
                )}
              </div>
              {faixa && faixa.chanceMeta !== null && (
                <div className="sim-meta">
                  <span className="sim-meta-titulo">Chance de chegar, com a oscilação</span>
                  <strong>{pct(faixa.chanceMeta, 0)}</strong>
                  <span className="sim-dica">No prazo informado, em {faixa.caminhos.toLocaleString('pt-BR')} simulações.</span>
                </div>
              )}
            </div>
          )}
          <Nota>
            *A meta compara com o saldo {temIR ? 'líquido de IR' : 'final'}
            {form.metaReal && temInflacao ? ', em valor de hoje' : ''}
            {variavel ? ', no cálculo sem oscilação' : ''}.
          </Nota>
        </Cartao>
      )}

      {resultado && (
        <Cartao titulo="Tabela">
          <Abas
            abas={[
              { id: 'anos', rotulo: 'Ano a ano' },
              { id: 'meses', rotulo: 'Mês a mês' },
            ]}
            ativa={visaoTabela}
            aoMudar={(id) => setVisaoTabela(id as 'anos' | 'meses')}
          />
          {visaoTabela === 'meses' && anosNaTabela > 1 && (
            <div className="sim-ano-tabela">
              <Selecao
                rotulo="Ano"
                valor={anoTabela}
                aoMudar={setAnoTabela}
                opcoes={Array.from({ length: anosNaTabela }, (_, i) => ({ valor: String(i + 1), rotulo: `Ano ${i + 1}` }))}
              />
            </div>
          )}
          <Tabela colunas={colunas} dados={linhasTabela} chave={(l) => l.chave} vazio="Sem períodos para mostrar." />
        </Cartao>
      )}

      <Aviso tipo="info">
        Isto é só uma simulação. {variavel ? 'Renda variável não tem rendimento garantido: o passado não garante o futuro. ' : ''}
        Não é previsão nem recomendação de investimento.
      </Aviso>
    </Pagina>
  );
}
