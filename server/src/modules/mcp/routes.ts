import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { prismaSemPerfil as db, perfilAtual } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { textoCurto } from '../../lib/financas';
import { buscarChave, listaDeFerramentas, novaChave, tratarMensagem } from '../../lib/mcp';
import type { ChaveAtiva } from '../../lib/mcp';

// MCP: ponto de acesso para assistentes de IA (rotas públicas, protegidas pela chave) e o cadastro das chaves
// (rotas autenticadas). O protocolo e as ferramentas estão em lib/mcp.ts.

// ---------- Ponto de acesso (sem login; a chave é a credencial) ----------

export const publico = Router();

const JANELA_MS = 60 * 1000;
const LIMITE_POR_CHAVE = 120; // chamadas por minuto
const LIMITE_DE_FALHAS = 20; // chaves erradas por minuto, por endereço
const contagem = new Map<string, { inicio: number; n: number }>();

function passou(chave: string, limite: number, peso = 1): boolean {
  const agora = Date.now();
  const atual = contagem.get(chave);
  if (!atual || agora - atual.inicio > JANELA_MS) {
    contagem.set(chave, { inicio: agora, n: peso });
    return peso <= limite;
  }
  atual.n += peso;
  return atual.n <= limite;
}

setInterval(() => {
  const agora = Date.now();
  for (const [k, v] of contagem) if (agora - v.inicio > JANELA_MS) contagem.delete(k);
}, JANELA_MS).unref();

async function autenticarChave(req: Request, res: Response): Promise<ChaveAtiva | null> {
  const origem = `falha:${req.ip ?? 'desconhecido'}`;
  // A chave vem no cabeçalho (Authorization: Bearer fin_...) ou, para aplicativos que só aceitam um endereço,
  // no fim do caminho (/api/mcp/fin_...).
  const cabecalho = req.headers.authorization ?? '';
  const texto = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7).trim() : typeof req.params.chave === 'string' ? req.params.chave : '';
  const chave = texto ? await buscarChave(texto) : null;
  if (!chave) {
    // Muitas chaves erradas do mesmo endereço: para de responder por um minuto. Quem tem chave válida não é afetado.
    if (!passou(origem, LIMITE_DE_FALHAS)) {
      res.status(429).json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Muitas tentativas. Aguarde um minuto.' } });
      return null;
    }
    res.status(401).set('WWW-Authenticate', 'Bearer').json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Chave de acesso ausente ou inválida.' } });
    return null;
  }
  const mensagens = Array.isArray(req.body) ? Math.max(1, req.body.length) : 1;
  if (!passou(`chave:${chave.id}`, LIMITE_POR_CHAVE, mensagens)) {
    res.status(429).json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Limite de chamadas por minuto atingido.' } });
    return null;
  }
  return chave;
}

const receber = asyncHandler(async (req, res) => {
  const chave = await autenticarChave(req, res);
  if (!chave) return;
  const corpo: unknown = req.body;
  if (Array.isArray(corpo)) {
    if (corpo.length === 0 || corpo.length > 20) {
      res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Lote inválido' } });
      return;
    }
    const respostas = [];
    for (const mensagem of corpo) {
      const resposta = await tratarMensagem(chave, mensagem);
      if (resposta) respostas.push(resposta);
    }
    if (respostas.length === 0) res.status(202).end();
    else res.json(respostas);
    return;
  }
  const resposta = await tratarMensagem(chave, corpo);
  if (resposta === null) res.status(202).end();
  else res.json(resposta);
});

// Este servidor não abre fluxo de eventos nem guarda sessão: só POST.
const semFluxo = (_req: Request, res: Response): void => {
  res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Use POST.' } });
};

publico.post('/mcp', receber);
publico.get('/mcp', semFluxo);
publico.delete('/mcp', semFluxo);
// `chaves` é a rota de cadastro (autenticada, mais abaixo): não é uma chave.
publico.post('/mcp/:chave(fin_[A-Za-z0-9_-]+)', receber);
publico.get('/mcp/:chave(fin_[A-Za-z0-9_-]+)', semFluxo);
publico.delete('/mcp/:chave(fin_[A-Za-z0-9_-]+)', semFluxo);

// ---------- Cadastro das chaves (tela "Conectar IA") ----------

const router = Router();

const criarSchema = z.object({ nome: textoCurto, permissao: z.enum(['LEITURA', 'ESCRITA']) });

function chaveDTO(c: { id: number; nome: string; prefixo: string; permissao: string; perfilId: number; criadoEm: Date; ultimoUsoEm: Date | null; usos: number }) {
  return {
    id: c.id,
    nome: c.nome,
    prefixo: c.prefixo,
    permissao: c.permissao === 'ESCRITA' ? 'ESCRITA' : 'LEITURA',
    criadoEm: c.criadoEm.toISOString(),
    ultimoUsoEm: c.ultimoUsoEm ? c.ultimoUsoEm.toISOString() : null,
    usos: c.usos,
  };
}

// Chaves do perfil financeiro em uso (cada chave enxerga só o perfil em que foi criada) e as ferramentas oferecidas.
router.get(
  '/mcp/chaves',
  asyncHandler(async (_req, res) => {
    const chaves = await db.chaveMcp.findMany({ where: { perfilId: perfilAtual() ?? 1 }, orderBy: { id: 'desc' } });
    res.json({ chaves: chaves.map(chaveDTO), ferramentas: listaDeFerramentas() });
  })
);

// Cria uma chave. O texto completo aparece só nesta resposta: o banco guarda apenas o hash.
router.post(
  '/mcp/chaves',
  asyncHandler(async (req, res) => {
    const dados = validar(criarSchema, req.body);
    const perfilId = perfilAtual() ?? 1;
    if ((await db.chaveMcp.count({ where: { perfilId } })) >= 20) throw new HttpError(400, 'O limite é de 20 chaves por perfil');
    const { chave, hash, prefixo } = novaChave();
    const criada = await db.chaveMcp.create({ data: { nome: dados.nome, permissao: dados.permissao, perfilId, hash, prefixo } });
    res.status(201).json({ ...chaveDTO(criada), chave });
  })
);

router.delete(
  '/mcp/chaves/:id',
  asyncHandler(async (req, res) => {
    const apagadas = await db.chaveMcp.deleteMany({ where: { id: idParam(req), perfilId: perfilAtual() ?? 1 } });
    if (apagadas.count === 0) throw new HttpError(404, 'Chave não encontrada');
    res.status(204).end();
  })
);

export default router;
