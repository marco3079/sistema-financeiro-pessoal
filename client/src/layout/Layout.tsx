import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAcessoPerfil } from '../lib/acessoPerfil';
import { useAuth } from '../lib/auth';
import { usePlataforma } from '../lib/plataforma';
import type { RotaModulo } from '../lib/rotas';
import { useTema } from '../lib/tema';
import { NOME_DO_PERFIL, RAIZ_DO_PERFIL } from '../lib/tipos';
import type { Perfil } from '../lib/tipos';
import { Icone } from '../ui/icones';
import { BotaoAtualizar } from './BotaoAtualizar';
import { BotaoCelular } from './BotaoCelular';
import { Busca } from './Busca';
import { FichaAtivoProvider } from './FichaAtivo';
import { agrupar } from './grupos';
import { MenuUsuario } from './MenuUsuario';
import { Notificacoes } from './Notificacoes';
import { SeletorPerfil } from './SeletorPerfil';
import { Selo } from '../ui';
import './casca.css';

const CONSULTA_CELULAR = '(max-width: 899px)';

export function nomePortal(perfil: Perfil): string {
  return NOME_DO_PERFIL[perfil];
}

export function caminhoDoPerfil(perfil: Perfil): string {
  return RAIZ_DO_PERFIL[perfil];
}

// true abaixo de 900 px. Desktop e celular têm marcação diferente, então a escolha é feita em JS.
function useTelaEstreita(): boolean {
  const [estreita, setEstreita] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.matchMedia(CONSULTA_CELULAR).matches : false,
  );

  useEffect(() => {
    const consulta = window.matchMedia(CONSULTA_CELULAR);
    const trocou = () => setEstreita(consulta.matches);
    consulta.addEventListener('change', trocou);
    return () => consulta.removeEventListener('change', trocou);
  }, []);

  return estreita;
}

// Botão redondo que alterna claro e escuro a partir do tema que está na tela.
// Mostra a lua quando a tela está clara e o sol quando está escura. Também usado na tela de login.
export function BotaoTema() {
  const { temaEfetivo, alternar } = useTema();
  const destino = temaEfetivo === 'escuro' ? 'claro' : 'escuro';
  const rotulo = `Mudar para o tema ${destino}`;
  return (
    <button type="button" className="casca-botao-redondo" aria-label={rotulo} title={rotulo} onClick={() => alternar()}>
      <Icone nome={temaEfetivo === 'escuro' ? 'sol' : 'lua'} tamanho={20} />
    </button>
  );
}

export function Layout({ menu, telas }: { menu: RotaModulo[]; telas: RotaModulo[] }) {
  const { usuario, sair } = useAuth();
  const { nivel } = useAcessoPerfil();
  const { plataforma, logoSrc } = usePlataforma();
  const [gavetaAberta, setGavetaAberta] = useState(false);
  const [buscaAberta, setBuscaAberta] = useState(false);
  const estreita = useTelaEstreita();
  const local = useLocation();
  useEffect(() => {
    setGavetaAberta(false);
    setBuscaAberta(false);
  }, [local.pathname]);

  // Celular: ao tocar numa aba (ou item de controle segmentado) que está meio escondida na faixa
  // que rola de lado, ela desliza para o centro, como nos aplicativos.
  useEffect(() => {
    if (!estreita) return;
    function tocou(e: MouseEvent) {
      const alvo = e.target instanceof Element ? e.target.closest('.aba, .segmentado-item') : null;
      if (alvo) alvo.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
    document.addEventListener('click', tocou);
    return () => document.removeEventListener('click', tocou);
  }, [estreita]);

  useEffect(() => {
    if (!gavetaAberta) return;
    function tecla(e: KeyboardEvent) {
      if (e.key === 'Escape') setGavetaAberta(false);
    }
    document.addEventListener('keydown', tecla);
    return () => document.removeEventListener('keydown', tecla);
  }, [gavetaAberta]);

  if (!usuario) return null;

  const raizPortal = caminhoDoPerfil(usuario.perfil);
  const portal = nomePortal(usuario.perfil);
  // Membro com nível Leitura no perfil em uso: o topo avisa que é só consulta.
  const leitor = nivel === 'LEITURA';
  const grupos = agrupar(menu);
  const principais = menu.slice(0, 4);
  // Lançar rápido vira o botão "+" do meio da barra inferior (como o botão central dos aplicativos).
  const rotaDestaque = principais.find((r) => r.caminho.endsWith('/rapido'));
  const comuns = principais.filter((r) => r !== rotaDestaque);
  const metade = Math.ceil(comuns.length / 2);

  function itemInferior(r: RotaModulo) {
    return (
      <NavLink
        key={r.caminho}
        to={r.caminho}
        end={r.caminho === raizPortal}
        className={({ isActive }) => (isActive ? 'casca-inferior-item casca-ativo' : 'casca-inferior-item')}
      >
        <span className="casca-inferior-pilula">
          <Icone nome={r.icone} tamanho={22} className="casca-inferior-icone" />
        </span>
        <span className="casca-inferior-rotulo">{r.rotulo}</span>
      </NavLink>
    );
  }

  function itemMenu(r: RotaModulo) {
    return (
      <NavLink
        key={r.caminho}
        to={r.caminho}
        end={r.caminho === raizPortal}
        className={({ isActive }) => (isActive ? 'casca-item casca-ativo' : 'casca-item')}
      >
        <Icone nome={r.icone} tamanho={20} className="casca-item-icone" />
        <span className="casca-item-rotulo">{r.rotulo}</span>
      </NavLink>
    );
  }

  function secoes() {
    return grupos.map((g) => (
      <div className="casca-grupo" key={g.titulo || 'inicio'}>
        {g.titulo && <p className="casca-grupo-titulo">{g.titulo}</p>}
        {g.rotas.map(itemMenu)}
      </div>
    ));
  }

  return (
    <div className={estreita ? 'casca casca-celular' : 'casca casca-desktop'}>
      {!estreita && (
        <aside className="casca-lateral">
          <div className="casca-marca">
            <img src={logoSrc} alt="" className="casca-marca-logo" width={40} height={40} />
            <div className="casca-marca-texto">
              <strong className="casca-marca-nome">{plataforma.nome}</strong>
              <span className="casca-marca-portal">{portal}</span>
            </div>
          </div>

          <nav className="casca-menu" aria-label="Menu principal">
            {secoes()}
          </nav>

          <div className="casca-cartao">
            <p className="casca-cartao-frase">{plataforma.slogan}</p>
            <div className="casca-cartao-ilustracao" aria-hidden="true" />
          </div>
        </aside>
      )}

      {estreita && (
        <header className="casca-topo-celular">
          <div className="casca-topo-celular-barra">
            <img src={logoSrc} alt="" className="casca-topo-celular-logo" width={28} height={28} />
            <span className="casca-topo-celular-nome">{portal}</span>
            {leitor && <Selo cor="azul">Somente leitura</Selo>}
            <div className="casca-topo-celular-acoes">
              <SeletorPerfil />
              <BotaoAtualizar />
              <button
                type="button"
                className={buscaAberta ? 'casca-botao-redondo casca-botao-ativo' : 'casca-botao-redondo'}
                aria-label={buscaAberta ? 'Fechar a busca' : 'Buscar'}
                aria-expanded={buscaAberta}
                onClick={() => setBuscaAberta((b) => !b)}
              >
                <Icone nome={buscaAberta ? 'fechar' : 'busca'} tamanho={20} />
              </button>
              <Notificacoes raiz={raizPortal} />
              <button
                type="button"
                className="casca-botao-redondo"
                aria-label="Abrir menu"
                onClick={() => setGavetaAberta(true)}
              >
                <Icone nome="menu" tamanho={22} />
              </button>
            </div>
          </div>
          {buscaAberta && (
            <div className="casca-topo-celular-busca">
              <Busca telas={telas} autoFoco />
            </div>
          )}
        </header>
      )}

      <main className="casca-principal">
        <div className="casca-area">
          {!estreita && (
            <header className="casca-topo">
              <Busca telas={telas} />
              {leitor && <Selo cor="azul">Somente leitura</Selo>}
              <div className="casca-topo-acoes">
                <SeletorPerfil />
                <BotaoAtualizar />
                <BotaoCelular />
                <Notificacoes raiz={raizPortal} />
                <BotaoTema />
                <MenuUsuario />
              </div>
            </header>
          )}
          {/* Clicar no código de um ativo, em qualquer tela, abre a ficha dele. */}
          <FichaAtivoProvider>
            <Outlet />
          </FichaAtivoProvider>
        </div>
      </main>

      {estreita && (
        <nav className="casca-inferior" aria-label="Menu rápido">
          {(rotaDestaque ? comuns.slice(0, metade) : principais).map(itemInferior)}
          {rotaDestaque && (
            <NavLink
              to={rotaDestaque.caminho}
              className={({ isActive }) =>
                isActive ? 'casca-inferior-item casca-inferior-destaque casca-ativo' : 'casca-inferior-item casca-inferior-destaque'
              }
              aria-label={rotaDestaque.rotulo}
            >
              <span className="casca-inferior-mais">
                <Icone nome="somar" tamanho={26} />
              </span>
              <span className="casca-inferior-rotulo">Lançar</span>
            </NavLink>
          )}
          {rotaDestaque && comuns.slice(metade).map(itemInferior)}
          <button type="button" className="casca-inferior-item" onClick={() => setGavetaAberta(true)}>
            <span className="casca-inferior-pilula">
              <Icone nome="mais" tamanho={22} className="casca-inferior-icone" />
            </span>
            <span className="casca-inferior-rotulo">Mais</span>
          </button>
        </nav>
      )}

      {estreita && gavetaAberta && (
        <div className="casca-gaveta-fundo" onClick={() => setGavetaAberta(false)}>
          <div
            className="casca-gaveta"
            role="dialog"
            aria-modal="true"
            aria-label="Menu completo"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="casca-gaveta-cabecalho">
              <div className="casca-marca-texto">
                <strong className="casca-marca-nome">{plataforma.nome}</strong>
                <span className="casca-marca-portal">{portal}</span>
              </div>
              <BotaoTema />
              <button
                type="button"
                className="casca-botao-redondo"
                aria-label="Fechar menu"
                onClick={() => setGavetaAberta(false)}
              >
                <Icone nome="fechar" tamanho={20} />
              </button>
            </div>

            <nav className="casca-menu casca-menu-gaveta" aria-label="Menu completo">
              {secoes()}
            </nav>

            <div className="casca-gaveta-rodape">
              <span className="casca-usuario-nome">{usuario.nome}</span>
              <button type="button" className="casca-sair" onClick={sair}>
                <Icone nome="sair" tamanho={18} />
                Sair
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
