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

// Categorias de um perfil Empresa, já com a linha da DRE em que cada uma entra.
const CATEGORIAS_EMPRESA: { nome: string; tipo: TipoTransacao; cor: string; grupoDre: string }[] = [
  { nome: 'Vendas de produtos', tipo: 'RECEITA', cor: '#10b981', grupoDre: 'RECEITA' },
  { nome: 'Prestação de serviços', tipo: 'RECEITA', cor: '#2563eb', grupoDre: 'RECEITA' },
  { nome: 'Outras receitas', tipo: 'RECEITA', cor: '#64748b', grupoDre: 'RECEITA' },
  { nome: 'Rendimentos financeiros', tipo: 'RECEITA', cor: '#06b6d4', grupoDre: 'FINANCEIRO' },
  { nome: 'Impostos sobre vendas', tipo: 'DESPESA', cor: '#475569', grupoDre: 'DEDUCAO' },
  { nome: 'Devoluções e descontos', tipo: 'DESPESA', cor: '#94a3b8', grupoDre: 'DEDUCAO' },
  { nome: 'Custo de mercadorias e insumos', tipo: 'DESPESA', cor: '#f59e0b', grupoDre: 'CUSTO' },
  { nome: 'Custo de serviços prestados', tipo: 'DESPESA', cor: '#f97316', grupoDre: 'CUSTO' },
  { nome: 'Fretes e entregas', tipo: 'DESPESA', cor: '#84cc16', grupoDre: 'CUSTO' },
  { nome: 'Folha de pagamento', tipo: 'DESPESA', cor: '#7c3aed', grupoDre: 'DESPESA' },
  { nome: 'Pró-labore', tipo: 'DESPESA', cor: '#8b5cf6', grupoDre: 'DESPESA' },
  { nome: 'Aluguel e condomínio', tipo: 'DESPESA', cor: '#2563eb', grupoDre: 'DESPESA' },
  { nome: 'Água, luz e internet', tipo: 'DESPESA', cor: '#06b6d4', grupoDre: 'DESPESA' },
  { nome: 'Marketing e vendas', tipo: 'DESPESA', cor: '#ec4899', grupoDre: 'DESPESA' },
  { nome: 'Sistemas e assinaturas', tipo: 'DESPESA', cor: '#0ea5e9', grupoDre: 'DESPESA' },
  { nome: 'Contabilidade e serviços', tipo: 'DESPESA', cor: '#14b8a6', grupoDre: 'DESPESA' },
  { nome: 'Manutenção e material', tipo: 'DESPESA', cor: '#a16207', grupoDre: 'DESPESA' },
  { nome: 'Outras despesas', tipo: 'DESPESA', cor: '#94a3b8', grupoDre: 'DESPESA' },
  { nome: 'Juros e tarifas bancárias', tipo: 'DESPESA', cor: '#dc2626', grupoDre: 'FINANCEIRO' },
  { nome: 'Impostos sobre o lucro', tipo: 'DESPESA', cor: '#334155', grupoDre: 'IMPOSTO' },
];

// Cria as categorias padrão de um perfil financeiro. Idempotente: as que já existem (mesmo nome e tipo) são mantidas.
export async function criarCategoriasPadrao(prisma: PrismaClient, perfilId = 1, tipoDoPerfil: 'PESSOAL' | 'EMPRESA' = 'PESSOAL'): Promise<void> {
  const existentes = await prisma.categoria.findMany({ where: { perfilId }, select: { nome: true, tipo: true } });
  const ja = new Set(existentes.map((c) => c.tipo + '|' + c.nome));
  const lista: { nome: string; tipo: TipoTransacao; cor: string; grupoDre?: string }[] = tipoDoPerfil === 'EMPRESA' ? CATEGORIAS_EMPRESA : CATEGORIAS_PADRAO;
  const novas = lista.filter((c) => !ja.has(c.tipo + '|' + c.nome)).map((c) => ({ ...c, perfilId }));
  if (novas.length > 0) await prisma.categoria.createMany({ data: novas });
}
