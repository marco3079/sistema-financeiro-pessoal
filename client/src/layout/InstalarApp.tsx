import { useEffect, useState } from 'react';
import { Botao } from '../ui';

// Evento do navegador que oferece a instalação (Chrome, Edge e Android). Não está nos tipos padrão do TypeScript.
interface EventoInstalar extends Event {
  prompt(): Promise<void>;
}

// O evento "beforeinstallprompt" pode chegar antes de o botão aparecer (o Modal só monta quando abre),
// então ele é guardado aqui, desde que este módulo é carregado, e não só dentro do componente.
let eventoGuardado: EventoInstalar | null = null;
let instaladoAgora = false;
const ouvintes = new Set<() => void>();

function avisar() {
  ouvintes.forEach((f) => f());
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    eventoGuardado = e as EventoInstalar;
    avisar();
  });
  window.addEventListener('appinstalled', () => {
    eventoGuardado = null;
    instaladoAgora = true;
    avisar();
  });
}

// Já aberto como aplicativo (janela própria): não mostra nada.
function jaInstalado(): boolean {
  if (instaladoAgora) return true;
  if (typeof window === 'undefined') return false;
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  return (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

// iPhone e iPad não têm o evento: a instalação é pelo menu de compartilhar do Safari.
function ehIphone(): boolean {
  return typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent);
}

export function InstalarApp(): JSX.Element | null {
  const [evento, setEvento] = useState<EventoInstalar | null>(eventoGuardado);
  const [instalado, setInstalado] = useState<boolean>(jaInstalado);

  useEffect(() => {
    const atualizar = () => {
      setEvento(eventoGuardado);
      setInstalado(jaInstalado());
    };
    ouvintes.add(atualizar);
    atualizar();
    return () => {
      ouvintes.delete(atualizar);
    };
  }, []);

  if (instalado) return null;

  if (evento) {
    return (
      <Botao
        variante="secundario"
        aoClicar={async () => {
          try {
            await evento.prompt();
          } catch {
            // O navegador recusou mostrar a janela: nada a fazer.
          }
          // O evento só vale uma vez.
          eventoGuardado = null;
          avisar();
        }}
      >
        Instalar aplicativo
      </Botao>
    );
  }

  if (ehIphone()) {
    return (
      <p className="botao-celular-texto">
        {'No iPhone: Compartilhar > Adicionar à Tela de Início'}
      </p>
    );
  }

  return null;
}
