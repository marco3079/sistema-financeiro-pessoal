import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { permitir } from '../../lib/auth';
import { emailHabilitado, enderecoDoSite, enfileirarEmail, lerConfiguracao } from '../../lib/email';
import { criarTokenSenha } from '../../lib/tokens-senha';
import { validarImagem } from '../../lib/imagem';

const router = Router();

// ---------- Utilitários ----------

// E-mail de boas-vindas com o botão "Criar minha senha". Roda em segundo plano:
// nunca atrasa nem derruba a resposta do cadastro.
function avisarBoasVindas(usuario: { id: number; nome: string; email: string }): void {
  void (async () => {
    if (!(await emailHabilitado('BOAS_VINDAS'))) {
      return;
    }
    const endereco = await enderecoDoSite();
    if (!endereco) {
      return;
    }
    const { nome: nomePlataforma } = await lerConfiguracao();
    const token = await criarTokenSenha(usuario.id, 'BOAS_VINDAS');
    enfileirarEmail({
      para: usuario.email,
      assunto: `Bem-vindo ao ${nomePlataforma}`,
      titulo: `Bem-vindo ao ${nomePlataforma}`,
      paragrafos: [
        `Criamos a sua conta no ${nomePlataforma}.`,
        `Seu e-mail de acesso é ${usuario.email}.`,
        'Clique no botão abaixo para criar a sua senha. O link vale por 7 dias.',
      ],
      botao: { rotulo: 'Criar minha senha', endereco: `${endereco}/redefinir-senha/${token}` },
      tipo: 'BOAS_VINDAS',
    });
  })().catch(() => undefined);
}

// Remove senhaHash de qualquer registro de usuário antes de responder.
function semSenha<U extends { senhaHash: string }>(usuario: U): Omit<U, 'senhaHash'> {
  const { senhaHash, ...resto } = usuario;
  return resto;
}

function textoBusca(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

async function garantirEmailLivre(email: string, ignorarUsuarioId?: number): Promise<void> {
  const outro = await prisma.usuario.findFirst({
    where: ignorarUsuarioId === undefined ? { email } : { email, id: { not: ignorarUsuarioId } },
    select: { id: true },
  });
  if (outro) {
    throw new HttpError(409, 'E-mail já cadastrado');
  }
}

// ---------- Schemas (zod) ----------

const senhaSchema = z.string().min(6, 'A senha deve ter pelo menos 6 caracteres');
const textoOpcional = z.string().nullable().optional();
const perfilSchema = z.enum(['TITULAR']);

const usuarioCriarSchema = z.object({
  nome: z.string().trim().min(1, 'Nome obrigatório'),
  email: z.string().trim().toLowerCase().email('E-mail inválido'),
  senha: senhaSchema,
  perfil: perfilSchema,
});

const usuarioAtualizarSchema = z.object({
  nome: z.string().trim().min(1, 'Nome obrigatório').optional(),
  email: z.string().trim().toLowerCase().email('E-mail inválido').optional(),
  telefone: textoOpcional,
  ativo: z.boolean().optional(),
});

const usuarioFiltroSchema = z.object({
  perfil: perfilSchema.optional(),
  busca: z.string().optional(),
});

const redefinirSenhaSchema = z.object({ novaSenha: senhaSchema });

const perfilAtualizarSchema = z.object({
  telefone: textoOpcional,
});

// ---------- Usuários (somente TITULAR) ----------

router.get(
  '/usuarios',
  permitir('TITULAR'),
  asyncHandler(async (req, res) => {
    const filtro = validar(usuarioFiltroSchema, req.query);
    const busca = textoBusca(filtro.busca);
    const usuarios = await prisma.usuario.findMany({
      where: {
        perfil: filtro.perfil,
        ...(busca
          ? {
              OR: [
                { nome: { contains: busca, mode: 'insensitive' } },
                { email: { contains: busca, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { nome: 'asc' },
    });
    res.json(usuarios.map((u) => semSenha(u)));
  })
);

router.post(
  '/usuarios',
  permitir('TITULAR'),
  asyncHandler(async (req, res) => {
    const dados = validar(usuarioCriarSchema, req.body);
    await garantirEmailLivre(dados.email);
    const senhaHash = await bcrypt.hash(dados.senha, 10);
    const usuario = await prisma.usuario.create({
      data: {
        nome: dados.nome,
        email: dados.email,
        senhaHash,
        perfil: dados.perfil,
      },
    });
    avisarBoasVindas(usuario);
    res.status(201).json(semSenha(usuario));
  })
);

router.put(
  '/usuarios/:id',
  permitir('TITULAR'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const dados = validar(usuarioAtualizarSchema, req.body);
    const existente = await prisma.usuario.findUnique({
      where: { id },
      select: { id: true, perfil: true, ativo: true },
    });
    if (!existente) {
      throw new HttpError(404, 'Usuário não encontrado');
    }
    if (dados.email !== undefined) {
      await garantirEmailLivre(dados.email, id);
    }
    if (dados.ativo === false && existente.ativo) {
      if (id === req.usuario.id) {
        throw new HttpError(400, 'Você não pode desativar a própria conta');
      }
      // Sempre fica pelo menos um titular ativo.
      if (existente.perfil === 'TITULAR') {
        const outros = await prisma.usuario.count({
          where: { perfil: 'TITULAR', ativo: true, id: { not: id } },
        });
        if (outros === 0) {
          throw new HttpError(400, 'É preciso manter pelo menos um titular ativo');
        }
      }
    }
    const usuario = await prisma.usuario.update({
      where: { id },
      data: {
        nome: dados.nome,
        email: dados.email,
        telefone: dados.telefone,
        ativo: dados.ativo,
      },
    });
    res.json(semSenha(usuario));
  })
);

router.post(
  '/usuarios/:id/redefinir-senha',
  permitir('TITULAR'),
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const { novaSenha } = validar(redefinirSenhaSchema, req.body);
    const existente = await prisma.usuario.findUnique({ where: { id }, select: { id: true } });
    if (!existente) {
      throw new HttpError(404, 'Usuário não encontrado');
    }
    const senhaHash = await bcrypt.hash(novaSenha, 10);
    await prisma.usuario.update({ where: { id }, data: { senhaHash } });
    res.status(204).end();
  })
);

// ---------- Meu perfil (qualquer usuário logado) ----------

router.get(
  '/perfil/meu',
  asyncHandler(async (req, res) => {
    const usuario = await prisma.usuario.findUnique({ where: { id: req.usuario.id } });
    if (!usuario) {
      throw new HttpError(404, 'Usuário não encontrado');
    }
    res.json(semSenha(usuario));
  })
);

router.put(
  '/perfil/meu',
  asyncHandler(async (req, res) => {
    const dados = validar(perfilAtualizarSchema, req.body);
    const usuario = await prisma.usuario.update({
      where: { id: req.usuario.id },
      data: { telefone: dados.telefone },
    });
    res.json(semSenha(usuario));
  })
);

// Resumo do perfil: dados da conta, números do trabalho da pessoa e o que ela fez por último.
router.get(
  '/perfil/completo',
  asyncHandler(async (req, res) => {
    const usuario = await prisma.usuario.findUnique({ where: { id: req.usuario.id } });
    if (!usuario) {
      throw new HttpError(404, 'Usuário não encontrado');
    }
    const brl = (n: unknown) => Number(n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const [contas, cartoes, investimentos, lancamentos, atividades] = await Promise.all([
      prisma.conta.aggregate({
        where: { ativo: true, tipo: { not: 'CARTAO' } },
        _sum: { saldo: true },
        _count: { _all: true },
      }),
      prisma.conta.aggregate({ where: { ativo: true, tipo: 'CARTAO' }, _sum: { saldo: true } }),
      prisma.investimento.aggregate({ where: { ativo: true }, _sum: { saldo: true } }),
      prisma.transacao.count(),
      prisma.logAtividade.findMany({
        where: { usuarioId: usuario.id, tipo: { in: ['CRIACAO', 'ALTERACAO', 'EXCLUSAO'] } },
        orderBy: { criadoEm: 'desc' },
        take: 8,
        select: { id: true, criadoEm: true, tipo: true, descricao: true, modulo: true },
      }),
    ]);
    res.json({
      usuario: {
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        perfil: usuario.perfil,
        foto: usuario.foto,
        telefone: usuario.telefone,
        criadoEm: usuario.criadoEm.toISOString(),
      },
      resumo: [
        {
          rotulo: `Saldo em ${contas._count._all} ${contas._count._all === 1 ? 'conta' : 'contas'}`,
          valor: brl(contas._sum.saldo),
          icone: 'contas',
          cor: 'azul',
        },
        { rotulo: 'Investido', valor: brl(investimentos._sum.saldo), icone: 'investimentos', cor: 'verde' },
        { rotulo: 'Faturas em aberto', valor: brl(cartoes._sum.saldo), icone: 'cartao', cor: 'laranja' },
        { rotulo: 'Lançamentos registrados', valor: String(lancamentos), icone: 'transacoes', cor: 'roxo' },
      ],
      atividadeRecente: atividades.map((l) => ({ ...l, criadoEm: l.criadoEm.toISOString() })),
    });
  })
);

const fotoSchema = z.object({ foto: z.string().nullable() });

router.put(
  '/perfil/foto',
  asyncHandler(async (req, res) => {
    const dados = validar(fotoSchema, req.body);
    const foto = validarImagem(dados.foto, { aceitaEndereco: true });
    await prisma.usuario.update({
      where: { id: req.usuario.id },
      data: { foto },
      select: { id: true },
    });
    res.json({ foto });
  })
);

export default router;
