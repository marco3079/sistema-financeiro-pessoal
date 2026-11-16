// Serviço da Suno: roda num contêiner do Compose, sem janela (Chromium headless). A API manda o e-mail e a senha
// que a pessoa digitou na tela; o serviço entra na conta da Suno, lê as carteiras assinadas e o plano (leitor.mjs)
// e devolve os dados para a API gravar. Se a Suno pedir o código da verificação em duas etapas, a tarefa para em
// PEDE_CODIGO e espera a pessoa digitar o código na tela.
//
// A senha fica só na memória durante a tarefa: não é gravada nem aparece em log. Só a API fala com o serviço
// (rede interna do Compose, sem porta publicada), com o segredo em SUNO_SEGREDO.
//
// Rotas (cabeçalho x-suno-segredo):
//   POST /tarefa          { email, senha }  começa uma atualização (409 se já há uma em andamento)
//   GET  /tarefa          situação da tarefa atual (com o resultado quando PRONTA)
//   POST /tarefa/codigo   { codigo }        código da verificação em duas etapas
//   POST /tarefa/cancelar                   fecha o navegador e encerra

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { INICIO, lerTudo, mostraCarteiras, naSuno } from './leitor.mjs';

const PORTA = 4100;
const SEGREDO = process.env.SUNO_SEGREDO || '';
const ESPERA_LOGIN_MS = 90 * 1000;
const ESPERA_CODIGO_MS = 5 * 60 * 1000;
const NAVEGADOR =
  process.env.CHROMIUM || ['/usr/bin/chromium-browser', '/usr/bin/chromium'].find((c) => fs.existsSync(c)) || '/usr/bin/chromium';
const AGENTE =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Etapas: ENTRANDO -> (PEDE_CODIGO) -> LENDO -> PRONTA | ERRO | CANCELADA
let tarefa = null;

function agora() {
  return new Date().toISOString();
}

function registrar(texto) {
  if (!tarefa) return;
  tarefa.log.push({ em: agora(), texto });
  if (tarefa.log.length > 100) tarefa.log.shift();
  console.log(`[suno] ${texto}`);
}

function mudar(etapa, mensagem) {
  if (!tarefa) return;
  tarefa.etapa = etapa;
  tarefa.mensagem = mensagem;
  registrar(mensagem);
}

function emAndamento() {
  return tarefa !== null && ['ENTRANDO', 'PEDE_CODIGO', 'LENDO'].includes(tarefa.etapa);
}

// ---------- Login ----------

const CAMPO_EMAIL = 'input[type="email"], input[name*="mail" i], input[placeholder*="mail" i], input[autocomplete="username"]';
const CAMPO_SENHA = 'input[type="password"]';

async function enviarFormulario(pagina) {
  const botao = pagina
    .locator('button[type="submit"], button:has-text("Entrar"), button:has-text("ENTRAR"), button:has-text("Continuar"), button:has-text("Confirmar"), button:has-text("Verificar")')
    .first();
  if ((await botao.count()) > 0 && (await botao.isVisible().catch(() => false))) await botao.click();
  else await pagina.keyboard.press('Enter');
}

// O que a página de login mostra agora: erro, pedido de código ou nada (ainda carregando).
async function situacaoDoLogin(pagina) {
  return pagina.evaluate(() => {
    const visivel = (e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden';
    };
    const texto = document.body.innerText || '';
    const erro = [...document.querySelectorAll('[role="alert"], [class*="error" i], [class*="erro" i], [class*="invalid" i], .ant-form-item-explain')]
      .filter(visivel)
      .map((e) => (e.innerText || '').trim())
      .find((t) => t.length > 3 && t.length < 200);
    const camposDeCodigo = [...document.querySelectorAll('input')].filter(
      (i) =>
        visivel(i) &&
        i.type !== 'password' &&
        i.type !== 'email' &&
        (i.autocomplete === 'one-time-code' || i.inputMode === 'numeric' || i.maxLength === 1 || /c[oó]digo|code|token/i.test(`${i.name} ${i.placeholder} ${i.id}`))
    );
    const pedeCodigo = camposDeCodigo.length > 0 && /c[oó]digo|verifica|autentica|token|code/i.test(texto);
    return { erro: erro ?? null, pedeCodigo, temSenha: !!document.querySelector('input[type="password"]') };
  });
}

async function digitarCodigo(pagina, codigo) {
  const campos = pagina.locator('input:visible:not([type="password"]):not([type="email"])');
  const n = await campos.count();
  if (n > 1) {
    // Um quadradinho por dígito: digita a partir do primeiro (o site passa para o próximo sozinho).
    await campos.first().click();
    await pagina.keyboard.type(codigo, { delay: 80 });
  } else if (n === 1) {
    await campos.first().fill(codigo);
  } else {
    await pagina.keyboard.type(codigo, { delay: 80 });
  }
  await pagina.waitForTimeout(500);
  await enviarFormulario(pagina);
}

async function esperarCodigo() {
  return new Promise((resolve, reject) => {
    const relogio = setTimeout(() => reject(new Error('O código de verificação não foi informado em 5 minutos.')), ESPERA_CODIGO_MS);
    tarefa.receberCodigo = (codigo) => {
      clearTimeout(relogio);
      tarefa.receberCodigo = null;
      resolve(codigo);
    };
    tarefa.cancelarEspera = () => {
      clearTimeout(relogio);
      reject(new Error('Atualização cancelada.'));
    };
  });
}

async function entrar(pagina, email, senha) {
  await pagina.goto(INICIO, { waitUntil: 'domcontentloaded' });
  // A Suno abre /carteiras e manda para o login: espera o formulário (ou as carteiras, se já houver sessão).
  const limiteFormulario = Date.now() + 45000;
  while (Date.now() < limiteFormulario) {
    if (await mostraCarteiras(pagina)) return;
    if ((await pagina.locator(CAMPO_SENHA).count()) > 0) break;
    await pagina.waitForTimeout(1000);
  }
  if ((await pagina.locator(CAMPO_SENHA).count()) === 0) throw new Error('A página de login da Suno não abriu. Tente de novo em instantes.');
  await pagina.locator(CAMPO_EMAIL).first().fill(email);
  await pagina.locator(CAMPO_SENHA).first().fill(senha);
  await enviarFormulario(pagina);

  let limite = Date.now() + ESPERA_LOGIN_MS;
  let codigoEnviado = false;
  while (Date.now() < limite) {
    if (tarefa?.etapa === 'CANCELADA') throw new Error('Atualização cancelada.');
    await pagina.waitForTimeout(1500);
    const url = pagina.url();
    if (naSuno(url)) {
      if (await mostraCarteiras(pagina)) return;
      if (!url.startsWith(INICIO)) {
        await pagina.goto(INICIO, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
        await pagina.waitForTimeout(3000);
      }
      continue;
    }
    const s = await situacaoDoLogin(pagina).catch(() => ({ erro: null, pedeCodigo: false, temSenha: false }));
    if (s.pedeCodigo) {
      mudar(
        'PEDE_CODIGO',
        codigoEnviado
          ? `A Suno não aceitou o código${s.erro ? ` (${s.erro})` : ''}. Digite o código de novo.`
          : 'A Suno pediu o código da verificação em duas etapas. Digite o código que chegou para você.'
      );
      const codigo = await esperarCodigo();
      mudar('ENTRANDO', 'Conferindo o código...');
      await digitarCodigo(pagina, codigo);
      codigoEnviado = true;
      limite = Date.now() + ESPERA_LOGIN_MS;
      continue;
    }
    if (s.erro && s.temSenha) throw new Error(`A Suno não aceitou o login: ${s.erro}`);
  }
  throw new Error('O login na Suno não terminou a tempo. Confira o e-mail e a senha e tente de novo.');
}

// ---------- Tarefa ----------

async function executar(email, senha) {
  let navegador = null;
  try {
    mudar('ENTRANDO', 'Abrindo a Suno e entrando na sua conta...');
    navegador = await chromium.launch({
      executablePath: NAVEGADOR,
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    tarefa.fechar = () => navegador?.close().catch(() => undefined);
    const contexto = await navegador.newContext({ userAgent: AGENTE, viewport: { width: 1280, height: 860 }, locale: 'pt-BR' });
    const pagina = await contexto.newPage();
    await entrar(pagina, email, senha);
    senha = ''; // não precisa mais
    mudar('LENDO', 'Login feito. Lendo as carteiras que você assina...');
    const resultado = await lerTudo(pagina, (texto) => registrar(texto));
    tarefa.resultado = resultado;
    mudar('PRONTA', `${resultado.carteiras.length} carteiras lidas.`);
  } catch (erro) {
    if (tarefa.etapa !== 'CANCELADA') mudar('ERRO', erro instanceof Error ? erro.message : String(erro));
  } finally {
    senha = '';
    tarefa.receberCodigo = null;
    tarefa.terminadaEm = agora();
    await navegador?.close().catch(() => undefined);
  }
}

// ---------- HTTP ----------

function responder(res, status, corpo) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(corpo));
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let dados = '';
    req.on('data', (parte) => {
      dados += parte;
      if (dados.length > 10000) reject(new Error('Corpo grande demais.'));
    });
    req.on('end', () => {
      try {
        resolve(dados ? JSON.parse(dados) : {});
      } catch {
        reject(new Error('JSON inválido.'));
      }
    });
    req.on('error', reject);
  });
}

function segredoConfere(req) {
  const recebido = Buffer.from(String(req.headers['x-suno-segredo'] ?? ''));
  const esperado = Buffer.from(SEGREDO);
  return SEGREDO.length > 0 && recebido.length === esperado.length && crypto.timingSafeEqual(recebido, esperado);
}

function estadoPublico() {
  if (!tarefa) return { etapa: 'NENHUMA' };
  return {
    id: tarefa.id,
    etapa: tarefa.etapa,
    mensagem: tarefa.mensagem,
    log: tarefa.log,
    iniciadaEm: tarefa.iniciadaEm,
    terminadaEm: tarefa.terminadaEm ?? null,
    resultado: tarefa.etapa === 'PRONTA' ? tarefa.resultado : undefined,
  };
}

const servidor = http.createServer(async (req, res) => {
  try {
    if (req.url === '/saude') return responder(res, 200, { ok: true });
    if (!segredoConfere(req)) return responder(res, 401, { erro: 'Não autorizado.' });

    if (req.method === 'GET' && req.url === '/tarefa') return responder(res, 200, estadoPublico());

    if (req.method === 'POST' && req.url === '/tarefa') {
      if (emAndamento()) return responder(res, 409, { erro: 'Já há uma atualização da Suno em andamento.' });
      const corpo = await lerCorpo(req);
      const email = String(corpo.email ?? '').trim();
      const senha = String(corpo.senha ?? '');
      if (!email || !senha) return responder(res, 400, { erro: 'Informe o e-mail e a senha da Suno.' });
      tarefa = { id: crypto.randomUUID(), etapa: 'ENTRANDO', mensagem: '', log: [], iniciadaEm: agora(), resultado: null };
      executar(email, senha);
      return responder(res, 202, estadoPublico());
    }

    if (req.method === 'POST' && req.url === '/tarefa/codigo') {
      const corpo = await lerCorpo(req);
      const codigo = String(corpo.codigo ?? '').replace(/\s+/g, '');
      if (!/^[A-Za-z0-9]{4,10}$/.test(codigo)) return responder(res, 400, { erro: 'Código inválido.' });
      if (!tarefa || tarefa.etapa !== 'PEDE_CODIGO' || !tarefa.receberCodigo) {
        return responder(res, 409, { erro: 'A Suno não está esperando um código agora.' });
      }
      tarefa.receberCodigo(codigo);
      return responder(res, 200, estadoPublico());
    }

    if (req.method === 'POST' && req.url === '/tarefa/cancelar') {
      if (emAndamento()) {
        tarefa.etapa = 'CANCELADA';
        tarefa.mensagem = 'Atualização cancelada.';
        tarefa.cancelarEspera?.();
        await tarefa.fechar?.();
      }
      return responder(res, 200, estadoPublico());
    }

    return responder(res, 404, { erro: 'Rota não encontrada.' });
  } catch (erro) {
    return responder(res, 400, { erro: erro instanceof Error ? erro.message : 'Erro.' });
  }
});

if (!SEGREDO) console.warn('[suno] SUNO_SEGREDO vazio: o serviço recusa todas as chamadas.');
servidor.listen(PORTA, () => console.log(`[suno] ouvindo na porta ${PORTA} (navegador: ${NAVEGADOR})`));
