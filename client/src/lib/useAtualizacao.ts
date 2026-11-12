import { useEffect } from 'react';

// Chama `recarregar` a cada `intervaloMs` enquanto a aba estiver visível e quando a janela volta ao foco.
// `recarregar` precisa ser estável (o de useDados é).
export function useAtualizacao(recarregar: () => void, intervaloMs: number): void {
  useEffect(() => {
    const intervalo = window.setInterval(() => {
      if (document.visibilityState === 'visible') recarregar();
    }, intervaloMs);
    const aoFocar = () => recarregar();
    window.addEventListener('focus', aoFocar);
    return () => {
      window.clearInterval(intervalo);
      window.removeEventListener('focus', aoFocar);
    };
  }, [recarregar, intervaloMs]);
}
