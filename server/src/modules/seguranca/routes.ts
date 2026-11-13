import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, validar } from '../../lib/erros';
import { cifrar, decifrar } from '../../lib/cripto';
import { lerConfiguracao } from '../../lib/email';
import {
  conferirCodigo,
  enderecoOtpauth,
  gerarCodigosDeRecuperacao,
  gerarSegredo,
  hashCodigoRecuperacao,
} from '../../lib/totp';

// Segurança da conta: verificação em duas etapas (app autenticador) e códigos de recuperação.
// Sempre para o usuário logado (req.usuario.id). O segredo nunca volta na API depois de ativado.

const router = Router();

// Limite: no máximo 5 tentativas erradas por usuário a cada 10 minutos nestas rotas (em memória).
const JANELA_TENTATIVAS_MS = 10 * 60 * 1000;
const TENTATIVAS_LIMITE = 5;
const tentativasErradas = new Map<number, number[]>();

function tentativasRecentes(usuarioId: number, agora: number): number[] {
  const recentes = (tentativasErradas.get(usuarioId) ?? []).filter((instante) => agora - instante < JANELA_TENTATIVAS_MS);
  if (recentes.length === 0) {
    tentativasErradas.delete(usuarioId);
  } else {
    tentativasErradas.set(usuarioId, recentes);
  }
  return recentes;
}

function bloqueado(usuarioId: number): boolean {
  return tentativasRecentes(usuarioId, Date.now()).length >= TENTATIVAS_LIMITE;
}

function contarErro(usuarioId: number): void {
  const agora = Date.now();
  tentativasErradas.set(usuarioId, [...tentativasRecentes(usuarioId, agora), agora]);
}

const MENSAGEM_BLOQUEIO = 'Muitas tentativas. Aguarde alguns minutos.';

// Lista de hashes dos códigos de recuperação ainda não usados (JSON no banco).
function lerHashesRecuperacao(bruto: string | null): string[] {
  if (!bruto) return [];
  try {
    const lista: unknown = JSON.parse(bruto);
    return Array.isArray(lista) ? lista.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

// Confere um código do aplicativo OU de recuperação (o de recuperação é gasto quando bate).
function codigoEhValido(segredo: string | null, hashes: string[], codigo: string): boolean {
  if (segredo !== null && conferirCodigo(segredo, codigo)) return true;
  return hashes.includes(hashCodigoRecuperacao(codigo));
}

const ativarSchema = z.object({ codigo: z.string().trim().min(1).max(20) });

const desativarSchema = z.object({
  senha: z.string().min(1),
  codigo: z.string().trim().min(1).max(20),
});

router.get(
  '/seguranca/2fa',
  asyncHandler(async (req, res) => {
    const usuario = await prisma.usuario.findUnique({ where: { id: req.usuario.id } });
    if (!usuario) throw new HttpError(401, 'Não autenticado');
    res.json({
      ativo: usuario.totpAtivo,
      codigosDeRecuperacaoRestantes: usuario.totpAtivo ? lerHashesRecuperacao(usuario.totpRecuperacao).length : 0,
    });
  })
);

router.post(
  '/seguranca/2fa/iniciar',
  asyncHandler(async (req, res) => {
    const usuario = await prisma.usuario.findUnique({ where: { id: req.usuario.id } });
    if (!usuario) throw new HttpError(401, 'Não autenticado');
    if (usuario.totpAtivo) throw new HttpError(409, 'A verificação em duas etapas já está ativa');
    const segredo = gerarSegredo();
    // Grava cifrado; continua desligado até o primeiro código bater.
    await prisma.usuario.update({
      where: { id: usuario.id },
      data: { totpSegredoCifrado: cifrar(segredo), totpAtivo: false, totpRecuperacao: null },
    });
    const { nome: emissor } = await lerConfiguracao();
    res.json({ segredo, otpauth: enderecoOtpauth(segredo, usuario.email, emissor) });
  })
);

router.post(
  '/seguranca/2fa/ativar',
  asyncHandler(async (req, res) => {
    const { codigo } = validar(ativarSchema, req.body);
    const usuario = await prisma.usuario.findUnique({ where: { id: req.usuario.id } });
    if (!usuario) throw new HttpError(401, 'Não autenticado');
    if (usuario.totpAtivo) throw new HttpError(409, 'A verificação em duas etapas já está ativa');
    if (bloqueado(usuario.id)) throw new HttpError(429, MENSAGEM_BLOQUEIO);
    const segredo = usuario.totpSegredoCifrado ? decifrar(usuario.totpSegredoCifrado) : null;
    if (segredo === null) throw new HttpError(400, 'Comece a configuração de novo');
    if (!conferirCodigo(segredo, codigo)) {
      contarErro(usuario.id);
      throw new HttpError(400, 'Código incorreto');
    }
    const { codigos, hashes } = gerarCodigosDeRecuperacao();
    await prisma.usuario.update({
      where: { id: usuario.id },
      data: { totpAtivo: true, totpRecuperacao: JSON.stringify(hashes) },
    });
    // Os códigos aparecem só nesta resposta; no banco ficam só os hashes.
    res.json({ codigosDeRecuperacao: codigos });
  })
);

router.post(
  '/seguranca/2fa/desativar',
  asyncHandler(async (req, res) => {
    const { senha, codigo } = validar(desativarSchema, req.body);
    const usuario = await prisma.usuario.findUnique({ where: { id: req.usuario.id } });
    if (!usuario) throw new HttpError(401, 'Não autenticado');
    if (!usuario.totpAtivo) throw new HttpError(400, 'A verificação em duas etapas não está ativa');
    if (bloqueado(usuario.id)) throw new HttpError(429, MENSAGEM_BLOQUEIO);
    const confere = await bcrypt.compare(senha, usuario.senhaHash);
    if (!confere) {
      contarErro(usuario.id);
      throw new HttpError(400, 'Senha incorreta');
    }
    const segredo = usuario.totpSegredoCifrado ? decifrar(usuario.totpSegredoCifrado) : null;
    const hashes = lerHashesRecuperacao(usuario.totpRecuperacao);
    if (!codigoEhValido(segredo, hashes, codigo)) {
      contarErro(usuario.id);
      throw new HttpError(400, 'Código incorreto');
    }
    await prisma.usuario.update({
      where: { id: usuario.id },
      data: { totpAtivo: false, totpSegredoCifrado: null, totpRecuperacao: null },
    });
    res.status(204).end();
  })
);

export default router;
