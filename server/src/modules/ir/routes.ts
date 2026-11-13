import { Router } from 'express';
import type { MovimentoInvestimento } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError } from '../../lib/erros';
import { arredondar, dataISO, inteiroQuery, mesAtual, num, numOuNulo, textoQuery } from '../../lib/financas';

const router = Router();

type Classe = 'ACOES' | 'FII' | 'ETF';

const ORDEM_CLASSES: Classe[] = ['ACOES', 'FII', 'ETF'];
const LIMITE_ISENCAO_ACOES = 20000;
// Tolerância para comparar quantidades decimais.
const TOLERANCIA = 1e-9;
const CODIGO_BOLSA = /^[A-Z]{4}\d{1,2}$/;

// Classe fiscal do tipo de investimento; null para tipos que ficam fora do cálculo.
function classeDoTipo(tipo: string): Classe | null {
  if (tipo === 'ACAO') return 'ACOES';
  if (tipo === 'FII') return 'FII';
  if (tipo === 'ETF') return 'ETF';
  return null;
}

// 'AAAA-MM-DD' -> 'DD/MM/AAAA'.
function diaBR(iso: string): string {
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${ano}`;
}

// Compras antes de vendas no mesmo dia; depois, pelo id para manter a ordem estável.
const PRIORIDADE: Record<string, number> = { APLICACAO: 0, RESGATE: 1 };

function ordenarMovimentos(movimentos: MovimentoInvestimento[]): MovimentoInvestimento[] {
  return [...movimentos].sort((a, b) => {
    const dia = dataISO(a.data).localeCompare(dataISO(b.data));
    if (dia !== 0) return dia;
    const prioridade = (PRIORIDADE[a.tipo] ?? 2) - (PRIORIDADE[b.tipo] ?? 2);
    if (prioridade !== 0) return prioridade;
    return a.id - b.id;
  });
}

interface Venda {
  ano: number;
  mes: string; // 'AAAA-MM'
  classe: Classe;
  valor: number;
  resultado: number;
}

interface Apuracao {
  motivo: string | null; // preenchido quando o histórico do ativo está incompleto
  quantidade: number;
  custoTotal: number;
  vendas: Venda[];
}

interface EventoApuracao {
  data: Date;
  fator: number;
}

type Passo = { tipo: 'evento'; data: string; fator: number } | { tipo: 'movimento'; data: string; mov: MovimentoInvestimento };

// Eventos (desdobramento, grupamento, bonificação) entram antes dos movimentos da mesma data.
function ordenarPassos(movimentos: MovimentoInvestimento[], eventos: EventoApuracao[]): Passo[] {
  const passos: Passo[] = [
    ...eventos.map((e): Passo => ({ tipo: 'evento', data: dataISO(e.data), fator: e.fator })),
    ...ordenarMovimentos(movimentos).map((mov): Passo => ({ tipo: 'movimento', data: dataISO(mov.data), mov })),
  ];
  // sort é estável: dentro de cada data, eventos vêm antes e os movimentos mantêm a ordem já definida.
  const prioridadeEvento = (p: Passo) => (p.tipo === 'evento' ? 0 : 1);
  return passos.sort((a, b) => a.data.localeCompare(b.data) || prioridadeEvento(a) - prioridadeEvento(b));
}

// Custo médio por ativo: compras somam quantidade e custo; vendas saem pelo custo médio.
// Evento de fator f multiplica a quantidade e mantém o custo total.
// Para no primeiro problema: a partir dele o ativo fica incompleto.
function apurar(movimentos: MovimentoInvestimento[], eventos: EventoApuracao[], classe: Classe): Apuracao {
  const apuracao: Apuracao = { motivo: null, quantidade: 0, custoTotal: 0, vendas: [] };

  for (const passo of ordenarPassos(movimentos, eventos)) {
    if (passo.tipo === 'evento') {
      if (Number.isFinite(passo.fator) && passo.fator > 0 && passo.fator !== 1) {
        apuracao.quantidade *= passo.fator;
      }
      continue;
    }

    const m = passo.mov;
    if (m.tipo !== 'APLICACAO' && m.tipo !== 'RESGATE') continue;
    const data = passo.data;
    const quantidade = numOuNulo(m.quantidade);
    const valor = num(m.valor);

    if (quantidade === null || quantidade <= TOLERANCIA) {
      apuracao.motivo = `Movimento sem quantidade em ${diaBR(data)}`;
      break;
    }

    if (m.tipo === 'APLICACAO') {
      apuracao.quantidade += quantidade;
      apuracao.custoTotal += valor;
      continue;
    }

    if (quantidade > apuracao.quantidade + TOLERANCIA) {
      apuracao.motivo = `Venda de ${quantidade} em ${diaBR(data)} maior que a quantidade em mãos`;
      break;
    }

    // Aqui quantidade > 0, então a divisão é segura.
    const custoMedio = apuracao.custoTotal / apuracao.quantidade;
    const custoDaVenda = custoMedio * quantidade;
    apuracao.vendas.push({
      ano: Number(data.slice(0, 4)),
      mes: data.slice(0, 7),
      classe,
      valor,
      resultado: valor - custoDaVenda,
    });
    apuracao.quantidade -= quantidade;
    apuracao.custoTotal -= custoDaVenda;
    if (apuracao.quantidade <= TOLERANCIA) {
      apuracao.quantidade = 0;
      apuracao.custoTotal = 0;
    }
  }

  return apuracao;
}

interface ItemPosicao {
  id: number;
  codigo: string;
  nome: string;
  tipo: string;
  quantidade: number;
  custoTotal: number;
  custoMedio: number;
}

interface ItemProvento {
  id: number;
  codigo: string;
  nome: string;
  total: number;
}

// Alíquotas por classe (fração). Operações comuns: ações e ETF 15%, FII 20%.
const ALIQUOTA: Record<Classe, number> = { ACOES: 0.15, FII: 0.2, ETF: 0.15 };

interface MesImposto {
  mes: string;
  classe: Classe;
  resultado: number;
  prejuizoCompensado: number;
  base: number;
  aliquota: number;
  imposto: number;
}

// Imposto estimado por classe, mês a mês desde a primeira venda.
// Prejuízo acumulado por classe: resultado negativo soma; resultado positivo é abatido.
// Lucro de ações com vendas do mês até R$ 20 mil é isento e não consome prejuízo.
function calcularImposto(vendas: Venda[], ano: number) {
  const grupos = new Map<string, { mes: string; classe: Classe; resultado: number }>();
  const vendasAcoesDoMes = new Map<string, number>();
  for (const v of vendas) {
    const chave = `${v.mes}|${v.classe}`;
    const grupo = grupos.get(chave) ?? { mes: v.mes, classe: v.classe, resultado: 0 };
    grupo.resultado += v.resultado;
    grupos.set(chave, grupo);
    if (v.classe === 'ACOES') {
      vendasAcoesDoMes.set(v.mes, (vendasAcoesDoMes.get(v.mes) ?? 0) + v.valor);
    }
  }

  const ordemClasse = (c: Classe) => ORDEM_CLASSES.indexOf(c);
  const ordenados = Array.from(grupos.values()).sort(
    (a, b) => a.mes.localeCompare(b.mes) || ordemClasse(a.classe) - ordemClasse(b.classe)
  );

  const prejuizo: Record<Classe, number> = { ACOES: 0, FII: 0, ETF: 0 };
  const meses: MesImposto[] = [];

  for (const g of ordenados) {
    const isento = g.classe === 'ACOES' && arredondar(vendasAcoesDoMes.get(g.mes) ?? 0) <= LIMITE_ISENCAO_ACOES;
    let prejuizoCompensado = 0;
    let base = 0;

    if (g.resultado < 0) {
      prejuizo[g.classe] += -g.resultado;
    } else if (g.resultado > 0 && !isento) {
      prejuizoCompensado = Math.min(prejuizo[g.classe], g.resultado);
      prejuizo[g.classe] -= prejuizoCompensado;
      if (prejuizo[g.classe] <= TOLERANCIA) prejuizo[g.classe] = 0;
      base = g.resultado - prejuizoCompensado;
    }

    if (g.mes.slice(0, 4) !== String(ano)) continue;
    const aliquota = ALIQUOTA[g.classe];
    meses.push({
      mes: g.mes,
      classe: g.classe,
      resultado: arredondar(g.resultado),
      prejuizoCompensado: arredondar(prejuizoCompensado),
      base: arredondar(base),
      aliquota,
      imposto: arredondar(base * aliquota),
    });
  }

  return {
    meses,
    totalNoAno: arredondar(meses.reduce((soma, m) => soma + m.imposto, 0)),
    prejuizoAcumulado: {
      ACOES: arredondar(prejuizo.ACOES),
      FII: arredondar(prejuizo.FII),
      ETF: arredondar(prejuizo.ETF),
    },
  };
}

interface ItemIncompleto {
  codigo: string;
  motivo: string;
}

router.get(
  '/ir',
  asyncHandler(async (req, res) => {
    const textoAno = textoQuery(req.query.ano);
    const ano = textoAno === undefined ? Number(mesAtual().slice(0, 4)) : inteiroQuery(textoAno);
    if (ano === undefined || ano < 1900 || ano > 2200) throw new HttpError(400, 'Ano inválido');

    // Os movimentos vão até 31/12 do ano: a posição e o custo médio dependem de todo o histórico anterior.
    const fimDoAno = new Date(Date.UTC(ano + 1, 0, 1));

    const [investimentos, datas, eventosBanco] = await Promise.all([
      prisma.investimento.findMany({
        where: { tipo: { in: ['ACAO', 'FII', 'ETF'] } },
        include: { movimentos: { where: { data: { lt: fimDoAno } } } },
        orderBy: { nome: 'asc' },
      }),
      prisma.movimentoInvestimento.findMany({ distinct: ['data'], select: { data: true }, orderBy: { data: 'asc' } }),
      prisma.eventoAtivo.findMany({
        where: { data: { lt: fimDoAno } },
        select: { investimentoId: true, data: true, fator: true },
        orderBy: [{ data: 'asc' }, { id: 'asc' }],
      }),
    ]);

    const eventosPorAtivo = new Map<number, EventoApuracao[]>();
    for (const e of eventosBanco) {
      const lista = eventosPorAtivo.get(e.investimentoId) ?? [];
      lista.push({ data: e.data, fator: e.fator });
      eventosPorAtivo.set(e.investimentoId, lista);
    }

    const anos = Array.from(new Set(datas.map((d) => d.data.getUTCFullYear()))).sort((a, b) => a - b);

    const vendas: Venda[] = [];
    const todasVendas: Venda[] = [];
    const posicoes: ItemPosicao[] = [];
    const proventos: ItemProvento[] = [];
    const incompletos: ItemIncompleto[] = [];

    for (const inv of investimentos) {
      const classe = classeDoTipo(inv.tipo);
      const codigo = (inv.codigo ?? '').trim();
      if (classe === null || !CODIGO_BOLSA.test(codigo)) continue;

      const totalProventos = arredondar(
        inv.movimentos
          .filter((m) => m.tipo === 'RENDIMENTO' && m.data.getUTCFullYear() === ano)
          .reduce((soma, m) => soma + num(m.valor), 0)
      );
      if (totalProventos > 0) {
        proventos.push({ id: inv.id, codigo, nome: inv.nome, total: totalProventos });
      }

      const apuracao = apurar(inv.movimentos, eventosPorAtivo.get(inv.id) ?? [], classe);
      if (apuracao.motivo !== null) {
        incompletos.push({ codigo, motivo: apuracao.motivo });
        continue;
      }

      for (const venda of apuracao.vendas) {
        todasVendas.push(venda);
        if (venda.ano === ano) vendas.push(venda);
      }

      if (apuracao.quantidade > TOLERANCIA) {
        posicoes.push({
          id: inv.id,
          codigo,
          nome: inv.nome,
          tipo: inv.tipo,
          quantidade: Math.round(apuracao.quantidade * 1e8) / 1e8,
          custoTotal: arredondar(apuracao.custoTotal),
          custoMedio: arredondar(apuracao.custoTotal / apuracao.quantidade),
        });
      }
    }

    // Vendas agrupadas por mês e classe.
    const porMes = new Map<string, Map<Classe, { vendas: number; resultado: number }>>();
    for (const v of vendas) {
      let porClasse = porMes.get(v.mes);
      if (!porClasse) {
        porClasse = new Map();
        porMes.set(v.mes, porClasse);
      }
      const acumulado = porClasse.get(v.classe) ?? { vendas: 0, resultado: 0 };
      acumulado.vendas += v.valor;
      acumulado.resultado += v.resultado;
      porClasse.set(v.classe, acumulado);
    }

    const meses = Array.from(porMes.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([mes, porClasse]) => {
        const classes = ORDEM_CLASSES.flatMap((classe) => {
          const acumulado = porClasse.get(classe);
          return acumulado
            ? [{ classe, vendas: arredondar(acumulado.vendas), resultado: arredondar(acumulado.resultado) }]
            : [];
        });
        const vendasAcoes = arredondar(porClasse.get('ACOES')?.vendas ?? 0);
        return { mes, classes, vendasAcoes, isentoAcoes: vendasAcoes > 0 && vendasAcoes <= LIMITE_ISENCAO_ACOES };
      });

    posicoes.sort((a, b) => a.codigo.localeCompare(b.codigo));
    proventos.sort((a, b) => a.codigo.localeCompare(b.codigo));
    incompletos.sort((a, b) => a.codigo.localeCompare(b.codigo));

    res.json({
      ano,
      meses,
      posicoes,
      proventos,
      totais: {
        vendas: arredondar(vendas.reduce((soma, v) => soma + v.valor, 0)),
        resultado: arredondar(vendas.reduce((soma, v) => soma + v.resultado, 0)),
        proventos: arredondar(proventos.reduce((soma, p) => soma + p.total, 0)),
      },
      imposto: calcularImposto(todasVendas, ano),
      incompletos,
      anos,
    });
  })
);

export default router;
