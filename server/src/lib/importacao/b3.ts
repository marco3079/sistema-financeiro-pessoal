// Leitura das planilhas da Área do Investidor da B3 (https://www.investidor.b3.com.br).
// A B3 não oferece API para pessoa física, mas deixa baixar duas planilhas:
// - "Movimentação" (Extratos > Movimentação): compras, vendas, proventos e eventos, linha a linha;
// - "Posição" (Posição > baixar): a carteira num dia, com uma aba por tipo de ativo.
// O navegador abre o .xlsx e manda as abas como matrizes; aqui elas viram posições e movimentos.
// Nada é gravado neste arquivo: ele só interpreta.

import type { TipoInvestimento, TipoMovimentoInvestimento } from '@prisma/client';
import { lerData, lerDinheiro } from './extrato';

export type Celula = string | number | boolean | null;

export interface Planilha {
  nome: string;
  linhas: Celula[][];
}

export interface PosicaoLida {
  chave: string; // código de negociação, ou o nome quando não há código
  codigo: string | null;
  nome: string;
  tipo: TipoInvestimento;
  subtipo: string | null;
  instituicao: string | null;
  quantidade: number;
  valorAplicado: number | null; // custo das compras que aparecem no arquivo; null se não dá para saber
  saldo: number | null; // só na planilha de posição
  vencimento: string | null;
  ultimoMovimento: string | null; // data do último evento do ativo no arquivo
  // true = provavelmente não está mais na carteira (sem evento há mais de um ano, ou a quantidade não bate
  // com a do último provento pago). A tela traz estas posições desmarcadas.
  suspeita: boolean;
}

export interface MovimentoLido {
  chave: string; // a mesma da posição
  data: string;
  tipo: TipoMovimentoInvestimento;
  valor: number;
  quantidade: number | null;
  descricao: string;
}

export interface AnaliseB3 {
  tipo: 'MOVIMENTACAO' | 'POSICAO' | 'DESCONHECIDA';
  periodo: { de: string; ate: string } | null;
  posicoes: PosicaoLida[];
  movimentos: MovimentoLido[];
  encerradas: string[]; // chaves que aparecem no arquivo e terminaram zeradas
  avisos: string[];
}

function semAcento(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function chaveTexto(valor: Celula | undefined): string {
  return semAcento(String(valor ?? '')).toLowerCase().replace(/\s+/g, ' ').trim();
}

function numero(valor: Celula | undefined): number | null {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  if (typeof valor !== 'string') return null;
  return lerDinheiro(valor);
}

function dataDe(valor: Celula | undefined): string | null {
  if (typeof valor === 'string') return lerData(valor);
  return null;
}

function arredondar(n: number, casas = 2): number {
  const fator = 10 ** casas;
  return Math.round(n * fator) / fator;
}

// ---------- Produto ----------

interface Produto {
  chave: string;
  codigo: string | null;
  nome: string;
  tipo: TipoInvestimento;
  subtipo: string | null;
  direito: boolean; // direito ou recibo de subscrição: não é posição
}

const CODIGO = /^([A-Z]{4}\d{1,2})$/;

function tipoPeloCodigo(codigo: string, nome: string): TipoInvestimento {
  const sufixo = Number(codigo.slice(4));
  const n = chaveTexto(nome);
  if (sufixo === 11) {
    if (/\betf\b|ishares|it now|index|trend |b-index/.test(n)) return 'ETF';
    if (/imob|\bfii\b|fiagro|fdo|fund|\bfi\b|infra/.test(n)) return 'FII';
  }
  return 'ACAO';
}

// "XPML11 - XP MALLS FDO INV IMOB FII", "CDB - CDB126A41CJ - BANCO INTER S/A", "Tesouro Selic 2029".
function lerProduto(texto: string): Produto {
  const partes = texto.split(' - ').map((p) => p.trim());
  const primeiro = (partes[0] ?? '').toUpperCase();
  if (CODIGO.test(primeiro)) {
    const sufixo = Number(primeiro.slice(4));
    // Posição de verdade: ações (3 a 8), units/fundos/ETFs (11) e BDRs (31 a 39). O resto são direitos e recibos.
    const posicao = (sufixo >= 3 && sufixo <= 8) || sufixo === 11 || (sufixo >= 31 && sufixo <= 39);
    const nome = partes.slice(1).join(' - ') || primeiro;
    return { chave: primeiro, codigo: primeiro, nome, tipo: tipoPeloCodigo(primeiro, nome), subtipo: null, direito: !posicao };
  }
  const n = chaveTexto(texto);
  if (n.startsWith('tesouro')) {
    return { chave: texto.trim(), codigo: null, nome: texto.trim(), tipo: 'RENDA_FIXA', subtipo: 'Tesouro Direto', direito: false };
  }
  // Renda fixa: "CDB - CDB126A41CJ - BANCO INTER S/A" (tipo - código - emissor).
  const subtipo = /^(cdb|lci|lca|cri|cra|lc|lf|deb|debenture|rdb|lig)\b/.exec(n);
  if (subtipo && partes.length >= 2) {
    return {
      chave: partes[1],
      codigo: partes[1],
      nome: `${partes[0]} ${partes.slice(2).join(' - ') || partes[1]}`.trim(),
      tipo: 'RENDA_FIXA',
      subtipo: partes[0].toUpperCase(),
      direito: false,
    };
  }
  return { chave: texto.trim(), codigo: null, nome: texto.trim(), tipo: 'OUTRO', subtipo: null, direito: false };
}

// ---------- Planilha de movimentação ----------

type Efeito = 'COMPRA' | 'VENDA' | 'ENTRADA' | 'SAIDA' | 'PROVENTO' | 'IGNORAR';

// O que cada tipo de movimentação faz com a posição.
function efeitoDe(movimentacao: string, credito: boolean): Efeito {
  const m = chaveTexto(movimentacao);
  if (m.includes('transferido') || m.includes('nao exercido') || m.includes('solicitada')) return 'IGNORAR';
  if (m === 'transferencia - liquidacao' || m === 'compra' || m === 'venda' || m === 'compra / venda') {
    return credito ? 'COMPRA' : 'VENDA';
  }
  if (
    m === 'rendimento' ||
    m === 'dividendo' ||
    m.startsWith('juros sobre capital') ||
    m === 'leilao de fracao' ||
    m.startsWith('amortizacao') ||
    m.startsWith('restituicao de capital') ||
    m === 'juros' ||
    m.startsWith('pagamento de juros')
  ) {
    return credito ? 'PROVENTO' : 'IGNORAR';
  }
  if (m.startsWith('direito') || m.startsWith('cessao de direitos') || m.startsWith('recibo')) return 'IGNORAR';
  if (
    m === 'transferencia' ||
    m === 'desdobro' ||
    m === 'grupamento' ||
    m.startsWith('bonificacao') ||
    m === 'fracao em ativos' ||
    m === 'atualizacao' ||
    m === 'cisao' ||
    m === 'incorporacao' ||
    m.startsWith('resgate') ||
    m === 'vencimento' ||
    m.startsWith('subscricao') ||
    m.startsWith('deposito') ||
    m.startsWith('retirada')
  ) {
    return credito ? 'ENTRADA' : 'SAIDA';
  }
  return 'IGNORAR';
}

function analisarMovimentacao(linhas: Celula[][], cabecalho: number): AnaliseB3 {
  const titulo = linhas[cabecalho].map(chaveTexto);
  const col = (nomes: string[]) => titulo.findIndex((t) => nomes.includes(t));
  const iSentido = col(['entrada/saida']);
  const iData = col(['data']);
  const iMov = col(['movimentacao']);
  const iProduto = col(['produto']);
  const iInst = col(['instituicao']);
  const iQtd = col(['quantidade']);
  const iValor = col(['valor da operacao']);

  interface Linha {
    data: string;
    ordem: number;
    credito: boolean;
    movimentacao: string;
    produto: Produto;
    instituicao: string | null;
    quantidade: number;
    valor: number | null;
  }
  const lidas: Linha[] = [];
  linhas.slice(cabecalho + 1).forEach((l, ordem) => {
    const data = dataDe(l[iData]);
    const texto = String(l[iProduto] ?? '').trim();
    if (!data || texto === '') return;
    lidas.push({
      data,
      ordem,
      credito: chaveTexto(l[iSentido]).startsWith('cred'),
      movimentacao: String(l[iMov] ?? ''),
      produto: lerProduto(texto),
      instituicao: iInst >= 0 ? String(l[iInst] ?? '').trim() || null : null,
      quantidade: Math.abs(numero(l[iQtd]) ?? 0),
      valor: numero(l[iValor]),
    });
  });
  // A planilha vem da mais nova para a mais antiga: processa na ordem do tempo.
  lidas.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : b.ordem - a.ordem));

  const carteira = new Map<string, { produto: Produto; instituicao: string | null; quantidade: number; custo: number; comprou: boolean; ultimo: string; quantidadeNoProvento: number | null }>();
  const movimentos: MovimentoLido[] = [];
  const naoReconhecidas = new Map<string, number>();

  for (const l of lidas) {
    if (l.produto.direito) continue;
    const efeito = efeitoDe(l.movimentacao, l.credito);
    if (efeito === 'IGNORAR') {
      const m = chaveTexto(l.movimentacao);
      if (!/transferido|nao exercido|solicitada|direito|cessao|recibo/.test(m)) {
        naoReconhecidas.set(l.movimentacao, (naoReconhecidas.get(l.movimentacao) ?? 0) + 1);
      }
      continue;
    }
    let posicao = carteira.get(l.produto.chave);
    if (!posicao) {
      posicao = { produto: l.produto, instituicao: l.instituicao, quantidade: 0, custo: 0, comprou: false, ultimo: l.data, quantidadeNoProvento: null };
      carteira.set(l.produto.chave, posicao);
    }
    posicao.produto = l.produto; // fica o nome mais recente
    posicao.ultimo = l.data;
    if (efeito === 'PROVENTO') {
      // O provento informa quantas cotas a pessoa tinha naquele dia: serve para conferir a conta.
      if (l.quantidade >= 1) posicao.quantidadeNoProvento = l.quantidade;
      if (l.valor !== null && l.valor > 0) {
        movimentos.push({
          chave: l.produto.chave,
          data: l.data,
          tipo: 'RENDIMENTO',
          valor: arredondar(l.valor),
          quantidade: null,
          descricao: l.movimentacao.trim(),
        });
      }
      continue;
    }
    if (efeito === 'COMPRA') {
      posicao.quantidade += l.quantidade;
      posicao.quantidadeNoProvento = null;
      posicao.instituicao = l.instituicao ?? posicao.instituicao;
      if (l.valor !== null && l.valor > 0) {
        posicao.custo += l.valor;
        posicao.comprou = true;
        movimentos.push({ chave: l.produto.chave, data: l.data, tipo: 'APLICACAO', valor: arredondar(l.valor), quantidade: l.quantidade, descricao: 'Compra' });
      }
    } else if (efeito === 'VENDA') {
      // Sai pelo custo médio.
      if (posicao.quantidade > 0) posicao.custo -= (posicao.custo / posicao.quantidade) * Math.min(l.quantidade, posicao.quantidade);
      posicao.quantidade -= l.quantidade;
      posicao.quantidadeNoProvento = null;
      if (l.valor !== null && l.valor > 0) {
        movimentos.push({ chave: l.produto.chave, data: l.data, tipo: 'RESGATE', valor: arredondar(l.valor), quantidade: l.quantidade, descricao: l.movimentacao.trim() === 'Transferência - Liquidação' ? 'Venda' : l.movimentacao.trim() });
      }
    } else if (efeito === 'ENTRADA') {
      posicao.quantidade += l.quantidade;
      posicao.quantidadeNoProvento = null;
      posicao.instituicao = l.instituicao ?? posicao.instituicao;
    } else {
      if (posicao.quantidade > 0) posicao.custo -= (posicao.custo / posicao.quantidade) * Math.min(l.quantidade, posicao.quantidade);
      posicao.quantidade -= l.quantidade;
      posicao.quantidadeNoProvento = null;
    }
    if (posicao.quantidade < 0.000001) {
      posicao.quantidade = Math.max(0, posicao.quantidade);
      if (posicao.quantidade === 0) posicao.custo = 0;
    }
  }

  const posicoes: PosicaoLida[] = [];
  const encerradas: string[] = [];
  const fim = lidas.length > 0 ? lidas[lidas.length - 1].data : '';
  const umAnoAntes = fim ? `${Number(fim.slice(0, 4)) - 1}${fim.slice(4)}` : '';
  for (const [chave, p] of carteira) {
    // Sobra menor que uma cota de ativo negociado em bolsa é fração que vai a leilão: não é posição.
    if (p.quantidade < 0.000001 || (p.produto.codigo !== null && CODIGO.test(p.produto.codigo) && p.quantidade < 1)) {
      encerradas.push(chave);
      continue;
    }
    posicoes.push({
      chave,
      codigo: p.produto.codigo,
      nome: p.produto.nome,
      tipo: p.produto.tipo,
      subtipo: p.produto.subtipo,
      instituicao: p.instituicao,
      quantidade: arredondar(p.quantidade, 6),
      valorAplicado: p.comprou ? arredondar(Math.max(0, p.custo)) : null,
      saldo: null,
      vencimento: null,
      ultimoMovimento: p.ultimo,
      suspeita:
        p.ultimo < umAnoAntes ||
        (p.quantidadeNoProvento !== null && Math.abs(p.quantidadeNoProvento - p.quantidade) > 0.5),
    });
  }
  posicoes.sort((a, b) => a.tipo.localeCompare(b.tipo) || a.chave.localeCompare(b.chave));

  const avisos: string[] = [
    'A posição foi calculada somando as movimentações do arquivo. Se você tinha ativos antes do período baixado, ou se um ativo mudou de código, confira as quantidades antes de confirmar.',
  ];
  if (naoReconhecidas.size > 0) {
    avisos.push(
      'Tipos de movimentação que não entraram na conta: ' +
        [...naoReconhecidas].map(([nome, n]) => `${nome} (${n})`).join(', ') +
        '.'
    );
  }
  const datas = lidas.map((l) => l.data);
  return {
    tipo: 'MOVIMENTACAO',
    periodo: datas.length > 0 ? { de: datas[0], ate: datas[datas.length - 1] } : null,
    posicoes,
    movimentos,
    encerradas,
    avisos,
  };
}

// ---------- Planilha de posição ----------

function tipoPelaAba(aba: string, codigo: string | null, nome: string): { tipo: TipoInvestimento; subtipo: string | null } | null {
  const a = chaveTexto(aba);
  if (a.includes('emprestimo') || a.includes('proventos')) return null;
  if (a.includes('tesouro')) return { tipo: 'RENDA_FIXA', subtipo: 'Tesouro Direto' };
  if (a.includes('renda fixa')) return { tipo: 'RENDA_FIXA', subtipo: null };
  if (a.includes('etf')) return { tipo: 'ETF', subtipo: null };
  if (a.includes('fundo')) return { tipo: 'FII', subtipo: null };
  if (a.includes('bdr')) return { tipo: 'ACAO', subtipo: 'BDR' };
  if (a.includes('acoes') || a.includes('acao')) return { tipo: 'ACAO', subtipo: null };
  if (a.includes('coe')) return { tipo: 'OUTRO', subtipo: 'COE' };
  if (codigo && CODIGO.test(codigo)) return { tipo: tipoPeloCodigo(codigo, nome), subtipo: null };
  return { tipo: 'OUTRO', subtipo: null };
}

function analisarPosicao(planilhas: Planilha[]): AnaliseB3 {
  const posicoes: PosicaoLida[] = [];
  for (const planilha of planilhas) {
    const cabecalho = planilha.linhas.findIndex((l) => l.map(chaveTexto).includes('quantidade') && l.map(chaveTexto).includes('produto'));
    if (cabecalho < 0) continue;
    const titulo = planilha.linhas[cabecalho].map(chaveTexto);
    const col = (teste: (t: string) => boolean) => titulo.findIndex(teste);
    const iProduto = col((t) => t === 'produto');
    const iInst = col((t) => t === 'instituicao');
    const iCodigo = col((t) => t === 'codigo de negociacao' || t === 'codigo');
    const iQtd = col((t) => t === 'quantidade');
    const iSaldo = [
      col((t) => t === 'valor atualizado'),
      col((t) => t === 'valor liquido'),
      col((t) => t.startsWith('valor atualizado mtm')),
      col((t) => t.startsWith('valor atualizado curva')),
      col((t) => t === 'valor bruto'),
    ].find((i) => i >= 0);
    const iAplicado = col((t) => t === 'valor aplicado');
    const iVencimento = col((t) => t === 'vencimento');
    const iEmissor = col((t) => t === 'emissor');
    for (const l of planilha.linhas.slice(cabecalho + 1)) {
      const produtoTexto = String(l[iProduto] ?? '').trim();
      const quantidade = numero(l[iQtd]);
      if (produtoTexto === '' || quantidade === null || quantidade <= 0) continue;
      const lido = lerProduto(produtoTexto);
      const codigo = (iCodigo >= 0 ? String(l[iCodigo] ?? '').trim().toUpperCase() : '') || lido.codigo;
      const classe = tipoPelaAba(planilha.nome, codigo, lido.nome);
      if (!classe) continue;
      const emissor = iEmissor >= 0 ? String(l[iEmissor] ?? '').trim() : '';
      posicoes.push({
        chave: codigo || lido.chave,
        codigo: codigo || null,
        nome: emissor && classe.tipo === 'RENDA_FIXA' && !lido.nome.includes(emissor) ? `${lido.nome} ${emissor}`.trim() : lido.nome,
        tipo: classe.tipo,
        subtipo: classe.subtipo ?? lido.subtipo,
        instituicao: iInst >= 0 ? String(l[iInst] ?? '').trim() || null : null,
        quantidade: arredondar(quantidade, 6),
        valorAplicado: iAplicado >= 0 ? numero(l[iAplicado]) : null,
        saldo: iSaldo !== undefined ? numero(l[iSaldo]) : null,
        vencimento: iVencimento >= 0 ? dataDe(l[iVencimento]) : null,
        ultimoMovimento: null,
        suspeita: false,
      });
    }
  }
  // O mesmo ativo em duas corretoras vira uma posição só.
  const juntas = new Map<string, PosicaoLida>();
  for (const p of posicoes) {
    const existente = juntas.get(p.chave);
    if (!existente) {
      juntas.set(p.chave, { ...p });
      continue;
    }
    existente.quantidade = arredondar(existente.quantidade + p.quantidade, 6);
    existente.saldo = existente.saldo === null && p.saldo === null ? null : arredondar((existente.saldo ?? 0) + (p.saldo ?? 0));
    existente.valorAplicado =
      existente.valorAplicado === null && p.valorAplicado === null ? null : arredondar((existente.valorAplicado ?? 0) + (p.valorAplicado ?? 0));
    if (existente.instituicao !== p.instituicao) existente.instituicao = 'Várias instituições';
  }
  return {
    tipo: 'POSICAO',
    periodo: null,
    posicoes: [...juntas.values()].sort((a, b) => a.tipo.localeCompare(b.tipo) || a.chave.localeCompare(b.chave)),
    movimentos: [],
    encerradas: [],
    avisos:
      juntas.size === 0
        ? ['Não encontrei posições nesta planilha.']
        : ['A planilha de posição traz a carteira do dia, sem o valor pago: o valor aplicado de cada ativo fica como estava (ou igual ao saldo, se for novo).'],
  };
}

// ---------- Entrada única ----------

export function analisarPlanilhaB3(planilhas: Planilha[]): AnaliseB3 {
  for (const planilha of planilhas) {
    const cabecalho = planilha.linhas.findIndex((l) => {
      const t = l.map(chaveTexto);
      return t.includes('entrada/saida') && t.includes('movimentacao') && t.includes('produto');
    });
    if (cabecalho >= 0) return analisarMovimentacao(planilha.linhas, cabecalho);
  }
  const posicao = analisarPosicao(planilhas);
  if (posicao.posicoes.length > 0) return posicao;
  return {
    tipo: 'DESCONHECIDA',
    periodo: null,
    posicoes: [],
    movimentos: [],
    encerradas: [],
    avisos: [
      'Não reconheci esta planilha. Envie a de "Movimentação" (Extratos > Movimentação) ou a de "Posição" baixada na Área do Investidor da B3.',
    ],
  };
}
