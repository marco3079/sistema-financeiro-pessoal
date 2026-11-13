// Pasta de entrada: quem põe um arquivo .csv ou .ofx na pasta "financas-pessoais/entrada" do Drive tem o arquivo
// importado sozinho. Depois ele é movido para "importados" (sucesso) ou "com-erro" (falha). Nada é apagado.
// A importação passa pela própria API (/importacao/analisar e /importacao/confirmar), como a tela faz.

import fs from 'fs/promises';
import path from 'path';
import { chamarApiInterna } from './mcp';
import { idsDosPerfis } from './perfil';

const RAIZ_DO_DRIVE = '/drive';
const NOME_DA_PASTA = 'financas-pessoais';
const TAMANHO_MAXIMO = 4 * 1024 * 1024;
const IDADE_MINIMA_MS = 20 * 1000;
const INTERVALO_MS = 2 * 60 * 1000;
const FORMATOS: Record<string, 'csv' | 'ofx'> = { '.csv': 'csv', '.ofx': 'ofx' };

export interface ResultadoEntrada {
  importados: { arquivo: string; novos: number; repetidos: number }[];
  comErro: { arquivo: string; motivo: string }[];
  ignorados: string[];
}

export interface SituacaoEntrada {
  ativa: boolean;
  pasta: string;
  aguardando: string[];
  naoSuportados: string[];
  ultimos: ResultadoEntrada | null;
}

export const NOME_DA_PASTA_DE_ENTRADA = `${NOME_DA_PASTA}/entrada`;

// Só ativa quando a pasta do Drive foi configurada (PASTA_DRIVE no .env).
export function pastaDeEntradaAtiva(): boolean {
  return (process.env.PASTA_DRIVE ?? '').trim() !== '';
}

function caminhoDaEntrada(): string {
  return path.join(RAIZ_DO_DRIVE, NOME_DA_PASTA, 'entrada');
}

let ultimo: ResultadoEntrada | null = null;
let execucao: Promise<ResultadoEntrada> | null = null;

// Último resultado de uma rodada (null se o servidor ainda não processou nada).
export function ultimoResultadoEntrada(): ResultadoEntrada | null {
  return ultimo;
}

// Nomes de arquivo válidos da pasta: só entradas comuns (não pastas, não links) e que não começam com ponto.
async function arquivosDaPasta(pasta: string): Promise<string[]> {
  const entradas = await fs.readdir(pasta, { withFileTypes: true });
  const nomes: string[] = [];
  for (const entrada of entradas) {
    if (!entrada.isFile() || entrada.name.startsWith('.')) continue;
    nomes.push(path.basename(entrada.name));
  }
  return nomes.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

async function garantirPastas(pasta: string): Promise<void> {
  await fs.mkdir(path.join(pasta, 'importados'), { recursive: true });
  await fs.mkdir(path.join(pasta, 'com-erro'), { recursive: true });
}

// Destino que não sobrescreve outro arquivo com o mesmo nome.
async function destinoLivre(pasta: string, nome: string): Promise<string> {
  const ponto = nome.lastIndexOf('.');
  const base = ponto > 0 ? nome.slice(0, ponto) : nome;
  const extensao = ponto > 0 ? nome.slice(ponto) : '';
  let candidato = nome;
  let n = 2;
  while (await existe(path.join(pasta, candidato))) {
    candidato = `${base} (${n})${extensao}`;
    n += 1;
  }
  return candidato;
}

async function existe(caminho: string): Promise<boolean> {
  try {
    await fs.access(caminho);
    return true;
  } catch {
    return false;
  }
}

// Lê como UTF-8; se aparecer o caractere de substituição, relê como latin1 (bancos antigos exportam assim).
function lerTexto(bruto: Buffer): string {
  const utf8 = bruto.toString('utf8');
  return utf8.includes('�') ? bruto.toString('latin1') : utf8;
}

function motivoDoErro(erro: unknown): string {
  return erro instanceof Error && erro.message ? erro.message : 'Erro inesperado';
}

interface RespostaAnalise {
  contaSugeridaId: number | null;
  documento: 'FATURA' | 'EXTRATO';
  banco: string | null;
  vencimento: string | null;
  itens: (Record<string, unknown> & { jaImportado: boolean })[];
}

interface RespostaConfirmar {
  novos: number;
  repetidos: number;
}

// Importa um arquivo e devolve o desfecho (sucesso ou motivo do erro). Nunca lança.
async function importarUm(
  perfilId: number,
  nome: string,
  formato: 'csv' | 'ofx',
  bruto: Buffer
): Promise<{ ok: true; novos: number; repetidos: number } | { ok: false; motivo: string }> {
  try {
    const texto = lerTexto(bruto);
    const analise = (await chamarApiInterna(perfilId, 'POST', '/importacao/analisar', {
      nome,
      formato,
      texto,
    })) as RespostaAnalise;
    if (analise.contaSugeridaId === null || analise.contaSugeridaId === undefined) {
      return { ok: false, motivo: 'Não identifiquei a conta: importe pela tela' };
    }
    if (analise.documento === 'FATURA' && !analise.vencimento) {
      return { ok: false, motivo: 'Não identifiquei o vencimento' };
    }
    const novosItens = analise.itens
      .filter((item) => !item.jaImportado)
      .map((item) => {
        const { jaImportado: _ignorado, ...resto } = item;
        return resto;
      });
    if (novosItens.length === 0) {
      return { ok: true, novos: 0, repetidos: analise.itens.length };
    }
    const confirmado = (await chamarApiInterna(perfilId, 'POST', '/importacao/confirmar', {
      arquivo: nome,
      documento: analise.documento,
      banco: analise.banco,
      contaId: analise.contaSugeridaId,
      vencimento: analise.vencimento,
      itens: novosItens,
    })) as RespostaConfirmar;
    return { ok: true, novos: confirmado.novos, repetidos: confirmado.repetidos };
  } catch (erro) {
    return { ok: false, motivo: motivoDoErro(erro) };
  }
}

async function rodar(perfilId: number): Promise<ResultadoEntrada> {
  const resultado: ResultadoEntrada = { importados: [], comErro: [], ignorados: [] };
  if (!pastaDeEntradaAtiva()) return resultado;
  const pasta = caminhoDaEntrada();
  await garantirPastas(pasta);

  const agora = Date.now();
  for (const nome of await arquivosDaPasta(pasta)) {
    const formato = FORMATOS[path.extname(nome).toLowerCase()];
    if (!formato) continue;
    const caminho = path.join(pasta, nome);
    try {
      const info = await fs.stat(caminho);
      if (agora - info.mtimeMs < IDADE_MINIMA_MS || info.size > TAMANHO_MAXIMO) {
        resultado.ignorados.push(nome);
        continue;
      }

      const bruto = await fs.readFile(caminho);
      const desfecho = await importarUm(perfilId, nome, formato, bruto);
      const destinoPasta = path.join(pasta, desfecho.ok ? "importados" : "com-erro");
      const destinoNome = await destinoLivre(destinoPasta, nome);
      const destino = path.join(destinoPasta, destinoNome);

      if (desfecho.ok) {
        resultado.importados.push({ arquivo: nome, novos: desfecho.novos, repetidos: desfecho.repetidos });
      } else {
        resultado.comErro.push({ arquivo: nome, motivo: desfecho.motivo });
      }

      try {
        await fs.rename(caminho, destino);
        const linhas = desfecho.ok
          ? `Importado em ${new Date().toISOString()}: ${desfecho.novos} novos, ${desfecho.repetidos} repetidos.`
          : `Não importado em ${new Date().toISOString()}: ${desfecho.motivo}.`;
        await fs.writeFile(`${destino}.txt`, linhas + "\n", "utf8");
      } catch (erro) {
        // Se não conseguiu mover, o arquivo fica na pasta e a rodada seguinte o tenta de novo.
        resultado.comErro.push({ arquivo: nome, motivo: `Não consegui mover o arquivo: ${motivoDoErro(erro)}` });
      }
    } catch (erro) {
      // Arquivo ilegível ou removido no meio da rodada: registra o erro e segue para o próximo.
      const motivo = motivoDoErro(erro);
      resultado.comErro.push({ arquivo: nome, motivo });
      try {
        const destinoPasta = path.join(pasta, "com-erro");
        const destino = path.join(destinoPasta, await destinoLivre(destinoPasta, nome));
        await fs.rename(caminho, destino);
        await fs.writeFile(`${destino}.txt`, `Não importado em ${new Date().toISOString()}: ${motivo}.\n`, "utf8");
      } catch {
        // Falha ao mover não derruba a rodada.
      }
      continue;
    }
  }
  return resultado;
}

// Processa a pasta agora. Duas chamadas ao mesmo tempo compartilham a mesma rodada.
export function processarEntrada(perfilId: number): Promise<ResultadoEntrada> {
  if (execucao) return execucao;
  execucao = rodar(perfilId)
    .catch((erro: unknown) => {
      console.error('Pasta de entrada: falha ao processar:', motivoDoErro(erro));
      return { importados: [], comErro: [], ignorados: [] } as ResultadoEntrada;
    })
    .then((resultado) => {
      // Rodadas vazias (a cada 2 minutos) não apagam o último resultado útil.
      if (ultimo === null || resultado.importados.length > 0 || resultado.comErro.length > 0) ultimo = resultado;
      return resultado;
    })
    .finally(() => {
      execucao = null;
    });
  return execucao;
}

// Situação atual da pasta, para a tela.
export async function situacaoDaEntrada(): Promise<SituacaoEntrada> {
  const ativa = pastaDeEntradaAtiva();
  const situacao: SituacaoEntrada = {
    ativa,
    pasta: NOME_DA_PASTA_DE_ENTRADA,
    aguardando: [],
    naoSuportados: [],
    ultimos: ultimoResultadoEntrada(),
  };
  if (!ativa) return situacao;
  try {
    const nomes = await arquivosDaPasta(caminhoDaEntrada());
    for (const nome of nomes) {
      if (FORMATOS[path.extname(nome).toLowerCase()]) situacao.aguardando.push(nome);
      else situacao.naoSuportados.push(nome);
    }
  } catch {
    // Pasta ainda não existe: nada aguardando.
  }
  return situacao;
}

let iniciado = false;

// Laço automático: a cada 2 minutos só o primeiro perfil processa a pasta (ela é uma só).
export function iniciarEntrada(): void {
  if (iniciado) return;
  iniciado = true;
  if (!pastaDeEntradaAtiva()) return;
  const rodar = () => {
    idsDosPerfis()
      .then((ids) => {
        if (ids.length === 0) return;
        return processarEntrada(ids[0]);
      })
      .catch((erro: unknown) => {
        console.error('Pasta de entrada: falha no laço automático:', motivoDoErro(erro));
      });
  };
  setInterval(rodar, INTERVALO_MS).unref();
}
