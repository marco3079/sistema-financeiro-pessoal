import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { arredondar, dataISO, hoje, mesDe, num, numOuNulo } from '../../lib/financas';
import {
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
import type { Componentes, TipoDireto, TipoImposto } from '../../lib/impostos';
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
      const acc = porCategoria.get(t.categoriaId) ?? { gasto: 0, comp: zerado(), lancamentos: 0 };
      acc.gasto += valor;
      acc.lancamentos += 1;
      somarEm(acc.comp, info.comp, valor);
      porCategoria.set(t.categoriaId, acc);
      somarEm(compTotal, info.comp, valor);
      if (m) m.indireto += (valor * totalDosComponentes(info.comp)) / 100;
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

    // Calendário de vencimentos.
    const calendario: { data: string; titulo: string; detalhe: string; valor: number | null; tipo: string; estimado: boolean }[] = [];
    calendario.push({
      data: dataISO(ultimoDiaUtil(ano, 4)),
      titulo: `Declaração do IRPF ${ano} (ano-base ${ano - 1})`,
      detalhe: 'Prazo costuma terminar no último dia útil de maio. Restituição em lotes de maio a setembro.',
      valor: null,
      tipo: 'IR',
      estimado: true,
    });
    for (const tipo of ['IPVA', 'IPTU'] as const) {
      const pagos = [...diretosAnteriores, ...transacoes.filter((t) => t.tipo === 'DESPESA')].filter(
        (t) => diretoPelaDescricao(t.descricao) === tipo
      );
      const porMesPago = new Map<number, number>();
      const anoMaisRecente = pagos.reduce((max, p) => Math.max(max, p.data.getUTCFullYear()), 0);
      for (const p of pagos.filter((p) => p.data.getUTCFullYear() === anoMaisRecente)) {
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
        });
      }
    }
    calendario.sort((a, b) => a.data.localeCompare(b.data));

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

export default router;
