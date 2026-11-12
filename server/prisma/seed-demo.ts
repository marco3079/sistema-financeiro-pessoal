import type {
  PrismaClient,
  StatusFatura,
  TipoInvestimento,
  TipoMovimentoInvestimento,
  TipoTransacao,
} from '@prisma/client';

// Dados de demonstração (fictícios). Só entram com SEED_DEMO=true.
// Este arquivo roda fora do servidor: não importa nada de src/.

const CATEGORIAS_PADRAO: { nome: string; tipo: TipoTransacao; cor: string }[] = [
  { nome: 'Moradia', tipo: 'DESPESA', cor: '#2563eb' },
  { nome: 'Mercado', tipo: 'DESPESA', cor: '#10b981' },
  { nome: 'Restaurantes', tipo: 'DESPESA', cor: '#f59e0b' },
  { nome: 'Transporte', tipo: 'DESPESA', cor: '#06b6d4' },
  { nome: 'Saúde', tipo: 'DESPESA', cor: '#dc2626' },
  { nome: 'Educação', tipo: 'DESPESA', cor: '#7c3aed' },
  { nome: 'Lazer', tipo: 'DESPESA', cor: '#ec4899' },
  { nome: 'Assinaturas', tipo: 'DESPESA', cor: '#f97316' },
  { nome: 'Compras', tipo: 'DESPESA', cor: '#84cc16' },
  { nome: 'Contas da casa', tipo: 'DESPESA', cor: '#64748b' },
  { nome: 'Impostos e taxas', tipo: 'DESPESA', cor: '#475569' },
  { nome: 'Outros', tipo: 'DESPESA', cor: '#94a3b8' },
  { nome: 'Salário', tipo: 'RECEITA', cor: '#10b981' },
  { nome: 'Rendimentos', tipo: 'RECEITA', cor: '#2563eb' },
  { nome: 'Freelance', tipo: 'RECEITA', cor: '#7c3aed' },
  { nome: 'Reembolsos', tipo: 'RECEITA', cor: '#06b6d4' },
  { nome: 'Outras receitas', tipo: 'RECEITA', cor: '#64748b' },
];

// Categorias padrão: sempre criadas (inclusive sem demonstração). Idempotente.
export async function criarCategoriasPadrao(prisma: PrismaClient): Promise<void> {
  await prisma.categoria.createMany({ data: CATEGORIAS_PADRAO, skipDuplicates: true });
}

// Lançamento em conta comum (corrente, poupança, carteira).
interface LancamentoDemo {
  contaId: number;
  data: Date;
  descricao: string;
  valor: number;
  tipo: TipoTransacao;
  categoriaId: number | null;
  transferencia: boolean;
}

// Compra no cartão (ainda sem fatura; a fatura é definida depois).
interface CompraDemo {
  data: Date;
  descricao: string;
  valor: number;
  categoriaId: number;
  parcela?: number;
  totalParcelas?: number;
}

interface GrupoFatura {
  vencimento: Date;
  fechamento: Date;
  compras: CompraDemo[];
  total: number;
  status: StatusFatura;
  faturaId: number;
}

interface InvestimentoDemo {
  nome: string;
  tipo: TipoInvestimento;
  codigo?: string;
  subtipo?: string;
  instituicao?: string;
  emissor?: string;
  valorAplicado: number;
  saldo: number;
  quantidade?: number;
  taxa?: string;
  vencimento?: Date;
  dataAplicacao: Date;
  dataRendimentos?: Date[];
}

interface MovimentoDemo {
  investimentoId: number;
  data: Date;
  tipo: TipoMovimentoInvestimento;
  valor: number;
  quantidade?: number;
  descricao?: string;
}

// Arredonda para centavos.
function arred(valor: number): number {
  return Math.round(valor * 100) / 100;
}

// Gerador pseudoaleatório determinístico (mulberry32): mesma semente, mesmos valores.
function criarSorteio(semente: number): () => number {
  let estado = semente >>> 0;
  return () => {
    estado = (estado + 0x6d2b79f5) >>> 0;
    let t = estado;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Dia da compra no ciclo do cartão: até o dia 3 fecha no mesmo mês; do dia 4 em diante, no mês seguinte.
// O vencimento é sempre o dia 10 do mês do fechamento seguinte (regra do cartão de demonstração).
function vencimentoDaCompra(data: Date): Date {
  const mes = data.getUTCDate() >= 4 ? data.getUTCMonth() + 1 : data.getUTCMonth();
  return new Date(Date.UTC(data.getUTCFullYear(), mes, 10));
}

export async function carregarDemonstracao(prisma: PrismaClient): Promise<void> {
  await criarCategoriasPadrao(prisma);

  const categorias = await prisma.categoria.findMany({ select: { id: true, nome: true } });
  const idDaCategoria = (nome: string): number => {
    const achada = categorias.find((c) => c.nome === nome);
    if (!achada) throw new Error(`Categoria padrão não encontrada: ${nome}`);
    return achada.id;
  };

  // ----- Datas relativas a hoje -----
  const agora = new Date();
  const anoAtual = agora.getFullYear();
  const mesAtual = agora.getMonth();
  const diaAtual = agora.getDate();
  const hojeData = new Date(Date.UTC(anoAtual, mesAtual, diaAtual));

  // Dia `diaDoMes` do mês que fica `mesesAtras` meses antes do atual (limitado ao último dia do mês).
  const dia = (mesesAtras: number, diaDoMes: number): Date => {
    const mesBase = new Date(Date.UTC(anoAtual, mesAtual - mesesAtras, 1));
    const ano = mesBase.getUTCFullYear();
    const mes = mesBase.getUTCMonth();
    const ultimoDia = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
    return new Date(Date.UTC(ano, mes, Math.min(diaDoMes, ultimoDia)));
  };
  const ehFuturo = (data: Date): boolean => data.getTime() > hojeData.getTime();

  // ----- Sorteio determinístico -----
  const sorteia = criarSorteio(20260101);
  const faixa = (min: number, max: number): number => Math.round(min + sorteia() * (max - min));
  const escolhe = <T>(itens: T[]): T => itens[Math.floor(sorteia() * itens.length)];

  // ----- Contas -----
  const saldoInicial = { corrente: 2500, poupanca: 4000, carteira: 300 };

  const corrente = await prisma.conta.create({
    data: { nome: 'Conta Corrente', tipo: 'CORRENTE', instituicao: 'Banco Azul', numero: '12345-6', cor: '#2563eb', saldo: saldoInicial.corrente },
  });
  const poupanca = await prisma.conta.create({
    data: { nome: 'Poupança', tipo: 'POUPANCA', instituicao: 'Banco Azul', cor: '#10b981', saldo: saldoInicial.poupanca },
  });
  const carteira = await prisma.conta.create({
    data: { nome: 'Carteira', tipo: 'CARTEIRA', cor: '#f59e0b', saldo: saldoInicial.carteira },
  });
  await prisma.conta.create({
    data: { nome: 'Corretora', tipo: 'INVESTIMENTO', instituicao: 'Corretora Horizonte', cor: '#7c3aed', saldo: 350 },
  });
  const cartao = await prisma.conta.create({
    data: {
      nome: 'Cartão Azul',
      tipo: 'CARTAO',
      instituicao: 'Banco Azul',
      bandeira: 'Mastercard',
      numero: '4821',
      limite: 8000,
      diaFechamento: 3,
      diaVencimento: 10,
      cor: '#1d4ed8',
      saldo: 0,
    },
  });

  // ----- Lançamentos das contas comuns (últimos 6 meses, mês atual incluído) -----
  const lancamentos: LancamentoDemo[] = [];
  const lancar = (l: LancamentoDemo): void => {
    if (!ehFuturo(l.data)) lancamentos.push(l);
  };
  const cat = (nome: string): number => idDaCategoria(nome);

  // Compras no cartão: a lista é preenchida no mesmo laço e agrupada em faturas mais abaixo.
  const compras: CompraDemo[] = [];
  const comprar = (data: Date, descricao: string, valor: number, categoria: string, parcela?: number, totalParcelas?: number, futuroPermitido = false): void => {
    if (!futuroPermitido && ehFuturo(data)) return;
    compras.push({
      data,
      descricao,
      valor,
      categoriaId: cat(categoria),
      ...(parcela !== undefined ? { parcela, totalParcelas } : {}),
    });
  };

  for (let m = 5; m >= 0; m--) {
    // Conta Corrente
    lancar({ contaId: corrente.id, data: dia(m, 5), descricao: 'Salário', valor: 7800, tipo: 'RECEITA', categoriaId: cat('Salário'), transferencia: false });
    lancar({ contaId: corrente.id, data: dia(m, 6), descricao: 'Aluguel', valor: 2100, tipo: 'DESPESA', categoriaId: cat('Moradia'), transferencia: false });
    lancar({ contaId: corrente.id, data: dia(m, 8), descricao: 'Plano de saúde', valor: 412, tipo: 'DESPESA', categoriaId: cat('Saúde'), transferencia: false });
    lancar({ contaId: corrente.id, data: dia(m, 10), descricao: 'Condomínio', valor: 480, tipo: 'DESPESA', categoriaId: cat('Moradia'), transferencia: false });
    lancar({ contaId: corrente.id, data: dia(m, 12), descricao: 'Energia elétrica', valor: faixa(150, 230), tipo: 'DESPESA', categoriaId: cat('Contas da casa'), transferencia: false });
    lancar({ contaId: corrente.id, data: dia(m, 15), descricao: 'Internet', valor: 119.9, tipo: 'DESPESA', categoriaId: cat('Contas da casa'), transferencia: false });
    // Transferências entre contas próprias (não entram em relatórios).
    lancar({ contaId: corrente.id, data: dia(m, 7), descricao: 'Transferência para a poupança', valor: 500, tipo: 'DESPESA', categoriaId: null, transferencia: true });
    lancar({ contaId: poupanca.id, data: dia(m, 7), descricao: 'Transferência da conta corrente', valor: 500, tipo: 'RECEITA', categoriaId: null, transferencia: true });
    lancar({ contaId: corrente.id, data: dia(m, 9), descricao: 'Saque para a carteira', valor: 200, tipo: 'DESPESA', categoriaId: null, transferencia: true });
    lancar({ contaId: carteira.id, data: dia(m, 9), descricao: 'Saque da conta corrente', valor: 200, tipo: 'RECEITA', categoriaId: null, transferencia: true });

    // Freelance em 2 dos 6 meses.
    if (m === 4 || m === 1) {
      lancar({ contaId: corrente.id, data: dia(m, 20), descricao: 'Projeto freelance', valor: faixa(1200, 1800), tipo: 'RECEITA', categoriaId: cat('Freelance'), transferencia: false });
    }

    // Carteira: 2 a 3 gastos pequenos por mês.
    const gastosCarteira = faixa(2, 3);
    for (let i = 0; i < gastosCarteira; i++) {
      const ehRestaurante = sorteia() < 0.5;
      lancar({
        contaId: carteira.id,
        data: dia(m, faixa(1, 28)),
        descricao: ehRestaurante ? 'Lanche' : 'Ônibus e metrô',
        valor: faixa(15, 60),
        tipo: 'DESPESA',
        categoriaId: cat(ehRestaurante ? 'Restaurantes' : 'Transporte'),
        transferencia: false,
      });
    }

    // Cartão: 13 a 14 compras por mês (sem contar a parcelada).
    const mesComCinema = m % 2 === 0;
    for (let i = 0; i < 3; i++) {
      comprar(dia(m, faixa(1, 28)), 'Supermercado', faixa(180, 420), 'Mercado');
    }
    for (let i = 0; i < 4; i++) {
      comprar(dia(m, faixa(1, 28)), escolhe(['Restaurante', 'Lanchonete', 'Delivery', 'Padaria']), faixa(35, 160), 'Restaurantes');
    }
    const compraTransporte = mesComCinema ? 2 : faixa(2, 3);
    for (let i = 0; i < compraTransporte; i++) {
      comprar(dia(m, faixa(1, 28)), escolhe(['Combustível', 'App de transporte']), faixa(25, 220), 'Transporte');
    }
    comprar(dia(m, 4), 'Netflix', 39.9, 'Assinaturas');
    comprar(dia(m, 18), 'Spotify', 21.9, 'Assinaturas');
    comprar(dia(m, faixa(1, 28)), 'Farmácia', faixa(40, 180), 'Saúde');
    comprar(dia(m, faixa(1, 28)), escolhe(['Loja de roupas', 'Compra online']), faixa(120, 600), 'Compras');
    if (mesComCinema) {
      comprar(dia(m, faixa(1, 28)), escolhe(['Cinema', 'Show']), faixa(45, 140), 'Lazer');
    }
  }

  // Compra parcelada: Notebook em 6x de 400, iniciada há 3 meses (parcelas 1 a 6 nos meses -3 a +2).
  for (let k = 1; k <= 6; k++) {
    comprar(dia(4 - k, 15), 'Notebook', 400, 'Compras', k, 6, true);
  }

  // ----- Faturas: agrupa as compras pelo vencimento -----
  const grupos = new Map<number, GrupoFatura>();
  for (const compra of compras) {
    const vencimento = vencimentoDaCompra(compra.data);
    const chave = vencimento.getTime();
    let grupo = grupos.get(chave);
    if (!grupo) {
      grupo = {
        vencimento,
        fechamento: new Date(Date.UTC(vencimento.getUTCFullYear(), vencimento.getUTCMonth(), 3)),
        compras: [],
        total: 0,
        status: 'ABERTA',
        faturaId: 0,
      };
      grupos.set(chave, grupo);
    }
    grupo.compras.push(compra);
  }

  const faturasOrdenadas = [...grupos.values()].sort((a, b) => a.vencimento.getTime() - b.vencimento.getTime());
  for (const grupo of faturasOrdenadas) {
    grupo.total = arred(grupo.compras.reduce((soma, c) => soma + c.valor, 0));
    if (grupo.vencimento.getTime() < hojeData.getTime()) {
      grupo.status = 'PAGA';
    } else if (grupo.fechamento.getTime() < hojeData.getTime()) {
      grupo.status = 'FECHADA';
    } else {
      grupo.status = 'ABERTA';
    }
    const fatura = await prisma.fatura.create({
      data: {
        contaId: cartao.id,
        vencimento: grupo.vencimento,
        fechamento: grupo.fechamento,
        total: grupo.total,
        status: grupo.status,
        pagaEm: grupo.status === 'PAGA' ? grupo.vencimento : null,
        origem: 'MANUAL',
      },
      select: { id: true },
    });
    grupo.faturaId = fatura.id;
  }

  // Pagamento de cada fatura PAGA sai da conta corrente no dia do vencimento.
  for (const grupo of faturasOrdenadas) {
    if (grupo.status !== 'PAGA') continue;
    lancar({
      contaId: corrente.id,
      data: grupo.vencimento,
      descricao: 'Pagamento da fatura Cartão Azul',
      valor: grupo.total,
      tipo: 'DESPESA',
      categoriaId: null,
      transferencia: true,
    });
  }

  // Compras do cartão, cada uma com sua fatura.
  const transacoesCartao = compras.map((compra) => {
    const grupo = grupos.get(vencimentoDaCompra(compra.data).getTime());
    if (!grupo) throw new Error('Fatura não encontrada para a compra');
    return {
      contaId: cartao.id,
      data: compra.data,
      descricao: compra.descricao,
      valor: compra.valor,
      tipo: 'DESPESA' as const,
      categoriaId: compra.categoriaId,
      transferencia: false,
      faturaId: grupo.faturaId,
      parcela: compra.parcela ?? null,
      totalParcelas: compra.totalParcelas ?? null,
      origem: 'MANUAL' as const,
    };
  });

  await prisma.transacao.createMany({
    data: lancamentos.map((l) => ({ ...l, origem: 'MANUAL' as const })),
  });
  await prisma.transacao.createMany({ data: transacoesCartao });

  // ----- Saldos finais -----
  const liquido = (contaId: number): number =>
    lancamentos
      .filter((l) => l.contaId === contaId)
      .reduce((soma, l) => soma + (l.tipo === 'RECEITA' ? l.valor : -l.valor), 0);

  const saldoCorrente = arred(saldoInicial.corrente + liquido(corrente.id));
  const saldoPoupanca = arred(saldoInicial.poupanca + liquido(poupanca.id));
  const saldoCarteira = arred(saldoInicial.carteira + liquido(carteira.id));
  // Saldo do cartão = dívida: soma dos totais das faturas que não estão pagas.
  const saldoCartao = arred(
    faturasOrdenadas.filter((g) => g.status !== 'PAGA').reduce((soma, g) => soma + g.total, 0)
  );

  await prisma.conta.update({ where: { id: corrente.id }, data: { saldo: saldoCorrente } });
  await prisma.conta.update({ where: { id: poupanca.id }, data: { saldo: saldoPoupanca } });
  await prisma.conta.update({ where: { id: carteira.id }, data: { saldo: saldoCarteira } });
  await prisma.conta.update({
    where: { id: cartao.id },
    data: { saldo: saldoCartao, limiteDisponivel: arred(8000 - saldoCartao) },
  });

  // ----- Investimentos -----
  const investimentos: InvestimentoDemo[] = [
    {
      nome: 'Tesouro Selic 2029',
      tipo: 'RENDA_FIXA',
      subtipo: 'Tesouro Direto',
      instituicao: 'Corretora Horizonte',
      valorAplicado: 12000,
      saldo: 13480.55,
      taxa: 'Selic + 0,05%',
      vencimento: new Date(Date.UTC(2029, 2, 1)),
      dataAplicacao: dia(5, 10),
      dataRendimentos: [dia(3, 15), dia(1, 15)],
    },
    {
      nome: 'CDB Banco Azul',
      tipo: 'RENDA_FIXA',
      subtipo: 'CDB',
      emissor: 'Banco Azul',
      valorAplicado: 8000,
      saldo: 8642.3,
      taxa: '110% do CDI',
      vencimento: dia(-24, diaAtual),
      dataAplicacao: dia(4, 15),
      dataRendimentos: [dia(3, 15), dia(1, 15)],
    },
    {
      nome: 'Fundo Multimercado Horizonte',
      tipo: 'FUNDO',
      valorAplicado: 5000,
      saldo: 5311.72,
      dataAplicacao: dia(3, 5),
    },
    {
      nome: 'IVVB11',
      tipo: 'ETF',
      codigo: 'IVVB11',
      quantidade: 20,
      valorAplicado: 5600,
      saldo: 6384,
      dataAplicacao: dia(2, 20),
    },
    {
      nome: 'ITSA4',
      tipo: 'ACAO',
      codigo: 'ITSA4',
      quantidade: 400,
      valorAplicado: 3960,
      saldo: 4212,
      dataAplicacao: dia(4, 8),
    },
    {
      nome: 'HGLG11',
      tipo: 'FII',
      codigo: 'HGLG11',
      quantidade: 15,
      valorAplicado: 2475,
      saldo: 2389.5,
      dataAplicacao: dia(1, 12),
    },
    {
      nome: 'Previdência PGBL',
      tipo: 'PREVIDENCIA',
      valorAplicado: 9000,
      saldo: 9870.4,
      dataAplicacao: dia(4, 25),
      dataRendimentos: [dia(3, 25), dia(1, 25)],
    },
    {
      nome: 'Bitcoin',
      tipo: 'CRIPTO',
      codigo: 'BTC',
      quantidade: 0.012,
      valorAplicado: 3000,
      saldo: 3712.9,
      dataAplicacao: dia(2, 3),
    },
  ];

  const movimentos: MovimentoDemo[] = [];
  let totalInvestimentos = 0;
  for (const item of investimentos) {
    const criado = await prisma.investimento.create({
      data: {
        nome: item.nome,
        tipo: item.tipo,
        codigo: item.codigo ?? null,
        subtipo: item.subtipo ?? null,
        instituicao: item.instituicao ?? null,
        emissor: item.emissor ?? null,
        valorAplicado: item.valorAplicado,
        saldo: item.saldo,
        quantidade: item.quantidade ?? null,
        taxa: item.taxa ?? null,
        vencimento: item.vencimento ?? null,
        dataPosicao: new Date(),
        origem: 'MANUAL',
      },
      select: { id: true },
    });
    movimentos.push({
      investimentoId: criado.id,
      data: item.dataAplicacao,
      tipo: 'APLICACAO',
      valor: item.valorAplicado,
      quantidade: item.quantidade,
      descricao: 'Aplicação inicial',
    });
    for (const data of item.dataRendimentos ?? []) {
      movimentos.push({
        investimentoId: criado.id,
        data,
        tipo: 'RENDIMENTO',
        valor: faixa(80, 260),
        descricao: 'Rendimento do período',
      });
    }
    totalInvestimentos += item.saldo;
  }
  await prisma.movimentoInvestimento.createMany({ data: movimentos });
  totalInvestimentos = arred(totalInvestimentos);

  // ----- Orçamentos -----
  await prisma.orcamento.createMany({
    data: [
      { categoriaId: cat('Mercado'), limite: 1200 },
      { categoriaId: cat('Restaurantes'), limite: 600 },
      { categoriaId: cat('Transporte'), limite: 450 },
      { categoriaId: cat('Lazer'), limite: 300 },
      { categoriaId: cat('Assinaturas'), limite: 80 },
      { categoriaId: cat('Compras'), limite: 700 },
    ],
    skipDuplicates: true,
  });

  // ----- Metas -----
  await prisma.meta.createMany({
    data: [
      { nome: 'Reserva de emergência', valorAlvo: 30000, valorAtual: 18500, cor: '#10b981' },
      { nome: 'Viagem de férias', valorAlvo: 9000, valorAtual: 3200, prazo: dia(-8, diaAtual), cor: '#f59e0b' },
      { nome: 'Entrada do apartamento', valorAlvo: 80000, valorAtual: 21000, prazo: dia(-36, diaAtual), cor: '#2563eb' },
    ],
  });

  // ----- Patrimônio: fotografias mensais (dia 28) e a de hoje -----
  const contasAtual = arred(saldoCorrente + saldoPoupanca + saldoCarteira + 350);
  const investimentosAtual = totalInvestimentos;
  const posicoes: { data: Date; contas: number; investimentos: number; cartoes: number }[] = [];
  for (let k = 1; k <= 11; k++) {
    posicoes.push({
      data: dia(k, 28),
      contas: arred(contasAtual - k * 350),
      investimentos: arred(investimentosAtual * (1 - 0.028 * k)),
      cartoes: faixa(1800, 3200),
    });
  }
  posicoes.push({ data: hojeData, contas: contasAtual, investimentos: investimentosAtual, cartoes: saldoCartao });
  await prisma.posicaoPatrimonio.createMany({ data: posicoes });

  console.log('Dados de demonstração carregados.');
}
