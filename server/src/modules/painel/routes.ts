import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/erros';
import { patrimonioEstimado } from '../../lib/carteira';
import {
  INCLUIR_NA_TRANSACAO,
  arredondar,
  atualizarStatusDasFaturas,
  dataISO,
  hoje,
  intervaloDoMes,
  mesAtual,
  mesDe,
  moeda,
  num,
  rotuloMesCurto,
  somarMeses,
  textoQuery,
  totaisPatrimonio,
} from '../../lib/financas';

const router = Router();

interface Cartao {
  chave: string;
  rotulo: string;
  valor: string;
  icone: string;
  cor: 'azul' | 'roxo' | 'verde' | 'laranja';
  variacao: number | null;
}
interface Ponto {
  mes: string;
  rotulo: string;
  valor: number | null;
}
interface Destaque {
  etiqueta: string;
  titulo: string;
  subtitulo: string;
  caminho: string;
}
interface Recente {
  id: number;
  titulo: string;
  corpo: string;
  valor: string;
  criadoEm: string;
}
interface RespostaResumo {
  primeiroNome: string;
  cartoes: Cartao[];
  desempenho: Ponto[];
  destaque: Destaque | null;
  recentes: Recente[];
}
interface Notificacao {
  chave: string;
  titulo: string;
  meta: string;
  quando: string;
  caminho: string;
}
interface ResultadoBusca {
  tipo: string;
  titulo: string;
  subtitulo: string;
  caminho: string;
}

function variacao(atual: number, anterior: number): number | null {
  if (anterior <= 0) return null;
  return Math.round(((atual - anterior) / anterior) * 1000) / 10;
}

// Date -> 'DD/MM/AAAA'.
function dataBR(data: Date): string {
  const [ano, mes, dia] = dataISO(data).split('-');
  return `${dia}/${mes}/${ano}`;
}

// Date -> 'DD/MM'.
function dataDM(data: Date): string {
  const [, mes, dia] = dataISO(data).split('-');
  return `${dia}/${mes}`;
}

router.get(
  '/painel/resumo',
  asyncHandler(async (req, res) => {
    await atualizarStatusDasFaturas();

    const usuario = await prisma.usuario.findUnique({ where: { id: req.usuario.id }, select: { nome: true } });
    const primeiroNome = (usuario?.nome ?? '').trim().split(/\s+/)[0] ?? '';

    const t = await totaisPatrimonio();

    const mes = mesAtual();
    const meses = Array.from({ length: 12 }, (_, i) => somarMeses(mes, i - 11));
    const posicoes = await prisma.posicaoPatrimonio.findMany({
      where: { data: { gte: intervaloDoMes(somarMeses(mes, -11)).inicio } },
      orderBy: { data: 'asc' },
    });
    // Como vem em ordem crescente, a última posição de cada mês sobrescreve as anteriores.
    const porMes = new Map<string, number>();
    for (const p of posicoes) {
      porMes.set(mesDe(p.data), arredondar(num(p.contas) + num(p.investimentos) - num(p.cartoes)));
    }
    // Meses anteriores à instalação não têm fotografia: são reconstruídos pelos movimentos, preços e faturas.
    const estimado = meses.some((m) => m !== mes && !porMes.has(m)) ? await patrimonioEstimado(meses) : new Map<string, number>();
    const desempenho: Ponto[] = meses.map((m) => ({
      mes: m,
      rotulo: rotuloMesCurto(m),
      valor: m === mes ? t.patrimonio : (porMes.get(m) ?? estimado.get(m) ?? null),
    }));

    const anterior = somarMeses(mes, -1);
    const intervaloAtual = intervaloDoMes(mes);
    const intervaloAnterior = intervaloDoMes(anterior);
    const [gruposAtual, gruposAnterior] = await Promise.all([
      prisma.transacao.groupBy({
        by: ['tipo'],
        where: { transferencia: false, data: { gte: intervaloAtual.inicio, lt: intervaloAtual.fim } },
        _sum: { valor: true },
      }),
      prisma.transacao.groupBy({
        by: ['tipo'],
        where: { transferencia: false, data: { gte: intervaloAnterior.inicio, lt: intervaloAnterior.fim } },
        _sum: { valor: true },
      }),
    ]);
    const despesasMes = num(gruposAtual.find((g) => g.tipo === 'DESPESA')?._sum.valor);
    const despesasMesAnterior = num(gruposAnterior.find((g) => g.tipo === 'DESPESA')?._sum.valor);

    const patrimonioAnterior = desempenho[desempenho.length - 2]?.valor ?? 0;
    const cartoes: Cartao[] = [
      {
        chave: 'patrimonio',
        rotulo: 'Patrimônio',
        valor: moeda(t.patrimonio),
        icone: 'financeiro',
        cor: 'azul',
        variacao: variacao(t.patrimonio, patrimonioAnterior),
      },
      { chave: 'contas', rotulo: 'Saldo em contas', valor: moeda(t.contas), icone: 'contas', cor: 'verde', variacao: null },
      {
        chave: 'investimentos',
        rotulo: 'Investimentos',
        valor: moeda(t.investimentos),
        icone: 'investimentos',
        cor: 'roxo',
        variacao: null,
      },
      {
        chave: 'despesas',
        rotulo: 'Despesas do mês',
        valor: moeda(despesasMes),
        icone: 'cartao',
        cor: 'laranja',
        variacao: variacao(despesasMes, despesasMesAnterior),
      },
    ];

    let destaque: Destaque | null = null;
    const proxima = await prisma.fatura.findFirst({
      where: { status: { not: 'PAGA' }, total: { gt: 0 } },
      orderBy: { vencimento: 'asc' },
      include: { conta: { select: { nome: true } } },
    });
    if (proxima) {
      destaque = {
        etiqueta: proxima.status === 'ATRASADA' ? 'Fatura atrasada' : 'Próxima fatura',
        titulo: proxima.conta.nome + ' · ' + moeda(num(proxima.total)),
        subtitulo: 'Vencimento em ' + dataBR(proxima.vencimento),
        caminho: '/app/cartoes',
      };
    } else if ((await prisma.transacao.count()) === 0) {
      destaque = {
        etiqueta: 'Comece por aqui',
        titulo: 'Importe sua fatura',
        subtitulo: 'Envie o arquivo do banco ou a planilha da B3 e veja tudo organizado.',
        caminho: '/app/importar',
      };
    }

    // Só o que já aconteceu: parcelas futuras do cartão ficam de fora.
    const transacoes = await prisma.transacao.findMany({
      where: { data: { lte: hoje() } },
      orderBy: [{ data: 'desc' }, { id: 'desc' }],
      take: 6,
      include: INCLUIR_NA_TRANSACAO,
    });
    const recentes: Recente[] = transacoes.map((r) => ({
      id: r.id,
      titulo: r.descricao,
      corpo: r.conta.nome + ' · ' + (r.categoria?.nome ?? 'Sem categoria'),
      valor: (r.tipo === 'RECEITA' ? '+ ' : '- ') + moeda(num(r.valor)),
      criadoEm: dataISO(r.data),
    }));

    const resposta: RespostaResumo = { primeiroNome, cartoes, desempenho, destaque, recentes };
    res.json(resposta);
  })
);

router.get(
  '/notificacoes',
  asyncHandler(async (_req, res) => {
    const lista: Notificacao[] = [];

    const conexoes = await prisma.conexaoBancaria.findMany({ where: { status: { in: ['ERRO_LOGIN', 'ERRO'] } } });
    for (const c of conexoes) {
      lista.push({
        chave: 'conexao-' + c.id,
        titulo: 'Reconecte ' + c.instituicao,
        meta: c.erro ?? 'A conexão precisa de atenção',
        quando: (c.ultimaSincronizacao ?? c.criadoEm).toISOString(),
        caminho: '/app/conexoes',
      });
    }

    const hojeData = hoje();
    const limiteFaturas = new Date(hojeData.getTime() + 5 * 86400000);
    const faturas = await prisma.fatura.findMany({
      where: { status: { not: 'PAGA' }, total: { gt: 0 }, vencimento: { lte: limiteFaturas } },
      orderBy: { vencimento: 'asc' },
      include: { conta: { select: { nome: true } } },
    });
    for (const f of faturas) {
      lista.push({
        chave: 'fatura-' + f.id,
        titulo:
          f.vencimento < hojeData
            ? 'Fatura ' + f.conta.nome + ' atrasada'
            : 'Fatura ' + f.conta.nome + ' vence em ' + dataDM(f.vencimento),
        meta: moeda(num(f.total)),
        quando: f.criadoEm.toISOString(),
        caminho: '/app/cartoes',
      });
    }

    const orcamentos = await prisma.orcamento.findMany({
      include: { categoria: { select: { id: true, nome: true } } },
    });
    const intervaloMes = intervaloDoMes(mesAtual());
    const gastosPorCategoria = await prisma.transacao.groupBy({
      by: ['categoriaId'],
      where: {
        tipo: 'DESPESA',
        transferencia: false,
        data: { gte: intervaloMes.inicio, lt: intervaloMes.fim },
        categoriaId: { in: orcamentos.map((o) => o.categoriaId) },
      },
      _sum: { valor: true },
    });
    const gastos = new Map<number, number>();
    for (const g of gastosPorCategoria) {
      if (g.categoriaId !== null) gastos.set(g.categoriaId, num(g._sum.valor));
    }
    for (const o of orcamentos) {
      const gasto = gastos.get(o.categoriaId) ?? 0;
      const limite = num(o.limite);
      if (gasto > limite) {
        lista.push({
          chave: 'orcamento-' + o.categoriaId,
          titulo: 'Orçamento de ' + o.categoria.nome + ' estourado',
          meta: moeda(gasto) + ' de ' + moeda(limite),
          quando: hojeData.toISOString(),
          caminho: '/app/orcamento',
        });
      }
    }

    res.json(lista.slice(0, 20));
  })
);

router.get(
  '/busca',
  asyncHandler(async (req, res) => {
    const q = textoQuery(req.query.q);
    if (!q || q.length < 2) {
      res.json([]);
      return;
    }

    const [contas, investimentos, lancamentos, categorias] = await Promise.all([
      prisma.conta.findMany({
        where: {
          OR: [
            { nome: { contains: q, mode: 'insensitive' } },
            { instituicao: { contains: q, mode: 'insensitive' } },
          ],
        },
        take: 5,
      }),
      prisma.investimento.findMany({
        where: {
          OR: [
            { nome: { contains: q, mode: 'insensitive' } },
            { codigo: { contains: q, mode: 'insensitive' } },
          ],
        },
        take: 5,
      }),
      prisma.transacao.findMany({
        where: { descricao: { contains: q, mode: 'insensitive' } },
        orderBy: [{ data: 'desc' }, { id: 'desc' }],
        take: 6,
      }),
      prisma.categoria.findMany({
        where: { nome: { contains: q, mode: 'insensitive' } },
        take: 3,
      }),
    ]);

    const resultados: ResultadoBusca[] = [
      ...contas.map((c) => ({
        tipo: c.tipo === 'CARTAO' ? 'Cartão' : 'Conta',
        titulo: c.nome,
        subtitulo: (c.instituicao ?? 'Conta') + ' · ' + moeda(num(c.saldo)),
        caminho: c.tipo === 'CARTAO' ? '/app/cartoes' : '/app/contas',
      })),
      ...investimentos.map((i) => ({
        tipo: 'Investimento',
        titulo: i.nome,
        subtitulo: moeda(num(i.saldo)),
        caminho: '/app/investimentos',
      })),
      ...lancamentos.map((t) => ({
        tipo: 'Lançamento',
        titulo: t.descricao,
        subtitulo: dataBR(t.data) + ' · ' + moeda(num(t.valor)),
        caminho: '/app/transacoes',
      })),
      ...categorias.map((c) => ({
        tipo: 'Categoria',
        titulo: c.nome,
        subtitulo: c.tipo === 'RECEITA' ? 'Receita' : 'Despesa',
        caminho: '/app/categorias',
      })),
    ];

    res.json(resultados);
  })
);

export default router;
