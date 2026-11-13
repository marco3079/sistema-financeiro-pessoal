import { useState } from 'react';
import { api } from '../../lib/api';
import { TIPOS_MOVIMENTO, formatarDia, formatarReais, mensagemErro, rotuloDe } from '../../lib/financas';
import type { CategoriaDTO, ContaDTO, TransacaoDTO } from '../../lib/financas';
import { useDados } from '../../lib/useDados';
import { Aviso, Botao, Campo, Carregando, MenuAcoes, Modal, Selo, Tabela, formatarDataHora } from '../../ui';
import type { AcaoMenu } from '../../ui';
import { NomeComCor, Valor } from '../../ui/financas';
import { FormLancamento } from '../transacoes/FormLancamento';
import type { DetalheImportacaoDTO, MovimentoImportadoDTO } from './tipos';
import './historico.css';

const MOVIMENTOS_POR_VEZ = 100;

export function DetalheImportacao(props: {
  importacaoId: number;
  aoFechar: () => void;
  aoMudar: () => void; // algo foi editado ou excluído: a lista de fora deve recarregar
}): JSX.Element {
  const { importacaoId, aoFechar, aoMudar } = props;
  const detalhe = useDados<DetalheImportacaoDTO>('/importacao/' + importacaoId);
  // Mesmo padrão de Lancamentos.tsx: inativas incluídas, para a conta do lançamento aparecer no formulário.
  const contas = useDados<ContaDTO[]>('/contas?inativas=true');
  const categorias = useDados<CategoriaDTO[]>('/categorias');
  const [buscaLancamento, setBuscaLancamento] = useState('');
  const [buscaAtivo, setBuscaAtivo] = useState('');
  const [mostrados, setMostrados] = useState(MOVIMENTOS_POR_VEZ);
  const [editando, setEditando] = useState<TransacaoDTO | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  const dados = detalhe.dados;
  const imp = dados?.importacao ?? null;
  const ehB3 = imp?.tipo === 'B3';
  const lancamentos = dados?.lancamentos ?? [];
  const movimentos = dados?.movimentos ?? [];
  const quantidade = ehB3 ? movimentos.length : lancamentos.length;

  // Totais do arquivo inteiro (sem transferências), não só do que o filtro mostra.
  const receitas = lancamentos
    .filter((t) => !t.transferencia && t.tipo === 'RECEITA')
    .reduce((soma, t) => soma + t.valor, 0);
  const despesas = lancamentos
    .filter((t) => !t.transferencia && t.tipo === 'DESPESA')
    .reduce((soma, t) => soma + t.valor, 0);

  const termoLancamento = buscaLancamento.trim().toLowerCase();
  const lancamentosFiltrados =
    termoLancamento === ''
      ? lancamentos
      : lancamentos.filter((t) => t.descricao.toLowerCase().includes(termoLancamento));

  const termoAtivo = buscaAtivo.trim().toLowerCase();
  const movimentosFiltrados =
    termoAtivo === ''
      ? movimentos
      : movimentos.filter((m: MovimentoImportadoDTO) => m.investimento.toLowerCase().includes(termoAtivo));
  const movimentosVisiveis = movimentosFiltrados.slice(0, mostrados);

  async function excluir(t: TransacaoDTO) {
    if (!window.confirm(`Excluir o lançamento "${t.descricao}"?`)) return;
    setErroAcao(null);
    try {
      await api.del(`/transacoes/${t.id}`);
      detalhe.recarregar();
      aoMudar();
    } catch (e) {
      setErroAcao(mensagemErro(e));
    }
  }

  // Ações do menu de cada lançamento. Excluir só aparece para lançamento MANUAL, como em Lancamentos.tsx.
  function acoesDo(t: TransacaoDTO): AcaoMenu[] {
    const acoes: AcaoMenu[] = [{ rotulo: 'Editar', icone: 'lapis', aoClicar: () => setEditando(t) }];
    if (t.origem === 'MANUAL') {
      acoes.push({ rotulo: 'Excluir', icone: 'lixeira', perigo: true, aoClicar: () => excluir(t) });
    }
    return acoes;
  }

  return (
    <Modal aberto titulo={imp ? imp.arquivo : 'Importação'} aoFechar={aoFechar}>
      {detalhe.erro && <Aviso tipo="erro">{detalhe.erro}</Aviso>}
      {erroAcao && <Aviso tipo="erro">{erroAcao}</Aviso>}
      {detalhe.carregando && !dados && <Carregando />}

      {imp && dados && (
        <div className="historico-blocos">
          <div className="historico-resumo">
            <Selo cor={imp.tipo === 'FATURA' ? 'azul' : imp.tipo === 'EXTRATO' ? 'verde' : 'amarelo'}>
              {imp.tipo === 'FATURA' ? 'Fatura' : imp.tipo === 'EXTRATO' ? 'Extrato' : 'B3'}
            </Selo>
            <span>{imp.banco ?? '—'}</span>
            <span>{imp.contaNome ?? '—'}</span>
            <span className="fin-suave">
              {imp.tipo === 'FATURA' && imp.referencia
                ? 'Vencimento ' + formatarDia(imp.referencia)
                : (imp.referencia ?? '—')}
            </span>
            <span className="fin-suave">Importado em {formatarDataHora(imp.criadoEm)}</span>
            <span className="fin-suave">
              {quantidade} {ehB3 ? (quantidade === 1 ? 'movimento' : 'movimentos') : quantidade === 1 ? 'lançamento' : 'lançamentos'}
            </span>
          </div>

          {lancamentos.length === 0 && movimentos.length === 0 && (
            <Aviso tipo="info">
              Nenhum registro deste arquivo foi encontrado. Eles podem ter sido apagados, ou a importação é anterior ao
              controle por arquivo.
            </Aviso>
          )}

          {!ehB3 && lancamentos.length > 0 && (
            <>
              <Campo rotulo="Buscar" valor={buscaLancamento} aoMudar={setBuscaLancamento} />
              <div className="historico-totais">
                <span>Receitas {formatarReais(receitas)}</span>
                <span>·</span>
                <span>Despesas {formatarReais(despesas)}</span>
              </div>
              <Tabela<TransacaoDTO>
                chave={(t) => t.id}
                dados={lancamentosFiltrados}
                vazio="Nenhum lançamento com essa descrição."
                colunas={[
                  { titulo: 'Data', celula: (t) => formatarDia(t.data) },
                  {
                    titulo: 'Descrição',
                    celula: (t) => (
                      <>
                        {t.descricao}
                        {t.parcela !== null && t.totalParcelas !== null && (
                          <span className="fin-suave"> Parcela {t.parcela} de {t.totalParcelas}</span>
                        )}
                        {t.transferencia && <Selo cor="cinza">Transferência</Selo>}
                      </>
                    ),
                  },
                  {
                    titulo: 'Categoria',
                    celula: (t) =>
                      t.categoriaNome ? <NomeComCor cor={t.categoriaCor}>{t.categoriaNome}</NomeComCor> : '—',
                  },
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
            </>
          )}

          {ehB3 && movimentos.length > 0 && (
            <>
              <span className="fin-suave">Os movimentos são editados na tela Investimentos, dentro de cada ativo.</span>
              <Campo
                rotulo="Buscar ativo"
                valor={buscaAtivo}
                aoMudar={(texto) => {
                  setBuscaAtivo(texto);
                  setMostrados(MOVIMENTOS_POR_VEZ);
                }}
              />
              <Tabela<MovimentoImportadoDTO>
                chave={(m) => m.id}
                dados={movimentosVisiveis}
                vazio="Nenhum movimento com esse ativo."
                colunas={[
                  { titulo: 'Data', celula: (m) => formatarDia(m.data) },
                  { titulo: 'Ativo', celula: (m) => m.investimento },
                  { titulo: 'Tipo', celula: (m) => rotuloDe(TIPOS_MOVIMENTO, m.tipo) },
                  {
                    titulo: 'Quantidade',
                    alinhar: 'direita',
                    celula: (m) =>
                      m.quantidade === null ? '—' : m.quantidade.toLocaleString('pt-BR', { maximumFractionDigits: 8 }),
                  },
                  { titulo: 'Valor', alinhar: 'direita', celula: (m) => formatarReais(m.valor) },
                ]}
              />
              {movimentosVisiveis.length < movimentosFiltrados.length && (
                <div className="pagina-acoes">
                  <Botao variante="secundario" aoClicar={() => setMostrados(mostrados + MOVIMENTOS_POR_VEZ)}>
                    Mostrar mais
                  </Botao>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <Modal aberto={editando !== null} titulo="Editar lançamento" aoFechar={() => setEditando(null)}>
        {editando && (
          <FormLancamento
            key={editando.id}
            lancamento={editando}
            contas={contas.dados ?? []}
            categorias={categorias.dados ?? []}
            aoConcluir={() => {
              setEditando(null);
              detalhe.recarregar();
              aoMudar();
            }}
          />
        )}
      </Modal>
    </Modal>
  );
}
