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

// Custo médio por ativo: compras somam quantidade e custo; vendas saem pelo custo médio.
// Para no primeiro problema: a partir dele o ativo fica incompleto.
function apurar(movimentos: MovimentoInvestimento[], classe: Classe): Apuracao {
  const apuracao: Apuracao = { motivo: null, quantidade: 0, custoTotal: 0, vendas: [] };

  for (const m of ordenarMovimentos(movimentos)) {
    if (m.tipo !== 'APLICACAO' && m.tipo !== 'RESGATE') continue;
    const data = dataISO(m.data);
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

    const [investimentos, datas] = await Promise.all([
      prisma.investimento.findMany({
        where: { tipo: { in: ['ACAO', 'FII', 'ETF'] } },
        include: { movimentos: { where: { data: { lt: fimDoAno } } } },
        orderBy: { nome: 'asc' },
      }),
      prisma.movimentoInvestimento.findMany({ distinct: ['data'], select: { data: true }, orderBy: { data: 'asc' } }),
    ]);

    const anos = Array.from(new Set(datas.map((d) => d.data.getUTCFullYear()))).sort((a, b) => a - b);

    const vendas: Venda[] = [];
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

      const apuracao = apurar(inv.movimentos, classe);
      if (apuracao.motivo !== null) {
        incompletos.push({ codigo, motivo: apuracao.motivo });
        continue;
      }

      for (const venda of apuracao.vendas) {
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
      incompletos,
      anos,
    });
  })
);

export default router;
