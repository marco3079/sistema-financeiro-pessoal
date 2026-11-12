import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from './prisma';

// Tokens de uso único para criar (BOAS_VINDAS) ou redefinir (RECUPERACAO) a senha por link de e-mail.
// Só o SHA-256 do token fica no banco; o token em claro vai apenas no link enviado.

export type TipoTokenSenhaLink = 'RECUPERACAO' | 'BOAS_VINDAS';

const MS_HORA = 60 * 60 * 1000;
const VALIDADE_MS: Record<TipoTokenSenhaLink, number> = {
  RECUPERACAO: MS_HORA,
  BOAS_VINDAS: 7 * 24 * MS_HORA,
};
const TAMANHO_MAXIMO_TOKEN = 200;

function hashDoToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Cria um token novo. Para RECUPERACAO, os anteriores do mesmo usuário e tipo são invalidados.
export async function criarTokenSenha(usuarioId: number, tipo: TipoTokenSenhaLink): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  const agora = new Date();
  const expiraEm = new Date(agora.getTime() + VALIDADE_MS[tipo]);
  await prisma.$transaction(async (tx) => {
    if (tipo === 'RECUPERACAO') {
      await tx.tokenSenha.updateMany({
        where: { usuarioId, tipo, usadoEm: null },
        data: { usadoEm: agora },
      });
    }
    await tx.tokenSenha.create({
      data: {
        usuarioId,
        tipo,
        tokenHash: hashDoToken(token),
        expiraEm,
        criadoEm: agora,
      },
    });
  });
  return token;
}

// Busca o token válido (não usado, não vencido, usuário ativo). `null` caso contrário.
export async function consultarTokenSenha(
  token: string
): Promise<{ usuarioId: number; nome: string; tipo: TipoTokenSenhaLink } | null> {
  if (typeof token !== 'string' || token.length === 0 || token.length > TAMANHO_MAXIMO_TOKEN) {
    return null;
  }
  const registro = await prisma.tokenSenha.findUnique({ where: { tokenHash: hashDoToken(token) } });
  if (!registro || registro.usadoEm !== null || registro.expiraEm.getTime() <= Date.now()) {
    return null;
  }
  const usuario = await prisma.usuario.findUnique({
    where: { id: registro.usuarioId },
    select: { nome: true, ativo: true },
  });
  if (!usuario || !usuario.ativo) {
    return null;
  }
  return {
    usuarioId: registro.usuarioId,
    nome: usuario.nome,
    tipo: registro.tipo,
  };
}

// Troca a senha e marca o token como usado, numa transação. Também invalida os outros tokens do usuário.
// Devolve false se o token não estiver mais válido (inclusive quando usado em paralelo).
export async function consumirTokenSenha(token: string, novaSenha: string): Promise<boolean> {
  if (typeof token !== 'string' || token.length === 0 || token.length > TAMANHO_MAXIMO_TOKEN) {
    return false;
  }
  const senhaHash = await bcrypt.hash(novaSenha, 10);
  return prisma.$transaction(async (tx) => {
    const agora = new Date();
    const registro = await tx.tokenSenha.findUnique({ where: { tokenHash: hashDoToken(token) } });
    if (!registro || registro.usadoEm !== null || registro.expiraEm.getTime() <= agora.getTime()) {
      return false;
    }
    const usuario = await tx.usuario.findUnique({
      where: { id: registro.usuarioId },
      select: { ativo: true },
    });
    if (!usuario || !usuario.ativo) {
      return false;
    }
    // Marca como usado só se ainda estiver livre (evita uso duplo em requisições simultâneas).
    const marcado = await tx.tokenSenha.updateMany({
      where: { id: registro.id, usadoEm: null },
      data: { usadoEm: agora },
    });
    if (marcado.count !== 1) {
      return false;
    }
    await tx.usuario.update({ where: { id: registro.usuarioId }, data: { senhaHash } });
    await tx.tokenSenha.updateMany({
      where: { usuarioId: registro.usuarioId, usadoEm: null },
      data: { usadoEm: agora },
    });
    return true;
  });
}
