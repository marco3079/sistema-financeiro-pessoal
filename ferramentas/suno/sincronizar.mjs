// Traz as carteiras recomendadas da Suno Research para o sistema financeiro.
//
// A Suno não tem API. Este script abre uma janela do Chrome (com um perfil só dele, guardado nesta pasta),
// você entra na sua conta da Suno nessa janela e ele visita as páginas de carteira, lê as tabelas que a página
// mostra e manda para o sistema. A senha da Suno fica só no navegador: o script não a lê nem a guarda.
// O login fica salvo no perfil, então nas próximas vezes a janela já abre logada.
//
// Uso: powershell -ExecutionPolicy Bypass -File ferramentas\suno\sincronizar-suno.ps1
//  (ou: node ferramentas/suno/sincronizar.mjs)
//
// Configuração (config.json nesta pasta, criado na primeira vez):
//   api:   endereço da API do sistema (padrão http://localhost:3092)
//   chave: chave de acesso criada em "Conectar IA", com permissão "consulta e lança"

import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const PASTA = path.dirname(fileURLToPath(import.meta.url));
const ARQUIVO_CONFIG = path.join(PASTA, 'config.json');
const PERFIL = path.join(PASTA, 'perfil-navegador');
const INICIO = 'https://investidor.suno.com.br/carteiras';
const ESPERA_LOGIN_MS = 10 * 60 * 1000;
const ESPERA_TABELA_MS = 40 * 1000;

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

function naSuno(url) {
  return /^https:\/\/investidor\.suno\.com\.br\//.test(url);
}

// Espera a pessoa entrar na conta, se a Suno pedir login.
async function garantirLogin(pagina) {
  await pagina.goto(INICIO, { waitUntil: 'domcontentloaded' });
  await pagina.waitForTimeout(2500);
  if (naSuno(pagina.url()) && !/\/login|entrar/.test(pagina.url())) return;
  console.log('\n>> Entre na sua conta da Suno na janela do navegador que abriu. Estou esperando...');
  await pagina.waitForURL((u) => naSuno(u.toString()), { timeout: ESPERA_LOGIN_MS });
  await pagina.waitForTimeout(2000);
  if (!pagina.url().startsWith(INICIO)) await pagina.goto(INICIO, { waitUntil: 'domcontentloaded' });
  console.log('Login feito.');
}

// Carteiras da página /carteiras: endereço e nome.
async function listarCarteiras(pagina) {
  await pagina.waitForSelector('a[href*="/carteiras/"]', { timeout: ESPERA_TABELA_MS });
  return pagina.evaluate(() => {
    const vistas = new Map();
    for (const a of document.querySelectorAll('main a[href*="/carteiras/"]')) {
      const url = new URL(a.getAttribute('href'), location.href);
      const slug = url.pathname.replace(/^\/carteiras\//, '').replace(/\/.*$/, '');
      if (!/^[a-z0-9-]+$/.test(slug) || vistas.has(slug)) continue;
      // O texto do cartão começa com "há X dias" e depois o nome da carteira.
      const partes = a.innerText.split('\n').map((t) => t.trim()).filter(Boolean);
      const nome = partes.find((t) => !/^há /i.test(t)) ?? slug;
      vistas.set(slug, { slug, nome, url: `${url.origin}/carteiras/${slug}` });
    }
    return [...vistas.values()];
  });
}

// Lê as tabelas da página de uma carteira. A Suno usa tabelas com o cabeçalho separado do corpo (o cabeçalho numa
// <table> e as linhas na seguinte), então cada cabeçalho fica com as linhas da tabela seguinte quando ele não tem.
async function lerCarteira(pagina, carteira) {
  await pagina.goto(carteira.url, { waitUntil: 'domcontentloaded' });
  try {
    await pagina.waitForSelector('main table thead th', { timeout: ESPERA_TABELA_MS });
    await pagina.waitForFunction(() => [...document.querySelectorAll('main table tbody tr')].some((tr) => tr.innerText.trim()), null, {
      timeout: ESPERA_TABELA_MS,
    });
  } catch {
    return null; // carteira sem tabela (não assinada, ou só texto)
  }
  await pagina.waitForTimeout(1500);
  return pagina.evaluate(() => {
    const limpar = (t) => t.replace(/\s+/g, ' ').trim();
    const tabelas = [...document.querySelectorAll('main table')];
    const blocos = [];
    for (let i = 0; i < tabelas.length; i++) {
      const colunas = [...tabelas[i].querySelectorAll('thead th')].map((th) => limpar(th.innerText));
      if (colunas.length === 0) continue;
      let linhasTr = [...tabelas[i].querySelectorAll('tbody tr')].filter((tr) => tr.innerText.trim());
      if (linhasTr.length === 0 && tabelas[i + 1] && tabelas[i + 1].querySelectorAll('thead th').length === 0) {
        linhasTr = [...tabelas[i + 1].querySelectorAll('tbody tr')].filter((tr) => tr.innerText.trim());
      }
      // Cada célula: o texto em uma linha só (o ticker e o nome da empresa podem vir em linhas separadas).
      const linhas = linhasTr.map((tr) => [...tr.querySelectorAll('td')].map((td) => limpar(td.innerText).slice(0, 400)).slice(0, 40));
      // Título: o cabeçalho mais próximo antes da tabela.
      let titulo = null;
      let el = tabelas[i];
      for (let passos = 0; el && passos < 8 && !titulo; passos++) {
        let irmao = el.previousElementSibling;
        while (irmao && !titulo) {
          const h = irmao.matches('h1,h2,h3,h4') ? irmao : irmao.querySelector('h1,h2,h3,h4');
          if (h && limpar(h.innerText)) titulo = limpar(h.innerText).slice(0, 120);
          irmao = irmao.previousElementSibling;
        }
        el = el.parentElement;
      }
      blocos.push({ titulo, colunas: colunas.slice(0, 40), linhas: linhas.slice(0, 500) });
    }
    return blocos;
  });
}

function semAcento(t) {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Classifica as tabelas: a recomendada tem "viés" ou "teto"; a de encerradas tem "encerramento".
function classificar(blocos) {
  let recomendada = null;
  let encerradas = null;
  const outras = [];
  for (const b of blocos) {
    const cols = b.colunas.map(semAcento).join('|');
    const tabela = { colunas: b.colunas, linhas: b.linhas };
    if (!recomendada && /vies|teto/.test(cols) && b.linhas.length > 0) recomendada = tabela;
    else if (!encerradas && /encerramento/.test(cols)) encerradas = tabela;
    else if (b.linhas.length > 0 && outras.length < 10) outras.push({ titulo: b.titulo, ...tabela });
  }
  return { recomendada, encerradas, outras };
}

async function enviar(config, carteiras) {
  const resposta = await fetch(`${config.api.replace(/\/$/, '')}/api/suno/importar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.chave}` },
    body: JSON.stringify({ carteiras }),
  });
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(corpo.erro ?? `O sistema recusou o envio (${resposta.status}).`);
  return corpo;
}

async function principal() {
  const config = await lerConfig();
  console.log('Abrindo o navegador...');
  const contexto = await chromium.launchPersistentContext(PERFIL, {
    channel: 'chrome',
    headless: false,
    viewport: null,
    args: ['--window-size=1280,900'],
  });
  try {
    const pagina = contexto.pages()[0] ?? (await contexto.newPage());
    await garantirLogin(pagina);
    const lista = await listarCarteiras(pagina);
    console.log(`Carteiras encontradas: ${lista.map((c) => c.nome).join(', ')}`);
    const lidas = [];
    for (const c of lista) {
      process.stdout.write(`Lendo ${c.nome}... `);
      const blocos = await lerCarteira(pagina, c);
      if (!blocos || blocos.length === 0) {
        console.log('sem tabela (carteira não assinada?), pulei.');
        continue;
      }
      const tabelas = classificar(blocos);
      const n = tabelas.recomendada?.linhas.length ?? 0;
      console.log(`${n} ativos recomendados${tabelas.encerradas ? `, ${tabelas.encerradas.linhas.length} encerrados` : ''}.`);
      lidas.push({ ...c, ...tabelas });
    }
    if (lidas.length === 0) throw new Error('Nenhuma carteira com tabela foi encontrada.');
    const r = await enviar(config, lidas);
    console.log(`\nPronto: ${r.carteiras} carteiras enviadas ao sistema (${r.nomes.join(', ')}).`);
    console.log('Veja em Investimentos > Carteiras Suno.');
  } finally {
    await contexto.close();
  }
}

principal().catch((erro) => {
  console.error('\nNão deu certo:', erro instanceof Error ? erro.message : erro);
  process.exitCode = 1;
});
