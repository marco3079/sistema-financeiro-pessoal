import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma, comPerfil, perfilAtual } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { permitir } from '../../lib/auth';
import { criarCategoriasPadrao } from '../../../prisma/categorias-padrao';
import { arredondar, corSchema, textoCurto, totaisPatrimonio } from '../../lib/financas';
import {
  acessosDoMembro,
  apagarPerfil,
  criarPerfil,
  desbloqueiosDaRequisicao,
  esquecerAcessos,
  esquecerPerfis,
  gerarDesbloqueio,
  idsDosPerfis,
  nivelNoPerfil,
  perfilProtegido,
  podeGerenciarPerfil,
} from '../../lib/perfil';
import type { NivelEfetivo } from '../../lib/perfil';

// Perfis financeiros ("Pessoal", "Empresa", "Casal"): cada um com as próprias contas, cartões, faturas,
// investimentos, categorias, orçamentos e metas. O navegador escolhe o perfil pelo cabeçalho X-Perfil.
// Titulares veem todos; membros (LEITOR), só os liberados em AcessoPerfil. Um perfil pode ter senha.

const router = Router();

const perfilSchema = z.object({ nome: textoCurto, cor: corSchema.optional(), tipo: z.enum(['PESSOAL', 'EMPRESA']).optional() });

router.get(
  '/perfis',
  asyncHandler(async (req, res) => {
    const atual = perfilAtual();
    const todos = await prisma.perfilFinanceiro.findMany({ orderBy: { id: 'asc' } });
    await idsDosPerfis();
    const desbloqueados = desbloqueiosDaRequisicao(req);
    const acessos = req.usuario.perfil === 'LEITOR' ? await acessosDoMembro(req.usuario.id) : null;
    // Membro: só os perfis liberados para ele.
    const perfis = acessos ? todos.filter((p) => acessos.has(p.id)) : todos;
    const lista = await Promise.all(
      perfis.map((p) => {
        const nivel: NivelEfetivo = acessos ? (acessos.get(p.id) as NivelEfetivo) : 'ADMIN';
        const protegido = perfilProtegido(p.id);
        const bloqueado = protegido && !desbloqueados.has(p.id);
        const base = {
          id: p.id,
          nome: p.nome,
          cor: p.cor,
          tipo: p.tipo === 'EMPRESA' ? 'EMPRESA' : 'PESSOAL',
          criadoEm: p.criadoEm.toISOString(),
          atual: p.id === atual,
          nivel,
          podeGerenciar: nivel === 'ADMIN' || nivel === 'EDICAO',
          protegido,
          bloqueado,
        };
        // Perfil bloqueado: sem números até a senha ser digitada.
        if (bloqueado) return { ...base, contas: null, investimentos: null, patrimonio: null };
        return comPerfil(p.id, async () => {
          const [contas, investimentos, totais] = await Promise.all([
            prisma.conta.count({ where: { ativo: true } }),
            prisma.investimento.count({ where: { ativo: true } }),
            totaisPatrimonio(),
          ]);
          return { ...base, contas, investimentos, patrimonio: arredondar(totais.patrimonio) };
        });
      })
    );
    res.json(lista);
  })
);

router.post(
  '/perfis',
  permitir('TITULAR'),
  asyncHandler(async (req, res) => {
    const dados = validar(perfilSchema, req.body);
    if ((await prisma.perfilFinanceiro.count()) >= 20) throw new HttpError(400, 'O limite é de 20 perfis');
    const repetido = await prisma.perfilFinanceiro.findFirst({ where: { nome: { equals: dados.nome, mode: 'insensitive' } } });
    if (repetido) throw new HttpError(409, 'Já existe um perfil com esse nome');
    const criado = await criarPerfil(dados.nome, dados.cor ?? '#2563eb', dados.tipo ?? 'PESSOAL');
    res.status(201).json({ id: criado.id, nome: criado.nome, cor: criado.cor, tipo: criado.tipo, criadoEm: criado.criadoEm.toISOString() });
  })
);

router.put(
  '/perfis/:id',
  permitir('TITULAR'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(perfilSchema.partial(), req.body);
    const existente = await prisma.perfilFinanceiro.findUnique({ where: { id } });
    if (!existente) throw new HttpError(404, 'Perfil não encontrado');
    if (dados.nome) {
      const repetido = await prisma.perfilFinanceiro.findFirst({
        where: { id: { not: id }, nome: { equals: dados.nome, mode: 'insensitive' } },
      });
      if (repetido) throw new HttpError(409, 'Já existe um perfil com esse nome');
    }
    const atualizado = await prisma.perfilFinanceiro.update({ where: { id }, data: { nome: dados.nome, cor: dados.cor, tipo: dados.tipo } });
    // Virou Empresa: ganha as categorias de empresa que ainda não tem (as que já existem ficam como estão).
    if (dados.tipo === 'EMPRESA' && existente.tipo !== 'EMPRESA') {
      await comPerfil(id, () => criarCategoriasPadrao(prisma, id, 'EMPRESA'));
    }
    res.json({ id: atualizado.id, nome: atualizado.nome, cor: atualizado.cor, tipo: atualizado.tipo, criadoEm: atualizado.criadoEm.toISOString() });
  })
);

// Apaga o perfil com todos os dados dele. Não deixa apagar o último.
router.delete(
  '/perfis/:id',
  permitir('TITULAR'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const existente = await prisma.perfilFinanceiro.findUnique({ where: { id } });
    if (!existente) throw new HttpError(404, 'Perfil não encontrado');
    if ((await prisma.perfilFinanceiro.count()) <= 1) throw new HttpError(400, 'Não dá para apagar o único perfil');
    await apagarPerfil(id);
    res.status(204).end();
  })
);

// ---------- Senha do perfil ----------

// Tentativas erradas (em memória): no máximo 5 por usuário e perfil a cada 10 minutos.
const JANELA_TENTATIVAS_MS = 10 * 60 * 1000;
const TENTATIVAS_LIMITE = 5;
const tentativasErradas = new Map<string, number[]>();

function recentes(chave: string): number[] {
  const agora = Date.now();
  const lista = (tentativasErradas.get(chave) ?? []).filter((t) => agora - t < JANELA_TENTATIVAS_MS);
  if (lista.length === 0) tentativasErradas.delete(chave);
  else tentativasErradas.set(chave, lista);
  return lista;
}

function contarErro(chave: string): void {
  tentativasErradas.set(chave, [...recentes(chave), Date.now()]);
}

setInterval(() => {
  for (const chave of [...tentativasErradas.keys()]) recentes(chave);
}, JANELA_TENTATIVAS_MS).unref();

const MENSAGEM_BLOQUEIO = 'Muitas tentativas. Aguarde alguns minutos.';

const desbloquearSchema = z.object({ senha: z.string().min(1).max(200) });

// Confere a senha do perfil e devolve o desbloqueio, que o navegador manda no cabeçalho X-Perfil-Desbloqueio.
router.post(
  '/perfis/:id/desbloquear',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const { senha } = validar(desbloquearSchema, req.body);
    if ((await nivelNoPerfil(req.usuario, id)) === null) throw new HttpError(404, 'Perfil não encontrado');
    const perfil = await prisma.perfilFinanceiro.findUnique({ where: { id }, select: { senhaHash: true } });
    if (!perfil?.senhaHash) {
      res.json({ token: null });
      return;
    }
    const chave = `${req.usuario.id}|${id}`;
    if (recentes(chave).length >= TENTATIVAS_LIMITE) throw new HttpError(429, MENSAGEM_BLOQUEIO);
    if (!(await bcrypt.compare(senha, perfil.senhaHash))) {
      contarErro(chave);
      throw new HttpError(400, 'Senha do perfil incorreta');
    }
    tentativasErradas.delete(chave);
    res.json({ token: gerarDesbloqueio(req.usuario, id) });
  })
);

const senhaPerfilSchema = z.object({
  senhaConta: z.string().min(1, 'Digite a senha da sua conta'),
  // null remove a senha do perfil.
  novaSenha: z.string().min(4, 'A senha do perfil deve ter pelo menos 4 caracteres').max(200).nullable(),
});

// Define, troca ou remove a senha do perfil. Quem gerencia o perfil confirma com a senha da própria conta.
router.put(
  '/perfis/:id/senha',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const { senhaConta, novaSenha } = validar(senhaPerfilSchema, req.body);
    if (!(await podeGerenciarPerfil(req.usuario, id))) throw new HttpError(403, 'Sem permissão');
    const chave = `${req.usuario.id}|conta`;
    if (recentes(chave).length >= TENTATIVAS_LIMITE) throw new HttpError(429, MENSAGEM_BLOQUEIO);
    const usuario = await prisma.usuario.findUnique({ where: { id: req.usuario.id }, select: { senhaHash: true } });
    if (!usuario || !(await bcrypt.compare(senhaConta, usuario.senhaHash))) {
      contarErro(chave);
      throw new HttpError(400, 'Senha da conta incorreta');
    }
    tentativasErradas.delete(chave);
    const senhaHash = novaSenha === null ? null : await bcrypt.hash(novaSenha, 10);
    await prisma.perfilFinanceiro.update({ where: { id }, data: { senhaHash }, select: { id: true } });
    esquecerPerfis();
    await idsDosPerfis();
    // Todos os desbloqueios antigos deixam de valer; quem trocou a senha recebe um novo.
    res.json({ protegido: senhaHash !== null, token: gerarDesbloqueio(req.usuario, id) });
  })
);

// ---------- Acessos ao perfil ----------

// Usuários e o nível de cada um neste perfil. Titulares aparecem como ADMIN (acessam todos e não mudam aqui).
router.get(
  '/perfis/:id/acessos',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    if (!(await podeGerenciarPerfil(req.usuario, id))) throw new HttpError(403, 'Sem permissão');
    const [usuarios, linhas] = await Promise.all([
      prisma.usuario.findMany({
        select: { id: true, nome: true, email: true, perfil: true, ativo: true, totpAtivo: true },
        orderBy: { nome: 'asc' },
      }),
      prisma.acessoPerfil.findMany({ where: { perfilFinanceiroId: id } }),
    ]);
    const nivelDe = new Map(linhas.map((l) => [l.usuarioId, l.nivel]));
    res.json(
      usuarios.map((u) => ({
        id: u.id,
        nome: u.nome,
        email: u.email,
        papel: u.perfil,
        ativo: u.ativo,
        totpAtivo: u.totpAtivo,
        nivel: u.perfil === 'TITULAR' ? 'ADMIN' : nivelDe.get(u.id) ?? null,
        voce: u.id === req.usuario.id,
      }))
    );
  })
);

const acessoSchema = z.object({ nivel: z.enum(['LEITURA', 'EDICAO']).nullable() });

// Dá, muda ou tira o acesso de um membro a este perfil (nivel null = sem acesso).
router.put(
  '/perfis/:id/acessos/:usuarioId',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const usuarioId = idParam(req, 'usuarioId');
    const { nivel } = validar(acessoSchema, req.body);
    if (!(await podeGerenciarPerfil(req.usuario, id))) throw new HttpError(403, 'Sem permissão');
    if (usuarioId === req.usuario.id) throw new HttpError(400, 'Você não pode mudar o próprio acesso');
    const alvo = await prisma.usuario.findUnique({ where: { id: usuarioId }, select: { perfil: true } });
    if (!alvo) throw new HttpError(404, 'Usuário não encontrado');
    if (alvo.perfil === 'TITULAR') throw new HttpError(400, 'Titulares acessam todos os perfis');
    if (nivel === null) {
      await prisma.acessoPerfil.deleteMany({ where: { usuarioId, perfilFinanceiroId: id } });
    } else {
      await prisma.acessoPerfil.upsert({
        where: { usuarioId_perfilFinanceiroId: { usuarioId, perfilFinanceiroId: id } },
        create: { usuarioId, perfilFinanceiroId: id, nivel },
        update: { nivel },
      });
    }
    esquecerAcessos();
    res.json({ id: usuarioId, nivel });
  })
);

export default router;
