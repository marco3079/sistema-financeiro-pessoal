import { useState } from 'react';
import { PluggyConnect } from 'pluggy-connect-sdk';
import { api } from '../../lib/api';
import { STATUS_CONEXAO, mensagemErro } from '../../lib/financas';
import type { ConexaoDTO } from '../../lib/financas';
import { useDados } from '../../lib/useDados';
import { Aviso, Botao, Cartao, Carregando, MenuAcoes, Modal, Pagina, Selo, formatarDataHora } from '../../ui';
import type { AcaoMenu } from '../../ui';
import { ResumoItem } from '../../ui/financas';
import { Icone } from '../../ui/icones';
import { Credenciais } from './Credenciais';
import { ConexoesDiretas } from './ConexaoDireta';

export interface EstadoOpenFinanceDTO {
  configurado: boolean;
  origemCredenciais: 'BANCO' | 'ENV' | null;
  credenciaisDoPerfil: boolean; // false = usando as credenciais antigas do sistema
  clientId: string | null;
  sandbox: boolean;
  conexoes: ConexaoDTO[];
}

interface TokenOpenFinanceDTO {
  accessToken: string;
  sandbox: boolean;
  itemId: string | null;
  meuPluggyId: number | null;
}

export function Conexoes() {
  const { dados, carregando, erro: erroCarga, recarregar } = useDados<EstadoOpenFinanceDTO>('/openfinance/estado');
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [sincronizando, setSincronizando] = useState(false);
  const [mostrarCredenciais, setMostrarCredenciais] = useState(false);

  // Roda uma sincronização de uma conexão e mostra o resultado.
  async function executarSincronizacao(requisicao: () => Promise<ConexaoDTO>) {
    setErro(null);
    setSucesso(null);
    setSincronizando(true);
    try {
      const atualizada = await requisicao();
      setSucesso(`Conexão com ${atualizada.instituicao} atualizada.`);
      recarregar();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setSincronizando(false);
    }
  }

  // Depois que o widget devolve o item: cria a conexão (conexao null) ou sincroniza a que foi reconectada.
  async function aoConectar(itemId: string, conexao: ConexaoDTO | null) {
    await executarSincronizacao(() =>
      conexao === null
        ? api.post<ConexaoDTO>('/openfinance/conexoes', { itemId })
        : api.post<ConexaoDTO>('/openfinance/conexoes/' + conexao.id + '/sincronizar'),
    );
  }

  // Abre o widget "Pluggy Connect" para conectar uma instituição nova (null) ou reconectar uma existente.
  // diretoNoMeuPluggy: pula a lista de bancos e abre já no MeuPluggy (o Open Finance pessoal da Pluggy).
  async function abrirWidget(conexao: ConexaoDTO | null, diretoNoMeuPluggy = false) {
    setErro(null);
    setSucesso(null);
    try {
      const { accessToken, sandbox, itemId, meuPluggyId } = await api.post<TokenOpenFinanceDTO>(
        '/openfinance/token',
        conexao ? { conexaoId: conexao.id } : {},
      );
      const widget = new PluggyConnect({
        connectToken: accessToken,
        includeSandbox: sandbox,
        ...(itemId ? { updateItem: itemId } : {}),
        ...(!itemId && diretoNoMeuPluggy && meuPluggyId ? { selectedConnectorId: meuPluggyId } : {}),
        onSuccess: ({ item }) => {
          void aoConectar(item.id, conexao);
        },
        onError: (erroWidget) => {
          const texto = erroWidget.message || '';
          setErro(
            /ITEM_USER_ALREADY_EXISTS/i.test(texto)
              ? 'A Pluggy diz que esta conta já está conectada. Para ligar outra conta da mesma instituição, feche esta janela, clique em Conectar instituição de novo e entre com o login da outra conta.'
              : texto || 'Não foi possível conectar à instituição.',
          );
        },
      });
      await widget.init();
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }

  async function sincronizarTudo() {
    setErro(null);
    setSucesso(null);
    setSincronizando(true);
    try {
      const lista = await api.post<ConexaoDTO[]>('/openfinance/sincronizar');
      setSucesso(`${lista.length} instituição(ões) atualizada(s).`);
      recarregar();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setSincronizando(false);
    }
  }

  async function removerConexao(conexao: ConexaoDTO, manterDados: boolean) {
    const pergunta = manterDados
      ? `Remover a conexão com ${conexao.instituicao}? As contas e lançamentos dela continuam como manuais.`
      : `Remover a conexão com ${conexao.instituicao} e apagar as contas, faturas e lançamentos que vieram dela?`;
    if (!window.confirm(pergunta)) return;
    setErro(null);
    setSucesso(null);
    try {
      await api.del('/openfinance/conexoes/' + conexao.id + (manterDados ? '?manterDados=true' : ''));
      setSucesso(`Conexão com ${conexao.instituicao} removida.`);
      recarregar();
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }

  // Ações do menu de três pontos de cada conexão.
  function acoesDaConexao(conexao: ConexaoDTO): AcaoMenu[] {
    return [
      {
        rotulo: 'Sincronizar agora',
        icone: 'sincronizar',
        aoClicar: () => {
          void executarSincronizacao(() =>
            api.post<ConexaoDTO>(`/openfinance/conexoes/${conexao.id}/sincronizar`),
          );
        },
      },
      {
        rotulo: 'Reconectar',
        icone: 'cadeado',
        aoClicar: () => {
          void abrirWidget(conexao);
        },
      },
      {
        rotulo: 'Remover e manter os dados',
        icone: 'fechar',
        aoClicar: () => {
          void removerConexao(conexao, true);
        },
      },
      {
        rotulo: 'Remover e apagar os dados',
        icone: 'lixeira',
        perigo: true,
        aoClicar: () => {
          void removerConexao(conexao, false);
        },
      },
    ];
  }

  const conexoes = dados?.conexoes ?? [];
  const totalContas = conexoes.reduce((soma, c) => soma + c.contas, 0);

  return (
    <Pagina
      titulo="Conexões"
      acoes={
        dados?.configurado ? (
          <>
            <Botao variante="secundario" desabilitado={sincronizando} aoClicar={() => void sincronizarTudo()}>
              Sincronizar tudo
            </Botao>
            <Botao variante="secundario" desabilitado={sincronizando} aoClicar={() => void abrirWidget(null)}>
              Outra instituição
            </Botao>
            <Botao desabilitado={sincronizando} aoClicar={() => void abrirWidget(null, true)}>
              Conectar meus bancos (MeuPluggy)
            </Botao>
          </>
        ) : undefined
      }
    >
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {erroCarga && <Aviso tipo="erro">{erroCarga}</Aviso>}
      {sucesso && <Aviso tipo="sucesso">{sucesso}</Aviso>}
      {sincronizando && (
        <Aviso tipo="info">Buscando contas, cartões e faturas... isso pode levar até um minuto.</Aviso>
      )}
      {carregando && <Carregando />}

      {dados && !dados.configurado && (
        <Cartao titulo="Ligue o Open Finance (uma vez só)">
          <ol className="conexoes-passos">
            <li>
              Entre em{' '}
              <a href="https://dashboard.pluggy.ai" target="_blank" rel="noreferrer">
                dashboard.pluggy.ai
              </a>{' '}
              (conta grátis), crie uma aplicação e copie o <strong>Client ID</strong> e o <strong>Client Secret</strong>.
            </li>
            <li>Cole os dois aqui embaixo e salve. O sistema confere na Pluggy antes de gravar.</li>
            <li>
              Depois é só clicar em <strong>Conectar meus bancos (MeuPluggy)</strong>: os bancos que você ligou em{' '}
              <a href="https://meu.pluggy.ai" target="_blank" rel="noreferrer">
                meu.pluggy.ai
              </a>{' '}
              chegam de uma vez, sem custo.
            </li>
          </ol>
          <Credenciais estado={dados} aoSalvo={recarregar} />
        </Cartao>
      )}

      {dados && dados.configurado && (
        <>
          <div className="resumo">
            <ResumoItem icone="conexoes" cor="azul" valor={conexoes.length} rotulo="Instituições conectadas" />
            <ResumoItem icone="contas" cor="verde" valor={totalContas} rotulo="Contas e cartões" />
          </div>

          {conexoes.length === 0 ? (
            <Cartao titulo="Conecte seus bancos em 2 passos">
              <ol className="conexoes-passos">
                <li>
                  <strong>No MeuPluggy, ligue seus bancos.</strong> Entre em{' '}
                  <a href="https://meu.pluggy.ai" target="_blank" rel="noreferrer">
                    meu.pluggy.ai
                  </a>{' '}
                  (grátis para uso pessoal) e conecte cada banco pela opção Open Finance. A autorização é feita no app
                  do próprio banco: ninguém vê a sua senha.
                </li>
                <li>
                  <strong>Aqui, traga tudo de uma vez.</strong> Clique no botão abaixo e entre com o login do MeuPluggy.
                  Contas e cartões chegam sozinhos e atualizam a cada 6 horas. Investimentos ficam de fora: lance a carteira pela planilha da B3.
                </li>
              </ol>
              <div className="pagina-acoes">
                <Botao desabilitado={sincronizando} aoClicar={() => void abrirWidget(null, true)}>
                  Conectar meus bancos (MeuPluggy)
                </Botao>
              </div>
            </Cartao>
          ) : (
            <div className="fin-cartoes">
              {conexoes.map((c) => (
                <article key={c.id} className="cartao conexoes-item">
                  <div className="conexoes-item-cabecalho">
                    {c.instituicaoLogo ? (
                      <img src={c.instituicaoLogo} className="conexoes-logo" alt="" />
                    ) : (
                      <span
                        className="conexoes-logo"
                        style={{ background: c.instituicaoCor ?? 'var(--cor-primaria)' }}
                        aria-hidden="true"
                      >
                        <Icone nome="contas" tamanho={22} />
                      </span>
                    )}
                    <strong className="conexoes-item-nome">{c.instituicao}</strong>
                    <Selo cor={STATUS_CONEXAO[c.status].cor}>{STATUS_CONEXAO[c.status].rotulo}</Selo>
                    <MenuAcoes rotulo={'Ações de ' + c.instituicao} acoes={acoesDaConexao(c)} />
                  </div>
                  <span className="fin-suave conexoes-item-linha">
                    {c.contas} contas e cartões
                  </span>
                  <span className="fin-suave conexoes-item-linha">
                    {c.ultimaSincronizacao
                      ? `Atualizada em ${formatarDataHora(c.ultimaSincronizacao)}`
                      : 'Ainda não sincronizada'}
                  </span>
                  {c.erro && <Aviso tipo="erro">{c.erro}</Aviso>}
                </article>
              ))}
            </div>
          )}

          <Cartao>
            <div className="fin-cabecalho">
              <div>
                <strong>Credenciais da Pluggy deste perfil</strong>
                <p className="fin-suave">
                  Client ID: {dados.clientId}
                  {dados.origemCredenciais === 'ENV' && ' (definidas no arquivo .env)'}
                  {dados.sandbox && ' · bancos de teste ligados'}
                </p>
                <p className="fin-suave">
                  {dados.credenciaisDoPerfil
                    ? 'Valem só para este perfil financeiro. Cada perfil guarda as próprias.'
                    : 'Este perfil está usando as credenciais antigas do sistema. Salve as dele para separar dos outros perfis.'}
                </p>
              </div>
              <Botao variante="secundario" aoClicar={() => setMostrarCredenciais(true)}>
                Alterar credenciais
              </Botao>
            </div>
          </Cartao>
        </>
      )}

      {dados && <ConexoesDiretas />}

      <Modal aberto={mostrarCredenciais} titulo="Credenciais da Pluggy" aoFechar={() => setMostrarCredenciais(false)}>
        {dados && (
          <Credenciais
            estado={dados}
            aoSalvo={() => {
              setMostrarCredenciais(false);
              recarregar();
            }}
          />
        )}
      </Modal>
    </Pagina>
  );
}
