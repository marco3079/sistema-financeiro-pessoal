import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { formatarDia, mensagemErro } from '../../lib/financas';
import { Aviso, Botao, Carregando, Modal } from '../../ui';
import { PreviaB3 } from '../importar/PreviaB3';
import { lerArquivo } from '../importar/lerArquivo';
import type { Planilha } from '../importar/tipos';

// Popup "Atualizar pela B3": o botão cria a tarefa com o período escolhido e abre o link financas-b3://, que
// liga o script ferramentas/b3 neste computador. O script abre uma janela limpa do Chrome na Área do Investidor,
// a pessoa entra na conta dela, e o script exporta a movimentação do período e manda o XLSX para a API.
// O popup acompanha o andamento e, quando o arquivo chega, mostra a mesma prévia da Importação (PreviaB3).
// A senha da B3 nunca passa pelo sistema.

type Etapa =
  | 'NENHUMA'
  | 'AGUARDANDO_SCRIPT'
  | 'ABRINDO'
  | 'LOGIN'
  | 'BAIXANDO'
  | 'AGUARDANDO_VOCE'
  | 'PRONTA'
  | 'IMPORTADA'
  | 'ERRO'
  | 'CANCELADA';

interface EstadoB3 {
  id?: string;
  etapa: Etapa;
  mensagem?: string;
  log?: string[];
  de?: string;
  ate?: string;
  arquivo?: { nome: string; tamanho: number } | null;
  link?: string;
}

const EM_ANDAMENTO: Etapa[] = ['AGUARDANDO_SCRIPT', 'ABRINDO', 'LOGIN', 'BAIXANDO', 'AGUARDANDO_VOCE'];
const INTERVALO_MS = 2000;
const DICA_REGISTRO_MS = 15000;
const PRIMEIRO_DIA_B3 = '2019-11-01';
const COMANDO_REGISTRO = 'powershell -ExecutionPolicy Bypass -File ferramentas\\b3\\registrar-b3.ps1';

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Período da tela Proventos: os N meses do gráfico (do 1º dia do mês mais antigo) até ontem, que é o último dia
// que a B3 já fechou. "Desde o início" = desde novembro de 2019, o começo do histórico da Área do Investidor.
export function periodoDosMeses(meses: string): { de: string; ate: string } {
  const hoje = new Date();
  const ontem = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 1);
  const n = Number(meses);
  const de = !Number.isFinite(n) || n <= 0 ? PRIMEIRO_DIA_B3 : iso(new Date(hoje.getFullYear(), hoje.getMonth() - (n - 1), 1));
  const ate = iso(ontem);
  return { de: de < PRIMEIRO_DIA_B3 ? PRIMEIRO_DIA_B3 : de > ate ? ate : de, ate };
}

function base64ParaArquivo(nome: string, conteudo: string): File {
  const binario = atob(conteudo);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return new File([bytes], nome, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function AtualizarB3({
  aberto,
  meses,
  aoFechar,
  aoConcluir,
}: {
  aberto: boolean;
  meses: string;
  aoFechar: () => void;
  aoConcluir: () => void;
}) {
  const [estado, setEstado] = useState<EstadoB3 | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [mostrarDica, setMostrarDica] = useState(false);
  const [planilha, setPlanilha] = useState<{ nome: string; planilhas: Planilha[] } | null>(null);
  const [lendo, setLendo] = useState(false);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const idLido = useRef<string | null>(null);

  const periodo = periodoDosMeses(meses);
  const andando = estado !== null && EM_ANDAMENTO.includes(estado.etapa);

  // Ao abrir: retoma uma atualização em andamento (ou com a planilha esperando a prévia).
  useEffect(() => {
    if (!aberto) return;
    setErro(null);
    setSucesso(null);
    api
      .get<EstadoB3>('/b3/automacao')
      .then((e) => setEstado(EM_ANDAMENTO.includes(e.etapa) || e.etapa === 'PRONTA' ? e : null))
      .catch(() => undefined);
  }, [aberto]);

  // Acompanha a tarefa enquanto o script anda.
  useEffect(() => {
    if (!aberto || !andando) return;
    const relogio = window.setInterval(() => {
      api
        .get<EstadoB3>('/b3/automacao')
        .then(setEstado)
        .catch((e: unknown) => setErro(mensagemErro(e)));
    }, INTERVALO_MS);
    return () => window.clearInterval(relogio);
  }, [aberto, andando]);

  // O link não abriu nada em alguns segundos: mostra como registrar o link no Windows.
  useEffect(() => {
    setMostrarDica(false);
    if (estado?.etapa !== 'AGUARDANDO_SCRIPT') return;
    const relogio = window.setTimeout(() => setMostrarDica(true), DICA_REGISTRO_MS);
    return () => window.clearTimeout(relogio);
  }, [estado?.etapa, estado?.id]);

  // A planilha chegou: lê com o mesmo leitor da Importação.
  useEffect(() => {
    if (!aberto || estado?.etapa !== 'PRONTA' || !estado.id || idLido.current === estado.id) return;
    idLido.current = estado.id;
    setLendo(true);
    api
      .get<{ nome: string; conteudo: string }>('/b3/automacao/arquivo')
      .then(async (a) => {
        const lido = await lerArquivo(base64ParaArquivo(a.nome, a.conteudo));
        if (lido.tipo !== 'planilha') throw new Error('O arquivo baixado não parece a planilha de movimentação da B3.');
        setPlanilha({ nome: lido.nome, planilhas: lido.planilhas });
      })
      .catch((e: unknown) => {
        idLido.current = null;
        setErro(mensagemErro(e));
      })
      .finally(() => setLendo(false));
  }, [aberto, estado?.etapa, estado?.id]);

  function abrirLink(endereco: string) {
    // Link de protocolo: o navegador pergunta se pode abrir o PowerShell e a página continua aqui.
    window.location.href = endereco;
  }

  async function comecar() {
    setErro(null);
    setSucesso(null);
    setPlanilha(null);
    idLido.current = null;
    setEnviando(true);
    try {
      const e = await api.post<EstadoB3>('/b3/automacao', periodo);
      setEstado(e);
      if (e.link) {
        setLink(e.link);
        abrirLink(e.link);
      }
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setEnviando(false);
    }
  }

  async function cancelar() {
    try {
      setEstado(await api.post<EstadoB3>('/b3/automacao/cancelar', {}));
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }

  async function encerrar(importada: boolean, mensagem: string | null) {
    setPlanilha(null);
    if (mensagem) setSucesso(mensagem);
    setEstado(null);
    setLink(null);
    await api.post<EstadoB3>('/b3/automacao/concluir', { importada }).catch(() => undefined);
    if (importada) aoConcluir();
  }

  function fechar() {
    if (!andando && estado?.etapa !== 'PRONTA') {
      setEstado(null);
      setLink(null);
    }
    aoFechar();
  }

  const mostrarInicio = !sucesso && (estado === null || estado.etapa === 'NENHUMA');
  const comPrevia = planilha !== null && estado?.etapa === 'PRONTA';

  return (
    <Modal aberto={aberto} titulo="Atualizar pela B3" aoFechar={fechar} largo={comPrevia}>
      <div className="b3auto-popup">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {sucesso && <Aviso tipo="sucesso">{sucesso}</Aviso>}

        {mostrarInicio && (
          <>
            <p className="fin-suave">
              Abre uma janela do Chrome na Área do Investidor da B3. Entre com a <strong>sua</strong> conta nela (CPF,
              senha e o que a B3 pedir). A senha fica só na janela da B3: o sistema não a vê nem a guarda, e o login não
              fica salvo.
            </p>
            <p>
              Depois do login, a automação abre <strong>Extratos &gt; Movimentação</strong>, filtra de{' '}
              <strong>{formatarDia(periodo.de)}</strong> a <strong>{formatarDia(periodo.ate)}</strong> (o período escolhido
              na tela), exporta em Excel e traz o arquivo para a prévia da importação. O que já foi importado não se
              repete.
            </p>
            <div className="pagina-acoes">
              <Botao variante="texto" aoClicar={fechar}>
                Cancelar
              </Botao>
              <Botao aoClicar={comecar} desabilitado={enviando}>
                {enviando ? 'Abrindo...' : 'Abrir o Chrome da B3'}
              </Botao>
            </div>
          </>
        )}

        {estado && !mostrarInicio && !comPrevia && (
          <>
            {andando && (
              <div className="b3auto-andamento">
                <Carregando />
                <strong>{estado.mensagem || 'Atualizando...'}</strong>
                {estado.de && estado.ate && (
                  <span className="fin-suave">
                    Período: {formatarDia(estado.de)} a {formatarDia(estado.ate)}
                  </span>
                )}
              </div>
            )}

            {estado.etapa === 'AGUARDANDO_VOCE' && (
              <Aviso tipo="info">Termine na janela do Chrome: assim que a planilha baixar, ela aparece aqui.</Aviso>
            )}

            {estado.etapa === 'AGUARDANDO_SCRIPT' && mostrarDica && (
              <Aviso tipo="info">
                <span>
                  O Chrome não abriu? O instalador (instalar.ps1) registra o link no Windows. Se este computador ainda
                  não rodou o instalador desta versão, rode na pasta do sistema, no PowerShell:
                </span>
                <code className="b3auto-codigo">{COMANDO_REGISTRO}</code>
                <span>
                  Depois clique em <strong>Abrir de novo</strong>. Se o navegador perguntar se pode abrir o PowerShell,
                  confirme.
                </span>
              </Aviso>
            )}

            {(estado.etapa === 'PRONTA' || lendo) && !comPrevia && <Carregando />}
            {(estado.etapa === 'ERRO' || estado.etapa === 'CANCELADA') && <Aviso tipo="erro">{estado.mensagem}</Aviso>}

            {estado.log && estado.log.length > 0 && (
              <ul className="b3auto-log">
                {estado.log.map((linha, i) => (
                  <li key={i}>{linha}</li>
                ))}
              </ul>
            )}

            <div className="pagina-acoes">
              {estado.etapa === 'AGUARDANDO_SCRIPT' && link && (
                <Botao variante="secundario" aoClicar={() => abrirLink(link)}>
                  Abrir de novo
                </Botao>
              )}
              {andando && (
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

        {sucesso && estado === null && (
          <div className="pagina-acoes">
            <Botao aoClicar={fechar}>Fechar</Botao>
          </div>
        )}

        {comPrevia && planilha && (
          <PreviaB3
            nome={planilha.nome}
            planilhas={planilha.planilhas}
            aoConcluir={(mensagem) => encerrar(true, mensagem)}
            aoDescartar={() => encerrar(false, null)}
          />
        )}
      </div>
    </Modal>
  );
}
