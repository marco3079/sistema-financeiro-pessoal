// Atualizador do sistema: um contêiner do próprio Compose, criado junto com os outros pelo instalador.
// Faz o mesmo que a tarefa do Windows do atualizar.ps1 (-Vigiar), em qualquer sistema e sem instalar nada:
// conversa com a API por arquivos na pasta atualizacao/ (versao.json, estado.json, pedido.json) e, quando a
// pessoa pede pela tela, copia o banco, baixa o último commit (git pull --ff-only) e reconstrói a API e o site.
// Também restaura uma cópia do banco. Nada do pedido é executado: ele só diz o tipo e o nome da cópia.
// Sem dependências npm: só módulos do Node.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const MONTAGEM = '/projeto'; // a pasta do projeto, montada aqui
const PASTA = path.join(MONTAGEM, 'atualizacao');
const ARQUIVO_PEDIDO = path.join(PASTA, 'pedido.json');
const ARQUIVO_ESTADO = path.join(PASTA, 'estado.json');
const ARQUIVO_VERSAO = path.join(PASTA, 'versao.json');
const PASTA_BACKUPS = path.join(MONTAGEM, 'backups');
const COPIA_VALIDA = /^financas-\d{8}-\d{6}\.sql$/;
const COPIAS_GUARDADAS = 5;
const INTERVALO_MS = 5000;

let projeto = ''; // nome do projeto no Compose
let pastaNoDocker = ''; // caminho da pasta do projeto como o Docker do computador a enxerga
let estadoAtual = { situacao: 'PARADO', mensagem: '', em: null };

function agora() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function registrar(texto) {
  console.log(`[${new Date().toLocaleString('pt-BR')}] ${texto}`);
}

// Roda um programa. Devolve { codigo, saida }; com `paraArquivo`, a saída padrão vai para o arquivo.
function rodar(programa, argumentos, opcoes = {}) {
  return new Promise((resolve) => {
    const filho = spawn(programa, argumentos, { env: opcoes.env ?? process.env });
    // Com limiteMs, um comando travado é encerrado (a medição dos contêineres não pode ficar presa).
    const limite = opcoes.limiteMs ? setTimeout(() => filho.kill('SIGKILL'), opcoes.limiteMs) : null;
    filho.on('close', () => limite && clearTimeout(limite));
    let saida = '';
    let destino = null;
    if (opcoes.paraArquivo) {
      destino = fs.createWriteStream(opcoes.paraArquivo);
      filho.stdout.pipe(destino);
    } else {
      filho.stdout.on('data', (d) => (saida += d));
    }
    filho.stderr.on('data', (d) => (saida += d));
    filho.on('error', (erro) => resolve({ codigo: 1, saida: String(erro) }));
    filho.on('close', (codigo) => {
      if (destino) destino.end(() => resolve({ codigo, saida }));
      else resolve({ codigo, saida });
    });
  });
}

async function exigir(programa, argumentos, opcoes) {
  const r = await rodar(programa, argumentos, opcoes);
  if (r.codigo !== 0) {
    const fim = r.saida.trim().split('\n').slice(-6).join(' | ');
    throw new Error(`${programa} ${argumentos.slice(0, 6).join(' ')} falhou: ${fim}`);
  }
  return r.saida.trim();
}

function git(argumentos) {
  return exigir('git', ['-C', MONTAGEM, '-c', 'safe.directory=*', '-c', 'core.fileMode=false', ...argumentos]);
}

// "D:\pasta\sistema" -> "/run/desktop/mnt/host/d/pasta/sistema" (Docker Desktop no Windows); Linux e Mac: igual.
function caminhoNoDocker(pasta) {
  const windows = /^([A-Za-z]):[\\/](.*)$/.exec(pasta);
  if (!windows) return pasta;
  return `/run/desktop/mnt/host/${windows[1].toLowerCase()}/${windows[2].replace(/\\/g, '/')}`.replace(/\/+$/, '');
}

// Lê uma variável do .env do projeto (o Compose lê o arquivo sozinho; aqui só para converter caminhos).
function variavelDoEnv(nome) {
  try {
    for (const linha of fs.readFileSync(path.join(MONTAGEM, '.env'), 'utf8').split(/\r?\n/)) {
      const m = new RegExp(`^\\s*${nome}\\s*=\\s*(.*?)\\s*$`).exec(linha);
      if (m) return m[1].replace(/^["']|["']$/g, '');
    }
  } catch {
    // sem .env: valores padrão do docker-compose.yml
  }
  return '';
}

// Ambiente do docker compose: o nome do computador e a pasta do Drive como no computador, não como no contêiner.
function ambienteDoCompose() {
  const env = { ...process.env, COMPUTERNAME: process.env.NOME_DO_COMPUTADOR || '' };
  const drive = variavelDoEnv('PASTA_DRIVE');
  if (drive) env.PASTA_DRIVE = caminhoNoDocker(drive);
  return env;
}

function compose(argumentos, opcoes = {}) {
  return exigir('docker', ['compose', '--project-directory', pastaNoDocker, '-p', projeto, ...argumentos], {
    env: ambienteDoCompose(),
    ...opcoes,
  });
}

// O Compose resolve "./atualizacao", "./server"... a partir da pasta do projeto, e o Docker do computador precisa
// receber o caminho de lá. Por isso a pasta (montada em /projeto) também fica acessível pelo caminho do computador.
async function prepararCaminhos() {
  const rotulos = await exigir('docker', [
    'inspect',
    '--format',
    '{{ index .Config.Labels "com.docker.compose.project" }}|{{ index .Config.Labels "com.docker.compose.project.working_dir" }}',
    os.hostname(),
  ]);
  const [nome, pasta] = rotulos.split('|');
  if (!nome || !pasta) throw new Error('Não foi possível descobrir o projeto no Docker.');
  projeto = nome;
  pastaNoDocker = caminhoNoDocker(pasta);
  if (pastaNoDocker !== MONTAGEM && !fs.existsSync(pastaNoDocker)) {
    fs.mkdirSync(path.dirname(pastaNoDocker), { recursive: true });
    fs.symlinkSync(MONTAGEM, pastaNoDocker);
  }
  registrar(`Projeto ${projeto} em ${pasta}`);
}

function gravarJson(arquivo, objeto) {
  const temporario = `${arquivo}.tmp`;
  fs.writeFileSync(temporario, JSON.stringify(objeto, null, 2));
  fs.renameSync(temporario, arquivo);
}

// progresso: 0 a 100 enquanto atualiza (a tela mostra a barra); null fora disso.
function gravarEstado(situacao, mensagem, progresso = null) {
  estadoAtual = { situacao, mensagem, em: agora(), progresso, inicio: situacao === 'ATUALIZANDO' ? estadoAtual.inicio ?? agora() : null };
  gravarJson(ARQUIVO_ESTADO, { ...estadoAtual, vigiaVistoEm: agora() });
  registrar(`${situacao}${mensagem ? ': ' + mensagem : ''}${progresso !== null ? ` (${progresso}%)` : ''}`);
}

// Quanto a última reconstrução levou (atualizacao/medidas.json): estima o andamento da próxima.
const ARQUIVO_MEDIDAS = path.join(PASTA, 'medidas.json');
const RECONSTRUCAO_PADRAO_MS = 4 * 60 * 1000;

function duracaoEstimada() {
  try {
    const m = JSON.parse(fs.readFileSync(ARQUIVO_MEDIDAS, 'utf8'));
    return Number(m.reconstrucaoMs) > 10000 ? Number(m.reconstrucaoMs) : RECONSTRUCAO_PADRAO_MS;
  } catch {
    return RECONSTRUCAO_PADRAO_MS;
  }
}

// Avança a barra de `de` até perto de `ate` conforme o tempo passa, sem passar de 97% do trecho antes de terminar.
function andarComOTempo(de, ate, estimadoMs) {
  const inicio = Date.now();
  const relogio = setInterval(() => {
    const fracao = Math.min(0.97, (Date.now() - inicio) / estimadoMs);
    estadoAtual = { ...estadoAtual, progresso: Math.round(de + (ate - de) * fracao) };
  }, 2000);
  return () => {
    clearInterval(relogio);
    return Date.now() - inicio;
  };
}

// Batimento: a tela sabe que o atualizador está ligado (também durante uma atualização demorada).
function bater() {
  try {
    gravarJson(ARQUIVO_ESTADO, { ...estadoAtual, vigiaVistoEm: agora() });
  } catch {
    // tenta de novo no próximo batimento
  }
}

// ---------- Situação dos contêineres (tela Status do servidor) ----------

const ARQUIVO_CONTEINERES = path.join(path.dirname(ARQUIVO_ESTADO), 'conteineres.json');
const INTERVALO_CONTEINERES_MS = 15000;
let medindoConteineres = false;
let ultimaTentativaHttps = 0;
let reiniciandoAgora = false;

// "2026-11-23 21:13:36 -0300 -03" (formato do Docker) em milissegundos; 0 se não der para ler.
function criadoEm(texto) {
  const m = /^(d{4}-d{2}-d{2}) (d{2}:d{2}:d{2}) ([+-]d{2})(d{2})/.exec(String(texto || ''));
  const data = m ? new Date(`${m[1]}T${m[2]}${m[3]}:${m[4]}`).getTime() : NaN;
  return Number.isNaN(data) ? 0 : data;
}

function linhasJson(texto) {
  const itens = [];
  for (const linha of texto.split('\n')) {
    const limpa = linha.trim();
    if (!limpa.startsWith('{')) continue;
    try {
      itens.push(JSON.parse(limpa));
    } catch {
      // linha que não é JSON (aviso do Docker): ignora
    }
  }
  return itens;
}

// Mede os contêineres do projeto (docker compose ps e docker stats) e grava em atualizacao/conteineres.json.
// A API só lê o arquivo: ela não tem acesso ao Docker.
async function medirConteineres() {
  if (medindoConteineres || !projeto) return;
  medindoConteineres = true;
  try {
    const base = ['compose', '--project-directory', pastaNoDocker, '-p', projeto];
    const [ps, servicos] = await Promise.all([
      rodar('docker', [...base, 'ps', '-a', '--format', 'json'], { env: ambienteDoCompose(), limiteMs: 20000 }),
      rodar('docker', [...base, 'config', '--services'], { env: ambienteDoCompose(), limiteMs: 20000 }),
    ]);
    if (ps.codigo !== 0) return;
    // Versões antigas do Compose devolvem uma lista; as novas, um objeto por linha.
    let itens = [];
    const textoPs = ps.saida.trim();
    if (textoPs.startsWith('[')) {
      try {
        itens = JSON.parse(textoPs);
      } catch {
        itens = [];
      }
    } else {
      itens = linhasJson(textoPs);
    }
    const uso = new Map();
    const ids = itens.map((i) => String(i.ID || '')).filter((id) => /^[0-9a-f]{6,64}$/.test(id));
    if (ids.length > 0) {
      const stats = await rodar('docker', ['stats', '--no-stream', '--format', 'json', ...ids], { limiteMs: 20000 });
      if (stats.codigo === 0) {
        for (const linha of linhasJson(stats.saida)) {
          uso.set(String(linha.ID || '').slice(0, 12), { cpu: linha.CPUPerc || null, memoria: linha.MemUsage || null });
        }
      }
    }
    const conteineres = itens.map((i) => {
      const u = uso.get(String(i.ID || '').slice(0, 12)) || {};
      return {
        servico: String(i.Service || ''),
        estado: String(i.State || ''),
        saude: String(i.Health || ''),
        detalhe: String(i.Status || '').slice(0, 120),
        criadoEm: String(i.CreatedAt || ''),
        codigoDeSaida: typeof i.ExitCode === 'number' ? i.ExitCode : null,
        cpu: u.cpu ? String(u.cpu).slice(0, 20) : null,
        memoria: u.memoria ? String(u.memoria).slice(0, 40) : null,
      };
    });
    const esperados = servicos.codigo === 0 ? servicos.saida.split('\n').map((x) => x.trim()).filter((x) => /^[a-z0-9_-]+$/i.test(x)) : [];
    gravarJson(ARQUIVO_CONTEINERES, { medidoEm: agora(), servicos: esperados, conteineres });
    // Autocorreção do acesso seguro: o contêiner https pode faltar depois de uma atualização feita por um
    // atualizador antigo, ou ter parado. Fora de uma atualização em andamento, liga de novo sozinho.
    const https = conteineres.find((c) => c.servico === 'https');
    const web = conteineres.find((c) => c.servico === 'web');
    // O https usa a rede do contêiner do site: se o site foi recriado depois dele, o https ficou sem rede
    // (continua "no ar", mas isolado) e precisa ser recriado.
    const semRede = Boolean(https && web && criadoEm(web.criadoEm) > criadoEm(https.criadoEm));
    const semHttps = esperados.includes('https') && (!https || https.estado !== 'running' || semRede);
    // O https entra na rede do site: só dá para ligar com o site já no ar (senão o Docker recusa).
    const siteNoAr = conteineres.some((c) => c.servico === 'web' && c.estado === 'running');
    if (semHttps && siteNoAr && !reiniciandoAgora && estadoAtual.situacao !== 'ATUALIZANDO' && Date.now() - ultimaTentativaHttps > 60000) {
      ultimaTentativaHttps = Date.now();
      registrar('Contêiner https fora do ar: ligando.');
      await ligarHttps(Boolean(https));
    }
  } catch (erro) {
    registrar(`Contêineres não medidos: ${erro instanceof Error ? erro.message : erro}`);
  } finally {
    medindoConteineres = false;
  }
}

// ---------- Reiniciar contêineres pela tela (Status do servidor) ----------

const ARQUIVO_REINICIO = path.join(path.dirname(ARQUIVO_ESTADO), 'reinicio.json');
const ARQUIVO_REINICIO_ESTADO = path.join(path.dirname(ARQUIVO_ESTADO), 'reinicio-estado.json');

function gravarReinicio(situacao, servico, mensagem) {
  try {
    gravarJson(ARQUIVO_REINICIO_ESTADO, { situacao, servico, mensagem, em: agora() });
  } catch {
    // a tela só fica sem o recado
  }
}

// Reinicia um contêiner (ou todos, menos o próprio atualizador). O pedido vem da API em atualizacao/reinicio.json.
async function atenderReinicio() {
  let servico = '';
  try {
    servico = String(JSON.parse(fs.readFileSync(ARQUIVO_REINICIO, 'utf8')).servico ?? '');
  } catch {
    servico = '';
  }
  fs.rmSync(ARQUIVO_REINICIO, { force: true });
  reiniciandoAgora = true;
  if (estadoAtual.situacao === 'ATUALIZANDO') {
    reiniciandoAgora = false;
    gravarReinicio('ERRO', servico, 'Há uma atualização em andamento. Tente de novo quando ela terminar.');
    return;
  }
  try {
    const existentes = (await compose(['config', '--services'])).split('\n').map((x) => x.trim()).filter(Boolean);
    const todos = servico === 'TODOS';
    if (!todos && (!existentes.includes(servico) || servico === 'atualizador')) {
      gravarReinicio('ERRO', servico, 'Serviço desconhecido ou que não pode ser reiniciado por aqui.');
      reiniciandoAgora = false;
      return;
    }
    gravarReinicio('REINICIANDO', servico, todos ? 'Reiniciando todos os contêineres...' : 'Reiniciando...');
    if (todos) {
      // Na ordem de dependência: banco, servidor (espera responder), auxiliares e site. O https vem por último.
      const ordem = ['db', 'api', 'suno', 'calculadora', 'web'].filter((s) => existentes.includes(s));
      const outros = existentes.filter((s) => !ordem.includes(s) && s !== 'atualizador' && s !== 'https');
      for (const s of [...ordem, ...outros]) {
        gravarReinicio('REINICIANDO', servico, `Reiniciando ${s}...`);
        await compose(['restart', s]);
        if (s === 'api') await compose(['up', '-d', '--no-deps', '--wait', 'api']);
      }
      if (existentes.includes('https')) await ligarHttps(true);
    } else if (servico === 'https') {
      await ligarHttps(true);
    } else {
      // "up" antes: um contêiner parado ou que nunca foi criado também volta.
      await compose(['up', '-d', '--no-deps', servico]);
      await compose(['restart', servico]);
      // O https divide a rede com o site: quando o site reinicia, ele precisa ser recriado.
      if (servico === 'web' && existentes.includes('https')) await ligarHttps(true);
    }
    gravarReinicio('OK', servico, todos ? 'Todos os contêineres foram reiniciados.' : 'Contêiner reiniciado.');
  } catch (erro) {
    gravarReinicio('ERRO', servico, String(erro instanceof Error ? erro.message : erro).slice(0, 300));
  } finally {
    reiniciandoAgora = false;
    ultimaTentativaHttps = Date.now();
    void medirConteineres();
  }
}

async function gravarVersao() {
  const commit = await git(['rev-parse', 'HEAD']);
  const data = await git(['log', '-1', '--format=%cI']);
  const mensagem = await git(['log', '-1', '--format=%s']);
  const ramo = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const origem = await git(['remote', 'get-url', 'origin']);
  const m = /github\.com[:/]+([^/]+\/[^/]+?)(\.git)?\/?$/.exec(origem);
  gravarJson(ARQUIVO_VERSAO, { commit, data, mensagem, ramo, repositorio: m ? m[1] : '', gravadoEm: agora() });
}

// No Linux, o que o contêiner grava na pasta fica do dono dela, não do root.
async function acertarDono() {
  const { uid, gid } = fs.statSync(MONTAGEM);
  if (uid !== 0) await rodar('chown', ['-R', `${uid}:${gid}`, MONTAGEM]);
}

// Cópia do banco: backups/financas-AAAAMMDD-HHMMSS.sql (ficam as 5 mais recentes, se podar).
async function copiarBanco(podar) {
  fs.mkdirSync(PASTA_BACKUPS, { recursive: true });
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const nome = `financas-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.sql`;
  const arquivo = path.join(PASTA_BACKUPS, nome);
  try {
    await compose(['exec', '-T', 'db', 'pg_dump', '-U', 'financas', '-d', 'financas'], { paraArquivo: arquivo });
  } catch (erro) {
    fs.rmSync(arquivo, { force: true });
    throw erro;
  }
  if (podar) {
    fs.readdirSync(PASTA_BACKUPS)
      .filter((n) => COPIA_VALIDA.test(n))
      .sort()
      .reverse()
      .slice(COPIAS_GUARDADAS)
      .forEach((n) => fs.rmSync(path.join(PASTA_BACKUPS, n), { force: true }));
  }
  await acertarDono();
  return nome;
}

// Reconstrói a API, o site, o serviço da Suno e a calculadora da Reforma Tributária; o banco e o próprio atualizador não são recriados aqui.
// A barra vai de 15% a 75% durante a montagem (pelo tempo, comparado ao da última vez) e daí até 95% ao religar.
async function reconstruir() {
  const parar = andarComOTempo(15, 75, duracaoEstimada());
  try {
    await compose(['build', 'api', 'web', 'suno', 'calculadora']);
  } finally {
    const levou = parar();
    try {
      gravarJson(ARQUIVO_MEDIDAS, { reconstrucaoMs: levou, medidoEm: agora() });
    } catch {
      // sem a medida, a próxima usa o tempo padrão
    }
  }
  gravarEstado('ATUALIZANDO', 'Ligando o serviço da Suno...', 78);
  await compose(['up', '-d', '--no-deps', 'suno', 'calculadora']);
  gravarEstado('ATUALIZANDO', 'Ligando a API (espera ela responder)...', 82);
  await compose(['up', '-d', '--no-deps', '--wait', 'api']);
  gravarEstado('ATUALIZANDO', 'Ligando o site...', 95);
  await compose(['up', '-d', '--no-deps', 'web']);
  await ligarHttps(true);
}

// Contêiner https (Tailscale): divide a rede com o do site, então precisa ser recriado quando o site é recriado.
// Falhar aqui não derruba a atualização: o sistema segue funcionando por http.
async function ligarHttps(recriar) {
  try {
    await compose(['up', '-d', '--no-deps', ...(recriar ? ['--force-recreate'] : []), 'https']);
  } catch (erro) {
    registrar(`Contêiner https não ligado: ${erro instanceof Error ? erro.message : erro}`);
  }
}

// Se a versão nova muda o próprio atualizador, outro contêiner (de vida curta) o recria depois que este termina.
async function recriarAtualizadorSePreciso(antes, depois) {
  const r = await rodar('git', ['-C', MONTAGEM, '-c', 'safe.directory=*', 'diff', '--quiet', antes, depois, '--', 'atualizador', 'docker-compose.yml']);
  if (r.codigo === 0) return;
  registrar('O atualizador mudou na versão nova: ele será recriado.');
  await exigir('docker', [
    'run', '-d', '--rm',
    '-v', '/var/run/docker.sock:/var/run/docker.sock',
    '-v', `${pastaNoDocker}:${pastaNoDocker}`,
    '-e', `COMPUTERNAME=${process.env.NOME_DO_COMPUTADOR || ''}`,
    '--entrypoint', 'sh',
    'docker:28-cli',
    '-c', `sleep 5 && docker compose --project-directory '${pastaNoDocker}' -p '${projeto}' up -d --build --no-deps atualizador`,
  ]);
}

async function atualizar() {
  estadoAtual = { ...estadoAtual, inicio: null };
  gravarEstado('ATUALIZANDO', 'Guardando uma cópia do banco de dados...', 3);
  const copia = await copiarBanco(true);
  gravarEstado('ATUALIZANDO', 'Baixando a versão nova do GitHub...', 10);
  const ramo = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const antes = await git(['rev-parse', 'HEAD']);
  // --ff-only: só avança. Se houver alteração local que conflite, para sem apagar nada.
  await git(['pull', '--ff-only', 'origin', ramo]);
  await acertarDono();
  const depois = await git(['rev-parse', 'HEAD']);
  gravarEstado('ATUALIZANDO', 'Reconstruindo o sistema (pode levar alguns minutos)...', 15);
  await reconstruir();
  await gravarVersao();
  if (antes === depois) {
    gravarEstado('OK', `O sistema já estava na última versão. Cópia do banco: ${copia}`, 100);
  } else {
    gravarEstado('OK', `Atualizado de ${antes.slice(0, 7)} para ${depois.slice(0, 7)}. Cópia do banco: ${copia}`, 100);
    await recriarAtualizadorSePreciso(antes, depois);
  }
}

async function restaurar(nome) {
  if (!COPIA_VALIDA.test(nome) || !fs.statSync(path.join(PASTA_BACKUPS, nome), { throwIfNoEntry: false })?.isFile()) {
    throw new Error('Pedido de restauração com cópia inválida.');
  }
  estadoAtual = { ...estadoAtual, inicio: null };
  gravarEstado('ATUALIZANDO', 'Guardando uma cópia do banco como está agora...', 10);
  const anterior = await copiarBanco(false);
  gravarEstado('ATUALIZANDO', `Restaurando a cópia ${nome}...`, 40);
  await compose(['stop', 'web', 'api']);
  await compose(['cp', path.join(PASTA_BACKUPS, nome), 'db:/tmp/restaurar.sql']);
  // Tudo em uma transação só: se a cópia falhar no meio, nada muda e o banco continua como estava.
  await compose([
    'exec', '-T', 'db', 'psql', '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-q', '-U', 'financas', '-d', 'financas',
    '-c', 'DROP SCHEMA public CASCADE', '-c', 'CREATE SCHEMA public', '-f', '/tmp/restaurar.sql',
  ]);
  // Drive: o banco restaurado conta como alteração deste computador, para a pasta não desfazer a restauração.
  await rodar('docker', [
    'compose', '--project-directory', pastaNoDocker, '-p', projeto,
    'exec', '-T', 'db', 'psql', '-U', 'financas', '-d', 'financas', '-c',
    'INSERT INTO "EstadoDrive" (id, sujo, "alteradoEm") VALUES (1, true, now()) ON CONFLICT (id) DO UPDATE SET sujo = true, "alteradoEm" = now()',
  ], { env: ambienteDoCompose() });
  await compose(['exec', '-T', 'db', 'rm', '-f', '/tmp/restaurar.sql']);
  gravarEstado('ATUALIZANDO', 'Ligando o sistema de novo...', 85);
  await compose(['up', '-d', '--no-deps', 'api', 'web']);
  // O site foi parado e ligado de novo: o contêiner https divide a rede com ele e precisa ser recriado.
  await ligarHttps(true);
  gravarEstado('OK', `Banco restaurado da cópia ${nome}. O banco de antes ficou em ${anterior}.`, 100);
}

// Cópia pedida pela tela (botão "Criar cópia agora"): só o pg_dump, sem atualizar nada.
async function copiarAgora() {
  gravarEstado('ATUALIZANDO', 'Criando uma cópia do banco de dados...', 30);
  const nome = await copiarBanco(true);
  gravarEstado('OK', `Cópia do banco criada: ${nome}`, 100);
}

async function atenderPedido() {
  let tipo = '';
  let arquivo = '';
  try {
    const pedido = JSON.parse(fs.readFileSync(ARQUIVO_PEDIDO, 'utf8'));
    tipo = String(pedido.tipo ?? '');
    arquivo = String(pedido.arquivo ?? '');
  } catch {
    // pedido ilegível: vale como atualização, como no atualizar.ps1
  }
  fs.rmSync(ARQUIVO_PEDIDO, { force: true });
  try {
    if (tipo === 'RESTAURAR') await restaurar(arquivo);
    else if (tipo === 'COPIAR') await copiarAgora();
    else await atualizar();
  } catch (erro) {
    const mensagem = String(erro instanceof Error ? erro.message : erro).slice(0, 400);
    if (tipo === 'RESTAURAR') {
      // Se parou no meio, tenta religar o sistema para ele não ficar fora do ar.
      await rodar('docker', ['compose', '--project-directory', pastaNoDocker, '-p', projeto, 'up', '-d', '--no-deps', 'api', 'web'], { env: ambienteDoCompose() });
      gravarEstado('ERRO', `A restauração falhou: ${mensagem}`);
    } else if (tipo === 'COPIAR') {
      gravarEstado('ERRO', `A cópia do banco falhou: ${mensagem}`);
    } else {
      gravarEstado('ERRO', mensagem);
    }
  }
}

async function principal() {
  fs.mkdirSync(PASTA, { recursive: true });
  try {
    const lido = JSON.parse(fs.readFileSync(ARQUIVO_ESTADO, 'utf8'));
    estadoAtual = { situacao: lido.situacao ?? 'PARADO', mensagem: lido.mensagem ?? '', em: lido.em ?? null };
  } catch {
    // primeira vez
  }
  // Uma atualização interrompida (computador desligado no meio) não fica "atualizando" para sempre.
  if (estadoAtual.situacao === 'ATUALIZANDO') {
    estadoAtual = { situacao: 'ERRO', mensagem: 'A atualização foi interrompida. Tente de novo.', em: agora() };
  }
  bater();
  setInterval(bater, INTERVALO_MS);

  // Sem saber o projeto não dá para atualizar: tenta de novo até conseguir (o Docker pode estar subindo).
  for (;;) {
    try {
      await prepararCaminhos();
      break;
    } catch (erro) {
      registrar(String(erro instanceof Error ? erro.message : erro));
      await new Promise((r) => setTimeout(r, 30000));
    }
  }
  // Garante o contêiner https em instalações que foram atualizadas por uma versão do atualizador que não o conhecia.
  await ligarHttps(false);
  try {
    await gravarVersao();
  } catch (erro) {
    registrar(`Versão não gravada: ${erro instanceof Error ? erro.message : erro}`);
  }

  void medirConteineres();
  setInterval(() => void medirConteineres(), INTERVALO_CONTEINERES_MS);

  for (;;) {
    if (fs.existsSync(ARQUIVO_PEDIDO)) await atenderPedido();
    if (fs.existsSync(ARQUIVO_REINICIO)) await atenderReinicio();
    await new Promise((r) => setTimeout(r, INTERVALO_MS));
  }
}

principal();
