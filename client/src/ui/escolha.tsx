import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import './escolha.css';

export interface OpcaoEscolha {
  valor: string;
  rotulo: string;
  // Texto menor embaixo do rótulo (só na folha do celular; no computador vira dica do item).
  detalhe?: string;
}

// ---------- Celular ou computador ----------

const CONSULTA_CELULAR = '(max-width: 719px)';

function assinarCelular(aviso: () => void) {
  const m = window.matchMedia(CONSULTA_CELULAR);
  m.addEventListener('change', aviso);
  return () => m.removeEventListener('change', aviso);
}

// Verdadeiro em telas estreitas (mesmo corte de 720 px do CSS).
export function useCelular(): boolean {
  return useSyncExternalStore(
    assinarCelular,
    () => window.matchMedia(CONSULTA_CELULAR).matches,
    () => false,
  );
}

// ---------- Folha de baixo (bottom sheet) ----------

// Painel que sobe do pé da tela, com fundo escuro. Fecha com Esc, clique no fundo ou no botão "Fechar".
// Vai direto para o <body> (portal) para não ser cortado por tabelas roláveis nem por modais.
export function FolhaDeBaixo({
  aberta,
  titulo,
  aoFechar,
  children,
}: {
  aberta: boolean;
  titulo: string;
  aoFechar: () => void;
  children: ReactNode;
}) {
  const id = useId();
  useEffect(() => {
    if (!aberta) return;
    function tecla(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        aoFechar();
      }
    }
    document.addEventListener('keydown', tecla, true);
    // Trava a rolagem da página enquanto a folha está aberta.
    const antes = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', tecla, true);
      document.body.style.overflow = antes;
    };
  }, [aberta, aoFechar]);

  if (!aberta) return null;
  return createPortal(
    <div
      className="folha-fundo"
      onClick={(e) => {
        // O clique não chega a quem está embaixo (linha da tabela, fundo do modal).
        e.stopPropagation();
        if (e.target === e.currentTarget) aoFechar();
      }}
    >
      <div className="folha" role="dialog" aria-modal="true" aria-labelledby={id}>
        <div className="folha-alca" aria-hidden="true" />
        <header className="folha-cabecalho">
          <h2 id={id}>{titulo}</h2>
          <button type="button" className="folha-fechar" onClick={aoFechar}>
            Fechar
          </button>
        </header>
        <div className="folha-corpo">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

// ---------- Escolha (substitui o <select>) ----------

// Lista com busca a partir deste número de opções.
const OPCOES_COM_BUSCA = 8;

function semAcento(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Seletor único do sistema. No computador é o <select> nativo; no celular é um botão
// com a mesma aparência que abre uma folha de baixo com as opções (e busca nas listas longas).
// `vazio` acrescenta a opção sem valor no começo (ex.: "Todas", "Selecione").
export function Escolha({
  valor,
  aoMudar,
  opcoes,
  vazio,
  titulo,
  rotuloAcessivel,
  obrigatorio,
  desabilitado,
  className = 'campo-controle',
  id,
}: {
  valor: string;
  aoMudar: (valor: string) => void;
  opcoes: OpcaoEscolha[];
  vazio?: string;
  // Título da folha no celular (normalmente o rótulo do campo).
  titulo?: string;
  // aria-label, quando não há <label> em volta.
  rotuloAcessivel?: string;
  obrigatorio?: boolean;
  desabilitado?: boolean;
  className?: string;
  id?: string;
}) {
  const celular = useCelular();
  const [aberta, setAberta] = useState(false);
  const [busca, setBusca] = useState('');
  const botao = useRef<HTMLButtonElement>(null);

  const todas = useMemo<OpcaoEscolha[]>(
    () => (vazio !== undefined ? [{ valor: '', rotulo: vazio }, ...opcoes] : opcoes),
    [opcoes, vazio],
  );
  const atual = todas.find((o) => o.valor === valor);
  const comBusca = opcoes.length >= OPCOES_COM_BUSCA;
  const filtradas = useMemo(() => {
    const t = semAcento(busca.trim());
    if (!t) return todas;
    return todas.filter((o) => semAcento(`${o.rotulo} ${o.detalhe ?? ''}`).includes(t));
  }, [todas, busca]);

  function fechar() {
    setAberta(false);
    setBusca('');
    botao.current?.focus();
  }

  // Leva a opção marcada para a vista ao abrir.
  const lista = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (!aberta) return;
    lista.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'center' });
  }, [aberta]);

  const nativo = (
    <select
      id={celular ? undefined : id}
      className={celular ? 'escolha-nativa-oculta' : className}
      value={valor}
      required={obrigatorio}
      disabled={desabilitado}
      aria-label={rotuloAcessivel}
      aria-hidden={celular || undefined}
      tabIndex={celular ? -1 : undefined}
      onChange={(e) => aoMudar(e.target.value)}
    >
      {todas.map((o) => (
        <option key={o.valor} value={o.valor} title={o.detalhe}>
          {o.rotulo}
        </option>
      ))}
    </select>
  );

  if (!celular) return nativo;

  return (
    <span className="escolha">
      <button
        ref={botao}
        id={id}
        type="button"
        className={`${className} escolha-botao`}
        aria-haspopup="dialog"
        aria-expanded={aberta}
        aria-label={rotuloAcessivel ? `${rotuloAcessivel}: ${atual?.rotulo ?? ''}` : undefined}
        disabled={desabilitado}
        onClick={() => setAberta(true)}
      >
        <span className={atual && atual.valor !== '' ? 'escolha-texto' : 'escolha-texto escolha-texto-vazio'}>
          {atual?.rotulo ?? vazio ?? 'Selecione'}
        </span>
      </button>
      {/* O <select> escondido mantém a validação de "obrigatório" do formulário. */}
      {obrigatorio && nativo}
      <FolhaDeBaixo aberta={aberta} titulo={titulo ?? rotuloAcessivel ?? 'Escolha uma opção'} aoFechar={fechar}>
        {comBusca && (
          <input
            className="campo-controle folha-busca"
            type="search"
            placeholder="Buscar"
            aria-label="Buscar nas opções"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        )}
        <ul ref={lista} className="folha-opcoes" role="listbox" aria-label={titulo ?? rotuloAcessivel}>
          {filtradas.map((o) => {
            const marcada = o.valor === valor;
            return (
              <li key={o.valor} role="option" aria-selected={marcada}>
                <button
                  type="button"
                  className={marcada ? 'folha-opcao folha-opcao-marcada' : 'folha-opcao'}
                  onClick={() => {
                    if (o.valor !== valor) aoMudar(o.valor);
                    fechar();
                  }}
                >
                  <span className="folha-opcao-texto">
                    <span className={o.valor === '' ? 'folha-opcao-rotulo folha-opcao-vazia' : 'folha-opcao-rotulo'}>
                      {o.rotulo}
                    </span>
                    {o.detalhe && <span className="folha-opcao-detalhe">{o.detalhe}</span>}
                  </span>
                  {marcada && (
                    <svg className="folha-opcao-visto" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              </li>
            );
          })}
          {filtradas.length === 0 && <li className="folha-nada">Nada encontrado.</li>}
        </ul>
      </FolhaDeBaixo>
    </span>
  );
}
