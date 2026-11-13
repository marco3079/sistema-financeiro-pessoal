import { AsyncLocalStorage } from 'node:async_hooks';
import { PrismaClient } from '@prisma/client';

// Perfis financeiros: cada requisição roda "dentro" de um perfil (ver lib/perfil.ts). Enquanto houver um perfil
// no contexto, toda leitura e escrita nos modelos abaixo é filtrada por ele aqui, em um lugar só:
// as rotas não precisam (nem devem) repetir `perfilId` nas consultas.
// Fora de um contexto (tarefas de fundo que não escolheram perfil) nada é filtrado.

const MODELOS_DO_PERFIL = new Set([
  'ConexaoBancaria',
  'Conta',
  'Categoria',
  'Transacao',
  'Fatura',
  'Investimento',
  'MovimentoInvestimento',
  'PosicaoPatrimonio',
  'Importacao',
  'Orcamento',
  'Meta',
  'RegraCategoria',
  'ContaFixa',
  'PagamentoContaFixa',
  'AlocacaoAlvo',
  'Divisao',
  'EventoAtivo',
  'AvisoEnviado',
]);

const contexto = new AsyncLocalStorage<{ perfilId: number }>();

// Executa `fn` com o perfil escolhido; vale para tudo o que `fn` chamar, inclusive depois de `await`.
export function comPerfil<T>(perfilId: number, fn: () => T): T {
  return contexto.run({ perfilId }, fn);
}

// Perfil da requisição em andamento; null fora de um contexto.
export function perfilAtual(): number | null {
  return contexto.getStore()?.perfilId ?? null;
}

type Args = { where?: Record<string, unknown>; data?: unknown; create?: Record<string, unknown> };

const COM_FILTRO = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
]);

const base = new PrismaClient();

const comPerfis = base.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const perfilId = perfilAtual();
        if (perfilId === null || !MODELOS_DO_PERFIL.has(model)) return query(args);
        const a = (args ?? {}) as Args;
        if (COM_FILTRO.has(operation)) {
          a.where = { ...(a.where ?? {}), perfilId };
        } else if (operation === 'create') {
          a.data = { ...(a.data as Record<string, unknown>), perfilId };
        } else if (operation === 'createMany' || operation === 'createManyAndReturn') {
          a.data = Array.isArray(a.data)
            ? a.data.map((linha: Record<string, unknown>) => ({ ...linha, perfilId }))
            : { ...(a.data as Record<string, unknown>), perfilId };
        } else if (operation === 'upsert') {
          a.where = { ...(a.where ?? {}), perfilId };
          a.create = { ...(a.create ?? {}), perfilId };
        }
        return query(a as typeof args);
      },
    },
  },
});

// O cliente estendido tem o mesmo formato do PrismaClient (a extensão só mexe nos argumentos das consultas);
// exportar com o tipo original mantém `Prisma.TransactionClient` e os demais tipos do projeto funcionando.
export const prisma = comPerfis as unknown as PrismaClient;

// Cliente sem o filtro de perfil: só para o que precisa enxergar o banco inteiro (cópia para o Drive).
export const prismaSemPerfil = base;
