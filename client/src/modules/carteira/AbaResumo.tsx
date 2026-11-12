import { useState } from 'react';
import { Abas, Cartao, Tabela } from '../../ui';
import { ResumoItem } from '../../ui/financas';
import { CORES_SERIE, GraficoBarras, GraficoLinhas } from '../../ui/graficos';
import type { SerieGrafico } from '../../ui/graficos';
import { formatarDia, formatarReais } from '../../lib/financas';
import { classeDoSinal, diaCurto, mesCurto, pct } from './tipos';
import type { CarteiraDTO } from './tipos';
import './abas-resumo-analises.css';

type Instituicao = CarteiraDTO['instituicoes'][number];
type Visao = 'mercado' | 'instituicoes';
type VisaoHistorico = 'patrimonio' | 'rentabilidade';

const VISOES: { id: Visao; rotulo: string }[] = [
  { id: 'mercado', rotulo: 'Mercado' },
  { id: 'instituicoes', rotulo: 'Instituições' },
];

const VISOES_HISTORICO: { id: VisaoHistorico; rotulo: string }[] = [
  { id: 'patrimonio', rotulo: 'Patrimônio' },
  { id: 'rentabilidade', rotulo: 'Rentabilidade' },
];

// Opacidade decrescente dos blocos de distribuição, por posição (o maior fica cheio).
const OPACIDADES = [1, 0.75, 0.55, 0.4];

const eixoPct = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';
const eixoReais = (v: number) =>
  Math.abs(v) >= 1000 ? 'R$ ' + (v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil' : formatarReais(v);

function seriesDiario(d: CarteiraDTO['diario']): SerieGrafico[] {
  return [
    { nome: 'Carteira', cor: CORES_SERIE.carteira, valores: d.carteira },
    { nome: 'CDI', cor: CORES_SERIE.cdi, valores: d.cdi },
    { nome: 'Ibovespa', cor: CORES_SERIE.ibov, valores: d.ibov },
    { nome: 'IPCA', cor: CORES_SERIE.ipca, valores: d.ipca },
    { nome: 'IFIX', cor: CORES_SERIE.ifix, valores: d.ifix },
  ];
}

function sinalDe(valor: number): string {
  return valor < 0 ? '-' : '+';
}

// Blocos proporcionais (mercado ou instituição) com a parte e o saldo de cada um.
function MapaBlocos({ itens }: { itens: { chave: string; rotulo: string; parte: number; saldo: number }[] }) {
  if (itens.length === 0) return <p className="cart-suave">Sem dados para esta visão.</p>;
  return (
    <div className="resumo-blocos">
      {itens.map((item, i) => {
        const cheio = i === 0;
        const opacidade = OPACIDADES[i] ?? OPACIDADES[OPACIDADES.length - 1];
        return (
          <div
            key={item.chave}
            className={cheio ? 'resumo-bloco resumo-bloco-cheio' : 'resumo-bloco'}
            style={{
              flexGrow: Math.max(item.parte, 4),
              background: cheio ? 'var(--cor-primaria)' : `color-mix(in srgb, var(--cor-primaria) ${opacidade * 100}%, transparent)`,
            }}
          >
            <strong>{item.rotulo}</strong>
            <span>
              {item.parte.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% · {formatarReais(item.saldo)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// Desempenho no mês: três valores grandes e barras comparando os três (negativos para a esquerda).
function DesempenhoMes({ dados }: { dados: CarteiraDTO }) {
  const { resumo } = dados;
  const itens = [
    { rotulo: 'Carteira', valor: resumo.rentabilidadeNoMes, cor: CORES_SERIE.carteira },
    { rotulo: 'CDI', valor: resumo.cdiNoMes, cor: CORES_SERIE.cdi },
    { rotulo: 'Ibovespa', valor: resumo.ibovNoMes, cor: CORES_SERIE.ibov },
  ];
  const maiorAbsoluto = Math.max(0, ...itens.map((i) => (i.valor === null ? 0 : Math.abs(i.valor))));

  return (
    <>
      <div className="resumo-desempenho">
        {itens.map((i) => (
          <div key={i.rotulo} className="resumo-desempenho-item">
            <span className="cart-suave">{i.rotulo}</span>
            <strong className={classeDoSinal(i.valor)}>{pct(i.valor)}</strong>
          </div>
        ))}
      </div>
      <div className="resumo-barras">
        {itens.map((i) => {
          const largura = i.valor === null || maiorAbsoluto === 0 ? 2 : Math.max(2, (Math.abs(i.valor) / maiorAbsoluto) * 100);
          const negativo = i.valor !== null && i.valor < 0;
          return (
            <div key={i.rotulo} className="resumo-barra-linha">
              <span className="cart-suave">{i.rotulo}</span>
              <div className="resumo-trilho">
                {i.valor !== null && (
                  <span
                    className={negativo ? 'resumo-barra resumo-barra-esquerda' : 'resumo-barra resumo-barra-direita'}
                    style={{ width: `${largura}%`, background: i.cor }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
      {resumo.percentualDoCdiNoMes !== null && (
        <p className="cart-suave">
          A carteira rendeu {resumo.percentualDoCdiNoMes.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% do CDI no mês.
        </p>
      )}
      <p className={`cart-suave ${classeDoSinal(resumo.ganhoDeCapital)}`}>
        Ganho de capital desde a compra: {sinalDe(resumo.ganhoDeCapital)}
        {formatarReais(Math.abs(resumo.ganhoDeCapital))}
      </p>
    </>
  );
}

export function AbaResumo({ dados }: { dados: CarteiraDTO }): JSX.Element {
  const [visao, setVisao] = useState<Visao>('mercado');
  const [visaoHistorico, setVisaoHistorico] = useState<VisaoHistorico>('patrimonio');
  const { resumo } = dados;

  const blocosMercado = dados.classes.map((c) => ({ chave: c.chave, rotulo: c.rotulo, parte: c.parte, saldo: c.saldo }));
  const blocosInstituicoes = dados.instituicoes.map((i) => ({ chave: i.nome, rotulo: i.nome, parte: i.parte, saldo: i.saldo }));

  return (
    <>
      <div className="resumo">
        <ResumoItem icone="investimentos" cor="azul" valor={formatarReais(resumo.saldo)} rotulo="Patrimônio" />
        <ResumoItem icone="financeiro" cor="roxo" valor={pct(resumo.rentabilidadeNoMes)} rotulo="Rentabilidade no mês" />
        <ResumoItem
          icone={resumo.ganhoDeCapitalNoMes >= 0 ? 'seta-cima' : 'seta-baixo'}
          cor={resumo.ganhoDeCapitalNoMes >= 0 ? 'verde' : 'vermelho'}
          valor={sinalDe(resumo.ganhoDeCapitalNoMes) + formatarReais(Math.abs(resumo.ganhoDeCapitalNoMes))}
          rotulo="Ganho de capital no mês"
        />
        <ResumoItem icone="transacoes" cor="laranja" valor={formatarReais(resumo.proventos)} rotulo="Proventos recebidos" />
      </div>

      <div className="cart-dupla">
        <Cartao titulo="Desempenho no mês">
          <DesempenhoMes dados={dados} />
        </Cartao>

        <Cartao titulo="Distribuição">
          <Abas abas={VISOES} ativa={visao} aoMudar={(id) => {
            const v = VISOES.find((x) => x.id === id);
            if (v) setVisao(v.id);
          }} />
          <MapaBlocos itens={visao === 'mercado' ? blocosMercado : blocosInstituicoes} />
        </Cartao>
      </div>

      <Cartao titulo="Histórico">
        <Abas abas={VISOES_HISTORICO} ativa={visaoHistorico} aoMudar={(id) => {
          const v = VISOES_HISTORICO.find((x) => x.id === id);
          if (v) setVisaoHistorico(v.id);
        }} />
        {visaoHistorico === 'patrimonio' ? (
          <GraficoLinhas
            area
            rotulos={dados.mensal.map((m) => mesCurto(m.mes))}
            series={[{ nome: 'Patrimônio', cor: CORES_SERIE.carteira, valores: dados.mensal.map((m) => m.patrimonio) }]}
            formato={eixoReais}
            descricao="Patrimônio da carteira mês a mês"
          />
        ) : (
          <>
            <GraficoLinhas
              rotulos={dados.diario.datas.map(diaCurto)}
              series={seriesDiario(dados.diario)}
              formato={eixoPct}
              descricao="Rentabilidade acumulada da carteira e dos indicadores, dia a dia"
            />
            <p className="cart-suave">Rentabilidade acumulada desde {formatarDia(dados.periodo.inicio)}, com proventos.</p>
          </>
        )}
      </Cartao>

      <Cartao titulo="Por instituição">
        <Tabela<Instituicao>
          colunas={[
            { titulo: 'Instituição', celula: (i) => i.nome },
            { titulo: 'Patrimônio', alinhar: 'direita', celula: (i) => formatarReais(i.saldo) },
            {
              titulo: 'Peso na carteira',
              alinhar: 'direita',
              celula: (i) => i.parte.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%',
            },
            { titulo: 'Mês', alinhar: 'direita', celula: (i) => <span className={classeDoSinal(i.mes)}>{pct(i.mes)}</span> },
            { titulo: 'Ano', alinhar: 'direita', celula: (i) => <span className={classeDoSinal(i.ano)}>{pct(i.ano)}</span> },
            { titulo: 'Acumulada', alinhar: 'direita', celula: (i) => <span className={classeDoSinal(i.acumulada)}>{pct(i.acumulada)}</span> },
          ]}
          dados={dados.instituicoes}
          chave={(i) => i.nome}
        />
      </Cartao>

      <Cartao titulo="Ganho de capital por mês">
        <GraficoBarras
          rotulos={dados.mensal.map((m) => mesCurto(m.mes))}
          series={[{ nome: 'Ganho de capital', cor: CORES_SERIE.carteira, valores: dados.mensal.map((m) => m.ganhoDeCapital) }]}
          formato={eixoReais}
          descricao="Ganho de capital da carteira por mês"
        />
        <p className="cart-suave">Variação do valor dos ativos em cada mês, sem contar aplicações, resgates e proventos.</p>
      </Cartao>
    </>
  );
}
