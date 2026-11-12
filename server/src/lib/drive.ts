// Drive: mantém os dados iguais em mais de um computador por meio de uma pasta sincronizada (Google Drive,
// OneDrive, Dropbox...). A pasta escolhida é montada no contêiner em /drive (PASTA_DRIVE no .env).
//
// Um banco de dados "vivo" dentro de pasta sincronizada corrompe quando dois computadores gravam ao mesmo tempo.
// Por isso cada computador continua com o próprio banco, e a pasta guarda uma fotografia completa dos dados:
//   financas-pessoais/dados.json.gz   todos os registros (perfis, contas, lançamentos, faturas, investimentos...)
//   financas-pessoais/estado.json     versão, data, computador de origem e a soma de verificação do arquivo
// A cada ciclo (20 segundos): se a pasta tem uma versão que este computador ainda não viu, ele a carrega;
// se este computador mudou algo, ele grava uma versão nova. Se os dois mudaram no intervalo, vale a alteração
// mais recente e a outra fica guardada na pasta como "conflito-...", sem ser apagada.

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import zlib from 'zlib';
import { promisify } from 'util';
import { prismaSemPerfil as db } from './prisma';
import { esquecerPerfis } from './perfil';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const RAIZ = '/drive';
const PASTA = path.join(RAIZ, 'financas-pessoais');
const ARQUIVO_DADOS = path.join(PASTA, 'dados.json.gz');
const ARQUIVO_ESTADO = path.join(PASTA, 'estado.json');
const FORMATO = 1;
const INTERVALO_MS = 20 * 1000;
const ESPERA_APOS_ALTERAR_MS = 8 * 1000;

// Tabelas que viajam, na ordem em que podem ser criadas (as dependências vêm antes).
// Ficam de fora: log de atividades, tokens de senha, e-mails, índices e preços (são buscados de novo) e o
// estado do próprio Drive.
const TABELAS = [
  'perfilFinanceiro',
  'usuario',
  'configuracaoPlataforma',
  'conexaoBancaria',
  'conta',
  'categoria',
  'fatura',
  'transacao',
  'investimento',
  'movimentoInvestimento',
  'posicaoPatrimonio',
  'orcamento',
  'meta',
  'importacao',
] as const;
type Tabela = (typeof TABELAS)[number];

const NOME_NO_BANCO: Record<Tabela, string> = {
  perfilFinanceiro: 'PerfilFinanceiro',
  usuario: 'Usuario',
  configuracaoPlataforma: 'ConfiguracaoPlataforma',
  conexaoBancaria: 'ConexaoBancaria',
  conta: 'Conta',
  categoria: 'Categoria',
  fatura: 'Fatura',
  transacao: 'Transacao',
  investimento: 'Investimento',
  movimentoInvestimento: 'MovimentoInvestimento',
  posicaoPatrimonio: 'PosicaoPatrimonio',
  orcamento: 'Orcamento',
  meta: 'Meta',
  importacao: 'Importacao',
};

type Linhas = Record<string, unknown>[];
// O Prisma não tem um tipo comum para "qualquer modelo"; este é o mínimo usado aqui.
interface Modelo {
  findMany(args?: { orderBy?: { id: 'asc' } }): Promise<Linhas>;
  deleteMany(args?: Record<string, never>): Promise<unknown>;
  createMany(args: { data: Linhas }): Promise<unknown>;
  count(): Promise<number>;
}
function modelo(cliente: unknown, tabela: Tabela): Modelo {
  return (cliente as Record<Tabela, Modelo>)[tabela];
}

interface EstadoRemoto {
  formato: number;
  versao: string;
  atualizadoEm: string;
  maquina: string;
  sha256: string;
  registros: number;
}

export function pastaConfigurada(): string | null {
  const pasta = (process.env.PASTA_DRIVE ?? '').trim();
  return pasta === '' ? null : pasta;
}

function nomeDaMaquina(): string {
  return ((process.env.NOME_DA_MAQUINA ?? '').trim() || 'computador').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'computador';
}

async function estadoLocal() {
  return (await db.estadoDrive.findUnique({ where: { id: 1 } })) ?? (await db.estadoDrive.create({ data: { id: 1 } }));
}

// Chamado depois de cada alteração feita pela tela: marca que este computador tem algo a enviar.
let marcacaoPendente = false;
export function marcarAlterado(): void {
  if (pastaConfigurada() === null || marcacaoPendente) return;
  marcacaoPendente = true;
  db.estadoDrive
    .upsert({ where: { id: 1 }, create: { id: 1, sujo: true, alteradoEm: new Date() }, update: { sujo: true, alteradoEm: new Date() } })
    .catch((erro: unknown) => console.error('Drive: falha ao marcar alteração:', erro instanceof Error ? erro.message : erro))
    .finally(() => {
      marcacaoPendente = false;
    });
}

// O que há na pasta. 'ausente' = pasta vazia de verdade (nenhum dos dois arquivos). 'esperar' = só um dos
// arquivos chegou, ou o estado.json está pela metade: o programa do Drive ainda está sincronizando, e agir agora
// poderia gravar por cima de dados que estão a caminho.
type Leitura = { tipo: 'ausente' } | { tipo: 'esperar' } | { tipo: 'ok'; estado: EstadoRemoto };

async function existe(arquivo: string): Promise<boolean> {
  try {
    await fs.access(arquivo);
    return true;
  } catch {
    return false;
  }
}

async function lerRemoto(): Promise<Leitura> {
  const [temEstado, temDados] = await Promise.all([existe(ARQUIVO_ESTADO), existe(ARQUIVO_DADOS)]);
  if (!temEstado && !temDados) return { tipo: 'ausente' };
  if (!temEstado || !temDados) return { tipo: 'esperar' };
  try {
    const e = JSON.parse(await fs.readFile(ARQUIVO_ESTADO, 'utf8')) as Partial<EstadoRemoto>;
    if (typeof e.versao !== 'string' || typeof e.sha256 !== 'string' || typeof e.atualizadoEm !== 'string') return { tipo: 'esperar' };
    return {
      tipo: 'ok',
      estado: { formato: Number(e.formato) || 0, versao: e.versao, atualizadoEm: e.atualizadoEm, maquina: String(e.maquina ?? ''), sha256: e.sha256, registros: Number(e.registros) || 0 },
    };
  } catch {
    return { tipo: 'esperar' };
  }
}

// O dados.json.gz da pasta é exatamente o que o estado.json descreve? (falso enquanto um deles ainda está chegando)
async function arquivoDaPastaIntegro(remoto: EstadoRemoto): Promise<boolean> {
  try {
    const arquivo = await fs.readFile(ARQUIVO_DADOS);
    return crypto.createHash('sha256').update(arquivo).digest('hex') === remoto.sha256;
  } catch {
    return false;
  }
}

async function temDadosLocais(): Promise<boolean> {
  const [contas, investimentos, transacoes] = await Promise.all([db.conta.count(), db.investimento.count(), db.transacao.count()]);
  return contas + investimentos + transacoes > 0;
}

async function montarFotografia(): Promise<{ arquivo: Buffer; registros: number }> {
  const tabelas: Record<string, Linhas> = {};
  let registros = 0;
  // Todas as tabelas lidas no mesmo instante do banco, para a fotografia nunca sair com metade de uma alteração.
  await db.$transaction(
    async (tx) => {
      for (const tabela of TABELAS) {
        const linhas = await modelo(tx, tabela).findMany({ orderBy: { id: 'asc' } });
        tabelas[tabela] = linhas;
        registros += linhas.length;
      }
    },
    { isolationLevel: 'RepeatableRead', timeout: 120000, maxWait: 20000 }
  );
  const arquivo = await gzip(Buffer.from(JSON.stringify({ formato: FORMATO, geradoEm: new Date().toISOString(), tabelas }), 'utf8'));
  return { arquivo, registros };
}

async function gravarComSeguranca(destino: string, conteudo: Buffer | string): Promise<void> {
  const temporario = destino + '.tmp-' + nomeDaMaquina();
  await fs.writeFile(temporario, conteudo);
  await fs.rename(temporario, destino);
}

// Grava na pasta a fotografia do banco deste computador.
async function enviar(): Promise<void> {
  const antes = await estadoLocal();
  const { arquivo, registros } = await montarFotografia();
  const remoto: EstadoRemoto = {
    formato: FORMATO,
    versao: `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    atualizadoEm: new Date().toISOString(),
    maquina: nomeDaMaquina(),
    sha256: crypto.createHash('sha256').update(arquivo).digest('hex'),
    registros,
  };
  await fs.mkdir(PASTA, { recursive: true });
  await gravarComSeguranca(ARQUIVO_DADOS, arquivo);
  await gravarComSeguranca(ARQUIVO_ESTADO, JSON.stringify(remoto, null, 2));
  // Só deixa de estar "sujo" se nada mudou enquanto a fotografia era gravada.
  const limpou = await db.estadoDrive.updateMany({
    where: { id: 1, alteradoEm: antes.alteradoEm },
    data: { versao: remoto.versao, sujo: false, sincronizadoEm: new Date(), pendencia: null, erro: null },
  });
  if (limpou.count === 0) {
    await db.estadoDrive.update({ where: { id: 1 }, data: { versao: remoto.versao, sincronizadoEm: new Date(), pendencia: null, erro: null } });
  }
}

class MudouDuranteACarga extends Error {}

// Troca o banco deste computador pela fotografia da pasta. Devolve false quando o arquivo ainda não chegou inteiro
// ou, com `exigirLimpo`, quando este computador ganhou uma alteração enquanto a carga começava (ela não é perdida:
// o próximo ciclo trata como conflito).
async function receber(remoto: EstadoRemoto, exigirLimpo = false): Promise<boolean> {
  let arquivo: Buffer;
  try {
    arquivo = await fs.readFile(ARQUIVO_DADOS);
  } catch {
    return false;
  }
  if (crypto.createHash('sha256').update(arquivo).digest('hex') !== remoto.sha256) return false;
  const conteudo = JSON.parse((await gunzip(arquivo)).toString('utf8')) as { formato?: number; tabelas?: Record<string, Linhas> };
  if (conteudo.formato !== FORMATO || !conteudo.tabelas) {
    throw new Error('O arquivo da pasta foi gravado por uma versão diferente do sistema. Atualize os dois computadores.');
  }
  const tabelas = conteudo.tabelas;
  if (!Array.isArray(tabelas.usuario) || tabelas.usuario.length === 0) {
    throw new Error('O arquivo da pasta não tem nenhum usuário: não foi carregado.');
  }
  try {
    await db.$transaction(
    async (tx) => {
      if (exigirLimpo && (await tx.estadoDrive.findUnique({ where: { id: 1 } }))?.sujo) throw new MudouDuranteACarga();
      for (const tabela of [...TABELAS].reverse()) await modelo(tx, tabela).deleteMany({});
      for (const tabela of TABELAS) {
        const linhas = tabelas[tabela] ?? [];
        for (let i = 0; i < linhas.length; i += 1000) await modelo(tx, tabela).createMany({ data: linhas.slice(i, i + 1000) });
        // Os próximos registros criados aqui continuam a numeração de onde ela parou.
        const nome = NOME_NO_BANCO[tabela];
        await tx.$executeRawUnsafe(
          `SELECT setval(pg_get_serial_sequence('"${nome}"', 'id'), GREATEST((SELECT COALESCE(MAX(id), 1) FROM "${nome}"), 1)) WHERE pg_get_serial_sequence('"${nome}"', 'id') IS NOT NULL`
        );
      }
      await tx.estadoDrive.upsert({
        where: { id: 1 },
        create: { id: 1, versao: remoto.versao, sujo: false, sincronizadoEm: new Date() },
        update: { versao: remoto.versao, sujo: false, sincronizadoEm: new Date(), pendencia: null, erro: null },
      });
    },
    { timeout: 180000, maxWait: 20000 }
    );
  } catch (erro) {
    if (erro instanceof MudouDuranteACarga) return false;
    throw erro;
  }
  esquecerPerfis();
  return true;
}

async function guardarConflito(): Promise<string> {
  const { arquivo } = await montarFotografia();
  const nome = `conflito-${nomeDaMaquina()}-${new Date().toISOString().replace(/[:.]/g, '-')}.json.gz`;
  await fs.mkdir(PASTA, { recursive: true });
  await fs.writeFile(path.join(PASTA, nome), arquivo);
  return nome;
}

let emAndamento: Promise<void> | null = null;

async function executarCiclo(): Promise<void> {
  if (pastaConfigurada() === null) return;
  try {
    await fs.access(RAIZ);
    const local = await estadoLocal();
    const leitura = await lerRemoto();
    if (leitura.tipo === 'esperar') return; // arquivos ainda chegando: não lê nem grava nada

    if (local.pendencia === 'ESCOLHER') {
      // Esperando a pessoa decidir qual lado vale. Se a pasta esvaziou, não há mais o que escolher.
      if (leitura.tipo === 'ausente') await db.estadoDrive.update({ where: { id: 1 }, data: { pendencia: null } });
      return;
    }
    if (leitura.tipo === 'ausente') {
      // Pasta vazia. Um computador que nunca sincronizou e não tem dados não grava um banco vazio na pasta:
      // os dados do outro computador podem estar a caminho.
      if (local.versao !== null || (await temDadosLocais())) await enviar();
      return;
    }
    const remoto = leitura.estado;
    // Daqui em diante só age com o arquivo da pasta inteiro e igual ao que o estado.json descreve.
    if (!(await arquivoDaPastaIntegro(remoto))) return;

    if (remoto.versao === local.versao) {
      const parado = local.alteradoEm === null || Date.now() - local.alteradoEm.getTime() > ESPERA_APOS_ALTERAR_MS;
      if (local.sujo && parado) await enviar();
      else if (local.erro) await db.estadoDrive.update({ where: { id: 1 }, data: { erro: null } });
      return;
    }
    // A pasta tem uma versão que este computador ainda não viu.
    if (local.versao === null) {
      // Primeira vez deste computador na pasta: banco vazio carrega sozinho; com dados, a pessoa escolhe.
      if (await temDadosLocais()) await db.estadoDrive.update({ where: { id: 1 }, data: { pendencia: 'ESCOLHER' } });
      else await receber(remoto);
      return;
    }
    if (!local.sujo) {
      await receber(remoto, true);
      return;
    }
    // Os dois lados mudaram: guarda o que seria perdido e fica com a alteração mais recente.
    const daPastaEMaisNova = local.alteradoEm === null || new Date(remoto.atualizadoEm).getTime() > local.alteradoEm.getTime();
    if (daPastaEMaisNova) {
      const copia = await guardarConflito();
      if (await receber(remoto)) {
        await db.estadoDrive.update({ where: { id: 1 }, data: { ultimoConflito: `${new Date().toISOString()}|${copia}` } });
      }
    } else {
      await fs.copyFile(ARQUIVO_DADOS, path.join(PASTA, `conflito-${remoto.maquina || 'outro'}-${remoto.atualizadoEm.replace(/[:.]/g, '-')}.json.gz`)).catch(() => undefined);
      await enviar();
      await db.estadoDrive.update({ where: { id: 1 }, data: { ultimoConflito: `${new Date().toISOString()}|versão de ${remoto.maquina || 'outro computador'}` } });
    }
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : 'Falha ao sincronizar';
    console.error('Drive:', mensagem);
    await db.estadoDrive
      .upsert({ where: { id: 1 }, create: { id: 1, erro: mensagem.slice(0, 300) }, update: { erro: mensagem.slice(0, 300) } })
      .catch(() => undefined);
  }
}

// Um ciclo de sincronização. Chamadas simultâneas compartilham a mesma execução. Nunca lança.
export function sincronizarDrive(): Promise<void> {
  if (!emAndamento) {
    emAndamento = executarCiclo().finally(() => {
      emAndamento = null;
    });
  }
  return emAndamento;
}

// Resolve a primeira conexão de um computador que já tinha dados: 'PASTA' carrega o que está na pasta (os dados
// deste computador ficam guardados como conflito); 'COMPUTADOR' envia os deste computador por cima.
export async function escolherLado(origem: 'PASTA' | 'COMPUTADOR'): Promise<void> {
  if (emAndamento) await emAndamento;
  const leitura = await lerRemoto();
  if (leitura.tipo === 'esperar') throw new Error('Os arquivos da pasta ainda estão chegando. Tente de novo em instantes.');
  const remoto = leitura.tipo === 'ok' ? leitura.estado : null;
  if (remoto && !(await arquivoDaPastaIntegro(remoto))) throw new Error('O arquivo da pasta ainda está chegando. Tente de novo em instantes.');
  if (origem === 'PASTA') {
    if (!remoto) throw new Error('A pasta ainda não tem dados.');
    await guardarConflito();
    if (!(await receber(remoto))) throw new Error('O arquivo da pasta ainda está chegando. Tente de novo em instantes.');
  } else {
    if (remoto) await fs.copyFile(ARQUIVO_DADOS, path.join(PASTA, `conflito-${remoto.maquina || 'outro'}-${remoto.atualizadoEm.replace(/[:.]/g, '-')}.json.gz`)).catch(() => undefined);
    await enviar();
  }
}

export interface EstadoDriveDTO {
  configurado: boolean;
  pasta: string | null; // caminho no computador (o que está no .env)
  acessivel: boolean;
  maquina: string;
  versao: string | null;
  alteracoesAEnviar: boolean;
  sincronizadoEm: string | null;
  pendencia: 'ESCOLHER' | null;
  erro: string | null;
  naPasta: { atualizadoEm: string; maquina: string; registros: number } | null;
  ultimoConflito: { quando: string; copia: string } | null;
}

export async function estadoDoDrive(): Promise<EstadoDriveDTO> {
  const pasta = pastaConfigurada();
  const local = await estadoLocal();
  let acessivel = false;
  let remoto: EstadoRemoto | null = null;
  if (pasta !== null) {
    try {
      await fs.access(RAIZ);
      acessivel = true;
      const leitura = await lerRemoto();
      remoto = leitura.tipo === 'ok' ? leitura.estado : null;
    } catch {
      acessivel = false;
    }
  }
  const [quando, copia] = (local.ultimoConflito ?? '').split('|');
  return {
    configurado: pasta !== null,
    pasta,
    acessivel,
    maquina: nomeDaMaquina(),
    versao: local.versao,
    alteracoesAEnviar: local.sujo,
    sincronizadoEm: local.sincronizadoEm ? local.sincronizadoEm.toISOString() : null,
    pendencia: local.pendencia === 'ESCOLHER' ? 'ESCOLHER' : null,
    erro: local.erro,
    naPasta: remoto ? { atualizadoEm: remoto.atualizadoEm, maquina: remoto.maquina, registros: remoto.registros } : null,
    ultimoConflito: quando && copia ? { quando, copia } : null,
  };
}

let iniciado = false;
export function iniciarDrive(): void {
  if (iniciado) return;
  iniciado = true;
  if (pastaConfigurada() === null) return;
  setTimeout(() => void sincronizarDrive(), 5000).unref();
  setInterval(() => void sincronizarDrive(), INTERVALO_MS).unref();
}
