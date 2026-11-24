import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import {
  arredondar,
  dataISO,
  hoje,
  inteiroQuery,
  intervaloDoMes,
  mesAtual,
  mesDe,
  mesSchema,
  num,
  somarMeses,
  textoQuery,
} from '../../lib/financas';
import { listarTitulosDTO } from '../../lib/titulos';
import type { TituloDTO } from '../../lib/titulos';

// Relatórios da empresa: painel, fluxo de caixa, DRE, vencidos, indicadores e orçado x realizado.
// "Realizado" = lançamentos em regime de caixa (sem transferências, proventos e ocultos).
// "Previsto" = títulos não cancelados com saldo, pelo vencimento.

const router = Router();

const DIA_MS = 24 * 60 * 60 * 1000;

const REALIZADO = { transferencia: false, provento: false, oculto: false } as const;

// ---------- Grupos da DRE ----------

const GRUPOS_DRE = ['RECEITA', 'DEDUCAO', 'CUSTO', 'DESPESA', 'FINANCEIRO', 'IMPOSTO'] as const;
type GrupoDre = (typeof GRUPOS_DRE)[number];

// Grupos que aparecem positivos na DRE e são subtraídos nos totais. FINANCEIRO fica com o sinal (receita - despesa).
const SUBTRAIDOS: ReadonlySet<GrupoDre> = new Set<GrupoDre>(['DEDUCAO', 'CUSTO', 'DESPESA', 'IMPOSTO']);

const ROTULO_GRUPO: Record<GrupoDre, string> = {
  RECEITA: 'Receita bruta',
  DEDUCAO: '(-) Deduções e impostos sobre vendas',
  CUSTO: '(-) Custos',
  DESPESA: '(-) Despesas operacionais',
  FINANCEIRO: 'Resultado financeiro',
  IMPOSTO: '(-) Impostos sobre o lucro',
};

const grupoSchema = z.object({ grupoDre: z.enum(GRUPOS_DRE).nullable() });

function ehGrupoDre(valor: string | null): valor is GrupoDre {
  return valor !== null && (GRUPOS_DRE as readonly string[]).includes(valor);
}

// Grupo efetivo: o gravado; se não houver, RECEITA para categoria de receita e DESPESA para as demais.
function grupoEfetivo(tipo: string, grupoDre: string | null): GrupoDre {
  if (ehGrupoDre(grupoDre)) return grupoDre;
  return tipo === 'RECEITA' ? 'RECEITA' : 'DESPESA';
}

// ---------- Helpers ----------

function soma(valores: number[]): number {
  return valores.reduce((s, v) => s + v, 0);
}

function zeros(n: number): number[] {
  return Array.from({ length: n }, () => 0);
}

function arredondarUm(valor: number): number {
  return Math.round(valor * 10) / 10;
}

function somaSaldo(lista: TituloDTO[]): number {
  return arredondar(lista.reduce((s, t) => s + t.saldo, 0));
}

function lerAno(valor: unknown): number {
  const bruto = textoQuery(valor);
  const ano = bruto === undefined ? hoje().getUTCFullYear() : (inteiroQuery(bruto) ?? NaN);
  if (!Number.isInteger(ano) || ano < 1900 || ano > 2100) throw new HttpError(400, 'Ano inválido (use AAAA)');
  return ano;
}

// Saldo somado das contas ativas que não são cartão.
async function saldoEmContas(): Promise<number> {
  const agregado = await prisma.conta.aggregate({
    where: { ativo: true, tipo: { not: 'CARTAO' } },
    _sum: { saldo: true },
  });
  return arredondar(num(agregado._sum.saldo));
}

interface Lancamento {
  data: Date;
  valor: number;
  tipo: 'RECEITA' | 'DESPESA';
  categoria: { id: number; nome: string; tipo: string; grupoDre: string | null } | null;
}

// Lançamentos realizados de [inicio, fim) em uma única consulta.
async function lancamentosRealizados(inicio: Date, fim: Date): Promise<Lancamento[]> {
  const transacoes = await prisma.transacao.findMany({
    where: { ...REALIZADO, data: { gte: inicio, lt: fim } },
    select: {
      data: true,
      valor: true,
      tipo: true,
      categoria: { select: { id: true, nome: true, tipo: true, grupoDre: true } },
    },
  });
  return transacoes.map((t) => ({ data: t.data, valor: num(t.valor), tipo: t.tipo, categoria: t.categoria }));
}

// ---------- DRE ----------

interface CategoriaAcum {
  id: number;
  nome: string;
  meses: number[];
}

interface GrupoAcum {
  meses: number[];
  categorias: Map<number, CategoriaAcum>;
}

type AcumDre = Record<GrupoDre, GrupoAcum>;

interface LinhaDre {
  chave: string;
  rotulo: string;
  tipo: 'grupo' | 'total';
  meses: number[];
  total: number;
  categorias?: { id: number; nome: string; meses: number[]; total: number }[];
}

interface Dre {
  linhas: LinhaDre[];
  qtdReceitas: number; // lançamentos de receita (tipo RECEITA) que entram na receita bruta
}

function novoAcumulado(n: number): AcumDre {
  const grupo = (): GrupoAcum => ({ meses: zeros(n), categorias: new Map<number, CategoriaAcum>() });
  return {
    RECEITA: grupo(),
    DEDUCAO: grupo(),
    CUSTO: grupo(),
    DESPESA: grupo(),
    FINANCEIRO: grupo(),
    IMPOSTO: grupo(),
  };
}

function diferenca(a: number[], b: number[]): number[] {
  return a.map((v, i) => arredondar(v - b[i]));
}

function somaVetores(a: number[], b: number[]): number[] {
  return a.map((v, i) => arredondar(v + b[i]));
}

function totalLinha(linhas: LinhaDre[], chave: string): number {
  return linhas.find((l) => l.chave === chave)?.total ?? 0;
}

// Monta a DRE de `n` meses a partir de `inicioMes` ('AAAA-MM'), agregando em memória.
async function calcularDre(inicioMes: string, n: number): Promise<Dre> {
  const inicio = intervaloDoMes(inicioMes).inicio;
  const fim = intervaloDoMes(somarMeses(inicioMes, n - 1)).fim;
  const lancamentos = await lancamentosRealizados(inicio, fim);
  const acum = novoAcumulado(n);
  const [anoBase, mesBase] = inicioMes.split('-').map(Number);
  let qtdReceitas = 0;

  for (const l of lancamentos) {
    const indice = (l.data.getUTCFullYear() - anoBase) * 12 + (l.data.getUTCMonth() + 1 - mesBase);
    if (indice < 0 || indice >= n) continue;
    const grupo: GrupoDre = l.categoria
      ? grupoEfetivo(l.categoria.tipo, l.categoria.grupoDre)
      : l.tipo === 'RECEITA'
        ? 'RECEITA'
        : 'DESPESA';
    // Receita soma e despesa subtrai (o sinal vem do tipo do lançamento, não do grupo).
    const valorAssinado = (l.tipo === 'RECEITA' ? 1 : -1) * l.valor;
    if (grupo === 'RECEITA' && l.tipo === 'RECEITA') qtdReceitas++;

    const id = l.categoria ? l.categoria.id : 0;
    const nome = l.categoria ? l.categoria.nome : 'Sem categoria';
    const g = acum[grupo];
    g.meses[indice] += valorAssinado;
    let c = g.categorias.get(id);
    if (!c) {
      c = { id, nome, meses: zeros(n) };
      g.categorias.set(id, c);
    }
    c.meses[indice] += valorAssinado;
  }

  // Valor exibido de cada grupo: positivo nos grupos de despesa.
  const exibido = (g: GrupoDre): number[] => acum[g].meses.map((v) => arredondar(SUBTRAIDOS.has(g) ? -v : v));
  const valores: Record<GrupoDre, number[]> = {
    RECEITA: exibido('RECEITA'),
    DEDUCAO: exibido('DEDUCAO'),
    CUSTO: exibido('CUSTO'),
    DESPESA: exibido('DESPESA'),
    FINANCEIRO: exibido('FINANCEIRO'),
    IMPOSTO: exibido('IMPOSTO'),
  };

  const categoriasDe = (g: GrupoDre): NonNullable<LinhaDre['categorias']> => {
    const sinal = SUBTRAIDOS.has(g) ? -1 : 1;
    return [...acum[g].categorias.values()]
      .map((c) => {
        const meses = c.meses.map((v) => arredondar(sinal * v));
        return { id: c.id, nome: c.nome, meses, total: arredondar(soma(meses)) };
      })
      .filter((c) => c.meses.some((v) => v !== 0))
      .sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome, 'pt-BR'));
  };

  const linhaGrupo = (g: GrupoDre): LinhaDre => ({
    chave: g,
    rotulo: ROTULO_GRUPO[g],
    tipo: 'grupo',
    meses: valores[g],
    total: arredondar(soma(valores[g])),
    categorias: categoriasDe(g),
  });

  const linhaTotal = (chave: string, rotulo: string, meses: number[]): LinhaDre => ({
    chave,
    rotulo,
    tipo: 'total',
    meses,
    total: arredondar(soma(meses)),
  });

  const receitaLiquida = diferenca(valores.RECEITA, valores.DEDUCAO);
  const lucroBruto = diferenca(receitaLiquida, valores.CUSTO);
  const resultadoOperacional = diferenca(lucroBruto, valores.DESPESA);
  const resultadoAntesImpostos = somaVetores(resultadoOperacional, valores.FINANCEIRO);
  const lucroLiquido = diferenca(resultadoAntesImpostos, valores.IMPOSTO);

  return {
    qtdReceitas,
    linhas: [
      linhaGrupo('RECEITA'),
      linhaGrupo('DEDUCAO'),
      linhaTotal('RECEITA_LIQUIDA', 'Receita líquida', receitaLiquida),
      linhaGrupo('CUSTO'),
      linhaTotal('LUCRO_BRUTO', 'Lucro bruto', lucroBruto),
      linhaGrupo('DESPESA'),
      linhaTotal('RESULTADO_OPERACIONAL', 'Resultado operacional', resultadoOperacional),
      linhaGrupo('FINANCEIRO'),
      linhaTotal('RESULTADO_ANTES_IMPOSTOS', 'Resultado antes dos impostos', resultadoAntesImpostos),
      linhaGrupo('IMPOSTO'),
      linhaTotal('LUCRO_LIQUIDO', 'Lucro líquido', lucroLiquido),
    ],
  };
}

// ---------- Painel ----------

router.get(
  '/empresa/painel',
  asyncHandler(async (_req, res) => {
    const atual = mesAtual();
    const janela = Array.from({ length: 6 }, (_, i) => somarMeses(atual, i - 5));
    const inicio = intervaloDoMes(janela[0]).inicio;
    const fim = intervaloDoMes(atual).fim;

    const [lancamentos, titulos, saldo] = await Promise.all([
      lancamentosRealizados(inicio, fim),
      listarTitulosDTO({ cancelado: false }),
      saldoEmContas(),
    ]);

    const porMes = new Map<string, { receitas: number; despesas: number }>();
    for (const m of janela) porMes.set(m, { receitas: 0, despesas: 0 });
    for (const l of lancamentos) {
      const v = porMes.get(mesDe(l.data));
      if (!v) continue;
      if (l.tipo === 'RECEITA') v.receitas += l.valor;
      else v.despesas += l.valor;
    }
    const doMes = porMes.get(atual) ?? { receitas: 0, despesas: 0 };
    const receitasDoMes = arredondar(doMes.receitas);
    const despesasDoMes = arredondar(doMes.despesas);

    const abertos = titulos.filter((t) => t.saldo > 0);
    const aReceber = abertos.filter((t) => t.natureza === 'RECEBER');
    const aPagar = abertos.filter((t) => t.natureza === 'PAGAR');
    const vencidos = abertos.filter((t) => t.situacao === 'VENCIDO');

    res.json({
      saldoEmContas: saldo,
      aReceber: somaSaldo(aReceber),
      aPagar: somaSaldo(aPagar),
      vencidoAReceber: somaSaldo(vencidos.filter((t) => t.natureza === 'RECEBER')),
      vencidoAPagar: somaSaldo(vencidos.filter((t) => t.natureza === 'PAGAR')),
      receitasDoMes,
      despesasDoMes,
      resultadoDoMes: arredondar(receitasDoMes - despesasDoMes),
      proximos: abertos
        .filter((t) => t.situacao !== 'VENCIDO')
        .sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.id - b.id)
        .slice(0, 10),
      vencidos: [...vencidos].sort((a, b) => b.diasDeAtraso - a.diasDeAtraso || a.id - b.id).slice(0, 10),
      meses: janela.map((m) => {
        const v = porMes.get(m) ?? { receitas: 0, despesas: 0 };
        const receitas = arredondar(v.receitas);
        const despesas = arredondar(v.despesas);
        return { mes: m, receitas, despesas, resultado: arredondar(receitas - despesas) };
      }),
    });
  })
);

// ---------- Fluxo de caixa ----------

router.get(
  '/empresa/fluxo',
  asyncHandler(async (req, res) => {
    const dias = inteiroQuery(req.query.dias) ?? 30;
    if (dias !== 30 && dias !== 60 && dias !== 90) throw new HttpError(400, 'Use dias=30, 60 ou 90');

    const inicioHoje = hoje();
    const hojeTxt = dataISO(inicioHoje);
    const atual = mesAtual();
    const [titulos, saldoInicial] = await Promise.all([listarTitulosDTO({ cancelado: false }), saldoEmContas()]);

    // Títulos em aberto que ainda não venceram entram na projeção; os vencidos ficam de fora.
    const abertos = titulos.filter((t) => t.saldo > 0 && t.vencimento >= hojeTxt);
    const vencidos = titulos.filter((t) => t.saldo > 0 && t.situacao === 'VENCIDO');

    const mapaDias = new Map<string, { entradas: number; saidas: number }>();
    for (let k = 0; k < dias; k++) {
      mapaDias.set(dataISO(new Date(inicioHoje.getTime() + k * DIA_MS)), { entradas: 0, saidas: 0 });
    }
    for (const t of abertos) {
      const dia = mapaDias.get(t.vencimento);
      if (!dia) continue;
      if (t.natureza === 'RECEBER') dia.entradas += t.saldo;
      else dia.saidas += t.saldo;
    }

    let saldoCorrente = saldoInicial;
    const listaDias = [...mapaDias.entries()].map(([data, v]) => {
      const entradas = arredondar(v.entradas);
      const saidas = arredondar(v.saidas);
      saldoCorrente = arredondar(saldoCorrente + entradas - saidas);
      return { data, entradas, saidas, saldo: saldoCorrente };
    });

    let menorSaldo: { data: string; valor: number } | null = null;
    for (const d of listaDias) {
      if (!menorSaldo || d.saldo < menorSaldo.valor) menorSaldo = { data: d.data, valor: d.saldo };
    }

    const listaMeses: { mes: string; entradas: number; saidas: number; saldo: number }[] = [];
    let saldoMes = saldoInicial;
    for (let k = 0; k < 6; k++) {
      const mes = somarMeses(atual, k);
      let entradas = 0;
      let saidas = 0;
      for (const t of abertos) {
        if (!t.vencimento.startsWith(mes)) continue;
        if (t.natureza === 'RECEBER') entradas += t.saldo;
        else saidas += t.saldo;
      }
      const e = arredondar(entradas);
      const s = arredondar(saidas);
      saldoMes = arredondar(saldoMes + e - s);
      listaMeses.push({ mes, entradas: e, saidas: s, saldo: saldoMes });
    }

    res.json({
      saldoInicial,
      dias: listaDias,
      meses: listaMeses,
      menorSaldo: menorSaldo ?? { data: hojeTxt, valor: saldoInicial },
      vencidosNaoConsiderados: {
        aReceber: somaSaldo(vencidos.filter((t) => t.natureza === 'RECEBER')),
        aPagar: somaSaldo(vencidos.filter((t) => t.natureza === 'PAGAR')),
      },
    });
  })
);

// ---------- DRE: rotas ----------

router.get(
  '/empresa/dre',
  asyncHandler(async (req, res) => {
    const ano = lerAno(req.query.ano);
    const { linhas } = await calcularDre(`${ano}-01`, 12);
    res.json({ ano, linhas });
  })
);

router.get(
  '/empresa/dre/categorias',
  asyncHandler(async (_req, res) => {
    const categorias = await prisma.categoria.findMany({
      select: { id: true, nome: true, tipo: true, grupoDre: true },
      orderBy: { nome: 'asc' },
    });
    res.json(
      categorias.map((c) => ({
        id: c.id,
        nome: c.nome,
        tipo: c.tipo,
        grupoDre: grupoEfetivo(c.tipo, c.grupoDre),
        definido: c.grupoDre !== null,
      }))
    );
  })
);

router.put(
  '/empresa/dre/categorias/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const { grupoDre } = validar(grupoSchema, req.body);
    const existente = await prisma.categoria.findUnique({ where: { id }, select: { id: true } });
    if (!existente) throw new HttpError(404, 'Categoria não encontrada');
    const c = await prisma.categoria.update({
      where: { id },
      data: { grupoDre },
      select: { id: true, nome: true, tipo: true, grupoDre: true },
    });
    res.json({
      id: c.id,
      nome: c.nome,
      tipo: c.tipo,
      grupoDre: grupoEfetivo(c.tipo, c.grupoDre),
      definido: c.grupoDre !== null,
    });
  })
);

// ---------- Vencidos ----------

type FaixaAtraso = 'ate30' | 'de31a60' | 'de61a90' | 'acima90';

const ROTULO_FAIXA: Record<FaixaAtraso, string> = {
  ate30: 'Até 30 dias',
  de31a60: '31 a 60 dias',
  de61a90: '61 a 90 dias',
  acima90: 'Mais de 90 dias',
};

function faixaDeAtraso(dias: number): FaixaAtraso {
  if (dias <= 30) return 'ate30';
  if (dias <= 60) return 'de31a60';
  if (dias <= 90) return 'de61a90';
  return 'acima90';
}

router.get(
  '/empresa/vencidos',
  asyncHandler(async (req, res) => {
    const natureza = textoQuery(req.query.natureza);
    if (natureza !== 'PAGAR' && natureza !== 'RECEBER') {
      throw new HttpError(400, 'Informe natureza=PAGAR ou RECEBER');
    }
    const titulos = await listarTitulosDTO({ natureza, cancelado: false });
    const vencidos = titulos.filter((t) => t.saldo > 0 && t.situacao === 'VENCIDO');

    const faixas = (['ate30', 'de31a60', 'de61a90', 'acima90'] as const).map((chave) => {
      const dos = vencidos.filter((t) => faixaDeAtraso(t.diasDeAtraso) === chave);
      return { chave, rotulo: ROTULO_FAIXA[chave], quantidade: dos.length, valor: somaSaldo(dos) };
    });

    const grupos = new Map<
      string,
      { parceiroId: number | null; parceiroNome: string; quantidade: number; valor: number; maiorAtraso: number }
    >();
    for (const t of vencidos) {
      const chave = t.parceiroId === null ? 'sem' : String(t.parceiroId);
      let g = grupos.get(chave);
      if (!g) {
        g = {
          parceiroId: t.parceiroId,
          parceiroNome: t.parceiroId === null || t.parceiroNome === null ? 'Sem cadastro' : t.parceiroNome,
          quantidade: 0,
          valor: 0,
          maiorAtraso: 0,
        };
        grupos.set(chave, g);
      }
      g.quantidade += 1;
      g.valor += t.saldo;
      g.maiorAtraso = Math.max(g.maiorAtraso, t.diasDeAtraso);
    }
    const porParceiro = [...grupos.values()]
      .map((g) => ({ ...g, valor: arredondar(g.valor) }))
      .sort((a, b) => b.valor - a.valor);

    const titulosOrdenados = [...vencidos]
      .sort((a, b) => b.diasDeAtraso - a.diasDeAtraso || a.id - b.id)
      .slice(0, 500);

    res.json({
      total: somaSaldo(vencidos),
      faixas,
      porParceiro,
      titulos: titulosOrdenados,
    });
  })
);

// ---------- Indicadores ----------

// Prazo médio (dias) entre a emissão e a data da baixa, das baixas feitas no período.
async function prazoMedio(natureza: string, inicio: Date, fim: Date): Promise<number | null> {
  const baixas = await prisma.baixaTitulo.findMany({
    where: { data: { gte: inicio, lt: fim } },
    select: { tituloId: true, data: true },
  });
  if (baixas.length === 0) return null;
  const titulos = await prisma.titulo.findMany({
    where: { id: { in: [...new Set(baixas.map((b) => b.tituloId))] }, natureza },
    select: { id: true, emissao: true },
  });
  const emissaoPorId = new Map(titulos.map((t) => [t.id, t.emissao.getTime()] as const));
  const dias: number[] = [];
  for (const b of baixas) {
    const emissao = emissaoPorId.get(b.tituloId);
    if (emissao === undefined) continue;
    dias.push((b.data.getTime() - emissao) / DIA_MS);
  }
  if (dias.length === 0) return null;
  return arredondarUm(soma(dias) / dias.length);
}

router.get(
  '/empresa/indicadores',
  asyncHandler(async (req, res) => {
    const meses = inteiroQuery(req.query.meses) ?? 6;
    if (meses !== 3 && meses !== 6 && meses !== 12) throw new HttpError(400, 'Use meses=3, 6 ou 12');

    const atual = mesAtual();
    const inicioMes = somarMeses(atual, -(meses - 1));
    const inicio = intervaloDoMes(inicioMes).inicio;
    const fim = intervaloDoMes(atual).fim;

    const [dre, saldo, prazoRecebimento, prazoPagamento, titulosReceber] = await Promise.all([
      calcularDre(inicioMes, meses),
      saldoEmContas(),
      prazoMedio('RECEBER', inicio, fim),
      prazoMedio('PAGAR', inicio, fim),
      listarTitulosDTO({ natureza: 'RECEBER', cancelado: false }),
    ]);

    const receita = totalLinha(dre.linhas, 'RECEITA');
    const custos = totalLinha(dre.linhas, 'CUSTO');
    const despesas = totalLinha(dre.linhas, 'DESPESA');
    const lucro = totalLinha(dre.linhas, 'LUCRO_LIQUIDO');
    const receitaLiquida = totalLinha(dre.linhas, 'RECEITA_LIQUIDA');
    const lucroBruto = totalLinha(dre.linhas, 'LUCRO_BRUTO');

    const despesaMensalMedia = arredondar(despesas / meses);
    const margemBruta = receitaLiquida > 0 ? arredondarUm((lucroBruto / receitaLiquida) * 100) : null;
    const margemLiquida = receitaLiquida > 0 ? arredondarUm((lucro / receitaLiquida) * 100) : null;
    // Margem de contribuição = (receita líquida - custos) / receita líquida.
    const margemContribuicao = receitaLiquida > 0 ? (receitaLiquida - custos) / receitaLiquida : 0;
    const pontoDeEquilibrio = margemContribuicao > 0 ? arredondar(despesaMensalMedia / margemContribuicao) : null;

    const vencido = somaSaldo(titulosReceber.filter((t) => t.saldo > 0 && t.situacao === 'VENCIDO'));
    const aVencer = somaSaldo(titulosReceber.filter((t) => t.saldo > 0 && t.situacao !== 'VENCIDO'));
    const inadimplencia = vencido + aVencer > 0 ? arredondarUm((vencido / (vencido + aVencer)) * 100) : null;

    res.json({
      periodo: { de: dataISO(inicio), ate: dataISO(new Date(fim.getTime() - DIA_MS)) },
      receita,
      custos,
      despesas,
      lucro,
      margemBruta,
      margemLiquida,
      ticketMedio: dre.qtdReceitas > 0 ? arredondar(receita / dre.qtdReceitas) : null,
      prazoMedioRecebimento: prazoRecebimento,
      prazoMedioPagamento: prazoPagamento,
      inadimplencia,
      pontoDeEquilibrio,
      despesaMensalMedia,
      mesesDeCaixa: despesaMensalMedia > 0 ? arredondarUm(saldo / despesaMensalMedia) : null,
    });
  })
);

// ---------- Orçado x realizado ----------

router.get(
  '/empresa/orcado',
  asyncHandler(async (req, res) => {
    const mes = textoQuery(req.query.mes) ?? mesAtual();
    if (!mesSchema.safeParse(mes).success) throw new HttpError(400, 'Mês inválido (use AAAA-MM)');
    const { inicio, fim } = intervaloDoMes(mes);

    const [categorias, gastos] = await Promise.all([
      prisma.categoria.findMany({
        select: { id: true, nome: true, cor: true, tipo: true, orcamento: { select: { limite: true } } },
      }),
      prisma.transacao.groupBy({
        by: ['categoriaId', 'tipo'],
        where: { ...REALIZADO, data: { gte: inicio, lt: fim } },
        _sum: { valor: true },
      }),
    ]);

    // Realizado da categoria = lançamentos do mesmo tipo da categoria (receita em receita, despesa em despesa).
    const tipoPorCategoria = new Map(categorias.map((c) => [c.id, c.tipo] as const));
    const realizadoPorCategoria = new Map<number, number>();
    for (const g of gastos) {
      if (g.categoriaId === null) continue;
      if (tipoPorCategoria.get(g.categoriaId) !== g.tipo) continue;
      realizadoPorCategoria.set(g.categoriaId, (realizadoPorCategoria.get(g.categoriaId) ?? 0) + num(g._sum.valor));
    }

    const linhas: {
      categoriaId: number;
      categoriaNome: string;
      categoriaCor: string;
      tipo: string;
      orcado: number;
      realizado: number;
      diferenca: number;
      percentual: number | null;
    }[] = [];
    for (const c of categorias) {
      const realizado = arredondar(realizadoPorCategoria.get(c.id) ?? 0);
      if (!c.orcamento && realizado === 0) continue;
      const orcado = c.orcamento ? arredondar(num(c.orcamento.limite)) : 0;
      linhas.push({
        categoriaId: c.id,
        categoriaNome: c.nome,
        categoriaCor: c.cor,
        tipo: c.tipo,
        orcado,
        realizado,
        diferenca: arredondar(orcado - realizado),
        percentual: orcado > 0 ? arredondarUm((realizado / orcado) * 100) : null,
      });
    }
    linhas.sort(
      (a, b) =>
        (a.tipo === b.tipo ? 0 : a.tipo === 'DESPESA' ? -1 : 1) ||
        b.realizado - a.realizado ||
        a.categoriaNome.localeCompare(b.categoriaNome, 'pt-BR')
    );

    const orcadoTotal = arredondar(soma(linhas.map((l) => l.orcado)));
    const realizadoTotal = arredondar(soma(linhas.map((l) => l.realizado)));

    res.json({
      mes,
      linhas,
      totais: {
        orcado: orcadoTotal,
        realizado: realizadoTotal,
        diferenca: arredondar(orcadoTotal - realizadoTotal),
      },
    });
  })
);

export default router;
