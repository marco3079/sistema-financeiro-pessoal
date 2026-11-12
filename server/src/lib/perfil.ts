// Perfis financeiros: qual perfil vale em cada requisição e como rodar tarefas de fundo em todos.
// O navegador manda o perfil escolhido no cabeçalho X-Perfil; sem ele (ou com um perfil que não existe mais),
// vale o primeiro perfil. O filtro dos dados é aplicado em lib/prisma.ts.

import type { NextFunction, Request, Response } from 'express';
import { comPerfil, prisma } from './prisma';
import { criarCategoriasPadrao } from '../../prisma/categorias-padrao';

let conhecidos: number[] | null = null;

// Esquece a lista guardada (chame depois de criar ou apagar um perfil).
export function esquecerPerfis(): void {
  conhecidos = null;
}

// Ids dos perfis, do mais antigo para o mais novo. Cria o perfil "Pessoal" se o banco ainda não tiver nenhum.
export async function idsDosPerfis(): Promise<number[]> {
  if (conhecidos) return conhecidos;
  let perfis = await prisma.perfilFinanceiro.findMany({ select: { id: true }, orderBy: { id: 'asc' } });
  if (perfis.length === 0) {
    // O primeiro perfil precisa ser o de id 1: é o valor padrão da coluna perfilId dos registros que já existiam.
    await prisma.perfilFinanceiro.createMany({ data: [{ id: 1, nome: 'Pessoal' }], skipDuplicates: true });
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('"PerfilFinanceiro"', 'id'), GREATEST((SELECT MAX(id) FROM "PerfilFinanceiro"), 1))`
    );
    perfis = await prisma.perfilFinanceiro.findMany({ select: { id: true }, orderBy: { id: 'asc' } });
  }
  conhecidos = perfis.map((p) => p.id);
  return conhecidos;
}

// Middleware das rotas autenticadas: põe o perfil da requisição no contexto.
export function escolherPerfil(req: Request, _res: Response, next: NextFunction): void {
  idsDosPerfis()
    .then((ids) => {
      const pedido = Number(req.header('x-perfil'));
      const perfilId = Number.isInteger(pedido) && ids.includes(pedido) ? pedido : ids[0];
      comPerfil(perfilId, next);
    })
    .catch(next);
}

// Roda `fn` uma vez para cada perfil, em sequência (tarefas de fundo: cotações, índices).
export async function emCadaPerfil(fn: (perfilId: number) => Promise<unknown>): Promise<void> {
  for (const perfilId of await idsDosPerfis()) {
    await comPerfil(perfilId, () => fn(perfilId));
  }
}

// Cria um perfil já com as categorias padrão.
export async function criarPerfil(nome: string, cor: string): Promise<{ id: number; nome: string; cor: string; criadoEm: Date }> {
  await idsDosPerfis();
  const perfil = await prisma.perfilFinanceiro.create({ data: { nome, cor } });
  // Dentro do perfil novo: a requisição que cria o perfil ainda está no perfil antigo.
  await comPerfil(perfil.id, () => criarCategoriasPadrao(prisma, perfil.id));
  esquecerPerfis();
  return perfil;
}

// Apaga um perfil e tudo o que é dele.
export async function apagarPerfil(perfilId: number): Promise<void> {
  await comPerfil(perfilId, async () => {
    await prisma.$transaction(
      async (db) => {
        await db.orcamento.deleteMany({});
        await db.meta.deleteMany({});
        await db.movimentoInvestimento.deleteMany({});
        await db.investimento.deleteMany({});
        await db.transacao.deleteMany({});
        await db.fatura.deleteMany({});
        await db.conta.deleteMany({});
        await db.conexaoBancaria.deleteMany({});
        await db.categoria.deleteMany({});
        await db.posicaoPatrimonio.deleteMany({});
        await db.importacao.deleteMany({});
        await db.chaveMcp.deleteMany({ where: { perfilId } });
        await db.perfilFinanceiro.delete({ where: { id: perfilId } });
      },
      { timeout: 60000 }
    );
  });
  esquecerPerfis();
}
