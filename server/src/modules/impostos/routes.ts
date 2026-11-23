import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { dadosDoIr } from '../ir/routes';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { arredondar, dataISO, hoje, mesDe, num, numOuNulo } from '../../lib/financas';
import {
  IRPF,
  TIPOS_IOF,
  aliquotaRegressiva,
  ehCombustivel,
  ehTarifaBancaria,
  rendaFixaIsenta,
  tipoDoIof,
  TIPOS_DEDUTIVEL,
  dedutivelPeloNome,
  ehTipoDedutivel,
  impostoAnual,
  nomeDoEstabelecimento,
  TIPOS_DIRETO,
  TIPOS_GASTO,
  componentesDaCategoria,
  diretoPelaDescricao,
  ehTipoImposto,
  fatorIcmsIss,
  fatorPisCofinsIpi,
  tipoPeloNome,
  totalDosComponentes,
  ultimoDiaUtil,
} from '../../lib/impostos';
import type { Componentes, TipoIof, TipoDedutivel, TipoDireto, TipoImposto } from '../../lib/impostos';
import { ALIQUOTAS_POR_ANO, ehTratamento, impostoEmbutido, tratamentoPeloNome } from '../../lib/reformaTributaria';
import type { Tratamento } from '../../lib/reformaTributaria';

// Área Impostos: quanto do que a pessoa gasta é imposto (direto e indireto), por mês, categoria e tipo, com a
// simulação da reforma, os dias trabalhados para pagar impostos e o calendário de vencimentos. Rotas em /api/impostos.
// Os dados já chegam filtrados pelo perfil financeiro (lib/prisma.ts).

const router = Router();

const zerado = (): Componentes => ({ icms: 0, pisCofins: 0, ipi: 0, iss: 0, outros: 0 });

function somarEm(alvo: Componentes, comp: Componentes, valor: number): void {
  alvo.icms += (valor * comp.icms) / 100;
  alvo.pisCofins += (valor * comp.pisCofins) / 100;
  alvo.ipi += (valor * comp.ipi) / 100;
  alvo.iss += (valor * comp.iss) / 100;
  alvo.outros += (valor * comp.outros) / 100;
}

function arredondarComp(comp: Componentes): Componentes {
  return {
    icms: arredondar(comp.icms),
    pisCofins: arredondar(comp.pisCofins),
    ipi: arredondar(comp.ipi),
    iss: arredondar(comp.iss),
    outros: arredondar(comp.outros),
  };
}

const MS_DIA = 86_400_000;

router.get(
  '/impostos/tipos',
  asyncHandler(async (_req, res) => {
    res.json({
      tipos: Object.entries(TIPOS_GASTO).map(([id, t]) => ({ id, ...t, total: totalDosComponentes(t.componentes) })),
      diretos: Object.entries(TIPOS_DIRETO).map(([id, rotulo]) => ({ id, rotulo })),
    });
  })
);

// Calendário de vencimentos do ano: IRPF, e IPVA/IPTU pelo que a pessoa pagou (ou a época de costume, sem histórico).
export type EventoCalendario = { data: string; titulo: string; detalhe: string; valor: number | null; tipo: string; estimado: boolean; generico: boolean };

function montarCalendario(ano: number, pagos: { data: Date; descricao: string; valor: Prisma.Decimal | number }[]): EventoCalendario[] {
  const calendario: EventoCalendario[] = [];
  calendario.push({
    data: dataISO(ultimoDiaUtil(ano, 4)),
    titulo: `Declaração do IRPF ${ano} (ano-base ${ano - 1})`,
    detalhe: 'Prazo costuma terminar no último dia útil de maio. Restituição em lotes de maio a setembro.',
    valor: null,
    tipo: 'IR',
    estimado: true,
    generico: false,
  });
  for (const tipo of ['IPVA', 'IPTU'] as const) {
    const pagosDoTipo = pagos.filter((t) => diretoPelaDescricao(t.descricao) === tipo);
    const porMesPago = new Map<number, number>();
    const anoMaisRecente = pagosDoTipo.reduce((max, p) => Math.max(max, p.data.getUTCFullYear()), 0);
    for (const p of pagosDoTipo.filter((p) => p.data.getUTCFullYear() === anoMaisRecente)) {
      porMesPago.set(p.data.getUTCMonth(), (porMesPago.get(p.data.getUTCMonth()) ?? 0) + num(p.valor));
    }
    if (porMesPago.size > 0) {
      for (const [mesIndice, valor] of porMesPago) {
        calendario.push({
          data: dataISO(new Date(Date.UTC(ano, mesIndice, 10))),
          titulo: tipo,
          detalhe: anoMaisRecente === ano ? `Pago em ${ano}.` : `Pelo que você pagou em ${anoMaisRecente}; confira o boleto do ano.`,
          valor: arredondar(valor),
          tipo,
          estimado: anoMaisRecente !== ano,
          generico: false,
        });
      }
    } else {
      calendario.push({
        data: dataISO(new Date(Date.UTC(ano, tipo === 'IPVA' ? 0 : 1, tipo === 'IPVA' ? 20 : 10))),
        titulo: tipo,
        detalhe:
          tipo === 'IPVA'
            ? 'Se você tem veículo: cota única ou 1ª parcela entre janeiro e março, conforme o estado e a placa.'
            : 'Se você tem imóvel: cota única ou 1ª parcela entre fevereiro e março, conforme a prefeitura.',
        valor: null,
        tipo,
        estimado: true,
        generico: true,
      });
    }
  }
  calendario.sort((a, b) => a.data.localeCompare(b.data));
  return calendario;
}

router.get(
  '/impostos/resumo',
  asyncHandler(async (req, res) => {
    const agora = hoje();
    const anoAtual = agora.getUTCFullYear();
    const ano = Number(req.query.ano) || anoAtual;
    if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) throw new HttpError(400, 'Ano inválido');
    const inicio = new Date(Date.UTC(ano, 0, 1));
    const fimDoAno = new Date(Date.UTC(ano, 11, 31));
    // Parcelas futuras já lançadas não contam: só o que já foi pago até hoje.
    const fim = fimDoAno.getTime() > agora.getTime() ? agora : fimDoAno;
    const diasNoPeriodo = Math.max(1, Math.round((fim.getTime() - inicio.getTime()) / MS_DIA) + 1);
    const diasNoAno = Math.round((Date.UTC(ano + 1, 0, 1) - inicio.getTime()) / MS_DIA);

    const [categorias, transacoes, movimentosImposto, rendimentos, anosComDados, diretosAnteriores] = await Promise.all([
      prisma.categoria.findMany({ where: { tipo: 'DESPESA' }, orderBy: { nome: 'asc' } }),
      prisma.transacao.findMany({
        where: { transferencia: false, oculto: false, data: { gte: inicio, lte: fim } },
        select: { id: true, data: true, descricao: true, valor: true, tipo: true, categoriaId: true },
        orderBy: { data: 'asc' },
      }),
      prisma.movimentoInvestimento.findMany({
        where: { tipo: 'IMPOSTO', data: { gte: inicio, lte: fim } },
        select: { id: true, data: true, valor: true, descricao: true, investimento: { select: { nome: true, codigo: true } } },
      }),
      prisma.movimentoInvestimento.aggregate({
        where: { tipo: 'RENDIMENTO', data: { gte: inicio, lte: fim } },
        _sum: { valor: true },
      }),
      prisma.transacao.findMany({ distinct: ['data'], select: { data: true }, where: { data: { lte: agora } } }),
      // Diretos pagos nos dois anos anteriores: base do calendário (IPVA e IPTU costumam se repetir).
      prisma.transacao.findMany({
        where: {
          tipo: 'DESPESA',
          transferencia: false,
          oculto: false,
          data: { gte: new Date(Date.UTC(ano - 2, 0, 1)), lt: inicio },
        },
        select: { data: true, descricao: true, valor: true, categoriaId: true },
      }),
    ]);

    const anos = Array.from(new Set(anosComDados.map((d) => d.data.getUTCFullYear())));
    if (!anos.includes(anoAtual)) anos.push(anoAtual);
    anos.sort((a, b) => b - a);

    // Classificação de cada categoria.
    const infoCategoria = new Map<
      number,
      { nome: string; cor: string; tipo: TipoImposto; escolhido: boolean; aliquotaPropria: number | null; comp: Componentes; tratamento: Tratamento }
    >();
    for (const cat of categorias) {
      const escolhido = ehTipoImposto(cat.tipoImposto);
      const tipo: TipoImposto = escolhido ? (cat.tipoImposto as TipoImposto) : tipoPeloNome(cat.nome);
      const aliquotaPropria = numOuNulo(cat.aliquotaImposto);
      infoCategoria.set(cat.id, {
        nome: cat.nome,
        cor: cat.cor,
        tipo,
        escolhido,
        aliquotaPropria,
        comp: componentesDaCategoria(tipo, aliquotaPropria),
        tratamento: ehTratamento(cat.tratamentoTributario) ? cat.tratamentoTributario : tratamentoPeloNome(cat.nome),
      });
    }

    const tipoDiretoDe = (descricao: string, categoriaId: number | null): TipoDireto | null => {
      const pelaDescricao = diretoPelaDescricao(descricao);
      if (pelaDescricao) return pelaDescricao;
      if (categoriaId !== null && infoCategoria.get(categoriaId)?.tipo === 'DIRETO') return 'OUTROS';
      return null;
    };

    // Acumuladores.
    const mesesDoAno = Array.from({ length: 12 }, (_, i) => `${ano}-${String(i + 1).padStart(2, '0')}`);
    const porMes = new Map(mesesDoAno.map((m) => [m, { gasto: 0, indireto: 0, direto: 0, renda: 0 }]));
    const porCategoria = new Map<number, { gasto: number; comp: Componentes; lancamentos: number }>();
    const compTotal = zerado();
    const diretoPorTipo = new Map<TipoDireto, { total: number; quantidade: number }>();
    const lancamentosDiretos: { id: string; data: string; descricao: string; valor: number; tipo: TipoDireto; categoria: string | null }[] = [];
    let gasto = 0;
    let renda = 0;
    let semCategoria = 0;
    const combustivel = { gasto: 0, imposto: 0, lancamentos: 0 };
    const impostoPorMesCategoria = new Map<string, Map<number, number>>();

    const registrarDireto = (id: string, data: Date, descricao: string, valor: number, tipo: TipoDireto, categoria: string | null) => {
      const d = diretoPorTipo.get(tipo) ?? { total: 0, quantidade: 0 };
      d.total += valor;
      d.quantidade += 1;
      diretoPorTipo.set(tipo, d);
      lancamentosDiretos.push({ id, data: dataISO(data), descricao, valor: arredondar(valor), tipo, categoria });
      const m = porMes.get(mesDe(data));
      if (m) m.direto += valor;
    };

    for (const t of transacoes) {
      const valor = num(t.valor);
      const m = porMes.get(mesDe(t.data));
      if (t.tipo === 'RECEITA') {
        renda += valor;
        if (m) m.renda += valor;
        continue;
      }
      gasto += valor;
      if (m) m.gasto += valor;
      const tipoDireto = tipoDiretoDe(t.descricao, t.categoriaId);
      if (tipoDireto) {
        registrarDireto(`t${t.id}`, t.data, t.descricao, valor, tipoDireto, t.categoriaId !== null ? infoCategoria.get(t.categoriaId)?.nome ?? null : null);
        continue;
      }
      if (t.categoriaId === null) {
        semCategoria += valor;
        continue;
      }
      const info = infoCategoria.get(t.categoriaId);
      if (!info) continue;
      // Posto de combustível pela descrição: usa a carga do combustível, a não ser que a pessoa tenha escolhido o tipo.
      const ehPosto = ehCombustivel(t.descricao) && !info.escolhido && info.aliquotaPropria === null;
      const comp = ehPosto ? TIPOS_GASTO.COMBUSTIVEL.componentes : info.comp;
      const impostoDaCompra = (valor * totalDosComponentes(comp)) / 100;
      if (ehPosto || info.tipo === 'COMBUSTIVEL') {
        combustivel.gasto += valor;
        combustivel.imposto += impostoDaCompra;
        combustivel.lancamentos += 1;
      }
      const acc = porCategoria.get(t.categoriaId) ?? { gasto: 0, comp: zerado(), lancamentos: 0 };
      acc.gasto += valor;
      acc.lancamentos += 1;
      somarEm(acc.comp, comp, valor);
      porCategoria.set(t.categoriaId, acc);
      somarEm(compTotal, comp, valor);
      if (m) m.indireto += impostoDaCompra;
      const doMes = impostoPorMesCategoria.get(mesDe(t.data)) ?? new Map<number, number>();
      doMes.set(t.categoriaId, (doMes.get(t.categoriaId) ?? 0) + impostoDaCompra);
      impostoPorMesCategoria.set(mesDe(t.data), doMes);
    }

    for (const mov of movimentosImposto) {
      const nome = mov.investimento.codigo ?? mov.investimento.nome;
      registrarDireto(`m${mov.id}`, mov.data, mov.descricao ?? `IR sobre ${nome}`, num(mov.valor), 'INVESTIMENTOS', nome);
    }

    const indireto = totalDosComponentes(compTotal);
    const direto = Array.from(diretoPorTipo.values()).reduce((s, d) => s + d.total, 0);
    const imposto = indireto + direto;

    // Linhas por categoria (todas as de despesa, com ou sem gasto, para a tabela editável).
    const linhas = categorias.map((cat) => {
      const info = infoCategoria.get(cat.id)!;
      const acc = porCategoria.get(cat.id);
      const totalComp = acc ? totalDosComponentes(acc.comp) : 0;
      return {
        categoriaId: cat.id,
        nome: info.nome,
        cor: info.cor,
        tipo: info.tipo,
        tipoEscolhido: info.escolhido,
        aliquota: Math.round(totalDosComponentes(info.comp) * 100) / 100,
        aliquotaPropria: info.aliquotaPropria,
        aliquotaDoTipo: totalDosComponentes(TIPOS_GASTO[info.tipo].componentes),
        gasto: arredondar(acc?.gasto ?? 0),
        lancamentos: acc?.lancamentos ?? 0,
        imposto: arredondar(totalComp),
        componentes: arredondarComp(acc?.comp ?? zerado()),
      };
    });
    linhas.sort((a, b) => b.imposto - a.imposto || b.gasto - a.gasto || a.nome.localeCompare(b.nome));

    // Reforma: tributos de hoje x o que sobra deles + CBS/IBS em cada ano da transição, sobre o mesmo gasto.
    const consumoHoje = compTotal.icms + compTotal.pisCofins + compTotal.ipi + compTotal.iss;
    const reforma = ALIQUOTAS_POR_ANO.map((a) => {
      let novos = 0;
      for (const [catId, acc] of porCategoria) {
        const info = infoCategoria.get(catId)!;
        if (info.tipo === 'DIRETO' || info.tipo === 'SEM_IMPOSTO') continue;
        novos += impostoEmbutido(acc.gasto, info.tratamento, a.ano).total;
      }
      // 2026 é ano de teste: CBS e IBS são compensados com PIS/Cofins e não custam nada a mais.
      if (a.ano === 2026) novos = 0;
      const antigos =
        (compTotal.icms + compTotal.iss) * fatorIcmsIss(a.ano) + (compTotal.pisCofins + compTotal.ipi) * fatorPisCofinsIpi(a.ano);
      return { ano: a.ano, antigos: arredondar(antigos), novos: arredondar(novos), total: arredondar(antigos + novos) };
    });
    const reformaPorCategoria = Array.from(porCategoria.entries())
      .map(([catId, acc]) => {
        const info = infoCategoria.get(catId)!;
        const hojeCat = acc.comp.icms + acc.comp.pisCofins + acc.comp.ipi + acc.comp.iss;
        const depois = info.tipo === 'DIRETO' || info.tipo === 'SEM_IMPOSTO' ? 0 : impostoEmbutido(acc.gasto, info.tratamento, 2033).total;
        return { categoriaId: catId, nome: info.nome, cor: info.cor, gasto: arredondar(acc.gasto), hoje: arredondar(hojeCat), depois: arredondar(depois), diferenca: arredondar(depois - hojeCat) };
      })
      .filter((l) => l.gasto > 0)
      .sort((a, b) => Math.abs(b.diferenca) - Math.abs(a.diferenca));

    // Dias trabalhados para pagar impostos (proporção do que entrou no período, levada ao ano).
    const fracao = renda > 0 ? imposto / renda : null;
    const dias = fracao === null ? null : Math.round(Math.min(1, fracao) * diasNoAno);
    const libertacao = dias === null ? null : dataISO(new Date(Date.UTC(ano, 0, 1 + dias)));

    const calendario = montarCalendario(ano, [...diretosAnteriores, ...transacoes.filter((t) => t.tipo === 'DESPESA')]);

    // Impostômetro: total até hoje e projeção pela média diária do ano.
    const completo = fim.getTime() === fimDoAno.getTime();
    const projecao = completo ? imposto : (imposto / diasNoPeriodo) * diasNoAno;
    const projecaoIndireto = completo ? indireto : (indireto / diasNoPeriodo) * diasNoAno;

    // Meta de imposto indireto (valor máximo no ano), guardada por perfil e ano.
    const config = await prisma.configIrpf.findFirst({ where: { ano }, select: { metaIndireto: true } });
    const metaValor = numOuNulo(config?.metaIndireto);
    const meta =
      metaValor === null
        ? { valor: null }
        : {
            valor: metaValor,
            acumulado: arredondar(indireto),
            esperadoHoje: arredondar((metaValor * diasNoPeriodo) / diasNoAno),
            projecao: arredondar(projecaoIndireto),
            percentual: metaValor > 0 ? Math.round((indireto / metaValor) * 1000) / 10 : null,
            noRitmo: indireto <= (metaValor * diasNoPeriodo) / diasNoAno,
          };

    // Mês mais pesado e as categorias que puxaram (imposto no mês acima da média mensal da categoria).
    const mesesComDados = mesesDoAno.filter((mes) => mes <= mesDe(fim));
    const pesoDoMes = (mes: string) => (porMes.get(mes)?.indireto ?? 0) + (porMes.get(mes)?.direto ?? 0);
    const mesPesado = mesesComDados.reduce<string | null>((maior, mes) => (maior === null || pesoDoMes(mes) > pesoDoMes(maior) ? mes : maior), null);
    let mesMaisPesado = null;
    if (mesPesado && pesoDoMes(mesPesado) > 0) {
      const media = mesesComDados.reduce((s, mes) => s + pesoDoMes(mes), 0) / Math.max(1, mesesComDados.length);
      const doMes = impostoPorMesCategoria.get(mesPesado) ?? new Map<number, number>();
      const motivos = Array.from(doMes.entries())
        .map(([catId, valor]) => {
          const acc = porCategoria.get(catId);
          const mediaCat = acc ? totalDosComponentes(acc.comp) / Math.max(1, mesesComDados.length) : 0;
          const info = infoCategoria.get(catId)!;
          return { nome: info.nome, cor: info.cor, imposto: arredondar(valor), acimaDaMedia: arredondar(valor - mediaCat) };
        })
        .filter((x) => x.acimaDaMedia > 0)
        .sort((a, b) => b.acimaDaMedia - a.acimaDaMedia)
        .slice(0, 3);
      const diretoDoMes = porMes.get(mesPesado)?.direto ?? 0;
      mesMaisPesado = { mes: mesPesado, imposto: arredondar(pesoDoMes(mesPesado)), media: arredondar(media), direto: arredondar(diretoDoMes), motivos };
    }

    // Quem cobra: União (PIS/Cofins, IPI, IOF, IR, INSS e os "outros" embutidos), estado (ICMS, IPVA), município (ISS, IPTU).
    const diretoDe = (tipo: TipoDireto) => diretoPorTipo.get(tipo)?.total ?? 0;
    const esferas = {
      uniao: arredondar(compTotal.pisCofins + compTotal.ipi + compTotal.outros + diretoDe('IOF') + diretoDe('IR') + diretoDe('INSS') + diretoDe('INVESTIMENTOS')),
      estado: arredondar(compTotal.icms + diretoDe('IPVA')),
      municipio: arredondar(compTotal.iss + diretoDe('IPTU')),
      outras: arredondar(diretoDe('OUTROS')),
    };

    const diretos = (Object.keys(TIPOS_DIRETO) as TipoDireto[])
      .map((tipo) => ({ tipo, rotulo: TIPOS_DIRETO[tipo], total: arredondar(diretoPorTipo.get(tipo)?.total ?? 0), quantidade: diretoPorTipo.get(tipo)?.quantidade ?? 0 }))
      .filter((d) => d.quantidade > 0)
      .sort((a, b) => b.total - a.total);
    lancamentosDiretos.sort((a, b) => b.data.localeCompare(a.data));

    res.json({
      ano,
      anos,
      periodo: { de: dataISO(inicio), ate: dataISO(fim), dias: diasNoPeriodo, completo: fim.getTime() === fimDoAno.getTime() },
      totais: {
        gasto: arredondar(gasto),
        renda: arredondar(renda),
        proventos: arredondar(num(rendimentos._sum.valor)),
        indireto: arredondar(indireto),
        direto: arredondar(direto),
        imposto: arredondar(imposto),
        percentualGasto: gasto > 0 ? Math.round((imposto / gasto) * 10000) / 100 : 0,
        percentualRenda: renda > 0 ? Math.round((imposto / renda) * 10000) / 100 : null,
        semCategoria: arredondar(semCategoria),
        componentes: arredondarComp(compTotal),
      },
      meses: mesesDoAno.map((mes) => {
        const m = porMes.get(mes)!;
        return { mes, gasto: arredondar(m.gasto), indireto: arredondar(m.indireto), direto: arredondar(m.direto), renda: arredondar(m.renda) };
      }),
      categorias: linhas,
      diretos: { porTipo: diretos, lancamentos: lancamentosDiretos },
      reforma: { consumoHoje: arredondar(consumoHoje), outrosHoje: arredondar(compTotal.outros), porAno: reforma, porCategoria: reformaPorCategoria },
      dias: { dias, diasNoAno, libertacao, fracao: fracao === null ? null : Math.round(fracao * 10000) / 100 },
      calendario,
      impostometro: { total: arredondar(imposto), projecao: arredondar(projecao), porDia: arredondar(imposto / diasNoPeriodo), completo },
      meta,
      mesMaisPesado,
      esferas,
      combustivel: {
        gasto: arredondar(combustivel.gasto),
        imposto: arredondar(combustivel.imposto),
        lancamentos: combustivel.lancamentos,
        aliquota: totalDosComponentes(TIPOS_GASTO.COMBUSTIVEL.componentes),
      },
    });
  })
);

const categoriaSchema = z.object({
  tipo: z.string().nullable(),
  aliquota: z.number().min(0).max(100).nullable(),
});

router.put(
  '/impostos/categorias/:id',
  asyncHandler(async (req, res) => {
    const { tipo, aliquota } = validar(categoriaSchema, req.body);
    if (tipo !== null && !ehTipoImposto(tipo)) throw new HttpError(400, 'Tipo de gasto inválido');
    const categoria = await prisma.categoria.findUnique({ where: { id: idParam(req) } });
    if (!categoria) throw new HttpError(404, 'Categoria não encontrada');
    await prisma.categoria.update({
      where: { id: categoria.id },
      data: { tipoImposto: tipo, aliquotaImposto: aliquota === null ? null : Math.round(aliquota * 100) / 100 },
    });
    res.status(204).end();
  })
);

// ---------- IRPF, dedutíveis e estabelecimentos ----------

// Período do ano pedido: de 1º de janeiro até hoje (ano corrente) ou 31 de dezembro.
function periodoDoAno(req: { query: Record<string, unknown> }) {
  const agora = hoje();
  const ano = Number(req.query.ano) || agora.getUTCFullYear();
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) throw new HttpError(400, 'Ano inválido');
  const inicio = new Date(Date.UTC(ano, 0, 1));
  const fimDoAno = new Date(Date.UTC(ano, 11, 31));
  const fim = fimDoAno.getTime() > agora.getTime() ? agora : fimDoAno;
  return { ano, inicio, fim, completo: fim.getTime() === fimDoAno.getTime() };
}

// Categorias de despesa com o tipo de gasto, a alíquota e o tipo de dedução no IR.
async function classificarCategorias() {
  const categorias = await prisma.categoria.findMany({ where: { tipo: 'DESPESA' }, orderBy: { nome: 'asc' } });
  const mapa = new Map<
    number,
    { id: number; nome: string; cor: string; tipo: TipoImposto; aliquota: number; dedutivel: TipoDedutivel; dedutivelEscolhido: boolean }
  >();
  for (const cat of categorias) {
    const tipo: TipoImposto = ehTipoImposto(cat.tipoImposto) ? (cat.tipoImposto as TipoImposto) : tipoPeloNome(cat.nome);
    const escolhido = ehTipoDedutivel(cat.dedutivelIr);
    mapa.set(cat.id, {
      id: cat.id,
      nome: cat.nome,
      cor: cat.cor,
      tipo,
      aliquota: totalDosComponentes(componentesDaCategoria(tipo, numOuNulo(cat.aliquotaImposto))),
      dedutivel: escolhido ? (cat.dedutivelIr as TipoDedutivel) : dedutivelPeloNome(cat.nome, tipo),
      dedutivelEscolhido: escolhido,
    });
  }
  return mapa;
}

router.get(
  '/impostos/irpf',
  asyncHandler(async (req, res) => {
    const { ano, inicio, fim, completo } = periodoDoAno(req);
    const [categorias, config, despesas, receitas, proventosFii] = await Promise.all([
      classificarCategorias(),
      prisma.configIrpf.findFirst({ where: { ano } }),
      prisma.transacao.findMany({
        where: { tipo: 'DESPESA', transferencia: false, oculto: false, data: { gte: inicio, lte: fim } },
        select: { id: true, data: true, descricao: true, valor: true, categoriaId: true },
        orderBy: { data: 'desc' },
      }),
      prisma.transacao.aggregate({
        where: { tipo: 'RECEITA', transferencia: false, oculto: false, data: { gte: inicio, lte: fim } },
        _sum: { valor: true },
      }),
      prisma.movimentoInvestimento.aggregate({
        where: { tipo: 'RENDIMENTO', data: { gte: inicio, lte: fim }, investimento: { tipo: 'FII' } },
        _sum: { valor: true },
      }),
    ]);

    // Lançamentos que abatem no IR (pela categoria; PGBL também pela descrição).
    const porTipo: Record<Exclude<TipoDedutivel, 'NAO'>, number> = { SAUDE: 0, EDUCACAO: 0, PREVIDENCIA: 0 };
    const porCategoria = new Map<number, number>();
    const lancamentos: { id: number; data: string; descricao: string; valor: number; tipo: TipoDedutivel; categoria: string | null }[] = [];
    for (const t of despesas) {
      const cat = t.categoriaId !== null ? categorias.get(t.categoriaId) : undefined;
      let tipo: TipoDedutivel = cat?.dedutivel ?? 'NAO';
      if (tipo === 'NAO' && /\b(pgbl|previdencia privada)\b/i.test(t.descricao.normalize('NFD').replace(/[̀-ͯ]/g, ''))) tipo = 'PREVIDENCIA';
      // Remédio comprado em farmácia não abate, mesmo numa categoria de saúde.
      if (tipo === 'SAUDE' && /(drogaria|drogasil|droga raia|raia drogasil|farmacia|pague menos|panvel|pacheco)/i.test(t.descricao.normalize('NFD').replace(/[̀-ͯ]/g, ''))) continue;
      if (tipo === 'NAO') continue;
      const valor = num(t.valor);
      porTipo[tipo] += valor;
      if (cat) porCategoria.set(cat.id, (porCategoria.get(cat.id) ?? 0) + valor);
      lancamentos.push({ id: t.id, data: dataISO(t.data), descricao: t.descricao, valor: arredondar(valor), tipo, categoria: cat?.nome ?? null });
    }

    const receitasLancadas = num(receitas._sum.valor);
    const rendaBruta = config?.rendaBruta != null ? num(config.rendaBruta) : receitasLancadas;
    const irRetido = num(config?.irRetido);
    const inss = num(config?.inss);
    const dependentes = config?.dependentes ?? 0;
    const pessoas = 1 + dependentes;

    const educacaoLimite = IRPF.limiteEducacao * pessoas;
    const previdenciaLimite = rendaBruta * IRPF.limitePrevidencia;
    const deducoes = {
      inss,
      dependentes: IRPF.porDependente * dependentes,
      saude: porTipo.SAUDE,
      educacao: Math.min(porTipo.EDUCACAO, educacaoLimite),
      previdencia: Math.min(porTipo.PREVIDENCIA, previdenciaLimite),
    };
    const totalDeducoes = Object.values(deducoes).reduce((s, v) => s + v, 0);
    const baseCompleto = Math.max(0, rendaBruta - totalDeducoes);
    const completoCalc = impostoAnual(baseCompleto, rendaBruta, ano);
    const descontoSimplificado = Math.min(rendaBruta * IRPF.descontoSimplificado, IRPF.tetoSimplificado);
    const baseSimplificado = Math.max(0, rendaBruta - descontoSimplificado);
    const simplificadoCalc = impostoAnual(baseSimplificado, rendaBruta, ano);
    const melhor = completoCalc.imposto < simplificadoCalc.imposto ? 'COMPLETO' : 'SIMPLIFICADO';
    const devido = Math.min(completoCalc.imposto, simplificadoCalc.imposto);

    // PGBL: quanto ainda caberia até 12% da renda e o imposto que deixaria de pagar agora (no modelo completo).
    const pgblEspaco = Math.max(0, previdenciaLimite - porTipo.PREVIDENCIA);
    const comPgbl = impostoAnual(Math.max(0, baseCompleto - pgblEspaco), rendaBruta, ano).imposto;
    const devidoComPgbl = Math.min(comPgbl, simplificadoCalc.imposto);

    res.json({
      ano,
      completo,
      periodo: { de: dataISO(inicio), ate: dataISO(fim) },
      fonte: IRPF.fonte,
      parametros: {
        porDependente: IRPF.porDependente,
        limiteEducacao: IRPF.limiteEducacao,
        tetoSimplificado: IRPF.tetoSimplificado,
        descontoSimplificado: IRPF.descontoSimplificado,
        limitePrevidencia: IRPF.limitePrevidencia,
        faixas: IRPF.faixas.map((f) => ({ ate: Number.isFinite(f.ate) ? f.ate : null, aliquota: f.aliquota, deducao: f.deducao })),
        reducao: ano >= IRPF.reducao.desdeAno ? { isentoAte: IRPF.reducao.isentoAte, ate: IRPF.reducao.ate } : null,
      },
      config: {
        rendaBruta: config?.rendaBruta != null ? num(config.rendaBruta) : null,
        irRetido: config?.irRetido != null ? num(config.irRetido) : null,
        inss: config?.inss != null ? num(config.inss) : null,
        dependentes,
      },
      entradas: {
        receitasLancadas: arredondar(receitasLancadas),
        rendaBruta: arredondar(rendaBruta),
        rendaEstimada: config?.rendaBruta == null,
        proventosIsentos: arredondar(num(proventosFii._sum.valor)),
        irRetido: arredondar(irRetido),
      },
      dedutiveis: {
        saude: arredondar(porTipo.SAUDE),
        educacao: arredondar(porTipo.EDUCACAO),
        educacaoLimite: arredondar(educacaoLimite),
        previdencia: arredondar(porTipo.PREVIDENCIA),
        previdenciaLimite: arredondar(previdenciaLimite),
        porCategoria: Array.from(categorias.values())
          .filter((c) => c.dedutivel !== 'NAO' || porCategoria.has(c.id) || c.tipo === 'SAUDE' || c.tipo === 'EDUCACAO' || c.tipo === 'FARMACIA')
          .map((c) => ({
            categoriaId: c.id,
            nome: c.nome,
            cor: c.cor,
            dedutivel: c.dedutivel,
            escolhido: c.dedutivelEscolhido,
            total: arredondar(porCategoria.get(c.id) ?? 0),
          }))
          .sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome)),
        lancamentos,
        tipos: Object.entries(TIPOS_DEDUTIVEL).map(([id, rotulo]) => ({ id, rotulo })),
      },
      deducoes: Object.fromEntries(Object.entries(deducoes).map(([k, v]) => [k, arredondar(v)])),
      modelos: {
        completo: { base: arredondar(baseCompleto), deducoes: arredondar(totalDeducoes), imposto: arredondar(completoCalc.imposto), aliquotaMarginal: completoCalc.aliquota, reducao: arredondar(completoCalc.reducao) },
        simplificado: { base: arredondar(baseSimplificado), desconto: arredondar(descontoSimplificado), imposto: arredondar(simplificadoCalc.imposto), aliquotaMarginal: simplificadoCalc.aliquota, reducao: arredondar(simplificadoCalc.reducao) },
        melhor,
      },
      devido: arredondar(devido),
      resultado: arredondar(irRetido - devido), // > 0 restituir; < 0 pagar
      aliquotaEfetiva: rendaBruta > 0 ? Math.round((devido / rendaBruta) * 10000) / 100 : 0,
      pgbl: { espaco: arredondar(pgblEspaco), economia: arredondar(Math.max(0, devido - devidoComPgbl)) },
    });
  })
);

const irpfSchema = z.object({
  ano: z.number().int().min(2000).max(2100),
  rendaBruta: z.number().min(0).max(999_999_999).nullable(),
  irRetido: z.number().min(0).max(999_999_999).nullable(),
  inss: z.number().min(0).max(999_999_999).nullable(),
  dependentes: z.number().int().min(0).max(30),
});

router.put(
  '/impostos/irpf',
  asyncHandler(async (req, res) => {
    const { ano, ...dados } = validar(irpfSchema, req.body);
    const existente = await prisma.configIrpf.findFirst({ where: { ano } });
    if (existente) await prisma.configIrpf.update({ where: { id: existente.id }, data: dados });
    else await prisma.configIrpf.create({ data: { ano, ...dados } });
    res.status(204).end();
  })
);

const dedutivelSchema = z.object({ dedutivel: z.string().nullable() });

router.put(
  '/impostos/categorias/:id/dedutivel',
  asyncHandler(async (req, res) => {
    const { dedutivel } = validar(dedutivelSchema, req.body);
    if (dedutivel !== null && !ehTipoDedutivel(dedutivel)) throw new HttpError(400, 'Tipo de dedução inválido');
    const categoria = await prisma.categoria.findUnique({ where: { id: idParam(req) } });
    if (!categoria) throw new HttpError(404, 'Categoria não encontrada');
    await prisma.categoria.update({ where: { id: categoria.id }, data: { dedutivelIr: dedutivel } });
    res.status(204).end();
  })
);

router.get(
  '/impostos/estabelecimentos',
  asyncHandler(async (req, res) => {
    const { ano, inicio, fim } = periodoDoAno(req);
    const [categorias, despesas] = await Promise.all([
      classificarCategorias(),
      prisma.transacao.findMany({
        where: { tipo: 'DESPESA', transferencia: false, oculto: false, data: { gte: inicio, lte: fim } },
        select: { descricao: true, valor: true, categoriaId: true, data: true },
      }),
    ]);
    const grupos = new Map<string, { nome: string; gasto: number; imposto: number; lancamentos: number; categorias: Map<number, number>; ultima: string }>();
    for (const t of despesas) {
      if (diretoPelaDescricao(t.descricao)) continue; // IOF e afins ficam na aba Diretos
      const cat = t.categoriaId !== null ? categorias.get(t.categoriaId) : undefined;
      if (cat && (cat.tipo === 'DIRETO' || cat.tipo === 'SEM_IMPOSTO')) continue;
      const nome = nomeDoEstabelecimento(t.descricao);
      const chave = nome.toLowerCase();
      const valor = num(t.valor);
      const g = grupos.get(chave) ?? { nome, gasto: 0, imposto: 0, lancamentos: 0, categorias: new Map(), ultima: '' };
      g.gasto += valor;
      g.imposto += cat ? (valor * cat.aliquota) / 100 : 0;
      g.lancamentos += 1;
      if (cat) g.categorias.set(cat.id, (g.categorias.get(cat.id) ?? 0) + valor);
      const dia = dataISO(t.data);
      if (dia > g.ultima) g.ultima = dia;
      grupos.set(chave, g);
    }
    // "Uber" e "Uber Eats Pedido" viram um lugar só quando o nome curto também aparece sozinho.
    for (const [chave, g] of Array.from(grupos.entries())) {
      const primeira = chave.split(' ')[0];
      const curto = grupos.get(primeira);
      if (primeira === chave || !curto || primeira.length < 4) continue;
      curto.gasto += g.gasto;
      curto.imposto += g.imposto;
      curto.lancamentos += g.lancamentos;
      for (const [id, v] of g.categorias) curto.categorias.set(id, (curto.categorias.get(id) ?? 0) + v);
      if (g.ultima > curto.ultima) curto.ultima = g.ultima;
      grupos.delete(chave);
    }
    const lista = Array.from(grupos.values())
      .map((g) => {
        const principal = Array.from(g.categorias.entries()).sort((a, b) => b[1] - a[1])[0];
        const cat = principal ? categorias.get(principal[0]) : undefined;
        return {
          nome: g.nome,
          gasto: arredondar(g.gasto),
          imposto: arredondar(g.imposto),
          aliquota: g.gasto > 0 ? Math.round((g.imposto / g.gasto) * 1000) / 10 : 0,
          lancamentos: g.lancamentos,
          ultima: g.ultima,
          categoria: cat ? { nome: cat.nome, cor: cat.cor } : null,
        };
      })
      .sort((a, b) => b.gasto - a.gasto);
    const totalGasto = lista.reduce((s, l) => s + l.gasto, 0);
    res.json({
      ano,
      totalGasto: arredondar(totalGasto),
      totalImposto: arredondar(lista.reduce((s, l) => s + l.imposto, 0)),
      quantidade: lista.length,
      estabelecimentos: lista.slice(0, 50),
    });
  })
);

// ---------- IOF e tarifas ----------

router.get(
  '/impostos/iof-tarifas',
  asyncHandler(async (req, res) => {
    const { ano, inicio, fim } = periodoDoAno(req);
    const despesas = await prisma.transacao.findMany({
      where: { tipo: 'DESPESA', transferencia: false, oculto: false, data: { gte: inicio, lte: fim } },
      select: { id: true, data: true, descricao: true, valor: true, categoria: { select: { nome: true } } },
      orderBy: { data: 'desc' },
    });
    const mesesDoAno = Array.from({ length: 12 }, (_, i) => `${ano}-${String(i + 1).padStart(2, '0')}`);
    const porMes = new Map(mesesDoAno.map((m) => [m, { iof: 0, tarifas: 0 }]));
    const porTipo = new Map<TipoIof | 'TARIFA', { total: number; quantidade: number }>();
    const lancamentos: { id: number; data: string; descricao: string; valor: number; tipo: TipoIof | 'TARIFA'; categoria: string | null }[] = [];
    for (const t of despesas) {
      const ehIof = diretoPelaDescricao(t.descricao) === 'IOF';
      if (!ehIof && !ehTarifaBancaria(t.descricao)) continue;
      const tipo: TipoIof | 'TARIFA' = ehIof ? tipoDoIof(t.descricao) : 'TARIFA';
      const valor = num(t.valor);
      const acc = porTipo.get(tipo) ?? { total: 0, quantidade: 0 };
      acc.total += valor;
      acc.quantidade += 1;
      porTipo.set(tipo, acc);
      const m = porMes.get(mesDe(t.data));
      if (m) {
        if (ehIof) m.iof += valor;
        else m.tarifas += valor;
      }
      lancamentos.push({ id: t.id, data: dataISO(t.data), descricao: t.descricao, valor: arredondar(valor), tipo, categoria: t.categoria?.nome ?? null });
    }
    const rotulos: Record<string, string> = { ...TIPOS_IOF, TARIFA: 'Tarifas e pacotes bancários' };
    const tipos = Array.from(porTipo.entries())
      .map(([tipo, v]) => ({ tipo, rotulo: rotulos[tipo], total: arredondar(v.total), quantidade: v.quantidade }))
      .sort((a, b) => b.total - a.total);
    const iof = tipos.filter((t) => t.tipo !== 'TARIFA').reduce((s, t) => s + t.total, 0);
    const tarifas = porTipo.get('TARIFA')?.total ?? 0;
    res.json({
      ano,
      totais: { iof: arredondar(iof), tarifas: arredondar(tarifas), total: arredondar(iof + tarifas) },
      tipos,
      meses: mesesDoAno
        .filter((m) => m <= mesDe(fim))
        .map((mes) => ({ mes, iof: arredondar(porMes.get(mes)!.iof), tarifas: arredondar(porMes.get(mes)!.tarifas) })),
      lancamentos,
    });
  })
);

// ---------- Renda fixa e fundos: IR regressivo e come-cotas ----------

router.get(
  '/impostos/renda-fixa',
  asyncHandler(async (_req, res) => {
    const agora = hoje();
    const ativos = await prisma.investimento.findMany({
      where: { ativo: true, tipo: { in: ['RENDA_FIXA', 'FUNDO', 'PREVIDENCIA'] } },
      include: { movimentos: { where: { tipo: 'APLICACAO' }, orderBy: { data: 'asc' }, take: 1, select: { data: true } } },
      orderBy: { nome: 'asc' },
    });
    // Come-cotas: último dia útil de maio e de novembro (fundos de longo prazo, 15% sobre o rendimento do semestre).
    const candidatos = [4, 10, 16].map((m) => ultimoDiaUtil(agora.getUTCFullYear() + Math.floor(m / 12), m % 12));
    const proximoComeCotas = candidatos.find((d) => d.getTime() >= agora.getTime()) ?? candidatos[2];
    const lista = ativos.map((a) => {
      const aplicado = num(a.valorAplicado);
      const saldo = num(a.saldo);
      const rendimento = Math.max(0, saldo - aplicado);
      const desde = a.movimentos[0]?.data ?? a.criadoEm;
      const dias = Math.max(0, Math.round((agora.getTime() - desde.getTime()) / MS_DIA));
      const isento = a.tipo === 'RENDA_FIXA' && rendaFixaIsenta(`${a.subtipo ?? ''} ${a.nome}`);
      const previdencia = a.tipo === 'PREVIDENCIA';
      const aliquota = isento ? 0 : previdencia ? null : aliquotaRegressiva(dias);
      return {
        id: a.id,
        nome: a.nome,
        tipo: a.tipo,
        subtipo: a.subtipo,
        aplicado: arredondar(aplicado),
        saldo: arredondar(saldo),
        rendimento: arredondar(rendimento),
        dias,
        isento,
        aliquota,
        irEstimado: aliquota === null ? null : arredondar((rendimento * aliquota) / 100),
        comeCotas: a.tipo === 'FUNDO' ? { data: dataISO(proximoComeCotas), aliquota: 15 } : null,
        vencimento: a.vencimento ? dataISO(a.vencimento) : null,
      };
    });
    res.json({
      ativos: lista,
      totais: {
        saldo: arredondar(lista.reduce((s, a) => s + a.saldo, 0)),
        rendimento: arredondar(lista.reduce((s, a) => s + a.rendimento, 0)),
        irEstimado: arredondar(lista.reduce((s, a) => s + (a.irEstimado ?? 0), 0)),
      },
      proximoComeCotas: dataISO(proximoComeCotas),
    });
  })
);

// ---------- Meta de imposto indireto ----------

const metaSchema = z.object({ ano: z.number().int().min(2000).max(2100), valor: z.number().min(0).max(999_999_999).nullable() });

router.put(
  '/impostos/meta',
  asyncHandler(async (req, res) => {
    const { ano, valor } = validar(metaSchema, req.body);
    const existente = await prisma.configIrpf.findFirst({ where: { ano } });
    if (existente) await prisma.configIrpf.update({ where: { id: existente.id }, data: { metaIndireto: valor } });
    else await prisma.configIrpf.create({ data: { ano, metaIndireto: valor } });
    res.status(204).end();
  })
);

// ---------- Vencimentos próximos (cartão do Início) ----------

router.get(
  '/impostos/vencimentos',
  asyncHandler(async (req, res) => {
    const dias = Math.min(60, Math.max(1, Number(req.query.dias) || 7));
    const agora = hoje();
    const limite = new Date(agora.getTime() + dias * MS_DIA);
    const ano = agora.getUTCFullYear();
    const pagos = await prisma.transacao.findMany({
      where: { tipo: 'DESPESA', transferencia: false, oculto: false, data: { gte: new Date(Date.UTC(ano - 2, 0, 1)), lte: agora } },
      select: { data: true, descricao: true, valor: true },
    });
    // O calendário deste ano e o do próximo (perto da virada, o IPVA de janeiro já pode estar na janela).
    const eventos: EventoCalendario[] = [...montarCalendario(ano, pagos), ...montarCalendario(ano + 1, pagos)];
    // DARF das vendas: o imposto do mês vence no último dia útil do mês seguinte.
    for (const a of [ano - 1, ano]) {
      const ir = await dadosDoIr(a);
      for (const m of ir.imposto.meses) {
        if (m.imposto <= 0) continue;
        const [y, mm] = m.mes.split('-').map(Number);
        eventos.push({
          data: dataISO(ultimoDiaUtil(y, mm)),
          titulo: `DARF ${m.classe} de ${m.mes.slice(5, 7)}/${y}`,
          detalhe: 'IR sobre o lucro das vendas do mês (código 6015).',
          valor: m.imposto,
          tipo: 'IR',
          estimado: true,
          generico: false,
        });
      }
    }
    const hojeISO = dataISO(agora);
    const proximos = eventos
      .filter((e) => !e.generico && e.data >= hojeISO && e.data <= dataISO(limite))
      .sort((a, b) => a.data.localeCompare(b.data))
      .map((e) => ({ ...e, diasFaltando: Math.round((Date.parse(e.data) - agora.getTime()) / MS_DIA) }));
    res.json({ dias, vencimentos: proximos });
  })
);

export default router;
