import { useState } from 'react';
import { PluggyConnect } from 'pluggy-connect-sdk';
import { api } from '../../lib/api';
import { STATUS_CONEXAO, mensagemErro } from '../../lib/financas';
import type { ConexaoDTO } from '../../lib/financas';
import { useDados } from '../../lib/useDados';
import { Aviso, Botao, Cartao, Carregando, MenuAcoes, Modal, Pagina, Selo, formatarDataHora } from '../../ui';
import type { AcaoMenu } from '../../ui';
import { ResumoItem, Vazio } from '../../ui/financas';
import { Icone } from '../../ui/icones';
import { Credenciais } from './Credenciais';

export interface EstadoOpenFinanceDTO {
  configurado: boolean;
  origemCredenciais: 'BANCO' | 'ENV' | null;
  clientId: string | null;
  sandbox: boolean;
  conexoes: ConexaoDTO[];
}

interface TokenOpenFinanceDTO {
  accessToken: string;
  sandbox: boolean;
  itemId: string | null;
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
  async function abrirWidget(conexao: ConexaoDTO | null) {
    setErro(null);
    setSucesso(null);
    try {
      const { accessToken, sandbox, itemId } = await api.post<TokenOpenFinanceDTO>(
        '/openfinance/token',
        conexao ? { conexaoId: conexao.id } : {},
      );
      const widget = new PluggyConnect({
        connectToken: accessToken,
        includeSandbox: sandbox,
        ...(itemId ? { updateItem: itemId } : {}),
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
      : `Remover a conexão com ${conexao.instituicao} e apagar as contas, faturas, lançamentos e investimentos que vieram dela?`;
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
  const totalInvestimentos = conexoes.reduce((soma, c) => soma + c.investimentos, 0);

  return (
    <Pagina
      titulo="Conexões"
      acoes={
        dados?.configurado ? (
          <>
            <Botao variante="secundario" desabilitado={sincronizando} aoClicar={() => void sincronizarTudo()}>
              Sincronizar tudo
            </Botao>
            <Botao desabilitado={sincronizando} aoClicar={() => void abrirWidget(null)}>
              Conectar instituição
            </Botao>
          </>
        ) : undefined
      }
    >
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {erroCarga && <Aviso tipo="erro">{erroCarga}</Aviso>}
      {sucesso && <Aviso tipo="sucesso">{sucesso}</Aviso>}
      {sincronizando && (
        <Aviso tipo="info">Buscando contas, faturas e investimentos... isso pode levar até um minuto.</Aviso>
      )}
      {carregando && <Carregando />}

      {dados && !dados.configurado && (
        <>
          <Vazio
            icone="conexoes"
            titulo="Conecte seus bancos pelo Open Finance"
            texto="Traga saldos, faturas do cartão e investimentos automaticamente. Primeiro informe as credenciais da Pluggy."
          >
            <Botao aoClicar={() => setMostrarCredenciais(true)}>Configurar credenciais</Botao>
          </Vazio>
          <Cartao titulo="Como obter as credenciais">
            <ol>
              <li>
                Crie uma conta gratuita em{' '}
                <a href="https://dashboard.pluggy.ai" target="_blank" rel="noreferrer">
                  dashboard.pluggy.ai
                </a>
                .
              </li>
              <li>Crie uma aplicação e copie o Client ID e o Client Secret.</li>
              <li>
                Para ler os seus próprios bancos sem custo, ative o conector "MeuPluggy" (
                <a href="https://meu.pluggy.ai" target="_blank" rel="noreferrer">
                  meu.pluggy.ai
                </a>
                ) na aplicação.
              </li>
              <li>Cole as credenciais aqui e clique em Conectar instituição.</li>
            </ol>
            <p className="fin-suave">
              Para testar sem banco real, marque 'Mostrar bancos de teste' e use o Pluggy Bank com usuário user-ok e
              senha password-ok.
            </p>
          </Cartao>
        </>
      )}

      {dados && dados.configurado && (
        <>
          <div className="resumo">
            <ResumoItem icone="conexoes" cor="azul" valor={conexoes.length} rotulo="Instituições conectadas" />
            <ResumoItem icone="contas" cor="verde" valor={totalContas} rotulo="Contas e cartões" />
            <ResumoItem icone="investimentos" cor="roxo" valor={totalInvestimentos} rotulo="Investimentos" />
          </div>

          {conexoes.length === 0 ? (
            <Vazio
              icone="conexoes"
              titulo="Nenhuma instituição conectada"
              texto="Clique em Conectar instituição e escolha seu banco, cartão ou corretora."
            />
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
                    {c.contas} contas e cartões · {c.investimentos} investimentos
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
                <strong>Credenciais da Pluggy</strong>
                <p className="fin-suave">
                  Client ID: {dados.clientId}
                  {dados.origemCredenciais === 'ENV' && ' (definidas no arquivo .env)'}
                  {dados.sandbox && ' · bancos de teste ligados'}
                </p>
              </div>
              <Botao variante="secundario" aoClicar={() => setMostrarCredenciais(true)}>
                Alterar credenciais
              </Botao>
            </div>
          </Cartao>
        </>
      )}

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
