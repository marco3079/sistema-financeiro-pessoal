import express, { Request, Response, NextFunction, Router } from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { Prisma } from '@prisma/client';
import { HttpError } from './lib/erros';
import { autenticar } from './lib/auth';
import { descreverRequisicao, iniciarLimpezaDeLogs, registrarLog } from './lib/log';

interface ModuloRotas {
  publico?: Router;
  default?: Router;
}

function carregarModulos(): { nome: string; mod: ModuloRotas }[] {
  const dirModulos = path.join(__dirname, 'modules');
  const pastas = fs
    .readdirSync(dirModulos, { withFileTypes: true })
    .filter((entrada) => entrada.isDirectory())
    .map((entrada) => entrada.name)
    .filter(
      (nome) =>
        fs.existsSync(path.join(dirModulos, nome, 'routes.ts')) ||
        fs.existsSync(path.join(dirModulos, nome, 'routes.js'))
    )
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  return pastas.map((nome) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(path.join(dirModulos, nome, 'routes')) as ModuloRotas;
    return { nome, mod };
  });
}

function tratarErro(e: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (e instanceof HttpError) {
    res.status(e.status).json({ erro: e.message, detalhes: e.detalhes });
    return;
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === 'P2002') {
      res.status(409).json({ erro: 'Registro duplicado' });
      return;
    }
    if (e.code === 'P2025') {
      res.status(404).json({ erro: 'Registro não encontrado' });
      return;
    }
  }
  if ((e as { type?: string })?.type === 'entity.parse.failed') {
    res.status(400).json({ erro: 'JSON inválido' });
    return;
  }
  if ((e as { type?: string })?.type === 'entity.too.large') {
    res.status(413).json({ erro: 'Corpo da requisição grande demais' });
    return;
  }
  console.error(`Erro em ${req.method} ${req.originalUrl}:`, e);
  res.status(500).json({ erro: 'Erro interno' });
}

// Registra toda requisição autenticada sob /api ao terminar a resposta (sem atrasá-la).
function registrarAtividade(req: Request, res: Response, next: NextFunction): void {
  const inicio = Date.now();
  // Capturados antes da resposta: dentro de 'finish' o req.path pode já não ter o prefixo /api.
  const caminho = req.originalUrl.split('?')[0];
  const metodo = req.method;
  res.on('finish', () => {
    try {
      if (!caminho.startsWith('/api/') || !req.usuario || metodo === 'OPTIONS') {
        return;
      }
      if (
        caminho === '/api/saude' ||
        caminho === '/api/logs' ||
        caminho.startsWith('/api/logs/') ||
        caminho === '/api/auth/login' ||
        caminho === '/api/auth/sair' ||
        caminho === '/api/notificacoes' ||
        caminho === '/api/openfinance/estado'
      ) {
        return;
      }
      const descricao = descreverRequisicao(metodo, caminho);
      const navegador = req.get('user-agent');
      registrarLog({
        usuarioId: req.usuario.id,
        perfil: req.usuario.perfil,
        tipo: descricao.tipo,
        modulo: descricao.modulo,
        descricao: descricao.descricao,
        metodo,
        caminho,
        status: res.statusCode,
        duracaoMs: Date.now() - inicio,
        ip: req.ip ?? null,
        navegador: navegador ? navegador.slice(0, 200) : null,
      });
    } catch (erro) {
      console.error('Falha ao montar log de atividade:', erro instanceof Error ? erro.message : erro);
    }
  });
  next();
}

export function criarApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(cors());
  // A importação manda o texto do arquivo (ou as abas da planilha da B3): precisa de um corpo maior.
  app.use('/api/importacao', express.json({ limit: '12mb' }));
  app.use(express.json({ limit: '1mb' }));
  app.use(registrarAtividade);
  iniciarLimpezaDeLogs();

  const modulos = carregarModulos();

  // Primeiro todas as rotas públicas, depois as autenticadas.
  for (const { mod } of modulos) {
    if (mod.publico) {
      app.use('/api', mod.publico);
    }
  }
  for (const { mod } of modulos) {
    if (mod.default) {
      app.use('/api', autenticar, mod.default);
    }
  }

  app.use((_req, res) => {
    res.status(404).json({ erro: 'Rota não encontrada' });
  });

  app.use(tratarErro);

  return app;
}
