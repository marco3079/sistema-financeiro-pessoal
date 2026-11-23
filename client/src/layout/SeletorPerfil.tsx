import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatarReais } from '../lib/financas';
import { useAcessoPerfil } from '../lib/acessoPerfil';
import { trocarDePerfil } from '../lib/perfilFinanceiro';
import { PontoCor } from '../ui/financas';
import { Icone } from '../ui/icones';
import { FolhaDeBaixo, useCelular } from '../ui/escolha';
import './seletor-perfil.css';

// Seletor de perfil financeiro no topo: mostra o perfil atual e troca de perfil pelo menu suspenso.
export function SeletorPerfil() {
  const navigate = useNavigate();
  const { perfis: dados } = useAcessoPerfil();
  const [aberto, setAberto] = useState(false);
  const area = useRef<HTMLDivElement>(null);
  const botao = useRef<HTMLButtonElement>(null);
  // No celular a lista de perfis abre numa folha de baixo.
  const celular = useCelular();

  // Clique fora e Esc fecham o menu (mesmo padrão de MenuUsuario).
  useEffect(() => {
    if (!aberto || celular) return;
    function fora(e: MouseEvent) {
      if (area.current && !area.current.contains(e.target as Node)) setAberto(false);
    }
    function tecla(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setAberto(false);
        botao.current?.focus();
      }
    }
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', tecla);
    };
  }, [aberto, celular]);

  if (!dados) return null;
  const atual = dados.find((p) => p.atual) ?? dados[0];
  if (!atual) return null;

  function irParaPerfis() {
    setAberto(false);
    navigate('/app/perfis');
  }

  return (
    <div className="seletor-perfil" ref={area}>
      <button
        ref={botao}
        type="button"
        className="seletor-perfil-botao"
        aria-haspopup="menu"
        aria-expanded={aberto}
        onClick={() => setAberto((v) => !v)}
      >
        <PontoCor cor={atual.cor} />
        <span className="seletor-perfil-nome">{atual.nome}</span>
        <span className="seletor-perfil-seta" aria-hidden="true">
          <Icone nome="chevron-baixo" tamanho={16} />
        </span>
      </button>

      {aberto && (
        <MenuOuFolha celular={celular} aoFechar={() => setAberto(false)}>
          {dados.map((p) => (
            <button
              key={p.id}
              type="button"
              role="menuitemradio"
              aria-checked={p.atual}
              className="seletor-perfil-item"
              onClick={() => {
                setAberto(false);
                if (!p.atual) trocarDePerfil(p.id);
              }}
            >
              <PontoCor cor={p.cor} />
              <span className="seletor-perfil-item-nome">{p.nome}</span>
              {p.protegido && (
                <span className="seletor-perfil-cadeado" title="Protegido por senha" aria-label="Protegido por senha">
                  <Icone nome="cadeado" tamanho={14} />
                </span>
              )}
              <span className="seletor-perfil-item-valor">{p.patrimonio === null ? '' : formatarReais(p.patrimonio)}</span>
              {p.atual && (
                <span className="seletor-perfil-visto" aria-hidden="true">
                  <Icone nome="visto" tamanho={16} />
                </span>
              )}
            </button>
          ))}
          <div className="seletor-perfil-separador" role="separator" />
          <button type="button" role="menuitem" className="seletor-perfil-item" onClick={irParaPerfis}>
            <Icone nome="usuarios" tamanho={18} />
            <span className="seletor-perfil-item-nome">Gerenciar perfis</span>
          </button>
        </MenuOuFolha>
      )}
    </div>
  );
}

// Computador: menu suspenso abaixo do botão. Celular: a mesma lista numa folha de baixo.
function MenuOuFolha({
  celular,
  aoFechar,
  children,
}: {
  celular: boolean;
  aoFechar: () => void;
  children: ReactNode;
}) {
  if (!celular) {
    return (
      <div className="seletor-perfil-menu" role="menu" aria-label="Perfis financeiros">
        {children}
      </div>
    );
  }
  return (
    <FolhaDeBaixo aberta titulo="Perfis financeiros" aoFechar={aoFechar}>
      <div className="seletor-perfil-folha" role="menu" aria-label="Perfis financeiros">
        {children}
      </div>
    </FolhaDeBaixo>
  );
}
