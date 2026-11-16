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

const PASTA = path.dirname(fileURLToPath(import.meta.url));
const ARQUIVO_CONFIG = path.join(PASTA, 'config.json');
// Login guardado por versões antigas do script (perfil e cookies): apagado na partida, o login não fica mais salvo.
const RESTOS_DE_LOGIN = [path.join(PASTA, 'perfil-navegador'), path.join(PASTA, 'sessao.json')];
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

// Logado = a página de carteiras mostra os cartões das carteiras.
async function mostraCarteiras(pagina) {
  try {
    return (await pagina.locator('main a[href*="/carteiras/"]').count()) > 0;
  } catch {
    return false; // página no meio de uma navegação
  }
}

// Espera a pessoa entrar na conta. A Suno abre /carteiras e só depois de conferir a sessão manda para
// login.suno.com.br: por isso quem decide é o que aparece na página, não o endereço.
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

// Carteiras assinadas da página /carteiras: as do bloco "Carteiras disponíveis" que mostram "rentabilidade total"
// (as de ativos: Dividendos, Valor, FIIs, Start...). Ficam de fora as do bloco "Carteiras que você pode se
// interessar" e as com cadeado (não assinadas: a página só mostra uma prévia) e as listas sem carteira de ativos
// (Renda Fixa, Reserva).
async function listarCarteiras(pagina) {
  await pagina.waitForSelector('a[href*="/carteiras/"]', { timeout: ESPERA_TABELA_MS });
  // Os cartões chegam aos poucos: espera a lista parar de mudar.
  let anterior = -1;
  for (let i = 0; i < 20; i++) {
    const n = await pagina.locator('main a[href*="/carteiras/"]').count();
    if (n === anterior && n > 0) break;
    anterior = n;
    await pagina.waitForTimeout(1000);
  }
  return pagina.evaluate(() => {
    const textoDe = (el) => (el.innerText || '').trim();
    const titulos = [...document.querySelectorAll('main h1, main h2, main h3, main h4, main p, main span')];
    const interessar = titulos.find((el) => /pode se interessar/i.test(textoDe(el)) && el.children.length === 0);
    const vistas = new Map();
    for (const a of document.querySelectorAll('main a[href*="/carteiras/"]')) {
      // Depois do título "Carteiras que você pode se interessar": não assinada.
      if (interessar && interessar.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING) continue;
      if (!/rentabilidade total/i.test(a.innerText)) continue;
      // Cadeado no cartão: carteira não assinada (ícone "lock" do Material: o arco do cadeado no desenho).
      const desenhos = [...a.querySelectorAll('svg path')].map((p) => p.getAttribute('d') || '');
      if (desenhos.some((d) => /c0-2\.76-2\.24-5-5-5s-5 2\.24-5/.test(d))) continue;
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

// Espera a tabela recomendada (cabeçalho com "viés" ou "teto") ter linhas com ticker e parar de crescer.
// (Carteiras não assinadas já ficam de fora na lista, pelo cadeado do cartão.)
async function esperarTabela(pagina, tempo) {
  await pagina.waitForFunction(
    () => {
      const sem = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      const tabelas = [...document.querySelectorAll('main table')];
      return tabelas.some((t, i) => {
        const cab = [...t.querySelectorAll('thead th')].map((th) => sem(th.innerText)).join('|');
        if (!/vies|teto/.test(cab)) return false;
        const corpo = t.querySelectorAll('tbody tr').length > 1 ? t : tabelas[i + 1];
        return !!corpo && [...corpo.querySelectorAll('tbody tr')].some((tr) => /\b[A-Z][A-Z0-9]{3}\d{1,2}\b/.test(tr.innerText));
      });
    },
    null,
    { timeout: tempo, polling: 500 }
  );
  // As linhas podem chegar em partes: espera a contagem ficar igual por 2 segundos.
  let anterior = -1;
  for (let i = 0; i < 30; i++) {
    const n = await pagina.locator('main table tbody tr').count();
    if (n === anterior) break;
    anterior = n;
    await pagina.waitForTimeout(2000);
  }
  return 'PRONTA';
}

// Lê as tabelas da página de uma carteira. A Suno usa tabelas com o cabeçalho separado do corpo (o cabeçalho numa
// <table> e as linhas na seguinte), então cada cabeçalho fica com as linhas da tabela seguinte quando ele não tem.
// null: a tabela não carregou.
async function lerCarteira(pagina, carteira) {
  let carregou = false;
  for (let tentativa = 1; tentativa <= 2 && !carregou; tentativa++) {
    if (tentativa === 1) await pagina.goto(carteira.url, { waitUntil: 'domcontentloaded' });
    else {
      process.stdout.write('demorou, recarregando... ');
      await pagina.reload({ waitUntil: 'domcontentloaded' });
    }
    try {
      await esperarTabela(pagina, tentativa === 1 ? 90000 : 60000);
      carregou = true;
    } catch {
      // tenta de novo
    }
  }
  if (!carregou) return null;
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

// Plano da pessoa na Suno: no menu da conta, "Meu plano" mostra "Assinante <plano>" e as datas de início e fim da
// vigência. O botão do menu (ícone de pessoa no canto de cima) só aparece com a página estreita: a página fica
// estreita enquanto lê e volta ao tamanho de antes. Se o site mudar, devolve null e o resto segue.
async function lerAssinatura(pagina) {
  const tamanho = pagina.viewportSize();
  try {
    await pagina.setViewportSize({ width: 627, height: 845 });
    await pagina.goto(INICIO, { waitUntil: 'domcontentloaded' });
    await pagina.waitForSelector('main a[href*="/carteiras/"]', { timeout: ESPERA_TABELA_MS });
    await pagina.waitForTimeout(1500);
    // Os cliques vão direto no elemento (não pela posição na tela): avisos e promoções que a Suno abre por cima
    // não atrapalham. O item "Meu plano" tem um selo "NOVO" junto, por isso a busca é pelo começo do texto.
    const abriu = await pagina.evaluate(() => {
      const largura = innerWidth;
      const el = [...document.querySelectorAll('button')].find((b) => {
        const r = b.getBoundingClientRect();
        return r.top < 60 && r.left > largura - 90 && r.width > 15 && r.width < 70;
      });
      if (!el) return false;
      el.click();
      return true;
    });
    if (!abriu) return null;
    await pagina.waitForFunction(
      () =>
        [...document.querySelectorAll('*')].some(
          (e) => /^\s*Meu plano/.test(e.textContent || '') && (e.textContent || '').length < 40 && e.getBoundingClientRect().width > 0
        ),
      null,
      { timeout: 15000 }
    );
    await pagina.evaluate(() => {
      const candidatos = [...document.querySelectorAll('*')].filter(
        (e) => /^\s*Meu plano/.test(e.textContent || '') && (e.textContent || '').length < 40 && e.getBoundingClientRect().width > 0
      );
      const alvo = candidatos.find((e) => /pointer/.test(getComputedStyle(e).cursor)) ?? candidatos[candidatos.length - 1];
      alvo?.click();
    });
    await pagina.waitForFunction(() => /fim da vig/i.test(document.body.innerText), null, { timeout: 15000 });
    return await pagina.evaluate(() => {
      const texto = document.body.innerText;
      const iso = (d) => (d ? `${d.slice(6, 10)}-${d.slice(3, 5)}-${d.slice(0, 2)}` : null);
      const m = /Assinante\s+([^\n]+)[\s\S]{0,200}?(\d{2}\.\d{2}\.\d{4})\s*\n+\s*in[ií]cio da vig[eê]ncia\s*\n+\s*(\d{2}\.\d{2}\.\d{4})\s*\n+\s*fim da vig/i.exec(texto);
      const doTopo = /Sua assinatura [eé]\s*\n*\s*([^\n]+)/i.exec(texto);
      const plano = (m?.[1] ?? doTopo?.[1] ?? '').trim();
      if (!plano) return null;
      return { plano: plano.slice(0, 80), inicio: iso(m?.[2]), fim: iso(m?.[3]) };
    });
  } catch {
    return null;
  } finally {
    if (tamanho) await pagina.setViewportSize(tamanho).catch(() => undefined);
  }
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

function dataBr(iso) {
  return iso ? iso.split('-').reverse().join('/') : '';
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
    const lista = await listarCarteiras(pagina);
    console.log(`Carteiras encontradas: ${lista.map((c) => c.nome).join(', ')}`);
    const lidas = [];
    for (const c of lista) {
      process.stdout.write(`Lendo ${c.nome}... `);
      const blocos = await lerCarteira(pagina, c);
      if (!blocos || blocos.length === 0) {
        console.log('a tabela não carregou em 2 tentativas, pulei.');
        continue;
      }
      const tabelas = classificar(blocos);
      const n = tabelas.recomendada?.linhas.length ?? 0;
      console.log(`${n} ativos recomendados${tabelas.encerradas ? `, ${tabelas.encerradas.linhas.length} encerrados` : ''}.`);
      lidas.push({ ...c, ...tabelas });
    }
    if (lidas.length === 0) throw new Error('Nenhuma carteira com tabela foi encontrada.');
    process.stdout.write('Lendo o seu plano... ');
    const assinatura = await lerAssinatura(pagina);
    console.log(assinatura ? `${assinatura.plano}${assinatura.fim ? `, vigente até ${dataBr(assinatura.fim)}` : ''}.` : 'não encontrei (segue sem).');
    const r = await enviar(config, lidas, assinatura);
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
