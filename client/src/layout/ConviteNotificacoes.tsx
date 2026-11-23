import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { abertoComoApp, ligarPush, renovarPush, situacaoPush } from '../lib/push';
import type { ConfigPushDTO } from '../lib/push';
import { Botao } from '../ui';
import '../modules/cadastros/notificacoes.css';

const CHAVE_DISPENSADO = 'financas.convite-notificacoes';

function dispensado(): boolean {
  try {
    return localStorage.getItem(CHAVE_DISPENSADO) === '1';
  } catch {
    return false;
  }
}

// Com o app instalado no celular e as notificações ainda desligadas, convida a ligar (uma vez; o × dispensa).
// Também mantém o servidor com a inscrição atual deste aparelho.
export function ConviteNotificacoes() {
  const [mostrar, setMostrar] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    void renovarPush();
    if (!abertoComoApp() || dispensado()) return;
    void situacaoPush().then((s) => setMostrar(s === 'desligado'));
  }, []);

  if (!mostrar) return null;

  function fechar() {
    try {
      localStorage.setItem(CHAVE_DISPENSADO, '1');
    } catch {
      // Sem armazenamento: só some agora.
    }
    setMostrar(false);
  }

  async function ligar() {
    setOcupado(true);
    try {
      const config = await api.get<ConfigPushDTO>('/notificacoes/push');
      const s = await ligarPush(config.chavePublica);
      if (s === 'ligado') await api.post('/notificacoes/push/teste').catch(() => undefined);
      setMostrar(false);
    } catch {
      setOcupado(false);
    }
  }

  return (
    <div className="notif-convite" role="region" aria-label="Ligar notificações">
      <span className="notif-convite-texto">
        <strong>Receber avisos no celular?</strong>
        Movimentações novas, contas vencendo, limites e metas. Dá para escolher em Meu perfil.
      </span>
      <Botao desabilitado={ocupado} aoClicar={() => void ligar()}>
        Ligar
      </Botao>
      <button type="button" className="notif-convite-fechar" aria-label="Agora não" onClick={fechar}>
        ×
      </button>
    </div>
  );
}
