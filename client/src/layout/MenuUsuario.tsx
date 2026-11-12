import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useTema } from '../lib/tema';
import { NOME_DO_PERFIL, RAIZ_DO_PERFIL } from '../lib/tipos';
import { Avatar } from '../ui';
import { Icone } from '../ui/icones';

const PAPEIS = NOME_DO_PERFIL;

// Avatar, nome e papel do usuário logado, com menu de "Meu perfil", tema e "Sair".
export function MenuUsuario() {
  const { usuario, sair } = useAuth();
  const navigate = useNavigate();
  const [aberto, setAberto] = useState(false);
  const area = useRef<HTMLDivElement>(null);
  const { temaEfetivo, alternar } = useTema();

  useEffect(() => {
    if (!aberto) return;
    function fora(e: MouseEvent) {
      if (area.current && !area.current.contains(e.target as Node)) setAberto(false);
    }
    function tecla(e: KeyboardEvent) {
      if (e.key === 'Escape') setAberto(false);
    }
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', tecla);
    };
  }, [aberto]);

  if (!usuario) return null;

  const caminhoPerfil = `${RAIZ_DO_PERFIL[usuario.perfil]}/perfil`;
  const primeiroNome = usuario.nome.trim().split(/\s+/)[0] ?? usuario.nome;

  function irParaPerfil() {
    setAberto(false);
    navigate(caminhoPerfil);
  }

  function sairDaConta() {
    setAberto(false);
    sair();
  }

  return (
    <div className="casca-usuario" ref={area}>
      <button
        type="button"
        className="casca-usuario-botao"
        aria-haspopup="menu"
        aria-expanded={aberto}
        onClick={() => setAberto((v) => !v)}
      >
        <span className="casca-avatar-wrap">
          <Avatar nome={usuario.nome} foto={usuario.foto} />
        </span>
        <span className="casca-usuario-texto">
          <span className="casca-usuario-nome">{usuario.nome}</span>
          <span className="casca-usuario-papel">{PAPEIS[usuario.perfilReal]}</span>
        </span>
        <Icone nome="chevron-baixo" tamanho={16} className="casca-seta" />
      </button>

      {aberto && (
        <div className="casca-menu-usuario" role="menu" aria-label={`Conta de ${primeiroNome}`}>
          <button type="button" role="menuitem" className="casca-menu-usuario-item" onClick={irParaPerfil}>
            <Icone nome="perfil" tamanho={18} />
            Meu perfil
          </button>
          <button
            type="button"
            role="menuitem"
            className="casca-menu-usuario-item"
            onClick={() => alternar()}
          >
            <Icone nome={temaEfetivo === 'escuro' ? 'sol' : 'lua'} tamanho={18} />
            {temaEfetivo === 'escuro' ? 'Tema claro' : 'Tema escuro'}
          </button>
          <button type="button" role="menuitem" className="casca-menu-usuario-item casca-menu-usuario-sair" onClick={sairDaConta}>
            <Icone nome="sair" tamanho={18} />
            Sair
          </button>
        </div>
      )}

    </div>
  );
}
