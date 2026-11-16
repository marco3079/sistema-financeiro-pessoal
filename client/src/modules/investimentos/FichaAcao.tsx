import { formatarDia, formatarReais } from '../../lib/financas';
import { useDados } from '../../lib/useDados';
import { Aviso, Carregando, Modal, Tabela } from '../../ui';
import { grande, Indicador, inteiro, NotaDoFundo, porCota, rotuloTipo } from './FundoB3';
import type { AnaliseFii } from './FundoB3';
import './fundo-b3.css';

// Ficha de uma ação (GET /carteira/acao/:codigo): dados da companhia na B3, o último balanço anual na CVM, a
// cotação, os indicadores com a nota de 0 a 100 e a posição da pessoa.

interface ProventoAcao {
  dataPagamento: string;
  dataCom: string | null;
  valorPorAcao: number;
  tipo: string;
  isin: string;
}

interface FichaAcaoDTO {
  codigo: string;
  companhia: {
    nome: string;
    nomePregao: string;
    codigoCvm: number;
    segmentoDeListagem: string | null;
    acoesTotal: number | null;
    balancoConsolidado: boolean | null;
  };
  preco: number | null;
  fontePreco: 'BRAPI' | 'YAHOO' | null;
  analise: AnaliseFii & { valores: Record<string, number | null> };
  proventos: ProventoAcao[];
  posicao: { investimentoId: number; quantidade: number; valorAplicado: number; saldo: number; precoMedio: number | null } | null;
}

const ROTULO_PROVENTO: Record<string, string> = { DIVIDENDO: 'Dividendo', 'JRS CAP PROPRIO': 'JCP', RENDIMENTO: 'Rendimento' };

export function FichaAcao({ codigo, aoFechar }: { codigo: string | null; aoFechar: () => void }) {
  const { dados, carregando, erro } = useDados<FichaAcaoDTO>(codigo ? `/carteira/acao/${encodeURIComponent(codigo)}` : null);
  const ficha = dados && dados.codigo === codigo ? dados : null;
  const v = ficha?.analise.valores ?? {};
  const hoje = new Date().toISOString().slice(0, 10);

  return (
    <Modal aberto={codigo !== null} titulo={codigo ? `${codigo} · ação` : ''} aoFechar={aoFechar} largo>
      <div className="fb3">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {carregando && !ficha && !erro && (
          <>
            <Carregando />
            <p className="fin-suave">Na primeira consulta do dia, os balanços da CVM levam alguns segundos para carregar.</p>
          </>
        )}
        {ficha && (
          <>
            <div className="fb3-cabecalho">
              <strong>{ficha.companhia.nome}</strong>
              <span className="fin-suave">
                {[
                  `Código CVM ${ficha.companhia.codigoCvm}`,
                  ficha.companhia.segmentoDeListagem && `Segmento de listagem: ${ficha.companhia.segmentoDeListagem}`,
                  ficha.analise.dataCvm &&
                    `Balanço anual de ${ficha.analise.dataCvm.slice(0, 4)}${ficha.companhia.balancoConsolidado === false ? ' (individual)' : ' (consolidado)'}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </div>

            {!ficha.analise.dataCvm && (
              <Aviso tipo="info">
                O balanço desta empresa não está nos dados abertos da CVM dos dois últimos anos: os indicadores do balanço
                ficam sem valor.
              </Aviso>
            )}

            <NotaDoFundo
              analise={ficha.analise}
              fonte="Lucro, patrimônio e dívida: balanço anual na CVM com fim em"
              aviso="A nota é só uma leitura dos números do último balanço anual: não avalia o setor, a gestão nem as perspectivas da empresa, e não é recomendação de compra ou venda."
            />

            <div className="fb3-grade">
              <Indicador
                rotulo="Cotação"
                valor={porCota(ficha.preco)}
                apoio={ficha.fontePreco === 'BRAPI' ? 'brapi.dev' : ficha.fontePreco === 'YAHOO' ? 'último fechamento (Yahoo)' : 'sem cotação'}
              />
              <Indicador rotulo="Valor de mercado" valor={grande(v.valorDeMercado ?? null)} apoio="ações ON e PN × o preço de cada uma" />
              <Indicador rotulo="Lucro do ano" valor={grande(v.lucro ?? null)} apoio="atribuído aos controladores" />
              <Indicador rotulo="Receita do ano" valor={grande(v.receita ?? null)} />
              <Indicador rotulo="Patrimônio líquido" valor={grande(v.patrimonioLiquido ?? null)} apoio="dos controladores" />
              <Indicador rotulo="EBITDA" valor={grande(v.ebitda ?? null)} apoio="lucro operacional + depreciação" />
              <Indicador rotulo="Dívida líquida" valor={grande(v.dividaLiquida ?? null)} apoio="empréstimos − caixa e aplicações" />
              <Indicador rotulo="Proventos por ação (12 meses)" valor={porCota(v.proventosPorAcao12m ?? null)} apoio="dividendos e JCP brutos" />
              <Indicador rotulo="Ações emitidas" valor={inteiro(ficha.companhia.acoesTotal)} />
            </div>

            {ficha.posicao && (
              <section className="fb3-secao">
                <h3>Sua posição</h3>
                <div className="fb3-grade">
                  <Indicador rotulo="Ações" valor={inteiro(ficha.posicao.quantidade)} />
                  <Indicador rotulo="Preço médio" valor={porCota(ficha.posicao.precoMedio)} />
                  <Indicador rotulo="Aplicado" valor={formatarReais(ficha.posicao.valorAplicado)} />
                  <Indicador rotulo="Saldo" valor={formatarReais(ficha.posicao.saldo)} />
                </div>
              </section>
            )}

            <section className="fb3-secao">
              <h3>Proventos desta ação (12 meses e anunciados)</h3>
              <Tabela<ProventoAcao>
                chave={(p) => `${p.dataPagamento}-${p.tipo}-${p.valorPorAcao}`}
                dados={ficha.proventos}
                vazio="A B3 não informa proventos desta ação nos últimos 12 meses."
                colunas={[
                  { titulo: 'Pagamento', celula: (p) => `${formatarDia(p.dataPagamento)}${p.dataPagamento > hoje ? ' (a pagar)' : ''}` },
                  { titulo: 'Data com', celula: (p) => formatarDia(p.dataCom) },
                  { titulo: 'Tipo', celula: (p) => ROTULO_PROVENTO[p.tipo] ?? rotuloTipo(p.tipo) },
                  { titulo: 'Por ação', alinhar: 'direita', celula: (p) => porCota(p.valorPorAcao) },
                  ...(ficha.posicao && ficha.posicao.quantidade > 0
                    ? [
                        {
                          titulo: 'Para as suas ações',
                          alinhar: 'direita' as const,
                          celula: (p: ProventoAcao) => formatarReais(p.valorPorAcao * (ficha.posicao?.quantidade ?? 0)),
                        },
                      ]
                    : []),
                ]}
              />
            </section>

            <p className="fin-suave fb3-fonte">
              Fontes: dados públicos da B3 (empresas listadas), balanços abertos da CVM (DFP) e cotação da brapi.dev ou do
              Yahoo Finance. Não é recomendação de compra ou venda.
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}
