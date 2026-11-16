import { Router } from 'express';
import { asyncHandler, HttpError } from '../../lib/erros';
import { arredondar, dataISO, num, textoQuery } from '../../lib/financas';
import { garantirPrecos, montarCarteira, montarProventos, ultimoPreco } from '../../lib/carteira';
import type { ClasseCarteira } from '../../lib/carteira';
import { buscarCotacao, tokenDasCotacoes } from '../../lib/cotacoes';
import { CODIGO_FII, fundosNaB3 } from '../../lib/proventosAnunciados';
import { hojeISO, somarDias } from '../../lib/indices';
import { prisma } from '../../lib/prisma';
import { fundoNaCvm } from '../../lib/cvmFii';
import { analisarFii } from '../../lib/notaFii';

// Carteira de investimentos: resumo, rentabilidade (por dia, mês e ano, contra os índices), relatório e proventos.
// O cálculo está em lib/carteira.ts.

const router = Router();

const CLASSES: ClasseCarteira[] = ['RENDA_VARIAVEL', 'RENDA_FIXA', 'FUNDOS', 'OUTROS'];

// meses: 6, 12, 24, 60 ou 0 (tudo). Padrão 24.
function mesesDaConsulta(valor: unknown): number {
  const n = Number(textoQuery(valor));
  return [0, 6, 12, 24, 60].includes(n) ? n : 24;
}

router.get(
  '/carteira',
  asyncHandler(async (req, res) => {
    const pedida = textoQuery(req.query.classe);
    const classe = CLASSES.find((c) => c === pedida) ?? 'TODAS';
    res.json(await montarCarteira({ meses: mesesDaConsulta(req.query.meses), classe, forcar: textoQuery(req.query.atualizar) === '1' }));
  })
);

router.get(
  '/carteira/proventos',
  asyncHandler(async (req, res) => {
    res.json(await montarProventos(mesesDaConsulta(req.query.meses)));
  })
);

// Valores por cota têm mais casas que reais.
function quatroCasas(valor: number): number {
  return Math.round(valor * 10000) / 10000;
}

// Ficha de um fundo imobiliário: dados públicos da B3, preço, rendimento dos últimos 12 meses e a posição da
// pessoa nele (se tiver). Serve para qualquer FII listado, não só os da carteira.
router.get(
  '/carteira/fundo/:codigo',
  asyncHandler(async (req, res) => {
    const codigo = String(req.params.codigo ?? '').trim().toUpperCase();
    if (!CODIGO_FII.test(codigo)) {
      throw new HttpError(400, 'Informe o código de um fundo imobiliário, como XPML11.');
    }
    const fundo = (await fundosNaB3([codigo])).get(codigo) ?? null;
    if (!fundo) {
      throw new HttpError(404, `A B3 não encontrou o fundo ${codigo}, ou o site dela não respondeu. Confira o código e tente de novo.`);
    }

    // Preço: brapi (com token) e, sem ela, o último fechamento do Yahoo Finance.
    let preco: number | null = null;
    let fontePreco: 'BRAPI' | 'YAHOO' | null = null;
    const credencial = await tokenDasCotacoes();
    if (credencial) {
      try {
        preco = await buscarCotacao(codigo, credencial.token);
        if (preco !== null) fontePreco = 'BRAPI';
      } catch {
        // limite do plano ou token recusado: tenta o Yahoo
      }
    }
    if (preco === null) {
      try {
        await garantirPrecos([codigo], somarDias(hojeISO(), -400));
        preco = await ultimoPreco(codigo);
        if (preco !== null) fontePreco = 'YAHOO';
      } catch {
        // sem preço
      }
    }

    const hoje = hojeISO();
    const umAnoAtras = somarDias(hoje, -365);
    const doAno = fundo.proventos.filter((p) => p.dataPagamento > umAnoAtras && p.dataPagamento <= hoje && p.tipo === 'RENDIMENTO');
    const porCota12m = doAno.reduce((s, p) => s + p.valorPorCota, 0);
    const ultimo = fundo.proventos.find((p) => p.dataPagamento <= hoje) ?? null;
    // A pagar: de hoje em diante (o de hoje ainda não entrou na conta).
    const aPagar = fundo.proventos.filter((p) => p.dataPagamento >= hoje);

    const investimento = await prisma.investimento.findFirst({
      where: { codigo, ativo: true },
      include: { movimentos: { where: { tipo: 'RENDIMENTO', data: { gt: new Date(`${umAnoAtras}T00:00:00Z`) } } } },
      orderBy: { id: 'asc' },
    });
    const quantidade = investimento ? num(investimento.quantidade) : 0;

    // Indicadores e nota: informe mensal da CVM (valor patrimonial, patrimônio, cotistas) e a cotação de 12 meses atrás.
    let cvm = await fundoNaCvm(fundo.isin, fundo.cotasEmitidas);
    // Confere se o valor patrimonial faz sentido com a cotação (P/VP entre 0,2 e 3). Se não, a ligação pegou outro
    // fundo (cotas parecidas, ou ISIN informado errado por outro fundo na CVM) e a ficha fica sem os dados da CVM.
    if (cvm) {
      const vp = cvm.meses.filter((m) => m.valorPatrimonialCota).at(-1)?.valorPatrimonialCota ?? null;
      const pvp = preco !== null && vp ? preco / vp : null;
      if (pvp === null || pvp < 0.2 || pvp > 3) cvm = null;
    }
    let preco12m: number | null = null;
    try {
      await garantirPrecos([codigo], somarDias(hoje, -400));
      const antigo = await prisma.precoAtivo.findFirst({
        where: { codigo, data: { lte: new Date(`${somarDias(hoje, -365)}T00:00:00Z`) } },
        orderBy: { data: 'desc' },
      });
      preco12m = antigo ? antigo.valor : null;
    } catch {
      // sem histórico de preço: o indicador fica sem dado
    }
    const analise = analisarFii({ fundo, cvm, preco, preco12m, hoje });

    res.json({
      fundo,
      cvm: cvm
        ? { cnpj: cvm.cnpj, nome: cvm.nome, segmento: cvm.segmento, mandato: cvm.mandato, tipoGestao: cvm.tipoGestao, administrador: cvm.administrador }
        : null,
      analise,
      preco,
      fontePreco,
      indicadores: {
        proventosPorCota12m: doAno.length > 0 ? quatroCasas(porCota12m) : null,
        pagamentos12m: doAno.length,
        rendimentoMedioMensal: doAno.length > 0 ? quatroCasas(porCota12m / 12) : null,
        dividendYield12m: preco && doAno.length > 0 ? arredondar((porCota12m / preco) * 100) : null,
        ultimoRendimento: ultimo,
        ultimoYield: preco && ultimo ? arredondar((ultimo.valorPorCota / preco) * 100) : null,
        valorDeMercado: preco && fundo.cotasEmitidas ? arredondar(preco * fundo.cotasEmitidas) : null,
      },
      aPagar,
      posicao: investimento
        ? {
            investimentoId: investimento.id,
            quantidade,
            valorAplicado: num(investimento.valorAplicado),
            saldo: num(investimento.saldo),
            precoMedio: quantidade > 0 ? quatroCasas(num(investimento.valorAplicado) / quantidade) : null,
            recebido12m: arredondar(investimento.movimentos.reduce((s, m) => s + num(m.valor), 0)),
            aReceber: arredondar(aPagar.reduce((s, p) => s + p.valorPorCota * quantidade, 0)),
            ultimaDataRecebida: investimento.movimentos.length
              ? dataISO(investimento.movimentos.reduce((a, m) => (m.data > a ? m.data : a), investimento.movimentos[0].data))
              : null,
          }
        : null,
    });
  })
);

export default router;
