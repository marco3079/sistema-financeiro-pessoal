import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { permitir } from '../../lib/auth';
import { z } from 'zod';
import { asyncHandler, HttpError, validar } from '../../lib/erros';
import { prismaSemPerfil } from '../../lib/prisma';

// Status do servidor: situação de cada contêiner do sistema. A API não tem acesso ao Docker; quem mede é o
// contêiner atualizador, que grava atualizacao/conteineres.json a cada 15 segundos. Aqui só lemos esse arquivo e
// juntamos o que a própria API sabe (há quanto tempo está no ar, memória e resposta do banco). Só o titular.

const router = Router();

const PASTA = '/atualizacao';
const ARQUIVO_CONTEINERES = path.join(PASTA, 'conteineres.json');
const ARQUIVO_VERSAO = path.join(PASTA, 'versao.json');
const ARQUIVO_ESTADO = path.join(PASTA, 'estado.json');
const ARQUIVO_REINICIO = path.join(PASTA, 'reinicio.json');
const ARQUIVO_REINICIO_ESTADO = path.join(PASTA, 'reinicio-estado.json');
const DEFASADO_APOS_MS = 60_000;
const NO_AR_DESDE = new Date().toISOString();

type EstadoConteiner = 'NO_AR' | 'INICIANDO' | 'COM_PROBLEMA' | 'REINICIANDO' | 'PARADO' | 'NAO_CRIADO';

// Nome amigável, para que serve e se o sistema para sem ele. A ordem aqui é a ordem na tela.
const SERVICOS: { servico: string; nome: string; descricao: string; essencial: boolean }[] = [
  { servico: 'web', nome: 'Site', descricao: 'As telas que você abre no navegador.', essencial: true },
  { servico: 'api', nome: 'Servidor', descricao: 'Regras, cálculos e acesso aos dados.', essencial: true },
  { servico: 'db', nome: 'Banco de dados', descricao: 'Onde ficam guardados todos os dados.', essencial: true },
  { servico: 'atualizador', nome: 'Atualizador', descricao: 'Atualiza o sistema, faz cópias do banco e mede este status.', essencial: false },
  { servico: 'https', nome: 'Acesso seguro (HTTPS)', descricao: 'Endereço https pelo Tailscale, para o celular.', essencial: false },
  { servico: 'suno', nome: 'Leitor da Suno', descricao: 'Lê as carteiras recomendadas da Suno quando você pede.', essencial: false },
  { servico: 'calculadora', nome: 'Calculadora da reforma tributária', descricao: 'Calculadora oficial da Receita (CBS, IBS e Imposto Seletivo).', essencial: false },
];

async function lerJson(arquivo: string): Promise<Record<string, unknown> | null> {
  try {
    const texto = (await fs.readFile(arquivo, 'utf8')).replace(/^﻿/, '');
    const dados: unknown = JSON.parse(texto);
    return dados !== null && typeof dados === 'object' && !Array.isArray(dados) ? (dados as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function texto(valor: unknown, maximo: number): string | null {
  return typeof valor === 'string' && valor.trim() !== '' ? valor.trim().slice(0, maximo) : null;
}

function estadoDe(estadoDocker: string, saude: string): EstadoConteiner {
  switch (estadoDocker.toLowerCase()) {
    case 'running':
      if (saude.toLowerCase() === 'unhealthy') return 'COM_PROBLEMA';
      if (saude.toLowerCase() === 'starting') return 'INICIANDO';
      return 'NO_AR';
    case 'restarting':
      return 'REINICIANDO';
    case 'created':
      return 'INICIANDO';
    case 'paused':
    case 'exited':
      return 'PARADO';
    case 'dead':
    case 'removing':
      return 'COM_PROBLEMA';
    default:
      return 'COM_PROBLEMA';
  }
}

// "2026-11-23 21:13:36 -0300 -03" (formato do Docker) -> ISO; se não der para ler, null.
function dataDoDocker(bruta: string | null): string | null {
  if (!bruta) return null;
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})/.exec(bruta);
  const data = new Date(m ? `${m[1]}T${m[2]}${m[3]}:${m[4]}` : bruta);
  return Number.isNaN(data.getTime()) ? null : data.toISOString();
}

// Um reinício "em andamento" há mais de 5 minutos foi interrompido (computador reiniciado, atualizador caiu).
function reinicioParado(em: string | null): boolean {
  const quando = new Date(em ?? '').getTime();
  return Number.isNaN(quando) || Date.now() - quando > 5 * 60_000;
}

router.get(
  '/servidor/status',
  permitir('TITULAR'),
  asyncHandler(async (_req, res) => {
    const [medicao, versao, reinicioLido, pedidoDeReinicio] = await Promise.all([
      lerJson(ARQUIVO_CONTEINERES),
      lerJson(ARQUIVO_VERSAO),
      lerJson(ARQUIVO_REINICIO_ESTADO),
      lerJson(ARQUIVO_REINICIO),
    ]);

    const medidoEm = texto(medicao?.medidoEm, 40);
    const quando = medidoEm ? new Date(medidoEm).getTime() : NaN;
    const defasado = Number.isNaN(quando) || Date.now() - quando > DEFASADO_APOS_MS;

    const brutos = Array.isArray(medicao?.conteineres) ? (medicao.conteineres as unknown[]) : [];
    const medidos = new Map<string, Record<string, unknown>>();
    for (const item of brutos.slice(0, 50)) {
      if (item === null || typeof item !== 'object') continue;
      const registro = item as Record<string, unknown>;
      const servico = texto(registro.servico, 40);
      if (servico && /^[a-z0-9_-]+$/i.test(servico) && !medidos.has(servico)) medidos.set(servico, registro);
    }
    const esperados = Array.isArray(medicao?.servicos)
      ? (medicao.servicos as unknown[]).filter((s): s is string => typeof s === 'string' && /^[a-z0-9_-]+$/i.test(s)).slice(0, 50)
      : [];

    // Conhecidos na ordem da tela; depois, qualquer serviço que o Compose tenha e a lista acima não conheça.
    const nomes = [...SERVICOS.map((s) => s.servico).filter((s) => medidos.has(s) || esperados.includes(s))];
    for (const s of [...esperados, ...medidos.keys()]) if (!nomes.includes(s)) nomes.push(s);

    const conteineres = medicao
      ? nomes.map((servico) => {
          const info = SERVICOS.find((s) => s.servico === servico);
          const m = medidos.get(servico);
          const estado: EstadoConteiner = m ? estadoDe(texto(m.estado, 20) ?? '', texto(m.saude, 20) ?? '') : 'NAO_CRIADO';
          return {
            servico,
            nome: info?.nome ?? servico,
            descricao: info?.descricao ?? 'Serviço do sistema.',
            estado,
            detalhe: m ? texto(m.detalhe, 120) : null,
            desde: m ? dataDoDocker(texto(m.criadoEm, 60)) : null,
            cpu: m ? texto(m.cpu, 20) : null,
            memoria: m ? texto(m.memoria, 40) : null,
            // Últimas linhas do registro, só para contêiner que não está bem (o atualizador já tira links e chaves).
            registro: m ? texto(m.registro, 3000) : null,
            essencial: info?.essencial ?? false,
          };
        })
      : [];

    const inicio = Date.now();
    const bancoOk = await prismaSemPerfil.$queryRaw`SELECT 1`.then(
      () => true,
      () => false
    );
    const bancoMs = bancoOk ? Date.now() - inicio : null;
    const commit = texto(versao?.commit, 40);

    // Último reinício pedido pela tela (ou o que ainda espera o atualizador pegar).
    const situacaoReinicio = texto(reinicioLido?.situacao, 20);
    const reinicio = pedidoDeReinicio
      ? { situacao: 'REINICIANDO', servico: texto(pedidoDeReinicio.servico, 40), mensagem: 'Aguardando o atualizador...', em: texto(pedidoDeReinicio.pedidoEm, 40) }
      : situacaoReinicio && ['REINICIANDO', 'OK', 'ERRO'].includes(situacaoReinicio)
        ? situacaoReinicio === 'REINICIANDO' && reinicioParado(texto(reinicioLido?.em, 40))
          ? { situacao: 'ERRO', servico: texto(reinicioLido?.servico, 40), mensagem: 'O reinício não terminou (o atualizador foi interrompido no meio). Tente de novo.', em: new Date().toISOString() }
          : { situacao: situacaoReinicio, servico: texto(reinicioLido?.servico, 40), mensagem: texto(reinicioLido?.mensagem, 300), em: texto(reinicioLido?.em, 40) }
        : null;

    res.json({
      atualizadoEm: Number.isNaN(quando) ? null : new Date(quando).toISOString(),
      defasado,
      podeReiniciar: !defasado,
      reinicio,
      resumo: {
        total: conteineres.length,
        noAr: conteineres.filter((c) => c.estado === 'NO_AR').length,
        comProblema: conteineres.filter(
          (c) => c.estado === 'COM_PROBLEMA' || c.estado === 'REINICIANDO' || (c.essencial && (c.estado === 'PARADO' || c.estado === 'NAO_CRIADO'))
        ).length,
      },
      conteineres,
      servidor: {
        noArDesde: NO_AR_DESDE,
        versao: commit && /^[0-9a-f]{7,40}$/i.test(commit) ? commit.slice(0, 7) : null,
        node: process.version,
        memoriaMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        bancoOk,
        bancoMs,
      },
    });
  })
);

// Pede ao atualizador para reiniciar um contêiner, ou todos. A API não tem acesso ao Docker: só grava o pedido.
const reiniciarSchema = z.object({ servico: z.string().trim().min(1).max(40) });

router.post(
  '/servidor/reiniciar',
  permitir('TITULAR'),
  asyncHandler(async (req, res) => {
    const { servico } = validar(reiniciarSchema, req.body);
    const [medicao, estado, pendente, ultimo] = await Promise.all([
      lerJson(ARQUIVO_CONTEINERES),
      lerJson(ARQUIVO_ESTADO),
      lerJson(ARQUIVO_REINICIO),
      lerJson(ARQUIVO_REINICIO_ESTADO),
    ]);
    const medidoEm = texto(medicao?.medidoEm, 40);
    const quando = medidoEm ? new Date(medidoEm).getTime() : NaN;
    if (Number.isNaN(quando) || Date.now() - quando > DEFASADO_APOS_MS) {
      throw new HttpError(400, 'O atualizador não está respondendo, e é ele quem reinicia os contêineres. No computador, rode: docker compose up -d');
    }
    if (texto(estado?.situacao, 20) === 'ATUALIZANDO') throw new HttpError(409, 'Há uma atualização em andamento. Tente de novo quando ela terminar.');
    // Em andamento: pedido ainda não pego pelo atualizador, ou reinício começado há menos de 5 minutos.
    const comecou = new Date(texto(ultimo?.em, 40) ?? '').getTime();
    const emAndamento = texto(ultimo?.situacao, 20) === 'REINICIANDO' && !Number.isNaN(comecou) && Date.now() - comecou < 5 * 60_000;
    if (pendente || emAndamento) throw new HttpError(409, 'Já há um reinício em andamento.');
    const conhecidos = Array.isArray(medicao?.servicos)
      ? (medicao.servicos as unknown[]).filter((s): s is string => typeof s === 'string' && /^[a-z0-9_-]+$/i.test(s))
      : [];
    if (servico !== 'TODOS' && !conhecidos.includes(servico)) throw new HttpError(400, 'Contêiner desconhecido');
    if (servico === 'atualizador') throw new HttpError(400, 'O atualizador não se reinicia por aqui: é ele quem reinicia os outros.');
    await fs.writeFile(ARQUIVO_REINICIO, JSON.stringify({ servico, pedidoEm: new Date().toISOString() }));
    res.status(202).json({ aceito: true });
  })
);

export default router;
