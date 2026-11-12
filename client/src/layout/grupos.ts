import type { RotaModulo } from '../lib/rotas';
import type { NomeIcone } from '../ui/icones';

export interface GrupoMenu {
  titulo: string;
  icones: NomeIcone[];
}

// Seções da barra lateral e da gaveta. A rota entra no grupo pelo ícone dela.
export const GRUPOS: GrupoMenu[] = [
  { titulo: '', icones: ['inicio'] },
  { titulo: 'Dia a dia', icones: ['contas', 'transacoes', 'cartao'] },
  { titulo: 'Patrimônio', icones: ['investimentos'] },
  { titulo: 'Planejamento', icones: ['orcamento', 'metas', 'categorias'] },
  { titulo: 'Trazer dados', icones: ['importar', 'conexoes', 'sincronizar'] },
  { titulo: 'Sistema', icones: ['usuarios', 'atividade', 'log', 'engrenagem'] },
  { titulo: 'Conta', icones: ['perfil'] },
];

const TITULO_OUTROS = 'Outros';

// Distribui as rotas do menu pelos grupos (pelo ícone). Mantém a ordem de `ordem` dentro de cada grupo,
// descarta grupos vazios e põe num grupo final "Outros" as rotas cujo ícone não está em nenhum grupo.
export function agrupar(rotas: RotaModulo[]): { titulo: string; rotas: RotaModulo[] }[] {
  const ordenadas = [...rotas].sort((a, b) => (a.ordem ?? 100) - (b.ordem ?? 100));
  const usadas = new Set<RotaModulo>();
  const resultado: { titulo: string; rotas: RotaModulo[] }[] = [];

  for (const grupo of GRUPOS) {
    const doGrupo = ordenadas.filter(
      (r) => !usadas.has(r) && grupo.icones.includes(r.icone),
    );
    doGrupo.forEach((r) => usadas.add(r));
    if (doGrupo.length > 0) resultado.push({ titulo: grupo.titulo, rotas: doGrupo });
  }

  const outros = ordenadas.filter((r) => !usadas.has(r));
  if (outros.length > 0) resultado.push({ titulo: TITULO_OUTROS, rotas: outros });

  return resultado;
}
