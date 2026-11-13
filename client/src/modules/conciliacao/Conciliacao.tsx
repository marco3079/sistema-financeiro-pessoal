import { useState } from 'react';
import { api } from '../../lib/api';
import { formatarDia, formatarReais, mensagemErro, STATUS_FATURA } from '../../lib/financas';
import type { ContaDTO } from '../../lib/financas';
import { useDados } from '../../lib/useDados';
import { Aviso, Botao, Cartao, Carregando, Modal, Pagina, Selo, Tabela } from '../../ui';
import { ResumoItem, SeloOrigem, Valor, Vazio } from '../../ui/financas';
import './conciliacao.css';

// Tolerância de arredondamento: diferenças até 1 centavo não contam como divergência.
const TOLERANCIA = 0.01;

interface FaturaConciliadaDTO {
  id: number;
  vencimento: string;
  status: keyof typeof STATUS_FATURA;
  total: number;
  somaDosLancamentos: number;
  diferenca: number;
}

interface LancamentoSemFaturaDTO {
  id: number;
  data: string;
  descricao: string;
  valor: number;
  tipo: 'RECEITA' | 'DESPESA';
}

interface CartaoConciliadoDTO {
  contaId: number;
  nome: string;
  origem: ContaDTO['origem'];
  saldo: number;
  faturasNaoPagas: number;
  diferenca: number;
  faturas: FaturaConciliadaDTO[];
  semFatura: LancamentoSemFaturaDTO[];
}

interface ConciliacaoDTO {
  cartoes: CartaoConciliadoDTO[];
  divergencias: number;
}

function temDivergencia(c: CartaoConciliadoDTO): boolean {
  return Math.abs(c.diferenca) > TOLERANCIA || c.faturas.some((f) => Math.abs(f.diferenca) > TOLERANCIA);
}

function CartaoConciliacao({
  cartao,
  aoCorrigir,
}: {
  cartao: CartaoConciliadoDTO;
  aoCorrigir: (cartao: CartaoConciliadoDTO) => void;
}) {
  const divergente = Math.abs(cartao.diferenca) > TOLERANCIA;
  const divergenteAlgumaFatura = temDivergencia(cartao);

  return (
    <Cartao>
      <div className="conciliacao-cabecalho">
        <h2 className="conciliacao-nome">{cartao.nome}</h2>
        <SeloOrigem origem={cartao.origem} />
      </div>

      <dl className="conciliacao-numeros">
        <div>
          <dt>Dívida registrada</dt>
          <dd>{formatarReais(cartao.saldo)}</dd>
        </div>
        <div>
          <dt>Soma das faturas não pagas</dt>
          <dd>{formatarReais(cartao.faturasNaoPagas)}</dd>
        </div>
        <div>
          <dt>Diferença</dt>
          <dd>
            {divergente ? (
              <span className="conciliacao-diferenca-erro">{formatarReais(cartao.diferenca)}</span>
            ) : (
              <Selo cor="verde">Tudo certo</Selo>
            )}
          </dd>
        </div>
      </dl>

      {cartao.faturas.length > 0 ? (
        <Tabela
          colunas={[
            { titulo: 'Vencimento', celula: (f: FaturaConciliadaDTO) => formatarDia(f.vencimento) },
            {
              titulo: 'Situação',
              celula: (f: FaturaConciliadaDTO) => <Selo cor={STATUS_FATURA[f.status].cor}>{STATUS_FATURA[f.status].rotulo}</Selo>,
            },
            { titulo: 'Total', alinhar: 'direita', celula: (f: FaturaConciliadaDTO) => formatarReais(f.total) },
            {
              titulo: 'Soma dos lançamentos',
              alinhar: 'direita',
              celula: (f: FaturaConciliadaDTO) => formatarReais(f.somaDosLancamentos),
            },
            {
              titulo: 'Diferença',
              alinhar: 'direita',
              celula: (f: FaturaConciliadaDTO) =>
                Math.abs(f.diferenca) > TOLERANCIA ? (
                  <span className="conciliacao-diferenca-erro">{formatarReais(f.diferenca)}</span>
                ) : (
                  <span className="conciliacao-diferenca-ok">{formatarReais(0)}</span>
                ),
            },
          ]}
          dados={cartao.faturas}
          chave={(f) => f.id}
          vazio="Nenhuma fatura em aberto."
        />
      ) : (
        <p className="conciliacao-texto-suave">Nenhuma fatura em aberto.</p>
      )}

      {cartao.semFatura.length > 0 && (
        <section className="conciliacao-secao">
          <h3>Lançamentos sem fatura</h3>
          <p className="conciliacao-explicacao">
            Estes lançamentos estão no cartão mas não entraram em nenhuma fatura, por isso a dívida não bate.
          </p>
          <Tabela
            colunas={[
              { titulo: 'Data', celula: (l: LancamentoSemFaturaDTO) => formatarDia(l.data) },
              { titulo: 'Descrição', celula: (l: LancamentoSemFaturaDTO) => l.descricao },
              {
                titulo: 'Valor',
                alinhar: 'direita',
                celula: (l: LancamentoSemFaturaDTO) => (
                  <Valor valor={l.valor} sentido={l.tipo === 'RECEITA' ? 'entrada' : 'saida'} />
                ),
              },
            ]}
            dados={cartao.semFatura}
            chave={(l) => l.id}
          />
        </section>
      )}

      {divergenteAlgumaFatura && cartao.origem === 'MANUAL' && (
        <div className="conciliacao-acoes">
          <Botao variante="secundario" aoClicar={() => aoCorrigir(cartao)}>
            Corrigir dívida e totais
          </Botao>
        </div>
      )}
    </Cartao>
  );
}

export function Conciliacao() {
  const { dados, carregando, erro, recarregar } = useDados<ConciliacaoDTO>('/conciliacao');
  const [aCorrigir, setACorrigir] = useState<CartaoConciliadoDTO | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erroCorrigir, setErroCorrigir] = useState<string | null>(null);

  function fechar() {
    if (ocupado) return;
    setACorrigir(null);
    setErroCorrigir(null);
  }

  async function confirmarCorrecao() {
    if (!aCorrigir) return;
    setOcupado(true);
    setErroCorrigir(null);
    try {
      await api.post(`/conciliacao/${aCorrigir.contaId}/corrigir`);
      setOcupado(false);
      setACorrigir(null);
      recarregar();
    } catch (e) {
      setErroCorrigir(mensagemErro(e));
      setOcupado(false);
    }
  }

  return (
    <Pagina titulo="Conciliação">
      <p className="conciliacao-texto-suave">
        Confere se a dívida de cada cartão bate com as faturas em aberto, e se o total de cada fatura bate com os
        lançamentos dela.
      </p>

      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {carregando && <Carregando />}

      {dados && dados.cartoes.length === 0 && (
        <Vazio icone="cartao" titulo="Nenhum cartão para conferir" texto="Cadastre um cartão para ver a conciliação." />
      )}

      {dados && dados.cartoes.length > 0 && (
        <>
          <div className="conciliacao-resumo">
            <ResumoItem icone="cartao" cor="azul" valor={dados.cartoes.length} rotulo="Cartões" />
            <ResumoItem icone="atividade" cor={dados.divergencias > 0 ? 'vermelho' : 'verde'} valor={dados.divergencias} rotulo="Divergências" />
          </div>

          <div className="conciliacao-grade">
            {dados.cartoes.map((c) => (
              <CartaoConciliacao key={c.contaId} cartao={c} aoCorrigir={(alvo) => setACorrigir(alvo)} />
            ))}
          </div>
        </>
      )}

      <Modal
        aberto={aCorrigir !== null}
        titulo="Corrigir dívida e totais"
        aoFechar={fechar}
      >
        {aCorrigir && (
          <div>
            {erroCorrigir && <Aviso tipo="erro">{erroCorrigir}</Aviso>}
            <p className="conciliacao-confirma">
              {`Vamos recalcular o total de cada fatura de ${aCorrigir.nome} a partir dos lançamentos dela e gravar a dívida do cartão como a soma das faturas não pagas. Nenhum lançamento será criado ou apagado.`}
            </p>
            <div className="pagina-acoes">
              <Botao variante="secundario" aoClicar={fechar} desabilitado={ocupado}>
                Cancelar
              </Botao>
              <Botao aoClicar={confirmarCorrecao} desabilitado={ocupado}>
                Corrigir
              </Botao>
            </div>
          </div>
        )}
      </Modal>
    </Pagina>
  );
}
