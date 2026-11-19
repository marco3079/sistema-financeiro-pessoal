import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { permitir } from '../../lib/auth';
import { esquecerAcessos } from '../../lib/perfil';
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

// Remove a senha e os segredos da verificação em duas etapas antes de responder (fica só totpAtivo).
type UsuarioComSegredos = {
  senhaHash: string;
  totpSegredoCifrado?: string | null;
  totpRecuperacao?: string | null;
  perfilFinanceiroId?: number | null;
};
function semSenha<U extends UsuarioComSegredos>(
  usuario: U
): Omit<U, 'senhaHash' | 'totpSegredoCifrado' | 'totpRecuperacao' | 'perfilFinanceiroId'> {
  const { senhaHash, totpSegredoCifrado, totpRecuperacao, perfilFinanceiroId, ...resto } = usuario;
  return resto;
}

// Acessos do membro: perfil financeiro e nível. Titulares acessam todos e não têm linhas.
type AcessoInformado = { perfilFinanceiroId: number; nivel: 'LEITURA' | 'EDICAO' };

async function acessosPorUsuario(ids: number[]): Promise<Map<number, AcessoInformado[]>> {
  const linhas = await prisma.acessoPerfil.findMany({
    where: { usuarioId: { in: ids } },
    orderBy: { perfilFinanceiroId: 'asc' },
  });
  const mapa = new Map<number, AcessoInformado[]>();
  for (const l of linhas) {
    const lista = mapa.get(l.usuarioId) ?? [];
    lista.push({ perfilFinanceiroId: l.perfilFinanceiroId, nivel: l.nivel });
    mapa.set(l.usuarioId, lista);
  }
  return mapa;
}

// Grava a lista completa de acessos do membro (substitui a anterior). Titular: apaga as linhas.
async function gravarAcessos(usuarioId: number, perfil: 'TITULAR' | 'LEITOR', acessos: AcessoInformado[]): Promise<void> {
  await prisma.$transaction([
    prisma.acessoPerfil.deleteMany({ where: { usuarioId } }),
    ...(perfil === 'LEITOR' && acessos.length > 0
      ? [prisma.acessoPerfil.createMany({ data: acessos.map((a) => ({ ...a, usuarioId })), skipDuplicates: true })]
      : []),
    prisma.usuario.update({ where: { id: usuarioId }, data: { perfilFinanceiroId: null }, select: { id: true } }),
  ]);
  esquecerAcessos();
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
const perfilSchema = z.enum(['TITULAR', 'LEITOR']);
const acessoSchema = z.object({
  perfilFinanceiroId: z.number().int().positive(),
  nivel: z.enum(['LEITURA', 'EDICAO']),
});

const usuarioCriarSchema = z.object({
  nome: z.string().trim().min(1, 'Nome obrigatório'),
  email: z.string().trim().toLowerCase().email('E-mail inválido'),
  senha: senhaSchema,
  perfil: perfilSchema,
  // Membro: perfis que ele acessa e com que nível. O campo antigo (um perfil, leitura) ainda é aceito.
  acessos: z.array(acessoSchema).max(50).optional(),
  perfilFinanceiroId: z.number().int().positive().nullable().optional(),
});

const usuarioAtualizarSchema = z.object({
  nome: z.string().trim().min(1, 'Nome obrigatório').optional(),
  email: z.string().trim().toLowerCase().email('E-mail inválido').optional(),
  telefone: textoOpcional,
  ativo: z.boolean().optional(),
  perfil: perfilSchema.optional(),
  acessos: z.array(acessoSchema).max(50).optional(),
  perfilFinanceiroId: z.number().int().positive().nullable().optional(),
});

// Membro (LEITOR): precisa de pelo menos um perfil, e todos precisam existir. Titular: nenhum (acessa todos).
async function conferirAcessos(
  perfil: 'TITULAR' | 'LEITOR',
  acessos: AcessoInformado[] | undefined,
  perfilFinanceiroId: number | null | undefined
): Promise<AcessoInformado[]> {
  if (perfil !== 'LEITOR') return [];
  let lista = acessos;
  if (lista === undefined && perfilFinanceiroId) lista = [{ perfilFinanceiroId, nivel: 'LEITURA' }];
  const unicos = new Map((lista ?? []).map((a) => [a.perfilFinanceiroId, a]));
  if (unicos.size === 0) {
    throw new HttpError(400, 'Escolha pelo menos um perfil financeiro que o membro pode acessar');
  }
  const existentes = await prisma.perfilFinanceiro.count({ where: { id: { in: [...unicos.keys()] } } });
  if (existentes !== unicos.size) {
    throw new HttpError(400, 'Perfil financeiro não encontrado');
  }
  return [...unicos.values()];
}

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
    const acessos = await acessosPorUsuario(usuarios.map((u) => u.id));
    res.json(usuarios.map((u) => ({ ...semSenha(u), acessos: acessos.get(u.id) ?? [] })));
  })
);

router.post(
  '/usuarios',
  permitir('TITULAR'),
  asyncHandler(async (req, res) => {
    const dados = validar(usuarioCriarSchema, req.body);
    await garantirEmailLivre(dados.email);
    const acessos = await conferirAcessos(dados.perfil, dados.acessos, dados.perfilFinanceiroId);
    const senhaHash = await bcrypt.hash(dados.senha, 10);
    const usuario = await prisma.usuario.create({
      data: {
        nome: dados.nome,
        email: dados.email,
        senhaHash,
        perfil: dados.perfil,
      },
    });
    await gravarAcessos(usuario.id, usuario.perfil, acessos);
    avisarBoasVindas(usuario);
    res.status(201).json({ ...semSenha(usuario), acessos });
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
      select: { id: true, perfil: true, ativo: true, perfilFinanceiroId: true },
    });
    if (!existente) {
      throw new HttpError(404, 'Usuário não encontrado');
    }
    if (dados.email !== undefined) {
      await garantirEmailLivre(dados.email, id);
    }
    // Rebaixar um titular para leitor: não pode ser a própria conta nem o último titular ativo.
    const novoPerfil = dados.perfil ?? existente.perfil;
    if (novoPerfil === 'LEITOR' && existente.perfil === 'TITULAR' && existente.ativo) {
      if (id === req.usuario.id) {
        throw new HttpError(400, 'Você não pode rebaixar a própria conta');
      }
      const outros = await prisma.usuario.count({
        where: { perfil: 'TITULAR', ativo: true, id: { not: id } },
      });
      if (outros === 0) {
        throw new HttpError(400, 'É preciso manter pelo menos um titular ativo');
      }
    }
    // Acessos: só mudam quando vierem na requisição ou quando o papel mudar.
    const mudaAcessos =
      dados.acessos !== undefined || dados.perfilFinanceiroId !== undefined || novoPerfil !== existente.perfil;
    const acessos = mudaAcessos ? await conferirAcessos(novoPerfil, dados.acessos, dados.perfilFinanceiroId) : null;
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
        perfil: dados.perfil,
      },
    });
    if (acessos) await gravarAcessos(id, usuario.perfil, acessos);
    esquecerAcessos();
    const lista = (await acessosPorUsuario([id])).get(id) ?? [];
    res.json({ ...semSenha(usuario), acessos: lista });
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
