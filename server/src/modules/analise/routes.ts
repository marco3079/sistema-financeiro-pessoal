import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/erros';
import { arredondar, dataISO, intervaloDoMes, mesAtual, moeda, num, somarMeses, textoQuery, totaisPatrimonio } from '../../lib/financas';
import { regraDe } from '../../lib/rendimento';

// Análise de gastos e ganhos: receitas e despesas mês a mês, por categoria, por estabelecimento, gastos que se
// repetem e uma lista de sugestões calculadas a partir dos próprios dados (gastos, receitas e investimentos).
// As sugestões descrevem o que os números mostram; não recomendam comprar nem vender ativos.

const router = Router();

type Area = 'GASTOS' | 'RECEITAS' | 'INVESTIMENTOS';
type Tom = 'alerta' | 'dica' | 'bom';

interface Sugestao {
  area: Area;
  tom: Tom;
  titulo: string;
  texto: string;
  caminho: string | null; // tela onde dá para agir
  acao: string | null; // texto do link
}

const ROTULO_TIPO: Record<string, string> = {
  RENDA_FIXA: 'renda fixa',
  FUNDO: 'fundos',
  ACAO: 'ações',
  FII: 'fundos imobiliários',
  ETF: 'ETFs',
  PREVIDENCIA: 'previdência',
  CRIPTO: 'cripto',
  OUTRO: 'outros',
};

function semParcela(descricao: string): string {
  return descricao
    .replace(/(-\s*)?(parcela|parc\.?)?\s*\d{1,2}\s*(\/|de)\s*\d{1,2}\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function pct(fracao: number): string {
  return Math.round(fracao * 100) + '%';
}

router.get(
  '/analise',
  asyncHandler(async (req, res) => {
    const pedido = Number(textoQuery(req.query.meses));
    const quantos = pedido === 3 || pedido === 6 || pedido === 24 ? pedido : 12;
    const atual = mesAtual();
    const meses = Array.from({ length: quantos }, (_, i) => somarMeses(atual, i - (quantos - 1)));
    const inicio = intervaloDoMes(meses[0]).inicio;
    const fim = intervaloDoMes(atual).fim;

    const [transacoes, semCategoria, orcamentos, metas, investimentos, totais, proventos, parcelasFuturas] = await Promise.all([
      prisma.transacao.findMany({
        where: { transferencia: false, data: { gte: inicio, lt: fim } },
        select: {
          data: true,
          valor: true,
          tipo: true,
          descricao: true,
          parcela: true,
          totalParcelas: true,
          categoria: { select: { id: true, nome: true, cor: true } },
          conta: { select: { tipo: true } },
        },
      }),
      prisma.transacao.count({ where: { transferencia: false, tipo: 'DESPESA', categoriaId: null, data: { gte: inicio, lt: fim } } }),
      prisma.orcamento.count(),
      prisma.meta.count(),
      prisma.investimento.findMany({ where: { ativo: true }, select: { id: true, nome: true, tipo: true, subtipo: true, saldo: true, taxa: true, origem: true, cotadoEm: true, codigo: true } }),
      totaisPatrimonio(),
      prisma.movimentoInvestimento.findMany({
        where: { tipo: 'RENDIMENTO', data: { gte: intervaloDoMes(somarMeses(atual, -12)).inicio, lt: intervaloDoMes(atual).inicio }, investimento: { ativo: true, tipo: { in: ['ACAO', 'FII', 'ETF'] } } },
        select: { valor: true },
      }),
      prisma.transacao.findMany({
        where: { tipo: 'DESPESA', parcela: { not: null }, totalParcelas: { not: null }, conta: { tipo: 'CARTAO', ativo: true } },
        select: { descricao: true, valor: true, parcela: true, totalParcelas: true, contaId: true },
      }),
    ]);

    // ---------- Mês a mês ----------
    const porMes = new Map(meses.map((m) => [m, { mes: m, receitas: 0, despesas: 0 }]));
    interface Grupo {
      id: number | null;
      nome: string;
      cor: string;
      total: number;
      porMes: Map<string, number>;
    }
    const categorias = { DESPESA: new Map<number, Grupo>(), RECEITA: new Map<number, Grupo>() };
    const lojas = new Map<string, { descricao: string; total: number; vezes: number; meses: Map<string, number> }>();
    let parceladoNoMes = 0;

    for (const t of transacoes) {
      const mes = dataISO(t.data).slice(0, 7);
      const valor = num(t.valor);
      const linha = porMes.get(mes);
      if (!linha) continue;
      // Crédito no cartão é estorno ou desconto: abate dos gastos do mês, não é receita.
      if (t.tipo === 'RECEITA' && t.conta.tipo === 'CARTAO') {
        linha.despesas -= valor;
        continue;
      }
      if (t.tipo === 'RECEITA') linha.receitas += valor;
      else linha.despesas += valor;

      const mapa = categorias[t.tipo];
      const chave = t.categoria?.id ?? 0;
      const grupo = mapa.get(chave) ?? {
        id: t.categoria?.id ?? null,
        nome: t.categoria?.nome ?? 'Sem categoria',
        cor: t.categoria?.cor ?? '#64748b',
        total: 0,
        porMes: new Map<string, number>(),
      };
      grupo.total += valor;
      grupo.porMes.set(mes, (grupo.porMes.get(mes) ?? 0) + valor);
      mapa.set(chave, grupo);

      if (t.tipo === 'DESPESA') {
        const nome = semParcela(t.descricao);
        const chaveLoja = nome.toLowerCase();
        const loja = lojas.get(chaveLoja) ?? { descricao: nome, total: 0, vezes: 0, meses: new Map<string, number>() };
        loja.total += valor;
        loja.vezes++;
        loja.meses.set(mes, (loja.meses.get(mes) ?? 0) + valor);
        lojas.set(chaveLoja, loja);
        if (mes === atual && t.parcela !== null) parceladoNoMes += valor;
      }
    }

    const linhas = meses.map((m) => {
      const l = porMes.get(m) ?? { mes: m, receitas: 0, despesas: 0 };
      const despesas = Math.max(0, l.despesas);
      return { mes: m, receitas: arredondar(l.receitas), despesas: arredondar(despesas), saldo: arredondar(l.receitas - despesas) };
    });
    // Meses com algum lançamento: as médias não contam os meses vazios de antes de o sistema ser usado.
    const comDados = linhas.filter((l) => l.receitas > 0 || l.despesas > 0);
    const fechados = comDados.filter((l) => l.mes < atual);
    const base = fechados.length > 0 ? fechados : comDados;
    const media = (campo: 'receitas' | 'despesas') => (base.length > 0 ? base.reduce((s, l) => s + l[campo], 0) / base.length : 0);
    const receitaMedia = media('receitas');
    const despesaMedia = media('despesas');
    const noMes = linhas[linhas.length - 1];

    // Mês de referência das comparações: o último mês fechado com dados (o mês corrente ainda está pela metade).
    const referencia = fechados.length > 0 ? fechados[fechados.length - 1].mes : null;
    const anteriores = referencia ? fechados.filter((l) => l.mes < referencia).map((l) => l.mes) : [];

    const listar = (mapa: Map<number, Grupo>, totalGeral: number) =>
      [...mapa.values()]
        .map((g) => {
          const naReferencia = referencia ? (g.porMes.get(referencia) ?? 0) : 0;
          // Com menos de dois meses anteriores a média não diz nada.
          const mediaAnterior = anteriores.length >= 2 ? anteriores.reduce((s, m) => s + (g.porMes.get(m) ?? 0), 0) / anteriores.length : null;
          return {
            id: g.id,
            nome: g.nome,
            cor: g.cor,
            total: arredondar(g.total),
            parte: totalGeral > 0 ? Math.round((g.total / totalGeral) * 1000) / 10 : 0,
            mediaMensal: arredondar(g.total / Math.max(1, comDados.length)),
            noMes: arredondar(g.porMes.get(atual) ?? 0),
            naReferencia: arredondar(naReferencia),
            mediaAnterior: mediaAnterior === null ? null : arredondar(mediaAnterior),
            variacao: mediaAnterior !== null && mediaAnterior > 0 ? Math.round((naReferencia / mediaAnterior - 1) * 1000) / 10 : null,
          };
        })
        .sort((a, b) => b.total - a.total);

    const totalDespesas = linhas.reduce((s, l) => s + l.despesas, 0);
    const totalReceitas = linhas.reduce((s, l) => s + l.receitas, 0);
    const despesasPorCategoria = listar(categorias.DESPESA, totalDespesas);
    const receitasPorCategoria = listar(categorias.RECEITA, totalReceitas);

    const maioresGastos = [...lojas.values()]
      .sort((a, b) => b.total - a.total)
      .slice(0, 10)
      .map((l) => ({ descricao: l.descricao, total: arredondar(l.total), vezes: l.vezes }));

    // Gastos que se repetem: mesma descrição em 3 meses ou mais, com valor parecido (assinaturas, mensalidades).
    const recorrentes = [...lojas.values()]
      .filter((l) => {
        if (l.meses.size < 3) return false;
        const valores = [...l.meses.values()];
        const m = valores.reduce((s, v) => s + v, 0) / valores.length;
        return valores.every((v) => Math.abs(v - m) <= m * 0.25);
      })
      .map((l) => ({ descricao: l.descricao, valorMensal: arredondar(l.total / l.meses.size), meses: l.meses.size }))
      .sort((a, b) => b.valorMensal - a.valorMensal)
      .slice(0, 15);
    const totalRecorrente = recorrentes.reduce((s, r) => s + r.valorMensal, 0);

    // Parcelas que ainda vão ser cobradas (pela última parcela conhecida de cada compra).
    const series = new Map<string, { nome: string; valor: number; ultima: number; total: number; quantas: number }>();
    for (const t of parcelasFuturas) {
      if (t.parcela === null || t.totalParcelas === null) continue;
      const chave = [t.contaId, semParcela(t.descricao).toLowerCase(), t.totalParcelas, num(t.valor).toFixed(2)].join('|');
      const s = series.get(chave);
      if (!s || t.parcela > s.ultima) series.set(chave, { nome: t.contaId + '|' + semParcela(t.descricao).toLowerCase(), valor: num(t.valor), ultima: t.parcela, total: t.totalParcelas, quantas: 1 });
      else if (t.parcela === s.ultima) s.quantas++;
    }
    let aindaParcelado = 0;
    // A primeira parcela costuma levar os centavos que sobram: é a mesma compra, fica só a série mais adiantada.
    const todas = [...series.values()];
    const validas = todas.filter(
      (s) => !todas.some((o) => o !== s && o.nome === s.nome && o.total === s.total && Math.abs(o.valor - s.valor) <= 0.1 && o.ultima > s.ultima)
    );
    for (const s of validas) aindaParcelado += s.valor * (s.total - s.ultima) * s.quantas;

    // ---------- Investimentos ----------
    const saldoInvestido = investimentos.reduce((s, i) => s + num(i.saldo), 0);
    const porClasse = new Map<string, number>();
    for (const i of investimentos) porClasse.set(i.tipo, (porClasse.get(i.tipo) ?? 0) + num(i.saldo));
    const classes = [...porClasse.entries()]
      .map(([tipo, saldo]) => ({ tipo, saldo: arredondar(saldo), parte: saldoInvestido > 0 ? Math.round((saldo / saldoInvestido) * 1000) / 10 : 0 }))
      .sort((a, b) => b.saldo - a.saldo);
    const proventosMensais = proventos.reduce((s, p) => s + num(p.valor), 0) / 12;
    const mesesDeReserva = despesaMedia > 0 ? totais.contas / despesaMedia : null;

    // ---------- Sugestões ----------
    const sugestoes: Sugestao[] = [];
    const sugerir = (area: Area, tom: Tom, titulo: string, texto: string, caminho: string | null = null, acao: string | null = null) =>
      sugestoes.push({ area, tom, titulo, texto, caminho, acao });

    if (comDados.length === 0) {
      sugerir('GASTOS', 'dica', 'Comece trazendo seus lançamentos', 'Importe a fatura do cartão e o extrato da conta para ver para onde o dinheiro vai.', '/app/importar', 'Importar arquivos');
    } else {
      for (const c of despesasPorCategoria.filter((c) => c.id !== null && c.variacao !== null && c.variacao >= 25 && c.naReferencia - (c.mediaAnterior ?? 0) >= 50).slice(0, 3)) {
        sugerir('GASTOS', 'alerta', `${c.nome} subiu ${Math.round(c.variacao ?? 0)}%`, `No último mês fechado foram ${moeda(c.naReferencia)}, contra ${moeda(c.mediaAnterior ?? 0)} de média nos meses anteriores.`, '/app/transacoes', 'Ver lançamentos');
      }
      for (const c of despesasPorCategoria.filter((c) => c.id !== null && c.variacao !== null && c.variacao <= -25 && (c.mediaAnterior ?? 0) - c.naReferencia >= 50).slice(0, 2)) {
        sugerir('GASTOS', 'bom', `${c.nome} caiu ${Math.abs(Math.round(c.variacao ?? 0))}%`, `No último mês fechado foram ${moeda(c.naReferencia)}, contra ${moeda(c.mediaAnterior ?? 0)} de média antes.`);
      }
      const maior = despesasPorCategoria.find((c) => c.id !== null);
      if (maior && maior.parte >= 30) {
        sugerir('GASTOS', 'dica', `${maior.nome} é ${pct(maior.parte / 100)} dos seus gastos`, `São ${moeda(maior.mediaMensal)} por mês em média. É a categoria em que um corte pequeno pesa mais.`, '/app/orcamento', 'Definir um limite');
      }
      if (semCategoria > 0) {
        sugerir('GASTOS', 'dica', `${semCategoria} ${semCategoria === 1 ? 'gasto sem categoria' : 'gastos sem categoria'}`, 'Classifique para os gráficos e o orçamento ficarem completos. O sistema aprende: a mesma descrição passa a entrar na categoria certa.', '/app/transacoes', 'Classificar');
      }
      if (recorrentes.length > 0) {
        sugerir('GASTOS', 'dica', `${recorrentes.length} ${recorrentes.length === 1 ? 'gasto se repete' : 'gastos se repetem'} todo mês`, `Somam cerca de ${moeda(totalRecorrente)} por mês (assinaturas e mensalidades). Vale conferir se todos ainda são usados.`);
      }
      if (aindaParcelado > 0) {
        sugerir('GASTOS', despesaMedia > 0 && aindaParcelado > despesaMedia ? 'alerta' : 'dica', `${moeda(aindaParcelado)} em parcelas a vencer`, 'É o que já está comprometido nas próximas faturas, antes de qualquer compra nova.', '/app/cartoes', 'Ver próximas faturas');
      }
      if (orcamentos === 0 && despesasPorCategoria.length > 0) {
        const nomes = despesasPorCategoria.filter((c) => c.id !== null).slice(0, 3).map((c) => c.nome);
        if (nomes.length > 0) sugerir('GASTOS', 'dica', 'Crie um orçamento', `Comece pelas maiores categorias: ${nomes.join(', ')}. O sistema avisa quando o limite estiver perto.`, '/app/orcamento', 'Criar orçamento');
      }

      if (totalReceitas === 0) {
        sugerir('RECEITAS', 'dica', 'Nenhuma receita registrada', 'Importe o extrato da conta corrente (CSV ou OFX) para o sistema ver salário e outras entradas e calcular quanto sobra.', '/app/importar', 'Importar extrato');
      } else {
        // Sem receita nos meses fechados (só no mês corrente) ainda não dá para falar em sobra.
        const taxa = receitaMedia > 0 ? (receitaMedia - despesaMedia) / receitaMedia : null;
        if (taxa === null) {
          // nada a dizer por enquanto
        } else if (taxa < 0) {
          sugerir('RECEITAS', 'alerta', 'Os gastos passam das receitas', `Em média entram ${moeda(receitaMedia)} e saem ${moeda(despesaMedia)} por mês: faltam ${moeda(despesaMedia - receitaMedia)}.`, '/app/orcamento', 'Rever o orçamento');
        } else if (taxa < 0.1) {
          sugerir('RECEITAS', 'alerta', `Sobra ${pct(taxa)} do que entra`, `Em média sobram ${moeda(receitaMedia - despesaMedia)} por mês. Uma referência comum é guardar pelo menos 10% a 20%.`, '/app/metas', 'Criar uma meta');
        } else {
          sugerir('RECEITAS', 'bom', `Você guarda ${pct(taxa)} do que entra`, `Em média sobram ${moeda(receitaMedia - despesaMedia)} por mês.`);
        }
        const fonte = receitasPorCategoria[0];
        if (fonte && fonte.parte >= 90 && receitasPorCategoria.length >= 1) {
          sugerir('RECEITAS', 'dica', `${pct(fonte.parte / 100)} da receita vem de uma fonte`, `Quase tudo entra por "${fonte.nome}". Registrar rendas extras (aluguel, freelas, proventos) mostra o quanto você depende dela.`);
        }
        const mesesNegativos = fechados.filter((l) => l.saldo < 0).length;
        if (mesesNegativos >= 2) {
          sugerir('RECEITAS', 'alerta', `${mesesNegativos} meses fecharam no vermelho`, 'Nesses meses saiu mais do que entrou. Veja no gráfico quais foram e o que pesou em cada um.');
        }
      }
      if (metas === 0) {
        sugerir('RECEITAS', 'dica', 'Defina uma meta', 'Uma meta com valor e prazo (reserva, viagem, entrada do imóvel) mostra quanto guardar por mês para chegar lá.', '/app/metas', 'Criar meta');
      }
    }

    if (investimentos.length === 0) {
      sugerir('INVESTIMENTOS', 'dica', 'Traga seus investimentos', 'Importe a planilha de movimentação da Área do Investidor da B3 ou cadastre à mão para acompanhar a carteira.', '/app/importar', 'Importar planilha da B3');
    } else {
      if (totais.contas <= 0) {
        sugerir('INVESTIMENTOS', 'dica', 'Cadastre suas contas', 'Com o saldo da conta corrente e da poupança o sistema calcula quantos meses de gastos a sua reserva cobre.', '/app/contas', 'Cadastrar conta');
      } else if (mesesDeReserva !== null) {
        if (mesesDeReserva < 3) {
          sugerir('INVESTIMENTOS', 'alerta', `Suas contas cobrem ${mesesDeReserva.toFixed(1).replace('.', ',')} ${mesesDeReserva < 2 ? 'mês' : 'meses'} de gastos`, `Há ${moeda(totais.contas)} em conta para um gasto médio de ${moeda(despesaMedia)} por mês. Uma reserva de emergência costuma ser medida em 3 a 6 meses.`, '/app/metas', 'Criar meta de reserva');
        } else {
          sugerir('INVESTIMENTOS', 'bom', `Suas contas cobrem ${Math.floor(mesesDeReserva)} meses de gastos`, `Há ${moeda(totais.contas)} em conta para um gasto médio de ${moeda(despesaMedia)} por mês.`);
        }
      }
      const maiorClasse = classes[0];
      if (maiorClasse && maiorClasse.parte >= 70 && classes.length >= 1) {
        sugerir('INVESTIMENTOS', 'dica', `${pct(maiorClasse.parte / 100)} da carteira está em ${ROTULO_TIPO[maiorClasse.tipo] ?? maiorClasse.tipo}`, 'A carteira se concentra em uma classe. Em Rendimento dá para ver como ela se saiu contra Selic, IPCA, Ibovespa e IFIX.', '/app/rendimento', 'Ver rendimento');
      }
      if (proventosMensais > 0 && despesaMedia > 0) {
        sugerir('INVESTIMENTOS', 'bom', `Os proventos pagam ${pct(proventosMensais / despesaMedia)} dos seus gastos`, `Nos últimos 12 meses entraram em média ${moeda(proventosMensais)} por mês em dividendos e rendimentos.`, '/app/rendimento', 'Ver rendimento');
      }
      const semCotacao = investimentos.filter((i) => i.origem === 'MANUAL' && (i.tipo === 'ACAO' || i.tipo === 'FII' || i.tipo === 'ETF') && i.codigo && i.cotadoEm === null).length;
      if (semCotacao > 0) {
        sugerir('INVESTIMENTOS', 'alerta', `${semCotacao} ${semCotacao === 1 ? 'ativo sem cotação' : 'ativos sem cotação'}`, 'O valor mostrado é o que você pagou, não o preço de hoje. Cole um token gratuito da brapi.dev em Importar para atualizar sozinho.', '/app/importar', 'Configurar cotações');
      }
      const semTaxa = investimentos.filter((i) => i.origem === 'MANUAL' && i.tipo === 'RENDA_FIXA' && regraDe(i) === null).length;
      if (semTaxa > 0) {
        sugerir('INVESTIMENTOS', 'dica', `${semTaxa} ${semTaxa === 1 ? 'título de renda fixa sem taxa' : 'títulos de renda fixa sem taxa'}`, 'Informe a taxa ("110% do CDI", "IPCA + 6%") para o saldo ser corrigido sozinho.', '/app/investimentos', 'Editar investimentos');
      }
      if (receitaMedia > 0 && receitaMedia - despesaMedia > 0) {
        sugerir('INVESTIMENTOS', 'dica', `Sobram ${moeda(receitaMedia - despesaMedia)} por mês`, `Em 12 meses isso soma ${moeda((receitaMedia - despesaMedia) * 12)} antes de qualquer rendimento. Uma meta ajuda a dar destino a esse valor.`, '/app/metas', 'Criar meta');
      }
    }

    res.json({
      meses: linhas,
      referencia,
      resumo: {
        receitaMedia: arredondar(receitaMedia),
        despesaMedia: arredondar(despesaMedia),
        // Sem receita registrada não dá para falar em sobra.
        sobraMedia: receitaMedia > 0 ? arredondar(receitaMedia - despesaMedia) : null,
        taxaDePoupanca: receitaMedia > 0 ? Math.round(((receitaMedia - despesaMedia) / receitaMedia) * 1000) / 10 : null,
        receitasNoMes: noMes.receitas,
        despesasNoMes: noMes.despesas,
        parceladoNoMes: arredondar(parceladoNoMes),
        aindaParcelado: arredondar(aindaParcelado),
        recorrenteMensal: arredondar(totalRecorrente),
        semCategoria,
      },
      despesasPorCategoria,
      receitasPorCategoria,
      maioresGastos,
      recorrentes,
      investimentos: {
        saldo: arredondar(saldoInvestido),
        emConta: arredondar(totais.contas),
        patrimonio: arredondar(totais.patrimonio),
        classes,
        proventosMensais: arredondar(proventosMensais),
        mesesDeReserva: mesesDeReserva === null ? null : Math.round(mesesDeReserva * 10) / 10,
      },
      sugestoes,
    });
  })
);

export default router;
