import { Request, Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, validar } from '../../lib/erros';
import { gerarToken, UsuarioToken } from '../../lib/auth';
import { registrarLog } from '../../lib/log';
import { emailHabilitado, enderecoDoSite, enfileirarEmail, lerConfiguracao } from '../../lib/email';
import { consultarTokenSenha, consumirTokenSenha, criarTokenSenha } from '../../lib/tokens-senha';

// Rotas públicas (montadas antes de qualquer autenticação)
export const publico = Router();

// Rotas autenticadas (montadas com `autenticar`)
const router = Router();

// Limite de tentativas de login (em memória): chave "ip|e-mail em minúsculas" -> instantes das falhas.
const FALHAS_JANELA_MS = 10 * 60 * 1000;
const FALHAS_LIMITE = 10;
const LIMITE_CHAVES_FALHAS = 2000;
const falhasLogin = new Map<string, number[]>();

function falhasRecentes(chave: string, agora: number): number[] {
  return (falhasLogin.get(chave) ?? []).filter((instante) => agora - instante < FALHAS_JANELA_MS);
}

function limparFalhasVencidas(): void {
  const agora = Date.now();
  for (const [chave] of falhasLogin) {
    const recentes = falhasRecentes(chave, agora);
    if (recentes.length === 0) {
      falhasLogin.delete(chave);
    } else {
      falhasLogin.set(chave, recentes);
    }
  }
}

setInterval(limparFalhasVencidas, FALHAS_JANELA_MS).unref();

// Pedidos de recuperação de senha por e-mail (em memória): 3 por 15 minutos por "ip|e-mail" e 20 por IP.
const JANELA_RECUPERACAO_MS = 15 * 60 * 1000;
const LIMITE_RECUPERACAO_POR_EMAIL = 3;
const LIMITE_RECUPERACAO_POR_IP = 20;
const LIMITE_CHAVES_RECUPERACAO = 5000;
const pedidosRecuperacaoPorChave = new Map<string, number[]>();
const pedidosRecuperacaoPorIp = new Map<string, number[]>();

function pedidosRecentes(mapa: Map<string, number[]>, chave: string, agora: number): number[] {
  return (mapa.get(chave) ?? []).filter((instante) => agora - instante < JANELA_RECUPERACAO_MS);
}

function limparPedidosRecuperacaoVencidos(): void {
  const agora = Date.now();
  for (const mapa of [pedidosRecuperacaoPorChave, pedidosRecuperacaoPorIp]) {
    for (const [chave] of mapa) {
      const recentes = pedidosRecentes(mapa, chave, agora);
      if (recentes.length === 0) {
        mapa.delete(chave);
      } else {
        mapa.set(chave, recentes);
      }
    }
  }
}

setInterval(limparPedidosRecuperacaoVencidos, JANELA_RECUPERACAO_MS).unref();

// IP e navegador da requisição, para o registro de atividades.
function contextoRequisicao(req: Request): { ip: string | null; navegador: string | null } {
  const navegador = req.get('user-agent');
  return {
    ip: req.ip ?? null,
    navegador: navegador ? navegador.slice(0, 200) : null,
  };
}

function paraUsuarioResposta(u: {
  id: number;
  nome: string;
  email: string;
  perfil: UsuarioToken['perfil'];
}) {
  return {
    id: u.id,
    nome: u.nome,
    email: u.email,
    perfil: u.perfil,
  };
}

publico.get('/saude', (_req, res) => {
  res.json({ ok: true });
});

const loginSchema = z.object({
  email: z.string().min(1),
  senha: z.string().min(1),
});

publico.post(
  '/auth/login',
  asyncHandler(async (req, res) => {
    const { email, senha } = validar(loginSchema, req.body);
    const contexto = contextoRequisicao(req);
    const chave = (req.ip ?? '') + '|' + email.toLowerCase();
    const agora = Date.now();
    const falhaLogin = (status: number, mensagem: string): HttpError => {
      // A senha nunca entra no registro; só o e-mail informado (cortado em 120 caracteres).
      registrarLog({
        usuarioId: null,
        tipo: 'FALHA_LOGIN',
        modulo: 'Sessão',
        descricao: 'Tentativa de login sem sucesso: ' + email.slice(0, 120),
        metodo: 'POST',
        caminho: '/api/auth/login',
        status,
        ip: contexto.ip,
        navegador: contexto.navegador,
      });
      return new HttpError(status, mensagem);
    };
    const recentes = falhasRecentes(chave, agora);
    if (recentes.length >= FALHAS_LIMITE) {
      throw falhaLogin(429, 'Muitas tentativas. Aguarde alguns minutos.');
    }
    const registrarFalhaNoLimite = (): void => {
      if (falhasLogin.size >= LIMITE_CHAVES_FALHAS) {
        limparFalhasVencidas();
      }
      falhasLogin.set(chave, [...recentes, agora]);
    };
    const usuario = await prisma.usuario.findUnique({ where: { email } });
    if (!usuario || !usuario.ativo) {
      registrarFalhaNoLimite();
      throw falhaLogin(401, 'E-mail ou senha inválidos');
    }
    const confere = await bcrypt.compare(senha, usuario.senhaHash);
    if (!confere) {
      registrarFalhaNoLimite();
      throw falhaLogin(401, 'E-mail ou senha inválidos');
    }
    falhasLogin.delete(chave);
    const dados = paraUsuarioResposta(usuario);
    const token = gerarToken({ id: dados.id, perfil: dados.perfil });
    registrarLog({
      usuarioId: dados.id,
      usuarioNome: dados.nome,
      perfil: dados.perfil,
      tipo: 'LOGIN',
      modulo: 'Sessão',
      descricao: 'Entrou no sistema',
      metodo: 'POST',
      caminho: '/api/auth/login',
      status: 200,
      ip: contexto.ip,
      navegador: contexto.navegador,
    });
    res.json({ token, usuario: dados });
  })
);

// ---------- Senha por link de e-mail (rotas públicas) ----------

const MENSAGEM_PEDIDO_SENHA = 'Se o e-mail estiver cadastrado, enviaremos as instruções.';
const ERRO_RECUPERACAO_INDISPONIVEL =
  'A recuperação de senha por e-mail não está disponível. Procure o titular.';
const ERRO_LINK_INVALIDO = 'Link inválido ou vencido. Peça um novo.';

const esqueciSenhaSchema = z.object({
  email: z.string().trim().max(200),
});

// Envia as instruções de recuperação, se a conta existir e estiver ativa. Roda em segundo plano.
async function enviarInstrucoesRecuperacao(
  email: string,
  endereco: string,
  contexto: { ip: string | null; navegador: string | null }
): Promise<void> {
  const usuario = await prisma.usuario.findUnique({
    where: { email },
    select: { id: true, nome: true, ativo: true },
  });
  if (!usuario || !usuario.ativo) {
    return;
  }
  const token = await criarTokenSenha(usuario.id, 'RECUPERACAO');
  const { nome: nomePlataforma } = await lerConfiguracao();
  enfileirarEmail({
    para: email,
    assunto: `Redefinir sua senha - ${nomePlataforma}`,
    titulo: 'Redefinir sua senha',
    paragrafos: [
      `Recebemos um pedido para redefinir a senha da sua conta no ${nomePlataforma}.`,
      'O link abaixo vale por 1 hora e só funciona uma vez. Se não foi você que pediu, ignore este e-mail: a sua senha continua a mesma.',
    ],
    botao: { rotulo: 'Redefinir senha', endereco: `${endereco}/redefinir-senha/${token}` },
    tipo: 'RECUPERACAO',
  });
  registrarLog({
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    tipo: 'ALTERACAO',
    modulo: 'Sessão',
    descricao: 'Pediu a recuperação de senha por e-mail',
    metodo: 'POST',
    caminho: '/api/auth/esqueci-senha',
    status: 200,
    ip: contexto.ip,
    navegador: contexto.navegador,
  });
}

publico.post(
  '/auth/esqueci-senha',
  asyncHandler(async (req, res) => {
    const { email } = validar(esqueciSenhaSchema, req.body);
    const endereco = (await emailHabilitado('RECUPERACAO')) ? await enderecoDoSite() : null;
    if (!endereco) {
      throw new HttpError(400, ERRO_RECUPERACAO_INDISPONIVEL);
    }
    const contexto = contextoRequisicao(req);
    const ip = req.ip ?? '';
    const chave = ip + '|' + email.toLowerCase();
    const agora = Date.now();
    const porChave = pedidosRecentes(pedidosRecuperacaoPorChave, chave, agora);
    const porIp = pedidosRecentes(pedidosRecuperacaoPorIp, ip, agora);
    // Acima do limite: mesma resposta, sem enviar nada.
    if (porChave.length < LIMITE_RECUPERACAO_POR_EMAIL && porIp.length < LIMITE_RECUPERACAO_POR_IP) {
      if (pedidosRecuperacaoPorChave.size >= LIMITE_CHAVES_RECUPERACAO) {
        limparPedidosRecuperacaoVencidos();
      }
      pedidosRecuperacaoPorChave.set(chave, [...porChave, agora]);
      pedidosRecuperacaoPorIp.set(ip, [...porIp, agora]);
      // Em segundo plano: a resposta não depende de a conta existir (não revela o cadastro).
      void enviarInstrucoesRecuperacao(email, endereco, contexto).catch(() => undefined);
    }
    res.json({ mensagem: MENSAGEM_PEDIDO_SENHA });
  })
);

publico.get(
  '/auth/redefinir-senha/:token',
  asyncHandler(async (req, res) => {
    const bruto = req.params.token;
    const info = typeof bruto === 'string' ? await consultarTokenSenha(bruto) : null;
    if (!info) {
      res.json({ valido: false });
      return;
    }
    res.json({ valido: true, nome: info.nome, tipo: info.tipo });
  })
);

const redefinirSenhaLinkSchema = z.object({
  token: z.string().max(200),
  novaSenha: z.string().min(6),
});

publico.post(
  '/auth/redefinir-senha',
  asyncHandler(async (req, res) => {
    const { token, novaSenha } = validar(redefinirSenhaLinkSchema, req.body);
    const info = await consultarTokenSenha(token);
    if (!info) {
      throw new HttpError(400, ERRO_LINK_INVALIDO);
    }
    const trocada = await consumirTokenSenha(token, novaSenha);
    if (!trocada) {
      throw new HttpError(400, ERRO_LINK_INVALIDO);
    }
    // Sem a senha e sem o token no registro.
    const contexto = contextoRequisicao(req);
    registrarLog({
      usuarioId: info.usuarioId,
      usuarioNome: info.nome,
      tipo: 'ALTERACAO',
      modulo: 'Sessão',
      descricao: 'Redefiniu a senha pelo link enviado por e-mail',
      metodo: 'POST',
      caminho: '/api/auth/redefinir-senha',
      status: 204,
      ip: contexto.ip,
      navegador: contexto.navegador,
    });
    res.status(204).end();
  })
);

router.post(
  '/auth/sair',
  (req, res) => {
    registrarLog({
      usuarioId: req.usuario.id,
      perfil: req.usuario.perfil,
      tipo: 'SAIDA',
      modulo: 'Sessão',
      descricao: 'Saiu do sistema',
      metodo: 'POST',
      caminho: '/api/auth/sair',
      status: 204,
      ...contextoRequisicao(req),
    });
    res.status(204).end();
  }
);

router.get(
  '/auth/me',
  asyncHandler(async (req, res) => {
    const usuario = await prisma.usuario.findUnique({ where: { id: req.usuario.id } });
    if (!usuario) {
      throw new HttpError(401, 'Não autenticado');
    }
    res.json(paraUsuarioResposta(usuario));
  })
);

const trocarSenhaSchema = z.object({
  senhaAtual: z.string().min(1),
  novaSenha: z.string().min(6),
});

router.post(
  '/auth/trocar-senha',
  asyncHandler(async (req, res) => {
    const { senhaAtual, novaSenha } = validar(trocarSenhaSchema, req.body);
    const usuario = await prisma.usuario.findUnique({ where: { id: req.usuario.id } });
    if (!usuario) {
      throw new HttpError(401, 'Não autenticado');
    }
    const confere = await bcrypt.compare(senhaAtual, usuario.senhaHash);
    if (!confere) {
      throw new HttpError(400, 'Senha atual incorreta');
    }
    const senhaHash = await bcrypt.hash(novaSenha, 10);
    await prisma.usuario.update({ where: { id: usuario.id }, data: { senhaHash } });
    res.status(204).end();
  })
);

export default router;
