import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Icone } from '../../ui/icones';
import { FolhaDeBaixo, useCelular } from '../../ui/escolha';
import './fichas.css';
import type { NomeIcone } from '../../ui/icones';

export interface AcaoMenu {
  rotulo: string;
  icone?: NomeIcone;
  perigo?: boolean;
  aoClicar: () => void;
}

// Botão de três pontos que abre um menu de ações. O menu usa position: fixed, calculado
// a partir do botão, para não ser cortado pela rolagem da tabela.
export function MenuAcoes({ acoes, rotulo }: { acoes: AcaoMenu[]; rotulo: string }) {
  const [aberto, setAberto] = useState(false);
  const [posicao, setPosicao] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const area = useRef<HTMLDivElement>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  // No celular as ações abrem numa folha de baixo (alvo grande, ao alcance do polegar).
  const celular = useCelular();

  // Posiciona o menu logo após abrir (antes de pintar): embaixo do botão, ou em cima se faltar espaço.
  useLayoutEffect(() => {
    if (celular || !aberto || !botao.current || !menu.current) return;
    const r = botao.current.getBoundingClientRect();
    const altura = menu.current.offsetHeight;
    const largura = document.documentElement.clientWidth;
    const espaco = 6;
    const cabe = r.bottom + espaco + altura <= window.innerHeight;
    const top = cabe ? r.bottom + espaco : Math.max(8, r.top - espaco - altura);
    const right = Math.max(8, largura - r.right);
    setPosicao({ top, right });
  }, [aberto, celular]);

  // Foco no primeiro item ao abrir.
  useEffect(() => {
    if (!aberto) return;
    menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [aberto]);

  // Fecha com clique fora, Escape, rolagem ou redimensionamento; listeners só enquanto aberto.
  useEffect(() => {
    if (!aberto || celular) return;

    function fechar(devolverFoco: boolean) {
      setAberto(false);
      if (devolverFoco) botao.current?.focus();
    }
    function fora(e: MouseEvent) {
      if (area.current && !area.current.contains(e.target as Node)) fechar(false);
    }
    function tecla(e: KeyboardEvent) {
      if (e.key === 'Escape') fechar(true);
    }
    function mudouTela() {
      fechar(false);
    }

    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', tecla);
    window.addEventListener('scroll', mudouTela, true);
    window.addEventListener('resize', mudouTela);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', tecla);
      window.removeEventListener('scroll', mudouTela, true);
      window.removeEventListener('resize', mudouTela);
    };
  }, [aberto, celular]);

  // Setas sobem e descem entre os itens; Tab fecha o menu e devolve o foco ao botão.
  function teclasDoMenu(e: ReactKeyboardEvent<HTMLDivElement>) {
    const itens = Array.from(
      menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []
    );
    const atual = itens.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const passo = e.key === 'ArrowDown' ? 1 : -1;
      const proximo = (atual + passo + itens.length) % itens.length;
      itens[proximo]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      itens[e.key === 'Home' ? 0 : itens.length - 1]?.focus();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      setAberto(false);
      botao.current?.focus();
    }
  }

  function escolher(acao: AcaoMenu) {
    setAberto(false);
    acao.aoClicar();
  }

  return (
    <div ref={area} className="acoes" onClick={(e) => e.stopPropagation()}>
      <button
        ref={botao}
        type="button"
        className="acoes-botao"
        aria-label={rotulo}
        aria-haspopup="menu"
        aria-expanded={aberto}
        onClick={() => setAberto((v) => !v)}
      >
        <Icone nome="mais" tamanho={18} />
      </button>

      {celular && (
        <FolhaDeBaixo
          aberta={aberto}
          titulo={rotulo}
          aoFechar={() => {
            setAberto(false);
            botao.current?.focus();
          }}
        >
          <div role="menu" aria-label={rotulo} className="acoes-folha" ref={menu}>
            {acoes.map((acao) => (
              <button
                key={acao.rotulo}
                type="button"
                role="menuitem"
                className={acao.perigo ? 'acoes-folha-item acoes-item-perigo' : 'acoes-folha-item'}
                onClick={() => escolher(acao)}
              >
                {acao.icone && <Icone nome={acao.icone} tamanho={20} />}
                <span>{acao.rotulo}</span>
              </button>
            ))}
          </div>
        </FolhaDeBaixo>
      )}

      {aberto && !celular && (
        <div
          ref={menu}
          role="menu"
          aria-label={rotulo}
          className="acoes-menu"
          style={{ top: posicao.top, right: posicao.right }}
          onKeyDown={teclasDoMenu}
        >
          {acoes.map((acao) => (
            <button
              key={acao.rotulo}
              type="button"
              role="menuitem"
              className={acao.perigo ? 'acoes-item acoes-item-perigo' : 'acoes-item'}
              onClick={() => escolher(acao)}
            >
              {acao.icone && <Icone nome={acao.icone} tamanho={18} />}
              <span>{acao.rotulo}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
