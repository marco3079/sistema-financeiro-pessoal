// Perfis financeiros: um mesmo login pode ter vários perfis (ex.: "Pessoal", "Empresa").
// O perfil escolhido vai no cabeçalho X-Perfil (ver api.ts), lido de localStorage['financas.perfil'].
// Perfil com senha: depois de digitada, o servidor devolve um "desbloqueio", guardado aqui até sair do sistema e
// mandado no cabeçalho X-Perfil-Desbloqueio.

export const CHAVE_PERFIL = 'financas.perfil';
const CHAVE_DESBLOQUEIOS = 'financas.desbloqueios';

export type TipoDePerfil = 'PESSOAL' | 'EMPRESA';

// ADMIN = titular (todos os perfis). EDICAO e LEITURA = nível do membro neste perfil.
export type NivelPerfil = 'ADMIN' | 'EDICAO' | 'LEITURA';

export interface PerfilDTO {
  id: number;
  nome: string;
  cor: string; // '#rrggbb'
  tipo: TipoDePerfil; // Empresa troca o menu e as telas
  criadoEm: string;
  atual: boolean; // é o perfil desta requisição
  nivel: NivelPerfil;
  podeGerenciar: boolean; // define acessos e senha deste perfil
  protegido: boolean; // tem senha
  bloqueado: boolean; // tem senha e ainda não foi desbloqueado neste login
  contas: number | null; // contas e cartões ativos (null se bloqueado)
  investimentos: number | null;
  patrimonio: number | null;
}

export const NOME_DO_NIVEL: Record<NivelPerfil, string> = {
  ADMIN: 'Titular',
  EDICAO: 'Edição',
  LEITURA: 'Somente leitura',
};

function lerDesbloqueios(): Record<string, string> {
  try {
    const bruto = localStorage.getItem(CHAVE_DESBLOQUEIOS);
    const dados: unknown = bruto ? JSON.parse(bruto) : {};
    return dados && typeof dados === 'object' ? (dados as Record<string, string>) : {};
  } catch {
    return {};
  }
}

// Valor do cabeçalho X-Perfil-Desbloqueio (vazio se não houver nenhum).
export function cabecalhoDesbloqueios(): string {
  return Object.values(lerDesbloqueios())
    .filter((t) => typeof t === 'string' && t !== '')
    .join(',');
}

export function guardarDesbloqueio(perfilId: number, token: string | null): void {
  try {
    const atuais = lerDesbloqueios();
    if (token) atuais[String(perfilId)] = token;
    else delete atuais[String(perfilId)];
    localStorage.setItem(CHAVE_DESBLOQUEIOS, JSON.stringify(atuais));
  } catch {
    // Sem armazenamento local: o perfil volta a pedir a senha.
  }
}

// Ao sair do sistema: todos os perfis voltam a pedir a senha.
export function esquecerDesbloqueios(): void {
  try {
    localStorage.removeItem(CHAVE_DESBLOQUEIOS);
  } catch {
    // nada a fazer
  }
}

// Evento disparado quando o servidor responde que o perfil em uso está bloqueado (423).
export const EVENTO_PERFIL_BLOQUEADO = 'financas:perfil-bloqueado';

// Grava o perfil escolhido e recarrega o app na tela inicial, para todas as telas buscarem os dados do novo perfil.
export function trocarDePerfil(id: number): void {
  try {
    localStorage.setItem(CHAVE_PERFIL, String(id));
  } catch {
    // Sem acesso ao armazenamento local: o recarregamento ainda leva à tela inicial.
  }
  window.location.assign('/app');
}
