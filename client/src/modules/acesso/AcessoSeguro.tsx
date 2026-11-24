import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { mensagemErro } from '../../lib/financas';
import { Aviso, Botao, Cartao, Carregando, Modal, Pagina, Selo } from '../../ui';
import './acesso.css';

type SituacaoAcesso = 'INDISPONIVEL' | 'INICIANDO' | 'PRECISA_ENTRAR' | 'AGUARDANDO_APROVACAO' | 'LIGADO' | 'PARADO';

interface EstadoAcessoDTO {
  situacao: SituacaoAcesso;
  linkDeEntrada: string | null; // abrir em nova aba para entrar na conta do Tailscale
  endereco: string | null; // ex.: https://financas.minha-rede.ts.net (só quando LIGADO e com certificado)
  nomeDoAparelho: string | null; // nome com que o sistema aparece na rede Tailscale
  certificado: boolean; // false = a rede ainda não tem "HTTPS Certificates" ligado
  conta: string | null; // conta do Tailscale em uso
  avisos: string[]; // frases prontas para mostrar
}

const INTERVALO_ATUALIZACAO_MS = 4000;
const LINK_DNS_TAILSCALE = 'https://login.tailscale.com/admin/dns';

const SELO_SITUACAO: Record<SituacaoAcesso, { rotulo: string; cor: 'verde' | 'amarelo' | 'vermelho' | 'azul' | 'cinza' }> = {
  INDISPONIVEL: { rotulo: 'Indisponível', cor: 'vermelho' },
  INICIANDO: { rotulo: 'Iniciando', cor: 'azul' },
  PRECISA_ENTRAR: { rotulo: 'Precisa entrar', cor: 'amarelo' },
  AGUARDANDO_APROVACAO: { rotulo: 'Aguardando aprovação', cor: 'amarelo' },
  LIGADO: { rotulo: 'Ligado', cor: 'verde' },
  PARADO: { rotulo: 'Parado', cor: 'cinza' },
};

// Endereço só vale quando existe e o certificado da rede está ligado.
function enderecoPronto(estado: EstadoAcessoDTO): boolean {
  return Boolean(estado.endereco) && estado.certificado;
}

// Enquanto a situação pode mudar sozinha, a tela consulta o servidor de novo.
function precisaAtualizar(estado: EstadoAcessoDTO): boolean {
  if (
    estado.situacao === 'INDISPONIVEL' ||
    estado.situacao === 'PRECISA_ENTRAR' ||
    estado.situacao === 'INICIANDO' ||
    estado.situacao === 'AGUARDANDO_APROVACAO'
  ) {
    return true;
  }
  return estado.situacao === 'LIGADO' && !enderecoPronto(estado);
}

function BlocoEntrar({
  linkDeEntrada,
  ocupado,
  aoEntrar,
}: {
  linkDeEntrada: string | null;
  ocupado: boolean;
  aoEntrar: () => void;
}) {
  return (
    <>
      <div className="acesso-acoes">
        <Botao desabilitado={ocupado} aoClicar={aoEntrar}>
          Entrar no Tailscale
        </Botao>
      </div>
      {linkDeEntrada && (
        <p className="acesso-linha-discreta">
          Link de entrada:{' '}
          <a className="acesso-link" href={linkDeEntrada} target="_blank" rel="noopener noreferrer">
            {linkDeEntrada}
          </a>
        </p>
      )}
    </>
  );
}

// Pede ao atualizador para criar ou reiniciar o contêiner do acesso seguro (mesma rota da tela Status do servidor).
function LigarServico() {
  const [ocupado, setOcupado] = useState(false);
  const [recado, setRecado] = useState<{ ok: boolean; texto: string } | null>(null);

  async function ligar() {
    setOcupado(true);
    setRecado(null);
    try {
      await api.post('/servidor/reiniciar', { servico: 'https' });
      setRecado({ ok: true, texto: 'Pedido enviado. O serviço leva até um minuto para subir; esta tela atualiza sozinha.' });
    } catch (e) {
      setRecado({ ok: false, texto: mensagemErro(e) });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <>
      <Botao desabilitado={ocupado} aoClicar={() => void ligar()}>
        {ocupado ? 'Pedindo...' : 'Ligar o serviço'}
      </Botao>
      {recado && <Aviso tipo={recado.ok ? 'sucesso' : 'erro'}>{recado.texto}</Aviso>}
    </>
  );
}

function ConteudoSituacao({
  estado,
  ocupado,
  copiado,
  aoEntrar,
  aoTentarDeNovo,
  aoCopiar,
  aoAbrir,
  aoPedirSair,
}: {
  estado: EstadoAcessoDTO;
  ocupado: boolean;
  copiado: boolean;
  aoEntrar: () => void;
  aoTentarDeNovo: () => void;
  aoCopiar: (endereco: string) => void;
  aoAbrir: (url: string) => void;
  aoPedirSair: () => void;
}) {
  switch (estado.situacao) {
    case 'INDISPONIVEL':
      return (
        <>
          <p className="acesso-texto">
            O serviço de acesso seguro não respondeu. Ele sobe junto com o sistema e o atualizador o religa sozinho; o
            motivo aparece logo abaixo.
          </p>
          <div className="acesso-acoes">
            <LigarServico />
            <Botao variante="secundario" aoClicar={aoTentarDeNovo}>
              Tentar de novo
            </Botao>
          </div>
        </>
      );

    case 'INICIANDO':
      return (
        <>
          <Carregando />
          <p className="acesso-texto">Iniciando...</p>
        </>
      );

    case 'PRECISA_ENTRAR':
      return (
        <>
          <ol className="acesso-passos">
            <li>Clique em Entrar no Tailscale.</li>
            <li>Entre com a sua conta (a mesma do celular) e aprove o aparelho.</li>
            <li>Volte aqui: a tela atualiza sozinha.</li>
          </ol>
          <BlocoEntrar linkDeEntrada={estado.linkDeEntrada} ocupado={ocupado} aoEntrar={aoEntrar} />
        </>
      );

    case 'AGUARDANDO_APROVACAO':
      return (
        <p className="acesso-texto">
          A sua rede exige aprovar aparelhos novos. Aprove este aparelho no painel do Tailscale (Machines) e volte aqui.
        </p>
      );

    case 'PARADO':
      return (
        <>
          <p className="acesso-texto">O acesso seguro está parado.</p>
          <BlocoEntrar linkDeEntrada={estado.linkDeEntrada} ocupado={ocupado} aoEntrar={aoEntrar} />
        </>
      );

    case 'LIGADO': {
      const enderecoAtual = enderecoPronto(estado) ? estado.endereco : null;
      return (
        <>
          {enderecoAtual ? (
            <>
              <p className="acesso-endereco">{enderecoAtual}</p>
              <div className="acesso-acoes">
                <Botao variante="secundario" aoClicar={() => aoCopiar(enderecoAtual)}>
                  Copiar endereço
                </Botao>
                <Botao aoClicar={() => aoAbrir(enderecoAtual)}>Abrir</Botao>
                {copiado && (
                  <span className="acesso-copiado" role="status">
                    Copiado
                  </span>
                )}
              </div>
              <p className="acesso-texto">
                No celular, com o Tailscale ligado, abra este endereço. No iPhone: Compartilhar &gt; Adicionar à Tela de
                Início, e abra pelo ícone para receber notificações.
              </p>
            </>
          ) : (
            <Aviso tipo="info">
              Falta ligar os certificados na sua rede: no painel do Tailscale, em DNS, ative MagicDNS e HTTPS
              Certificates. Depois espere um minuto.{' '}
              <a className="acesso-link" href={LINK_DNS_TAILSCALE} target="_blank" rel="noopener noreferrer">
                {LINK_DNS_TAILSCALE}
              </a>
            </Aviso>
          )}
          {(estado.nomeDoAparelho || estado.conta) && (
            <p className="acesso-linha-discreta">
              {estado.nomeDoAparelho && <span>Aparelho: {estado.nomeDoAparelho}</span>}
              {estado.nomeDoAparelho && estado.conta && ' · '}
              {estado.conta && <span>Conta: {estado.conta}</span>}
            </p>
          )}
          <div className="acesso-acoes">
            <Botao variante="perigo" aoClicar={aoPedirSair}>
              Desligar deste Tailscale
            </Botao>
          </div>
        </>
      );
    }
  }
}

export function AcessoSeguro() {
  const [estado, setEstado] = useState<EstadoAcessoDTO | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [confirmarSair, setConfirmarSair] = useState(false);

  const buscar = useCallback(async () => {
    try {
      const dados = await api.get<EstadoAcessoDTO>('/acesso-seguro');
      setEstado(dados);
      setErro(null);
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }, []);

  // Carrega ao abrir a tela.
  useEffect(() => {
    void buscar();
  }, [buscar]);

  // Consulta de novo enquanto a situação pode mudar; só com a aba visível e com limpeza no unmount.
  const atualizar = estado !== null && precisaAtualizar(estado);
  useEffect(() => {
    if (!atualizar) return;
    const aoTiquear = () => {
      if (document.visibilityState === 'visible') void buscar();
    };
    const id = window.setInterval(aoTiquear, INTERVALO_ATUALIZACAO_MS);
    document.addEventListener('visibilitychange', aoTiquear);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', aoTiquear);
    };
  }, [atualizar, buscar]);

  // A confirmação "Copiado" some sozinha após 2 segundos.
  useEffect(() => {
    if (!copiado) return;
    const id = window.setTimeout(() => setCopiado(false), 2000);
    return () => window.clearTimeout(id);
  }, [copiado]);

  function abrir(url: string) {
    window.open(url, '_blank', 'noopener');
  }

  async function entrar() {
    setErro(null);
    if (estado?.linkDeEntrada) {
      abrir(estado.linkDeEntrada);
      return;
    }
    setOcupado(true);
    try {
      const dados = await api.post<EstadoAcessoDTO>('/acesso-seguro/entrar');
      setEstado(dados);
      if (dados.linkDeEntrada) abrir(dados.linkDeEntrada);
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  async function sair() {
    setErro(null);
    setOcupado(true);
    try {
      const dados = await api.post<EstadoAcessoDTO>('/acesso-seguro/sair');
      setEstado(dados);
      setConfirmarSair(false);
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  function copiarEndereco(endereco: string) {
    // Sem permissão ou sem suporte, falha em silêncio: o endereço continua visível para copiar à mão.
    if (!navigator.clipboard) return;
    navigator.clipboard
      .writeText(endereco)
      .then(() => setCopiado(true))
      .catch(() => undefined);
  }

  function pedirSair() {
    setErro(null);
    setConfirmarSair(true);
  }

  return (
    <Pagina titulo="Acesso seguro (HTTPS)">
      <p className="acesso-texto">
        Abre o sistema no celular com endereço https, de qualquer lugar, só para os aparelhos da sua rede Tailscale. É
        o que o iPhone exige para notificações e para instalar como aplicativo.
      </p>

      {erro && !confirmarSair && <Aviso tipo="erro">{erro}</Aviso>}

      {estado === null && erro === null && <Carregando />}
      {estado === null && erro !== null && (
        <div className="acesso-acoes">
          <Botao variante="secundario" aoClicar={() => void buscar()}>
            Tentar de novo
          </Botao>
        </div>
      )}

      {estado && (
        <>
          <Cartao>
            <div className="acesso-situacao">
              <Selo cor={SELO_SITUACAO[estado.situacao].cor}>{SELO_SITUACAO[estado.situacao].rotulo}</Selo>
            </div>
            <ConteudoSituacao
              estado={estado}
              ocupado={ocupado}
              copiado={copiado}
              aoEntrar={() => void entrar()}
              aoTentarDeNovo={() => void buscar()}
              aoCopiar={copiarEndereco}
              aoAbrir={abrir}
              aoPedirSair={pedirSair}
            />
          </Cartao>

          {estado.avisos.map((aviso, indice) => (
            <Aviso key={`${indice}-${aviso}`} tipo="info">
              {aviso}
            </Aviso>
          ))}
        </>
      )}

      <Modal aberto={confirmarSair} titulo="Desligar deste Tailscale?" aoFechar={() => setConfirmarSair(false)}>
        <p className="acesso-texto">O endereço seguro para de funcionar até você entrar de novo.</p>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <div className="acesso-acoes">
          <Botao variante="perigo" desabilitado={ocupado} aoClicar={() => void sair()}>
            Desligar
          </Botao>
          <Botao variante="secundario" aoClicar={() => setConfirmarSair(false)}>
            Cancelar
          </Botao>
        </div>
      </Modal>
    </Pagina>
  );
}
