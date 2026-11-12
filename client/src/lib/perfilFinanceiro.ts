// Perfis financeiros: um mesmo login pode ter vários perfis (ex.: "Pessoal", "Empresa").
// O perfil escolhido vai no cabeçalho X-Perfil (ver api.ts), lido de localStorage['financas.perfil'].

export const CHAVE_PERFIL = 'financas.perfil';

export interface PerfilDTO {
  id: number;
  nome: string;
  cor: string; // '#rrggbb'
  criadoEm: string;
  atual: boolean; // é o perfil desta requisição
  contas: number; // contas e cartões ativos
  investimentos: number;
  patrimonio: number;
}

// Grava o perfil escolhido e recarrega o app na tela inicial, para todas as telas buscarem os dados do novo perfil.
export function trocarDePerfil(id: number): void {
  try {
    localStorage.setItem(CHAVE_PERFIL, String(id));
  } catch {
    // Sem acesso ao armazenamento local: o recarregamento ainda leva à tela inicial.
  }
  window.location.assign('/app');
}
