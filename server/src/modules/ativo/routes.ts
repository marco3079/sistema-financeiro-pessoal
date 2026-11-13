import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam } from '../../lib/erros';
import { arredondar, dataISO, hoje, num, numOuNulo } from '../../lib/financas';

// Ficha de um ativo: preço ao longo do tempo, compras e vendas, proventos e eventos (desdobramentos, bonificações).
// Só leitura. O perfil financeiro vem da requisição (filtro automático em lib/prisma.ts): ativo de outro perfil é 404.

const router = Router();

const MAXIMO_PONTOS = 400;
// Código de negociação na B3 (ex.: PETR4, HGLG11). Só esses têm histórico de preço no Yahoo.
const CODIGO_NEGOCIADO = /^[A-Z]{4}\d{1,2}$/;

// Escolhe no máximo `maximo` itens espalhados pela lista, incluindo o primeiro e o último.
function amostrar<T>(lista: T[], maximo: number): T[] {
  if (lista.length <= maximo) return lista;
  const saida: T[] = [];
  for (let k = 0; k < maximo; k++) {
    saida.push(lista[Math.round((k * (lista.length - 1)) / (maximo - 1))]);
  }
  return saida;
}

router.get(
  '/ativo/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const investimento = await prisma.investimento.findFirst({ where: { id } });
    if (!investimento) throw new HttpError(404, 'Ativo não encontrado');

    const [movimentosBanco, eventosBanco] = await Promise.all([
      prisma.movimentoInvestimento.findMany({
        where: { investimentoId: id },
        orderBy: [{ data: 'asc' }, { id: 'asc' }],
      }),
      prisma.eventoAtivo.findMany({
        where: { investimentoId: id },
        orderBy: [{ data: 'asc' }, { id: 'asc' }],
      }),
    ]);

    const quantidade = numOuNulo(investimento.quantidade);
    const valorAplicado = arredondar(num(investimento.valorAplicado));
    const saldo = arredondar(num(investimento.saldo));
    // Preço médio = valor aplicado / quantidade em mãos; sem quantidade positiva, não há preço médio.
    const precoMedio = quantidade !== null && quantidade > 0 ? arredondar(num(investimento.valorAplicado) / quantidade) : null;

    // Preços: a partir da primeira aplicação (compra) até hoje, em no máximo 400 pontos.
    const codigo = (investimento.codigo ?? '').trim().toUpperCase();
    const primeiraCompra = movimentosBanco.find((m) => m.tipo === 'APLICACAO');
    let precos: { datas: string[]; valores: number[] } = { datas: [], valores: [] };
    if (CODIGO_NEGOCIADO.test(codigo) && primeiraCompra) {
      const pontos = await prisma.precoAtivo.findMany({
        where: { codigo, data: { gte: primeiraCompra.data } },
        orderBy: { data: 'asc' },
        select: { data: true, valor: true },
      });
      const escolhidos = amostrar(pontos, MAXIMO_PONTOS);
      precos = {
        datas: escolhidos.map((p) => dataISO(p.data)),
        valores: escolhidos.map((p) => arredondar(p.valor)),
      };
    }

    const movimentos = movimentosBanco.map((m) => ({
      data: dataISO(m.data),
      tipo: m.tipo,
      valor: arredondar(num(m.valor)),
      quantidade: numOuNulo(m.quantidade),
      descricao: m.descricao,
    }));

    // Proventos = movimentos de rendimento (dividendos, juros, rendimentos de fundo).
    const hojeData = hoje();
    const hojeTexto = dataISO(hojeData);
    const umAnoAtras = new Date(hojeData);
    umAnoAtras.setUTCFullYear(umAnoAtras.getUTCFullYear() - 1);
    const corteTexto = dataISO(umAnoAtras);

    const porAno = new Map<number, number>();
    let doze = 0;
    for (const m of movimentosBanco) {
      if (m.tipo !== 'RENDIMENTO') continue;
      const texto = dataISO(m.data);
      const valor = num(m.valor);
      const ano = Number(texto.slice(0, 4));
      porAno.set(ano, (porAno.get(ano) ?? 0) + valor);
      if (texto > corteTexto && texto <= hojeTexto) doze += valor;
    }
    const proventosPorAno = [...porAno.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([ano, total]) => ({ ano, total: arredondar(total) }));
    const proventosDozeMeses = arredondar(doze);
    // Percentual dos proventos de 12 meses sobre o valor aplicado, com uma casa decimal; null sem valor aplicado.
    const rendimentoSobreOCusto = num(investimento.valorAplicado) > 0 ? Math.round((doze / num(investimento.valorAplicado)) * 1000) / 10 : null;

    const eventos = eventosBanco.map((e) => ({ data: dataISO(e.data), tipo: e.tipo, fator: e.fator }));

    res.json({
      investimento: {
        id: investimento.id,
        nome: investimento.nome,
        codigo: investimento.codigo,
        tipo: investimento.tipo,
        quantidade,
        valorAplicado,
        saldo,
        precoMedio,
      },
      precos,
      movimentos,
      proventosPorAno,
      proventosDozeMeses,
      rendimentoSobreOCusto,
      eventos,
    });
  })
);

export default router;
