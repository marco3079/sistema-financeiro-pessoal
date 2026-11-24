import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../../lib/api';
import { mensagemErro } from '../../lib/financas';
import { Aviso, Botao, Cartao, Carregando, Modal, Pagina, Selo, formatarDataHora } from '../../ui';
import { ResumoItem, Vazio } from '../../ui/financas';
import './servidor.css';

type EstadoConteiner = 'NO_AR' | 'INICIANDO' | 'COM_PROBLEMA' | 'REINICIANDO' | 'PARADO' | 'NAO_CRIADO';

interface ConteinerDTO {
  servico: string;
  nome: string;
  descricao: string;
  estado: EstadoConteiner;
  detalhe: string | null;
  desde: string | null;
  cpu: string | null;
  memoria: string | null;
  essencial: boolean;
}

interface ReinicioDTO {
  situacao: 'REINICIANDO' | 'OK' | 'ERRO';
  servico: string | null;
  mensagem: string | null;
  em: string | null;
}

interface StatusServidorDTO {
  atualizadoEm: string | null;
  defasado: boolean;
  podeReiniciar: boolean;
  reinicio: ReinicioDTO | null;
  resumo: { total: number; noAr: number; comProblema: number };
  conteineres: ConteinerDTO[];
  servidor: {
    noArDesde: string;
    versao: string | null;
    node: string;
    memoriaMb: number;
    bancoOk: boolean;
    bancoMs: number | null;
  };
}

interface PedidoReinicio {
  servico: string; // nome técnico ou 'TODOS'
  nome: string; // nome amigável para o texto
  ligar: boolean;
}

const INTERVALO_MS = 10000;
const INTERVALO_REINICIO_MS = 3000;
const SERVICOS_QUE_DERRUBAM_SISTEMA = ['web', 'api', 'db'];
const TODOS = 'TODOS';
const ATUALIZADOR = 'atualizador';

// Tempo decorrido desde uma data ISO: "menos de 1 min", "42 min", "3 h 12 min", "2 dias".
function tempoDecorrido(iso: string): string {
  const inicio = new Date(iso).getTime();
  if (Number.isNaN(inicio)) return '—';
  const minutos = Math.max(0, Math.floor((Date.now() - inicio) / 60000));
  if (minutos < 1) return '< 1 min';
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) {
    const resto = minutos % 60;
    return resto > 0 ? `${horas} h ${resto} min` : `${horas} h`;
  }
  const dias = Math.floor(horas / 24);
  return dias === 1 ? '1 dia' : `${dias} dias`;
}

// Verdadeiro se a data ISO aconteceu nos últimos `minutos`.
function haMenosDe(iso: string | null, minutos: number): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t <= minutos * 60000;
}

function horaDaMedicao(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function infoEstado(c: ConteinerDTO): { rotulo: string; cor: 'verde' | 'azul' | 'amarelo' | 'vermelho' | 'cinza' } {
  switch (c.estado) {
    case 'NO_AR':
      return { rotulo: 'No ar', cor: 'verde' };
    case 'INICIANDO':
      return { rotulo: 'Iniciando', cor: 'azul' };
    case 'REINICIANDO':
      return { rotulo: 'Reiniciando', cor: 'amarelo' };
    case 'COM_PROBLEMA':
      return { rotulo: 'Com problema', cor: 'vermelho' };
    case 'PARADO':
      return { rotulo: 'Parado', cor: c.essencial ? 'vermelho' : 'cinza' };
    case 'NAO_CRIADO':
      return { rotulo: 'Não criado', cor: 'cinza' };
  }
}

// Com problema primeiro (0), depois os essenciais (1), depois os demais (2). A ordem recebida se mantém dentro de cada grupo.
function grupoDoConteiner(c: ConteinerDTO): number {
  if (c.estado === 'COM_PROBLEMA' || (c.estado === 'PARADO' && c.essencial)) return 0;
  if (c.essencial) return 1;
  return 2;
}

// Nome amigável de um serviço (ou de todos), usado nos avisos de reinício.
function nomeDoAlvo(servico: string | null, conteineres: ConteinerDTO[]): string {
  if (!servico || servico === TODOS) return 'todos os contêineres';
  const achado = conteineres.find((c) => c.servico === servico);
  return achado ? achado.nome : servico;
}

function ConteinerItem({
  conteiner,
  podeAgir,
  aoPedirReinicio,
}: {
  conteiner: ConteinerDTO;
  podeAgir: boolean;
  aoPedirReinicio: (c: ConteinerDTO) => void;
}) {
  const info = infoEstado(conteiner);
  const ligar = conteiner.estado === 'PARADO' || conteiner.estado === 'NAO_CRIADO';
  return (
    <li className="servidor-item">
      <div className="servidor-item-cabecalho">
        <div className="servidor-item-titulo">
          <strong>{conteiner.nome}</strong>
          <span className="servidor-servico">{conteiner.servico}</span>
        </div>
        <Selo cor={info.cor}>{info.rotulo}</Selo>
      </div>
      <p className="servidor-descricao">{conteiner.descricao}</p>
      {conteiner.detalhe && <p className="servidor-detalhe">{conteiner.detalhe}</p>}
      <div className="servidor-metricas">
        {conteiner.cpu !== null && (
          <span>
            CPU <strong>{conteiner.cpu}</strong>
          </span>
        )}
        {conteiner.memoria !== null && (
          <span>
            Memória <strong>{conteiner.memoria}</strong>
          </span>
        )}
        {conteiner.desde !== null && <span>criado há {tempoDecorrido(conteiner.desde)}</span>}
      </div>
      <div className="servidor-acao">
        {conteiner.servico === ATUALIZADOR ? (
          <span className="servidor-discreto">reinicia os demais</span>
        ) : (
          <Botao variante="secundario" desabilitado={!podeAgir} aoClicar={() => aoPedirReinicio(conteiner)}>
            {ligar ? 'Ligar' : 'Reiniciar'}
          </Botao>
        )}
      </div>
    </li>
  );
}

export function StatusServidor() {
  const [status, setStatus] = useState<StatusServidorDTO | null>(null);
  const [carregandoPrimeira, setCarregandoPrimeira] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [falhaRede, setFalhaRede] = useState(false);
  const [pedido, setPedido] = useState<PedidoReinicio | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const emVoo = useRef(false);
  const montado = useRef(false);

  const emReinicio = status?.reinicio?.situacao === 'REINICIANDO';
  const reiniciandoRef = useRef(false);
  reiniciandoRef.current = emReinicio;
  const intervalo = emReinicio ? INTERVALO_REINICIO_MS : INTERVALO_MS;

  const carregar = useCallback(() => {
    if (emVoo.current) return;
    emVoo.current = true;
    api
      .get<StatusServidorDTO>('/servidor/status')
      .then((r) => {
        if (!montado.current) return;
        setStatus(r);
        setErro(null);
        setFalhaRede(false);
      })
      .catch((e: unknown) => {
        if (!montado.current) return;
        // Durante um reinício a API pode cair de propósito: não troca a tela por erro.
        if (reiniciandoRef.current) setFalhaRede(true);
        else setErro(mensagemErro(e));
      })
      .finally(() => {
        emVoo.current = false;
        if (montado.current) setCarregandoPrimeira(false);
      });
  }, []);

  // Carga inicial e recarga (10 s; 3 s durante um reinício), só com a aba visível. O intervalo é limpo ao sair da tela.
  useEffect(() => {
    montado.current = true;
    carregar();
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') carregar();
    }, intervalo);
    return () => {
      montado.current = false;
      window.clearInterval(t);
    };
  }, [carregar, intervalo]);

  function confirmarPedido() {
    if (!pedido || enviando) return;
    setEnviando(true);
    setErroAcao(null);
    api
      .post<{ aceito: boolean }>('/servidor/reiniciar', { servico: pedido.servico })
      .then(() => {
        if (!montado.current) return;
        setPedido(null);
        carregar();
      })
      .catch((e: unknown) => {
        if (!montado.current) return;
        setPedido(null);
        setErroAcao(mensagemErro(e));
      })
      .finally(() => {
        if (montado.current) setEnviando(false);
      });
  }

  const acoes = (
    <div className="servidor-acoes">
      <Botao variante="secundario" aoClicar={carregar}>Atualizar agora</Botao>
      {status && status.conteineres.length > 0 && (
        <Botao
          variante="perigo"
          desabilitado={!status.podeReiniciar || emReinicio}
          aoClicar={() => setPedido({ servico: TODOS, nome: 'todos os contêineres', ligar: false })}
        >
          Reiniciar tudo
        </Botao>
      )}
    </div>
  );

  const podeAgir = status !== null && status.podeReiniciar && !emReinicio;

  const modal = (
    <Modal
      aberto={pedido !== null}
      titulo={pedido ? (pedido.ligar ? `Ligar ${pedido.nome}?` : `Reiniciar ${pedido.nome}?`) : 'Confirmar'}
      aoFechar={() => {
        if (!enviando) setPedido(null);
      }}
    >
      {pedido && (
        <div className="servidor-confirmacao">
          <p>
            {SERVICOS_QUE_DERRUBAM_SISTEMA.includes(pedido.servico) || pedido.servico === TODOS
              ? 'O sistema fica fora do ar por alguns segundos e esta tela pode mostrar erro até ele voltar.'
              : 'Só este serviço para por alguns segundos.'}
          </p>
          <div className="servidor-confirmacao-botoes">
            <Botao variante="secundario" desabilitado={enviando} aoClicar={() => setPedido(null)}>
              Cancelar
            </Botao>
            <Botao variante="perigo" desabilitado={enviando} aoClicar={confirmarPedido}>
              {enviando ? 'Enviando...' : pedido.ligar ? 'Ligar' : 'Reiniciar'}
            </Botao>
          </div>
        </div>
      )}
    </Modal>
  );

  if (carregandoPrimeira && status === null && erro === null) {
    return (
      <Pagina titulo="Status do servidor" acoes={acoes}>
        <Carregando />
      </Pagina>
    );
  }

  if (status === null) {
    return (
      <Pagina titulo="Status do servidor" acoes={acoes}>
        <Aviso tipo="erro">{erro ?? 'Erro inesperado'}</Aviso>
        <div>
          <Botao variante="secundario" aoClicar={carregar}>Tentar de novo</Botao>
        </div>
      </Pagina>
    );
  }

  const conteineres = [...status.conteineres].sort((a, b) => grupoDoConteiner(a) - grupoDoConteiner(b));
  const { servidor, resumo, reinicio } = status;

  // Aviso do último reinício: em andamento sempre; concluído nos 2 min seguintes; erro nos 10 min seguintes.
  let avisoReinicio: ReactNode = null;
  if (reinicio && reinicio.situacao === 'REINICIANDO') {
    avisoReinicio = (
      <Aviso tipo="info">
        {reinicio.mensagem ?? 'Reinício em andamento.'} ({nomeDoAlvo(reinicio.servico, status.conteineres)})
      </Aviso>
    );
  } else if (reinicio && reinicio.situacao === 'OK' && haMenosDe(reinicio.em, 2)) {
    avisoReinicio = (
      <Aviso tipo="sucesso">
        {reinicio.mensagem ?? 'Reinício concluído.'} ({nomeDoAlvo(reinicio.servico, status.conteineres)})
      </Aviso>
    );
  } else if (reinicio && reinicio.situacao === 'ERRO' && haMenosDe(reinicio.em, 10)) {
    avisoReinicio = <Aviso tipo="erro">{reinicio.mensagem ?? 'O reinício falhou.'}</Aviso>;
  }

  return (
    <Pagina titulo="Status do servidor" acoes={acoes}>
      {modal}

      {avisoReinicio}
      {erroAcao && <Aviso tipo="erro">{erroAcao}</Aviso>}
      {!status.podeReiniciar && (
        <p className="servidor-dica">O atualizador não está respondendo, por isso os reinícios estão desativados.</p>
      )}
      {falhaRede && <p className="servidor-aguarde">O servidor está reiniciando, aguarde...</p>}

      {erro && (
        <Aviso tipo="erro">
          {erro}
          <div>
            <Botao variante="secundario" aoClicar={carregar}>Tentar de novo</Botao>
          </div>
        </Aviso>
      )}

      <div className="resumo servidor-resumo">
        <ResumoItem icone="visto" cor="verde" valor={`${resumo.noAr} de ${resumo.total}`} rotulo="No ar" />
        <ResumoItem
          icone="sino"
          cor={resumo.comProblema > 0 ? 'vermelho' : 'verde'}
          valor={resumo.comProblema}
          rotulo="Com problema"
        />
        <ResumoItem
          icone="conexoes"
          cor={servidor.bancoOk ? 'verde' : 'vermelho'}
          valor={servidor.bancoOk ? `${servidor.bancoMs ?? '—'} ms` : 'Sem resposta'}
          rotulo={servidor.bancoOk ? 'Banco de dados respondeu em' : 'Banco de dados'}
        />
        <ResumoItem icone="relogio" cor="azul" valor={tempoDecorrido(servidor.noArDesde)} rotulo="Servidor no ar há" />
      </div>

      {status.defasado && (
        <Aviso tipo="erro">
          O atualizador não está respondendo, então a situação dos contêineres abaixo pode estar desatualizada
          {status.atualizadoEm ? ` (última medição: ${formatarDataHora(status.atualizadoEm)})` : ''}
        </Aviso>
      )}

      {conteineres.length > 0 ? (
        <Cartao titulo="Contêineres">
          <ul className="servidor-lista">
            {conteineres.map((c) => (
              <ConteinerItem
                key={c.servico}
                conteiner={c}
                podeAgir={podeAgir}
                aoPedirReinicio={(alvo) =>
                  setPedido({
                    servico: alvo.servico,
                    nome: alvo.nome,
                    ligar: alvo.estado === 'PARADO' || alvo.estado === 'NAO_CRIADO',
                  })
                }
              />
            ))}
          </ul>
        </Cartao>
      ) : (
        !status.defasado && (
          <Cartao>
            <Vazio icone="grafico" titulo="Nenhum contêiner encontrado" texto="O atualizador ainda não mediu os contêineres." />
          </Cartao>
        )
      )}

      <p className="servidor-rodape">
        Versão {servidor.versao ?? '—'} · Node {servidor.node} · memória do servidor {servidor.memoriaMb} MB · medido em{' '}
        {status.atualizadoEm ? horaDaMedicao(status.atualizadoEm) : 'sem medição'}
      </p>
    </Pagina>
  );
}
