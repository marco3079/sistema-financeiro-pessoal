import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import {
  arredondar,
  atualizarStatusDasFaturas,
  contaDTO,
  dataISO,
  dataSchema,
  faturaDTO,
  hoje,
  INCLUIR_NA_TRANSACAO,
  inteiroQuery,
  num,
  numOuNulo,
  paraData,
  registrarPosicaoPatrimonio,
  transacaoDTO,
} from '../../lib/financas';

const router = Router();

const INCLUIR_CONTA = { conta: { select: { nome: true } } } as const;

const pagarSchema = z.object({
  pagaEm: dataSchema.optional(),
  contaPagamentoId: z.number().int().positive().optional(),
});

// Resumo de cada cartão ativo com a fatura que ainda não foi paga e o percentual do limite usado.
router.get(
  '/cartoes',
  asyncHandler(async (_req, res) => {
    await atualizarStatusDasFaturas();
    const cartoes = await prisma.conta.findMany({
      where: { tipo: 'CARTAO', ativo: true },
      orderBy: { nome: 'asc' },
    });
    const resposta = await Promise.all(
      cartoes.map(async (c) => {
        const fatura = await prisma.fatura.findFirst({
          where: { contaId: c.id, status: { not: 'PAGA' } },
          orderBy: { vencimento: 'asc' },
          include: INCLUIR_CONTA,
        });
        const limite = numOuNulo(c.limite);
        const percentualUsado = limite === null || limite === 0 ? null : Math.round((num(c.saldo) / limite) * 100);
        return {
          conta: contaDTO(c),
          faturaAtual: fatura ? faturaDTO(fatura) : null,
          percentualUsado,
        };
      })
    );
    res.json(resposta);
  })
);

router.get(
  '/faturas',
  asyncHandler(async (req, res) => {
    await atualizarStatusDasFaturas();
    const contaId = inteiroQuery(req.query.contaId);
    const lista = await prisma.fatura.findMany({
      where: contaId !== undefined ? { contaId } : {},
      orderBy: { vencimento: 'desc' },
      include: INCLUIR_CONTA,
      take: 60,
    });
    res.json(lista.map(faturaDTO));
  })
);

router.get(
  '/faturas/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const fatura = await prisma.fatura.findUnique({ where: { id }, include: INCLUIR_CONTA });
    if (!fatura) throw new HttpError(404, 'Fatura não encontrada');
    const lista = await prisma.transacao.findMany({
      where: { faturaId: id },
      include: INCLUIR_NA_TRANSACAO,
      orderBy: [{ data: 'desc' }, { id: 'desc' }],
    });

    // Despesas da fatura por categoria (sem transferências), da maior para a menor.
    const grupos = new Map<number, { nome: string; cor: string; total: number }>();
    for (const t of lista) {
      if (t.tipo !== 'DESPESA' || t.transferencia) continue;
      const chave = t.categoriaId ?? 0;
      const grupo = grupos.get(chave) ?? {
        nome: t.categoria?.nome ?? 'Sem categoria',
        cor: t.categoria?.cor ?? '#64748b',
        total: 0,
      };
      grupo.total += num(t.valor);
      grupos.set(chave, grupo);
    }
    const porCategoria = [...grupos.values()]
      .map((g) => ({ ...g, total: arredondar(g.total) }))
      .sort((a, b) => b.total - a.total);

    res.json({ fatura: faturaDTO(fatura), transacoes: lista.map(transacaoDTO), porCategoria });
  })
);

router.post(
  '/faturas/:id/pagar',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(pagarSchema, req.body);

    const fatura = await prisma.fatura.findUnique({ where: { id }, include: { conta: true } });
    if (!fatura) throw new HttpError(404, 'Fatura não encontrada');
    if (fatura.origem === 'OPEN_FINANCE') {
      throw new HttpError(400, 'Este registro vem do Open Finance e é atualizado automaticamente.');
    }
    if (fatura.status === 'PAGA') throw new HttpError(400, 'Esta fatura já está paga');

    const dataPagamento = dados.pagaEm ? paraData(dados.pagaEm) : hoje();
    const total = num(fatura.total);

    let contaPagamentoId: number | null = null;
    if (dados.contaPagamentoId !== undefined) {
      const contaPagamento = await prisma.conta.findUnique({ where: { id: dados.contaPagamentoId } });
      if (!contaPagamento) throw new HttpError(400, 'Conta de pagamento não encontrada');
      if (contaPagamento.origem !== 'MANUAL' || contaPagamento.tipo === 'CARTAO') {
        throw new HttpError(400, 'Escolha uma conta manual que não seja cartão');
      }
      contaPagamentoId = contaPagamento.id;
    }

    const atualizada = await prisma.$transaction(async (db) => {
      const paga = await db.fatura.update({
        where: { id },
        data: { status: 'PAGA', pagaEm: dataPagamento },
        include: INCLUIR_CONTA,
      });
      // A dívida do cartão diminui, sem ficar negativa.
      const novoSaldo = Math.max(0, arredondar(num(fatura.conta.saldo) - total));
      await db.conta.update({ where: { id: fatura.contaId }, data: { saldo: novoSaldo } });
      if (contaPagamentoId !== null && total > 0) {
        await db.transacao.create({
          data: {
            contaId: contaPagamentoId,
            data: dataPagamento,
            descricao: 'Pagamento da fatura ' + fatura.conta.nome,
            valor: total,
            tipo: 'DESPESA',
            transferencia: true,
          },
        });
        await db.conta.update({ where: { id: contaPagamentoId }, data: { saldo: { decrement: total } } });
      }
      return paga;
    });

    await registrarPosicaoPatrimonio();
    res.json(faturaDTO(atualizada));
  })
);

// ---------- Previsão das próximas faturas ----------

function semMarcaDeParcela(descricao: string): string {
  return descricao
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/(-\s*)?(parcela|parc\.?)?\s*\d{1,2}\s*(\/|de)\s*\d{1,2}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Mesma data, `meses` depois; dia 31 em mês de 30 vira o último dia do mês.
function mesesDepois(data: Date, meses: number): Date {
  const ano = data.getUTCFullYear();
  const mes = data.getUTCMonth() + meses;
  const ultimoDia = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  return new Date(Date.UTC(ano, mes, Math.min(data.getUTCDate(), ultimoDia)));
}

interface ItemPrevisto {
  descricao: string;
  parcela: number;
  totalParcelas: number;
  valor: number;
}

interface MesPrevisto {
  mes: string; // 'AAAA-MM' do vencimento
  vencimento: string;
  lancado: number; // fatura que já existe e ainda não foi paga
  previsto: number; // parcelas que ainda vão entrar
  total: number;
  itens: ItemPrevisto[];
}

const LIMITE_MESES = 36;

// Parcelas que ainda não foram cobradas, distribuídas nas faturas dos próximos meses.
// Para cada compra parcelada, parte da última parcela registrada ("3 de 10" na fatura de novembro) e põe
// as seguintes nos meses seguintes. Parcela que cairia em fatura que já existe não é prevista de novo.
router.get(
  '/cartoes/previsao',
  asyncHandler(async (_req, res) => {
    await atualizarStatusDasFaturas();
    const inicioDeHoje = hoje();
    const cartoes = await prisma.conta.findMany({ where: { tipo: 'CARTAO', ativo: true }, orderBy: { nome: 'asc' } });

    const resposta = await Promise.all(
      cartoes.map(async (cartao) => {
        const [faturas, parceladas] = await Promise.all([
          prisma.fatura.findMany({ where: { contaId: cartao.id }, orderBy: { vencimento: 'asc' } }),
          prisma.transacao.findMany({
            where: { contaId: cartao.id, tipo: 'DESPESA', parcela: { not: null }, totalParcelas: { not: null }, faturaId: { not: null } },
            select: { descricao: true, valor: true, parcela: true, totalParcelas: true, fatura: { select: { vencimento: true } } },
          }),
        ]);
        const meses = new Map<string, MesPrevisto>();
        const mesDe = (vencimento: Date): MesPrevisto => {
          const chave = dataISO(vencimento).slice(0, 7);
          let mes = meses.get(chave);
          if (!mes) {
            mes = { mes: chave, vencimento: dataISO(vencimento), lancado: 0, previsto: 0, total: 0, itens: [] };
            meses.set(chave, mes);
          }
          return mes;
        };

        // Faturas que já existem e ainda não foram pagas.
        for (const f of faturas) {
          if (f.status === 'PAGA') continue;
          const mes = mesDe(f.vencimento);
          mes.vencimento = dataISO(f.vencimento);
          mes.lancado += num(f.total);
        }

        const ultimaFatura = faturas.length > 0 ? faturas[faturas.length - 1].vencimento : null;
        if (ultimaFatura) {
          // Uma série por compra: mesma descrição (sem o "2/5"), mesmo número de parcelas e mesmo valor.
          const series = new Map<string, { nome: string; descricao: string; total: number; valor: number; ultima: number; base: Date; quantas: number }>();
          for (const t of parceladas) {
            if (t.parcela === null || t.totalParcelas === null || !t.fatura) continue;
            const chave = [semMarcaDeParcela(t.descricao), t.totalParcelas, num(t.valor).toFixed(2)].join('|');
            const serie = series.get(chave);
            if (!serie || t.parcela > serie.ultima) {
              series.set(chave, {
                nome: semMarcaDeParcela(t.descricao),
                descricao: t.descricao,
                total: t.totalParcelas,
                valor: num(t.valor),
                ultima: t.parcela,
                base: t.fatura.vencimento,
                quantas: 1,
              });
            } else if (t.parcela === serie.ultima) {
              // Duas compras iguais correndo juntas (mesma loja, mesmo valor, mesma parcela).
              serie.quantas++;
              if (t.fatura.vencimento.getTime() > serie.base.getTime()) serie.base = t.fatura.vencimento;
            }
          }
          // A primeira parcela costuma levar os centavos que sobram (33,34 / 33,33 / 33,33): é a mesma compra.
          // Fica só a série mais adiantada; com a mesma parcela nas duas, são compras diferentes e ficam as duas.
          const todas = [...series.values()];
          const validas = todas.filter(
            (s) => !todas.some((o) => o !== s && o.nome === s.nome && o.total === s.total && Math.abs(o.valor - s.valor) <= 0.1 && o.ultima > s.ultima)
          );
          for (const serie of validas) {
            for (let k = 1; k <= serie.total - serie.ultima && k <= LIMITE_MESES; k++) {
              const vencimento = mesesDepois(serie.base, k);
              // Cairia em uma fatura que já foi importada: ou já está lá, ou a compra foi estornada.
              if (dataISO(vencimento).slice(0, 7) <= dataISO(ultimaFatura).slice(0, 7)) continue;
              const mes = mesDe(mesesDepois(ultimaFatura, mesesEntre(ultimaFatura, vencimento)));
              for (let n = 0; n < serie.quantas; n++) {
                mes.itens.push({ descricao: serie.descricao, parcela: serie.ultima + k, totalParcelas: serie.total, valor: serie.valor });
                mes.previsto += serie.valor;
              }
            }
          }
        }

        const lista = [...meses.values()]
          // Fatura em aberto aparece sempre (mesmo atrasada). Mês só com previsão e vencimento já passado fica de
          // fora: essa fatura já fechou no banco e ainda não foi importada.
          .filter((m) => m.lancado > 0 || m.vencimento >= dataISO(inicioDeHoje))
          .sort((a, b) => (a.mes < b.mes ? -1 : 1))
          .map((m) => ({
            ...m,
            lancado: arredondar(m.lancado),
            previsto: arredondar(m.previsto),
            total: arredondar(m.lancado + m.previsto),
            itens: m.itens.sort((a, b) => b.valor - a.valor),
          }));
        return {
          contaId: cartao.id,
          nome: cartao.nome,
          cor: cartao.cor,
          meses: lista,
          parcelasRestantes: lista.reduce((soma, m) => soma + m.itens.length, 0),
          previsto: arredondar(lista.reduce((soma, m) => soma + m.previsto, 0)),
          total: arredondar(lista.reduce((soma, m) => soma + m.total, 0)),
        };
      })
    );

    // Soma de todos os cartões, mês a mês.
    const geral = new Map<string, { mes: string; lancado: number; previsto: number; total: number }>();
    for (const cartao of resposta) {
      for (const m of cartao.meses) {
        const g = geral.get(m.mes) ?? { mes: m.mes, lancado: 0, previsto: 0, total: 0 };
        g.lancado = arredondar(g.lancado + m.lancado);
        g.previsto = arredondar(g.previsto + m.previsto);
        g.total = arredondar(g.total + m.total);
        geral.set(m.mes, g);
      }
    }
    res.json({
      cartoes: resposta,
      meses: [...geral.values()].sort((a, b) => (a.mes < b.mes ? -1 : 1)),
      parcelasRestantes: resposta.reduce((soma, c) => soma + c.parcelasRestantes, 0),
      previsto: arredondar(resposta.reduce((soma, c) => soma + c.previsto, 0)),
      total: arredondar(resposta.reduce((soma, c) => soma + c.total, 0)),
    });
  })
);

function mesesEntre(de: Date, ate: Date): number {
  return (ate.getUTCFullYear() - de.getUTCFullYear()) * 12 + (ate.getUTCMonth() - de.getUTCMonth());
}

export default router;
