import { Abas, Cartao } from '../../ui';
import { CORES_SERIE, GraficoBarras, GraficoLinhas } from '../../ui/graficos';
import type { SerieGrafico } from '../../ui/graficos';
import { formatarDia, rotuloMes } from '../../lib/financas';
import { classeDoSinal, diaCurto, mesCurto, pct } from './tipos';
import type { CarteiraDTO, ClasseCarteira, Comparado } from './tipos';
import './abas-resumo-analises.css';

type Classe = 'TODAS' | ClasseCarteira;

const CLASSES: { id: Classe; rotulo: string }[] = [
  { id: 'TODAS', rotulo: 'Rentabilidade geral' },
  { id: 'RENDA_VARIAVEL', rotulo: 'Renda variável' },
  { id: 'FUNDOS', rotulo: 'Fundos' },
  { id: 'RENDA_FIXA', rotulo: 'Renda fixa' },
];

const PERIODOS_DESTAQUE = ['MES', 'SEIS_MESES', 'ANO'] as const;

const eixoPct = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';

// Cinco séries comparadas (carteira, CDI, Ibovespa, IPCA, IFIX) a partir de uma lista de períodos.
function seriesComparadas(lista: Comparado[]): SerieGrafico[] {
  return [
    { nome: 'Carteira', cor: CORES_SERIE.carteira, valores: lista.map((c) => c.carteira) },
    { nome: 'CDI', cor: CORES_SERIE.cdi, valores: lista.map((c) => c.cdi) },
    { nome: 'Ibovespa', cor: CORES_SERIE.ibov, valores: lista.map((c) => c.ibov) },
    { nome: 'IPCA', cor: CORES_SERIE.ipca, valores: lista.map((c) => c.ipca) },
    { nome: 'IFIX', cor: CORES_SERIE.ifix, valores: lista.map((c) => c.ifix) },
  ];
}

// Série diária com as mesmas cinco séries de seriesComparadas.
function seriesDiario(d: CarteiraDTO['diario']): SerieGrafico[] {
  return [
    { nome: 'Carteira', cor: CORES_SERIE.carteira, valores: d.carteira },
    { nome: 'CDI', cor: CORES_SERIE.cdi, valores: d.cdi },
    { nome: 'Ibovespa', cor: CORES_SERIE.ibov, valores: d.ibov },
    { nome: 'IPCA', cor: CORES_SERIE.ipca, valores: d.ipca },
    { nome: 'IFIX', cor: CORES_SERIE.ifix, valores: d.ifix },
  ];
}

// Cartão de um período: Carteira, CDI e Ibovespa lado a lado.
function CartaoPeriodo({ titulo, dados }: { titulo: string; dados: Comparado }) {
  const metricas: { rotulo: string; valor: number | null }[] = [
    { rotulo: 'Carteira', valor: dados.carteira },
    { rotulo: 'CDI', valor: dados.cdi },
    { rotulo: 'Ibovespa', valor: dados.ibov },
  ];
  return (
    <Cartao titulo={titulo}>
      <div className="analises-metricas">
        {metricas.map((m) => (
          <div key={m.rotulo} className="analises-metrica">
            <span className="cart-suave">{m.rotulo}</span>
            <strong className={classeDoSinal(m.valor)}>{pct(m.valor)}</strong>
          </div>
        ))}
      </div>
    </Cartao>
  );
}

// Bloco "pior / melhor": rótulo, valor (data, mês ou ano) e percentual.
function Destaque({
  tipo,
  rotulo,
  valor,
  percentual,
}: {
  tipo: 'bom' | 'ruim';
  rotulo: string;
  valor: string;
  percentual: number | null;
}) {
  return (
    <div className={tipo === 'bom' ? 'cart-destaque cart-destaque-bom' : 'cart-destaque cart-destaque-ruim'}>
      <span className="cart-destaque-rotulo">{rotulo}</span>
      <span className="cart-destaque-valor">{valor}</span>
      <strong className={classeDoSinal(percentual)}>{pct(percentual)}</strong>
    </div>
  );
}

export function AbaAnalises(props: {
  dados: CarteiraDTO;
  classe: 'TODAS' | ClasseCarteira;
  aoMudarClasse: (classe: 'TODAS' | ClasseCarteira) => void;
}): JSX.Element {
  const { dados, classe, aoMudarClasse } = props;
  const { extremos } = dados;
  const periodosDestaque = PERIODOS_DESTAQUE.map((chave) => dados.periodos.find((p) => p.chave === chave)).filter(
    (p): p is CarteiraDTO['periodos'][number] => p !== undefined
  );

  return (
    <>
      <Abas
        abas={CLASSES}
        ativa={classe}
        aoMudar={(id) => {
          const c = CLASSES.find((x) => x.id === id);
          if (c) aoMudarClasse(c.id);
        }}
      />

      {dados.resumo.ativos === 0 ? (
        <p className="cart-suave">Nenhum ativo desta classe na carteira.</p>
      ) : (
        <>
          <details className="analises-como">
            <summary>Como a rentabilidade é calculada</summary>
            <p>
              A rentabilidade mede só o desempenho dos ativos: valorização mais proventos recebidos. Aplicar ou resgatar dinheiro
              não muda o percentual. O preço de cada dia vem do fechamento da bolsa; ativos sem preço histórico (renda fixa,
              fundos) crescem de forma uniforme do valor aplicado até o saldo de hoje.
            </p>
          </details>

          <div className="cart-tripla">
            {periodosDestaque.map((p) => (
              <CartaoPeriodo key={p.chave} titulo={p.rotulo} dados={p} />
            ))}
          </div>

          <div className="cart-dupla">
            <Destaque
              tipo="ruim"
              rotulo="Pior dia"
              valor={extremos.piorDia ? formatarDia(extremos.piorDia.data) : '—'}
              percentual={extremos.piorDia ? extremos.piorDia.valor : null}
            />
            <Destaque
              tipo="bom"
              rotulo="Melhor dia"
              valor={extremos.melhorDia ? formatarDia(extremos.melhorDia.data) : '—'}
              percentual={extremos.melhorDia ? extremos.melhorDia.valor : null}
            />
          </div>

          <Cartao titulo="% por dia">
            <GraficoLinhas
              altura={320}
              rotulos={dados.diario.datas.map(diaCurto)}
              series={seriesDiario(dados.diario)}
              formato={eixoPct}
              descricao="Rentabilidade acumulada da carteira e dos indicadores, dia a dia"
            />
          </Cartao>

          <div className="cart-dupla">
            <Destaque
              tipo="ruim"
              rotulo="Pior mês"
              valor={extremos.piorMes ? rotuloMes(extremos.piorMes.mes) : '—'}
              percentual={extremos.piorMes ? extremos.piorMes.valor : null}
            />
            <Destaque
              tipo="bom"
              rotulo="Melhor mês"
              valor={extremos.melhorMes ? rotuloMes(extremos.melhorMes.mes) : '—'}
              percentual={extremos.melhorMes ? extremos.melhorMes.valor : null}
            />
          </div>

          <Cartao titulo="% por mês">
            <GraficoBarras
              rotulos={dados.mensal.map((m) => mesCurto(m.mes))}
              series={seriesComparadas(dados.mensal)}
              formato={eixoPct}
              descricao="Rentabilidade da carteira e dos indicadores por mês"
            />
          </Cartao>

          <div className="cart-dupla">
            <Destaque
              tipo="ruim"
              rotulo="Pior ano"
              valor={extremos.piorAno ? String(extremos.piorAno.ano) : '—'}
              percentual={extremos.piorAno ? extremos.piorAno.valor : null}
            />
            <Destaque
              tipo="bom"
              rotulo="Melhor ano"
              valor={extremos.melhorAno ? String(extremos.melhorAno.ano) : '—'}
              percentual={extremos.melhorAno ? extremos.melhorAno.valor : null}
            />
          </div>

          <Cartao titulo="% por ano">
            <GraficoBarras
              rotulos={dados.anual.map((a) => String(a.ano))}
              series={seriesComparadas(dados.anual)}
              formato={eixoPct}
              descricao="Rentabilidade da carteira e dos indicadores por ano"
            />
          </Cartao>
        </>
      )}
    </>
  );
}
