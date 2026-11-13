import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/erros';
import { arredondar, dataISO, intervaloDoMes, mesAtual, mesDe, moeda, num, somarMeses } from '../../lib/financas';

// Detector de cobranças estranhas. Só lê os lançamentos de despesa dos últimos 13 meses
// (sem contar transferências) e aponta indícios. Não grava nada e não tem tabela própria.

const router = Router();

const MESES_ANTES = 12; // 12 meses antes + o mês atual = 13 meses
const TOLERANCIA_VALOR = 0.05; // 5%
const SUBIDA_MINIMA = 0.1; // 10%

// Marca de parcela no fim do nome (já sem acento e em minúsculas): "parcela 2/5", " - 2/5", "2 de 5".
const MARCA_PARCELA = /\s*(?:-\s*)?(?:parcela\s*)?\d{1,3}\s*(?:\/|de)\s*\d{1,3}$/;

type Gravidade = 'alta' | 'media';
type TipoAlerta = 'DUPLICADA' | 'AUMENTO' | 'PARCELA_A_MAIS' | 'ASSINATURA_NOVA';

interface Lancamento {
  id: number;
  data: string;
  mes: string; // 'AAAA-MM'
  descricao: string;
  valor: number;
  contaId: number;
  contaNome: string;
  estabelecimento: string;
  parcelado: boolean;
  parcela: number | null;
  totalParcelas: number | null;
  faturaId: number | null;
}

interface ItemAlerta {
  id: number;
  data: string;
  descricao: string;
  valor: number;
  contaNome: string;
}

interface Alerta {
  tipo: TipoAlerta;
  gravidade: Gravidade;
  titulo: string;
  texto: string;
  lancamentos: ItemAlerta[];
}

const ORDEM_GRAVIDADE: Record<Gravidade, number> = { alta: 0, media: 1 };

function semAcento(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

// Nome do estabelecimento: descrição sem acento, minúsculas e sem a marca de parcela no fim.
function nomeDoEstabelecimento(descricao: string): string {
  return semAcento(descricao).replace(MARCA_PARCELA, '').replace(/\s*-\s*$/, '').replace(/\s+/g, ' ').trim();
}

function centavos(valor: number): number {
  return Math.round(valor * 100);
}

function agrupar<T>(itens: T[], chave: (item: T) => string): Map<string, T[]> {
  const mapa = new Map<string, T[]>();
  for (const item of itens) {
    const k = chave(item);
    const lista = mapa.get(k);
    if (lista) lista.push(item);
    else mapa.set(k, [item]);
  }
  return mapa;
}

function paraItem(l: Lancamento): ItemAlerta {
  return { id: l.id, data: l.data, descricao: l.descricao, valor: arredondar(l.valor), contaNome: l.contaNome };
}

async function carregarLancamentos(): Promise<Lancamento[]> {
  const atual = mesAtual();
  const inicio = intervaloDoMes(somarMeses(atual, -MESES_ANTES)).inicio;
  const fim = intervaloDoMes(atual).fim;
  const linhas = await prisma.transacao.findMany({
    where: { tipo: 'DESPESA', transferencia: false, data: { gte: inicio, lt: fim } },
    select: {
      id: true,
      data: true,
      descricao: true,
      valor: true,
      contaId: true,
      parcela: true,
      totalParcelas: true,
      faturaId: true,
      conta: { select: { nome: true } },
    },
    orderBy: [{ data: 'asc' }, { id: 'asc' }],
  });
  return linhas.map((t) => {
    const marcadaNoNome = MARCA_PARCELA.test(semAcento(t.descricao));
    return {
      id: t.id,
      data: dataISO(t.data),
      mes: mesDe(t.data),
      descricao: t.descricao,
      valor: num(t.valor),
      contaId: t.contaId,
      contaNome: t.conta.nome,
      estabelecimento: nomeDoEstabelecimento(t.descricao),
      parcelado: t.parcela !== null || t.totalParcelas !== null || marcadaNoNome,
      parcela: t.parcela,
      totalParcelas: t.totalParcelas,
      faturaId: t.faturaId,
    };
  });
}

// DUPLICADA: mesma conta, mesmo estabelecimento, mesmo valor, mesma data, sem parcela.
function regraDuplicada(lancs: Lancamento[]): Alerta[] {
  const grupos = agrupar(
    lancs.filter((l) => !l.parcelado),
    (l) => `${l.contaId}|${l.estabelecimento}|${centavos(l.valor)}|${l.data}`
  );
  const alertas: Alerta[] = [];
  for (const grupo of grupos.values()) {
    if (grupo.length < 2) continue;
    const primeiro = grupo[0];
    alertas.push({
      tipo: 'DUPLICADA',
      gravidade: 'alta',
      titulo: `Cobrança repetida: ${primeiro.descricao}`,
      texto: `${grupo.length} lançamentos iguais no mesmo dia, na mesma conta e com o mesmo valor (${moeda(
        arredondar(primeiro.valor)
      )}). Pode ser cobrança em duplicidade.`,
      lancamentos: grupo.map(paraItem),
    });
  }
  return alertas;
}

// AUMENTO: aparece em 3 meses ou mais, uma vez por mês, com valor estável nos meses anteriores
// (variação até 5% da média) e o último valor acima da média anterior em mais de 10%.
function regraAumento(lancs: Lancamento[]): Alerta[] {
  const alertas: Alerta[] = [];
  const porEstabelecimento = agrupar(
    lancs.filter((l) => !l.parcelado),
    (l) => l.estabelecimento
  );
  for (const lista of porEstabelecimento.values()) {
    const porMes = agrupar(lista, (l) => l.mes);
    if ([...porMes.values()].some((g) => g.length > 1)) continue;
    if (porMes.size < 3) continue;
    const meses = [...porMes.keys()].sort();
    const sequencia = meses.map((mes) => (porMes.get(mes) ?? [])[0]);
    const anteriores = sequencia.slice(0, -1).map((l) => l.valor);
    const minimo = Math.min(...anteriores);
    const maximo = Math.max(...anteriores);
    const media = anteriores.reduce((soma, v) => soma + v, 0) / anteriores.length;
    if (media <= 0 || (maximo - minimo) / media > TOLERANCIA_VALOR) continue;
    const ultimo = sequencia[sequencia.length - 1];
    if (ultimo.valor <= media * (1 + SUBIDA_MINIMA)) continue;
    const subida = Math.round(((ultimo.valor - media) / media) * 100);
    alertas.push({
      tipo: 'AUMENTO',
      gravidade: 'media',
      titulo: `Valor subiu: ${lista[0].descricao}`,
      texto: `Vinha em ${moeda(arredondar(media))} por mês e a última cobrança foi ${moeda(
        arredondar(ultimo.valor)
      )}, ${subida}% a mais.`,
      lancamentos: sequencia.map(paraItem),
    });
  }
  return alertas;
}

// PARCELA_A_MAIS: parcela com número maior que o total, ou a mesma parcela cobrada em faturas diferentes.
function regraParcelaAMais(lancs: Lancamento[]): Alerta[] {
  const alertas: Alerta[] = [];
  const marcados = new Set<number>();

  for (const l of lancs) {
    if (l.parcela === null || l.totalParcelas === null) continue;
    if (l.parcela <= l.totalParcelas) continue;
    marcados.add(l.id);
    alertas.push({
      tipo: 'PARCELA_A_MAIS',
      gravidade: 'alta',
      titulo: `Parcela acima do total: ${l.descricao}`,
      texto: `A parcela ${l.parcela} passa do total de ${l.totalParcelas} parcelas. Confira na fatura antes de contestar.`,
      lancamentos: [paraItem(l)],
    });
  }

  const parcelados = lancs.filter(
    (l) => l.parcela !== null && l.totalParcelas !== null && l.faturaId !== null && !marcados.has(l.id)
  );
  const grupos = agrupar(
    parcelados,
    (l) => `${l.estabelecimento}|${l.totalParcelas}|${l.parcela}|${centavos(l.valor)}`
  );
  for (const grupo of grupos.values()) {
    const faturas = new Set(grupo.map((l) => l.faturaId));
    if (faturas.size < 2) continue;
    const primeiro = grupo[0];
    alertas.push({
      tipo: 'PARCELA_A_MAIS',
      gravidade: 'alta',
      titulo: `Mesma parcela cobrada de novo: ${primeiro.descricao}`,
      texto: `A parcela ${primeiro.parcela} de ${primeiro.totalParcelas} aparece em ${faturas.size} faturas diferentes. Confira na fatura antes de contestar.`,
      lancamentos: grupo.map(paraItem),
    });
  }
  return alertas;
}

// ASSINATURA_NOVA: cobrança igual (variação até 5%) no mês atual e no anterior, e nenhuma nos 6 meses antes disso.
function regraAssinaturaNova(lancs: Lancamento[], atual: string): Alerta[] {
  const anterior = somarMeses(atual, -1);
  const inicioJanela = somarMeses(atual, -7);
  const fimJanela = somarMeses(atual, -2);
  const alertas: Alerta[] = [];

  const porEstabelecimento = agrupar(lancs, (l) => l.estabelecimento);
  for (const lista of porEstabelecimento.values()) {
    const existiuAntes = lista.some((l) => l.mes >= inicioJanela && l.mes <= fimJanela);
    if (existiuAntes) continue;
    const doAtual = lista.filter((l) => !l.parcelado && l.mes === atual);
    const doAnterior = lista.filter((l) => !l.parcelado && l.mes === anterior);
    if (doAtual.length !== 1 || doAnterior.length !== 1) continue;
    const valores = [doAnterior[0].valor, doAtual[0].valor];
    const menor = Math.min(...valores);
    const maior = Math.max(...valores);
    if (menor <= 0 || (maior - menor) / menor > TOLERANCIA_VALOR) continue;
    alertas.push({
      tipo: 'ASSINATURA_NOVA',
      gravidade: 'media',
      titulo: `Cobrança nova: ${doAtual[0].descricao}`,
      texto: `Cobrança parecida nos dois últimos meses (${moeda(arredondar(valores[0]))} e ${moeda(
        arredondar(valores[1])
      )}) e não aparecia antes. Pode ser assinatura nova ou teste grátis que virou cobrança.`,
      lancamentos: [paraItem(doAnterior[0]), paraItem(doAtual[0])],
    });
  }
  return alertas;
}

function maiorValor(alerta: Alerta): number {
  return Math.max(...alerta.lancamentos.map((l) => l.valor));
}

router.get(
  '/alertas',
  asyncHandler(async (_req, res) => {
    const lancs = await carregarLancamentos();
    const atual = mesAtual();
    const alertas = [
      ...regraDuplicada(lancs),
      ...regraAumento(lancs),
      ...regraParcelaAMais(lancs),
      ...regraAssinaturaNova(lancs, atual),
    ];
    alertas.sort(
      (a, b) => ORDEM_GRAVIDADE[a.gravidade] - ORDEM_GRAVIDADE[b.gravidade] || maiorValor(b) - maiorValor(a)
    );
    res.json({ alertas, analisados: lancs.length });
  })
);

export default router;
