import { createContext, useContext, useEffect } from 'react';
import type { ReactNode } from 'react';
import { EVENTO_PERFIL_BLOQUEADO } from './perfilFinanceiro';
import type { NivelPerfil, PerfilDTO } from './perfilFinanceiro';
import { useDados } from './useDados';

// Perfis financeiros que o usuário acessa, o perfil em uso e o nível dele nesse perfil.
// Carregado uma vez pela casca (App.tsx); o seletor do topo, o menu e a tela de senha leem daqui.

interface AcessoPerfilContexto {
  perfis: PerfilDTO[] | null;
  atual: PerfilDTO | null;
  nivel: NivelPerfil | null; // null enquanto carrega ou se a lista falhar
  carregando: boolean;
  erro: string | null;
  recarregar(): void;
}

const Contexto = createContext<AcessoPerfilContexto | null>(null);

export function AcessoPerfilProvider({ children }: { children: ReactNode }) {
  const { dados, carregando, erro, recarregar } = useDados<PerfilDTO[]>('/perfis');

  // O servidor avisou que o perfil em uso ficou bloqueado (senha trocada ou desbloqueio vencido).
  useEffect(() => {
    window.addEventListener(EVENTO_PERFIL_BLOQUEADO, recarregar);
    return () => window.removeEventListener(EVENTO_PERFIL_BLOQUEADO, recarregar);
  }, [recarregar]);

  const atual = dados ? dados.find((p) => p.atual) ?? dados[0] ?? null : null;
  return (
    <Contexto.Provider value={{ perfis: dados, atual, nivel: atual?.nivel ?? null, carregando, erro, recarregar }}>
      {children}
    </Contexto.Provider>
  );
}

export function useAcessoPerfil(): AcessoPerfilContexto {
  const contexto = useContext(Contexto);
  if (!contexto) throw new Error('useAcessoPerfil precisa estar dentro de AcessoPerfilProvider');
  return contexto;
}

// Pode alterar os dados do perfil em uso: titular, ou membro com nível Edição.
export function usePodeEditar(): boolean {
  const { nivel } = useAcessoPerfil();
  return nivel !== 'LEITURA';
}
