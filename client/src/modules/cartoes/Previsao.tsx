import { useEffect, useState } from 'react';
import { formatarDia, formatarReais, rotuloMes } from '../../lib/financas';
import { useDados } from '../../lib/useDados';
import { Aviso, Cartao, Carregando, Selecao, Tabela } from '../../ui';
import { ResumoItem } from '../../ui/financas';
import './previsao.css';

interface ItemPrevisto {
  descricao: string;
  parcela: number;
  totalParcelas: number;
  valor: number;
}
interface MesCartao {
  mes: string; // 'AAAA-MM' do vencimento
  vencimento: string; // 'AAAA-MM-DD'
  lancado: number; // fatura que já existe e ainda não foi paga
  previsto: number; // parcelas que ainda vão entrar
  total: number; // lancado + previsto
  itens: ItemPrevisto[]; // só as parcelas previstas
}
interface CartaoPrevisao {
  contaId: number;
  nome: string;
  cor: string;
  meses: MesCartao[];
  parcelasRestantes: number;
  previsto: number;
  total: number;
}
interface MesGeral {
  mes: string;
  lancado: number;
  previsto: number;
  total: number;
}
interface PrevisaoDTO {
  cartoes: CartaoPrevisao[];
  meses: MesGeral[]; // soma de todos os cartões, em ordem crescente de mês
  parcelasRestantes: number;
  previsto: number;
  total: number;
}

export function Previsao({ versao }: { versao: number }): JSX.Element | null {
  const { dados, carregando, erro, recarregar } = useDados<PrevisaoDTO>('/cartoes/previsao');
  const [contaEscolhida, setContaEscolhida] = useState<string>('');
  const [mesAberto, setMesAberto] = useState<string | null>(null);

  useEffect(() => {
    recarregar();
  }, [versao, recarregar]);

  if (dados && dados.meses.length === 0) return null;

  const cartoesComMeses = dados ? dados.cartoes.filter((c) => c.meses.length > 0) : [];
  const cartao = cartoesComMeses.find((c) => String(c.contaId) === contaEscolhida) ?? cartoesComMeses[0] ?? null;
  const meses = cartao ? cartao.meses : [];
  const detalhe = meses.find((m) => m.mes === mesAberto);
  const maiorTotal = dados ? Math.max(0, ...dados.meses.map((m) => m.total)) : 0;
  const ultimo = dados && dados.meses.length > 0 ? dados.meses[dados.meses.length - 1] : null;

  return (
    <Cartao titulo="Próximas faturas">
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {!dados && carregando && <Carregando />}
      {dados && ultimo && (
        <div className="previsao">
          <p className="fin-suave">
            Previsão com a fatura já lançada e{' '}
            {dados.parcelasRestantes === 1
              ? 'a 1 parcela que ainda vai ser cobrada'
              : `as ${dados.parcelasRestantes} parcelas que ainda vão ser cobradas`}
            . Compras novas não entram.
          </p>

          <div className="resumo">
            <ResumoItem icone="cartao" cor="laranja" valor={formatarReais(dados.total)} rotulo="Total a pagar" />
            <ResumoItem icone="transacoes" cor="azul" valor={formatarReais(dados.previsto)} rotulo="Em parcelas futuras" />
            <ResumoItem icone="visto" cor="verde" valor={rotuloMes(ultimo.mes)} rotulo="Última parcela" />
          </div>

          <div className="previsao-barras">
            {dados.meses.map((m) => {
              const largura = m.total > 0 && maiorTotal > 0 ? Math.max(2, (m.total / maiorTotal) * 100) : 0;
              const parteLancada = m.total > 0 ? (m.lancado / m.total) * 100 : 0;
              return (
                <div className="previsao-linha" key={m.mes}>
                  <span className="previsao-rotulo">{rotuloMes(m.mes)}</span>
                  <div className="previsao-trilho">
                    <div className="previsao-barra" style={{ width: `${largura}%` }}>
                      <span className="previsao-barra-lancado" style={{ width: `${parteLancada}%` }} />
                      <span className="previsao-barra-previsto" />
                    </div>
                  </div>
                  <span className="previsao-valor">{formatarReais(m.total)}</span>
                </div>
              );
            })}
          </div>
          <div className="previsao-legenda">
            <span className="previsao-legenda-item">
              <span className="previsao-quadrado previsao-quadrado-lancado" aria-hidden="true" />
              Já lançado na fatura
            </span>
            <span className="previsao-legenda-item">
              <span className="previsao-quadrado previsao-quadrado-previsto" aria-hidden="true" />
              Parcelas previstas
            </span>
          </div>

          {cartoesComMeses.length > 1 && (
            <div className="previsao-seletor">
              <Selecao
                rotulo="Cartão"
                valor={cartao ? String(cartao.contaId) : ''}
                aoMudar={(valor) => {
                  setContaEscolhida(valor);
                  setMesAberto(null);
                }}
                opcoes={cartoesComMeses.map((c) => ({ valor: String(c.contaId), rotulo: c.nome }))}
              />
            </div>
          )}

          <Tabela<MesCartao>
            chave={(m) => m.mes}
            dados={meses}
            vazio="Nenhuma parcela futura neste cartão."
            aoClicarLinha={(m) => setMesAberto(m.mes === mesAberto ? null : m.mes)}
            colunas={[
              { titulo: 'Vencimento', celula: (m) => formatarDia(m.vencimento) },
              { titulo: 'Já lançado', alinhar: 'direita', celula: (m) => formatarReais(m.lancado) },
              { titulo: 'Parcelas previstas', alinhar: 'direita', celula: (m) => formatarReais(m.previsto) },
              { titulo: 'Total', alinhar: 'direita', celula: (m) => <strong>{formatarReais(m.total)}</strong> },
              { titulo: 'Parcelas', celula: (m) => m.itens.length },
            ]}
          />

          {detalhe && detalhe.itens.length > 0 && (
            <div className="previsao-itens">
              <h3 className="previsao-itens-titulo">Parcelas previstas para {rotuloMes(detalhe.mes)}</h3>
              {detalhe.itens.map((item, i) => (
                <div className="previsao-item" key={`${item.descricao}-${item.parcela}-${i}`}>
                  <div className="previsao-item-texto">
                    <span className="previsao-item-descricao">{item.descricao}</span>
                    <span className="fin-suave">
                      Parcela {item.parcela} de {item.totalParcelas}
                    </span>
                  </div>
                  <span className="previsao-item-valor">{formatarReais(item.valor)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Cartao>
  );
}
