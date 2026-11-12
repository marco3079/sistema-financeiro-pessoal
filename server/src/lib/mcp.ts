// Servidor MCP (Model Context Protocol): deixa assistentes de IA (Claude, ChatGPT, Cursor...) consultarem os dados
// financeiros e, se a chave permitir, lançarem gastos. Transporte "Streamable HTTP" sem sessão: cada POST traz uma
// mensagem JSON-RPC e recebe a resposta em JSON.
//
// Cada ferramenta chama a própria API do sistema (as mesmas rotas que a tela usa), com um token interno de curta
// duração e o perfil financeiro da chave. Assim a IA nunca enxerga mais do que a tela enxerga, e as regras de
// validação e de saldo são as mesmas.

import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prismaSemPerfil as db } from './prisma';
import { segredoDoServidor } from './auth';
import { idsDosPerfis } from './perfil';

export const VERSOES_DO_PROTOCOLO = ['2025-06-18', '2025-03-26', '2024-11-05'];
const LIMITE_DE_TEXTO = 60000;

export type Permissao = 'LEITURA' | 'ESCRITA';

export interface ChaveAtiva {
  id: number;
  nome: string;
  permissao: Permissao;
  perfilId: number;
}

// ---------- Chaves ----------

export function hashDaChave(chave: string): string {
  return crypto.createHash('sha256').update(chave, 'utf8').digest('hex');
}

export function novaChave(): { chave: string; hash: string; prefixo: string } {
  const chave = 'fin_' + crypto.randomBytes(32).toString('base64url');
  return { chave, hash: hashDaChave(chave), prefixo: chave.slice(0, 10) };
}

export async function buscarChave(chave: string): Promise<ChaveAtiva | null> {
  if (!/^fin_[A-Za-z0-9_-]{20,100}$/.test(chave)) return null;
  const achada = await db.chaveMcp.findUnique({ where: { hash: hashDaChave(chave) } });
  if (!achada) return null;
  // Chave de um perfil que não existe mais não vale (sem isto ela cairia no primeiro perfil).
  if (!(await idsDosPerfis()).includes(achada.perfilId)) return null;
  db.chaveMcp
    .update({ where: { id: achada.id }, data: { ultimoUsoEm: new Date(), usos: { increment: 1 } } })
    .catch(() => undefined);
  return { id: achada.id, nome: achada.nome, permissao: achada.permissao === 'ESCRITA' ? 'ESCRITA' : 'LEITURA', perfilId: achada.perfilId };
}

// ---------- Chamada interna à API ----------

class ErroDaFerramenta extends Error {}

async function tokenInterno(): Promise<string> {
  const usuario = await db.usuario.findFirst({ where: { ativo: true, perfil: 'TITULAR' }, orderBy: { id: 'asc' }, select: { id: true, perfil: true } });
  if (!usuario) throw new ErroDaFerramenta('Nenhum usuário ativo no sistema.');
  return jwt.sign({ id: usuario.id, perfil: usuario.perfil }, segredoDoServidor(), { expiresIn: '2m' });
}

async function api(chave: ChaveAtiva, metodo: 'GET' | 'POST' | 'PUT', caminho: string, corpo?: unknown): Promise<unknown> {
  const porta = Number(process.env.PORT ?? 3000);
  const resposta = await fetch(`http://127.0.0.1:${porta}/api${caminho}`, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${await tokenInterno()}`,
      'X-Perfil': String(chave.perfilId),
      'User-Agent': `MCP (${chave.nome.slice(0, 40)})`,
      ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const dados = (await resposta.json().catch(() => null)) as { erro?: string } | null;
  if (!resposta.ok) throw new ErroDaFerramenta(dados?.erro ?? `A consulta falhou (${resposta.status}).`);
  return dados;
}

function consulta(parametros: Record<string, string | number | undefined>): string {
  const pares = Object.entries(parametros).filter(([, v]) => v !== undefined && v !== '');
  return pares.length === 0 ? '' : '?' + pares.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
}

// ---------- Ferramentas ----------

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD');
const meses = z.union([z.literal(6), z.literal(12), z.literal(24), z.literal(60), z.literal(0)]).optional();

interface Ferramenta {
  nome: string;
  titulo: string;
  descricao: string;
  escrita: boolean;
  entrada: z.ZodObject<z.ZodRawShape>;
  esquema: Record<string, unknown>; // JSON Schema de `entrada`
  executar(chave: ChaveAtiva, argumentos: Record<string, unknown>): Promise<unknown>;
}

function objeto(propriedades: Record<string, unknown>, obrigatorios: string[] = []): Record<string, unknown> {
  return { type: 'object', properties: propriedades, required: obrigatorios, additionalProperties: false };
}

const P_MESES = { type: 'integer', enum: [6, 12, 24, 60, 0], description: 'Janela em meses; 0 = desde o início. Padrão 24.' };
const P_DATA = (descricao: string) => ({ type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: descricao + ' (AAAA-MM-DD)' });

const FERRAMENTAS: Ferramenta[] = [
  {
    nome: 'visao_geral',
    titulo: 'Visão geral',
    descricao: 'Patrimônio total, saldo de cada conta e dívida de cada cartão. Valores em reais. Comece por aqui.',
    escrita: false,
    entrada: z.object({}),
    esquema: objeto({}),
    async executar(chave) {
      const [totais, contas] = await Promise.all([api(chave, 'GET', '/contas/resumo'), api(chave, 'GET', '/contas')]);
      return { totais, contas };
    },
  },
  {
    nome: 'listar_lancamentos',
    titulo: 'Listar lançamentos',
    descricao:
      'Receitas e despesas (inclui compras no cartão). Filtre por período, texto da descrição, conta, categoria ou tipo. Devolve até 200 por página, do mais recente para o mais antigo, com o total e as somas do filtro.',
    escrita: false,
    entrada: z.object({
      de: data.optional(),
      ate: data.optional(),
      busca: z.string().max(100).optional(),
      contaId: z.number().int().positive().optional(),
      categoriaId: z.number().int().min(0).optional(),
      tipo: z.enum(['RECEITA', 'DESPESA']).optional(),
      pagina: z.number().int().min(1).max(1000).optional(),
      porPagina: z.number().int().min(1).max(200).optional(),
    }),
    esquema: objeto({
      de: P_DATA('Data inicial'),
      ate: P_DATA('Data final'),
      busca: { type: 'string', description: 'Trecho da descrição' },
      contaId: { type: 'integer', description: 'Id da conta ou do cartão (veja visao_geral)' },
      categoriaId: { type: 'integer', description: 'Id da categoria (veja listar_categorias); 0 = sem categoria' },
      tipo: { type: 'string', enum: ['RECEITA', 'DESPESA'] },
      pagina: { type: 'integer', minimum: 1 },
      porPagina: { type: 'integer', minimum: 1, maximum: 200, description: 'Padrão 50' },
    }),
    executar: (chave, a) => api(chave, 'GET', '/transacoes' + consulta(a as Record<string, string | number | undefined>)),
  },
  {
    nome: 'listar_categorias',
    titulo: 'Listar categorias',
    descricao: 'Categorias de receita e de despesa, com o id usado nos outros comandos.',
    escrita: false,
    entrada: z.object({}),
    esquema: objeto({}),
    executar: (chave) => api(chave, 'GET', '/categorias'),
  },
  {
    nome: 'analise_de_gastos',
    titulo: 'Análise de gastos e receitas',
    descricao:
      'Receitas e gastos mês a mês, por categoria e por estabelecimento, gastos que se repetem, parcelas a vencer e sugestões calculadas pelo sistema.',
    escrita: false,
    entrada: z.object({ meses: z.union([z.literal(3), z.literal(6), z.literal(12), z.literal(24)]).optional() }),
    esquema: objeto({ meses: { type: 'integer', enum: [3, 6, 12, 24], description: 'Padrão 12' } }),
    executar: (chave, a) => api(chave, 'GET', '/analise' + consulta({ meses: a.meses as number | undefined })),
  },
  {
    nome: 'cartoes_e_faturas',
    titulo: 'Cartões e faturas',
    descricao: 'Cada cartão com a fatura em aberto, as últimas faturas e a previsão das próximas com as parcelas que ainda vão ser cobradas.',
    escrita: false,
    entrada: z.object({}),
    esquema: objeto({}),
    async executar(chave) {
      const [cartoes, faturas, previsao] = await Promise.all([
        api(chave, 'GET', '/cartoes'),
        api(chave, 'GET', '/faturas'),
        api(chave, 'GET', '/cartoes/previsao'),
      ]);
      return { cartoes, faturas, proximasFaturas: previsao };
    },
  },
  {
    nome: 'investimentos',
    titulo: 'Investimentos',
    descricao: 'Lista dos investimentos atuais: tipo, quantidade, valor aplicado, saldo de hoje e rentabilidade simples.',
    escrita: false,
    entrada: z.object({}),
    esquema: objeto({}),
    executar: (chave) => api(chave, 'GET', '/investimentos'),
  },
  {
    nome: 'carteira',
    titulo: 'Rentabilidade da carteira',
    descricao:
      'Rentabilidade da carteira (ponderada pelo tempo, com proventos) no mês, em 6 e 12 meses, no ano e desde o início, comparada com CDI, Ibovespa, IPCA e IFIX; meses, anos, melhores e piores períodos, divisão por classe e por instituição, e cada ativo com % do CDI. Percentuais em %.',
    escrita: false,
    entrada: z.object({ meses, classe: z.enum(['RENDA_VARIAVEL', 'RENDA_FIXA', 'FUNDOS', 'OUTROS']).optional() }),
    esquema: objeto({ meses: P_MESES, classe: { type: 'string', enum: ['RENDA_VARIAVEL', 'RENDA_FIXA', 'FUNDOS', 'OUTROS'], description: 'Opcional: só uma classe' } }),
    async executar(chave, a) {
      const dados = (await api(chave, 'GET', '/carteira' + consulta({ meses: a.meses as number | undefined, classe: a.classe as string | undefined }))) as Record<string, unknown>;
      // A série dia a dia é grande demais para uma conversa; os meses e os anos já contam a história.
      const { diario: _diario, ...resto } = dados;
      return resto;
    },
  },
  {
    nome: 'proventos',
    titulo: 'Proventos',
    descricao:
      'Dividendos e rendimentos recebidos: total, média mensal, histórico por mês, por ativo e rendimento sobre o custo; e a agenda dos próximos 12 meses. Os itens "PREVISTO" são estimativas pelo histórico, não datas anunciadas.',
    escrita: false,
    entrada: z.object({ meses }),
    esquema: objeto({ meses: P_MESES }),
    async executar(chave, a) {
      const dados = (await api(chave, 'GET', '/carteira/proventos' + consulta({ meses: a.meses as number | undefined }))) as {
        mapa?: unknown;
        agenda?: { itens?: { situacao: string }[] };
      };
      const { mapa: _mapa, ...resto } = dados;
      if (resto.agenda?.itens) resto.agenda.itens = resto.agenda.itens.filter((i) => i.situacao === 'PREVISTO').slice(0, 120);
      return resto;
    },
  },
  {
    nome: 'comparar_com_indices',
    titulo: 'Carteira contra os índices',
    descricao:
      'Quanto os mesmos aportes e retiradas, nas mesmas datas, valeriam hoje na Selic, no IPCA, no Ibovespa e no IFIX; renda fixa estimada pela taxa; e uma projeção mecânica de 12 meses (não é previsão).',
    escrita: false,
    entrada: z.object({}),
    esquema: objeto({}),
    executar: (chave) => api(chave, 'GET', '/rendimento'),
  },
  {
    nome: 'orcamento_e_metas',
    titulo: 'Orçamento e metas',
    descricao: 'Limite e gasto de cada categoria no mês (padrão: mês atual) e o andamento das metas.',
    escrita: false,
    entrada: z.object({ mes: z.string().regex(/^\d{4}-\d{2}$/).optional() }),
    esquema: objeto({ mes: { type: 'string', pattern: '^\\d{4}-\\d{2}$', description: 'AAAA-MM' } }),
    async executar(chave, a) {
      const [orcamentos, metas] = await Promise.all([
        api(chave, 'GET', '/orcamentos' + consulta({ mes: a.mes as string | undefined })),
        api(chave, 'GET', '/metas'),
      ]);
      return { orcamentos, metas };
    },
  },
  {
    nome: 'criar_lancamento',
    titulo: 'Criar lançamento',
    descricao:
      'Registra uma receita ou despesa em uma conta ou cartão. Confirme com a pessoa a conta, o valor e a data antes de chamar. Use contaId de visao_geral e categoriaId de listar_categorias.',
    escrita: true,
    entrada: z.object({
      contaId: z.number().int().positive(),
      data,
      descricao: z.string().trim().min(1).max(120),
      valor: z.number().positive().max(999999999),
      tipo: z.enum(['RECEITA', 'DESPESA']),
      categoriaId: z.number().int().positive().optional(),
      totalParcelas: z.number().int().min(2).max(48).optional(),
      observacao: z.string().max(300).optional(),
    }),
    esquema: objeto(
      {
        contaId: { type: 'integer', description: 'Id da conta ou do cartão' },
        data: P_DATA('Data do lançamento'),
        descricao: { type: 'string', maxLength: 120 },
        valor: { type: 'number', exclusiveMinimum: 0, description: 'Sempre positivo, em reais' },
        tipo: { type: 'string', enum: ['RECEITA', 'DESPESA'] },
        categoriaId: { type: 'integer' },
        totalParcelas: { type: 'integer', minimum: 2, maximum: 48, description: 'Só para compra parcelada no cartão; valor = o de cada parcela' },
        observacao: { type: 'string', maxLength: 300 },
      },
      ['contaId', 'data', 'descricao', 'valor', 'tipo']
    ),
    executar: (chave, a) => api(chave, 'POST', '/transacoes', { ...a, observacao: a.observacao ?? 'Lançado por IA (MCP)' }),
  },
  {
    nome: 'categorizar_lancamento',
    titulo: 'Categorizar lançamento',
    descricao: 'Muda a categoria de um lançamento que já existe. Use null em categoriaId para deixar sem categoria.',
    escrita: true,
    entrada: z.object({ id: z.number().int().positive(), categoriaId: z.number().int().positive().nullable() }),
    esquema: objeto({ id: { type: 'integer', description: 'Id do lançamento' }, categoriaId: { type: ['integer', 'null'] } }, ['id', 'categoriaId']),
    executar: (chave, a) => api(chave, 'PUT', `/transacoes/${Number(a.id)}`, { categoriaId: a.categoriaId }),
  },
];

function ferramentasDa(chave: ChaveAtiva): Ferramenta[] {
  return FERRAMENTAS.filter((f) => !f.escrita || chave.permissao === 'ESCRITA');
}

// ---------- JSON-RPC ----------

interface Pedido {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

type Resposta = { jsonrpc: '2.0'; id: unknown; result: unknown } | { jsonrpc: '2.0'; id: unknown; error: { code: number; message: string } };

function erro(id: unknown, code: number, message: string): Resposta {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

// Trata uma mensagem. Devolve null para notificações (que não têm resposta).
export async function tratarMensagem(chave: ChaveAtiva, mensagem: unknown): Promise<Resposta | null> {
  if (mensagem === null || typeof mensagem !== 'object' || Array.isArray(mensagem)) return erro(null, -32600, 'Pedido inválido');
  const pedido = mensagem as Pedido;
  if (pedido.jsonrpc !== '2.0' || typeof pedido.method !== 'string') return erro(pedido.id, -32600, 'Pedido inválido');
  const notificacao = pedido.id === undefined || pedido.id === null;
  if (notificacao) return null;
  const id = pedido.id;
  const parametros = (pedido.params !== null && typeof pedido.params === 'object' ? pedido.params : {}) as Record<string, unknown>;

  switch (pedido.method) {
    case 'initialize': {
      const pedida = typeof parametros.protocolVersion === 'string' ? parametros.protocolVersion : '';
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: VERSOES_DO_PROTOCOLO.includes(pedida) ? pedida : VERSOES_DO_PROTOCOLO[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'financas-pessoais', title: 'Finanças Pessoais', version: '1.0.0' },
          instructions:
            'Dados financeiros pessoais de quem está conversando: contas, cartões, faturas, lançamentos, investimentos e proventos. ' +
            'Valores em reais (BRL) e datas em AAAA-MM-DD. Comece por visao_geral. Descreva os dados; não recomende comprar ou vender ativos. ' +
            (chave.permissao === 'ESCRITA'
              ? 'Esta chave pode criar e categorizar lançamentos: confirme com a pessoa antes de gravar.'
              : 'Esta chave é só de consulta.'),
        },
      };
    }
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };
    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: ferramentasDa(chave).map((f) => ({
            name: f.nome,
            title: f.titulo,
            description: f.descricao,
            inputSchema: f.esquema,
            annotations: { title: f.titulo, readOnlyHint: !f.escrita, destructiveHint: false, idempotentHint: !f.escrita, openWorldHint: false },
          })),
        },
      };
    case 'tools/call': {
      const ferramenta = ferramentasDa(chave).find((f) => f.nome === parametros.name);
      if (!ferramenta) return erro(id, -32602, 'Ferramenta desconhecida ou não permitida para esta chave');
      const entrada = ferramenta.entrada.strict().safeParse(parametros.arguments ?? {});
      if (!entrada.success) {
        const detalhe = entrada.error.issues.map((i) => `${i.path.join('.') || 'argumentos'}: ${i.message}`).join('; ');
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'Argumentos inválidos. ' + detalhe }], isError: true } };
      }
      try {
        const resultado = await ferramenta.executar(chave, entrada.data as Record<string, unknown>);
        let texto = JSON.stringify(resultado);
        if (texto.length > LIMITE_DE_TEXTO) {
          // Grande demais para uma conversa: devolve um JSON válido que diz isso, em vez de um JSON cortado no meio.
          texto = JSON.stringify({
            aviso: 'Resposta grande demais; abaixo vai só o começo, como texto. Refaça a consulta com filtros (período menor, página, contaId, categoriaId).',
            comeco: texto.slice(0, LIMITE_DE_TEXTO - 2000),
          });
        }
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: texto }] } };
      } catch (e) {
        const mensagemDeErro = e instanceof ErroDaFerramenta ? e.message : 'A ferramenta falhou.';
        if (!(e instanceof ErroDaFerramenta)) console.error('MCP:', e instanceof Error ? e.message : e);
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: mensagemDeErro }], isError: true } };
      }
    }
    default:
      return erro(id, -32601, 'Método não suportado');
  }
}

export function listaDeFerramentas(): { nome: string; titulo: string; descricao: string; escrita: boolean }[] {
  return FERRAMENTAS.map((f) => ({ nome: f.nome, titulo: f.titulo, descricao: f.descricao, escrita: f.escrita }));
}
