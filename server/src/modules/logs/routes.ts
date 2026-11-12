import { Request, Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import type { LogAtividade } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { permitir } from '../../lib/auth';
import { registrarLog, TipoLog } from '../../lib/log';

// Módulo "logs": registro de telas abertas e consultas do log de atividades.
// Todas as rotas de consulta valem para o TITULAR.

const router = Router();

const MS_HORA = 60 * 60 * 1000;
const MS_DIA = 24 * MS_HORA;
const JANELA_ONLINE_MS = 5 * 60 * 1000;
const JANELA_TELA_MS = 5 * 1000;
const LIMITE_CHAVES_TELA = 5000;
const PREFIXO_TELA = 'Abriu a tela ';

const TIPOS: TipoLog[] = [
  'LOGIN',
  'FALHA_LOGIN',
  'SAIDA',
  'TELA',
  'CONSULTA',
  'CRIACAO',
  'ALTERACAO',
  'EXCLUSAO',
];

// Anti-repetição de "Abriu a tela": "usuarioId caminho" -> instante da última gravação.
const ultimasTelas = new Map<string, number>();

// ---------- Tipos de resposta ----------

export interface LogDTO {
  id: number;
  criadoEm: string;
  usuarioId: number | null;
  usuarioNome: string | null;
  perfil: string | null;
  tipo: string;
  modulo: string;
  descricao: string;
  metodo: string | null;
  caminho: string | null;
  status: number | null;
  duracaoMs: number | null;
  ip: string | null;
  navegador: string | null;
}

function paraLogDTO(l: LogAtividade): LogDTO {
  return {
    id: l.id,
    criadoEm: l.criadoEm.toISOString(),
    usuarioId: l.usuarioId,
    usuarioNome: l.usuarioNome,
    perfil: l.perfil,
    tipo: l.tipo,
    modulo: l.modulo,
    descricao: l.descricao,
    metodo: l.metodo,
    caminho: l.caminho,
    status: l.status,
    duracaoMs: l.duracaoMs,
    ip: l.ip,
    navegador: l.navegador,
  };
}

function semPrefixoTela(descricao: string): string {
  return descricao.startsWith(PREFIXO_TELA) ? descricao.slice(PREFIXO_TELA.length) : descricao;
}

// Conta itens por uma chave e devolve do maior para o menor.
function contarPor<T>(itens: T[], chave: (item: T) => string): { chave: string; total: number }[] {
  const mapa = new Map<string, number>();
  for (const item of itens) {
    const k = chave(item);
    mapa.set(k, (mapa.get(k) ?? 0) + 1);
  }
  return [...mapa.entries()]
    .map(([k, total]) => ({ chave: k, total }))
    .sort((a, b) => b.total - a.total);
}

// ---------- Leitura de parâmetros ----------

function textoQuery(valor: unknown): string | undefined {
  if (typeof valor !== 'string') {
    return undefined;
  }
  const texto = valor.trim();
  return texto === '' ? undefined : texto;
}

function inteiroQuery(valor: unknown, nome: string): number | undefined {
  const texto = textoQuery(valor);
  if (texto === undefined) {
    return undefined;
  }
  if (!/^\d+$/.test(texto) || !Number.isSafeInteger(Number(texto))) {
    throw new HttpError(400, `Parâmetro ${nome} inválido`);
  }
  return Number(texto);
}

// Data AAAA-MM-DD, devolvida como meia-noite local.
function dataQuery(valor: unknown, nome: string): Date | undefined {
  const texto = textoQuery(valor);
  if (texto === undefined) {
    return undefined;
  }
  const casa = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (!casa) {
    throw new HttpError(400, `Parâmetro ${nome} inválido`);
  }
  const ano = Number(casa[1]);
  const mes = Number(casa[2]) - 1;
  const dia = Number(casa[3]);
  const data = new Date(ano, mes, dia);
  if (data.getMonth() !== mes || data.getDate() !== dia) {
    throw new HttpError(400, `Parâmetro ${nome} inválido`);
  }
  return data;
}

function tipoQuery(valor: unknown): TipoLog | undefined {
  const texto = textoQuery(valor);
  if (texto === undefined) {
    return undefined;
  }
  if (!(TIPOS as string[]).includes(texto)) {
    throw new HttpError(400, 'Parâmetro tipo inválido');
  }
  return texto as TipoLog;
}

function limiteQuery(valor: unknown): number {
  const numero = inteiroQuery(valor, 'limite');
  if (numero === undefined) {
    return 50;
  }
  return Math.min(Math.max(numero, 1), 200);
}

function contextoRequisicao(req: Request): { ip: string | null; navegador: string | null } {
  const navegador = req.get('user-agent');
  return {
    ip: req.ip ?? null,
    navegador: navegador ? navegador.slice(0, 200) : null,
  };
}

// ---------- Schema do registro de tela ----------

const telaSchema = z.object({
  caminho: z
    .string()
    .max(200, 'Caminho muito longo')
    .refine((valor) => valor.startsWith('/'), 'Caminho deve começar com /'),
  titulo: z
    .string()
    .max(80, 'Título muito longo')
    .refine((valor) => valor.trim().length >= 1, 'Título obrigatório'),
});

// ---------- Registro de tela (todos os perfis) ----------

router.post(
  '/logs/tela',
  asyncHandler(async (req, res) => {
    const dados = validar(telaSchema, req.body);
    const caminho = dados.caminho.split(/[?#]/)[0];
    const titulo = dados.titulo.trim();
    const agora = Date.now();
    const chave = req.usuario.id + ' ' + caminho;
    const ultima = ultimasTelas.get(chave);

    if (ultima === undefined || agora - ultima >= JANELA_TELA_MS) {
      ultimasTelas.set(chave, agora);
      if (ultimasTelas.size > LIMITE_CHAVES_TELA) {
        for (const [k, instante] of ultimasTelas) {
          if (agora - instante >= JANELA_TELA_MS) {
            ultimasTelas.delete(k);
          }
        }
      }

      const segundo = caminho.split('/').filter((s) => s.length > 0)[1] ?? '';
      const modulo = segundo ? segundo.charAt(0).toUpperCase() + segundo.slice(1) : 'Início';
      const contexto = contextoRequisicao(req);
      registrarLog({
        usuarioId: req.usuario.id,
        perfil: req.usuario.perfil,
        tipo: 'TELA',
        modulo,
        descricao: PREFIXO_TELA + titulo,
        metodo: 'POST',
        caminho,
        status: 204,
        ip: contexto.ip,
        navegador: contexto.navegador,
      });
    }

    res.status(204).end();
  })
);

// ---------- Consultas (TITULAR) ----------

router.get(
  '/logs',
  permitir('TITULAR'),
  asyncHandler(async (req, res) => {
    const usuarioId = inteiroQuery(req.query.usuarioId, 'usuarioId');
    const tipo = tipoQuery(req.query.tipo);
    const modulo = textoQuery(req.query.modulo);
    const busca = textoQuery(req.query.busca);
    const de = dataQuery(req.query.de, 'de');
    const ate = dataQuery(req.query.ate, 'ate');
    const depoisDe = inteiroQuery(req.query.depoisDe, 'depoisDe');
    const antesDe = inteiroQuery(req.query.antesDe, 'antesDe');
    const limite = limiteQuery(req.query.limite);

    const where: Prisma.LogAtividadeWhereInput = {};
    if (usuarioId !== undefined) {
      where.usuarioId = usuarioId;
    }
    if (tipo !== undefined) {
      where.tipo = tipo;
    }
    if (modulo !== undefined) {
      where.modulo = modulo;
    }
    if (busca !== undefined) {
      where.OR = [
        { descricao: { contains: busca, mode: 'insensitive' } },
        { usuarioNome: { contains: busca, mode: 'insensitive' } },
        { caminho: { contains: busca, mode: 'insensitive' } },
      ];
    }
    if (de !== undefined || ate !== undefined) {
      const intervalo: Prisma.DateTimeFilter = {};
      if (de !== undefined) {
        intervalo.gte = de;
      }
      if (ate !== undefined) {
        intervalo.lt = new Date(ate.getFullYear(), ate.getMonth(), ate.getDate() + 1);
      }
      where.criadoEm = intervalo;
    }
    if (depoisDe !== undefined || antesDe !== undefined) {
      const faixaId: Prisma.IntFilter = {};
      if (depoisDe !== undefined) {
        faixaId.gt = depoisDe;
      }
      if (antesDe !== undefined) {
        faixaId.lt = antesDe;
      }
      where.id = faixaId;
    }

    const linhas = await prisma.logAtividade.findMany({
      where,
      orderBy: { id: 'desc' },
      take: limite + 1,
    });
    res.json({
      itens: linhas.slice(0, limite).map(paraLogDTO),
      haMais: linhas.length > limite,
    });
  })
);

router.get(
  '/logs/resumo',
  permitir('TITULAR'),
  asyncHandler(async (_req, res) => {
    const agora = new Date();
    const inicioJanela = new Date(agora.getTime() - MS_DIA);
    const linhas = await prisma.logAtividade.findMany({
      where: { criadoEm: { gte: inicioJanela } },
      orderBy: { id: 'desc' },
    });

    // Online: atividade nos últimos 5 minutos, um por usuário (mais recente primeiro).
    const inicioOnline = agora.getTime() - JANELA_ONLINE_MS;
    const porUsuario = new Map<number, { ultimo: LogAtividade; telaAtual: string | null }>();
    for (const l of linhas) {
      if (l.usuarioId === null || l.criadoEm.getTime() < inicioOnline) {
        continue;
      }
      let entrada = porUsuario.get(l.usuarioId);
      if (!entrada) {
        entrada = { ultimo: l, telaAtual: null };
        porUsuario.set(l.usuarioId, entrada);
      }
      if (entrada.telaAtual === null && l.tipo === 'TELA') {
        entrada.telaAtual = semPrefixoTela(l.descricao);
      }
    }
    const online = [...porUsuario.entries()].map(([usuarioId, entrada]) => ({
      usuarioId,
      nome: entrada.ultimo.usuarioNome ?? '',
      perfil: entrada.ultimo.perfil ?? '',
      ultimaDescricao: entrada.ultimo.descricao,
      ultimoTipo: entrada.ultimo.tipo,
      telaAtual: entrada.telaAtual,
      ultimaAtividade: entrada.ultimo.criadoEm.toISOString(),
    }));

    // Hoje: desde 00:00 local.
    const inicioHoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
    const hoje = linhas.filter((l) => l.criadoEm.getTime() >= inicioHoje.getTime());
    const contarTipos = (...tipos: string[]) => hoje.filter((l) => tipos.includes(l.tipo)).length;
    const usuariosHoje = new Set(hoje.filter((l) => l.usuarioId !== null).map((l) => l.usuarioId));

    // Últimas 24 horas por hora, da mais antiga para a atual.
    const horaAtual = new Date(agora);
    horaAtual.setMinutes(0, 0, 0);
    const primeiraHora = horaAtual.getTime() - 23 * MS_HORA;
    const contagemHoras = new Array<number>(24).fill(0);
    for (const l of linhas) {
      const indice = Math.floor((l.criadoEm.getTime() - primeiraHora) / MS_HORA);
      if (indice >= 0 && indice < 24) {
        contagemHoras[indice] += 1;
      }
    }
    const porHora = contagemHoras.map((total, i) => ({
      hora: `${new Date(primeiraHora + i * MS_HORA).getHours()}h`,
      total,
    }));

    const porModulo = contarPor(hoje, (l) => l.modulo)
      .slice(0, 8)
      .map((g) => ({ modulo: g.chave, total: g.total }));
    const porTipo = contarPor(hoje, (l) => l.tipo).map((g) => ({ tipo: g.chave, total: g.total }));

    const comUsuario = hoje.filter((l) => l.usuarioId !== null);
    const topUsuarios = contarPor(comUsuario, (l) => String(l.usuarioId))
      .slice(0, 8)
      .map((g) => {
        const exemplo = comUsuario.find((l) => String(l.usuarioId) === g.chave);
        return {
          usuarioId: Number(g.chave),
          nome: exemplo?.usuarioNome ?? '',
          perfil: exemplo?.perfil ?? '',
          total: g.total,
        };
      });

    res.json({
      agora: agora.toISOString(),
      online,
      hoje: {
        atividades: hoje.length,
        usuariosAtivos: usuariosHoje.size,
        logins: contarTipos('LOGIN'),
        falhasLogin: contarTipos('FALHA_LOGIN'),
        alteracoes: contarTipos('CRIACAO', 'ALTERACAO', 'EXCLUSAO'),
      },
      porHora,
      porModulo,
      porTipo,
      topUsuarios,
      recentes: linhas.slice(0, 15).map(paraLogDTO),
    });
  })
);

router.get(
  '/logs/usuarios/:id/resumo',
  permitir('TITULAR'),
  asyncHandler(async (req, res) => {
    const usuarioId = idParam(req);
    const agora = new Date();
    const inicioHoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
    const inicioSeteDias = new Date(agora.getTime() - 7 * MS_DIA);
    const inicioOnline = new Date(agora.getTime() - JANELA_ONLINE_MS);

    const [ultimoLogin, ultimaAtividade, ultimaTela, atividadesHoje, atividades7Dias, grupos] =
      await Promise.all([
        prisma.logAtividade.findFirst({
          where: { usuarioId, tipo: 'LOGIN' },
          orderBy: { id: 'desc' },
          select: { criadoEm: true },
        }),
        prisma.logAtividade.findFirst({
          where: { usuarioId },
          orderBy: { id: 'desc' },
          select: { criadoEm: true },
        }),
        prisma.logAtividade.findFirst({
          where: { usuarioId, tipo: 'TELA', criadoEm: { gte: inicioOnline } },
          orderBy: { id: 'desc' },
          select: { descricao: true },
        }),
        prisma.logAtividade.count({
          where: { usuarioId, criadoEm: { gte: inicioHoje } },
        }),
        prisma.logAtividade.count({
          where: { usuarioId, criadoEm: { gte: inicioSeteDias } },
        }),
        prisma.logAtividade.groupBy({
          by: ['tipo'],
          where: { usuarioId, criadoEm: { gte: inicioSeteDias } },
          _count: { _all: true },
        }),
      ]);

    res.json({
      ultimoLogin: ultimoLogin ? ultimoLogin.criadoEm.toISOString() : null,
      ultimaAtividade: ultimaAtividade ? ultimaAtividade.criadoEm.toISOString() : null,
      telaAtual: ultimaTela ? semPrefixoTela(ultimaTela.descricao) : null,
      online: ultimaAtividade !== null && ultimaAtividade.criadoEm.getTime() >= inicioOnline.getTime(),
      atividadesHoje,
      atividades7Dias,
      porTipo: grupos
        .map((g) => ({ tipo: g.tipo, total: g._count._all }))
        .sort((a, b) => b.total - a.total),
    });
  })
);

export default router;
