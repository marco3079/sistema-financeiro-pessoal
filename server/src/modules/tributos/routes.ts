import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { arredondar, hoje, num } from '../../lib/financas';
import {
  ALIQUOTAS_POR_ANO,
  TRATAMENTOS,
  aliquotasDoAno,
  ehTratamento,
  impostoEmbutido,
  tratamentoPeloNome,
} from '../../lib/reformaTributaria';
import type { Tratamento } from '../../lib/reformaTributaria';
import {
  calcularOperacao,
  calculadoraDisponivel,
  classificacoesDoNcm,
  consultarNcm,
  gerarXml,
  impostoDosItens,
  municipiosDaUf,
} from '../../lib/calculadoraRtc';

// Reforma tributária: imposto embutido nos gastos (estimativa por categoria) e o simulador por produto/nota,
// que usa a calculadora oficial da Receita Federal (contêiner "calculadora"). Rotas em /api/tributos.

const router = Router();

const MS_DIA = 86_400_000;

router.get(
  '/tributos/aliquotas',
  asyncHandler(async (_req, res) => {
    res.json({
      anos: ALIQUOTAS_POR_ANO,
      tratamentos: Object.entries(TRATAMENTOS).map(([id, t]) => ({ id, ...t })),
      calculadora: await calculadoraDisponivel(),
    });
  })
);

// Gastos dos últimos 12 meses por categoria de despesa, com o imposto embutido no ano escolhido.
router.get(
  '/tributos/gastos',
  asyncHandler(async (req, res) => {
    const ano = Number(req.query.ano) || 2033;
    const ate = hoje();
    const de = new Date(ate.getTime() - 365 * MS_DIA);
    const [categorias, somas] = await Promise.all([
      prisma.categoria.findMany({ where: { tipo: 'DESPESA' }, orderBy: { nome: 'asc' } }),
      prisma.transacao.groupBy({
        by: ['categoriaId'],
        where: { tipo: 'DESPESA', transferencia: false, oculto: false, data: { gte: de, lte: ate } },
        _sum: { valor: true },
      }),
    ]);
    const porCategoria = new Map(somas.map((s) => [s.categoriaId, num(s._sum.valor)]));
    const linhas = categorias
      .map((c) => {
        const tratamento: Tratamento = ehTratamento(c.tratamentoTributario) ? c.tratamentoTributario : tratamentoPeloNome(c.nome);
        const gasto = porCategoria.get(c.id) ?? 0;
        return {
          categoriaId: c.id as number | null,
          nome: c.nome,
          cor: c.cor,
          tratamento,
          escolhidoPorVoce: ehTratamento(c.tratamentoTributario),
          gasto: arredondar(gasto),
          ...impostoEmbutido(gasto, tratamento, ano),
        };
      })
      .filter((l) => l.gasto > 0);
    // Gasto sem categoria fica fora da conta: muitas vezes é Pix ou transferência para pessoas, que não paga CBS/IBS.
    const semCategoria = arredondar(porCategoria.get(null) ?? 0);
    linhas.sort((a, b) => b.total - a.total);
    const gasto = arredondar(linhas.reduce((s, l) => s + l.gasto, 0));
    const imposto = arredondar(linhas.reduce((s, l) => s + l.total, 0));
    // O mesmo total em cada ano da transição, para o gráfico.
    const porAno = ALIQUOTAS_POR_ANO.map((a) => ({
      ano: a.ano,
      total: arredondar(linhas.reduce((s, l) => s + impostoEmbutido(l.gasto, l.tratamento, a.ano).total, 0)),
    }));
    res.json({
      ano,
      aliquotas: aliquotasDoAno(ano),
      periodo: { de: de.toISOString().slice(0, 10), ate: ate.toISOString().slice(0, 10) },
      gasto,
      imposto,
      percentual: gasto > 0 ? Math.round((imposto / gasto) * 10000) / 100 : 0,
      semCategoria,
      linhas,
      porAno,
    });
  })
);

const tratamentoSchema = z.object({ tratamento: z.string().nullable() });

router.put(
  '/tributos/categorias/:id',
  asyncHandler(async (req, res) => {
    const { tratamento } = validar(tratamentoSchema, req.body);
    if (tratamento !== null && !ehTratamento(tratamento)) throw new HttpError(400, 'Tratamento inválido');
    const categoria = await prisma.categoria.findUnique({ where: { id: idParam(req) } });
    if (!categoria) throw new HttpError(404, 'Categoria não encontrada');
    await prisma.categoria.update({ where: { id: categoria.id }, data: { tratamentoTributario: tratamento } });
    res.status(204).end();
  })
);

// ---------- Simulador (calculadora oficial) ----------

router.get(
  '/tributos/municipios',
  asyncHandler(async (req, res) => {
    const uf = String(req.query.uf ?? '').toUpperCase();
    if (!/^[A-Z]{2}$/.test(uf)) throw new HttpError(400, 'Informe a UF');
    res.json(await municipiosDaUf(uf));
  })
);

router.get(
  '/tributos/ncm/:ncm',
  asyncHandler(async (req, res) => {
    const ncm = String(req.params.ncm).replace(/\D/g, '');
    if (ncm.length !== 8) throw new HttpError(400, 'O NCM tem 8 dígitos');
    const ano = Number(req.query.ano) || hoje().getUTCFullYear();
    const [dados, classificacoes] = await Promise.all([consultarNcm(ncm, ano), classificacoesDoNcm(ncm, ano)]);
    res.json({ ...dados, classificacoes });
  })
);

const itemSchema = z.object({
  descricao: z.string().trim().max(200).optional(),
  ncm: z.string().regex(/^\d{8}$/, 'NCM com 8 dígitos'),
  cClassTrib: z.string().regex(/^\d{6}$/, 'Classificação com 6 dígitos'),
  valor: z.number().positive().max(999_999_999),
  quantidade: z.number().positive().max(999_999).default(1),
  unidade: z.string().trim().min(1).max(6).default('UN'),
  impostoSeletivo: z.number().min(0).max(1000).optional(), // % ad valorem (bebidas, cigarro, veículos...)
});

const operacaoSchema = z.object({
  ano: z.number().int().min(2026).max(2033),
  uf: z.string().regex(/^[A-Z]{2}$/),
  municipio: z.number().int().positive(),
  itens: z.array(itemSchema).min(1).max(100),
});

router.post(
  '/tributos/calcular',
  asyncHandler(async (req, res) => {
    const dados = validar(operacaoSchema, req.body);
    res.json(await calcularOperacao(dados));
  })
);

router.post(
  '/tributos/xml',
  asyncHandler(async (req, res) => {
    const dados = validar(operacaoSchema, req.body);
    res.json({ xml: await gerarXml(dados) });
  })
);

// Itens lidos de um cupom (NCM provável): CBS, IBS e IS de cada um, para o ano pedido.
const cupomSchema = z.object({
  ano: z.number().int().min(2026).max(2033).default(2033),
  itens: z
    .array(
      z.object({
        descricao: z.string().trim().min(1).max(120),
        ncm: z.string().regex(/^\d{8}$/).nullable(),
        valor: z.number().positive().max(999_999_999).nullable(),
        quantidade: z.number().positive().max(999_999).default(1),
      })
    )
    .min(1)
    .max(100),
});

router.post(
  '/tributos/cupom',
  asyncHandler(async (req, res) => {
    const dados = validar(cupomSchema, req.body);
    const itens = dados.itens
      .filter((i) => i.valor !== null)
      .map((i) => ({ descricao: i.descricao, ncm: i.ncm, valor: i.valor as number, quantidade: i.quantidade }));
    const resultado = await impostoDosItens(itens, dados.ano);
    if (!resultado) throw new HttpError(400, 'Nenhum item do cupom tem NCM e valor para calcular.');
    res.json(resultado);
  })
);

export default router;
