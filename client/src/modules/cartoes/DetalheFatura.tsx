import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { formatarDia, formatarReais, hojeISO, mensagemErro, STATUS_FATURA } from '../../lib/financas';
import type { ContaDTO, FaturaDTO, TransacaoDTO } from '../../lib/financas';
import { useDados } from '../../lib/useDados';
import { Aviso, Botao, Campo, Carregando, Modal, Selecao, Selo, Tabela } from '../../ui';
import { NomeComCor, Rosca, SeloOrigem, Valor } from '../../ui/financas';
import './cartoes.css';

interface DetalheFaturaDTO {
  fatura: FaturaDTO;
  transacoes: TransacaoDTO[];
  porCategoria: { nome: string; cor: string; total: number }[];
}

export function DetalheFatura(props: { faturaId: number; aoFechar: () => void; aoMudar: () => void }): JSX.Element {
  const { faturaId, aoFechar, aoMudar } = props;
  const detalhe = useDados<DetalheFaturaDTO>('/faturas/' + faturaId);
  const contas = useDados<ContaDTO[]>('/contas');
  const [pagaEm, setPagaEm] = useState(hojeISO());
  const [contaPagamentoId, setContaPagamentoId] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  const dados = detalhe.dados;
  const fatura = dados?.fatura ?? null;
  const contasPagamento = (contas.dados ?? []).filter((c) => c.origem === 'MANUAL' && c.ativo && c.tipo !== 'CARTAO');

  async function pagar(e: FormEvent) {
    e.preventDefault();
    if (!fatura) return;
    setErroAcao(null);
    setOcupado(true);
    try {
      const corpo: { pagaEm: string; contaPagamentoId?: number } = { pagaEm };
      if (contaPagamentoId !== '') corpo.contaPagamentoId = Number(contaPagamentoId);
      await api.post(`/faturas/${fatura.id}/pagar`, corpo);
      detalhe.recarregar();
      aoMudar();
    } catch (err) {
      setErroAcao(mensagemErro(err));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Modal aberto titulo={fatura ? 'Fatura de ' + formatarDia(fatura.vencimento) : 'Fatura'} aoFechar={aoFechar}>
      {detalhe.erro && <Aviso tipo="erro">{detalhe.erro}</Aviso>}
      {erroAcao && <Aviso tipo="erro">{erroAcao}</Aviso>}
      {detalhe.carregando && <Carregando />}

      {fatura && dados && (
        <>
          <div className="cartoes-fatura-topo">
            <div>
              <span className="fin-suave">Total da fatura</span>
              <div className="cartoes-fatura-total">{formatarReais(fatura.total)}</div>
            </div>
            <Selo cor={STATUS_FATURA[fatura.status].cor}>{STATUS_FATURA[fatura.status].rotulo}</Selo>
            <span className="fin-suave">Vencimento: {formatarDia(fatura.vencimento)}</span>
            <span className="fin-suave">Fechamento: {formatarDia(fatura.fechamento)}</span>
            {fatura.minimo !== null && <span className="fin-suave">Mínimo: {formatarReais(fatura.minimo)}</span>}
            <SeloOrigem origem={fatura.origem} />
          </div>

          {fatura.origem === 'OPEN_FINANCE' && (
            <Aviso tipo="info">A situação desta fatura vem do banco pelo Open Finance.</Aviso>
          )}

          {dados.porCategoria.length > 0 && (
            <Rosca
              fatias={dados.porCategoria.map((c) => ({ rotulo: c.nome, valor: c.total, cor: c.cor }))}
              centro={formatarReais(fatura.total)}
            />
          )}

          <Tabela<TransacaoDTO>
            chave={(t) => t.id}
            dados={dados.transacoes}
            vazio="Nenhuma compra nesta fatura."
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
            ]}
          />

          {fatura.origem === 'MANUAL' && fatura.status !== 'PAGA' && (
            <form onSubmit={pagar}>
              <h3 className="cartao-titulo">Pagar fatura</h3>
              <Selecao
                rotulo="Pagar com a conta"
                valor={contaPagamentoId}
                aoMudar={setContaPagamentoId}
                opcoes={contasPagamento.map((c) => ({ valor: String(c.id), rotulo: c.nome }))}
                vazio="Não debitar de nenhuma conta"
              />
              <Campo rotulo="Pago em" tipo="date" valor={pagaEm} aoMudar={setPagaEm} />
              <div className="pagina-acoes">
                <Botao tipo="submit" desabilitado={ocupado}>
                  Marcar como paga
                </Botao>
              </div>
            </form>
          )}
        </>
      )}
    </Modal>
  );
}
