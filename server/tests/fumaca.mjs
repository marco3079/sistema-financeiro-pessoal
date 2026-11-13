// Suíte de integração (fumaça) contra o sistema no ar. Roda com: cd server && npm run teste
//
// Regra de ouro: tudo é gravado num PERFIL FINANCEIRO de teste criado aqui (nome "Teste automático <timestamp>").
// Todas as chamadas levam X-Perfil com esse perfil. No fim (after, mesmo se algo falhar) o perfil é apagado.
// Nunca grava nada no perfil do usuário. Resíduos de execuções anteriores com o mesmo padrão de nome são apagados
// no início (só esses).

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chamar, esperarStatus, CSV_EXTRATO, CSV_FATURA } from './ajudas.mjs';

const EMAIL = process.env.TESTE_EMAIL ?? 'demo@financas.local';
const SENHA = process.env.TESTE_SENHA ?? 'demo1234';
const PREFIXO_PERFIL = 'Teste automático ';
const RE_PERFIL_DE_TESTE = /^Teste automático \d+$/;

const estado = {
  token: null,
  perfilId: null,
  nomePerfil: null,
  categorias: {},
  contaCorrente: null,
  contaCartao: null,
  contaFixa: null,
  transacaoBazar: null,
  importacaoExtrato: null,
  importacaoFatura: null,
  chaveMcpId: null,
  chaveMcp: null,
};

// Só com o perfil de teste criado: senão a chamada cairia no primeiro perfil (o do usuário).
function exigir(valor, mensagem) {
  if (valor === null || valor === undefined) throw new Error(`Pré-requisito ausente: ${mensagem}`);
  return valor;
}

// Toda chamada da suíte passa por aqui: exige o perfil de teste, para nunca cair no perfil do usuário.
function naSuite(caminho, opcoes = {}) {
  exigir(estado.perfilId, 'perfil de teste ainda não criado');
  return chamar(opcoes.metodo ?? 'GET', caminho, {
    token: estado.token,
    perfil: estado.perfilId,
    corpo: opcoes.corpo,
  });
}

function idDaCategoria(nome) {
  const id = estado.categorias[nome];
  return exigir(id, `categoria "${nome}" do perfil de teste`);
}

async function saldoDaConta(contaId) {
  const contas = esperarStatus(await naSuite('/contas?inativas=true'), 200, 'GET /contas');
  const conta = contas.find((c) => c.id === contaId);
  assert.ok(conta, 'conta não encontrada no perfil de teste');
  return conta.saldo;
}

// Remove perfis de teste que sobraram de uma execução anterior (só os que têm o padrão do nome).
async function limparResiduos() {
  const lista = esperarStatus(await chamar('GET', '/perfis', { token: estado.token }), 200, 'GET /perfis');
  const residuos = lista.filter((p) => RE_PERFIL_DE_TESTE.test(p.nome));
  for (const p of residuos) {
    const r = await chamar('DELETE', `/perfis/${p.id}`, { token: estado.token });
    esperarStatus(r, 204, `apagar resíduo ${p.id}`);
  }
  return residuos.length;
}

describe('fumaça do sistema financeiro (API no ar)', () => {
  before(async () => {
    const login = await chamar('POST', '/auth/login', { corpo: { email: EMAIL, senha: SENHA } });
    esperarStatus(login, 200, 'login');
    estado.token = login.dados.token;
    const removidos = await limparResiduos();
    if (removidos > 0) console.log(`(resíduos de execução anterior apagados: ${removidos})`);
  });

  after(async () => {
    if (estado.perfilId === null) return;
    const apagar = await chamar('DELETE', `/perfis/${estado.perfilId}`, { token: estado.token });
    esperarStatus(apagar, 204, 'apagar perfil de teste');
    const lista = esperarStatus(await chamar('GET', '/perfis', { token: estado.token }), 200, 'GET /perfis');
    assert.equal(
      lista.some((p) => p.id === estado.perfilId),
      false,
      'o perfil de teste ainda existe depois do cleanup'
    );
    estado.perfilId = null;
  });

  test('login devolve token e o usuário logado responde em /auth/me', async () => {
    const login = await chamar('POST', '/auth/login', { corpo: { email: EMAIL, senha: SENHA } });
    const dados = esperarStatus(login, 200, 'login');
    assert.equal(typeof dados.token, 'string');
    const me = esperarStatus(await chamar('GET', '/auth/me', { token: estado.token }), 200, 'GET /auth/me');
    assert.ok(me.email || me.id, 'resposta de /auth/me sem usuário');
  });

  test('cria o perfil de teste e ele nasce com as 17 categorias padrão', async () => {
    const nome = `${PREFIXO_PERFIL}${Date.now()}`;
    const criado = esperarStatus(await chamar('POST', '/perfis', { token: estado.token, corpo: { nome } }), 201, 'POST /perfis');
    estado.perfilId = criado.id;
    estado.nomePerfil = nome;
    const categorias = esperarStatus(await naSuite('/categorias'), 200, 'GET /categorias');
    assert.equal(categorias.length, 17, `categorias padrão: esperado 17, veio ${categorias.length}`);
    for (const c of categorias) estado.categorias[c.nome] = c.id;
  });

  test('conta e lançamento: o saldo muda como esperado', async () => {
    const conta = esperarStatus(
      await naSuite('/contas', { metodo: 'POST', corpo: { nome: 'Conta corrente teste', tipo: 'CORRENTE', saldo: 1000 } }),
      201,
      'POST /contas'
    );
    estado.contaCorrente = conta.id;
    esperarStatus(
      await naSuite('/transacoes', {
        metodo: 'POST',
        corpo: {
          contaId: conta.id,
          data: '2026-11-05',
          descricao: 'Mercado teste',
          valor: 150,
          tipo: 'DESPESA',
          categoriaId: idDaCategoria('Mercado'),
        },
      }),
      201,
      'POST /transacoes'
    );
    assert.equal(await saldoDaConta(conta.id), 850);
  });

  test('extrato CSV: analisa, confirma, reimportar não duplica e o Pix no crédito vira transferência', async () => {
    const contaId = exigir(estado.contaCorrente, 'conta corrente de teste');
    const analise = esperarStatus(
      await naSuite('/importacao/analisar', {
        metodo: 'POST',
        corpo: { nome: 'extrato-teste.csv', formato: 'csv', texto: CSV_EXTRATO, documento: 'EXTRATO', contaId },
      }),
      200,
      'POST /importacao/analisar (extrato)'
    );
    assert.equal(analise.documento, 'EXTRATO');
    assert.equal(analise.itens.length, 5, 'extrato deveria ter 5 lançamentos');
    const credito = analise.itens.find((i) => /Valor adicionado/.test(i.descricao));
    const pix = analise.itens.find((i) => /Pix enviado/.test(i.descricao));
    assert.ok(credito && pix, 'credito e saída Pix não foram lidos');
    assert.equal(pix.transferencia, true, 'a saída Pix deveria virar transferência');

    const itens = analise.itens.map((i) => ({
      data: i.data,
      descricao: i.descricao,
      valor: i.valor,
      tipo: i.tipo,
      transferencia: i.transferencia,
      parcela: i.parcela,
      totalParcelas: i.totalParcelas,
    }));
    const primeira = esperarStatus(
      await naSuite('/importacao/confirmar', {
        metodo: 'POST',
        corpo: { arquivo: 'extrato-teste.csv', documento: 'EXTRATO', contaId, itens },
      }),
      201,
      'POST /importacao/confirmar (extrato)'
    );
    assert.equal(primeira.novos, 5);
    assert.equal(primeira.repetidos, 0);
    estado.importacaoExtrato = primeira.importacaoId;

    // Saldo: 850 antes + soma com sinal de todos os lançamentos do extrato (o efeito vale para todos).
    const esperado = 850 + 3000 - 250.5 + 800 - 800 - 30;
    assert.equal(await saldoDaConta(contaId), Math.round(esperado * 100) / 100);

    // Pix no crédito marcado como transferência no que ficou gravado.
    const lista = esperarStatus(
      await naSuite(`/transacoes?contaId=${contaId}&de=2026-11-01&ate=2026-11-30`),
      200,
      'GET /transacoes (extrato)'
    );
    const pixGravado = lista.itens.find((t) => /Pix enviado/.test(t.descricao));
    assert.ok(pixGravado, 'Pix não foi gravado');
    assert.equal(pixGravado.transferencia, true, 'Pix gravado deveria estar marcado como transferência');

    // Reimportar o mesmo extrato: nada novo.
    const segunda = esperarStatus(
      await naSuite('/importacao/analisar', {
        metodo: 'POST',
        corpo: { nome: 'extrato-teste.csv', formato: 'csv', texto: CSV_EXTRATO, documento: 'EXTRATO', contaId },
      }),
      200,
      'POST /importacao/analisar (reimport)'
    );
    assert.ok(segunda.itens.every((i) => i.jaImportado === true), 'na reimportação todos deveriam aparecer como já importados');
    const reconfirmada = esperarStatus(
      await naSuite('/importacao/confirmar', {
        metodo: 'POST',
        corpo: { arquivo: 'extrato-teste.csv', documento: 'EXTRATO', contaId, itens },
      }),
      201,
      'POST /importacao/confirmar (reimport)'
    );
    assert.equal(reconfirmada.novos, 0, 'reimportar não pode criar lançamentos');
    assert.equal(reconfirmada.repetidos, 5);
    assert.equal(await saldoDaConta(contaId), Math.round(esperado * 100) / 100, 'reimportar não pode mexer no saldo');
  });

  test('fatura CSV: cria a fatura e a dívida do cartão; remover a importação devolve tudo', async () => {
    const cartao = esperarStatus(
      await naSuite('/contas', {
        metodo: 'POST',
        corpo: { nome: 'Cartao teste', tipo: 'CARTAO', limite: 5000, diaFechamento: 3, diaVencimento: 10 },
      }),
      201,
      'POST /contas (cartão)'
    );
    estado.contaCartao = cartao.id;
    const analise = esperarStatus(
      await naSuite('/importacao/analisar', {
        metodo: 'POST',
        corpo: { nome: 'fatura-teste.csv', formato: 'csv', texto: CSV_FATURA, documento: 'FATURA', contaId: cartao.id },
      }),
      200,
      'POST /importacao/analisar (fatura)'
    );
    assert.equal(analise.documento, 'FATURA');
    assert.equal(analise.itens.length, 2);
    const itens = analise.itens.map((i) => ({
      data: i.data,
      descricao: i.descricao,
      valor: i.valor,
      tipo: i.tipo,
      transferencia: i.transferencia,
      parcela: i.parcela,
      totalParcelas: i.totalParcelas,
    }));
    const confirmada = esperarStatus(
      await naSuite('/importacao/confirmar', {
        metodo: 'POST',
        corpo: { arquivo: 'fatura-teste.csv', documento: 'FATURA', contaId: cartao.id, vencimento: '2026-12-10', itens },
      }),
      201,
      'POST /importacao/confirmar (fatura)'
    );
    assert.equal(confirmada.novos, 2);
    estado.importacaoFatura = confirmada.importacaoId;

    const fatura = esperarStatus(await naSuite(`/faturas?contaId=${cartao.id}`), 200, 'GET /faturas');
    assert.equal(fatura.length, 1, 'deveria haver uma fatura');
    assert.equal(fatura[0].total, 200.5, 'total da fatura');
    assert.equal(fatura[0].vencimento, '2026-12-10');
    assert.equal(await saldoDaConta(cartao.id), 200.5, 'dívida do cartão deveria ser a fatura em aberto');

    const cartoes = esperarStatus(await naSuite('/cartoes'), 200, 'GET /cartoes');
    const resumo = cartoes.find((c) => c.conta.id === cartao.id);
    assert.ok(resumo && resumo.faturaAtual, 'cartão sem fatura atual no resumo');
    assert.equal(resumo.faturaAtual.total, 200.5);

    const conciliacao = esperarStatus(await naSuite('/conciliacao'), 200, 'GET /conciliacao');
    assert.equal(conciliacao.divergencias, 0, 'conciliação com divergência logo após a importação');

    // Remove a importação da fatura: saldo do cartão e fatura voltam ao que era.
    esperarStatus(
      await naSuite(`/importacao/${estado.importacaoFatura}`, { metodo: 'DELETE' }),
      200,
      'DELETE /importacao (fatura)'
    );
    estado.importacaoFatura = null;
    assert.equal(await saldoDaConta(cartao.id), 0, 'saldo do cartão deveria voltar a 0');
    const faturasDepois = esperarStatus(await naSuite(`/faturas?contaId=${cartao.id}`), 200, 'GET /faturas (depois)');
    assert.ok(faturasDepois.every((f) => f.total === 0), 'fatura com valor depois de remover a importação');
  });

  test('regras de categoria: a prévia não grava e aplicar grava', async () => {
    const contaId = exigir(estado.contaCorrente, 'conta corrente de teste');
    const criada = esperarStatus(
      await naSuite('/transacoes', {
        metodo: 'POST',
        corpo: { contaId, data: '2026-11-06', descricao: 'Bazar teste compra', valor: 45, tipo: 'DESPESA' },
      }),
      201,
      'POST /transacoes (sem categoria)'
    );
    estado.transacaoBazar = criada.id;
    const compras = idDaCategoria('Compras');
    esperarStatus(
      await naSuite('/regras', { metodo: 'POST', corpo: { trecho: 'bazar teste', categoriaId: compras } }),
      201,
      'POST /regras'
    );

    const previa = esperarStatus(
      await naSuite('/regras/reprocessar', { metodo: 'POST', corpo: { aplicar: false, sobrescrever: false } }),
      200,
      'POST /regras/reprocessar (prévia)'
    );
    assert.equal(previa.aplicado, false);
    assert.ok(
      previa.categorizar.some((i) => i.id === estado.transacaoBazar && i.categoriaNova === 'Compras'),
      'a prévia deveria listar o lançamento para categorizar'
    );
    const antes = esperarStatus(await naSuite(`/transacoes?contaId=${contaId}&de=2026-11-01&ate=2026-11-30`), 200, 'GET /transacoes (prévia)');
    assert.equal(antes.itens.find((t) => t.id === estado.transacaoBazar).categoriaId, null, 'a prévia não pode gravar');

    const aplicada = esperarStatus(
      await naSuite('/regras/reprocessar', { metodo: 'POST', corpo: { aplicar: true, sobrescrever: false } }),
      200,
      'POST /regras/reprocessar (aplicar)'
    );
    assert.equal(aplicada.aplicado, true);
    const depois = esperarStatus(await naSuite(`/transacoes?contaId=${contaId}&de=2026-11-01&ate=2026-11-30`), 200, 'GET /transacoes (aplicada)');
    assert.equal(depois.itens.find((t) => t.id === estado.transacaoBazar).categoriaId, compras, 'aplicar deveria categorizar');
  });

  test('contas fixas, agenda (dia 31 em fevereiro) e fluxo de caixa', async () => {
    const fixa = esperarStatus(
      await naSuite('/contas-fixas', {
        metodo: 'POST',
        corpo: { descricao: 'Aluguel teste', tipo: 'DESPESA', valor: 1200, diaDoMes: 31 },
      }),
      201,
      'POST /contas-fixas'
    );
    estado.contaFixa = fixa.id;

    const agenda = esperarStatus(await naSuite('/agenda?mes=2027-02'), 200, 'GET /agenda');
    const item = agenda.itens.find((i) => i.contaFixaId === fixa.id);
    assert.ok(item, 'conta fixa não apareceu na agenda de fevereiro');
    assert.equal(item.data, '2027-02-28', 'dia 31 em fevereiro deveria cair em 28');
    assert.ok(agenda.aPagar >= 1200, 'aPagar deveria incluir a conta fixa');

    esperarStatus(
      await naSuite(`/contas-fixas/${fixa.id}/pagar`, { metodo: 'POST', corpo: { mes: '2027-02' } }),
      200,
      'POST /contas-fixas/:id/pagar'
    );
    const agendaPaga = esperarStatus(await naSuite('/agenda?mes=2027-02'), 200, 'GET /agenda (paga)');
    assert.equal(agendaPaga.itens.find((i) => i.contaFixaId === fixa.id).situacao, 'PAGA');

    const fluxo = esperarStatus(await naSuite('/fluxo?meses=3'), 200, 'GET /fluxo?meses=3');
    assert.equal(fluxo.meses.length, 3, 'fluxo com 3 meses');
    assert.equal(typeof fluxo.saldoInicial, 'number');
    const invalido = await naSuite('/fluxo?meses=4');
    assert.equal(invalido.status, 400, 'fluxo aceita só 3, 6 ou 12 meses');
  });

  test('divisão de gastos: a soma das partes não passa do valor', async () => {
    const contaId = exigir(estado.contaCorrente, 'conta corrente de teste');
    const jantar = esperarStatus(
      await naSuite('/transacoes', {
        metodo: 'POST',
        corpo: {
          contaId,
          data: '2026-11-07',
          descricao: 'Jantar teste',
          valor: 100,
          tipo: 'DESPESA',
          categoriaId: idDaCategoria('Restaurantes'),
        },
      }),
      201,
      'POST /transacoes (jantar)'
    );
    const dividir = (partes) => naSuite('/divisoes', { metodo: 'POST', corpo: { transacaoId: jantar.id, partes } });

    const primeira = esperarStatus(
      await dividir([
        { pessoa: 'Ana teste', valor: 60 },
        { pessoa: 'Bia teste', valor: 30 },
      ]),
      201,
      'POST /divisoes (60 + 30)'
    );
    assert.equal(primeira.criadas, 2);

    const passou = await dividir([{ pessoa: 'Caio teste', valor: 20 }]);
    assert.equal(passou.status, 400, 'partes passando de 100 deveriam ser recusadas');

    esperarStatus(await dividir([{ pessoa: 'Caio teste', valor: 10 }]), 201, 'POST /divisoes (fecha 100)');

    const centavo = await dividir([{ pessoa: 'Dan teste', valor: 0.01 }]);
    assert.equal(centavo.status, 400, 'nenhuma parte extra pode caber depois de fechar 100');
  });

  test('carteira-alvo: aceita percentuais que somam 100 e recusa os demais', async () => {
    const certo = esperarStatus(
      await naSuite('/alvo', {
        metodo: 'PUT',
        corpo: {
          classes: [
            { classe: 'RENDA_VARIAVEL', percentual: 50 },
            { classe: 'RENDA_FIXA', percentual: 30 },
            { classe: 'FUNDOS', percentual: 10 },
            { classe: 'OUTROS', percentual: 10 },
          ],
        },
      }),
      200,
      'PUT /alvo (soma 100)'
    );
    assert.equal(certo.definido, true);
    const errado = await naSuite('/alvo', {
      metodo: 'PUT',
      corpo: {
        classes: [
          { classe: 'RENDA_VARIAVEL', percentual: 50 },
          { classe: 'RENDA_FIXA', percentual: 30 },
          { classe: 'FUNDOS', percentual: 10 },
          { classe: 'OUTROS', percentual: 9 },
        ],
      },
    });
    assert.equal(errado.status, 400, 'alvo que soma 99 deveria ser recusado');
  });

  test('conciliação sem divergência no perfil de teste', async () => {
    const conciliacao = esperarStatus(await naSuite('/conciliacao'), 200, 'GET /conciliacao');
    assert.equal(conciliacao.divergencias, 0);
  });

  test('telas de leitura respondem 200', async () => {
    const caminhos = ['/analise', '/alertas', '/ir', '/carteira', '/carteira/proventos', '/rendimento', '/cartoes/previsao', '/painel/resumo'];
    for (const caminho of caminhos) {
      esperarStatus(await naSuite(caminho), 200, `GET ${caminho}`);
    }
  });

  test('MCP: chave de leitura inicializa, lista, chama e não escreve; a chave apagada deixa de valer', async () => {
    const criada = esperarStatus(
      await naSuite('/mcp/chaves', { metodo: 'POST', corpo: { nome: 'Chave de teste', permissao: 'LEITURA' } }),
      201,
      'POST /mcp/chaves'
    );
    assert.ok(typeof criada.chave === 'string' && criada.chave.startsWith('fin_'), 'chave não veio no formato esperado');
    estado.chaveMcpId = criada.id;
    estado.chaveMcp = criada.chave;

    const mcp = (corpo) => chamar('POST', '/mcp', { token: estado.chaveMcp, corpo });

    const init = await mcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
    assert.equal(init.status, 200, 'initialize');
    assert.equal(init.dados.result.serverInfo.name, 'financas-pessoais');

    const notificacao = await mcp({ jsonrpc: '2.0', method: 'notifications/initialized' });
    assert.equal(notificacao.status, 202, 'notificação deveria responder 202');

    const lista = await mcp({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const ferramentas = lista.dados.result.tools;
    assert.ok(ferramentas.length > 0, 'tools/list vazio');
    assert.ok(
      ferramentas.every((f) => f.annotations?.readOnlyHint === true),
      'chave de leitura não pode ver ferramenta de escrita'
    );
    assert.ok(!ferramentas.some((f) => f.name === 'criar_lancamento'), 'criar_lancamento não deveria aparecer para leitura');

    const chamada = await mcp({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'visao_geral', arguments: {} } });
    assert.ok(!chamada.dados.result.isError, 'visao_geral falhou');
    assert.doesNotThrow(() => JSON.parse(chamada.dados.result.content[0].text), 'visao_geral deveria devolver JSON');

    const escrita = await mcp({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'criar_lancamento', arguments: { contaId: 1, valor: 10, tipo: 'DESPESA', descricao: 'x', data: '2026-11-01' } },
    });
    assert.equal(escrita.dados.error?.code, -32602, 'chave de leitura não pode chamar ferramenta de escrita');

    esperarStatus(await naSuite(`/mcp/chaves/${estado.chaveMcpId}`, { metodo: 'DELETE' }), 204, 'DELETE /mcp/chaves/:id');
    estado.chaveMcpId = null;
    const apagada = await mcp({ jsonrpc: '2.0', id: 5, method: 'tools/list' });
    assert.equal(apagada.status, 401, 'chave apagada ainda funciona');
    estado.chaveMcp = null;
  });

  test('isolamento: o que foi criado no perfil de teste não aparece no perfil do usuário', async () => {
    const perfis = esperarStatus(await chamar('GET', '/perfis', { token: estado.token }), 200, 'GET /perfis');
    const outro = perfis.filter((p) => p.id !== estado.perfilId).sort((a, b) => a.id - b.id)[0];
    assert.ok(outro, 'não há outro perfil para comparar o isolamento');
    const contasOutro = esperarStatus(await chamar('GET', '/contas?inativas=true', { token: estado.token, perfil: outro.id }), 200, 'GET /contas (outro perfil)');
    const nomes = contasOutro.map((c) => c.nome);
    for (const proibido of ['Conta corrente teste', 'Cartao teste']) {
      assert.equal(nomes.includes(proibido), false, `"${proibido}" vazou para outro perfil`);
    }
    const lancamentosOutro = esperarStatus(
      await chamar('GET', '/transacoes?de=2026-11-01&ate=2026-11-30', { token: estado.token, perfil: outro.id }),
      200,
      'GET /transacoes (outro perfil)'
    );
    assert.equal(
      lancamentosOutro.itens.some((t) => t.descricao === 'Bazar teste compra' || t.descricao === 'Jantar teste'),
      false,
      'lançamento de teste vazou para outro perfil'
    );
  });
});
