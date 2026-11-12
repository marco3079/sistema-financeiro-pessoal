// Cliente HTTP da Pluggy (agregador de Open Finance). Documentação: https://docs.pluggy.ai
// Autenticação: POST /auth com clientId e clientSecret devolve uma apiKey que vale 2 horas;
// as demais chamadas mandam a apiKey no cabeçalho X-API-KEY.
// As credenciais vêm das Configurações gravadas no banco (segredo cifrado) ou, na falta delas,
// de PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET do .env.

import { prisma } from './prisma';
import { decifrar } from './cripto';
import { HttpError } from './erros';

const BASE = 'https://api.pluggy.ai';
const VALIDADE_CHAVE_MS = 110 * 60 * 1000; // a apiKey vale 2 h; renovamos antes
const TEMPO_LIMITE_MS = 30000;
const MAXIMO_PAGINAS = 40;

// ---------- Formatos da Pluggy (só os campos usados) ----------

export interface PluggyItem {
  id: string;
  status: 'UPDATING' | 'UPDATED' | 'OUTDATED' | 'LOGIN_ERROR' | 'WAITING_USER_INPUT' | string;
  executionStatus?: string;
  lastUpdatedAt?: string | null;
  error?: { code?: string; message?: string; providerMessage?: string } | null;
  connector?: { id?: number; name?: string; imageUrl?: string; primaryColor?: string } | null;
}

export interface PluggyConta {
  id: string;
  type: 'BANK' | 'CREDIT' | string;
  subtype?: string;
  name?: string;
  marketingName?: string | null;
  number?: string | null;
  balance?: number | null;
  currencyCode?: string;
  creditData?: {
    brand?: string | null;
    level?: string | null;
    creditLimit?: number | null;
    availableCreditLimit?: number | null;
    balanceCloseDate?: string | null;
    balanceDueDate?: string | null;
    minimumPayment?: number | null;
  } | null;
}

export interface PluggyTransacao {
  id: string;
  description?: string | null;
  descriptionRaw?: string | null;
  amount: number;
  date: string;
  type?: 'DEBIT' | 'CREDIT' | string;
  status?: 'POSTED' | 'PENDING' | string;
  category?: string | null;
  creditCardMetadata?: {
    installmentNumber?: number | null;
    totalInstallments?: number | null;
    billId?: string | null;
  } | null;
}

export interface PluggyFatura {
  id: string;
  dueDate: string;
  billClosingDate?: string | null;
  totalAmount?: number | null;
  minimumPaymentAmount?: number | null;
  payments?: { amount?: number | null; paymentDate?: string | null }[] | null;
}

export interface PluggyInvestimento {
  id: string;
  name?: string | null;
  code?: string | null;
  number?: string | null;
  type?: string;
  subtype?: string | null;
  balance?: number | null;
  amount?: number | null;
  amountOriginal?: number | null;
  amountProfit?: number | null;
  quantity?: number | null;
  value?: number | null;
  date?: string | null;
  dueDate?: string | null;
  rate?: number | null;
  rateType?: string | null;
  fixedAnnualRate?: number | null;
  issuer?: string | null;
  status?: string | null;
  institution?: { name?: string | null } | null;
}

export interface PluggyMovimentoInvestimento {
  id: string;
  type?: string;
  movementType?: 'CREDIT' | 'DEBIT' | string;
  amount?: number | null;
  value?: number | null;
  quantity?: number | null;
  date?: string | null;
  tradeDate?: string | null;
  description?: string | null;
}

// ---------- Credenciais ----------

export interface CredenciaisPluggy {
  clientId: string;
  clientSecret: string;
  sandbox: boolean;
  origem: 'BANCO' | 'ENV';
}

// Credenciais em uso, ou null se o Open Finance ainda não foi configurado.
export async function credenciaisPluggy(): Promise<CredenciaisPluggy | null> {
  const config = await prisma.configuracaoPlataforma.findUnique({
    where: { id: 1 },
    select: { pluggyClientId: true, pluggyClientSecretCifrado: true, pluggySandbox: true },
  });
  const sandbox = config?.pluggySandbox ?? false;
  if (config?.pluggyClientId && config.pluggyClientSecretCifrado) {
    const segredo = decifrar(config.pluggyClientSecretCifrado);
    if (segredo) {
      return { clientId: config.pluggyClientId, clientSecret: segredo, sandbox, origem: 'BANCO' };
    }
  }
  const idEnv = (process.env.PLUGGY_CLIENT_ID ?? '').trim();
  const segredoEnv = (process.env.PLUGGY_CLIENT_SECRET ?? '').trim();
  if (idEnv && segredoEnv) {
    return {
      clientId: idEnv,
      clientSecret: segredoEnv,
      sandbox: sandbox || process.env.PLUGGY_SANDBOX === 'true',
      origem: 'ENV',
    };
  }
  return null;
}

// ---------- Chamadas ----------

let chaveEmCache: { clientId: string; apiKey: string; ate: number } | null = null;

export function esquecerChavePluggy(): void {
  chaveEmCache = null;
}

async function buscar(caminho: string, opcoes: RequestInit): Promise<Response> {
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), TEMPO_LIMITE_MS);
  try {
    return await fetch(BASE + caminho, { ...opcoes, signal: controle.signal });
  } catch {
    throw new HttpError(502, 'Não foi possível falar com a Pluggy. Tente de novo em instantes.');
  } finally {
    clearTimeout(relogio);
  }
}

async function mensagemDeErro(resposta: Response): Promise<string> {
  try {
    const corpo = (await resposta.json()) as { message?: string; codeDescription?: string };
    return corpo.message ?? corpo.codeDescription ?? `erro ${resposta.status}`;
  } catch {
    return `erro ${resposta.status}`;
  }
}

// Troca clientId e clientSecret por uma apiKey. Lança HttpError 400 se a Pluggy recusar.
export async function autenticarNaPluggy(clientId: string, clientSecret: string): Promise<string> {
  const resposta = await buscar('/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, clientSecret }),
  });
  if (!resposta.ok) {
    throw new HttpError(400, 'A Pluggy recusou as credenciais: ' + (await mensagemDeErro(resposta)));
  }
  const corpo = (await resposta.json()) as { apiKey?: string };
  if (!corpo.apiKey) {
    throw new HttpError(502, 'A Pluggy não devolveu a chave de acesso.');
  }
  return corpo.apiKey;
}

async function apiKey(): Promise<string> {
  const credenciais = await credenciaisPluggy();
  if (!credenciais) {
    throw new HttpError(400, 'O Open Finance ainda não foi configurado. Informe as credenciais da Pluggy em Conexões.');
  }
  const agora = Date.now();
  if (chaveEmCache && chaveEmCache.clientId === credenciais.clientId && chaveEmCache.ate > agora) {
    return chaveEmCache.apiKey;
  }
  const chave = await autenticarNaPluggy(credenciais.clientId, credenciais.clientSecret);
  chaveEmCache = { clientId: credenciais.clientId, apiKey: chave, ate: agora + VALIDADE_CHAVE_MS };
  return chave;
}

async function chamar<T>(metodo: string, caminho: string, corpo?: unknown): Promise<T> {
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const chave = await apiKey();
    const resposta = await buscar(caminho, {
      method: metodo,
      headers: {
        'X-API-KEY': chave,
        Accept: 'application/json',
        ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
    });
    // Chave vencida ou revogada: renova uma vez.
    if ((resposta.status === 401 || resposta.status === 403) && tentativa === 0) {
      esquecerChavePluggy();
      continue;
    }
    if (!resposta.ok) {
      const status = resposta.status === 404 ? 404 : 502;
      throw new HttpError(status, 'Pluggy: ' + (await mensagemDeErro(resposta)));
    }
    return (await resposta.json()) as T;
  }
  throw new HttpError(502, 'Pluggy: não foi possível autenticar.');
}

interface Pagina<T> {
  page?: number;
  totalPages?: number;
  results?: T[];
}

// Listas paginadas por número de página (contas, faturas, investimentos).
async function listarPaginado<T>(caminho: string): Promise<T[]> {
  const todos: T[] = [];
  const separador = caminho.includes('?') ? '&' : '?';
  for (let pagina = 1; pagina <= MAXIMO_PAGINAS; pagina++) {
    const resposta = await chamar<Pagina<T>>('GET', `${caminho}${separador}pageSize=500&page=${pagina}`);
    todos.push(...(resposta.results ?? []));
    if (!resposta.totalPages || pagina >= resposta.totalPages) break;
  }
  return todos;
}

// Token de curta duração (30 min) para abrir o widget Pluggy Connect no navegador.
// Com itemId, o token serve para atualizar (reconectar) aquele item.
export async function criarConnectToken(itemId?: string): Promise<string> {
  const corpo = {
    ...(itemId ? { itemId } : {}),
    options: { clientUserId: 'sistema-financeiro-pessoal', avoidDuplicates: true },
  };
  const resposta = await chamar<{ accessToken?: string }>('POST', '/connect_token', corpo);
  if (!resposta.accessToken) {
    throw new HttpError(502, 'A Pluggy não devolveu o token de conexão.');
  }
  return resposta.accessToken;
}

export function obterItem(itemId: string): Promise<PluggyItem> {
  return chamar<PluggyItem>('GET', `/items/${encodeURIComponent(itemId)}`);
}

// Pede à Pluggy uma nova coleta de dados na instituição, com as credenciais já guardadas.
export function pedirAtualizacaoDoItem(itemId: string): Promise<PluggyItem> {
  return chamar<PluggyItem>('PATCH', `/items/${encodeURIComponent(itemId)}`, {});
}

export async function apagarItem(itemId: string): Promise<void> {
  await chamar<unknown>('DELETE', `/items/${encodeURIComponent(itemId)}`);
}

export function listarContasDoItem(itemId: string): Promise<PluggyConta[]> {
  return listarPaginado<PluggyConta>(`/accounts?itemId=${encodeURIComponent(itemId)}`);
}

// Lançamentos de uma conta a partir de `de` ('AAAA-MM-DD'), pela API v2 (paginação por cursor).
export async function listarTransacoesDaConta(contaId: string, de: string): Promise<PluggyTransacao[]> {
  const todos: PluggyTransacao[] = [];
  let consulta: string | null = `?accountId=${encodeURIComponent(contaId)}&dateFrom=${de}`;
  for (let pagina = 0; pagina < MAXIMO_PAGINAS && consulta; pagina++) {
    const resposta: { results?: PluggyTransacao[]; next?: string | null } = await chamar('GET', `/v2/transactions${consulta}`);
    todos.push(...(resposta.results ?? []));
    consulta = resposta.next ? (resposta.next.startsWith('?') ? resposta.next : `?${resposta.next}`) : null;
  }
  return todos;
}

export function listarFaturasDaConta(contaId: string): Promise<PluggyFatura[]> {
  return listarPaginado<PluggyFatura>(`/bills?accountId=${encodeURIComponent(contaId)}`);
}

export function listarInvestimentosDoItem(itemId: string): Promise<PluggyInvestimento[]> {
  return listarPaginado<PluggyInvestimento>(`/investments?itemId=${encodeURIComponent(itemId)}`);
}

export function listarMovimentosDoInvestimento(investimentoId: string): Promise<PluggyMovimentoInvestimento[]> {
  return listarPaginado<PluggyMovimentoInvestimento>(`/investments/${encodeURIComponent(investimentoId)}/transactions`);
}
