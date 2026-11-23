import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import { abertoComoApp, desligarPush, ehIphone, ligarPush, situacaoPush } from '../../lib/push';
import type { ConfigPushDTO, PreferenciasPushDTO, SituacaoPush } from '../../lib/push';
import { Aviso, Botao, Caixa, Cartao, Carregando, Escolha } from '../../ui';
import './notificacoes.css';

const HORAS = Array.from({ length: 24 }, (_, h) => ({ valor: String(h), rotulo: `${String(h).padStart(2, '0')}:00` }));

function textoDaSituacao(s: SituacaoPush): string {
  switch (s) {
    case 'ligado':
      return 'Ligadas neste aparelho.';
    case 'bloqueado':
      return 'O navegador está bloqueando as notificações deste site. Libere nas configurações do navegador (cadeado ao lado do endereço) e volte aqui.';
    case 'sem-https':
      return 'Para receber notificações, abra o sistema pelo endereço com https (o do Tailscale, no botão "Celular").';
    case 'sem-suporte':
      return ehIphone() && !abertoComoApp()
        ? 'No iPhone, primeiro instale o app: Compartilhar > Adicionar à Tela de Início. Depois abra pelo ícone e ligue aqui.'
        : 'Este navegador não recebe notificações.';
    default:
      return 'Desligadas neste aparelho.';
  }
}

// Meu perfil > Notificações: liga o aparelho, escolhe os tipos e o horário de silêncio.
export function CartaoNotificacoes() {
  const config = useDados<ConfigPushDTO>('/notificacoes/push');
  const [situacao, setSituacao] = useState<SituacaoPush | null>(null);
  const [pref, setPref] = useState<PreferenciasPushDTO | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState<{ tipo: 'erro' | 'sucesso'; texto: string } | null>(null);

  useEffect(() => {
    void situacaoPush().then(setSituacao);
  }, []);

  useEffect(() => {
    if (config.dados) setPref(config.dados.preferencias);
  }, [config.dados]);

  async function ligar() {
    if (!config.dados) return;
    setOcupado(true);
    setMensagem(null);
    try {
      const nova = await ligarPush(config.dados.chavePublica);
      setSituacao(nova);
      if (nova === 'ligado') {
        const r = await api.post<{ entregues: number }>('/notificacoes/push/teste');
        setMensagem({
          tipo: 'sucesso',
          texto: r.entregues > 0 ? 'Pronto! Mandamos uma notificação de teste.' : 'Ligado. O teste não chegou: tente "Enviar teste" daqui a pouco.',
        });
        config.recarregar();
      }
    } catch (e) {
      setMensagem({ tipo: 'erro', texto: e instanceof Error ? e.message : 'Não foi possível ligar.' });
    } finally {
      setOcupado(false);
    }
  }

  async function desligar() {
    setOcupado(true);
    setMensagem(null);
    try {
      await desligarPush();
      setSituacao(await situacaoPush());
      config.recarregar();
    } finally {
      setOcupado(false);
    }
  }

  async function testar() {
    setOcupado(true);
    setMensagem(null);
    try {
      const r = await api.post<{ entregues: number }>('/notificacoes/push/teste');
      setMensagem(
        r.entregues > 0
          ? { tipo: 'sucesso', texto: `Enviada para ${r.entregues} aparelho(s).` }
          : { tipo: 'erro', texto: 'Nenhum aparelho recebeu. Ligue as notificações de novo.' },
      );
    } catch (e) {
      setMensagem({ tipo: 'erro', texto: e instanceof Error ? e.message : 'Falha no teste.' });
    } finally {
      setOcupado(false);
    }
  }

  async function salvar(nova: PreferenciasPushDTO) {
    const anterior = pref;
    setPref(nova);
    try {
      setPref(await api.put<PreferenciasPushDTO>('/notificacoes/push/preferencias', nova));
    } catch (e) {
      setPref(anterior);
      setMensagem({ tipo: 'erro', texto: e instanceof Error ? e.message : 'Não foi possível salvar.' });
    }
  }

  function alternarTipo(id: string, ligado: boolean) {
    if (!pref) return;
    const desligados = ligado ? pref.desligados.filter((t) => t !== id) : [...pref.desligados, id];
    void salvar({ ...pref, desligados });
  }

  return (
    <Cartao titulo="Notificações no celular">
      {config.erro && <Aviso tipo="erro">{config.erro}</Aviso>}
      {(!config.dados || situacao === null) && !config.erro && <Carregando />}
      {config.dados && situacao !== null && pref && (
        <>
          <div className="notif-estado">
            <span className={situacao === 'ligado' ? 'notif-ponto notif-ponto-ligado' : 'notif-ponto'} aria-hidden="true" />
            <p className="notif-estado-texto">{textoDaSituacao(situacao)}</p>
          </div>
          {config.dados.aparelhos > 0 && (
            <p className="notif-suave">
              {config.dados.aparelhos === 1 ? '1 aparelho recebe' : `${config.dados.aparelhos} aparelhos recebem`} as suas
              notificações.
            </p>
          )}
          <div className="notif-botoes">
            {situacao === 'desligado' && (
              <Botao desabilitado={ocupado} aoClicar={() => void ligar()}>
                Ligar notificações
              </Botao>
            )}
            {situacao === 'ligado' && (
              <>
                <Botao variante="secundario" desabilitado={ocupado} aoClicar={() => void testar()}>
                  Enviar teste
                </Botao>
                <Botao variante="texto" desabilitado={ocupado} aoClicar={() => void desligar()}>
                  Desligar neste aparelho
                </Botao>
              </>
            )}
          </div>
          {mensagem && <Aviso tipo={mensagem.tipo}>{mensagem.texto}</Aviso>}

          <h3 className="notif-subtitulo">O que avisar</h3>
          <ul className="notif-tipos">
            {config.dados.tipos.map((t) => (
              <li key={t.id}>
                <label className="notif-tipo">
                  <span className="notif-tipo-texto">
                    <span className="notif-tipo-rotulo">{t.rotulo}</span>
                    <span className="notif-suave">{t.descricao}</span>
                  </span>
                  <input
                    type="checkbox"
                    role="switch"
                    className="notif-chave"
                    checked={!pref.desligados.includes(t.id)}
                    onChange={(e) => alternarTipo(t.id, e.target.checked)}
                  />
                </label>
              </li>
            ))}
          </ul>

          <h3 className="notif-subtitulo">Horário de silêncio</h3>
          <Caixa
            rotulo="Chegar sem som em um horário (segurança toca sempre)"
            marcado={pref.silencioAtivo}
            aoMudar={(v) => void salvar({ ...pref, silencioAtivo: v })}
          />
          {pref.silencioAtivo && (
            <div className="notif-horas">
              <label className="campo">
                <span className="campo-rotulo">Das</span>
                <Escolha
                  valor={String(pref.silencioInicio)}
                  titulo="Início do silêncio"
                  opcoes={HORAS}
                  aoMudar={(v) => void salvar({ ...pref, silencioInicio: Number(v) })}
                />
              </label>
              <label className="campo">
                <span className="campo-rotulo">Até</span>
                <Escolha
                  valor={String(pref.silencioFim)}
                  titulo="Fim do silêncio"
                  opcoes={HORAS}
                  aoMudar={(v) => void salvar({ ...pref, silencioFim: Number(v) })}
                />
              </label>
            </div>
          )}
        </>
      )}
    </Cartao>
  );
}
