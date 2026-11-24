import { useState } from 'react';
import { api } from '../lib/api';
import { abertoComoApp, ehIphone, ligarPush, renovarPush, situacaoPush } from '../lib/push';
import type { ConfigPushDTO, SituacaoPush } from '../lib/push';
import { Botao } from '../ui';
import '../modules/cadastros/notificacoes.css';

// Texto para quando este aparelho não pode receber notificações agora.
export function motivoSemPush(situacao: SituacaoPush): string | null {
  if (situacao === 'sem-https') return 'Abra o sistema pelo endereço seguro (https) para receber notificações.';
  if (situacao === 'sem-suporte') {
    return ehIphone() && !abertoComoApp()
      ? 'No iPhone, instale o app (Compartilhar > Adicionar à Tela de Início) e abra por ele para receber notificações.'
      : 'Este navegador não recebe notificações.';
  }
  if (situacao === 'bloqueado') {
    return 'As notificações estão bloqueadas para este site. Libere nas permissões do navegador (cadeado ao lado do endereço) e tente de novo.';
  }
  return null;
}

interface RespostaTeste {
  entregues: number;
  falhas?: { aparelho: string | null; status: number | null; motivo: string; servico: string }[];
}

// Botão "Testar notificação neste aparelho": confere a permissão, pede se ainda não tiver (o toque no botão é o
// gesto que o navegador exige), inscreve o aparelho e manda uma notificação de teste.
export function TesteNotificacao() {
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState<{ ok: boolean; texto: string } | null>(null);

  async function testar() {
    setOcupado(true);
    setMensagem(null);
    try {
      let situacao = await situacaoPush();
      if (situacao === 'desligado') {
        const config = await api.get<ConfigPushDTO>('/notificacoes/push');
        situacao = await ligarPush(config.chavePublica);
        if (situacao === 'desligado') {
          setMensagem({ ok: false, texto: 'A permissão não foi dada. Toque de novo e escolha Permitir.' });
          return;
        }
      }
      const motivo = motivoSemPush(situacao);
      if (motivo) {
        setMensagem({ ok: false, texto: motivo });
        return;
      }
      let r = await api.post<RespostaTeste>('/notificacoes/push/teste');
      if (r.entregues === 0) {
        // O servidor pode não ter a inscrição deste aparelho: reenvia e tenta mais uma vez.
        await renovarPush();
        r = await api.post<RespostaTeste>('/notificacoes/push/teste');
      }
      if (r.entregues > 0) {
        setMensagem({ ok: true, texto: 'Notificação enviada. Ela deve aparecer neste aparelho em instantes.' });
      } else {
        // Mostra o motivo que o serviço de push devolveu, para dar para corrigir.
        const motivos = (r.falhas ?? []).map((f) => `${f.servico}${f.status ? ' ' + f.status : ''}: ${f.motivo}`);
        setMensagem({
          ok: false,
          texto:
            motivos.length > 0
              ? `O serviço de notificações recusou o envio (${motivos.join(' | ')}).`
              : 'O servidor não tem nenhum aparelho inscrito para esta conta. Desligue e ligue as notificações em Meu perfil.',
        });
      }
    } catch (e) {
      setMensagem({ ok: false, texto: e instanceof Error ? e.message : 'Não foi possível testar agora.' });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="notif-teste">
      <Botao variante="secundario" desabilitado={ocupado} aoClicar={() => void testar()}>
        {ocupado ? 'Enviando...' : 'Testar notificação neste aparelho'}
      </Botao>
      {mensagem && (
        <p className={mensagem.ok ? 'notif-teste-ok' : 'notif-teste-erro'} role="status">
          {mensagem.texto}
        </p>
      )}
    </div>
  );
}
