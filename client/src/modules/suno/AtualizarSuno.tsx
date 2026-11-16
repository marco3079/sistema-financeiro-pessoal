import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { mensagemErro } from '../../lib/financas';
import { Aviso, Botao, Campo, Carregando, Modal } from '../../ui';

// Popup "Atualizar com a sua conta Suno": a pessoa digita o e-mail e a senha da Suno; o serviço da Suno (contêiner)
// entra na conta sem janela, lê as carteiras e o plano, e a API grava. Se a Suno pedir o código da verificação em
// duas etapas, o popup pede o código. A senha não é guardada: vai para o serviço e é usada só nesta atualização.

type Etapa = 'NENHUMA' | 'ENTRANDO' | 'PEDE_CODIGO' | 'LENDO' | 'PRONTA' | 'ERRO' | 'CANCELADA';

interface EstadoAtualizacao {
  etapa: Etapa;
  mensagem: string;
  log: string[];
  carteirasGravadas: number | null;
}

const EM_ANDAMENTO: Etapa[] = ['ENTRANDO', 'PEDE_CODIGO', 'LENDO'];
const INTERVALO_MS = 2000;

export function AtualizarSuno({ aberto, aoFechar, aoConcluir }: { aberto: boolean; aoFechar: () => void; aoConcluir: () => void }) {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [codigo, setCodigo] = useState('');
  const [estado, setEstado] = useState<EstadoAtualizacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const concluido = useRef(false);

  const andando = estado !== null && EM_ANDAMENTO.includes(estado.etapa);

  // Ao abrir: se já há uma atualização em andamento (popup fechado no meio), retoma o acompanhamento.
  useEffect(() => {
    if (!aberto) return;
    concluido.current = false;
    setErro(null);
    api
      .get<EstadoAtualizacao>('/suno/atualizar')
      .then((e) => {
        if (EM_ANDAMENTO.includes(e.etapa)) setEstado(e);
        else setEstado(null);
      })
      .catch(() => undefined);
  }, [aberto]);

  // Acompanha a tarefa enquanto ela anda.
  useEffect(() => {
    if (!aberto || !andando) return;
    const relogio = window.setInterval(() => {
      api
        .get<EstadoAtualizacao>('/suno/atualizar')
        .then((e) => {
          setEstado(e);
          if (e.etapa === 'PRONTA' && e.carteirasGravadas !== null && !concluido.current) {
            concluido.current = true;
            aoConcluir();
          }
        })
        .catch((e: unknown) => setErro(mensagemErro(e)));
    }, INTERVALO_MS);
    return () => window.clearInterval(relogio);
  }, [aberto, andando]);

  async function entrar(evento: FormEvent) {
    evento.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      const e = await api.post<EstadoAtualizacao>('/suno/atualizar', { email, senha });
      setEstado(e);
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setSenha(''); // a senha não fica no popup depois de enviada
      setEnviando(false);
    }
  }

  async function enviarCodigo(evento: FormEvent) {
    evento.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      const e = await api.post<EstadoAtualizacao>('/suno/atualizar/codigo', { codigo });
      setEstado(e);
      setCodigo('');
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setEnviando(false);
    }
  }

  async function cancelar() {
    try {
      const e = await api.post<EstadoAtualizacao>('/suno/atualizar/cancelar', {});
      setEstado(e);
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }

  function fechar() {
    setSenha('');
    setCodigo('');
    if (!andando) setEstado(null);
    aoFechar();
  }

  const mostrarFormulario = estado === null || estado.etapa === 'NENHUMA';

  return (
    <Modal aberto={aberto} titulo="Atualizar com a sua conta Suno" aoFechar={fechar}>
      <div className="suno-popup">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}

        {mostrarFormulario && (
          <form onSubmit={entrar} className="suno-popup">
            <p className="fin-suave">
              Entre com o e-mail e a senha da sua conta Suno. O sistema entra na Suno por você, lê as carteiras que você
              assina e o seu plano. A senha é usada só nesta atualização: não fica guardada.
            </p>
            <Campo rotulo="E-mail da Suno" tipo="email" valor={email} aoMudar={setEmail} obrigatorio />
            <Campo rotulo="Senha da Suno" tipo="password" valor={senha} aoMudar={setSenha} obrigatorio />
            <div className="pagina-acoes">
              <Botao variante="texto" aoClicar={fechar}>
                Cancelar
              </Botao>
              <Botao tipo="submit" desabilitado={enviando || !email || !senha}>
                {enviando ? 'Enviando...' : 'Entrar e atualizar'}
              </Botao>
            </div>
          </form>
        )}

        {estado && !mostrarFormulario && (
          <>
            {andando && estado.etapa !== 'PEDE_CODIGO' && (
              <div className="suno-andamento">
                <Carregando />
                <strong>{estado.mensagem || 'Atualizando...'}</strong>
                <span className="fin-suave">Leva de 1 a 3 minutos. Pode fechar o popup: a atualização continua.</span>
              </div>
            )}

            {estado.etapa === 'PEDE_CODIGO' && (
              <form onSubmit={enviarCodigo} className="suno-popup">
                <Aviso tipo="info">{estado.mensagem}</Aviso>
                <Campo rotulo="Código de verificação" valor={codigo} aoMudar={setCodigo} obrigatorio />
                <div className="pagina-acoes">
                  <Botao variante="texto" aoClicar={cancelar}>
                    Cancelar atualização
                  </Botao>
                  <Botao tipo="submit" desabilitado={enviando || codigo.trim().length < 4}>
                    {enviando ? 'Enviando...' : 'Enviar código'}
                  </Botao>
                </div>
              </form>
            )}

            {estado.etapa === 'PRONTA' && (
              <Aviso tipo="info">
                Pronto: {estado.carteirasGravadas ?? 0} carteiras atualizadas com a sua conta Suno.
              </Aviso>
            )}
            {(estado.etapa === 'ERRO' || estado.etapa === 'CANCELADA') && <Aviso tipo="erro">{estado.mensagem}</Aviso>}

            {estado.log.length > 0 && (
              <ul className="suno-log">
                {estado.log.map((linha, i) => (
                  <li key={i}>{linha}</li>
                ))}
              </ul>
            )}

            <div className="pagina-acoes">
              {andando && estado.etapa !== 'PEDE_CODIGO' && (
                <Botao variante="texto" aoClicar={cancelar}>
                  Cancelar atualização
                </Botao>
              )}
              {(estado.etapa === 'ERRO' || estado.etapa === 'CANCELADA') && (
                <Botao variante="secundario" aoClicar={() => setEstado(null)}>
                  Tentar de novo
                </Botao>
              )}
              {!andando && <Botao aoClicar={fechar}>Fechar</Botao>}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
