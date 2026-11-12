import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import {
  TIPOS_TRANSACAO,
  formatarDia,
  formatarReais,
  mesAtual,
  mensagemErro,
  queryString,
} from '../../lib/financas';
import type { CategoriaDTO, ContaDTO, TransacaoDTO } from '../../lib/financas';
import { Aviso, Botao, Campo, Carregando, MenuAcoes, Modal, Pagina, Selecao, Selo, Tabela } from '../../ui';
import type { AcaoMenu } from '../../ui';
import { NomeComCor, ResumoItem, SeletorMes, SeloOrigem, Valor } from '../../ui/financas';
import { FormLancamento } from './FormLancamento';
import './transacoes.css';

const POR_PAGINA = 50;

interface RespostaTransacoes {
  itens: TransacaoDTO[];
  total: number;
  receitas: number;
  despesas: number;
}

export function Lancamentos() {
  // A conta vem da URL (?conta=<id>) só na primeira montagem.
  const [params] = useSearchParams();
  const [mes, setMes] = useState(mesAtual());
  const [contaId, setContaId] = useState(() => params.get('conta') ?? '');
  const [categoriaId, setCategoriaId] = useState('');
  const [tipo, setTipo] = useState('');
  const [busca, setBusca] = useState('');
  const [pagina, setPagina] = useState(1);
  const [novo, setNovo] = useState(false);
  const [editando, setEditando] = useState<TransacaoDTO | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  const { dados, carregando, erro, recarregar } = useDados<RespostaTransacoes>(
    '/transacoes' +
      queryString({
        mes,
        contaId,
        categoriaId,
        tipo,
        busca: busca.trim(),
        pagina,
        porPagina: POR_PAGINA,
      })
  );
  const { dados: contas } = useDados<ContaDTO[]>('/contas?inativas=true');
  const { dados: categorias } = useDados<CategoriaDTO[]>('/categorias');

  // Mudar qualquer filtro volta para a primeira página.
  function filtrar(atualizar: (valor: string) => void) {
    return (valor: string) => {
      atualizar(valor);
      setPagina(1);
    };
  }

  function fecharModal() {
    setNovo(false);
    setEditando(null);
  }

  async function excluir(t: TransacaoDTO) {
    if (!window.confirm(`Excluir o lançamento "${t.descricao}"?`)) return;
    setErroAcao(null);
    try {
      await api.del(`/transacoes/${t.id}`);
      recarregar();
    } catch (e) {
      setErroAcao(mensagemErro(e));
    }
  }

  // Ações do menu de três pontos. Excluir só aparece para lançamento MANUAL.
  function acoesDo(t: TransacaoDTO): AcaoMenu[] {
    const acoes: AcaoMenu[] = [{ rotulo: 'Editar', icone: 'lapis', aoClicar: () => setEditando(t) }];
    if (t.origem === 'MANUAL') {
      acoes.push({ rotulo: 'Excluir', icone: 'lixeira', perigo: true, aoClicar: () => excluir(t) });
    }
    return acoes;
  }

  const totalPaginas = Math.max(1, Math.ceil((dados?.total ?? 0) / POR_PAGINA));
  const opcoesContas = (contas ?? []).map((c) => ({ valor: String(c.id), rotulo: c.nome }));
  const opcoesCategorias = [
    { valor: '0', rotulo: 'Sem categoria' },
    ...(categorias ?? []).map((c) => ({ valor: String(c.id), rotulo: c.nome })),
  ];
  const semContaManual = contas !== null && !contas.some((c) => c.ativo && c.origem === 'MANUAL');

  return (
    <Pagina
      titulo="Lançamentos"
      acoes={
        <SeletorMes
          mes={mes}
          aoMudar={(m) => {
            setMes(m);
            setPagina(1);
          }}
        />
      }
    >
      <div className="barra-ferramentas">
        <div className="filtros">
          <Selecao rotulo="Conta" valor={contaId} aoMudar={filtrar(setContaId)} opcoes={opcoesContas} vazio="Todas" />
          <Selecao
            rotulo="Categoria"
            valor={categoriaId}
            aoMudar={filtrar(setCategoriaId)}
            opcoes={opcoesCategorias}
            vazio="Todas"
          />
          <Selecao rotulo="Tipo" valor={tipo} aoMudar={filtrar(setTipo)} opcoes={TIPOS_TRANSACAO} vazio="Todos" />
          <Campo rotulo="Buscar na descrição" valor={busca} aoMudar={filtrar(setBusca)} />
        </div>
        <Botao aoClicar={() => setNovo(true)}>Novo lançamento</Botao>
      </div>

      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {erroAcao && <Aviso tipo="erro">{erroAcao}</Aviso>}

      {dados && (
        <div className="resumo">
          <ResumoItem icone="seta-cima" cor="verde" valor={formatarReais(dados.receitas)} rotulo="Receitas" />
          <ResumoItem icone="seta-baixo" cor="vermelho" valor={formatarReais(dados.despesas)} rotulo="Despesas" />
          <ResumoItem
            icone="financeiro"
            cor="azul"
            valor={formatarReais(dados.receitas - dados.despesas)}
            rotulo="Saldo do mês"
          />
          <ResumoItem icone="transacoes" cor="roxo" valor={dados.total} rotulo="Lançamentos" />
        </div>
      )}

      {carregando && <Carregando />}
      {dados && (
        <Tabela<TransacaoDTO>
          chave={(t) => t.id}
          dados={dados.itens}
          vazio="Nenhum lançamento neste período."
          aoClicarLinha={(t) => setEditando(t)}
          colunas={[
            { titulo: 'Data', celula: (t) => formatarDia(t.data) },
            {
              titulo: 'Descrição',
              celula: (t) => (
                <span className="lanc-descricao">
                  <span>{t.descricao}</span>
                  <span className="lanc-detalhe fin-suave">
                    {t.parcela !== null && t.totalParcelas !== null && (
                      <span>
                        Parcela {t.parcela} de {t.totalParcelas}
                      </span>
                    )}
                    {t.pendente && <span>Pendente</span>}
                    <SeloOrigem origem={t.origem} />
                  </span>
                </span>
              ),
            },
            {
              titulo: 'Categoria',
              celula: (t) => (
                <>
                  {t.categoriaNome ? <NomeComCor cor={t.categoriaCor}>{t.categoriaNome}</NomeComCor> : '—'}
                  {t.transferencia && (
                    <span className="lanc-selo">
                      <Selo cor="cinza">Transferência</Selo>
                    </span>
                  )}
                </>
              ),
            },
            { titulo: 'Conta', celula: (t) => t.contaNome },
            {
              titulo: 'Valor',
              alinhar: 'direita',
              celula: (t) => <Valor valor={t.valor} sentido={t.tipo === 'RECEITA' ? 'entrada' : 'saida'} />,
            },
            {
              titulo: 'Ações',
              acoes: true,
              celula: (t) => <MenuAcoes rotulo={'Ações do lançamento ' + t.descricao} acoes={acoesDo(t)} />,
            },
          ]}
        />
      )}

      {dados && dados.total > POR_PAGINA && (
        <div className="pagina-acoes">
          <Botao variante="secundario" desabilitado={pagina <= 1} aoClicar={() => setPagina(pagina - 1)}>
            Anterior
          </Botao>
          <Botao
            variante="secundario"
            desabilitado={pagina >= totalPaginas}
            aoClicar={() => setPagina(pagina + 1)}
          >
            Próxima
          </Botao>
          <span className="fin-suave">
            Página {pagina} de {totalPaginas}
          </span>
        </div>
      )}

      <Modal
        aberto={novo || editando !== null}
        titulo={editando ? 'Editar lançamento' : 'Novo lançamento'}
        aoFechar={fecharModal}
      >
        {!editando && semContaManual ? (
          <Aviso tipo="info">Cadastre uma conta em Contas (ou um cartão em Cartões) antes de lançar.</Aviso>
        ) : (
          <FormLancamento
            key={editando?.id ?? 'novo'}
            lancamento={editando}
            contas={contas ?? []}
            categorias={categorias ?? []}
            contaInicialId={contaId ? Number(contaId) : undefined}
            aoConcluir={() => {
              fecharModal();
              recarregar();
            }}
          />
        )}
      </Modal>
    </Pagina>
  );
}
