import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { FichaAcao } from '../modules/investimentos/FichaAcao';
import { FundoB3 } from '../modules/investimentos/FundoB3';
import './ficha-ativo.css';

// Ficha do ativo em qualquer tela: clicar no código de um ativo (MXRF11, ITSA4, B3SA3...) abre o popup com os dados
// e a nota dele. Fundo imobiliário abre a ficha do fundo; ação, a da ação. Código com final 11 pode ser FII ou unit:
// tenta como fundo e, se a B3 não conhecer o fundo, abre como ação.
//
// Funciona sozinho nas telas: todo texto que é exatamente um código de ativo vira link (marcado com data-ativo).
// Onde o código vem junto de outro texto, use <CodigoAtivo codigo="..."/>. Para não marcar um trecho, ponha
// data-sem-ficha nele.

export const CODIGO_ATIVO = /^[A-Z][A-Z0-9]{3}\d{1,2}$/;

const Contexto = createContext<(codigo: string) => void>(() => undefined);

export function useFichaAtivo(): (codigo: string) => void {
  return useContext(Contexto);
}

export function CodigoAtivo({ codigo, children }: { codigo: string; children?: ReactNode }) {
  return (
    <span className="codigo-ativo" data-ativo={codigo.toUpperCase()} role="button" tabIndex={0} title={`Ver a ficha de ${codigo.toUpperCase()}`}>
      {children ?? codigo.toUpperCase()}
    </span>
  );
}

const NAO_MARCAR = 'input, textarea, select, option, button, a, [contenteditable], svg, [data-sem-ficha], [data-ativo]';

// Marca os elementos cujo texto é só um código de ativo.
function marcarCodigos(raiz: HTMLElement): void {
  const caminhante = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
  const marcar: { el: HTMLElement; codigo: string }[] = [];
  for (let no = caminhante.nextNode(); no; no = caminhante.nextNode()) {
    const texto = (no.nodeValue ?? '').trim();
    if (texto.length < 5 || texto.length > 6 || !CODIGO_ATIVO.test(texto)) continue;
    const el = no.parentElement;
    if (!el || el.closest(NAO_MARCAR) || (el.textContent ?? '').trim() !== texto) continue;
    marcar.push({ el, codigo: texto });
  }
  for (const { el, codigo } of marcar) {
    el.setAttribute('data-ativo', codigo);
    el.classList.add('codigo-ativo');
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('title', `Ver a ficha de ${codigo}`);
  }
}

export function FichaAtivoProvider({ children }: { children: ReactNode }) {
  const [aberto, setAberto] = useState<{ codigo: string; tipo: 'FII' | 'ACAO' } | null>(null);

  const abrir = useCallback((codigo: string) => {
    const c = codigo.trim().toUpperCase();
    if (!CODIGO_ATIVO.test(c)) return;
    setAberto({ codigo: c, tipo: c.endsWith('11') ? 'FII' : 'ACAO' });
  }, []);

  useEffect(() => {
    let relogio: number | undefined;
    const agendar = () => {
      window.clearTimeout(relogio);
      relogio = window.setTimeout(() => marcarCodigos(document.body), 200);
    };
    const observador = new MutationObserver(agendar);
    observador.observe(document.body, { childList: true, subtree: true, characterData: true });
    agendar();

    // Na fase de captura: o clique no código não chega à linha da tabela (que abriria outra coisa).
    const alvo = (e: Event) => (e.target instanceof Element ? e.target.closest('[data-ativo]') : null);
    const aoClicar = (e: MouseEvent) => {
      const el = alvo(e);
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      abrir(el.getAttribute('data-ativo') ?? '');
    };
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const el = alvo(e);
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      abrir(el.getAttribute('data-ativo') ?? '');
    };
    document.addEventListener('click', aoClicar, true);
    document.addEventListener('keydown', aoTeclar, true);
    return () => {
      window.clearTimeout(relogio);
      observador.disconnect();
      document.removeEventListener('click', aoClicar, true);
      document.removeEventListener('keydown', aoTeclar, true);
    };
  }, [abrir]);

  const fechar = () => setAberto(null);
  return (
    <Contexto.Provider value={abrir}>
      {children}
      {aberto?.tipo === 'FII' && (
        <FundoB3 codigo={aberto.codigo} aoFechar={fechar} aoNaoSerFundo={() => setAberto({ codigo: aberto.codigo, tipo: 'ACAO' })} />
      )}
      {aberto?.tipo === 'ACAO' && <FichaAcao codigo={aberto.codigo} aoFechar={fechar} />}
    </Contexto.Provider>
  );
}
