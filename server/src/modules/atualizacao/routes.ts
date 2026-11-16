import fs from 'fs/promises';
import path from 'path';
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, HttpError, validar } from '../../lib/erros';

// Atualização do sistema pelo GitHub. O servidor roda dentro do Docker e não consegue atualizar a si mesmo; quem
// atualiza é o script atualizar.ps1, no computador. Os dois conversam por arquivos na pasta ./atualizacao
// (montada aqui em /atualizacao):
//   versao.json  gravado pelo script: commit instalado, ramo e repositório
//   estado.json  gravado pelo script: situação da última atualização e o "batimento" do vigia
//   pedido.json  gravado aqui quando a pessoa clica em Atualizar; o vigia apaga e roda a atualização
// O servidor só escreve o pedido: não executa comando nenhum.

const router = Router();

const PASTA = '/atualizacao';
const ARQUIVO_VERSAO = path.join(PASTA, 'versao.json');
const ARQUIVO_ESTADO = path.join(PASTA, 'estado.json');
const ARQUIVO_PEDIDO = path.join(PASTA, 'pedido.json');
const VIGIA_VIVO_MS = 60 * 1000;
const VALIDADE_DO_GITHUB_MS = 5 * 60 * 1000;

interface Versao {
  commit: string;
  data: string | null;
  mensagem: string | null;
  ramo: string;
  repositorio: string;
}

interface CommitDTO {
  commit: string;
  data: string | null;
  mensagem: string;
}

async function lerJson(arquivo: string): Promise<Record<string, unknown> | null> {
  try {
    // O PowerShell pode gravar com BOM.
    const texto = (await fs.readFile(arquivo, 'utf8')).replace(/^﻿/, '');
    const dados: unknown = JSON.parse(texto);
    return dados !== null && typeof dados === 'object' ? (dados as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() !== '' ? valor.trim() : null;
}

async function versaoInstalada(): Promise<Versao | null> {
  const v = await lerJson(ARQUIVO_VERSAO);
  const commit = texto(v?.commit);
  const repositorio = texto(v?.repositorio);
  const ramo = texto(v?.ramo);
  // Só aceita o que tem cara de commit, de "dono/repositório" e de nome de ramo: esses textos vão para a URL do GitHub.
  if (!commit || !/^[0-9a-f]{7,40}$/i.test(commit)) return null;
  if (!repositorio || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repositorio) || repositorio.split('/').some((parte) => /^\.+$/.test(parte))) return null;
  if (!ramo || !/^[A-Za-z0-9_./-]{1,100}$/.test(ramo) || ramo.includes('..')) return null;
  return { commit, data: texto(v?.data), mensagem: texto(v?.mensagem), ramo, repositorio };
}

// Primeira linha da mensagem do commit.
function titulo(mensagem: unknown): string {
  return (typeof mensagem === 'string' ? mensagem : '').split('\n')[0].slice(0, 200);
}

interface DoGitHub {
  ultimo: CommitDTO | null;
  novos: CommitDTO[]; // commits que faltam aqui, do mais novo para o mais antigo
  erro: string | null;
}

let guardado: { chave: string; em: number; dados: DoGitHub } | null = null;

async function github(caminho: string): Promise<unknown> {
  const resposta = await fetch('https://api.github.com' + caminho, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'financas-pessoais' },
    signal: AbortSignal.timeout(15000),
  });
  if (resposta.status === 403 || resposta.status === 429) throw new Error('O GitHub limitou as consultas. Tente de novo em alguns minutos.');
  if (resposta.status === 404) throw new Error('Repositório ou commit não encontrado no GitHub (o repositório precisa ser público).');
  if (!resposta.ok) throw new Error(`O GitHub respondeu ${resposta.status}.`);
  return resposta.json();
}

async function consultarGitHub(v: Versao, forcar: boolean): Promise<DoGitHub> {
  const chave = `${v.repositorio}|${v.ramo}|${v.commit}`;
  if (!forcar && guardado && guardado.chave === chave && Date.now() - guardado.em < VALIDADE_DO_GITHUB_MS) return guardado.dados;
  let dados: DoGitHub;
  try {
    const repositorio = v.repositorio.split('/').map(encodeURIComponent).join('/');
    const comparacao = (await github(`/repos/${repositorio}/compare/${encodeURIComponent(v.commit)}...${encodeURIComponent(v.ramo)}`)) as {
      commits?: { sha?: string; commit?: { message?: string; committer?: { date?: string } } }[];
    };
    const novos = (comparacao.commits ?? [])
      .map((c) => ({ commit: String(c.sha ?? ''), data: c.commit?.committer?.date ?? null, mensagem: titulo(c.commit?.message) }))
      .filter((c) => c.commit !== '')
      .reverse()
      .slice(0, 30);
    dados = { ultimo: novos[0] ?? { commit: v.commit, data: v.data, mensagem: v.mensagem ?? '' }, novos, erro: null };
  } catch (erro) {
    dados = { ultimo: null, novos: [], erro: erro instanceof Error ? erro.message : 'Não consegui consultar o GitHub.' };
  }
  guardado = { chave, em: Date.now(), dados };
  return dados;
}

async function montarEstado(forcar: boolean) {
  const [instalada, estado, pedidoLido] = await Promise.all([versaoInstalada(), lerJson(ARQUIVO_ESTADO), lerJson(ARQUIVO_PEDIDO)]);
  // Pedido que ninguém atendeu em 10 minutos (o atualizador foi desligado) é descartado, para a tela não ficar presa.
  let pedido = pedidoLido;
  const pedidoEm = texto(pedidoLido?.pedidoEm);
  if (pedidoLido && (!pedidoEm || Date.now() - new Date(pedidoEm).getTime() > 10 * 60 * 1000)) {
    await fs.rm(ARQUIVO_PEDIDO, { force: true }).catch(() => undefined);
    pedido = null;
  }
  const vistoEm = texto(estado?.vigiaVistoEm);
  const vigiaAtivo = vistoEm !== null && Date.now() - new Date(vistoEm).getTime() < VIGIA_VIVO_MS;
  const doGitHub = instalada ? await consultarGitHub(instalada, forcar) : { ultimo: null, novos: [], erro: null };
  const situacao = texto(estado?.situacao);
  return {
    // null: o script ainda não rodou neste computador (não sabemos qual commit está instalado).
    instalada: instalada ? { commit: instalada.commit, data: instalada.data, mensagem: instalada.mensagem, repositorio: instalada.repositorio, ramo: instalada.ramo } : null,
    ultima: doGitHub.ultimo,
    novidades: doGitHub.novos,
    haNovidade: doGitHub.novos.length > 0,
    erroDoGitHub: doGitHub.erro,
    vigiaAtivo,
    pedidoPendente: pedido !== null,
    ultimaAtualizacao:
      situacao === 'ATUALIZANDO' || situacao === 'OK' || situacao === 'ERRO'
        ? { situacao, mensagem: texto(estado?.mensagem) ?? '', em: texto(estado?.em) }
        : null,
  };
}

router.get(
  '/atualizacao',
  asyncHandler(async (req, res) => {
    res.json(await montarEstado(req.query.conferir === '1'));
  })
);

// Pede a atualização: grava o pedido para o vigia do computador. Só funciona com o vigia ligado.
router.post(
  '/atualizacao/pedir',
  asyncHandler(async (_req, res) => {
    const estado = await montarEstado(false);
    if (!estado.vigiaAtivo) {
      throw new HttpError(400, 'O atualizador não está ligado neste computador. Rode "atualizar.ps1 -Instalar" uma vez, ou atualize com "atualizar.ps1".');
    }
    if (estado.ultimaAtualizacao?.situacao === 'ATUALIZANDO' || estado.pedidoPendente) {
      throw new HttpError(409, 'Já há uma atualização em andamento.');
    }
    await fs.writeFile(ARQUIVO_PEDIDO, JSON.stringify({ tipo: 'ATUALIZAR', pedidoEm: new Date().toISOString() }));
    res.status(202).json(await montarEstado(false));
  })
);

// ---------- Cópias do banco ----------

const PASTA_COPIAS = '/backups';
const NOME_DE_COPIA = /^financas-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.sql$/;

// Cópias guardadas pelo atualizador (a pasta é montada só para leitura).
router.get(
  '/atualizacao/copias',
  asyncHandler(async (_req, res) => {
    let nomes: string[] = [];
    try {
      nomes = await fs.readdir(PASTA_COPIAS);
    } catch {
      nomes = [];
    }
    const copias = [];
    for (const nome of nomes) {
      const partes = NOME_DE_COPIA.exec(nome);
      if (!partes) continue;
      const info = await fs.stat(path.join(PASTA_COPIAS, nome)).catch(() => null);
      if (!info || !info.isFile() || info.size === 0) continue;
      copias.push({
        arquivo: nome,
        // Hora local do computador em que a cópia foi feita.
        feitaEm: `${partes[1]}-${partes[2]}-${partes[3]}T${partes[4]}:${partes[5]}:${partes[6]}`,
        tamanho: info.size,
      });
    }
    copias.sort((a, b) => (a.arquivo < b.arquivo ? 1 : -1));
    res.json({ copias, vigiaAtivo: (await montarEstado(false)).vigiaAtivo });
  })
);

// Pede a restauração de uma cópia: grava o pedido para o atualizador do computador. O servidor não mexe no banco.
router.post(
  '/atualizacao/restaurar',
  asyncHandler(async (req, res) => {
    const dados = validar(z.object({ arquivo: z.string().regex(NOME_DE_COPIA, 'Cópia inválida') }), req.body);
    const info = await fs.stat(path.join(PASTA_COPIAS, dados.arquivo)).catch(() => null);
    if (!info || !info.isFile()) throw new HttpError(404, 'Cópia não encontrada');
    const estado = await montarEstado(false);
    if (!estado.vigiaAtivo) {
      throw new HttpError(400, 'O atualizador não está ligado neste computador. Rode "atualizar.ps1 -Instalar" uma vez, ou restaure com "atualizar.ps1 -Restaurar ' + dados.arquivo + '".');
    }
    if (estado.ultimaAtualizacao?.situacao === 'ATUALIZANDO' || estado.pedidoPendente) {
      throw new HttpError(409, 'Já há uma atualização ou restauração em andamento.');
    }
    await fs.writeFile(ARQUIVO_PEDIDO, JSON.stringify({ tipo: 'RESTAURAR', arquivo: dados.arquivo, pedidoEm: new Date().toISOString() }));
    res.status(202).json(await montarEstado(false));
  })
);

export default router;
