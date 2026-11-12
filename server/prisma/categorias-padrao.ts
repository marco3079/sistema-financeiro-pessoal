import type { PrismaClient, TipoTransacao } from '@prisma/client';

// Categorias criadas na primeira subida. Este arquivo roda fora do servidor: não importa nada de src/.

const CATEGORIAS_PADRAO: { nome: string; tipo: TipoTransacao; cor: string }[] = [
  { nome: 'Moradia', tipo: 'DESPESA', cor: '#2563eb' },
  { nome: 'Mercado', tipo: 'DESPESA', cor: '#10b981' },
  { nome: 'Restaurantes', tipo: 'DESPESA', cor: '#f59e0b' },
  { nome: 'Transporte', tipo: 'DESPESA', cor: '#06b6d4' },
  { nome: 'Saúde', tipo: 'DESPESA', cor: '#dc2626' },
  { nome: 'Educação', tipo: 'DESPESA', cor: '#7c3aed' },
  { nome: 'Lazer', tipo: 'DESPESA', cor: '#ec4899' },
  { nome: 'Assinaturas', tipo: 'DESPESA', cor: '#f97316' },
  { nome: 'Compras', tipo: 'DESPESA', cor: '#84cc16' },
  { nome: 'Contas da casa', tipo: 'DESPESA', cor: '#64748b' },
  { nome: 'Impostos e taxas', tipo: 'DESPESA', cor: '#475569' },
  { nome: 'Outros', tipo: 'DESPESA', cor: '#94a3b8' },
  { nome: 'Salário', tipo: 'RECEITA', cor: '#10b981' },
  { nome: 'Rendimentos', tipo: 'RECEITA', cor: '#2563eb' },
  { nome: 'Freelance', tipo: 'RECEITA', cor: '#7c3aed' },
  { nome: 'Reembolsos', tipo: 'RECEITA', cor: '#06b6d4' },
  { nome: 'Outras receitas', tipo: 'RECEITA', cor: '#64748b' },
];

// Cria as categorias padrão de um perfil financeiro. Idempotente: as que já existem (mesmo nome e tipo) são mantidas.
export async function criarCategoriasPadrao(prisma: PrismaClient, perfilId = 1): Promise<void> {
  const existentes = await prisma.categoria.findMany({ where: { perfilId }, select: { nome: true, tipo: true } });
  const ja = new Set(existentes.map((c) => c.tipo + '|' + c.nome));
  const novas = CATEGORIAS_PADRAO.filter((c) => !ja.has(c.tipo + '|' + c.nome)).map((c) => ({ ...c, perfilId }));
  if (novas.length > 0) await prisma.categoria.createMany({ data: novas });
}
