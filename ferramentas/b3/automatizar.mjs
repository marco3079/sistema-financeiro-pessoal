// Traz a planilha de movimentação da Área do Investidor da B3 para o sistema financeiro.
//
// Quem chama é o link financas-b3:// do botão "Atualizar pela B3" (Carteira > Proventos), registrado no Windows
// pelo registrar-b3.ps1. O link traz o número da tarefa, uma senha de uso único e o período escolhido na tela.
//
// O script abre uma janela limpa do Chrome na B3 e a PESSOA faz o login nela (CPF, senha, CAPTCHA e o que mais a B3
// pedir). O script não lê nem guarda a senha, e o login não fica salvo: o perfil do Chrome é temporário e é apagado
// no fim. Depois do login ele abre Extratos > Movimentação, filtra o período, exporta em Excel e manda o arquivo
// para o sistema. A tela mostra a prévia e importa pelo mesmo caminho da Importação, sem repetir o que já existe.
// Se a B3 mudar a página e algum botão não for achado, o script pede para a pessoa terminar na janela e espera
// o download.
//
// Uso: node automatizar.mjs "financas-b3://iniciar/?id=...&token=...&de=AAAA-MM-DD&ate=AAAA-MM-DD"

import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PASTA = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(PASTA, '..', '..');
const INICIO = 'https://www.investidor.b3.com.br/';
const MOVIMENTACAO = 'https://www.investidor.b3.com.br/extrato/movimentacao';
const HOST_B3 = 'www.investidor.b3.com.br';
const PRIMEIRO_DIA_B3 = '2019-11-01'; // a Área do Investidor não tem movimentação antes disto
const ESPERA_LOGIN_MS = 10 * 60 * 1000;
const ESPERA_MANUAL_MS = 10 * 60 * 1000;
const SINAL_MS = 15 * 1000;

// ---------- Tarefa (vinda do link) ----------

function lerLink(texto) {
  let url;
  try {
    url = new URL(String(texto ?? ''));
  } catch {
    throw new Error('Link inválido. Comece pelo botão "Atualizar pela B3" no sistema.');
  }
  if (url.protocol !== 'financas-b3:') throw new Error('Link inválido (não é financas-b3://).');
  const p = url.searchParams;
  const tarefa = { id: p.get('id') ?? '', token: p.get('token') ?? '', de: p.get('de') ?? '', ate: p.get('ate') ?? '' };
  if (!/^[0-9a-f-]{36}$/i.test(tarefa.id)) throw new Error('Link sem o número da tarefa.');
  if (!/^[A-Za-z0-9_-]{30,100}$/.test(tarefa.token)) throw new Error('Link sem a senha da tarefa.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tarefa.de) || !/^\d{4}-\d{2}-\d{2}$/.test(tarefa.ate)) throw new Error('Link sem o período.');
  if (tarefa.de < PRIMEIRO_DIA_B3) tarefa.de = PRIMEIRO_DIA_B3;
  return tarefa;
}

// Endereço da API: sempre este computador, na porta do .env do projeto (nunca um endereço vindo do link).
function enderecoDaApi() {
  let porta = '3092';
  try {
    const env = fs.readFileSync(path.join(RAIZ, '.env'), 'utf8');
    const m = /^\s*API_PORT\s*=\s*"?(\d{2,5})"?\s*$/m.exec(env);
    if (m) porta = m[1];
  } catch {
    // sem .env: porta padrão
  }
  return `http://127.0.0.1:${porta}`;
}

const API = enderecoDaApi();
let tarefa = null;
let etapaAtual = 'ABRINDO';
let cancelada = false;
let aoCancelar = () => undefined;

async function chamar(caminho, corpo) {
  const resposta = await fetch(`${API}/api/b3/automacao/${tarefa.id}${caminho}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tarefa.token}` },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(60000),
  });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(dados.erro ?? `O sistema recusou (${resposta.status}).`);
  return dados;
}

// Conta à tela o que está acontecendo; se a tela cancelou, fecha tudo.
async function avisar(etapa, mensagem = '') {
  etapaAtual = etapa;
  if (mensagem) console.log(mensagem);
  try {
    const r = await chamar('/andamento', { etapa, mensagem });
    if (r.continuar === false && etapa !== 'ERRO' && !cancelada) {
      cancelada = true;
      console.log('A atualização foi cancelada na tela.');
      aoCancelar();
    }
  } catch (erro) {
    console.log(`(não consegui avisar o sistema: ${erro instanceof Error ? erro.message : erro})`);
  }
}

function conferirCancelamento() {
  if (cancelada) throw new Error('Atualização cancelada.');
}

function br(iso) {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

// ---------- Login (feito pela pessoa) ----------

async function temCampoDeLogin(pagina) {
  return pagina
    .evaluate(() =>
      [...document.querySelectorAll('input')].some((i) => {
        const r = i.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        return i.type === 'password' || /cpf|cnpj|documento|login|usu[aá]rio/i.test(`${i.name} ${i.id} ${i.placeholder} ${i.getAttribute('aria-label') ?? ''}`);
      })
    )
    .catch(() => true);
}

async function pareceLogado(pagina) {
  let url;
  try {
    url = new URL(pagina.url());
  } catch {
    return false;
  }
  if (url.host !== HOST_B3 || /login|acesso|cadastro/i.test(url.pathname)) return false;
  if (await temCampoDeLogin(pagina)) return false;
  if (/^\/(home|extrato|posicao|proventos|meus-investimentos|relatorios)/i.test(url.pathname)) return true;
  const texto = await pagina.evaluate(() => document.body?.innerText ?? '').catch(() => '');
  return /\bSair\b|Ol[aá],|Meus investimentos|Extratos?\b/i.test(texto) && !/\bAcessar\b|\bEntrar\b/i.test(texto.slice(0, 600));
}

async function abrirMovimentacao(pagina) {
  await pagina.goto(MOVIMENTACAO, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
  const limite = Date.now() + 30000;
  while (Date.now() < limite) {
    conferirCancelamento();
    await pagina.waitForTimeout(1500);
    const url = pagina.url();
    if (!url.includes(HOST_B3) || /login/i.test(url)) return false; // a sessão não vale: volta para o login
    if (/movimenta/i.test(url) && /Movimenta[cç][aã]o/i.test(await pagina.evaluate(() => document.body?.innerText ?? '').catch(() => ''))) {
      return true;
    }
  }
  return /movimenta/i.test(pagina.url());
}

async function esperarLogin(pagina) {
  await pagina.goto(INICIO, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
  await pagina.bringToFront();
  await avisar('LOGIN', 'Entre na sua conta da B3 na janela do Chrome que abriu. Estou esperando (até 10 minutos).');
  console.log('   Se não estiver vendo a janela, procure o ícone do Chrome na barra de tarefas (ela pode ter aberto atrás).');
  const limite = Date.now() + ESPERA_LOGIN_MS;
  while (Date.now() < limite) {
    conferirCancelamento();
    if (pagina.isClosed()) throw new Error('A janela do Chrome foi fechada antes do login.');
    await pagina.waitForTimeout(2000);
    if (!(await pareceLogado(pagina))) continue;
    await avisar('BAIXANDO', 'Login feito. Abrindo Extratos > Movimentação...');
    if (await abrirMovimentacao(pagina)) return;
    await avisar('LOGIN', 'A B3 voltou para o login. Entre de novo na janela do Chrome.');
  }
  throw new Error('O login na B3 não foi feito em 10 minutos.');
}

// ---------- Filtro e exportação ----------

const CLICAVEIS = 'button, a, [role="button"], [role="menuitem"], [role="option"], [role="radio"], [role="tab"], mat-option, label';

async function clicarTexto(pagina, padrao, tempo = 8000) {
  const limite = Date.now() + tempo;
  while (Date.now() < limite) {
    conferirCancelamento();
    const alvos = pagina.locator(CLICAVEIS).filter({ hasText: padrao });
    const n = await alvos.count().catch(() => 0);
    for (let i = n - 1; i >= 0; i--) {
      const alvo = alvos.nth(i);
      if (await alvo.isVisible().catch(() => false)) {
        await alvo.click({ timeout: 5000 }).catch(() => undefined);
        await pagina.waitForTimeout(800);
        return true;
      }
    }
    // Botões só com ícone: procura pelo título ou pelo aria-label.
    const porRotulo = pagina.locator('button[aria-label], button[title], [role="button"][aria-label]');
    const m = await porRotulo.count().catch(() => 0);
    for (let i = 0; i < m; i++) {
      const alvo = porRotulo.nth(i);
      const rotulo = `${(await alvo.getAttribute('aria-label').catch(() => '')) ?? ''} ${(await alvo.getAttribute('title').catch(() => '')) ?? ''}`;
      if (padrao.test(rotulo) && (await alvo.isVisible().catch(() => false))) {
        await alvo.click({ timeout: 5000 }).catch(() => undefined);
        await pagina.waitForTimeout(800);
        return true;
      }
    }
    await pagina.waitForTimeout(700);
  }
  return false;
}

// Os dois campos de data do filtro (inicial e final), pelos rótulos; senão os dois primeiros campos de data.
async function camposDeData(pagina) {
  const marcados = await pagina.evaluate(() => {
    const visivel = (e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden';
    };
    const campos = [...document.querySelectorAll('input')].filter((i) => visivel(i) && !['checkbox', 'radio', 'hidden', 'search'].includes(i.type));
    const descricao = (i) => {
      const rotulo = i.id ? document.querySelector(`label[for="${CSS.escape(i.id)}"]`)?.textContent ?? '' : '';
      const perto = i.closest('mat-form-field, .mat-form-field, .mat-mdc-form-field, .form-group, .form-field, label')?.textContent ?? '';
      return `${i.name} ${i.id} ${i.placeholder} ${i.getAttribute('aria-label') ?? ''} ${i.getAttribute('formcontrolname') ?? ''} ${rotulo} ${perto.slice(0, 80)}`;
    };
    const ehData = (i) => i.type === 'date' || /dd\/mm|data|in[ií]cio|inicial|final|\bfim\b|per[ií]odo/i.test(descricao(i));
    const datas = campos.filter(ehData);
    let inicial = datas.findIndex((i) => /inicial|in[ií]cio|start/i.test(descricao(i)));
    let final = datas.findIndex((i, n) => n !== inicial && /final|\bfim\b|\bend/i.test(descricao(i)));
    if (inicial < 0 || final < 0) {
      inicial = 0;
      final = 1;
    }
    datas.forEach((i) => i.removeAttribute('data-fin-b3'));
    if (datas[inicial]) datas[inicial].setAttribute('data-fin-b3', 'de');
    if (datas[final]) datas[final].setAttribute('data-fin-b3', 'ate');
    return datas.length;
  });
  if (marcados < 2) return null;
  return { de: pagina.locator('input[data-fin-b3="de"]'), ate: pagina.locator('input[data-fin-b3="ate"]') };
}

async function preencherData(pagina, campo, iso) {
  const tipo = await campo.getAttribute('type').catch(() => null);
  if (tipo === 'date') {
    await campo.fill(iso);
  } else {
    await campo.click();
    await pagina.keyboard.press('Control+A');
    await pagina.keyboard.press('Backspace');
    await pagina.keyboard.type(br(iso), { delay: 40 });
    const valor = (await campo.inputValue().catch(() => '')).replace(/\D/g, '');
    // Máscara que não aceita as barras: digita só os números.
    if (valor !== br(iso).replace(/\D/g, '') && valor !== iso.replace(/\D/g, '')) {
      await pagina.keyboard.press('Control+A');
      await pagina.keyboard.press('Backspace');
      await pagina.keyboard.type(br(iso).replace(/\D/g, ''), { delay: 40 });
    }
  }
  await pagina.keyboard.press('Tab').catch(() => undefined);
  await pagina.waitForTimeout(300);
}

async function filtrarPeriodo(pagina) {
  await pagina.waitForTimeout(2500);
  let campos = await camposDeData(pagina);
  if (!campos) {
    await clicarTexto(pagina, /^\s*(Filtrar|Filtros?)\s*$/i, 10000);
    await pagina.waitForTimeout(1200);
    campos = await camposDeData(pagina);
  }
  if (!campos) return false;
  await preencherData(pagina, campos.de, tarefa.de);
  await preencherData(pagina, campos.ate, tarefa.ate);
  // Fecha o calendário que tenha ficado aberto e aplica o filtro.
  await pagina.keyboard.press('Escape').catch(() => undefined);
  await clicarTexto(pagina, /^\s*(Filtrar|Aplicar( filtros?)?|Buscar|Pesquisar|Consultar)\s*$/i, 6000);
  await pagina.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => undefined);
  await pagina.waitForTimeout(2000);
  return true;
}

// Espera o próximo download em qualquer aba da janela.
function proximoDownload(contexto, tempo) {
  return new Promise((resolve, reject) => {
    const paginas = new Set();
    const relogio = setTimeout(() => fim(new Error('O download da planilha não começou.')), tempo);
    const aoBaixar = (download) => fim(null, download);
    const vigiar = (p) => {
      if (paginas.has(p)) return;
      paginas.add(p);
      p.on('download', aoBaixar);
    };
    const aoAbrir = (p) => vigiar(p);
    function fim(erro, download) {
      clearTimeout(relogio);
      contexto.off('page', aoAbrir);
      for (const p of paginas) p.off('download', aoBaixar);
      if (erro) reject(erro);
      else resolve(download);
    }
    contexto.pages().forEach(vigiar);
    contexto.on('page', aoAbrir);
  });
}

async function exportar(pagina, contexto) {
  const download = proximoDownload(contexto, 60000);
  download.catch(() => undefined);
  if (!(await clicarTexto(pagina, /Baixar|Exportar|Download/i, 10000))) return null;
  await pagina.waitForTimeout(1200);
  // A B3 pergunta o formato: Excel (às vezes com um segundo botão para confirmar).
  if (await clicarTexto(pagina, /Excel|XLSX/i, 5000)) {
    await pagina.waitForTimeout(800);
    await clicarTexto(pagina, /^\s*(Baixar|Confirmar|Exportar|Download)\s*$/i, 3000);
  }
  return download.catch(() => null);
}

// ---------- Principal ----------

async function principal() {
  tarefa = lerLink(process.argv[2]);
  console.log(`Sistema: ${API}`);
  console.log(`Período: ${br(tarefa.de)} a ${br(tarefa.ate)}`);
  await avisar('ABRINDO', 'Abrindo uma janela limpa do Chrome na Área do Investidor da B3...');

  // Perfil temporário: começa sem login nenhum e é apagado no fim.
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'financas-b3-'));
  const contexto = await chromium.launchPersistentContext(perfil, {
    channel: 'chrome',
    headless: false,
    acceptDownloads: true,
    viewport: null,
    locale: 'pt-BR',
    args: ['--window-size=1300,940', '--window-position=60,40'],
  });
  aoCancelar = () => contexto.close().catch(() => undefined);
  const sinal = setInterval(() => avisar(etapaAtual), SINAL_MS);
  try {
    const pagina = contexto.pages()[0] ?? (await contexto.newPage());
    await esperarLogin(pagina);

    await avisar('BAIXANDO', `Filtrando a movimentação de ${br(tarefa.de)} a ${br(tarefa.ate)}...`);
    let download = null;
    if (await filtrarPeriodo(pagina)) {
      await avisar('BAIXANDO', 'Exportando a planilha em Excel...');
      download = await exportar(pagina, contexto);
    }
    if (!download) {
      conferirCancelamento();
      // A página mudou ou algum botão não apareceu: a pessoa termina na janela, e o script pega o download.
      await pagina.bringToFront().catch(() => undefined);
      await avisar(
        'AGUARDANDO_VOCE',
        `Não achei o botão sozinho. Na janela da B3, em Extratos > Movimentação, filtre de ${br(tarefa.de)} a ${br(tarefa.ate)} e baixe em Excel. Assim que o arquivo baixar, eu mando para o sistema.`
      );
      download = await proximoDownload(contexto, ESPERA_MANUAL_MS).catch(() => null);
      if (!download) throw new Error('A planilha não foi baixada em 10 minutos.');
    }
    conferirCancelamento();

    const caminho = await download.path();
    const nome = download.suggestedFilename() || 'movimentacao-b3.xlsx';
    if (!caminho) throw new Error('O download da planilha falhou.');
    const conteudo = fs.readFileSync(caminho);
    if (conteudo[0] !== 0x50 || conteudo[1] !== 0x4b) throw new Error(`O arquivo baixado (${nome}) não é uma planilha Excel.`);
    await avisar('BAIXANDO', `Planilha baixada (${nome}). Mandando para o sistema...`);
    await chamar('/arquivo', { nome, conteudo: conteudo.toString('base64') });
    console.log('\nPronto: a planilha chegou ao sistema. Confira a prévia no popup e clique em Importar.');
  } finally {
    clearInterval(sinal);
    await contexto.close().catch(() => undefined);
    fs.rmSync(perfil, { recursive: true, force: true });
  }
}

principal().catch(async (erro) => {
  const texto = erro instanceof Error ? erro.message : String(erro);
  console.error('\nNão deu certo:', texto);
  if (tarefa && !cancelada) {
    const motivo = /executable doesn't exist|chrome/i.test(texto) && /launch|exist/i.test(texto) ? 'O Google Chrome não foi encontrado neste computador.' : texto;
    await chamar('/andamento', { etapa: 'ERRO', mensagem: motivo.slice(0, 380) }).catch(() => undefined);
  }
  process.exitCode = cancelada ? 0 : 1;
});
