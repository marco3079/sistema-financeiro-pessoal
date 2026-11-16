// Traz as carteiras recomendadas da Suno Research para o sistema financeiro.
//
// A Suno não tem API. Este script abre uma janela do Chrome limpa, você entra na SUA conta da Suno nessa janela
// e ele visita as páginas das carteiras que você assina, lê as tabelas e o seu plano (com a data de vencimento)
// e manda para o sistema. A senha da Suno fica só no navegador: o script não a lê nem a guarda.
// O login não fica salvo: a janela usa um perfil temporário, apagado no fim, e cada atualização pede o login.
//
// Uso: powershell -ExecutionPolicy Bypass -File ferramentas\suno\sincronizar-suno.ps1
//  (ou: node ferramentas/suno/sincronizar.mjs)
//
// Configuração (config.json nesta pasta, criado na primeira vez):
//   api:   endereço da API do sistema (padrão http://localhost:3092)
//   chave: chave de acesso criada em "Conectar IA", com permissão "consulta e lança"


import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { INICIO, lerTudo, mostraCarteiras, naSuno } from './leitor.mjs';

const PASTA = path.dirname(fileURLToPath(import.meta.url));
const ARQUIVO_CONFIG = path.join(PASTA, 'config.json');
// Login guardado por versões antigas do script (perfil e cookies): apagado na partida, o login não fica mais salvo.
const RESTOS_DE_LOGIN = [path.join(PASTA, 'perfil-navegador'), path.join(PASTA, 'sessao.json')];
const ESPERA_LOGIN_MS = 10 * 60 * 1000;

async function perguntar(texto) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(texto)).trim();
  } finally {
    rl.close();
  }
}

async function lerConfig() {
  let config = {};
  try {
    config = JSON.parse(fs.readFileSync(ARQUIVO_CONFIG, 'utf8'));
  } catch {
    // primeira vez
  }
  if (!config.api) config.api = 'http://localhost:3092';
  if (!/^fin_[A-Za-z0-9_-]{20,100}$/.test(config.chave ?? '')) {
    console.log('\nO script precisa de uma chave de acesso do sistema para mandar as carteiras.');
    console.log('No sistema: Conectar IA > Nova chave, com permissão "consulta e lança". Copie a chave (fin_...).');
    config.chave = await perguntar('Cole a chave aqui e tecle Enter: ');
    if (!/^fin_[A-Za-z0-9_-]{20,100}$/.test(config.chave)) throw new Error('Essa não parece uma chave do sistema (começa com fin_).');
    fs.writeFileSync(ARQUIVO_CONFIG, JSON.stringify(config, null, 2));
    console.log('Chave guardada em ferramentas/suno/config.json (fora do Git).');
  }
  return config;
}


async function garantirLogin(pagina) {
  await pagina.goto(INICIO, { waitUntil: 'domcontentloaded' });
  const fimDaConferencia = Date.now() + 30000;
  while (Date.now() < fimDaConferencia) {
    if (await mostraCarteiras(pagina)) return;
    if (/login\.suno\.com\.br/.test(pagina.url())) break;
    await pagina.waitForTimeout(1000);
  }
  await pagina.bringToFront();
  console.log('\n>> Entre na sua conta da Suno na janela do Chrome que o script abriu.');
  console.log('   Se não estiver vendo a janela, procure o ícone do Chrome na barra de tarefas (ela pode ter aberto atrás).');
  console.log('   Estou esperando (até 10 minutos)...');
  const limite = Date.now() + ESPERA_LOGIN_MS;
  while (Date.now() < limite) {
    if (pagina.isClosed()) throw new Error('A janela do navegador foi fechada antes do login.');
    await pagina.waitForTimeout(2000);
    const url = pagina.url();
    if (!naSuno(url)) continue; // ainda na página de login (ou na verificação em duas etapas)
    if (await mostraCarteiras(pagina)) {
      console.log('Login feito.');
      return;
    }
    // Voltou para a Suno, mas em outra página (a inicial): vai para as carteiras e confere de novo.
    if (!url.startsWith(INICIO)) {
      await pagina.goto(INICIO, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
      await pagina.waitForTimeout(5000);
    }
  }
  throw new Error('O login na Suno não foi feito em 10 minutos.');
}


async function enviar(config, carteiras, assinatura) {
  const resposta = await fetch(`${config.api.replace(/\/$/, '')}/api/suno/importar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.chave}` },
    body: JSON.stringify({ carteiras, assinatura }),
  });
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(corpo.erro ?? `O sistema recusou o envio (${resposta.status}).`);
  return corpo;
}


async function principal() {
  const config = await lerConfig();
  for (const resto of RESTOS_DE_LOGIN) fs.rmSync(resto, { recursive: true, force: true });
  // Perfil temporário: começa sem login nenhum e é apagado no fim.
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'financas-suno-'));
  console.log('Abrindo o navegador...');
  const contexto = await chromium.launchPersistentContext(perfil, {
    channel: 'chrome',
    headless: false,
    viewport: { width: 1280, height: 860 },
    args: ['--window-size=1300,940', '--window-position=60,40'],
  });
  try {
    const pagina = contexto.pages()[0] ?? (await contexto.newPage());
    await pagina.bringToFront();
    await garantirLogin(pagina);
    const { carteiras, assinatura } = await lerTudo(pagina, (texto) => console.log(texto));
    const r = await enviar(config, carteiras, assinatura);
    console.log(`\nPronto: ${r.carteiras} carteiras enviadas ao sistema (${r.nomes.join(', ')}).`);
    console.log('Veja em Investimentos > Carteiras Suno.');
  } finally {
    await contexto.close();
    fs.rmSync(perfil, { recursive: true, force: true });
  }
}

principal().catch((erro) => {
  console.error('\nNão deu certo:', erro instanceof Error ? erro.message : erro);
  process.exitCode = 1;
});
