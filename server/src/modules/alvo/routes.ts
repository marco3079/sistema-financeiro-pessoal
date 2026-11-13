import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, validar } from '../../lib/erros';
import { arredondar, num } from '../../lib/financas';

// Carteira-alvo: o usuário define quanto da carteira quer em cada classe (em %) e a tela mostra a distância
// entre o que tem hoje e o alvo. Não é recomendação de compra ou venda.

const router = Router();

const CLASSES = ['RENDA_VARIAVEL', 'RENDA_FIXA', 'FUNDOS', 'OUTROS'] as const;
type Classe = (typeof CLASSES)[number];

const ROTULOS: Record<Classe, string> = {
  RENDA_VARIAVEL: 'Renda variável',
  RENDA_FIXA: 'Renda fixa',
  FUNDOS: 'Fundos',
  OUTROS: 'Outros',
};

// Tipo do investimento -> classe da carteira-alvo.
const CLASSE_DO_TIPO: Record<string, Classe> = {
  ACAO: 'RENDA_VARIAVEL',
  FII: 'RENDA_VARIAVEL',
  ETF: 'RENDA_VARIAVEL',
  RENDA_FIXA: 'RENDA_FIXA',
  FUNDO: 'FUNDOS',
  PREVIDENCIA: 'FUNDOS',
  CRIPTO: 'OUTROS',
  OUTRO: 'OUTROS',
};

const alvoSchema = z.object({
  classes: z.array(
    z.object({
      classe: z.enum(CLASSES),
      percentual: z.number().finite().min(0).max(100),
    })
  ),
});

// Monta a resposta de GET /alvo: saldo por classe a partir dos investimentos ativos e o alvo salvo.
async function montarAlvo() {
  const [investimentos, alocacoes] = await Promise.all([
    prisma.investimento.findMany({ where: { ativo: true }, select: { tipo: true, saldo: true } }),
    prisma.alocacaoAlvo.findMany(),
  ]);

  const saldos: Record<Classe, number> = { RENDA_VARIAVEL: 0, RENDA_FIXA: 0, FUNDOS: 0, OUTROS: 0 };
  for (const inv of investimentos) {
    const classe = CLASSE_DO_TIPO[inv.tipo];
    if (classe) saldos[classe] += num(inv.saldo);
  }
  const total = CLASSES.reduce((soma, c) => soma + saldos[c], 0);

  const definido = alocacoes.length > 0;
  const alvos = new Map<string, number>();
  for (const a of alocacoes) alvos.set(a.classe, num(a.percentual));

  const classes = CLASSES.map((classe) => {
    const saldo = saldos[classe];
    const atual = total > 0 ? (saldo / total) * 100 : 0;
    const alvo = definido ? (alvos.get(classe) ?? 0) : null;
    const desvio = alvo === null ? null : atual - alvo;
    const diferenca = alvo === null ? null : saldo - (total * alvo) / 100;
    return {
      classe,
      rotulo: ROTULOS[classe],
      saldo: arredondar(saldo),
      atual: arredondar(atual),
      alvo: alvo === null ? null : arredondar(alvo),
      desvio: desvio === null ? null : arredondar(desvio),
      diferenca: diferenca === null ? null : arredondar(diferenca),
    };
  });

  return { total: arredondar(total), definido, classes };
}

router.get(
  '/alvo',
  asyncHandler(async (_req, res) => {
    res.json(await montarAlvo());
  })
);

// Troca o alvo inteiro: exige as quatro classes, uma vez cada, e soma 100 (tolerância 0,01).
router.put(
  '/alvo',
  asyncHandler(async (req, res) => {
    const dados = validar(alvoSchema, req.body);
    const itens = dados.classes.map((c) => ({ classe: c.classe, percentual: arredondar(c.percentual) }));
    const distintas = new Set(itens.map((i) => i.classe));
    if (itens.length !== CLASSES.length || distintas.size !== CLASSES.length) {
      throw new HttpError(400, 'Informe as quatro classes, uma vez cada');
    }
    const soma = itens.reduce((s, i) => s + i.percentual, 0);
    if (Math.abs(soma - 100) > 0.01) throw new HttpError(400, 'Os percentuais precisam somar 100%');

    await prisma.$transaction(async (db) => {
      await db.alocacaoAlvo.deleteMany();
      await db.alocacaoAlvo.createMany({ data: itens });
    });

    res.json(await montarAlvo());
  })
);

router.delete(
  '/alvo',
  asyncHandler(async (_req, res) => {
    await prisma.alocacaoAlvo.deleteMany();
    res.status(204).end();
  })
);

export default router;
