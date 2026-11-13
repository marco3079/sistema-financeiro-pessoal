// Sincronização do Open Finance: traz da Pluggy as contas, os cartões, as faturas, os lançamentos
// e os investimentos de uma conexão e grava nas tabelas do sistema (origem OPEN_FINANCE).
// Regras:
// - Cada registro é reconhecido pelo id da Pluggy (pluggyAccountId, pluggyTransactionId, ...): sincronizar de novo atualiza, não duplica.
// - O que o usuário pode mudar num registro do Open Finance é preservado: nome e cor da conta, nome do investimento,
//   categoria, observação e marcação de transferência do lançamento.
// - Nada do que foi digitado à mão (origem MANUAL) é tocado.

import type { Prisma, StatusConexao, TipoConta, TipoInvestimento, TipoMovimentoInvestimento } from '@prisma/client';
import { comPerfil, prisma } from './prisma';
import { ehPagamentoDeFaturaNaConta, marcarPixNoCreditoNasContas } from './pixNoCredito';
import { gravarProventosDasContas } from './proventosOpenFinance';
import { arredondar, dataISO, hoje, paraData, registrarPosicaoPatrimonio } from './financas';
import {
  listarContasDoItem,
  listarFaturasDaConta,
  listarInvestimentosDoItem,
  listarMovimentosDoInvestimento,
  listarTransacoesDaConta,
  obterItem,
  pedirAtualizacaoDoItem,
} from './pluggy';
import type { PluggyConta, PluggyInvestimento, PluggyItem, PluggyTransacao } from './pluggy';

const MS_DIA = 24 * 60 * 60 * 1000;
const DIAS_PRIMEIRA_CARGA = 365;
const DIAS_RECARGA = 90;
const ESPERA_MAXIMA_MS = 90 * 1000;
const INTERVALO_ESPERA_MS = 3000;
const MAXIMO_INVESTIMENTOS_COM_MOVIMENTOS = 60;
const TAMANHO_LOTE = 500;

// ---------- Auxiliares ----------

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// "2026-11-10T00:00:00.000Z" ou "2026-11-10" -> Date à meia-noite UTC do mesmo dia; null se inválida.
function diaDe(texto: string | null | undefined): Date | null {
  if (!texto || !/^\d{4}-\d{2}-\d{2}/.test(texto)) return null;
  return paraData(texto.slice(0, 10));
}

function texto(valor: string | null | undefined, maximo = 200): string | null {
  const limpo = (valor ?? '').trim();
  return limpo === '' ? null : limpo.slice(0, maximo);
}

function corDoConector(cor: string | null | undefined): string | null {
  const limpa = (cor ?? '').trim().replace(/^#/, '');
  return /^[0-9a-fA-F]{6}$/.test(limpa) ? `#${limpa}` : null;
}

function dinheiro(valor: number | null | undefined): number {
  return typeof valor === 'number' && Number.isFinite(valor) ? arredondar(valor) : 0;
}

// Valor do lançamento em reais. Compra em moeda estrangeira vem com `amount` na moeda da compra e o valor
// convertido em `amountInAccountCurrency`; é esse que o banco cobra na fatura.
function valorEmReais(t: { amount: number; currencyCode?: string | null; amountInAccountCurrency?: number | null }): number {
  const convertido = t.amountInAccountCurrency;
  const usar = t.currencyCode && t.currencyCode !== 'BRL' && typeof convertido === 'number' && Number.isFinite(convertido) && convertido !== 0;
  return Math.abs(dinheiro(usar ? convertido : t.amount));
}

function emLotes<T>(lista: T[]): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < lista.length; i += TAMANHO_LOTE) lotes.push(lista.slice(i, i + TAMANHO_LOTE));
  return lotes;
}

// Situação do item na Pluggy -> situação da conexão no sistema.
function situacaoDoItem(item: PluggyItem): { status: StatusConexao; erro: string | null } {
  const detalhe = texto(item.error?.message ?? item.error?.providerMessage, 300);
  switch (item.status) {
    case 'UPDATED':
      return { status: 'ATUALIZADA', erro: null };
    case 'UPDATING':
      return { status: 'ATUALIZANDO', erro: null };
    case 'LOGIN_ERROR':
    case 'WAITING_USER_INPUT':
      return {
        status: 'ERRO_LOGIN',
        erro: detalhe ?? 'A instituição pediu uma nova autorização. Use "Reconectar".',
      };
    default:
      return { status: 'ERRO', erro: detalhe ?? 'A instituição não respondeu na última atualização.' };
  }
}

// Espera a Pluggy terminar de coletar os dados (logo depois de conectar ou de pedir atualização).
async function aguardarItem(itemId: string): Promise<PluggyItem> {
  const limite = Date.now() + ESPERA_MAXIMA_MS;
  let item = await obterItem(itemId);
  while (item.status === 'UPDATING' && Date.now() < limite) {
    await esperar(INTERVALO_ESPERA_MS);
    item = await obterItem(itemId);
  }
  return item;
}

// ---------- Contas e cartões ----------

function tipoDaConta(conta: PluggyConta): TipoConta {
  if (conta.type === 'CREDIT') return 'CARTAO';
  return conta.subtype === 'SAVINGS_ACCOUNT' ? 'POUPANCA' : 'CORRENTE';
}

async function gravarConta(conexao: { id: number; instituicao: string; instituicaoCor: string | null }, conta: PluggyConta) {
  const tipo = tipoDaConta(conta);
  const cartao = tipo === 'CARTAO';
  const credito = conta.creditData ?? null;
  const saldo = cartao ? Math.max(0, dinheiro(conta.balance)) : dinheiro(conta.balance);
  const limite = cartao && typeof credito?.creditLimit === 'number' ? dinheiro(credito.creditLimit) : null;
  const disponivel =
    cartao && typeof credito?.availableCreditLimit === 'number' ? dinheiro(credito.availableCreditLimit) : null;
  const atualizaveis = {
    tipo,
    instituicao: conexao.instituicao,
    numero: texto(conta.number, 40),
    saldo,
    bandeira: cartao ? texto(credito?.brand, 40) : null,
    limite,
    limiteDisponivel: disponivel,
    diaFechamento: cartao ? (diaDe(credito?.balanceCloseDate)?.getUTCDate() ?? null) : null,
    diaVencimento: cartao ? (diaDe(credito?.balanceDueDate)?.getUTCDate() ?? null) : null,
    origem: 'OPEN_FINANCE' as const,
    conexaoId: conexao.id,
  };
  return prisma.conta.upsert({
    where: { pluggyAccountId: conta.id },
    // Nome, cor e ativo são do usuário depois da primeira carga.
    update: atualizaveis,
    create: {
      ...atualizaveis,
      pluggyAccountId: conta.id,
      nome: texto(conta.marketingName, 120) ?? texto(conta.name, 120) ?? (cartao ? 'Cartão' : 'Conta'),
      cor: conexao.instituicaoCor ?? '#2563eb',
    },
  });
}

// ---------- Faturas ----------

// Grava as faturas fechadas que a Pluggy devolve e a fatura em aberto (montada a partir do saldo do cartão).
// Devolve: id da fatura na Pluggy -> id da Fatura no sistema, e o id da fatura em aberto (ou null).
async function gravarFaturas(
  contaLocal: { id: number; saldo: Prisma.Decimal },
  conta: PluggyConta
): Promise<FaturasDaConta> {
  const porIdPluggy = new Map<string, number>();
  const agora = hoje();
  let ultimoFechamento: Date | null = null;
  let ultimoVencimento: Date | null = null;

  const faturas = await listarFaturasDaConta(conta.id).catch(() => []);
  for (const fatura of faturas) {
    const vencimento = diaDe(fatura.dueDate);
    if (!vencimento) continue;
    if (!ultimoVencimento || vencimento.getTime() > ultimoVencimento.getTime()) ultimoVencimento = vencimento;
    const fechamento = diaDe(fatura.billClosingDate);
    if (fechamento && (!ultimoFechamento || fechamento.getTime() > ultimoFechamento.getTime())) {
      ultimoFechamento = fechamento;
    }
    const total = dinheiro(fatura.totalAmount);
    const pagamentos = fatura.payments ?? [];
    const pago = pagamentos.reduce((soma, p) => soma + dinheiro(p.amount), 0);
    // A Pluggy não informa "paga/não paga": vale o pagamento registrado ou, na falta dele, o vencimento já ter passado.
    const paga = (total > 0 && pago >= total - 0.01) || vencimento.getTime() < agora.getTime();
    const ultimoPagamento = pagamentos
      .map((p) => diaDe(p.paymentDate))
      .filter((d): d is Date => d !== null)
      .sort((a, b) => b.getTime() - a.getTime())[0];
    const dados = {
      vencimento,
      fechamento,
      total,
      minimo: typeof fatura.minimumPaymentAmount === 'number' ? dinheiro(fatura.minimumPaymentAmount) : null,
      status: paga ? ('PAGA' as const) : ('FECHADA' as const),
      pagaEm: paga ? (ultimoPagamento ?? vencimento) : null,
      origem: 'OPEN_FINANCE' as const,
      pluggyBillId: fatura.id,
    };
    // A fatura pode já existir com o mesmo vencimento (era a "em aberto" montada pelo sistema): ela é promovida.
    const existente =
      (await prisma.fatura.findUnique({ where: { pluggyBillId: fatura.id }, select: { id: true } })) ??
      (await prisma.fatura.findUnique({
        where: { contaId_vencimento: { contaId: contaLocal.id, vencimento } },
        select: { id: true },
      }));
    const gravada = existente
      ? await prisma.fatura.update({ where: { id: existente.id }, data: dados, select: { id: true } })
      : await prisma.fatura.create({ data: { ...dados, contaId: contaLocal.id }, select: { id: true } });
    porIdPluggy.set(fatura.id, gravada.id);
  }

  // Fatura em aberto: a Pluggy só lista faturas fechadas; o que está em aberto é o saldo do cartão.
  let abertaId: number | null = null;
  let abertaEstimada = false;
  let vencimentoAberta = diaDe(conta.creditData?.balanceDueDate);
  let fechamentoAberta = diaDe(conta.creditData?.balanceCloseDate);
  // Vários bancos (e o MeuPluggy) não informam o vencimento da fatura em aberto. Nesse caso ela é estimada pela
  // última fatura fechada: mesmo dia, nos meses seguintes, até cair de hoje em diante.
  if ((!vencimentoAberta || vencimentoAberta.getTime() < agora.getTime()) && ultimoVencimento) {
    let meses = 1;
    while (maisMeses(ultimoVencimento, meses).getTime() < agora.getTime() && meses < 24) meses++;
    vencimentoAberta = maisMeses(ultimoVencimento, meses);
    fechamentoAberta = ultimoFechamento ? maisMeses(ultimoFechamento, meses) : null;
    abertaEstimada = true;
  }
  if (vencimentoAberta && vencimentoAberta.getTime() >= agora.getTime()) {
    const existente = await prisma.fatura.findUnique({
      where: { contaId_vencimento: { contaId: contaLocal.id, vencimento: vencimentoAberta } },
      select: { id: true, pluggyBillId: true },
    });
    if (!existente) {
      const criada = await prisma.fatura.create({
        data: {
          contaId: contaLocal.id,
          vencimento: vencimentoAberta,
          fechamento: fechamentoAberta,
          total: Math.max(0, Number(contaLocal.saldo)),
          minimo:
            typeof conta.creditData?.minimumPayment === 'number' ? dinheiro(conta.creditData.minimumPayment) : null,
          status: fechamentoAberta && fechamentoAberta.getTime() < agora.getTime() ? 'FECHADA' : 'ABERTA',
          origem: 'OPEN_FINANCE',
        },
        select: { id: true },
      });
      abertaId = criada.id;
    } else if (existente.pluggyBillId === null) {
      await prisma.fatura.update({
        where: { id: existente.id },
        data: {
          total: Math.max(0, Number(contaLocal.saldo)),
          fechamento: fechamentoAberta,
          status: fechamentoAberta && fechamentoAberta.getTime() < agora.getTime() ? 'FECHADA' : 'ABERTA',
        },
      });
      abertaId = existente.id;
    }
  }
  return { porIdPluggy, abertaId, ultimoFechamento, abertaFechamento: abertaId !== null ? fechamentoAberta : null, abertaEstimada };
}

interface FaturasDaConta {
  porIdPluggy: Map<string, number>;
  abertaId: number | null;
  ultimoFechamento: Date | null;
  abertaFechamento: Date | null; // até quando as compras entram na fatura em aberto
  abertaEstimada: boolean; // datas calculadas pelo sistema: o total vem da soma das compras
}

// Mesma data, `meses` meses depois (dia 31 em mês curto vira o último dia).
function maisMeses(data: Date, meses: number): Date {
  const alvo = new Date(Date.UTC(data.getUTCFullYear(), data.getUTCMonth() + meses, 1));
  const ultimoDia = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(data.getUTCDate(), ultimoDia));
  return alvo;
}

// Fatura em aberto pela "fatura prevista" que o banco informa em cada lançamento pendente do cartão
// (creditCardMetadata.billForecastDate). É o dado mais fiel que o Open Finance traz sobre a fatura atual:
// inclui as parcelas de compras antigas, que chegam com a data da compra original.
// Devolve false quando o banco não informa a fatura prevista (aí vale a estimativa pelas datas).
async function fecharFaturaPelaPrevisao(
  contaId: number,
  contaPluggy: PluggyConta,
  abertaId: number,
  faturas: FaturasDaConta
): Promise<boolean> {
  const desde = new Date(hoje().getTime() - 400 * MS_DIA);
  const lista = (await listarTransacoesDaConta(contaPluggy.id, dataISO(desde)).catch(() => [])) as unknown as LancamentoComPrevisao[];
  const previsao = (t: LancamentoComPrevisao): string | null => {
    const bruto = t.creditCardMetadata?.billForecastDate;
    return typeof bruto === 'string' && /^\d{4}-\d{2}/.test(bruto) ? bruto.slice(0, 7) : null;
  };
  const pendentes = lista.filter((t) => t.status === 'PENDING' && previsao(t) !== null);
  if (pendentes.length === 0) return false;

  // Fatura atual: a previsão mais comum entre as compras pendentes dos últimos 45 dias.
  const agora = hoje().getTime();
  const contagem = new Map<string, number>();
  for (const t of pendentes) {
    const data = diaDe(t.date);
    if (!data || t.type !== 'DEBIT' || data.getTime() > agora || data.getTime() < agora - 45 * MS_DIA) continue;
    const p = previsao(t) as string;
    contagem.set(p, (contagem.get(p) ?? 0) + 1);
  }
  const atual = [...contagem].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0]?.[0];
  if (!atual) return false;

  const ehPagamento = (t: LancamentoComPrevisao) =>
    t.type === 'CREDIT' && /pagamento|payment|transfer/i.test(`${t.description ?? ''} ${t.category ?? ''}`);
  // Compra parcelada com parcela de fatura antiga que nunca foi lançada: o banco continua prevendo as parcelas, mas
  // não as cobra nem as soma no saldo devedor (compra cancelada ou estornada). Fica fora da fatura.
  const serie = (t: LancamentoComPrevisao) =>
    `${t.creditCardMetadata?.purchaseDate ?? ''}|${t.creditCardMetadata?.totalInstallments ?? ''}|${valorEmReais(t).toFixed(2)}`;
  const seriesParadas = new Set(
    pendentes.filter((t) => t.type === 'DEBIT' && (previsao(t) as string) < atual && t.creditCardMetadata?.totalInstallments).map(serie)
  );
  // Também é do ciclo a compra pendente feita depois do último fechamento, mesmo que o banco a marque com a
  // previsão da fatura anterior (acontece com compras dos dias seguintes ao fechamento).
  const depoisDoFechamento = (t: LancamentoComPrevisao) => {
    const data = diaDe(t.date);
    if (!data || !faturas.ultimoFechamento || data.getTime() <= faturas.ultimoFechamento.getTime()) return false;
    return !faturas.abertaFechamento || data.getTime() <= faturas.abertaFechamento.getTime();
  };
  const candidatos = pendentes.filter(
    (t) =>
      (previsao(t) === atual || ((previsao(t) as string) < atual && depoisDoFechamento(t))) &&
      !ehPagamento(t) &&
      !(t.type === 'DEBIT' && t.creditCardMetadata?.totalInstallments && seriesParadas.has(serie(t)))
  );

  // A mesma compra pendente às vezes vem duas vezes (uma com a cidade na descrição, outra sem): mesma data, mesmo
  // valor e uma descrição começando com a outra. Fica a mais completa; duas compras de descrição idêntica são
  // compras diferentes e ficam as duas.
  const limpa = (t: LancamentoComPrevisao) => (t.description ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
  const repetidos = new Set<string>();
  for (const a of candidatos) {
    if (a.type !== 'DEBIT' || repetidos.has(a.id)) continue;
    for (const b of candidatos) {
      if (b === a || b.type !== 'DEBIT' || repetidos.has(b.id)) continue;
      if (String(a.date).slice(0, 10) !== String(b.date).slice(0, 10) || Math.abs(valorEmReais(a) - valorEmReais(b)) > 0.005) continue;
      const da = limpa(a);
      const db = limpa(b);
      if (da.length > 3 && db.length > da.length && db.startsWith(da)) repetidos.add(a.id);
    }
  }
  const doCiclo = candidatos.filter((t) => !repetidos.has(t.id));
  let somaDoCiclo = doCiclo.reduce((soma, t) => soma + (t.type === 'CREDIT' ? -valorEmReais(t) : valorEmReais(t)), 0);

  // Quando o banco também lista as parcelas das próximas faturas, a fatura atual é o saldo devedor do cartão menos
  // essas parcelas: assim entram encargos e ajustes que não vêm como lançamento. Ficam de fora da conta as séries
  // com parcela antiga que nunca foi lançada (o banco não as soma no saldo devedor).
  const futuras = pendentes.filter((t) => t.type === 'DEBIT' && (previsao(t) as string) > atual);
  let total = somaDoCiclo;
  if (futuras.length > 0 && typeof contaPluggy.balance === 'number' && contaPluggy.balance > 0) {
    const aVencer = futuras.filter((t) => !seriesParadas.has(serie(t))).reduce((soma, t) => soma + valorEmReais(t), 0);
    const peloSaldo = contaPluggy.balance - aVencer;
    if (peloSaldo >= somaDoCiclo - 0.005) total = peloSaldo;
  }

  // Os lançamentos do ciclo ficam ligados à fatura em aberto; o que estava ligado só pela data e não é dela sai.
  const ids = doCiclo.map((t) => t.id);
  await prisma.transacao.updateMany({
    where: { contaId, faturaId: abertaId, OR: [{ pluggyTransactionId: null }, { pluggyTransactionId: { notIn: ids } }] },
    data: { faturaId: null },
  });
  for (const lote of emLotes(ids)) {
    await prisma.transacao.updateMany({ where: { contaId, pluggyTransactionId: { in: lote } }, data: { faturaId: abertaId } });
  }
  // A cópia repetida sai das despesas (vira transferência, com a explicação na observação).
  if (repetidos.size > 0) {
    await prisma.transacao.updateMany({
      where: { contaId, pluggyTransactionId: { in: [...repetidos] }, transferencia: false },
      data: { transferencia: true, faturaId: null, observacao: 'Compra pendente enviada duas vezes pelo banco: esta cópia não conta.' },
    });
  }

  // Parcelas que o banco ainda não enviou: compras parceladas da última fatura fechada com parcela a vencer e sem
  // lançamento de mesmo valor neste ciclo entram como "parcela prevista". São recriadas a cada sincronização e
  // somem quando o banco manda a parcela de verdade.
  await prisma.transacao.deleteMany({ where: { contaId, pluggyTransactionId: { startsWith: PREFIXO_PREVISTA } } });
  const abertaInfo = await prisma.fatura.findUnique({ where: { id: abertaId }, select: { vencimento: true } });
  const anterior = abertaInfo
    ? await prisma.fatura.findFirst({
        where: { contaId, vencimento: { lt: abertaInfo.vencimento }, pluggyBillId: { not: null } },
        orderBy: { vencimento: 'desc' },
        select: { id: true },
      })
    : null;
  let previstas = 0;
  if (anterior) {
    const continuam = await prisma.transacao.findMany({
      where: { faturaId: anterior.id, tipo: 'DESPESA', transferencia: false, parcela: { not: null } },
      select: { id: true, data: true, descricao: true, valor: true, parcela: true, totalParcelas: true, categoriaId: true },
    });
    const valoresDoCiclo = doCiclo.filter((t) => t.type === 'DEBIT').map((t) => ({ valor: valorEmReais(t), usado: false }));
    const novas: Prisma.TransacaoCreateManyInput[] = [];
    for (const t of continuam) {
      if (t.parcela === null || t.totalParcelas === null || t.parcela >= t.totalParcelas) continue;
      const igual = valoresDoCiclo.find((v) => !v.usado && Math.abs(v.valor - Number(t.valor)) <= 0.005);
      if (igual) {
        igual.usado = true;
        continue;
      }
      previstas += Number(t.valor);
      novas.push({
        contaId,
        faturaId: abertaId,
        data: t.data,
        descricao: t.descricao,
        valor: t.valor,
        tipo: 'DESPESA',
        pendente: true,
        parcela: t.parcela + 1,
        totalParcelas: t.totalParcelas,
        categoriaId: t.categoriaId,
        origem: 'OPEN_FINANCE',
        observacao: 'Parcela prevista: o banco ainda não enviou este lançamento.',
        pluggyTransactionId: `${PREFIXO_PREVISTA}${t.id}:${t.parcela + 1}`,
      });
    }
    if (novas.length > 0) await prisma.transacao.createMany({ data: novas, skipDuplicates: true });
  }
  // Sem o saldo devedor para conferir, o total é a soma dos itens (com as parcelas previstas).
  if (Math.abs(total - somaDoCiclo) < 0.005) total = somaDoCiclo + previstas;
  somaDoCiclo += previstas;
  await prisma.fatura.update({ where: { id: abertaId }, data: { total: Math.max(0, arredondar(total)) } });
  return true;
}

const PREFIXO_PREVISTA = 'prevista:';

type LancamentoComPrevisao = PluggyTransacao & {
  status?: string;
  category?: string | null;
  creditCardMetadata?: { billForecastDate?: string | null; purchaseDate?: string | null; totalInstallments?: number | null } | null;
};

// Fatura em aberto estimada: liga as compras do ciclo que ainda estavam sem fatura e soma o total por elas.
async function fecharFaturaEstimada(contaId: number, faturas: FaturasDaConta, contaPluggy: PluggyConta): Promise<void> {
  if (faturas.abertaId === null || !faturas.abertaEstimada) return;
  if (await fecharFaturaPelaPrevisao(contaId, contaPluggy, faturas.abertaId, faturas)) return;
  await prisma.transacao.updateMany({
    where: {
      contaId,
      faturaId: null,
      origem: 'OPEN_FINANCE',
      transferencia: false,
      ...(faturas.ultimoFechamento || faturas.abertaFechamento
        ? {
            // Compra do próprio dia do fechamento que ficou sem fatura fechada é da fatura em aberto.
            data: {
              ...(faturas.ultimoFechamento ? { gte: faturas.ultimoFechamento } : {}),
              ...(faturas.abertaFechamento ? { lte: faturas.abertaFechamento } : {}),
            },
          }
        : {}),
    },
    data: { faturaId: faturas.abertaId },
  });
  const somas = await prisma.transacao.groupBy({
    by: ['tipo'],
    where: { faturaId: faturas.abertaId, transferencia: false },
    _sum: { valor: true },
  });
  const compras = Number(somas.find((s) => s.tipo === 'DESPESA')?._sum.valor ?? 0);
  const estornos = Number(somas.find((s) => s.tipo === 'RECEITA')?._sum.valor ?? 0);

  // Parcelas de compras antigas: alguns bancos só mandam a parcela quando a fatura fecha. As compras parceladas
  // da última fatura fechada que ainda têm parcela a vencer entram no total como previsão, a não ser que a
  // parcela seguinte já tenha chegado como lançamento desta fatura.
  let parcelasPrevistas = 0;
  const aberta = await prisma.fatura.findUnique({ where: { id: faturas.abertaId }, select: { vencimento: true } });
  const anterior = aberta
    ? await prisma.fatura.findFirst({
        where: { contaId, vencimento: { lt: aberta.vencimento }, pluggyBillId: { not: null } },
        orderBy: { vencimento: 'desc' },
        select: { id: true },
      })
    : null;
  if (anterior) {
    const [continuam, jaVieram] = await Promise.all([
      prisma.transacao.findMany({
        where: { faturaId: anterior.id, tipo: 'DESPESA', transferencia: false, parcela: { not: null } },
        select: { valor: true, parcela: true, totalParcelas: true },
      }),
      prisma.transacao.findMany({
        where: { faturaId: faturas.abertaId, tipo: 'DESPESA', parcela: { not: null } },
        select: { valor: true, parcela: true, totalParcelas: true },
      }),
    ]);
    const chegadas = jaVieram.map((t) => ({ chave: `${t.parcela}/${t.totalParcelas}|${Number(t.valor).toFixed(2)}`, usada: false }));
    for (const t of continuam) {
      if (t.parcela === null || t.totalParcelas === null || t.parcela >= t.totalParcelas) continue;
      const proxima = chegadas.find((c) => !c.usada && c.chave === `${t.parcela! + 1}/${t.totalParcelas}|${Number(t.valor).toFixed(2)}`);
      if (proxima) {
        proxima.usada = true;
        continue;
      }
      parcelasPrevistas += Number(t.valor);
    }
  }
  await prisma.fatura.update({
    where: { id: faturas.abertaId },
    data: { total: Math.max(0, arredondar(compras - estornos + parcelasPrevistas)) },
  });
}

// ---------- Lançamentos ----------

// Categoria da Pluggy (texto em inglês) -> nome de uma categoria padrão do sistema.
const MAPA_CATEGORIAS: { trecho: string; nome: string }[] = [
  { trecho: 'salary', nome: 'Salário' },
  { trecho: 'retirement', nome: 'Salário' },
  { trecho: 'interest', nome: 'Rendimentos' },
  { trecho: 'dividend', nome: 'Rendimentos' },
  { trecho: 'proceeds', nome: 'Rendimentos' },
  { trecho: 'refund', nome: 'Reembolsos' },
  { trecho: 'cashback', nome: 'Reembolsos' },
  { trecho: 'groceries', nome: 'Mercado' },
  { trecho: 'supermarket', nome: 'Mercado' },
  { trecho: 'eating out', nome: 'Restaurantes' },
  { trecho: 'restaurant', nome: 'Restaurantes' },
  { trecho: 'food delivery', nome: 'Restaurantes' },
  { trecho: 'food and drinks', nome: 'Restaurantes' },
  { trecho: 'rent', nome: 'Moradia' },
  { trecho: 'housing', nome: 'Moradia' },
  { trecho: 'utilities', nome: 'Contas da casa' },
  { trecho: 'electricity', nome: 'Contas da casa' },
  { trecho: 'water', nome: 'Contas da casa' },
  { trecho: 'internet', nome: 'Contas da casa' },
  { trecho: 'telecommunications', nome: 'Contas da casa' },
  { trecho: 'mobile', nome: 'Contas da casa' },
  { trecho: 'taxi', nome: 'Transporte' },
  { trecho: 'ride-hailing', nome: 'Transporte' },
  { trecho: 'transport', nome: 'Transporte' },
  { trecho: 'gas station', nome: 'Transporte' },
  { trecho: 'parking', nome: 'Transporte' },
  { trecho: 'tolls', nome: 'Transporte' },
  { trecho: 'automotive', nome: 'Transporte' },
  { trecho: 'pharmacy', nome: 'Saúde' },
  { trecho: 'health', nome: 'Saúde' },
  { trecho: 'hospital', nome: 'Saúde' },
  { trecho: 'dentist', nome: 'Saúde' },
  { trecho: 'wellness', nome: 'Saúde' },
  { trecho: 'education', nome: 'Educação' },
  { trecho: 'school', nome: 'Educação' },
  { trecho: 'university', nome: 'Educação' },
  { trecho: 'courses', nome: 'Educação' },
  { trecho: 'streaming', nome: 'Assinaturas' },
  { trecho: 'digital services', nome: 'Assinaturas' },
  { trecho: 'entertainment', nome: 'Lazer' },
  { trecho: 'leisure', nome: 'Lazer' },
  { trecho: 'travel', nome: 'Lazer' },
  { trecho: 'tickets', nome: 'Lazer' },
  { trecho: 'gaming', nome: 'Lazer' },
  { trecho: 'shopping', nome: 'Compras' },
  { trecho: 'clothing', nome: 'Compras' },
  { trecho: 'electronics', nome: 'Compras' },
  { trecho: 'tax', nome: 'Impostos e taxas' },
  { trecho: 'bank fees', nome: 'Impostos e taxas' },
  { trecho: 'fees', nome: 'Impostos e taxas' },
];

// Categorias da Pluggy que são movimento entre contas próprias (não contam como receita/despesa).
const TRECHOS_TRANSFERENCIA = ['credit card payment', 'same person transfer', 'investment', 'fixed income', 'mutual fund'];

interface Classificador {
  categoriaDe(categoriaPluggy: string | null | undefined, tipo: 'RECEITA' | 'DESPESA'): number | null;
}

async function montarClassificador(): Promise<Classificador> {
  const categorias = await prisma.categoria.findMany({ select: { id: true, nome: true, tipo: true } });
  const idPorChave = new Map(categorias.map((c) => [`${c.tipo}:${c.nome}`, c.id]));
  return {
    categoriaDe(categoriaPluggy, tipo) {
      const chave = (categoriaPluggy ?? '').toLowerCase();
      if (chave === '') return null;
      const achada = MAPA_CATEGORIAS.find((m) => chave.includes(m.trecho));
      return achada ? (idPorChave.get(`${tipo}:${achada.nome}`) ?? null) : null;
    },
  };
}

// Sentido do lançamento. A Pluggy marca DEBIT (saiu/comprou) ou CREDIT (entrou/pagou);
// sem a marca, vale o sinal: em conta, negativo é saída; em cartão, positivo é compra.
function tipoDoLancamento(t: PluggyTransacao, cartao: boolean): 'RECEITA' | 'DESPESA' {
  if (t.type === 'DEBIT') return 'DESPESA';
  if (t.type === 'CREDIT') return 'RECEITA';
  if (cartao) return t.amount >= 0 ? 'DESPESA' : 'RECEITA';
  return t.amount < 0 ? 'DESPESA' : 'RECEITA';
}

async function gravarLancamentos(
  contaLocal: { id: number; tipo: TipoConta },
  contaPluggy: PluggyConta,
  de: Date,
  faturas: FaturasDaConta,
  classificador: Classificador
): Promise<void> {
  const cartao = contaLocal.tipo === 'CARTAO';
  const lista = await listarTransacoesDaConta(contaPluggy.id, dataISO(de));
  if (lista.length === 0) return;

  const existentes = new Map<string, number>();
  for (const lote of emLotes(lista.map((t) => t.id))) {
    const achados = await prisma.transacao.findMany({
      where: { pluggyTransactionId: { in: lote } },
      select: { id: true, pluggyTransactionId: true },
    });
    for (const a of achados) if (a.pluggyTransactionId) existentes.set(a.pluggyTransactionId, a.id);
  }

  const novos: Prisma.TransacaoCreateManyInput[] = [];
  for (const t of lista) {
    const data = diaDe(t.date);
    if (!data) continue;
    const tipo = tipoDoLancamento(t, cartao);
    const meta = t.creditCardMetadata ?? null;
    let faturaId: number | null = null;
    if (cartao) {
      if (meta?.billId && faturas.porIdPluggy.has(meta.billId)) {
        faturaId = faturas.porIdPluggy.get(meta.billId) ?? null;
      } else if (!meta?.billId && faturas.abertaId !== null) {
        // Sem fatura fechada: é da fatura em aberto, se for posterior ao último fechamento conhecido.
        // As parcelas com data depois do fechamento desta fatura são das próximas.
        const depoisDoUltimo = !faturas.ultimoFechamento || data.getTime() >= faturas.ultimoFechamento.getTime();
        const ateOFechamento = !faturas.abertaFechamento || data.getTime() <= faturas.abertaFechamento.getTime();
        if (depoisDoUltimo && ateOFechamento) {
          faturaId = faturas.abertaId;
        }
      }
    }
    const parcelado = typeof meta?.totalInstallments === 'number' && meta.totalInstallments > 1;
    const comuns = {
      data,
      descricao: texto(t.description, 200) ?? texto(t.descriptionRaw, 200) ?? 'Lançamento',
      valor: valorEmReais(t),
      tipo,
      pendente: t.status === 'PENDING',
      faturaId,
      parcela: parcelado ? (meta?.installmentNumber ?? null) : null,
      totalParcelas: parcelado ? (meta?.totalInstallments ?? null) : null,
    };
    const idExistente = existentes.get(t.id);
    if (idExistente !== undefined) {
      // Categoria, observação e transferência são do usuário: não mudam aqui.
      await prisma.transacao.update({ where: { id: idExistente }, data: comuns });
      continue;
    }
    const categoriaPluggy = (t.category ?? '').toLowerCase();
    novos.push({
      ...comuns,
      contaId: contaLocal.id,
      categoriaId: classificador.categoriaDe(t.category, tipo),
      // Pagamento de fatura (entrada no cartão) e movimentos entre contas próprias não são receita nem despesa.
      transferencia:
        (cartao && tipo === 'RECEITA') ||
        TRECHOS_TRANSFERENCIA.some((trecho) => categoriaPluggy.includes(trecho)) ||
        (!cartao && tipo === 'DESPESA' && ehPagamentoDeFaturaNaConta(comuns.descricao)),
      origem: 'OPEN_FINANCE',
      pluggyTransactionId: t.id,
    });
  }
  for (const lote of emLotes(novos)) {
    await prisma.transacao.createMany({ data: lote, skipDuplicates: true });
  }
}

// ---------- Investimentos ----------

function tipoDoInvestimento(i: PluggyInvestimento): TipoInvestimento {
  const subtipo = (i.subtype ?? '').toUpperCase();
  if (subtipo.includes('REAL_ESTATE')) return 'FII';
  if (subtipo.includes('RETIREMENT') || subtipo.includes('PGBL') || subtipo.includes('VGBL')) return 'PREVIDENCIA';
  if (subtipo.includes('CRYPTO')) return 'CRIPTO';
  if (subtipo === 'ETF') return 'ETF';
  switch (i.type) {
    case 'FIXED_INCOME':
      return 'RENDA_FIXA';
    case 'MUTUAL_FUND':
      return 'FUNDO';
    case 'EQUITY':
      return 'ACAO';
    case 'ETF':
      return 'ETF';
    case 'SECURITY':
      return 'PREVIDENCIA';
    default:
      return 'OUTRO';
  }
}

function taxaDoInvestimento(i: PluggyInvestimento): string | null {
  const numero = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  if (typeof i.rate === 'number' && i.rateType) {
    const fixa = typeof i.fixedAnnualRate === 'number' && i.fixedAnnualRate > 0 ? ` + ${numero(i.fixedAnnualRate)}% a.a.` : '';
    return `${numero(i.rate)}% do ${i.rateType}${fixa}`;
  }
  if (typeof i.fixedAnnualRate === 'number' && i.fixedAnnualRate > 0) return `${numero(i.fixedAnnualRate)}% a.a.`;
  return null;
}

function rotuloSubtipo(subtipo: string | null | undefined): string | null {
  const limpo = texto(subtipo, 60);
  return limpo ? limpo.replace(/_/g, ' ') : null;
}

function tipoDoMovimento(tipo: string | undefined, sentido: string | undefined): TipoMovimentoInvestimento | null {
  switch (tipo) {
    case 'BUY':
      return 'APLICACAO';
    case 'SELL':
      return 'RESGATE';
    case 'TAX':
      return 'IMPOSTO';
    case 'INTEREST':
    case 'DIVIDEND':
    case 'AMORTIZATION':
      return 'RENDIMENTO';
    case 'TRANSFER':
      return null;
    default:
      if (sentido === 'CREDIT') return 'APLICACAO';
      if (sentido === 'DEBIT') return 'RESGATE';
      return null;
  }
}

async function gravarInvestimentos(conexao: { id: number; instituicao: string }, itemId: string): Promise<void> {
  const lista = await listarInvestimentosDoItem(itemId).catch(() => null);
  if (lista === null) return; // a instituição não oferece investimentos, ou a consulta falhou: mantém o que há

  const vistos: string[] = [];
  let comMovimentos = 0;
  for (const i of lista) {
    vistos.push(i.id);
    const saldo = dinheiro(i.balance);
    // Valor aplicado: o original informado; senão o saldo menos o lucro; senão o próprio saldo.
    const aplicado =
      typeof i.amountOriginal === 'number' && i.amountOriginal > 0
        ? dinheiro(i.amountOriginal)
        : typeof i.amountProfit === 'number'
          ? Math.max(0, arredondar(saldo - i.amountProfit))
          : saldo;
    const atualizaveis = {
      codigo: texto(i.code, 40),
      tipo: tipoDoInvestimento(i),
      subtipo: rotuloSubtipo(i.subtype),
      instituicao: texto(i.institution?.name, 120) ?? conexao.instituicao,
      emissor: texto(i.issuer, 120),
      valorAplicado: aplicado,
      saldo,
      quantidade: typeof i.quantity === 'number' && Number.isFinite(i.quantity) ? i.quantity : null,
      taxa: taxaDoInvestimento(i),
      vencimento: diaDe(i.dueDate),
      dataPosicao: i.date && !Number.isNaN(Date.parse(i.date)) ? new Date(i.date) : new Date(),
      ativo: i.status !== 'TOTAL_WITHDRAWAL' && saldo > 0,
      origem: 'OPEN_FINANCE' as const,
      conexaoId: conexao.id,
    };
    // O mesmo ativo pode já estar no sistema pela planilha da B3 (registro manual, com o histórico de compras e
    // proventos). Para não contar duas vezes, o ativo do Open Finance é ligado a esse registro: ele guarda o
    // histórico da B3 e passa a receber daqui só a posição atual (quantidade e saldo).
    const codigoBolsa = (atualizaveis.codigo ?? '').toUpperCase();
    if (/^[A-Z]{4}\d{1,2}$/.test(codigoBolsa)) {
      const ligado = await prisma.investimento.findUnique({
        where: { pluggyInvestmentId: i.id },
        select: { id: true, origem: true },
      });
      let daPlanilha = ligado && ligado.origem === 'MANUAL' ? ligado.id : null;
      if (daPlanilha === null) {
        const gemeo = await prisma.investimento.findFirst({
          where: { origem: 'MANUAL', pluggyInvestmentId: null, codigo: { equals: codigoBolsa, mode: 'insensitive' } },
          orderBy: [{ ativo: 'desc' }, { id: 'asc' }],
          select: { id: true },
        });
        if (gemeo) {
          // Sai o registro repetido do Open Finance (com os movimentos dele) e o da planilha assume a ligação.
          if (ligado) await prisma.investimento.delete({ where: { id: ligado.id } });
          await prisma.investimento.update({ where: { id: gemeo.id }, data: { pluggyInvestmentId: i.id } });
          daPlanilha = gemeo.id;
        }
      }
      if (daPlanilha !== null) {
        await prisma.investimento.update({
          where: { id: daPlanilha },
          data: {
            saldo: atualizaveis.saldo,
            quantidade: atualizaveis.quantidade,
            dataPosicao: atualizaveis.dataPosicao,
            ativo: atualizaveis.ativo,
          },
        });
        continue; // compras, vendas e proventos deste ativo vêm da planilha da B3 e dos créditos na conta
      }
    }

    const gravado = await prisma.investimento.upsert({
      where: { pluggyInvestmentId: i.id },
      update: atualizaveis, // o nome é do usuário depois da primeira carga
      create: { ...atualizaveis, pluggyInvestmentId: i.id, nome: texto(i.name, 120) ?? texto(i.code, 120) ?? 'Investimento' },
      select: { id: true },
    });

    if (comMovimentos < MAXIMO_INVESTIMENTOS_COM_MOVIMENTOS) {
      comMovimentos++;
      const movimentos = await listarMovimentosDoInvestimento(i.id).catch(() => []);
      const dados: Prisma.MovimentoInvestimentoCreateManyInput[] = [];
      for (const m of movimentos) {
        const tipo = tipoDoMovimento(m.type, m.movementType);
        const data = diaDe(m.tradeDate ?? m.date);
        const valor = Math.abs(dinheiro(m.amount ?? (m.value ?? 0) * (m.quantity ?? 0)));
        if (!tipo || !data || valor <= 0) continue;
        dados.push({
          investimentoId: gravado.id,
          data,
          tipo,
          valor,
          quantidade: typeof m.quantity === 'number' && Number.isFinite(m.quantity) ? Math.abs(m.quantity) : null,
          descricao: texto(m.description, 200),
          pluggyId: m.id,
        });
      }
      for (const lote of emLotes(dados)) {
        await prisma.movimentoInvestimento.createMany({ data: lote, skipDuplicates: true });
      }
    }
  }
  // O que a instituição deixou de devolver foi resgatado ou vendido.
  await prisma.investimento.updateMany({
    where: { conexaoId: conexao.id, origem: 'OPEN_FINANCE', pluggyInvestmentId: { notIn: vistos } },
    data: { ativo: false, saldo: 0 },
  });
}

// ---------- Sincronização de uma conexão ----------

const emAndamento = new Map<number, Promise<void>>();

async function executar(conexaoId: number, pedirAtualizacao: boolean): Promise<void> {
  const conexao = await prisma.conexaoBancaria.findUnique({ where: { id: conexaoId } });
  if (!conexao) return;
  try {
    if (pedirAtualizacao) {
      // Falha aqui não impede de ler o que a Pluggy já tem (ex.: conexões do MeuPluggy não aceitam o pedido).
      await pedirAtualizacaoDoItem(conexao.pluggyItemId).catch(() => undefined);
    }
    const item = await aguardarItem(conexao.pluggyItemId);
    const situacao = situacaoDoItem(item);
    const instituicao = texto(item.connector?.name, 120) ?? conexao.instituicao;
    const instituicaoCor = corDoConector(item.connector?.primaryColor) ?? conexao.instituicaoCor;
    await prisma.conexaoBancaria.update({
      where: { id: conexao.id },
      data: { instituicao, instituicaoCor, instituicaoLogo: texto(item.connector?.imageUrl, 500) ?? conexao.instituicaoLogo },
    });

    const primeiraCarga = conexao.ultimaSincronizacao === null;
    const de = new Date(hoje().getTime() - (primeiraCarga ? DIAS_PRIMEIRA_CARGA : DIAS_RECARGA) * MS_DIA);
    const classificador = await montarClassificador();
    const referencia = { id: conexao.id, instituicao, instituicaoCor };

    const contas = await listarContasDoItem(conexao.pluggyItemId);
    const idsDasContas: number[] = [];
    for (const conta of contas) {
      const local = await gravarConta(referencia, conta);
      idsDasContas.push(local.id);
      const faturas =
        local.tipo === 'CARTAO'
          ? await gravarFaturas(local, conta)
          : { porIdPluggy: new Map<string, number>(), abertaId: null, ultimoFechamento: null, abertaFechamento: null, abertaEstimada: false };
      await gravarLancamentos(local, conta, de, faturas, classificador);
      if (local.tipo === 'CARTAO') await fecharFaturaEstimada(local.id, faturas, conta);
    }
    // Pix pago no crédito: o crédito do cartão na conta e a saída de mesmo valor viram transferência.
    // Olha 2 anos para trás, para acertar também o que já estava no sistema antes desta regra.
    await marcarPixNoCreditoNasContas(idsDasContas, new Date(hoje().getTime() - 730 * MS_DIA));
    await gravarInvestimentos(referencia, conexao.pluggyItemId);
    // Proventos: os créditos de dividendos e rendimentos na conta viram movimento do ativo (olha 2 anos para trás;
    // não repete o que já foi criado).
    await gravarProventosDasContas(idsDasContas, conexao.id, new Date(hoje().getTime() - 730 * MS_DIA));

    await prisma.conexaoBancaria.update({
      where: { id: conexao.id },
      data: { status: situacao.status, erro: situacao.erro, ultimaSincronizacao: new Date() },
    });
    await registrarPosicaoPatrimonio();
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : 'Falha ao sincronizar';
    console.error(`Falha ao sincronizar a conexão ${conexaoId}:`, mensagem);
    await prisma.conexaoBancaria
      .update({ where: { id: conexaoId }, data: { status: 'ERRO', erro: mensagem.slice(0, 300) } })
      .catch(() => undefined);
  }
}

// Sincroniza uma conexão. Nunca lança: o resultado fica em ConexaoBancaria.status e .erro.
// Duas chamadas ao mesmo tempo para a mesma conexão compartilham a mesma execução.
export function sincronizarConexao(conexaoId: number, opcoes: { pedirAtualizacao?: boolean } = {}): Promise<void> {
  const atual = emAndamento.get(conexaoId);
  if (atual) return atual;
  // Roda dentro do perfil financeiro dono da conexão, para o que for criado (contas, lançamentos) cair nele.
  const execucao = prisma.conexaoBancaria
    .findFirst({ where: { id: conexaoId }, select: { perfilId: true } })
    .then((conexao) =>
      conexao ? comPerfil(conexao.perfilId, () => executar(conexaoId, opcoes.pedirAtualizacao ?? false)) : undefined
    )
    .finally(() => emAndamento.delete(conexaoId));
  emAndamento.set(conexaoId, execucao);
  return execucao;
}

export async function sincronizarTudo(opcoes: { pedirAtualizacao?: boolean } = {}): Promise<void> {
  const conexoes = await prisma.conexaoBancaria.findMany({ select: { id: true }, orderBy: { id: 'asc' } });
  for (const conexao of conexoes) {
    await sincronizarConexao(conexao.id, opcoes);
  }
}

// ---------- Sincronização automática ----------

const INTERVALO_AUTOMATICO_MS = 6 * 60 * 60 * 1000;
const ATRASO_INICIAL_MS = 60 * 1000;
let automaticaIniciada = false;

// Sincroniza todas as conexões um minuto depois de o servidor subir e, depois, a cada 6 horas.
export function iniciarSincronizacaoAutomatica(): void {
  if (automaticaIniciada) return;
  automaticaIniciada = true;
  const rodar = () => {
    sincronizarTudo({ pedirAtualizacao: true }).catch((erro: unknown) => {
      console.error('Falha na sincronização automática:', erro instanceof Error ? erro.message : erro);
    });
  };
  setTimeout(rodar, ATRASO_INICIAL_MS).unref();
  setInterval(rodar, INTERVALO_AUTOMATICO_MS).unref();
}
