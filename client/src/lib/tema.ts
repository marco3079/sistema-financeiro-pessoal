import { useCallback, useSyncExternalStore } from 'react';

// Preferência de tema do usuário, guardada neste navegador.
// Chave ausente em localStorage = 'sistema' (segue o aparelho).
// O atributo data-tema no <html> é a fonte de verdade para o CSS; sem ele, vale o aparelho.

export type PreferenciaTema = 'sistema' | 'claro' | 'escuro';
export type TemaEfetivo = 'claro' | 'escuro';

const CHAVE = 'financas.tema';
const CONSULTA_ESCURO = '(prefers-color-scheme: dark)';

function consultaDoAparelho(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia(CONSULTA_ESCURO);
}

function lerDoNavegador(): PreferenciaTema {
  try {
    const valor = window.localStorage.getItem(CHAVE);
    if (valor === 'claro' || valor === 'escuro') return valor;
  } catch {
    // Armazenamento indisponível (modo privado, bloqueio): segue o aparelho.
  }
  return 'sistema';
}

function gravarNoNavegador(preferencia: PreferenciaTema): void {
  try {
    if (preferencia === 'sistema') window.localStorage.removeItem(CHAVE);
    else window.localStorage.setItem(CHAVE, preferencia);
  } catch {
    // Sem armazenamento a escolha vale só até recarregar a página.
  }
}

function efetivoDe(preferencia: PreferenciaTema): TemaEfetivo {
  if (preferencia === 'claro') return 'claro';
  if (preferencia === 'escuro') return 'escuro';
  return consultaDoAparelho()?.matches ? 'escuro' : 'claro';
}

function aplicarNoHtml(preferencia: PreferenciaTema): void {
  if (typeof document === 'undefined') return;
  const raiz = document.documentElement;
  if (preferencia === 'claro' || preferencia === 'escuro') raiz.setAttribute('data-tema', preferencia);
  else raiz.removeAttribute('data-tema');
}

// Estado de módulo: a preferência atual e quem está ouvindo (componentes via useSyncExternalStore).
let preferenciaAtual: PreferenciaTema = lerDoNavegador();
const ouvintes = new Set<() => void>();

aplicarNoHtml(preferenciaAtual);

export function lerPreferenciaTema(): PreferenciaTema {
  return preferenciaAtual;
}

export function definirPreferenciaTema(preferencia: PreferenciaTema): void {
  preferenciaAtual = preferencia;
  gravarNoNavegador(preferencia);
  aplicarNoHtml(preferencia);
  ouvintes.forEach((avisar) => avisar());
}

// Instantâneo em forma de texto ("preferencia|efetivo"), para o useSyncExternalStore comparar bem.
function instantaneo(): string {
  return `${preferenciaAtual}|${efetivoDe(preferenciaAtual)}`;
}

function assinar(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  // Em "Sistema", a troca de tema do aparelho também precisa avisar os componentes.
  const consulta = consultaDoAparelho();
  const trocou = () => ouvinte();
  consulta?.addEventListener('change', trocou);
  return () => {
    ouvintes.delete(ouvinte);
    consulta?.removeEventListener('change', trocou);
  };
}

export function useTema(): {
  preferencia: PreferenciaTema;
  temaEfetivo: TemaEfetivo;
  definir: (preferencia: PreferenciaTema) => void;
  alternar: () => void;
} {
  const snapshot = useSyncExternalStore(assinar, instantaneo, instantaneo);
  const [preferencia, temaEfetivo] = snapshot.split('|') as [PreferenciaTema, TemaEfetivo];

  const definir = useCallback((nova: PreferenciaTema) => definirPreferenciaTema(nova), []);
  const alternar = useCallback(() => {
    definirPreferenciaTema(efetivoDe(preferenciaAtual) === 'escuro' ? 'claro' : 'escuro');
  }, []);

  return { preferencia, temaEfetivo, definir, alternar };
}
