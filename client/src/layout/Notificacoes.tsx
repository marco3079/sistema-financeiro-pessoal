import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useDados } from '../lib/useDados';
import { Icone } from '../ui/icones';

interface AvisoDTO {
  chave: string;
  titulo: string;
  meta: string;
  quando: string;
  caminho: string;
}

const MAXIMO_LISTA = 6;

// "agora", "há 5 min", "há 2 h", "há 3 dias".
function tempoDesde(iso: string): string {
  const minutos = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (Number.isNaN(minutos) || minutos < 1) return 'agora';
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${horas} h`;
  const dias = Math.floor(horas / 24);
  return `há ${dias} ${dias === 1 ? 'dia' : 'dias'}`;
}
const INTERVALO_MS = 60000;

// Sino do topo: o que pede atenção agora (fatura vencendo, orçamento estourado, conexão com erro).
// `raiz` é o caminho do portal (ex.: /app); a tela de faturas fica em `${raiz}/cartoes`.
export function Notificacoes({ raiz }: { raiz: string }) {
  const navigate = useNavigate();
  const { dados, erro, recarregar } = useDados<AvisoDTO[]>('/notificacoes');
  const [aberto, setAberto] = useState(false);
  const area = useRef<HTMLDivElement>(null);
  const caminhoFaturas = `${raiz}/cartoes`;

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

  // Atualiza a cada 60 s (só com a aba visível) e quando a janela volta a ter foco. recarregar é estável.
  useEffect(() => {
    const intervalo = window.setInterval(() => {
      if (document.visibilityState === 'visible') recarregar();
    }, INTERVALO_MS);
    const aoFocar = () => recarregar();
    window.addEventListener('focus', aoFocar);
    return () => {
      window.clearInterval(intervalo);
      window.removeEventListener('focus', aoFocar);
    };
  }, [recarregar]);

  const lista = dados ?? [];
  const total = lista.length;
  const recentes = lista.slice(0, MAXIMO_LISTA);

  function abrirAviso(aviso: AvisoDTO) {
    setAberto(false);
    navigate(aviso.caminho);
  }

  return (
    <div className="casca-sino-area" ref={area}>
      <button
        type="button"
        className="casca-botao-redondo"
        aria-label={total > 0 ? `Avisos, ${total} pendentes` : 'Avisos'}
        aria-expanded={aberto}
        onClick={() => setAberto((v) => !v)}
      >
        <Icone nome="sino" tamanho={22} />
        {total > 0 && (
          <span className="casca-contador" aria-hidden="true">
            {total > 9 ? '9+' : total}
          </span>
        )}
      </button>

      {aberto && (
        <div className="casca-painel-avisos" role="dialog" aria-label="Avisos recentes">
          <div className="casca-painel-cabecalho">
            <strong>Avisos</strong>
            <Link to={caminhoFaturas} className="casca-link" onClick={() => setAberto(false)}>
              Ver faturas
            </Link>
          </div>

          {erro && <p className="casca-painel-vazio">Não foi possível carregar os avisos.</p>}
          {!erro && recentes.length === 0 && <p className="casca-painel-vazio">Nada pendente agora.</p>}

          <ul className="casca-avisos-lista">
            {recentes.map((aviso) => (
              <li key={aviso.chave}>
                <button type="button" className="casca-aviso" onClick={() => abrirAviso(aviso)}>
                  <span className="casca-aviso-ponto" aria-hidden="true" />
                  <span className="casca-aviso-texto">
                    <span className="casca-aviso-titulo">{aviso.titulo}</span>
                    <span className="casca-aviso-meta">
                      {aviso.meta} · {tempoDesde(aviso.quando)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
