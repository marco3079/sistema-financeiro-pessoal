import { Request, Response, NextFunction, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import type { Perfil } from '@prisma/client';

export interface UsuarioToken {
  id: number;
  perfil: Perfil;
  // Fim do login (segundos desde a época, campo exp do JWT). Só nas requisições autenticadas.
  expira?: number;
}

declare global {
  namespace Express {
    interface Request {
      usuario: UsuarioToken;
    }
  }
}

const SEGREDO_DE_EXEMPLO = 'troque-este-segredo-de-exemplo';
const SEGREDO_ANTIGO_PADRAO = 'dev-secret';

// Calculado uma vez na subida. Se o segredo estiver ausente ou for de exemplo
// (valores conhecidos do repositório público), gera um aleatório para a execução.
const SEGREDO_JWT: string = (() => {
  const valor = process.env.JWT_SECRET ?? '';
  if (valor.length < 16 || valor === SEGREDO_DE_EXEMPLO || valor === SEGREDO_ANTIGO_PADRAO) {
    console.warn(
      'Aviso: JWT_SECRET ausente ou de exemplo. Um segredo aleatório foi gerado para esta execução; os logins expiram quando o servidor reiniciar. Defina JWT_SECRET no .env (o instalador faz isso).'
    );
    return crypto.randomBytes(48).toString('hex');
  }
  return valor;
})();

function segredo(): string {
  return SEGREDO_JWT;
}

// Segredo efetivo do servidor (o do .env ou o aleatório desta execução). Usado também para
// derivar a chave que cifra segredos guardados no banco (lib/cripto.ts).
export function segredoDoServidor(): string {
  return SEGREDO_JWT;
}

export function gerarToken(u: UsuarioToken): string {
  return jwt.sign({ id: u.id, perfil: u.perfil }, segredo(), { expiresIn: '12h' });
}

// Usuário LEITOR (membro): vê só os perfis financeiros liberados para ele (AcessoPerfil). As escritas dependem
// do nível no perfil da requisição e são conferidas em lib/perfil.ts (escolherPerfil), que já sabe o perfil.
export const METODOS_DE_LEITURA = ['GET', 'HEAD', 'OPTIONS'];
// Áreas de administração que o membro não abre (nem consulta, nem altera), qualquer que seja o nível.
export const AREAS_FECHADAS_AO_LEITOR = [
  '/api/usuarios',
  '/api/mcp',
  '/api/drive',
  '/api/atualizacao',
  '/api/logs',
  '/api/configuracoes',
  '/api/entrada',
  '/api/avisos',
  '/api/automacoes',
  '/api/cupom',
  '/api/bancos',
];

export function caminhoDaRequisicao(req: Request): string {
  // O Express roteia sem diferenciar maiúsculas e aceita barras repetidas; a comparação precisa do caminho normalizado.
  const bruto = req.originalUrl || req.url || '';
  let caminho = bruto.split('?')[0].toLowerCase().replace(/\/{2,}/g, '/');
  try {
    caminho = decodeURIComponent(caminho).toLowerCase().replace(/\/{2,}/g, '/');
  } catch {
    // caminho com % inválido: segue com o texto como veio
  }
  if (caminho.length > 1 && caminho.endsWith('/')) caminho = caminho.slice(0, -1);
  return caminho;
}

export function pertenceA(caminho: string, area: string): boolean {
  return caminho === area || caminho.startsWith(area + '/');
}

export const autenticar: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  const cabecalho = req.headers.authorization ?? '';
  if (!cabecalho.startsWith('Bearer ')) {
    res.status(401).json({ erro: 'Não autenticado' });
    return;
  }
  const token = cabecalho.slice('Bearer '.length).trim();
  try {
    const payload = jwt.verify(token, segredo()) as jwt.JwtPayload;
    const perfil = payload.perfil as Perfil;
    if (!['TITULAR', 'LEITOR'].includes(perfil)) {
      res.status(401).json({ erro: 'Não autenticado' });
      return;
    }
    req.usuario = { id: payload.id, perfil, expira: typeof payload.exp === 'number' ? payload.exp : undefined };
  } catch {
    res.status(401).json({ erro: 'Não autenticado' });
    return;
  }
  if (req.usuario.perfil === 'LEITOR') {
    const caminho = caminhoDaRequisicao(req);
    if (AREAS_FECHADAS_AO_LEITOR.some((area) => pertenceA(caminho, area))) {
      res.status(403).json({ erro: 'Sem permissão' });
      return;
    }
  }
  next();
};

export function permitir(...perfis: Perfil[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.usuario || !perfis.includes(req.usuario.perfil)) {
      res.status(403).json({ erro: 'Sem permissão' });
      return;
    }
    next();
  };
}
