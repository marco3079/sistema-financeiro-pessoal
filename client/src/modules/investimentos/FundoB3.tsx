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

type Avaliacao = 'BOM' | 'ATENCAO' | 'RUIM';

interface IndicadorFii {
  chave: string;
  nome: string;
  valor: number | null;
  formato: 'PERCENTUAL' | 'NUMERO' | 'REAIS' | 'REAIS_GRANDE' | 'INTEIRO';
  referencia: string;
  avaliacao: Avaliacao | null;
  pontos: number;
  peso: number;
  explicacao: string;
}

interface AnaliseFii {
  nota: number | null;
  faixa: 'BOA' | 'ATENCAO' | 'FRACA' | null;
  indicadores: IndicadorFii[];
  pesoConsiderado: number;
  dataCvm: string | null;
}

// A B3 informa desdobramento e bonificação como aumento percentual de cotas: 900% = cada cota virou 10.
function descreverFator(tipo: string, fator: number): string {
  if (/DESDOBR|BONIFIC/.test(tipo)) {
    const vezes = 1 + fator / 100;
    return `+${fator.toLocaleString('pt-BR')}%: cada cota virou ${vezes.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}`;
  }
  return `fator ${fator.toLocaleString('pt-BR')}`;
}

function valorDoIndicador(i: IndicadorFii): string {
  if (i.valor === null) return 'sem dado';
  if (i.formato === 'PERCENTUAL') return `${i.valor > 0 && i.chave !== 'dy' ? '+' : ''}${i.valor.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
  if (i.formato === 'REAIS_GRANDE') return grande(i.valor);
  if (i.formato === 'REAIS') return formatarReais(i.valor);
  return i.valor.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

const ROTULO_AVALIACAO: Record<Avaliacao, { texto: string; cor: 'verde' | 'amarelo' | 'vermelho' }> = {
  BOM: { texto: 'Bom', cor: 'verde' },
  ATENCAO: { texto: 'Atenção', cor: 'amarelo' },
  RUIM: { texto: 'Fraco', cor: 'vermelho' },
};

// Nota de 0 a 100 e a tabela dos indicadores, cada um com a faixa considerada boa e os pontos que valeu.
function NotaDoFundo({ analise }: { analise: AnaliseFii }) {
  const classeNota =
    analise.faixa === 'BOA' ? 'fb3-nota-boa' : analise.faixa === 'ATENCAO' ? 'fb3-nota-atencao' : analise.faixa === 'FRACA' ? 'fb3-nota-fraca' : '';
  const textoFaixa =
    analise.faixa === 'BOA' ? 'Indicadores bons' : analise.faixa === 'ATENCAO' ? 'Atenção a alguns pontos' : analise.faixa === 'FRACA' ? 'Indicadores fracos' : 'Sem dados suficientes';
  const colunas: ColunaTabela<IndicadorFii>[] = [
    {
      titulo: 'Indicador',
      celula: (i) => (
        <span className="fb3-ind-nome">
          <strong>{i.nome}</strong>
          <span className="fin-suave">{i.explicacao}</span>
        </span>
      ),
    },
    { titulo: 'Valor', alinhar: 'direita', celula: (i) => <strong>{valorDoIndicador(i)}</strong> },
    { titulo: 'Bom quando', celula: (i) => i.referencia },
    {
      titulo: 'Avaliação',
      celula: (i) => (i.avaliacao ? <Selo cor={ROTULO_AVALIACAO[i.avaliacao].cor}>{ROTULO_AVALIACAO[i.avaliacao].texto}</Selo> : '—'),
    },
    {
      titulo: 'Pontos',
      alinhar: 'direita',
      celula: (i) => (i.avaliacao ? `${i.pontos.toLocaleString('pt-BR')} de ${i.peso}` : `— de ${i.peso}`),
    },
  ];
  return (
    <section className="fb3-secao">
      <div className="fb3-nota">
        <div className={`fb3-nota-numero ${classeNota}`}>
          <strong>{analise.nota ?? '—'}</strong>
          <span>de 100</span>
        </div>
        <div className="fb3-nota-texto">
          <strong>{textoFaixa}</strong>
          <span className="fin-suave">
            Nota pelos indicadores abaixo: cada um vale pontos conforme a faixa em que está, com o peso indicado.
            {analise.pesoConsiderado < 100 && ` Só ${analise.pesoConsiderado} dos 100 pontos tinham dado; a nota é proporcional a eles.`}
            {analise.dataCvm && ` Patrimônio e cotistas: informe da CVM de ${analise.dataCvm.split('-').reverse().join('/')}.`}
          </span>
          <span className="fin-suave">
            A nota é só uma leitura dos números: não avalia os imóveis, os inquilinos nem os créditos, e não é recomendação de compra ou venda.
          </span>
        </div>
      </div>
      <Tabela<IndicadorFii> chave={(i) => i.chave} dados={analise.indicadores} colunas={colunas} />
    </section>
  );
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
  cvm: {
    cnpj: string;
    nome: string;
    segmento: string | null;
    mandato: string | null;
    tipoGestao: string | null;
    administrador: string | null;
  } | null;
  analise: AnaliseFii | null;
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
    <Modal aberto={codigo !== null} titulo={codigo ? `${codigo} na B3` : ''} aoFechar={aoFechar} largo>
      <div className="fb3">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {carregando && !ficha && !erro && <Carregando />}
        {ficha && (
          <>
            <div className="fb3-cabecalho">
              <strong>{ficha.cvm?.nome || ficha.fundo.nomePregao || ficha.fundo.codigo}</strong>
              <span className="fin-suave">
                {[
                  ficha.cvm?.segmento && `Segmento: ${ficha.cvm.segmento}`,
                  ficha.cvm?.tipoGestao && `Gestão ${ficha.cvm.tipoGestao.toLowerCase()}`,
                  ficha.cvm?.administrador && `Administrador: ${ficha.cvm.administrador}`,
                  ficha.cvm?.cnpj && `CNPJ ${ficha.cvm.cnpj}`,
                  ficha.fundo.escriturador && `Escriturador: ${ficha.fundo.escriturador}`,
                  ficha.fundo.listadoDesde && `Listado desde ${formatarDia(ficha.fundo.listadoDesde)}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </div>

            {ficha.analise && <NotaDoFundo analise={ficha.analise} />}

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
                      {e.fator !== null && ` (${descreverFator(e.tipo, e.fator)})`}
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
