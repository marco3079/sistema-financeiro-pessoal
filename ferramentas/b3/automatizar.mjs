// Traz a planilha de movimentação da Área do Investidor da B3 para o sistema financeiro.
//
// Quem chama é o link financas-b3:// do botão "Atualizar pela B3" (topo da Carteira), registrado no Windows pelo
// registrar-b3.ps1. O link traz o número da tarefa, uma senha de uso único e o período escolhido na tela.
//
// A B3 bloqueia navegadores controlados por automação (as páginas ficam em branco). Por isso o script abre o
// Chrome NORMAL, sem controlá-lo, numa janela com um perfil temporário (sem login salvo, apagado no fim), direto em
// Extratos > Movimentação. A pessoa entra na conta, filtra o período (o popup mostra as datas) e baixa em Excel.
// O script só vigia a pasta de downloads desse perfil temporário: quando a planilha chega, ele a manda para o
// sistema, fecha a janela e a tela mostra a prévia da importação (sem repetir o que já foi importado).
// O script não lê a página, não digita nada e não vê a senha.
//
// Uso: node automatizar.mjs "financas-b3://iniciar/?id=...&token=...&de=AAAA-MM-DD&ate=AAAA-MM-DD"

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PASTA = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(PASTA, '..', '..');
const MOVIMENTACAO = 'https://www.investidor.b3.com.br/extrato/movimentacao';
const PRIMEIRO_DIA_B3 = '2019-11-01'; // a Área do Investidor não tem movimentação antes disto
const ESPERA_MS = 20 * 60 * 1000;
const SINAL_MS = 15 * 1000;
const OLHAR_MS = 2000;

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

function br(iso) {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

function esperar(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------- Chrome normal, com perfil temporário ----------

function acharChrome() {
  const candidatos = [
    process.env.CHROME,
    path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
  ].filter(Boolean);
  const achado = candidatos.find((c) => fs.existsSync(c));
  if (!achado) throw new Error('O Google Chrome não foi encontrado neste computador.');
  return achado;
}

// Perfil novo com a pasta de downloads própria e sem perguntar onde salvar.
function prepararPerfil() {
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'financas-b3-'));
  const downloads = path.join(perfil, 'downloads');
  fs.mkdirSync(path.join(perfil, 'Default'), { recursive: true });
  fs.mkdirSync(downloads);
  const preferencias = {
    download: { default_directory: downloads, prompt_for_download: false, directory_upgrade: true },
    savefile: { default_directory: downloads },
    profile: { exit_type: 'Normal', exited_cleanly: true },
  };
  fs.writeFileSync(path.join(perfil, 'Default', 'Preferences'), JSON.stringify(preferencias));
  return { perfil, downloads };
}

function abrirChrome(chrome, perfil) {
  const processo = spawn(
    chrome,
    [`--user-data-dir=${perfil}`, '--no-first-run', '--no-default-browser-check', '--new-window', '--window-size=1300,940', MOVIMENTACAO],
    { stdio: 'ignore', detached: false }
  );
  processo.on('error', () => undefined);
  return processo;
}

// Planilha completa na pasta (o Chrome grava .crdownload enquanto baixa): espera o tamanho parar de mudar.
async function esperarPlanilha(downloads, chromeAberto) {
  const limite = Date.now() + ESPERA_MS;
  const tamanhos = new Map();
  while (Date.now() < limite) {
    if (cancelada) throw new Error('Atualização cancelada.');
    if (!chromeAberto()) throw new Error('A janela do Chrome foi fechada antes de baixar a planilha.');
    await esperar(OLHAR_MS);
    for (const nome of fs.readdirSync(downloads)) {
      if (!/\.xlsx$/i.test(nome)) continue;
      const caminho = path.join(downloads, nome);
      const tamanho = fs.statSync(caminho).size;
      if (tamanho > 0 && tamanhos.get(nome) === tamanho) return { caminho, nome };
      tamanhos.set(nome, tamanho);
    }
  }
  throw new Error('A planilha não foi baixada em 20 minutos.');
}

function apagarPerfil(perfil) {
  for (let i = 0; i < 10; i++) {
    try {
      fs.rmSync(perfil, { recursive: true, force: true });
      return;
    } catch {
      // o Chrome ainda está soltando os arquivos
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
}

// ---------- Principal ----------

async function principal() {
  tarefa = lerLink(process.argv[2]);
  console.log(`Sistema: ${API}`);
  console.log(`Período: ${br(tarefa.de)} a ${br(tarefa.ate)}`);
  await avisar('ABRINDO', 'Abrindo uma janela limpa do Chrome na Área do Investidor da B3...');

  const chrome = acharChrome();
  const { perfil, downloads } = prepararPerfil();
  const processo = abrirChrome(chrome, perfil);
  let aberto = true;
  processo.on('exit', () => {
    aberto = false;
  });
  const fecharChrome = () => {
    if (aberto) processo.kill();
  };
  aoCancelar = fecharChrome;
  const sinal = setInterval(() => avisar(etapaAtual), SINAL_MS);
  try {
    await avisar(
      'AGUARDANDO_VOCE',
      `Na janela do Chrome: entre na sua conta da B3, em Movimentação filtre de ${br(tarefa.de)} a ${br(tarefa.ate)} e baixe em Excel. Assim que a planilha baixar, ela vem para cá sozinha.`
    );
    console.log('   Se não estiver vendo a janela, procure o ícone do Chrome na barra de tarefas.');
    const { caminho, nome } = await esperarPlanilha(downloads, () => aberto);
    const conteudo = fs.readFileSync(caminho);
    if (conteudo[0] !== 0x50 || conteudo[1] !== 0x4b) throw new Error(`O arquivo baixado (${nome}) não é uma planilha Excel.`);
    await avisar('BAIXANDO', `Planilha baixada (${nome}). Mandando para o sistema...`);
    await chamar('/arquivo', { nome, conteudo: conteudo.toString('base64') });
    console.log('\nPronto: a planilha chegou ao sistema. Confira a prévia no popup e clique em Importar.');
  } finally {
    clearInterval(sinal);
    fecharChrome();
    await esperar(1500);
    apagarPerfil(perfil);
  }
}

principal().catch(async (erro) => {
  const texto = erro instanceof Error ? erro.message : String(erro);
  console.error('\nNão deu certo:', texto);
  if (tarefa && !cancelada) await chamar('/andamento', { etapa: 'ERRO', mensagem: texto.slice(0, 380) }).catch(() => undefined);
  process.exitCode = cancelada ? 0 : 1;
});
