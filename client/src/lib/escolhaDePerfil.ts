// Apoio da tela "Quem está usando?" (layout/EscolherPerfil): lembra se a pessoa já escolheu o perfil neste login
// e deixa qualquer parte do app pedir para abrir a tela (o seletor do topo usa).

const CHAVE_ESCOLHIDO = 'financas.perfil-escolhido';
const EVENTO_ABRIR = 'financas:escolher-perfil';

// Marca desta sessão de login: os últimos caracteres do token. Login novo = escolha nova.
function marcaDoLogin(): string {
  try {
    return (localStorage.getItem('financas.token') ?? '').slice(-16);
  } catch {
    return '';
  }
}

// A pessoa já escolheu o perfil neste login (nesta aba)?
export function perfilJaEscolhido(): boolean {
  try {
    const marca = marcaDoLogin();
    return marca !== '' && sessionStorage.getItem(CHAVE_ESCOLHIDO) === marca;
  } catch {
    return true; // sem armazenamento: não insiste na tela a cada carga
  }
}

export function marcarEscolhido(): void {
  try {
    sessionStorage.setItem(CHAVE_ESCOLHIDO, marcaDoLogin());
  } catch {
    // sem armazenamento: a tela pode voltar a aparecer na próxima carga
  }
}

// Abre a tela de escolha a partir de qualquer lugar (o seletor do topo usa).
export function abrirEscolhaDePerfil(): void {
  window.dispatchEvent(new Event(EVENTO_ABRIR));
}

export function aoPedirEscolhaDePerfil(fn: () => void): () => void {
  window.addEventListener(EVENTO_ABRIR, fn);
  return () => window.removeEventListener(EVENTO_ABRIR, fn);
}
