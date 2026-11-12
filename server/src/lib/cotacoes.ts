// Cotações de ações, fundos imobiliários, ETFs e BDRs pela brapi.dev (https://brapi.dev/docs).
// O plano gratuito aceita um ativo por requisição e pede um token (gratuito) para a maioria dos códigos.
// O token vem das configurações gravadas no banco (cifrado) ou de BRAPI_TOKEN no .env.
// Sem token (ou quando a brapi não conhece o código), vale o último fechamento do Yahoo Finance, que não pede cadastro.
// Com a cotação, o saldo do investimento passa a ser quantidade x preço.

import { perfilAtual, prisma } from './prisma';
import { emCadaPerfil } from './perfil';
import { garantirPrecos, ultimoPreco } from './carteira';
import { somarDias, hojeISO } from './indices';
import { decifrar } from './cripto';
import { HttpError } from './erros';
import { arredondar, num, registrarPosicaoPatrimonio } from './financas';

const BASE = 'https://brapi.dev/api/quote/';
const TEMPO_LIMITE_MS = 15000;
const PAUSA_ENTRE_CHAMADAS_MS = 250;
const CODIGO_NEGOCIADO = /^[A-Z]{4}\d{1,2}$/;

export async function tokenDasCotacoes(): Promise<{ token: string; origem: 'BANCO' | 'ENV' } | null> {
  const config = await prisma.configuracaoPlataforma.findUnique({ where: { id: 1 }, select: { brapiTokenCifrado: true } });
  if (config?.brapiTokenCifrado) {
    const token = decifrar(config.brapiTokenCifrado);
    if (token) return { token, origem: 'BANCO' };
  }
  const doEnv = (process.env.BRAPI_TOKEN ?? '').trim();
  return doEnv ? { token: doEnv, origem: 'ENV' } : null;
}

// Preço atual de um código. Devolve null quando a brapi não conhece o código (ativo que saiu da bolsa, por exemplo).
// Lança HttpError quando o token é recusado ou o limite do plano foi atingido.
export async function buscarCotacao(codigo: string, token: string | null): Promise<number | null> {
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), TEMPO_LIMITE_MS);
  let resposta: Response;
  try {
    resposta = await fetch(BASE + encodeURIComponent(codigo), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: controle.signal,
    });
  } catch {
    throw new HttpError(502, 'Não foi possível falar com o serviço de cotações. Tente de novo em instantes.');
  } finally {
    clearTimeout(relogio);
  }
  if (resposta.status === 401 || resposta.status === 403) {
    throw new HttpError(400, token ? 'O serviço de cotações recusou o token.' : 'O serviço de cotações pede um token para este ativo.');
  }
  if (resposta.status === 402 || resposta.status === 429) {
    throw new HttpError(429, 'O limite de consultas do plano de cotações foi atingido. Tente mais tarde.');
  }
  if (!resposta.ok) return null;
  const corpo = (await resposta.json().catch(() => null)) as { results?: { regularMarketPrice?: number | null }[] } | null;
  const preco = corpo?.results?.[0]?.regularMarketPrice;
  return typeof preco === 'number' && Number.isFinite(preco) && preco > 0 ? preco : null;
}

export interface ResultadoCotacoes {
  atualizados: number;
  semCotacao: string[]; // códigos que o serviço não conhece
  erro: string | null; // motivo de ter parado antes do fim, se parou
}

// Uma execução por perfil financeiro (a chave 0 é "sem perfil").
const emAndamento = new Map<number, Promise<ResultadoCotacoes>>();

async function executar(): Promise<ResultadoCotacoes> {
  const credencial = await tokenDasCotacoes();
  const investimentos = await prisma.investimento.findMany({
    where: { ativo: true, origem: 'MANUAL', codigo: { not: null }, quantidade: { gt: 0 } },
    select: { id: true, codigo: true, quantidade: true },
    orderBy: { codigo: 'asc' },
  });
  const resultado: ResultadoCotacoes = { atualizados: 0, semCotacao: [], erro: null };
  const precos = new Map<string, number | null>();
  for (const investimento of investimentos) {
    const codigo = (investimento.codigo ?? '').toUpperCase();
    if (!CODIGO_NEGOCIADO.test(codigo)) continue;
    try {
      if (!precos.has(codigo)) {
        let preco = credencial ? await buscarCotacao(codigo, credencial.token) : null;
        if (preco === null) {
          await garantirPrecos([codigo], somarDias(hojeISO(), -30));
          preco = await ultimoPreco(codigo);
        }
        precos.set(codigo, preco);
        await new Promise((resolve) => setTimeout(resolve, PAUSA_ENTRE_CHAMADAS_MS));
      }
    } catch (erro) {
      resultado.erro = erro instanceof Error ? erro.message : 'Falha ao buscar cotações';
      break;
    }
    const preco = precos.get(codigo) ?? null;
    if (preco === null) {
      if (!resultado.semCotacao.includes(codigo)) resultado.semCotacao.push(codigo);
      continue;
    }
    const agora = new Date();
    await prisma.investimento.update({
      where: { id: investimento.id },
      data: { saldo: arredondar(num(investimento.quantidade) * preco), dataPosicao: agora, cotadoEm: agora },
    });
    resultado.atualizados++;
  }
  if (resultado.atualizados > 0) await registrarPosicaoPatrimonio();
  return resultado;
}

// Atualiza o saldo de todos os investimentos manuais que têm código de bolsa e quantidade.
// Chamadas simultâneas compartilham a mesma execução.
export function atualizarCotacoes(): Promise<ResultadoCotacoes> {
  const chave = perfilAtual() ?? 0;
  let execucao = emAndamento.get(chave);
  if (!execucao) {
    execucao = executar().finally(() => {
      emAndamento.delete(chave);
    });
    emAndamento.set(chave, execucao);
  }
  return execucao;
}

const INTERVALO_MS = 8 * 60 * 60 * 1000;
const ATRASO_INICIAL_MS = 2 * 60 * 1000;
let automaticaIniciada = false;

// Atualiza dois minutos depois de o servidor subir e, depois, a cada 8 horas.
export function iniciarCotacoesAutomaticas(): void {
  if (automaticaIniciada) return;
  automaticaIniciada = true;
  const rodar = () => {
    tokenDasCotacoes()
      .then(() => emCadaPerfil(() => atualizarCotacoes()))
      .catch((erro: unknown) => {
        console.error('Falha na atualização automática das cotações:', erro instanceof Error ? erro.message : erro);
      });
  };
  setTimeout(rodar, ATRASO_INICIAL_MS).unref();
  setInterval(rodar, INTERVALO_MS).unref();
}
