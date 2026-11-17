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
  try {
    await gravarVersao();
  } catch (erro) {
    registrar(`Versão não gravada: ${erro instanceof Error ? erro.message : erro}`);
  }

  for (;;) {
    if (fs.existsSync(ARQUIVO_PEDIDO)) await atenderPedido();
    await new Promise((r) => setTimeout(r, INTERVALO_MS));
  }
}

principal();
