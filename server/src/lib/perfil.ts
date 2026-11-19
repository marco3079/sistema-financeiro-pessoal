// Perfis financeiros: qual perfil vale em cada requisição e como rodar tarefas de fundo em todos.
// O navegador manda o perfil escolhido no cabeçalho X-Perfil; sem ele (ou com um perfil que não existe mais ou que o
// membro não acessa), vale o primeiro perfil liberado. O filtro dos dados é aplicado em lib/prisma.ts.

import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import { comPerfil, prisma } from './prisma';
import { caminhoDaRequisicao, METODOS_DE_LEITURA, pertenceA, segredoDoServidor } from './auth';
import type { UsuarioToken } from './auth';
import { criarCategoriasPadrao } from '../../prisma/categorias-padrao';

let conhecidos: number[] | null = null;
// Perfis com senha: id -> impressão da senha atual (muda quando a senha muda e invalida os desbloqueios antigos).
let protegidos = new Map<number, string>();

// Esquece a lista guardada (chame depois de criar ou apagar um perfil, ou de mudar a senha de um).
export function esquecerPerfis(): void {
  conhecidos = null;
}

function impressaoDaSenha(senhaHash: string): string {
  return crypto.createHash('sha256').update('senha-do-perfil:' + senhaHash, 'utf8').digest('hex').slice(0, 16);
}

// Ids dos perfis, do mais antigo para o mais novo. Cria o perfil "Pessoal" se o banco ainda não tiver nenhum.
export async function idsDosPerfis(): Promise<number[]> {
  if (conhecidos) return conhecidos;
  const ler = () =>
    prisma.perfilFinanceiro.findMany({ select: { id: true, senhaHash: true }, orderBy: { id: 'asc' } });
  let perfis = await ler();
  if (perfis.length === 0) {
    // O primeiro perfil precisa ser o de id 1: é o valor padrão da coluna perfilId dos registros que já existiam.
    await prisma.perfilFinanceiro.createMany({ data: [{ id: 1, nome: 'Pessoal' }], skipDuplicates: true });
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('"PerfilFinanceiro"', 'id'), GREATEST((SELECT MAX(id) FROM "PerfilFinanceiro"), 1))`
    );
    perfis = await ler();
  }
  const comSenha = new Map<number, string>();
  for (const p of perfis) {
    if (p.senhaHash) comSenha.set(p.id, impressaoDaSenha(p.senhaHash));
  }
  protegidos = comSenha;
  conhecidos = perfis.map((p) => p.id);
  return conhecidos;
}

// ---------- Acessos dos membros (LEITOR) ----------

// ADMIN = titular (todos os perfis). EDICAO e LEITURA = nível do membro no perfil.
export type NivelEfetivo = 'ADMIN' | 'EDICAO' | 'LEITURA';
type NivelMembro = 'EDICAO' | 'LEITURA';

// Perfis que cada membro acessa (cache de 30 s por usuário).
const CACHE_ACESSO_MS = 30_000;
const acessosGuardados = new Map<number, { acessos: Map<number, NivelMembro>; expira: number }>();

// Esquece os acessos guardados (chame depois de mudar o papel ou os acessos de um usuário).
export function esquecerAcessos(): void {
  acessosGuardados.clear();
}
// Nome antigo, mantido para quem já chamava.
export const esquecerVinculosLeitor = esquecerAcessos;

// Acessos do membro. O vínculo antigo (Usuario.perfilFinanceiroId: um perfil só, leitura) vira uma linha de
// AcessoPerfil na primeira consulta.
export async function acessosDoMembro(usuarioId: number): Promise<Map<number, NivelMembro>> {
  const agora = Date.now();
  const guardado = acessosGuardados.get(usuarioId);
  if (guardado && guardado.expira > agora) return guardado.acessos;
  const ler = () => prisma.acessoPerfil.findMany({ where: { usuarioId }, orderBy: { perfilFinanceiroId: 'asc' } });
  let linhas = await ler();
  if (linhas.length === 0) {
    const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId }, select: { perfilFinanceiroId: true } });
    const antigo = usuario?.perfilFinanceiroId ?? null;
    if (antigo !== null) {
      const existe = await prisma.perfilFinanceiro.findUnique({ where: { id: antigo }, select: { id: true } });
      if (existe) {
        await prisma.acessoPerfil.createMany({
          data: [{ usuarioId, perfilFinanceiroId: antigo, nivel: 'LEITURA' }],
          skipDuplicates: true,
        });
      }
      await prisma.usuario.update({ where: { id: usuarioId }, data: { perfilFinanceiroId: null } });
      linhas = await ler();
    }
  }
  const acessos = new Map<number, NivelMembro>(linhas.map((l) => [l.perfilFinanceiroId, l.nivel]));
  acessosGuardados.set(usuarioId, { acessos, expira: agora + CACHE_ACESSO_MS });
  return acessos;
}

// Nível do usuário em um perfil (null = sem acesso). Titular: ADMIN em todos.
export async function nivelNoPerfil(usuario: UsuarioToken, perfilId: number): Promise<NivelEfetivo | null> {
  const ids = await idsDosPerfis();
  if (!ids.includes(perfilId)) return null;
  if (usuario.perfil === 'TITULAR') return 'ADMIN';
  return (await acessosDoMembro(usuario.id)).get(perfilId) ?? null;
}

// Quem gerencia os acessos e a senha de um perfil: titulares e membros com nível Edição nele.
export async function podeGerenciarPerfil(usuario: UsuarioToken, perfilId: number): Promise<boolean> {
  const nivel = await nivelNoPerfil(usuario, perfilId);
  return nivel === 'ADMIN' || nivel === 'EDICAO';
}

// ---------- Senha do perfil ----------

// Depois que a senha confere, o navegador guarda um "desbloqueio" do perfil e manda todos no cabeçalho
// X-Perfil-Desbloqueio, separados por vírgula. Cada um vale até o fim do login (no máximo 12 h) e deixa de valer
// quando a senha do perfil muda. Vale para todos, inclusive titulares.

export function perfilProtegido(perfilId: number): boolean {
  return protegidos.has(perfilId);
}

export function gerarDesbloqueio(usuario: UsuarioToken, perfilId: number): string | null {
  const impressao = protegidos.get(perfilId);
  if (!impressao) return null;
  const agora = Math.floor(Date.now() / 1000);
  const fim = Math.min(usuario.expira ?? agora + 12 * 3600, agora + 12 * 3600);
  return jwt.sign({ t: 'desbloqueio', u: usuario.id, p: perfilId, v: impressao }, segredoDoServidor(), {
    expiresIn: Math.max(fim - agora, 60),
  });
}

// Perfis protegidos que esta requisição já desbloqueou.
export function desbloqueiosDaRequisicao(req: Request): Set<number> {
  if (req.desbloqueios) return req.desbloqueios;
  const validos = new Set<number>();
  const bruto = req.header('x-perfil-desbloqueio') ?? '';
  const tokens = bruto
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 30);
  for (const token of tokens) {
    try {
      const dados = jwt.verify(token, segredoDoServidor()) as jwt.JwtPayload;
      const perfilId = Number(dados.p);
      if (dados.t === 'desbloqueio' && dados.u === req.usuario?.id && protegidos.get(perfilId) === dados.v) {
        validos.add(perfilId);
      }
    } catch {
      // desbloqueio vencido ou adulterado: o perfil continua bloqueado
    }
  }
  req.desbloqueios = validos;
  return validos;
}

export function perfilBloqueado(req: Request, perfilId: number): boolean {
  return perfilProtegido(perfilId) && !desbloqueiosDaRequisicao(req).has(perfilId);
}

// ---------- Middleware ----------

// Rotas que funcionam com o perfil bloqueado (ou sem perfil nenhum): sessão, segurança da conta, lista de perfis
// (sem os números dos bloqueados), desbloqueio, senha e acessos de um perfil, e meus dados.
function liberadaSemPerfil(metodo: string, caminho: string): boolean {
  if (pertenceA(caminho, '/api/auth') || pertenceA(caminho, '/api/seguranca')) return true;
  if (caminho === '/api/perfis' && metodo === 'GET') return true;
  if (caminho === '/api/perfil/meu') return true;
  return /^\/api\/perfis\/\d+\/(desbloquear|senha|acessos(\/\d+)?)$/.test(caminho);
}

// Escritas que o membro faz com qualquer nível: as próprias rotas conferem a permissão.
function escritaSempreDoMembro(caminho: string): boolean {
  if (caminho === '/api/auth/sair' || caminho === '/api/auth/trocar-senha') return true;
  if (pertenceA(caminho, '/api/seguranca/2fa')) return true;
  return /^\/api\/perfis\/\d+\/(desbloquear|senha|acessos(\/\d+)?)$/.test(caminho);
}

declare global {
  namespace Express {
    interface Request {
      // Perfil financeiro da requisição e o nível do usuário nele (calculado uma vez por requisição).
      acessoPerfil?: { perfilId: number; nivel: NivelEfetivo | null };
      desbloqueios?: Set<number>;
    }
  }
}

// Membro sem acesso a perfil nenhum: as consultas filtradas por um id que não existe não devolvem nada.
const PERFIL_NENHUM = -1;

async function decidirPerfil(req: Request): Promise<{ perfilId: number; nivel: NivelEfetivo | null }> {
  if (req.acessoPerfil) return req.acessoPerfil;
  const ids = await idsDosPerfis();
  const pedido = Number(req.header('x-perfil'));
  let escolha: { perfilId: number; nivel: NivelEfetivo | null };
  if (req.usuario?.perfil === 'LEITOR') {
    const acessos = await acessosDoMembro(req.usuario.id);
    const liberados = ids.filter((id) => acessos.has(id));
    const perfilId = liberados.includes(pedido) ? pedido : liberados[0] ?? PERFIL_NENHUM;
    escolha = { perfilId, nivel: acessos.get(perfilId) ?? null };
  } else {
    escolha = { perfilId: Number.isInteger(pedido) && ids.includes(pedido) ? pedido : ids[0], nivel: 'ADMIN' };
  }
  req.acessoPerfil = escolha;
  return escolha;
}

// Middleware das rotas autenticadas: põe o perfil da requisição no contexto, confere o nível do membro nas
// escritas e barra o perfil com senha que ainda não foi desbloqueado.
export function escolherPerfil(req: Request, res: Response, next: NextFunction): void {
  decidirPerfil(req)
    .then(async ({ perfilId, nivel }) => {
      const caminho = caminhoDaRequisicao(req);
      if (req.usuario?.perfil === 'LEITOR' && !METODOS_DE_LEITURA.includes(req.method)) {
        // Criar, renomear e apagar perfis fica com os titulares.
        const permitida =
          escritaSempreDoMembro(caminho) || (nivel === 'EDICAO' && !pertenceA(caminho, '/api/perfis'));
        if (!permitida) {
          res.status(403).json({ erro: 'Este acesso é só de leitura' });
          return;
        }
      }
      if (!liberadaSemPerfil(req.method, caminho)) {
        if (nivel === null) {
          res.status(403).json({ erro: 'Você ainda não tem acesso a nenhum perfil financeiro. Fale com o titular.' });
          return;
        }
        if (perfilBloqueado(req, perfilId)) {
          const perfil = await prisma.perfilFinanceiro.findUnique({
            where: { id: perfilId },
            select: { id: true, nome: true, cor: true },
          });
          res.status(423).json({ erro: 'Este perfil está protegido por senha', perfilBloqueado: perfil });
          return;
        }
      }
      comPerfil(perfilId, next);
    })
    .catch(next);
}

// Roda `fn` uma vez para cada perfil, em sequência (tarefas de fundo: cotações, índices).
export async function emCadaPerfil(fn: (perfilId: number) => Promise<unknown>): Promise<void> {
  for (const perfilId of await idsDosPerfis()) {
    await comPerfil(perfilId, () => fn(perfilId));
  }
}

// Cria um perfil já com as categorias padrão.
export async function criarPerfil(nome: string, cor: string): Promise<{ id: number; nome: string; cor: string; criadoEm: Date }> {
  await idsDosPerfis();
  const perfil = await prisma.perfilFinanceiro.create({ data: { nome, cor } });
  // Dentro do perfil novo: a requisição que cria o perfil ainda está no perfil antigo.
  await comPerfil(perfil.id, () => criarCategoriasPadrao(prisma, perfil.id));
  esquecerPerfis();
  return perfil;
}

// Apaga um perfil e tudo o que é dele.
export async function apagarPerfil(perfilId: number): Promise<void> {
  await comPerfil(perfilId, async () => {
    await prisma.$transaction(
      async (db) => {
        await db.divisao.deleteMany({});
        await db.eventoAtivo.deleteMany({});
        await db.avisoEnviado.deleteMany({});
        await db.pagamentoContaFixa.deleteMany({});
        await db.contaFixa.deleteMany({});
        await db.regraCategoria.deleteMany({});
        await db.automacao.deleteMany({});
        await db.alocacaoAlvo.deleteMany({});
        await db.orcamento.deleteMany({});
        await db.meta.deleteMany({});
        await db.movimentoInvestimento.deleteMany({});
        await db.investimento.deleteMany({});
        await db.transacao.deleteMany({});
        await db.fatura.deleteMany({});
        await db.conta.deleteMany({});
        await db.conexaoBancaria.deleteMany({});
        await db.categoria.deleteMany({});
        await db.posicaoPatrimonio.deleteMany({});
        await db.importacao.deleteMany({});
        await db.chaveMcp.deleteMany({ where: { perfilId } });
        await db.acessoPerfil.deleteMany({ where: { perfilFinanceiroId: perfilId } });
        await db.perfilFinanceiro.delete({ where: { id: perfilId } });
      },
      { timeout: 60000 }
    );
  });
  esquecerPerfis();
  esquecerAcessos();
}
