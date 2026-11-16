import { formatarDia, formatarReais } from '../../lib/financas';
import { useDados } from '../../lib/useDados';
import { Aviso, Carregando, Modal, Selo, Tabela } from '../../ui';
import type { ColunaTabela } from '../../ui';
import './fundo-b3.css';

// Ficha de um fundo imobiliário com os dados públicos da B3 (GET /carteira/fundo/:codigo).

interface ProventoB3 {
  dataPagamento: string;
  dataCom: string | null;
  aprovadoEm: string | null;
  valorPorCota: number;
  referente: string | null;
  tipo: string;
}

interface FichaFundo {
  fundo: {
    codigo: string;
    nomePregao: string | null;
    escriturador: string | null;
    cotasEmitidas: number | null;
    listadoDesde: string | null;
    loteDeNegociacao: number | null;
    forma: string | null;
    segmento: string | null;
    proventos: ProventoB3[];
    subscricoes: {
      dataCom: string | null;
      aprovadoEm: string | null;
      percentual: number | null;
      precoPorCota: number | null;
      periodo: string | null;
      dataSubscricao: string | null;
    }[];
    eventos: { tipo: string; fator: number | null; dataCom: string | null; aprovadoEm: string | null }[];
  };
  preco: number | null;
  fontePreco: 'BRAPI' | 'YAHOO' | null;
  indicadores: {
    proventosPorCota12m: number | null;
    pagamentos12m: number;
    rendimentoMedioMensal: number | null;
    dividendYield12m: number | null;
    ultimoRendimento: ProventoB3 | null;
    ultimoYield: number | null;
    valorDeMercado: number | null;
  };
  aPagar: ProventoB3[];
  posicao: {
    investimentoId: number;
    quantidade: number;
    valorAplicado: number;
    saldo: number;
    precoMedio: number | null;
    recebido12m: number;
    aReceber: number;
    ultimaDataRecebida: string | null;
  } | null;
}

function porCota(valor: number | null): string {
  if (valor === null) return '—';
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function inteiro(valor: number | null): string {
  return valor === null ? '—' : valor.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

function percentual(valor: number | null): string {
  return valor === null ? '—' : valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
}

// Valor de mercado em texto curto: "R$ 1,78 bi", "R$ 350,2 mi".
function grande(valor: number | null): string {
  if (valor === null) return '—';
  if (valor >= 1e9) return `R$ ${(valor / 1e9).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} bi`;
  if (valor >= 1e6) return `R$ ${(valor / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  return formatarReais(valor);
}

function rotuloTipo(tipo: string): string {
  const t = tipo.toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function Indicador({ rotulo, valor, apoio }: { rotulo: string; valor: string; apoio?: string }) {
  return (
    <div className="fb3-indicador">
      <span className="fin-suave">{rotulo}</span>
      <strong>{valor}</strong>
      {apoio && <span className="fin-suave fb3-apoio">{apoio}</span>}
    </div>
  );
}

export function FundoB3({ codigo, aoFechar }: { codigo: string | null; aoFechar: () => void }) {
  const { dados, carregando, erro } = useDados<FichaFundo>(codigo ? `/carteira/fundo/${encodeURIComponent(codigo)}` : null);
  const ficha = dados && dados.fundo.codigo === codigo ? dados : null;

  const colunasProventos: ColunaTabela<ProventoB3>[] = [
    {
      titulo: 'Pagamento',
      celula: (p) => (
        <span className="fb3-data">
          {formatarDia(p.dataPagamento)}
          {ficha && ficha.aPagar.includes(p) && <Selo cor="azul">A pagar</Selo>}
        </span>
      ),
    },
    { titulo: 'Data com', celula: (p) => formatarDia(p.dataCom) },
    { titulo: 'Referente a', celula: (p) => p.referente ?? '—' },
    { titulo: 'Tipo', celula: (p) => rotuloTipo(p.tipo) },
    { titulo: 'Por cota', alinhar: 'direita', celula: (p) => porCota(p.valorPorCota) },
    ...(ficha?.posicao && ficha.posicao.quantidade > 0
      ? [
          {
            titulo: 'Para as suas cotas',
            alinhar: 'direita' as const,
            celula: (p: ProventoB3) => formatarReais(p.valorPorCota * (ficha.posicao?.quantidade ?? 0)),
          },
        ]
      : []),
  ];

  return (
    <Modal aberto={codigo !== null} titulo={codigo ? `${codigo} na B3` : ''} aoFechar={aoFechar}>
      <div className="fb3">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {carregando && !ficha && !erro && <Carregando />}
        {ficha && (
          <>
            <div className="fb3-cabecalho">
              <strong>{ficha.fundo.nomePregao ?? ficha.fundo.codigo}</strong>
              <span className="fin-suave">
                {[
                  ficha.fundo.escriturador && `Escriturador: ${ficha.fundo.escriturador}`,
                  ficha.fundo.listadoDesde && `Listado desde ${formatarDia(ficha.fundo.listadoDesde)}`,
                  ficha.fundo.segmento && `Segmento ${ficha.fundo.segmento.toLowerCase()}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </div>

            <div className="fb3-grade">
              <Indicador
                rotulo="Cotação"
                valor={porCota(ficha.preco)}
                apoio={ficha.fontePreco === 'BRAPI' ? 'brapi.dev' : ficha.fontePreco === 'YAHOO' ? 'último fechamento (Yahoo)' : 'sem cotação'}
              />
              <Indicador
                rotulo="Dividend yield (12 meses)"
                valor={percentual(ficha.indicadores.dividendYield12m)}
                apoio={`${porCota(ficha.indicadores.proventosPorCota12m)} por cota em ${ficha.indicadores.pagamentos12m} pagamentos`}
              />
              <Indicador
                rotulo="Último rendimento"
                valor={porCota(ficha.indicadores.ultimoRendimento?.valorPorCota ?? null)}
                apoio={
                  ficha.indicadores.ultimoRendimento
                    ? `pago em ${formatarDia(ficha.indicadores.ultimoRendimento.dataPagamento)} · ${percentual(ficha.indicadores.ultimoYield)} da cotação`
                    : undefined
                }
              />
              <Indicador rotulo="Média por mês (por cota)" valor={porCota(ficha.indicadores.rendimentoMedioMensal)} />
              <Indicador rotulo="Cotas emitidas" valor={inteiro(ficha.fundo.cotasEmitidas)} />
              <Indicador rotulo="Valor de mercado" valor={grande(ficha.indicadores.valorDeMercado)} apoio="cotas × cotação" />
            </div>

            {ficha.posicao && (
              <section className="fb3-secao">
                <h3>Sua posição</h3>
                <div className="fb3-grade">
                  <Indicador rotulo="Cotas" valor={inteiro(ficha.posicao.quantidade)} />
                  <Indicador rotulo="Preço médio" valor={porCota(ficha.posicao.precoMedio)} />
                  <Indicador rotulo="Aplicado" valor={formatarReais(ficha.posicao.valorAplicado)} />
                  <Indicador rotulo="Saldo" valor={formatarReais(ficha.posicao.saldo)} />
                  <Indicador rotulo="Recebido em 12 meses" valor={formatarReais(ficha.posicao.recebido12m)} />
                  <Indicador
                    rotulo="A receber (anunciado)"
                    valor={formatarReais(ficha.posicao.aReceber)}
                    apoio="valor por cota × as cotas de hoje"
                  />
                </div>
              </section>
            )}

            <section className="fb3-secao">
              <h3>Proventos anunciados na B3</h3>
              <Tabela<ProventoB3>
                chave={(p) => `${p.dataPagamento}-${p.tipo}-${p.valorPorCota}`}
                dados={ficha.fundo.proventos}
                vazio="A B3 não informa proventos deste fundo."
                colunas={colunasProventos}
              />
            </section>

            {ficha.fundo.subscricoes.length > 0 && (
              <section className="fb3-secao">
                <h3>Subscrições</h3>
                <ul className="fb3-lista">
                  {ficha.fundo.subscricoes.map((s, i) => (
                    <li key={i}>
                      Direito de {percentual(s.percentual)} das cotas a {porCota(s.precoPorCota)} por cota
                      {s.dataCom && ` · data com ${formatarDia(s.dataCom)}`}
                      {s.periodo && ` · período ${s.periodo.replace('31/12/9999 a ', 'até ')}`}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {ficha.fundo.eventos.length > 0 && (
              <section className="fb3-secao">
                <h3>Desdobramentos e grupamentos</h3>
                <ul className="fb3-lista">
                  {ficha.fundo.eventos.map((e, i) => (
                    <li key={i}>
                      {rotuloTipo(e.tipo)}
                      {e.fator !== null && ` (fator ${e.fator.toLocaleString('pt-BR')})`}
                      {e.dataCom && ` · data com ${formatarDia(e.dataCom)}`}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <p className="fin-suave fb3-fonte">
              Fonte: dados públicos da B3 (Fundos listados) e cotação da brapi.dev ou do Yahoo Finance. Não é
              recomendação de compra ou venda.
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}
