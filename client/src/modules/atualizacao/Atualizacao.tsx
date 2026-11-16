import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { mensagemErro } from '../../lib/financas';
import { Aviso, Botao, Cartao, Carregando, Modal, Pagina, formatarDataHora } from '../../ui';
import { ResumoItem } from '../../ui/financas';
import { CopiasDoBanco } from './CopiasDoBanco';
import './atualizacao.css';

export interface CommitDTO {
  commit: string;
  data: string | null;
  mensagem: string;
}

export interface AtualizacaoDTO {
  // null: o script ainda não rodou neste computador (não se sabe qual commit está instalado)
  instalada: { commit: string; data: string | null; mensagem: string | null; repositorio: string; ramo: string } | null;
  ultima: CommitDTO | null; // último commit do GitHub
  novidades: CommitDTO[]; // commits que faltam aqui, do mais novo para o mais antigo
  haNovidade: boolean;
  erroDoGitHub: string | null;
  vigiaAtivo: boolean; // o atualizador está ligado neste computador
  pedidoPendente: boolean;
  ultimaAtualizacao: { situacao: 'ATUALIZANDO' | 'OK' | 'ERRO'; mensagem: string; em: string | null } | null;
}

type InstaladaDTO = NonNullable<AtualizacaoDTO['instalada']>;

const INTERVALO_ANDAMENTO_MS = 4_000;
const INTERVALO_OCIOSO_MS = 60_000;

function linhaInstalada(i: InstaladaDTO): string {
  const partes = [`Instalada: ${i.commit.slice(0, 7)}`];
  if (i.mensagem) partes.push(i.mensagem);
  if (i.data) partes.push(formatarDataHora(i.data));
  return partes.join(' · ');
}

export function Atualizacao() {
  const [estado, setEstado] = useState<AtualizacaoDTO | null>(null);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const [conferindo, setConferindo] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [pedindo, setPedindo] = useState(false);
  const [aguardando, setAguardando] = useState(false); // pedido aceito, ainda sem resultado
  const [reiniciando, setReiniciando] = useState(false); // consulta falhou durante a atualização
  const [atualizado, setAtualizado] = useState(false); // o commit instalado mudou
  // Commit instalado e instante do pedido: servem para reconhecer o fim da atualização.
  const commitNoPedido = useRef<string | null>(null);
  const momentoPedido = useRef(0);
  const esperandoRef = useRef(false);

  const aplicar = useCallback((dados: AtualizacaoDTO) => {
    setEstado(dados);
    setErroCarga(null);
    setReiniciando(false);
    if (!esperandoRef.current) return;
    const mudou = (dados.instalada?.commit ?? null) !== commitNoPedido.current;
    const ua = dados.ultimaAtualizacao;
    const terminou =
      ua !== null &&
      (ua.situacao === 'OK' || ua.situacao === 'ERRO') &&
      ua.em !== null &&
      new Date(ua.em).getTime() > momentoPedido.current;
    if (!mudou && !terminou) return;
    esperandoRef.current = false;
    setAguardando(false);
    if (mudou) setAtualizado(true);
  }, []);

  const falhou = useCallback((e: unknown, andando: boolean) => {
    if (andando) setReiniciando(true);
    else setErroCarga(mensagemErro(e));
  }, []);

  const emAndamento =
    (estado?.pedidoPendente ?? false) || estado?.ultimaAtualizacao?.situacao === 'ATUALIZANDO' || aguardando;

  // Consulta ao montar e depois periodicamente (mais rápido durante a atualização).
  useEffect(() => {
    let ativo = true;
    function consultar() {
      api
        .get<AtualizacaoDTO>('/atualizacao')
        .then((dados) => {
          if (ativo) aplicar(dados);
        })
        .catch((e: unknown) => {
          if (ativo) falhou(e, emAndamento);
        });
    }
    consultar();
    const intervalo = window.setInterval(consultar, emAndamento ? INTERVALO_ANDAMENTO_MS : INTERVALO_OCIOSO_MS);
    return () => {
      ativo = false;
      window.clearInterval(intervalo);
    };
  }, [emAndamento, aplicar, falhou]);

  function conferir() {
    setConferindo(true);
    api
      .get<AtualizacaoDTO>('/atualizacao?conferir=1')
      .then(aplicar)
      .catch((e: unknown) => setErroCarga(mensagemErro(e)))
      .finally(() => setConferindo(false));
  }

  function confirmarPedido() {
    const commitAgora = estado?.instalada?.commit ?? null;
    const momento = Date.now();
    setPedindo(true);
    setErroAcao(null);
    api
      .post<AtualizacaoDTO>('/atualizacao/pedir', {})
      .then((dados) => {
        commitNoPedido.current = commitAgora;
        momentoPedido.current = momento;
        esperandoRef.current = true;
        setAtualizado(false);
        setAguardando(true);
        setEstado(dados);
      })
      .catch((e: unknown) => setErroAcao(mensagemErro(e)))
      .finally(() => {
        setPedindo(false);
        setConfirmando(false);
      });
  }

  const acoes = (
    <Botao variante="secundario" desabilitado={conferindo || emAndamento} aoClicar={conferir}>
      {conferindo ? 'Conferindo…' : 'Conferir agora'}
    </Botao>
  );

  if (!estado) {
    return (
      <Pagina titulo="Atualização" acoes={acoes}>
        {erroCarga ? <Aviso tipo="erro">{erroCarga}</Aviso> : <Carregando />}
      </Pagina>
    );
  }

  const { instalada, ultima, novidades, haNovidade, erroDoGitHub, vigiaAtivo, ultimaAtualizacao } = estado;
  const quandoUltima = ultimaAtualizacao?.em ? formatarDataHora(ultimaAtualizacao.em) : '';

  return (
    <Pagina titulo="Atualização" acoes={acoes}>
      <div className="atu-blocos">
        {erroCarga && <Aviso tipo="erro">{erroCarga}</Aviso>}
        {reiniciando && <Aviso tipo="info">O sistema está reiniciando…</Aviso>}
        {atualizado && (
          <Aviso tipo="info">
            <span>Sistema atualizado. </span>
            <Botao aoClicar={() => window.location.reload()}>Recarregar a página</Botao>
          </Aviso>
        )}
        {erroDoGitHub && <Aviso tipo="erro">{erroDoGitHub}</Aviso>}

        <div className="resumo">
          <ResumoItem
            icone="documento"
            cor="roxo"
            valor={instalada ? instalada.commit.slice(0, 7) : 'Desconhecida'}
            rotulo="Versão instalada"
          />
          <ResumoItem icone="seta-cima" cor="azul" valor={ultima ? ultima.commit.slice(0, 7) : '—'} rotulo="Última versão no GitHub" />
          {emAndamento ? (
            <ResumoItem icone="sincronizar" cor="azul" valor="Atualizando…" rotulo="Situação" />
          ) : haNovidade ? (
            <ResumoItem icone="seta-baixo" cor="laranja" valor="Há versão nova" rotulo="Situação" />
          ) : instalada && !erroDoGitHub ? (
            <ResumoItem icone="visto" cor="verde" valor="Em dia" rotulo="Situação" />
          ) : (
            <ResumoItem icone="atividade" cor="azul" valor="—" rotulo="Situação" />
          )}
        </div>

        {instalada === null ? (
          <Cartao titulo="Ligue o atualizador">
            <div className="atu-conteudo">
              <p>
                {
                  'O sistema ainda não sabe qual versão está instalada neste computador: o atualizador não está rodando. Na pasta em que ele foi instalado, rode o instalador de novo (ele cria o atualizador junto com os outros contêineres):'
                }
              </p>
              <code className="atu-codigo">powershell -ExecutionPolicy Bypass -File instalar.ps1</code>
              <p className="atu-suave">
                {
                  'No Linux e no Mac: bash instalar.sh. O atualizador é um contêiner que espera o seu clique em "Atualizar agora". Ele só sabe baixar a versão nova deste repositório e reconstruir o sistema.'
                }
              </p>
            </div>
          </Cartao>
        ) : (
          <Cartao titulo={haNovidade ? 'Há uma versão nova' : 'Você está na última versão'}>
            <div className="atu-conteudo">
              <p className="atu-suave">{linhaInstalada(instalada)}</p>
              <p className="atu-suave">{`Repositório: ${instalada.repositorio} (${instalada.ramo})`}</p>

              {emAndamento ? (
                <div className="atu-andamento">
                  <Carregando />
                  <p>
                    {ultimaAtualizacao?.situacao === 'ATUALIZANDO'
                      ? ultimaAtualizacao.mensagem
                      : 'Pedido enviado. Aguardando o atualizador…'}
                  </p>
                  <p className="atu-suave">
                    Pode levar alguns minutos. Não feche o Docker. A tela pode ficar sem resposta enquanto o sistema
                    reinicia.
                  </p>
                </div>
              ) : (
                haNovidade && (
                  <>
                    <div>
                      <Botao desabilitado={!vigiaAtivo} aoClicar={() => setConfirmando(true)}>
                        Atualizar agora
                      </Botao>
                    </div>
                    {!vigiaAtivo && (
                      <Aviso tipo="info">
                        {
                          'O atualizador não está ligado neste computador. Para o botão funcionar, rode o instalador de novo (instalar.ps1 ou instalar.sh), que cria o contêiner atualizador. Ou atualize agora rodando atualizar.ps1.'
                        }
                      </Aviso>
                    )}
                  </>
                )
              )}

              {erroAcao && <Aviso tipo="erro">{erroAcao}</Aviso>}
            </div>
          </Cartao>
        )}

        {novidades.length > 0 && (
          <Cartao titulo={`O que há de novo (${novidades.length})`}>
            <ul className="atu-novidades">
              {novidades.map((c) => (
                <li key={c.commit}>
                  <code>{c.commit.slice(0, 7)}</code> <span>{c.mensagem}</span>
                  {c.data && <span className="atu-suave"> · {formatarDataHora(c.data)}</span>}
                </li>
              ))}
            </ul>
          </Cartao>
        )}

        {ultimaAtualizacao &&
          (ultimaAtualizacao.situacao === 'OK' || ultimaAtualizacao.situacao === 'ERRO') &&
          !emAndamento && (
            <Aviso tipo={ultimaAtualizacao.situacao === 'ERRO' ? 'erro' : 'info'}>
              {ultimaAtualizacao.situacao === 'ERRO' ? 'A última atualização falhou: ' : 'Última atualização: '}
              {ultimaAtualizacao.mensagem}
              {quandoUltima && ` (${quandoUltima})`}
            </Aviso>
          )}

        <CopiasDoBanco
          ocupado={emAndamento}
          aoPedir={() => {
            // Mesmo acompanhamento da atualização: espera o atualizador terminar e o sistema voltar.
            commitNoPedido.current = estado?.instalada?.commit ?? null;
            momentoPedido.current = Date.now();
            esperandoRef.current = true;
            setAtualizado(false);
            setAguardando(true);
          }}
        />

        <Cartao titulo="Como funciona">
          <ul>
            <li>O sistema compara a versão instalada com o último commit do repositório no GitHub.</li>
            <li>Ao atualizar, uma cópia do banco de dados é guardada na pasta backups (ficam as 5 mais recentes).</li>
            <li>Seus dados não são apagados: só o programa é trocado.</li>
            <li>
              Se você alterou arquivos do sistema neste computador e eles conflitarem com a versão nova, a atualização
              para sem apagar nada e mostra o erro aqui.
            </li>
            <li>{'Para desligar o atualizador: docker compose stop atualizador (volta com docker compose up -d).'}</li>
          </ul>
        </Cartao>
      </div>

      <Modal
        aberto={confirmando}
        titulo="Atualizar o sistema"
        aoFechar={() => {
          if (!pedindo) setConfirmando(false);
        }}
      >
        <p>
          O sistema guarda uma cópia do banco de dados, baixa a versão nova do GitHub e reinicia. Ele fica fora do ar
          por alguns minutos.
        </p>
        <div className="pagina-acoes">
          <Botao variante="secundario" desabilitado={pedindo} aoClicar={() => setConfirmando(false)}>
            Cancelar
          </Botao>
          <Botao desabilitado={pedindo} aoClicar={confirmarPedido}>
            Atualizar
          </Botao>
        </div>
      </Modal>
    </Pagina>
  );
}
