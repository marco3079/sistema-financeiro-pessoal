import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import type { RotaModulo } from '../lib/rotas';
import { Icone } from '../ui/icones';

interface Resultado {
  tipo: string;
  titulo: string;
  subtitulo: string;
  caminho: string;
}

interface Opcao extends Resultado {
  chave: string;
}

const ESPERA_MS = 300;
const MINIMO = 2;

// Campo de busca do topo. Mostra as telas do menu cujo rótulo bate com o texto e, depois, os resultados da API.
export function Busca({ telas }: { telas: RotaModulo[] }) {
  const navigate = useNavigate();
  const [texto, setTexto] = useState('');
  const [aberto, setAberto] = useState(false);
  const [resultados, setResultados] = useState<Resultado[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [ativo, setAtivo] = useState(-1);
  const raiz = useRef<HTMLDivElement>(null);

  const termo = texto.trim();
  const buscando = termo.length >= MINIMO;

  // Busca na API com espera de 300 ms; respostas de buscas antigas são ignoradas.
  useEffect(() => {
    if (!buscando) {
      setResultados([]);
      setCarregando(false);
      return;
    }
    let cancelado = false;
    setCarregando(true);
    const timer = window.setTimeout(() => {
      api
        .get<Resultado[]>('/busca?q=' + encodeURIComponent(termo))
        .then((lista) => {
          if (!cancelado) setResultados(lista);
        })
        .catch(() => {
          if (!cancelado) setResultados([]);
        })
        .finally(() => {
          if (!cancelado) setCarregando(false);
        });
    }, ESPERA_MS);
    return () => {
      cancelado = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [termo]);

  // Telas do menu primeiro, depois os resultados agrupados por tipo.
  const opcoes: Opcao[] = useMemo(() => {
    if (!buscando) return [];
    const minusculo = termo.toLowerCase();
    const emTelas: Opcao[] = telas
      .filter((r) => r.rotulo.toLowerCase().includes(minusculo))
      .map((r, i) => ({
        chave: `tela-${i}`,
        tipo: 'Tela',
        titulo: r.rotulo,
        subtitulo: 'Tela do menu',
        caminho: r.caminho,
      }));
    const porTipo = new Map<string, Resultado[]>();
    for (const r of resultados) {
      const lista = porTipo.get(r.tipo) ?? [];
      lista.push(r);
      porTipo.set(r.tipo, lista);
    }
    const emApi: Opcao[] = [];
    porTipo.forEach((lista, tipo) =>
      lista.forEach((r, i) => emApi.push({ ...r, chave: `${tipo}-${i}` })),
    );
    return [...emTelas, ...emApi];
  }, [buscando, termo, telas, resultados]);

  // Fecha ao clicar fora.
  useEffect(() => {
    if (!aberto) return;
    function fora(e: MouseEvent) {
      if (raiz.current && !raiz.current.contains(e.target as Node)) setAberto(false);
    }
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [aberto]);

  const painelVisivel = aberto && buscando;

  function escolher(opcao: Opcao) {
    setAberto(false);
    setTexto('');
    setAtivo(-1);
    navigate(opcao.caminho);
  }

  function teclar(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setAberto(false);
      setAtivo(-1);
      return;
    }
    if (!painelVisivel || opcoes.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setAtivo((i) => (i + 1) % opcoes.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setAtivo((i) => (i <= 0 ? opcoes.length - 1 : i - 1));
    } else if (e.key === 'Enter' && ativo >= 0 && ativo < opcoes.length) {
      e.preventDefault();
      escolher(opcoes[ativo]);
    }
  }

  // Agrupa os itens por tipo só para mostrar o cabeçalho de cada seção.
  const cabecalhos: Record<number, string> = {};
  opcoes.forEach((o, i) => {
    if (i === 0 || opcoes[i - 1].tipo !== o.tipo) cabecalhos[i] = o.tipo;
  });

  return (
    <div className="casca-busca" ref={raiz}>
      <div className="casca-busca-campo">
        <Icone nome="busca" tamanho={20} className="casca-busca-icone" />
        <input
          type="text"
          className="casca-busca-entrada"
          placeholder="Buscar por contas, lançamentos, telas..."
          value={texto}
          role="combobox"
          aria-expanded={painelVisivel}
          aria-controls="casca-busca-lista"
          aria-autocomplete="list"
          aria-activedescendant={painelVisivel && ativo >= 0 ? `casca-busca-opcao-${ativo}` : undefined}
          onChange={(e) => {
            setTexto(e.target.value);
            setAberto(true);
            setAtivo(-1);
          }}
          onFocus={() => setAberto(true)}
          onKeyDown={teclar}
        />
      </div>

      {painelVisivel && (
        <div className="casca-busca-painel">
          <ul id="casca-busca-lista" role="listbox" className="casca-busca-lista">
            {opcoes.map((o, i) => (
              <li key={o.chave} role="presentation">
                {cabecalhos[i] && <p className="casca-busca-tipo">{cabecalhos[i]}</p>}
                <div
                  id={`casca-busca-opcao-${i}`}
                  role="option"
                  aria-selected={i === ativo}
                  className={i === ativo ? 'casca-busca-opcao casca-busca-opcao-ativa' : 'casca-busca-opcao'}
                  onMouseEnter={() => setAtivo(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => escolher(o)}
                >
                  <span className="casca-busca-titulo">{o.titulo}</span>
                  <span className="casca-busca-subtitulo">{o.subtitulo}</span>
                </div>
              </li>
            ))}
          </ul>
          {opcoes.length === 0 && (
            <p className="casca-busca-vazio">{carregando ? 'Buscando...' : 'Nenhum resultado'}</p>
          )}
        </div>
      )}
    </div>
  );
}
