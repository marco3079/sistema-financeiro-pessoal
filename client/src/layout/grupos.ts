import type { RotaModulo } from '../lib/rotas';

export interface GrupoMenu {
  titulo: string;
  caminhos: string[];
}

// Seções da barra lateral e da gaveta, na ordem em que aparecem. A rota entra no grupo pelo caminho dela.
// (Pelo caminho e não pelo ícone: vários ícones se repetem em grupos diferentes.)
export const GRUPOS: GrupoMenu[] = [
  { titulo: '', caminhos: ['/app'] },
  {
    titulo: 'Dia a dia',
    caminhos: ['/app/rapido', '/app/transacoes', '/app/contas', '/app/cartoes', '/app/agenda'],
  },
  { titulo: 'Análises', caminhos: ['/app/analise', '/app/ano', '/app/relatorio-mensal', '/app/alertas'] },
  { titulo: 'Investimentos', caminhos: ['/app/carteira', '/app/investimentos', '/app/central/investimentos'] },
  { titulo: 'Planejamento', caminhos: ['/app/orcamento', '/app/metas', '/app/divisoes'] },
  { titulo: 'Dados', caminhos: ['/app/importar', '/app/central/dados'] },
  { titulo: 'Sistema', caminhos: ['/app/central/configuracoes', '/app/perfil'] },
];

const TITULO_OUTROS = 'Outros';

// Distribui as rotas do menu pelos grupos (pelo caminho). Mantém a ordem de `ordem` dentro de cada grupo,
// descarta grupos vazios e põe num grupo final "Outros" as rotas que não estão em nenhum grupo.
export function agrupar(rotas: RotaModulo[]): { titulo: string; rotas: RotaModulo[] }[] {
  const ordenadas = [...rotas].sort((a, b) => (a.ordem ?? 100) - (b.ordem ?? 100));
  const usadas = new Set<RotaModulo>();
  const resultado: { titulo: string; rotas: RotaModulo[] }[] = [];

  for (const grupo of GRUPOS) {
    const doGrupo = ordenadas.filter(
      (r) => !usadas.has(r) && grupo.caminhos.includes(r.caminho),
    );
    doGrupo.forEach((r) => usadas.add(r));
    if (doGrupo.length > 0) resultado.push({ titulo: grupo.titulo, rotas: doGrupo });
  }

  const outros = ordenadas.filter((r) => !usadas.has(r));
  if (outros.length > 0) resultado.push({ titulo: TITULO_OUTROS, rotas: outros });

  return resultado;
}
