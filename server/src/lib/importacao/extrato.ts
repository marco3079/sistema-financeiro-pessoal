// Leitura de faturas de cartão e extratos de conta a partir do TEXTO de um arquivo (CSV, OFX ou PDF).
// O navegador extrai o texto (no PDF, uma linha de texto por linha da página) e manda para cá;
// aqui o texto vira uma lista de lançamentos, com o banco e o mês detectados.
// Nada é gravado neste arquivo: ele só interpreta.

export type FormatoArquivo = 'csv' | 'ofx' | 'pdf';
export type TipoDocumento = 'FATURA' | 'EXTRATO';

export interface ItemLido {
  data: string; // 'AAAA-MM-DD'
  descricao: string;
  valor: number; // sempre positivo
  tipo: 'RECEITA' | 'DESPESA';
  transferencia: boolean; // pagamento de fatura ou movimento entre contas próprias
  parcela: number | null;
  totalParcelas: number | null;
}

export interface Analise {
  documento: TipoDocumento;
  banco: string | null;
  vencimento: string | null; // só em FATURA: 'AAAA-MM-DD'
  total: number; // FATURA: compras menos estornos (sem o pagamento da fatura anterior). EXTRATO: entradas menos saídas.
  itens: ItemLido[];
  avisos: string[];
}

// ---------- Auxiliares de texto ----------

const MESES: Record<string, number> = {
  jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12,
};

function semAcento(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function chave(texto: string): string {
  return semAcento(texto).toLowerCase().trim();
}

function doisDigitos(n: number): string {
  return String(n).padStart(2, '0');
}

function iso(ano: number, mes: number, dia: number): string | null {
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || ano < 2000 || ano > 2100) return null;
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (d.getUTCMonth() !== mes - 1) return null;
  return `${ano}-${doisDigitos(mes)}-${doisDigitos(dia)}`;
}

// Soma meses a uma data ISO, mantendo o dia (limitado ao último dia do mês de destino).
export function somarMesesISO(data: string, meses: number): string {
  const [ano, mes, dia] = data.split('-').map(Number);
  const ultimo = new Date(Date.UTC(ano, mes - 1 + meses + 1, 0)).getUTCDate();
  const d = new Date(Date.UTC(ano, mes - 1 + meses, Math.min(dia, ultimo)));
  return `${d.getUTCFullYear()}-${doisDigitos(d.getUTCMonth() + 1)}-${doisDigitos(d.getUTCDate())}`;
}

// Aceita 'AAAA-MM-DD', 'DD/MM/AAAA', 'DD/MM/AA', 'DD-MM-AAAA', 'DD.MM.AAAA', 'AAAAMMDD' e 'DD/MM' ou 'DD MMM' (com o ano de apoio).
export function lerData(texto: string, anoDeApoio?: number): string | null {
  const t = texto.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{2})[/.-](\d{2})[/.-](\d{4})/.exec(t);
  if (m) return iso(Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{2})[/.-](\d{2})[/.-](\d{2})(?!\d)/.exec(t);
  if (m) return iso(2000 + Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{4})(\d{2})(\d{2})/.exec(t);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  if (anoDeApoio !== undefined) {
    m = /^(\d{2})[/.-](\d{2})(?!\d)/.exec(t);
    if (m) return iso(anoDeApoio, Number(m[2]), Number(m[1]));
    m = /^(\d{1,2})\s+(?:de\s+)?([a-zç]{3})[a-zç]*\.?/i.exec(t);
    if (m && MESES[chave(m[2]).slice(0, 3)]) return iso(anoDeApoio, MESES[chave(m[2]).slice(0, 3)], Number(m[1]));
  }
  return null;
}

// "R$ 1.234,56", "- 3.463,20", "1234.56", "-55.9", "1.234,56-" , "(12,00)" -> number com sinal; null se não for dinheiro.
export function lerDinheiro(texto: string): number | null {
  let t = texto.replace(/R\$|\s| /g, '');
  if (t === '' || t === '-') return null;
  let negativo = false;
  if (/^\(.*\)$/.test(t)) {
    negativo = true;
    t = t.slice(1, -1);
  }
  if (t.endsWith('-')) {
    negativo = true;
    t = t.slice(0, -1);
  }
  if (t.startsWith('-')) {
    negativo = !negativo;
    t = t.slice(1);
  } else if (t.startsWith('+')) {
    t = t.slice(1);
  }
  if (!/^[\d.,]+$/.test(t)) return null;
  if (t.includes(',')) {
    // Padrão brasileiro: ponto é milhar, vírgula é decimal.
    t = t.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(t)) {
    t = t.replace(/\./g, ''); // "1.234" sem decimais
  }
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return negativo ? -n : n;
}

function arredondar(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------- Banco ----------

const BANCOS: { nome: string; trechos: string[] }[] = [
  { nome: 'Nubank', trechos: ['nubank', 'nu pagamentos', 'nu financeira'] },
  { nome: 'XP', trechos: ['xp investimentos', 'banco xp', 'cartao xp', 'xp visa'] },
  { nome: 'Itaú', trechos: ['itau', 'itaucard', 'credicard'] },
  { nome: 'Bradesco', trechos: ['bradesco', 'bradescard'] },
  { nome: 'Santander', trechos: ['santander'] },
  { nome: 'Banco do Brasil', trechos: ['banco do brasil', 'ourocard', 'bb.com.br'] },
  { nome: 'Caixa', trechos: ['caixa economica', 'cartoes caixa', 'caixa.gov.br'] },
  { nome: 'Inter', trechos: ['banco inter', 'bancointer'] },
  { nome: 'C6 Bank', trechos: ['c6 bank', 'c6bank', 'banco c6'] },
  { nome: 'BTG', trechos: ['btg pactual', 'btg'] },
  { nome: 'PicPay', trechos: ['picpay'] },
  { nome: 'Mercado Pago', trechos: ['mercado pago', 'mercadopago'] },
  { nome: 'PagBank', trechos: ['pagbank', 'pagseguro internet'] },
  { nome: 'Sicredi', trechos: ['sicredi'] },
  { nome: 'Sicoob', trechos: ['sicoob'] },
  { nome: 'Neon', trechos: ['banco neon', 'neon pagamentos'] },
  { nome: 'Porto', trechos: ['porto seguro cartoes', 'portobank', 'porto bank'] },
];

// Procura o banco primeiro no nome do arquivo (mais confiável) e depois no começo do texto.
export function detectarBanco(nomeArquivo: string, texto: string): string | null {
  const nome = chave(nomeArquivo);
  for (const banco of BANCOS) {
    if (banco.trechos.some((t) => nome.includes(t)) || nome.includes(chave(banco.nome))) return banco.nome;
  }
  // "xp Fatura2026-11-01.csv", "nu_fatura.pdf": nomes curtos comuns.
  if (/(^|[^a-z])xp([^a-z]|$)/.test(nome)) return 'XP';
  if (/(^|[^a-z])nu([^a-z]|$)/.test(nome)) return 'Nubank';
  if (/(^|[^a-z])bb([^a-z]|$)/.test(nome)) return 'Banco do Brasil';
  if (/(^|[^a-z])c6([^a-z]|$)/.test(nome)) return 'C6 Bank';
  const inicio = chave(texto.slice(0, 6000));
  for (const banco of BANCOS) {
    if (banco.trechos.some((t) => inicio.includes(t))) return banco.nome;
  }
  return null;
}

// Data no nome do arquivo ("Nubank_2026-11-08.csv", "Fatura2026-11-01.csv", "fatura-11-2026.pdf").
function dataNoNome(nomeArquivo: string): string | null {
  let m = /(20\d{2})[-_.](\d{2})[-_.](\d{2})/.exec(nomeArquivo);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /(\d{2})[-_.](\d{2})[-_.](20\d{2})/.exec(nomeArquivo);
  if (m) return iso(Number(m[3]), Number(m[2]), Number(m[1]));
  return null;
}

// ---------- Classificação de cada linha ----------

const TRECHOS_PAGAMENTO_FATURA = [
  'pagamento recebido',
  'pagamento de fatura',
  'pagamento da fatura',
  'pagamento efetuado',
  'pagamento fatura',
  'pagto fatura',
  'pgto fatura',
  'pag fatura',
  'pagamento em ',
  'pagamento via',
  'pagamento debito automatico',
  'pagamento on line',
];

const TRECHOS_MOVIMENTO_PROPRIO = [
  'aplicacao rdb',
  'resgate rdb',
  'aplicacao cdb',
  'resgate cdb',
  'aplicacao automatica',
  'resgate automatico',
  'transferencia entre contas',
  'mesma titularidade',
  'aplicacao em fundo',
  'resgate de fundo',
  'dinheiro guardado',
  'dinheiro resgatado',
  // Pix pago com o cartão: o banco credita o valor na conta e o Pix sai em seguida. O gasto de verdade está na
  // fatura ("Pix no Crédito - Fulano"); este crédito é só o dinheiro passando do cartão para a conta.
  'valor adicionado na conta por cartao de credito',
  'valor adicionado para pix no credito',
];

function ehPagamentoDeFatura(descricao: string): boolean {
  const d = chave(descricao);
  return TRECHOS_PAGAMENTO_FATURA.some((t) => d.includes(t));
}

function ehMovimentoProprio(descricao: string): boolean {
  const d = chave(descricao);
  return ehPagamentoDeFatura(descricao) || TRECHOS_MOVIMENTO_PROPRIO.some((t) => d.includes(t));
}

// Parcela na descrição ou num campo próprio: "Parcela 6/10", "- 2/2", "(03/10)", "5 de 6", "PARC 02/06".
export function lerParcela(texto: string): { parcela: number; total: number } | null {
  const m =
    /parc(?:ela)?\.?\s*(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})/i.exec(texto) ??
    /(?:^|[\s\-(])(\d{1,2})\s*\/\s*(\d{1,2})\)?\s*$/.exec(texto) ??
    /^\s*(\d{1,2})\s+de\s+(\d{1,2})\s*$/i.exec(texto);
  if (!m) return null;
  const parcela = Number(m[1]);
  const total = Number(m[2]);
  if (total < 2 || total > 60 || parcela < 1 || parcela > total) return null;
  return { parcela, total };
}

// Tira da descrição o trecho da parcela ("Loja - Parcela 2/5" -> "Loja").
function semParcela(descricao: string): string {
  return descricao
    .replace(/\s*[-–]?\s*\(?parc(?:ela)?\.?\s*\d{1,2}\s*(?:\/|de)\s*\d{1,2}\)?\s*$/i, '')
    .replace(/\s*[-–]?\s*\(?\d{1,2}\s*\/\s*\d{1,2}\)?\s*$/, '')
    .trim();
}

// Monta o item de FATURA a partir do valor com o sinal "do cartão": positivo = compra, negativo = pagamento ou estorno.
function itemDeFatura(data: string, descricaoBruta: string, valorCartao: number, campoParcela?: string): ItemLido {
  const parcela = (campoParcela ? lerParcela(campoParcela) : null) ?? lerParcela(descricaoBruta);
  const descricao = (parcela ? semParcela(descricaoBruta) : descricaoBruta).replace(/\s+/g, ' ').trim() || 'Lançamento';
  const compra = valorCartao >= 0;
  return {
    data,
    descricao: descricao.slice(0, 200),
    valor: arredondar(Math.abs(valorCartao)),
    tipo: compra ? 'DESPESA' : 'RECEITA',
    transferencia: !compra && ehPagamentoDeFatura(descricao),
    parcela: parcela?.parcela ?? null,
    totalParcelas: parcela?.total ?? null,
  };
}

// Item de EXTRATO a partir do valor com sinal: positivo = entrou, negativo = saiu.
function itemDeExtrato(data: string, descricaoBruta: string, valor: number): ItemLido {
  const descricao = descricaoBruta.replace(/\s+/g, ' ').trim() || 'Lançamento';
  return {
    data,
    descricao: descricao.slice(0, 200),
    valor: arredondar(Math.abs(valor)),
    tipo: valor >= 0 ? 'RECEITA' : 'DESPESA',
    transferencia: ehMovimentoProprio(descricao),
    parcela: null,
    totalParcelas: null,
  };
}

// ---------- CSV ----------

// Quebra uma linha de CSV respeitando aspas.
function quebrarLinha(linha: string, separador: string): string[] {
  const campos: string[] = [];
  let atual = '';
  let aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (aspas) {
      if (c === '"' && linha[i + 1] === '"') {
        atual += '"';
        i++;
      } else if (c === '"') {
        aspas = false;
      } else {
        atual += c;
      }
    } else if (c === '"') {
      aspas = true;
    } else if (c === separador) {
      campos.push(atual);
      atual = '';
    } else {
      atual += c;
    }
  }
  campos.push(atual);
  return campos.map((c) => c.trim());
}

function contar(texto: string, caractere: string): number {
  return texto.split(caractere).length - 1;
}

const NOMES_DATA = ['data', 'date', 'data da compra', 'data compra', 'data lancamento', 'data do lancamento', 'data movimento', 'dt'];
const NOMES_DESCRICAO = [
  'descricao', 'title', 'estabelecimento', 'historico', 'lancamento', 'lancamentos', 'detalhes', 'detalhe',
  'descricao do lancamento', 'memo', 'nome', 'movimentacao', 'description', 'titulo',
];
const NOMES_VALOR = ['valor', 'amount', 'valor (r$)', 'valor r$', 'valor em r$', 'montante', 'valor da compra', 'value', 'valor (em r$)'];
const NOMES_PARCELA = ['parcela', 'parcelas'];
const NOMES_CREDITO = ['credito', 'credito (r$)', 'entrada', 'entradas'];
const NOMES_DEBITO = ['debito', 'debito (r$)', 'saida', 'saidas'];

function indiceDe(cabecalho: string[], nomes: string[]): number {
  return cabecalho.findIndex((c) => nomes.includes(c));
}

function analisarCsv(texto: string, documentoPedido: TipoDocumento | null): Omit<Analise, 'banco' | 'vencimento'> {
  const avisos: string[] = [];
  const linhas = texto.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  // O cabeçalho é a primeira linha que tem uma coluna de data e uma de valor (ou crédito/débito).
  let separador = ',';
  let linhaCabecalho = -1;
  let cabecalho: string[] = [];
  for (let i = 0; i < Math.min(linhas.length, 30); i++) {
    const s = contar(linhas[i], ';') > contar(linhas[i], ',') ? ';' : contar(linhas[i], '\t') > contar(linhas[i], ',') ? '\t' : ',';
    const campos = quebrarLinha(linhas[i], s).map(chave);
    const temData = indiceDe(campos, NOMES_DATA) >= 0;
    const temValor = indiceDe(campos, NOMES_VALOR) >= 0 || indiceDe(campos, NOMES_CREDITO) >= 0 || indiceDe(campos, NOMES_DEBITO) >= 0;
    if (temData && temValor) {
      separador = s;
      linhaCabecalho = i;
      cabecalho = campos;
      break;
    }
  }
  if (linhaCabecalho < 0) {
    return {
      documento: documentoPedido ?? 'FATURA',
      total: 0,
      itens: [],
      avisos: ['Não encontrei as colunas de data e de valor neste CSV. A primeira linha precisa ter os nomes das colunas (por exemplo: data, descrição, valor).'],
    };
  }
  const iData = indiceDe(cabecalho, NOMES_DATA);
  const iDescricao = indiceDe(cabecalho, NOMES_DESCRICAO);
  const iValor = indiceDe(cabecalho, NOMES_VALOR);
  const iParcela = indiceDe(cabecalho, NOMES_PARCELA);
  const iCredito = indiceDe(cabecalho, NOMES_CREDITO);
  const iDebito = indiceDe(cabecalho, NOMES_DEBITO);

  // Fatura ou extrato? Fatura do Nubank (date,title,amount) e da XP (com Portador/Parcela) são conhecidas;
  // extrato costuma ter Identificador, Saldo ou colunas de crédito e débito.
  const temSaldo = cabecalho.some((c) => c.startsWith('saldo'));
  const temIdentificador = cabecalho.includes('identificador');
  const pareceExtrato = temSaldo || temIdentificador || iCredito >= 0 || iDebito >= 0;
  const documento: TipoDocumento = documentoPedido ?? (pareceExtrato ? 'EXTRATO' : 'FATURA');

  const lidos: { data: string; descricao: string; valor: number; parcela?: string }[] = [];
  let ignoradas = 0;
  for (const linha of linhas.slice(linhaCabecalho + 1)) {
    const campos = quebrarLinha(linha, separador);
    const data = lerData(campos[iData] ?? '');
    let valor: number | null = null;
    if (iValor >= 0) {
      valor = lerDinheiro(campos[iValor] ?? '');
    } else {
      const credito = iCredito >= 0 ? lerDinheiro(campos[iCredito] ?? '') : null;
      const debito = iDebito >= 0 ? lerDinheiro(campos[iDebito] ?? '') : null;
      if (credito !== null && credito !== 0) valor = Math.abs(credito);
      else if (debito !== null && debito !== 0) valor = -Math.abs(debito);
    }
    if (!data || valor === null) {
      ignoradas++;
      continue;
    }
    const descricao = iDescricao >= 0 ? (campos[iDescricao] ?? '') : campos.filter((_, i) => i !== iData && i !== iValor).join(' ');
    lidos.push({ data, descricao, valor, parcela: iParcela >= 0 ? campos[iParcela] : undefined });
  }
  if (ignoradas > 0) avisos.push(`${ignoradas} ${ignoradas === 1 ? 'linha foi ignorada' : 'linhas foram ignoradas'} por não ter data ou valor.`);

  if (documento === 'EXTRATO') {
    const itens = lidos.map((l) => itemDeExtrato(l.data, l.descricao, l.valor));
    return { documento, total: totalDoExtrato(itens), itens, avisos };
  }
  const itens = lidos.map((l) => itemDeFatura(l.data, l.descricao, l.valor, l.parcela));
  return { documento, total: totalDaFatura(itens), itens, avisos };
}

function totalDaFatura(itens: ItemLido[]): number {
  let total = 0;
  for (const i of itens) {
    if (i.transferencia) continue;
    total += i.tipo === 'DESPESA' ? i.valor : -i.valor;
  }
  return arredondar(total);
}

function totalDoExtrato(itens: ItemLido[]): number {
  let total = 0;
  for (const i of itens) total += i.tipo === 'RECEITA' ? i.valor : -i.valor;
  return arredondar(total);
}

// ---------- OFX ----------

function campoOfx(bloco: string, nome: string): string | null {
  const m = new RegExp(`<${nome}>([^<\\r\\n]*)`, 'i').exec(bloco);
  return m ? m[1].trim() : null;
}

function analisarOfx(texto: string, documentoPedido: TipoDocumento | null): Omit<Analise, 'banco' | 'vencimento'> & { banco: string | null } {
  const cartao = /<CREDITCARDMSGSRSV1>|<CCSTMTRS>/i.test(texto);
  const documento: TipoDocumento = documentoPedido ?? (cartao ? 'FATURA' : 'EXTRATO');
  const blocos = texto.split(/<STMTTRN>/i).slice(1);
  const itens: ItemLido[] = [];
  for (const bloco of blocos) {
    const data = lerData(campoOfx(bloco, 'DTPOSTED') ?? '');
    const valor = lerDinheiro((campoOfx(bloco, 'TRNAMT') ?? '').replace(',', '.'));
    if (!data || valor === null) continue;
    const descricao = campoOfx(bloco, 'MEMO') ?? campoOfx(bloco, 'NAME') ?? 'Lançamento';
    // No OFX o valor negativo é sempre saída, na conta e no cartão.
    itens.push(documento === 'FATURA' ? itemDeFatura(data, descricao, -valor) : itemDeExtrato(data, descricao, valor));
  }
  const org = campoOfx(texto, 'ORG');
  return {
    documento,
    banco: org ? detectarBanco(org, org) : null,
    total: documento === 'FATURA' ? totalDaFatura(itens) : totalDoExtrato(itens),
    itens,
    avisos: itens.length === 0 ? ['Não encontrei lançamentos neste OFX.'] : [],
  };
}

// ---------- PDF (texto extraído, uma linha por linha da página) ----------

const DATA_NO_INICIO = /^(\d{2}[/.]\d{2}(?:[/.]\d{2,4})?|\d{1,2}\s+(?:de\s+)?(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-zç]*\.?)\s+(.+)$/i;
const DINHEIRO_NO_FIM = /(-?\s?(?:R\$\s?)?-?\s?\d{1,3}(?:\.\d{3})*,\d{2}\s?-?)\s*(?:[CD])?\s*$/i;

function vencimentoNoTexto(texto: string): string | null {
  const m =
    /vencimento[^\d\n]{0,40}(\d{2}[/.]\d{2}[/.]\d{4})/i.exec(texto) ??
    /vence(?:\s+em)?[^\d\n]{0,20}(\d{2}[/.]\d{2}[/.]\d{4})/i.exec(texto) ??
    /data de vencimento[^\d\n]{0,40}(\d{2}[/.]\d{2}[/.]\d{2})(?!\d)/i.exec(texto);
  if (m) return lerData(m[1]);
  const porExtenso = /vencimento[^\d\n]{0,40}(\d{1,2})\s+(?:de\s+)?([a-zç]{3})[a-zç]*\.?\s+(?:de\s+)?(\d{4})/i.exec(texto);
  if (porExtenso && MESES[chave(porExtenso[2]).slice(0, 3)]) {
    return iso(Number(porExtenso[3]), MESES[chave(porExtenso[2]).slice(0, 3)], Number(porExtenso[1]));
  }
  return null;
}

function totalNoTexto(texto: string): number | null {
  const m =
    /total (?:da|desta) fatura[^\d\n-]{0,40}(-?\s?R?\$?\s?\d{1,3}(?:\.\d{3})*,\d{2})/i.exec(texto) ??
    /total a pagar[^\d\n-]{0,40}(-?\s?R?\$?\s?\d{1,3}(?:\.\d{3})*,\d{2})/i.exec(texto) ??
    /valor (?:total )?(?:da|desta) fatura[^\d\n-]{0,40}(-?\s?R?\$?\s?\d{1,3}(?:\.\d{3})*,\d{2})/i.exec(texto);
  return m ? lerDinheiro(m[1]) : null;
}

// Linhas que têm data e valor mas não são compras.
const LINHAS_QUE_NAO_SAO_COMPRAS = [
  'total da fatura', 'total desta fatura', 'total a pagar', 'saldo anterior', 'fatura anterior', 'limite', 'pagamento minimo',
  'vencimento', 'saldo em aberto', 'total de compras', 'total nacional', 'total internacional', 'proxima fatura',
  'demais faturas', 'saldo do dia', 'saldo final', 'saldo inicial', 'saldo disponivel',
];

function analisarPdf(texto: string, documentoPedido: TipoDocumento | null, vencimentoDoNome: string | null): Omit<Analise, 'banco'> {
  const avisos: string[] = [];
  const inicio = chave(texto.slice(0, 4000));
  const pareceExtrato = /extrato/.test(inicio) && !/fatura/.test(inicio);
  const documento: TipoDocumento = documentoPedido ?? (pareceExtrato ? 'EXTRATO' : 'FATURA');
  const vencimento = documento === 'FATURA' ? (vencimentoNoTexto(texto) ?? vencimentoDoNome) : null;
  // Ano de apoio para datas "DD/MM": o do vencimento, ou o primeiro ano que aparece no texto, ou o atual.
  const anoNoTexto = /\b(20\d{2})\b/.exec(texto);
  const anoBase = vencimento ? Number(vencimento.slice(0, 4)) : anoNoTexto ? Number(anoNoTexto[1]) : new Date().getFullYear();
  const mesBase = vencimento ? Number(vencimento.slice(5, 7)) : 12;

  const itens: ItemLido[] = [];
  for (const bruta of texto.split(/\r?\n/)) {
    const linha = bruta.replace(/\s+/g, ' ').trim();
    const comData = DATA_NO_INICIO.exec(linha);
    if (!comData) continue;
    const comValor = DINHEIRO_NO_FIM.exec(comData[2]);
    if (!comValor) continue;
    const valor = lerDinheiro(comValor[1]);
    if (valor === null) continue;
    let descricao = comData[2].slice(0, comValor.index).trim();
    // Segunda data colada no começo da descrição (extratos com "data do lançamento" e "data do movimento").
    descricao = descricao.replace(/^\d{2}[/.]\d{2}(?:[/.]\d{2,4})?\s+/, '');
    if (descricao === '' || LINHAS_QUE_NAO_SAO_COMPRAS.some((t) => chave(descricao).includes(t))) continue;
    let data = lerData(comData[1], anoBase);
    if (!data) continue;
    // Fatura de janeiro/fevereiro com compras de novembro/dezembro: são do ano anterior.
    if (!/\d{4}|[/.]\d{2}$/.test(comData[1].replace(/^\d{2}[/.]\d{2}/, '')) && Number(data.slice(5, 7)) > mesBase + 1) {
      data = `${anoBase - 1}${data.slice(4)}`;
    }
    const credito = /\bC\s*$/i.test(linha) && !/\bD\s*$/i.test(linha);
    if (documento === 'FATURA') {
      // No PDF da fatura, valor com "-" é pagamento ou estorno.
      itens.push(itemDeFatura(data, descricao, valor));
    } else {
      itens.push(itemDeExtrato(data, descricao, credito ? Math.abs(valor) : valor));
    }
  }

  const calculado = documento === 'FATURA' ? totalDaFatura(itens) : totalDoExtrato(itens);
  if (itens.length === 0) {
    avisos.push('Não consegui ler lançamentos neste PDF. Se o banco oferecer, prefira exportar em CSV ou OFX.');
  } else {
    avisos.push('PDF é lido por aproximação: confira os lançamentos e o total antes de confirmar.');
    const impresso = documento === 'FATURA' ? totalNoTexto(texto) : null;
    if (impresso !== null && Math.abs(impresso - calculado) > 0.01) {
      avisos.push(
        `O total impresso na fatura é ${impresso.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}, mas a soma do que li é ${calculado.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.`
      );
    }
  }
  return { documento, vencimento, total: calculado, itens, avisos };
}

// ---------- Entrada única ----------

// Em fatura, a compra parcelada pode vir com a data da compra original (XP: "06/06/2026 ... 5 de 6").
// Para o gasto cair no mês certo, a data avança mês a mês (no máximo parcela - 1 vezes) até entrar no ciclo
// desta fatura, que começa cerca de 40 dias antes do vencimento.
// Pix pago com o cartão de crédito, visto pelo extrato da conta: o banco credita o valor ("Valor adicionado na
// conta por cartão de crédito") e, em seguida, o Pix sai da conta. O gasto de verdade está na fatura do cartão
// ("Pix no Crédito - Fulano", com os juros). Para não contar duas vezes, a saída por Pix que casa com o crédito
// (mesmo valor, no mesmo dia ou até dois dias depois) também vira transferência. Devolve quantas saídas marcou.
function marcarPixNoCredito(itens: ItemLido[]): number {
  const dias = (data: string) => Math.round(new Date(data + 'T00:00:00Z').getTime() / 86400000);
  const ehCredito = (i: ItemLido) => i.tipo === 'RECEITA' && chave(i.descricao).includes('valor adicionado') && chave(i.descricao).includes('credito') && /cartao|pix/.test(chave(i.descricao));
  const ehSaidaPorPix = (i: ItemLido) => i.tipo === 'DESPESA' && !i.transferencia && /\bpix\b/.test(chave(i.descricao));
  const usados = new Set<number>();
  let marcados = 0;
  for (const credito of itens.filter(ehCredito)) {
    let escolhido = -1;
    let distancia = 99;
    itens.forEach((saida, k) => {
      if (usados.has(k) || !ehSaidaPorPix(saida) || Math.abs(saida.valor - credito.valor) > 0.005) return;
      const d = dias(saida.data) - dias(credito.data);
      if (d >= 0 && d <= 2 && d < distancia) {
        escolhido = k;
        distancia = d;
      }
    });
    if (escolhido >= 0) {
      usados.add(escolhido);
      itens[escolhido].transferencia = true;
      marcados++;
    }
  }
  return marcados;
}

function ajustarDatasDasParcelas(itens: ItemLido[], vencimento: string | null): void {
  if (!vencimento) return;
  const inicioDoCiclo = new Date(new Date(vencimento + 'T00:00:00Z').getTime() - 40 * 86400000).toISOString().slice(0, 10);
  for (const item of itens) {
    if (item.parcela === null || item.parcela < 2) continue;
    let avancos = 0;
    while (avancos < item.parcela - 1 && somarMesesISO(item.data, avancos) < inicioDoCiclo) avancos++;
    if (avancos > 0) item.data = somarMesesISO(item.data, avancos);
  }
}

// Vencimento estimado quando o arquivo não informa: dia 10 do mês seguinte ao do último lançamento.
function vencimentoEstimado(itens: ItemLido[]): string | null {
  const datas = itens.filter((i) => !i.transferencia).map((i) => i.data).sort();
  if (datas.length === 0) return null;
  const ultima = datas[datas.length - 1];
  return somarMesesISO(`${ultima.slice(0, 7)}-10`, 1);
}

export function analisarArquivo(entrada: {
  nome: string;
  formato: FormatoArquivo;
  texto: string;
  documento?: TipoDocumento | null; // força o tipo; sem ele, é detectado
}): Analise {
  const pedido = entrada.documento ?? null;
  const doNome = dataNoNome(entrada.nome);
  let parcial: Omit<Analise, 'banco' | 'vencimento'>;
  let banco = detectarBanco(entrada.nome, entrada.formato === 'pdf' ? entrada.texto : '');
  // Arquivo renomeado ("Fatura2026-11-01 (1).csv"): o cabeçalho do CSV denuncia o banco.
  if (!banco && entrada.formato === 'csv') {
    const cabecalho = entrada.texto.replace(/^\uFEFF/, '').slice(0, 300).split(/\r?\n/)[0].toLowerCase().replace(/\s+/g, '');
    if (cabecalho.startsWith('data;estabelecimento;portador;valor;parcela')) banco = 'XP';
    else if (cabecalho.startsWith('date,title,amount')) banco = 'Nubank';
  }
  let vencimento: string | null = null;

  if (entrada.formato === 'ofx') {
    const ofx = analisarOfx(entrada.texto, pedido);
    banco = banco ?? ofx.banco;
    parcial = ofx;
  } else if (entrada.formato === 'pdf') {
    const pdf = analisarPdf(entrada.texto, pedido, doNome);
    vencimento = pdf.vencimento;
    parcial = pdf;
  } else {
    parcial = analisarCsv(entrada.texto, pedido);
  }

  const avisos = [...parcial.avisos];
  if (parcial.documento === 'FATURA') {
    vencimento = vencimento ?? doNome;
    if (!vencimento) {
      vencimento = vencimentoEstimado(parcial.itens);
      if (vencimento) avisos.push('O arquivo não informa o vencimento: estimei pela data das compras. Confira e corrija se preciso.');
    }
    ajustarDatasDasParcelas(parcial.itens, vencimento);
  } else {
    vencimento = null;
    const pares = marcarPixNoCredito(parcial.itens);
    if (pares > 0) {
      avisos.push(
        `${pares} ${pares === 1 ? 'Pix pago no crédito foi marcado' : 'Pix pagos no crédito foram marcados'} como transferência: o gasto conta na fatura do cartão.`
      );
    }
  }
  if (banco === null && parcial.itens.length > 0) {
    avisos.push('Não identifiquei o banco pelo arquivo: escolha a conta de destino.');
  }
  return { documento: parcial.documento, banco, vencimento, total: parcial.total, itens: parcial.itens, avisos };
}
