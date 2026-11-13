const CHAVE_TOKEN = 'financas.token';
const CHAVE_USUARIO = 'financas.usuario';

function cabecalhos(temCorpo: boolean): HeadersInit {
  const cabecalho: Record<string, string> = {};
  if (temCorpo) cabecalho['Content-Type'] = 'application/json';
  const token = localStorage.getItem(CHAVE_TOKEN);
  if (token) cabecalho['Authorization'] = `Bearer ${token}`;
  // Perfil financeiro escolhido no seletor do topo: o servidor separa os dados por ele.
  const perfil = localStorage.getItem('financas.perfil');
  if (perfil) cabecalho['X-Perfil'] = perfil;
  return cabecalho;
}

async function requisitar<T>(metodo: string, caminho: string, corpo?: unknown): Promise<T> {
  const temCorpo = corpo !== undefined;
  const resposta = await fetch('/api' + caminho, {
    method: metodo,
    headers: cabecalhos(temCorpo),
    body: temCorpo ? JSON.stringify(corpo) : undefined,
  });

  if (resposta.status === 204) return undefined as T;

  let dados: { erro?: string } | null = null;
  try {
    dados = await resposta.json();
  } catch {
    dados = null;
  }

  if (!resposta.ok) {
    if (resposta.status === 401 && caminho !== '/auth/login') {
      localStorage.removeItem(CHAVE_TOKEN);
      localStorage.removeItem(CHAVE_USUARIO);
      window.location.assign('/login');
    }
    throw new Error(dados?.erro ?? 'Erro inesperado');
  }

  return dados as T;
}

export const api = {
  get<T>(caminho: string): Promise<T> {
    return requisitar<T>('GET', caminho);
  },
  post<T>(caminho: string, corpo?: unknown): Promise<T> {
    return requisitar<T>('POST', caminho, corpo);
  },
  put<T>(caminho: string, corpo?: unknown): Promise<T> {
    return requisitar<T>('PUT', caminho, corpo);
  },
  // A maioria das exclusões responde 204 (sem corpo); as que respondem com um resumo usam del<Tipo>().
  del<T = void>(caminho: string): Promise<T> {
    return requisitar<T>('DELETE', caminho);
  },
};
