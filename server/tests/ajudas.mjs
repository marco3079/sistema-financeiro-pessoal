// Auxiliares da suíte de fumaça: chamadas HTTP à API que está no ar e textos de CSV de exemplo.
// Não imprime senha, token nem chave de acesso.

export const API = process.env.TESTE_API ?? 'http://localhost:3092/api';

// Chamada HTTP. `token` vai no Authorization, `perfil` vai no X-Perfil e `corpo` vai em JSON.
export async function chamar(metodo, caminho, opcoes = {}) {
  const cabecalhos = {};
  if (opcoes.corpo !== undefined) cabecalhos['Content-Type'] = 'application/json';
  if (opcoes.token) cabecalhos.Authorization = `Bearer ${opcoes.token}`;
  if (opcoes.perfil !== undefined) cabecalhos['X-Perfil'] = String(opcoes.perfil);
  const resposta = await fetch(API + caminho, {
    method: metodo,
    headers: cabecalhos,
    body: opcoes.corpo === undefined ? undefined : JSON.stringify(opcoes.corpo),
  });
  const texto = await resposta.text();
  let dados = null;
  try {
    dados = texto ? JSON.parse(texto) : null;
  } catch {
    dados = texto;
  }
  return { status: resposta.status, dados };
}

// Mensagem curta de erro devolvida pela API (ou pelo JSON-RPC do MCP).
export function erroDe(resposta) {
  const d = resposta.dados;
  if (d && typeof d === 'object') return String(d.erro ?? d.error?.message ?? d.message ?? '');
  return '';
}

// Lança erro legível quando a resposta não tem o status esperado (sem despejar o corpo inteiro).
export function esperarStatus(resposta, esperado, rotulo) {
  if (resposta.status !== esperado) {
    throw new Error(`${rotulo}: esperado HTTP ${esperado}, veio ${resposta.status}${erroDe(resposta) ? ' (' + erroDe(resposta) + ')' : ''}`);
  }
  return resposta.dados;
}

// Extrato de exemplo (CSV com vírgula; valores com sinal: positivo entrou, negativo saiu).
export const CSV_EXTRATO = [
  'data,descricao,valor',
  '2026-11-02,Salario teste,3000.00',
  '2026-11-03,Mercado teste,-250.50',
  '2026-11-04,Valor adicionado na conta por cartao de credito,800.00',
  '2026-11-05,Pix enviado teste,-800.00',
  '2026-11-06,Padaria teste,-30.00',
].join('\n');

// Fatura de cartão no formato de exemplo (cabeçalho date,title,amount; valores positivos = compras).
export const CSV_FATURA = ['date,title,amount', '2026-11-05,Loja teste,120.00', '2026-11-08,Restaurante teste,80.50'].join('\n');
