import { pedirJson } from './http';
import { certificadoDe, janelas, numero, textoLimpo, tokenEmCache } from './tipos';
import type { CampoCredencial, Conector, LancamentoDoBanco } from './tipos';

// Conectores de API direta. Cada um segue a documentação pública do banco; o que a API não traz (por exemplo o
// saldo no Mercado Pago, quando a conta não libera) volta null e o saldo da conta é ajustado pelos lançamentos.

const CERTIFICADO_PEM: CampoCredencial[] = [
  { nome: 'certificado', rotulo: 'Certificado (.crt ou .pem)', tipo: 'arquivo', obrigatorio: true, aceita: '.crt,.pem,.cer' },
  { nome: 'chave', rotulo: 'Chave privada (.key)', tipo: 'arquivo', obrigatorio: true, aceita: '.key,.pem' },
];

// ---------- Banco Inter Empresas ----------
// API Banking v2: token OAuth2 (client credentials, escopo extrato.read) com mTLS; saldo e extrato completo (com id
// de cada lançamento), no máximo 90 dias por consulta.

const INTER = 'https://cdpj.partners.bancointer.com.br';

interface TransacaoInter {
  idTransacao?: string;
  dataTransacao?: string;
  dataInclusao?: string;
  dataEntrada?: string;
  tipoOperacao?: string; // C ou D
  tipoTransacao?: string;
  valor?: string | number;
  titulo?: string;
  descricao?: string;
}

const inter: Conector = {
  id: 'inter',
  nome: 'Banco Inter Empresas',
  cor: '#FF7A00',
  campos: [
    { nome: 'clientId', rotulo: 'Client ID', tipo: 'texto', obrigatorio: true },
    { nome: 'clientSecret', rotulo: 'Client Secret', tipo: 'segredo', obrigatorio: true },
    ...CERTIFICADO_PEM,
    { nome: 'contaCorrente', rotulo: 'Número da conta (só se a empresa tiver mais de uma)', tipo: 'texto', obrigatorio: false },
  ],
  comoObter: [
    'No Internet Banking do Inter Empresas, abra Soluções para sua empresa > Nova Integração.',
    'Marque a permissão "Consultar extrato e saldo" e crie a integração.',
    'Baixe o arquivo da integração: ele traz o Client ID, o Client Secret, o certificado (.crt) e a chave (.key).',
  ],
  async saldo(c, cache) {
    const r = await pedirJson<{ disponivel?: number }>({
      url: `${INTER}/banking/v2/saldo`,
      cabecalhos: await cabecalhosInter(c, cache),
      certificado: certificadoDe(c),
    });
    return r.disponivel === undefined ? null : numero(r.disponivel);
  },
  async extrato(c, de, ate, cache) {
    const saida: LancamentoDoBanco[] = [];
    for (const j of janelas(de, ate, 89)) {
      for (let pagina = 0; pagina < 200; pagina++) {
        const q = new URLSearchParams({ dataInicio: j.de, dataFim: j.ate, pagina: String(pagina), tamanhoPagina: '500' });
        const r = await pedirJson<{ totalPaginas?: number; transacoes?: TransacaoInter[] }>({
          url: `${INTER}/banking/v2/extrato/completo?${q}`,
          cabecalhos: await cabecalhosInter(c, cache),
          certificado: certificadoDe(c),
        });
        for (const t of r.transacoes ?? []) {
          const data = (t.dataTransacao ?? t.dataInclusao ?? t.dataEntrada ?? '').slice(0, 10);
          const valor = Math.abs(numero(t.valor));
          if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || valor === 0) continue;
          saida.push({
            idExterno: t.idTransacao ?? `${data}|${t.tipoOperacao}|${valor}|${t.titulo}|${t.descricao}`,
            data,
            descricao: textoLimpo(t.titulo, t.descricao),
            valor,
            tipo: (t.tipoOperacao ?? '').toUpperCase() === 'C' ? 'RECEITA' : 'DESPESA',
          });
        }
        if (pagina + 1 >= (r.totalPaginas ?? 1)) break;
      }
    }
    return saida;
  },
};

async function cabecalhosInter(c: Record<string, string>, cache: string): Promise<Record<string, string>> {
  const token = await tokenEmCache(cache, async () => {
    const r = await pedirJson<{ access_token: string; expires_in?: number }>({
      url: `${INTER}/oauth/v2/token`,
      metodo: 'POST',
      formulario: { client_id: c.clientId, client_secret: c.clientSecret, grant_type: 'client_credentials', scope: 'extrato.read' },
      certificado: certificadoDe(c),
    });
    return { token: r.access_token, segundos: r.expires_in ?? 3600 };
  });
  return { Authorization: `Bearer ${token}`, ...(c.contaCorrente ? { 'x-conta-corrente': c.contaCorrente.replace(/\D/g, '') } : {}) };
}

// ---------- Cora ----------
// Integração Direta (plano Cora Pro): token por client credentials com mTLS; saldo e extrato. Valores em centavos.

const CORA = 'https://matls-clients.api.cora.com.br';

interface EntradaCora {
  id?: string;
  type?: string; // CREDIT ou DEBIT
  amount?: number; // centavos
  createdAt?: string;
  transaction?: { id?: string; description?: string; counterParty?: { name?: string } };
}

const cora: Conector = {
  id: 'cora',
  nome: 'Cora',
  cor: '#FE3E6D',
  campos: [{ nome: 'clientId', rotulo: 'Client ID', tipo: 'texto', obrigatorio: true }, ...CERTIFICADO_PEM],
  comoObter: [
    'No app ou na web da Cora (plano Cora Pro), abra Integrações > Integração Direta.',
    'Gere as credenciais: a Cora entrega o Client ID, o certificado (certificate.pem) e a chave privada (private-key.key).',
  ],
  observacao: 'A Integração Direta da Cora faz parte do plano pago Cora Pro.',
  async saldo(c, cache) {
    const r = await pedirJson<{ balance?: number }>({
      url: `${CORA}/third-party/account/balance`,
      cabecalhos: await cabecalhosCora(c, cache),
      certificado: certificadoDe(c),
    });
    return r.balance === undefined ? null : numero(r.balance) / 100;
  },
  async extrato(c, de, ate, cache) {
    const saida: LancamentoDoBanco[] = [];
    for (const j of janelas(de, ate, 90)) {
      for (let pagina = 1; pagina <= 200; pagina++) {
        const q = new URLSearchParams({ start: j.de, end: j.ate, page: String(pagina), perPage: '200' });
        const r = await pedirJson<{ entries?: EntradaCora[] }>({
          url: `${CORA}/bank-statement/statement?${q}`,
          cabecalhos: await cabecalhosCora(c, cache),
          certificado: certificadoDe(c),
        });
        const entradas = r.entries ?? [];
        for (const e of entradas) {
          const data = (e.createdAt ?? '').slice(0, 10);
          const valor = Math.abs(numero(e.amount)) / 100;
          if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || valor === 0) continue;
          saida.push({
            idExterno: e.id ?? e.transaction?.id ?? `${e.createdAt}|${e.type}|${e.amount}`,
            data,
            descricao: textoLimpo(e.transaction?.description, e.transaction?.counterParty?.name),
            valor,
            tipo: (e.type ?? '').toUpperCase() === 'CREDIT' ? 'RECEITA' : 'DESPESA',
          });
        }
        if (entradas.length < 200) break;
      }
    }
    return saida;
  },
};

async function cabecalhosCora(c: Record<string, string>, cache: string): Promise<Record<string, string>> {
  const token = await tokenEmCache(cache, async () => {
    const r = await pedirJson<{ access_token: string; expires_in?: number }>({
      url: `${CORA}/token`,
      metodo: 'POST',
      formulario: { grant_type: 'client_credentials', client_id: c.clientId },
      certificado: certificadoDe(c),
    });
    return { token: r.access_token, segundos: r.expires_in ?? 3600 };
  });
  return { Authorization: `Bearer ${token}` };
}

// ---------- Mercado Pago ----------
// Access Token de produção da conta. A API pública traz os pagamentos recebidos (vendas, Pix, link de pagamento),
// com o valor líquido que cai na conta. Gastos feitos com o saldo não aparecem nela: para eles, use o Open Finance.

const MP = 'https://api.mercadopago.com';

interface PagamentoMp {
  id?: number;
  status?: string;
  date_approved?: string | null;
  date_created?: string;
  description?: string | null;
  transaction_amount?: number;
  transaction_details?: { net_received_amount?: number };
  payer?: { email?: string | null; first_name?: string | null };
  payment_method_id?: string;
}

const mercadopago: Conector = {
  id: 'mercadopago',
  nome: 'Mercado Pago',
  cor: '#009EE3',
  campos: [{ nome: 'accessToken', rotulo: 'Access Token de produção (APP_USR-...)', tipo: 'segredo', obrigatorio: true }],
  comoObter: [
    'Entre em mercadopago.com.br/developers com a conta da empresa e abra Suas integrações > Criar aplicação.',
    'Em Credenciais de produção, copie o Access Token (começa com APP_USR-).',
  ],
  observacao: 'Pela API do Mercado Pago entram os recebimentos (valor líquido). Pagamentos e Pix enviados com o saldo só chegam pelo Open Finance ou pelo extrato em arquivo.',
  async saldo(c) {
    const cab = { Authorization: `Bearer ${c.accessToken}` };
    const eu = await pedirJson<{ id?: number }>({ url: `${MP}/users/me`, cabecalhos: cab });
    if (!eu.id) return null;
    try {
      const r = await pedirJson<{ available_balance?: number; total_amount?: number }>({
        url: `${MP}/users/${eu.id}/mercadopago_account/balance`,
        cabecalhos: cab,
      });
      const v = r.total_amount ?? r.available_balance;
      return v === undefined ? null : numero(v);
    } catch {
      return null; // a consulta de saldo não é liberada para todas as contas
    }
  },
  async extrato(c, de, ate) {
    const cab = { Authorization: `Bearer ${c.accessToken}` };
    const saida: LancamentoDoBanco[] = [];
    for (let offset = 0; offset < 10_000; offset += 100) {
      const q = new URLSearchParams({
        sort: 'date_created',
        criteria: 'asc',
        range: 'date_created',
        begin_date: `${de}T00:00:00.000-03:00`,
        end_date: `${ate}T23:59:59.999-03:00`,
        status: 'approved',
        limit: '100',
        offset: String(offset),
      });
      const r = await pedirJson<{ results?: PagamentoMp[]; paging?: { total?: number } }>({ url: `${MP}/v1/payments/search?${q}`, cabecalhos: cab });
      for (const p of r.results ?? []) {
        const data = (p.date_approved ?? p.date_created ?? '').slice(0, 10);
        const valor = Math.abs(numero(p.transaction_details?.net_received_amount ?? p.transaction_amount));
        if (!p.id || !/^\d{4}-\d{2}-\d{2}$/.test(data) || valor === 0) continue;
        saida.push({
          idExterno: String(p.id),
          data,
          descricao: textoLimpo('Recebimento', p.description, p.payer?.first_name ?? p.payer?.email),
          valor,
          tipo: 'RECEITA',
        });
      }
      if ((r.results ?? []).length < 100 || offset + 100 >= (r.paging?.total ?? 0)) break;
    }
    return saida;
  },
};

export const CONECTORES: Record<string, Conector> = { inter, cora, mercadopago };
