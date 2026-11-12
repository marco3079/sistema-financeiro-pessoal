// Sincronização do Open Finance: traz da Pluggy as contas, os cartões, as faturas, os lançamentos
// e os investimentos de uma conexão e grava nas tabelas do sistema (origem OPEN_FINANCE).
// Regras:
// - Cada registro é reconhecido pelo id da Pluggy (pluggyAccountId, pluggyTransactionId, ...): sincronizar de novo atualiza, não duplica.
// - O que o usuário pode mudar num registro do Open Finance é preservado: nome e cor da conta, nome do investimento,
//   categoria, observação e marcação de transferência do lançamento.
// - Nada do que foi digitado à mão (origem MANUAL) é tocado.

import type { Prisma, StatusConexao, TipoConta, TipoInvestimento, TipoMovimentoInvestimento } from '@prisma/client';
import { prisma } from './prisma';
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
): Promise<{ porIdPluggy: Map<string, number>; abertaId: number | null; ultimoFechamento: Date | null }> {
  const porIdPluggy = new Map<string, number>();
  const agora = hoje();
  let ultimoFechamento: Date | null = null;

  const faturas = await listarFaturasDaConta(conta.id).catch(() => []);
  for (const fatura of faturas) {
    const vencimento = diaDe(fatura.dueDate);
    if (!vencimento) continue;
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
  const vencimentoAberta = diaDe(conta.creditData?.balanceDueDate);
  if (vencimentoAberta && vencimentoAberta.getTime() >= agora.getTime()) {
    const fechamentoAberta = diaDe(conta.creditData?.balanceCloseDate);
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
  return { porIdPluggy, abertaId, ultimoFechamento };
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
  faturas: { porIdPluggy: Map<string, number>; abertaId: number | null; ultimoFechamento: Date | null },
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
        if (!faturas.ultimoFechamento || data.getTime() > faturas.ultimoFechamento.getTime()) {
          faturaId = faturas.abertaId;
        }
      }
    }
    const parcelado = typeof meta?.totalInstallments === 'number' && meta.totalInstallments > 1;
    const comuns = {
      data,
      descricao: texto(t.description, 200) ?? texto(t.descriptionRaw, 200) ?? 'Lançamento',
      valor: Math.abs(dinheiro(t.amount)),
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
      transferencia: (cartao && tipo === 'RECEITA') || TRECHOS_TRANSFERENCIA.some((trecho) => categoriaPluggy.includes(trecho)),
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
    for (const conta of contas) {
      const local = await gravarConta(referencia, conta);
      const faturas =
        local.tipo === 'CARTAO'
          ? await gravarFaturas(local, conta)
          : { porIdPluggy: new Map<string, number>(), abertaId: null, ultimoFechamento: null };
      await gravarLancamentos(local, conta, de, faturas, classificador);
    }
    await gravarInvestimentos(referencia, conexao.pluggyItemId);

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
  const execucao = executar(conexaoId, opcoes.pedirAtualizacao ?? false).finally(() => emAndamento.delete(conexaoId));
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
