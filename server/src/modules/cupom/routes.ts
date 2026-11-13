import { Router } from 'express';
import { z } from 'zod';
import Anthropic, { APIConnectionError, APIError, AuthenticationError, BadRequestError, PermissionDeniedError, RateLimitError } from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, validar } from '../../lib/erros';
import { cifrar, decifrar } from '../../lib/cripto';
import { permitir } from '../../lib/auth';
import { arredondar } from '../../lib/financas';

// Leitura de cupom por foto: a imagem vai à API da Anthropic, que devolve total, data, estabelecimento e
// a categoria mais provável (entre as de despesa do perfil). Nada é lançado aqui: o cliente confere e grava.
// A chave fica cifrada no banco (ConfiguracaoPlataforma.anthropicChaveCifrada); se não houver, vale ANTHROPIC_API_KEY.
// A chave nunca é devolvida, registrada em log nem colocada em mensagem de erro.

const router = Router();

const MODELOS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] as const;
const MODELO_PADRAO = 'claude-opus-5-5';
const TIPOS_IMAGEM = ['image/jpeg', 'image/png', 'image/webp'] as const;
const LIMITE_BYTES = 5 * 1024 * 1024;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

// Formato que o modelo deve devolver (saída estruturada).
const leituraSchema = z.object({
  total: z.number().nullable(),
  data: z.string().nullable(),
  estabelecimento: z.string().nullable(),
  categoria: z.string().nullable(),
  itens: z.number().int().nullable(),
});

const leituraEntradaSchema = z.object({
  imagem: z.string().min(1),
  tipo: z.enum(TIPOS_IMAGEM),
});

// Gravar a chave e/ou o modelo. Sem `chave`, só troca o modelo.
const configuracaoSchema = z
  .object({
    chave: z.string().trim().min(10).max(300).optional(),
    modelo: z.enum(MODELOS).optional(),
  })
  .refine((d) => d.chave !== undefined || d.modelo !== undefined, { message: 'Informe a chave ou o modelo' });

interface ConfigCupom {
  chave: string | null;
  origem: 'sistema' | 'ambiente' | null;
  modelo: (typeof MODELOS)[number];
}

// Lê a chave (banco primeiro, depois o ambiente) e o modelo. Nunca devolve a chave para fora daqui.
async function lerConfig(): Promise<ConfigCupom> {
  const config = await prisma.configuracaoPlataforma.findUnique({
    where: { id: 1 },
    select: { anthropicChaveCifrada: true, anthropicModelo: true },
  });
  const modelo = (MODELOS as readonly string[]).includes(config?.anthropicModelo ?? '')
    ? (config?.anthropicModelo as (typeof MODELOS)[number])
    : MODELO_PADRAO;
  if (config?.anthropicChaveCifrada) {
    const chave = decifrar(config.anthropicChaveCifrada);
    if (chave) return { chave, origem: 'sistema', modelo };
  }
  const doAmbiente = (process.env.ANTHROPIC_API_KEY ?? '').trim();
  if (doAmbiente) return { chave: doAmbiente, origem: 'ambiente', modelo };
  return { chave: null, origem: null, modelo };
}

function estadoDTO(c: ConfigCupom) {
  return { configurada: c.chave !== null, origem: c.origem, modelo: c.modelo };
}

function dataValida(texto: string): boolean {
  if (!DATA_ISO.test(texto)) return false;
  const d = new Date(`${texto}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === texto;
}

// Traduz os erros do SDK em mensagens para a pessoa. Não inclui a chave em nenhum texto.
function erroDaApi(erro: unknown): HttpError | null {
  if (erro instanceof AuthenticationError) return new HttpError(400, 'Chave da API inválida. Confira a chave configurada.');
  if (erro instanceof PermissionDeniedError) return new HttpError(403, 'Esta chave não tem permissão para usar a leitura de cupons.');
  if (erro instanceof RateLimitError) return new HttpError(429, 'Limite de uso da API atingido. Tente de novo em instantes.');
  if (erro instanceof BadRequestError) return new HttpError(400, 'A API não conseguiu ler esta imagem. Tente outra foto, mais nítida.');
  if (erro instanceof APIConnectionError) return new HttpError(502, 'Não consegui falar com a API da Anthropic. Verifique a conexão do servidor.');
  if (erro instanceof APIError) return new HttpError(502, 'A API da Anthropic falhou ao ler o cupom. Tente de novo.');
  return null;
}

router.get(
  '/cupom/estado',
  asyncHandler(async (_req, res) => {
    res.json(estadoDTO(await lerConfig()));
  })
);

// Só o titular grava. Grava a chave cifrada (mesmo cifrar usado no token da brapi) e/ou o modelo.
router.put(
  '/cupom/chave',
  permitir('TITULAR'),
  asyncHandler(async (req, res) => {
    const dados = validar(configuracaoSchema, req.body);
    const gravar: { anthropicChaveCifrada?: string; anthropicModelo?: string } = {};
    if (dados.chave !== undefined) gravar.anthropicChaveCifrada = cifrar(dados.chave);
    if (dados.modelo !== undefined) gravar.anthropicModelo = dados.modelo;
    await prisma.configuracaoPlataforma.upsert({ where: { id: 1 }, create: { id: 1, ...gravar }, update: gravar });
    res.json(estadoDTO(await lerConfig()));
  })
);

// Só o titular apaga a chave guardada no banco. A do ambiente (ANTHROPIC_API_KEY) não é mexida aqui.
router.delete(
  '/cupom/chave',
  permitir('TITULAR'),
  asyncHandler(async (_req, res) => {
    await prisma.configuracaoPlataforma.updateMany({ where: { id: 1 }, data: { anthropicChaveCifrada: null } });
    res.json(estadoDTO(await lerConfig()));
  })
);

router.post(
  '/cupom/ler',
  asyncHandler(async (req, res) => {
    const config = await lerConfig();
    if (config.chave === null) throw new HttpError(400, 'Configure a chave da API');

    const dados = validar(leituraEntradaSchema, req.body);
    if (!BASE64.test(dados.imagem)) throw new HttpError(400, 'Imagem inválida');
    if (Buffer.byteLength(dados.imagem, 'base64') > LIMITE_BYTES) throw new HttpError(400, 'A imagem passa de 5 MB');

    // Categorias de despesa do perfil atual (o filtro por perfil é automático).
    const categorias = await prisma.categoria.findMany({
      where: { tipo: 'DESPESA' },
      select: { nome: true },
      orderBy: { nome: 'asc' },
    });
    const nomes = categorias.map((c) => c.nome);
    const listaCategorias = nomes.length > 0 ? nomes.join(', ') : '(nenhuma)';

    const instrucao =
      'Leia este cupom fiscal ou recibo de compra e responda somente com os campos pedidos. ' +
      'total: valor total pago, em reais, como número (ex.: 42.9). ' +
      'data: data da compra no formato AAAA-MM-DD. ' +
      'estabelecimento: nome da loja. ' +
      `categoria: a categoria de gasto mais provável, escolhida somente entre estas: ${listaCategorias}. Se nenhuma servir, use null. ` +
      'itens: quantidade de itens comprados. ' +
      'Não invente valores: se não estiver legível, use null.';

    const cliente = new Anthropic({ apiKey: config.chave, timeout: 60_000, maxRetries: 2 });

    let resposta;
    try {
      resposta = await cliente.messages.parse({
        model: config.modelo,
        max_tokens: 1024,
        output_config: { format: zodOutputFormat(leituraSchema) },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: dados.tipo, data: dados.imagem } },
              { type: 'text', text: instrucao },
            ],
          },
        ],
      });
    } catch (erro) {
      throw erroDaApi(erro) ?? erro;
    }

    if (resposta.stop_reason === 'refusal') throw new HttpError(422, 'A leitura do cupom foi recusada. Tente outra foto.');
    const lido = resposta.parsed_output;
    if (!lido) throw new HttpError(422, 'Não consegui ler os dados do cupom. Tente outra foto, mais nítida.');

    const valor = lido.total !== null && Number.isFinite(lido.total) && lido.total > 0 ? arredondar(lido.total) : null;
    const data = lido.data !== null && dataValida(lido.data.trim()) ? lido.data.trim() : null;
    const estabelecimento = lido.estabelecimento?.trim().slice(0, 120) || null;
    const sugerida = lido.categoria?.trim().toLowerCase();
    const categoriaSugerida = sugerida ? (nomes.find((n) => n.toLowerCase() === sugerida) ?? null) : null;
    const itens = lido.itens !== null && Number.isInteger(lido.itens) && lido.itens >= 0 ? lido.itens : 0;

    res.json({ valor, data, estabelecimento, categoriaSugerida, itens });
  })
);

export default router;
