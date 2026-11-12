import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from './api';
import { lerPerfil } from './tipos';
import type { Perfil, PerfilReal, UsuarioLogado } from './tipos';

const CHAVE_TOKEN = 'financas.token';
const CHAVE_USUARIO = 'financas.usuario';

// Usuário como vem da API ou do navegador: `foto` pode não existir.
interface UsuarioBruto {
  id: number;
  nome: string;
  email: string;
  perfil: PerfilReal;
  perfilReal?: PerfilReal;
  foto?: string | null;
}

interface AuthContexto {
  usuario: UsuarioLogado | null;
  entrar(email: string, senha: string): Promise<void>;
  sair(): void;
  atualizarFoto(foto: string | null): void;
}

const Contexto = createContext<AuthContexto | null>(null);

export function normalizarUsuario(bruto: UsuarioBruto): UsuarioLogado {
  const perfil: Perfil = lerPerfil(bruto.perfil);
  return { id: bruto.id, nome: bruto.nome, email: bruto.email, perfil, perfilReal: perfil, foto: bruto.foto ?? null };
}

function lerUsuarioSalvo(): UsuarioLogado | null {
  const bruto = localStorage.getItem(CHAVE_USUARIO);
  if (!bruto) return null;
  try {
    const usuario = normalizarUsuario(JSON.parse(bruto) as UsuarioBruto);
    localStorage.setItem(CHAVE_USUARIO, JSON.stringify(usuario));
    return usuario;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<UsuarioLogado | null>(() =>
    localStorage.getItem(CHAVE_TOKEN) ? lerUsuarioSalvo() : null,
  );
  // Id do usuário cuja foto já foi pedida ao servidor nesta sessão (uma vez por login).
  const fotoBuscadaPara = useRef<number | null>(null);

  // Atualiza a foto no usuário em memória e no localStorage.
  const atualizarFoto = useCallback((foto: string | null): void => {
    setUsuario((atual) => {
      if (!atual) return atual;
      const atualizado: UsuarioLogado = { ...atual, foto };
      localStorage.setItem(CHAVE_USUARIO, JSON.stringify(atualizado));
      return atualizado;
    });
  }, []);

  // Depois de entrar ou de restaurar a sessão, busca a foto em segundo plano (uma vez). Falha em silêncio:
  useEffect(() => {
    if (!usuario || fotoBuscadaPara.current === usuario.id) return;
    fotoBuscadaPara.current = usuario.id;
    api
      .get<{ usuario?: { foto?: string | null } }>('/perfil/completo')
      .then((resposta) => {
        // Se a resposta trouxer o usuário, aplica a foto mesmo quando for nula (foto removida em outro aparelho).
        if (resposta?.usuario) atualizarFoto(resposta.usuario.foto ?? null);
      })
      .catch(() => undefined);
  }, [usuario, atualizarFoto]);

  async function entrar(email: string, senha: string): Promise<void> {
    const resposta = await api.post<{ token: string; usuario: UsuarioBruto }>('/auth/login', {
      email,
      senha,
    });
    const usuarioNormalizado = normalizarUsuario(resposta.usuario);
    localStorage.setItem(CHAVE_TOKEN, resposta.token);
    localStorage.setItem(CHAVE_USUARIO, JSON.stringify(usuarioNormalizado));
    setUsuario(usuarioNormalizado);
  }

  function sair(): void {
    // Avisa o servidor antes de limpar o token (o cabeçalho Authorization é lido agora). Sem esperar a resposta.
    api.post('/auth/sair').catch(() => undefined);
    localStorage.removeItem(CHAVE_TOKEN);
    localStorage.removeItem(CHAVE_USUARIO);
    fotoBuscadaPara.current = null;
    setUsuario(null);
  }

  return (
    <Contexto.Provider value={{ usuario, entrar, sair, atualizarFoto }}>{children}</Contexto.Provider>
  );
}

export function useAuth(): AuthContexto {
  const contexto = useContext(Contexto);
  if (!contexto) throw new Error('useAuth precisa estar dentro de AuthProvider');
  return contexto;
}
