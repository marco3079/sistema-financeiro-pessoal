import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { abertoComoApp, ehIphone, ligarPush, renovarPush, situacaoPush } from '../lib/push';
import type { ConfigPushDTO } from '../lib/push';
import { Botao } from '../ui';
import '../modules/cadastros/notificacoes.css';

const CHAVE_DISPENSADO = 'financas.convite-notificacoes';
const CHAVE_PEDIDO_NA_SESSAO = 'financas.permissao-pedida';

function lerFlag(armazem: 'local' | 'sessao', chave: string): boolean {
  try {
    return (armazem === 'local' ? localStorage : sessionStorage).getItem(chave) === '1';
  } catch {
    return false;
  }
}

function gravarFlag(armazem: 'local' | 'sessao', chave: string): void {
  try {
    (armazem === 'local' ? localStorage : sessionStorage).setItem(chave, '1');
  } catch {
    // Sem armazenamento: vale só para agora.
  }
}

function ehCelular(): boolean {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.matchMedia('(pointer: coarse) and (max-width: 900px)').matches;
}

type Modo = 'nada' | 'convite' | 'instalar-iphone';

// Ao abrir no celular (ou no app instalado), confere a permissão de notificações:
// - já permitida e sem inscrição: inscreve este aparelho sozinho;
// - ainda não decidida: pede a permissão na hora (uma vez por sessão); se o navegador exigir um toque, ou a pessoa
//   fechar o pedido, fica o convite com o botão Permitir;
// - iPhone fora do app instalado: explica que precisa instalar.
// O × dispensa o convite. Também mantém o servidor com a inscrição atual deste aparelho.
export function ConviteNotificacoes() {
  const [modo, setModo] = useState<Modo>('nada');
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    let vivo = true;
    void renovarPush();
    const noCelular = ehCelular();
    if (!noCelular && !abertoComoApp()) return;

    void (async () => {
      const situacao = await situacaoPush();
      if (!vivo) return;
      if (situacao === 'sem-suporte') {
        if (ehIphone() && !abertoComoApp() && !lerFlag('local', CHAVE_DISPENSADO)) setModo('instalar-iphone');
        return;
      }
      if (situacao !== 'desligado') return;

      const permissao = Notification.permission;
      const dispensado = lerFlag('local', CHAVE_DISPENSADO);
      // Permissão já dada (só falta inscrever) ou ainda não decidida: tenta agora, uma vez por sessão.
      if (permissao === 'granted' || (permissao === 'default' && !dispensado && !lerFlag('sessao', CHAVE_PEDIDO_NA_SESSAO))) {
        gravarFlag('sessao', CHAVE_PEDIDO_NA_SESSAO);
        try {
          const config = await api.get<ConfigPushDTO>('/notificacoes/push');
          const depois = await ligarPush(config.chavePublica);
          if (depois === 'ligado') return;
        } catch {
          // O navegador exige um toque para pedir a permissão: fica o convite com o botão.
        }
      }
      if (vivo && !dispensado && Notification.permission !== 'denied') setModo('convite');
    })();

    return () => {
      vivo = false;
    };
  }, []);

  if (modo === 'nada') return null;

  function fechar() {
    gravarFlag('local', CHAVE_DISPENSADO);
    setModo('nada');
  }

  async function ligar() {
    setOcupado(true);
    try {
      const config = await api.get<ConfigPushDTO>('/notificacoes/push');
      const s = await ligarPush(config.chavePublica);
      if (s === 'ligado') await api.post('/notificacoes/push/teste').catch(() => undefined);
      if (s !== 'desligado') setModo('nada');
    } catch {
      // Mantém o convite para tentar de novo.
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="notif-convite" role="region" aria-label="Notificações">
      {modo === 'convite' ? (
        <>
          <span className="notif-convite-texto">
            <strong>Receber avisos neste celular?</strong>
            Movimentações novas, contas vencendo, limites e metas. Dá para escolher em Meu perfil.
          </span>
          <Botao desabilitado={ocupado} aoClicar={() => void ligar()}>
            Permitir
          </Botao>
        </>
      ) : (
        <span className="notif-convite-texto">
          <strong>Avisos no iPhone</strong>
          Para receber notificações, instale o app: toque em Compartilhar, depois em Adicionar à Tela de Início, e abra por ele.
        </span>
      )}
      <button type="button" className="notif-convite-fechar" aria-label="Agora não" onClick={fechar}>
        ×
      </button>
    </div>
  );
}
