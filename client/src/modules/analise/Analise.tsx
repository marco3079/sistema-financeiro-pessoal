import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  COR_TIPO_INVESTIMENTO,
  TIPOS_INVESTIMENTO,
  formatarPercentual,
  formatarReais,
  rotuloDe,
  rotuloMes,
} from '../../lib/financas';
import { useDados } from '../../lib/useDados';
import { Abas, Aviso, Cartao, Carregando, Pagina, Selecao, Selo, Tabela } from '../../ui';
import { NomeComCor, ResumoItem, Rosca, Vazio } from '../../ui/financas';
import type { Fatia } from '../../ui/financas';
import type { AnaliseDTO, AreaSugestao, CategoriaAnalise, MesAnalise, Sugestao } from './tipos';
import './analise.css';

const PERIODOS = [
  { valor: '3', rotulo: '3 meses' },
  { valor: '6', rotulo: '6 meses' },
  { valor: '12', rotulo: '12 meses' },
  { valor: '24', rotulo: '24 meses' },
];

const ABAS_AREA: { id: AreaSugestao; rotulo: string }[] = [
  { id: 'GASTOS', rotulo: 'Gastos' },
  { id: 'RECEITAS', rotulo: 'Receitas' },
  { id: 'INVESTIMENTOS', rotulo: 'Investimentos' },
];

const SELO_TOM: Record<Sugestao['tom'], { rotulo: string; cor: 'amarelo' | 'azul' | 'verde' }> = {
  alerta: { rotulo: 'Atenção', cor: 'amarelo' },
  dica: { rotulo: 'Sugestão', cor: 'azul' },
  bom: { rotulo: 'Bom sinal', cor: 'verde' },
};

const COR_OUTRAS = '#64748b';
const MAX_FATIAS_CATEGORIA = 8;
const ALTURA_MAX_BARRA = 150; // px; a coluna do gráfico tem 200 px e sobra espaço para o rótulo do mês

// Altura em px de uma barra; valor positivo nunca fica com menos de 2 px.
function alturaDaBarra(valor: number, maximo: number): number {
  if (valor <= 0 || maximo <= 0) return 0;
  return Math.max(2, Math.round((valor / maximo) * ALTURA_MAX_BARRA));
}

// Top categorias na rosca; o resto vira "Outras".
function fatiasDeCategorias(categorias: CategoriaAnalise[]): Fatia[] {
  const fatias: Fatia[] = categorias
    .slice(0, MAX_FATIAS_CATEGORIA)
    .map((c) => ({ rotulo: c.nome, valor: c.total, cor: c.cor }));
  const resto = categorias.slice(MAX_FATIAS_CATEGORIA).reduce((soma, c) => soma + c.total, 0);
  if (resto > 0) fatias.push({ rotulo: 'Outras', valor: resto, cor: COR_OUTRAS });
  return fatias;
}

function formatarNumero(n: number): string {
  return n.toLocaleString('pt-BR');
}

function textoVariacao(variacao: number | null): string {
  if (variacao === null) return '—';
  return (variacao > 0 ? '+' : '') + formatarNumero(variacao) + '%';
}

export function Analise() {
  const [meses, setMeses] = useState(12);
  const [area, setArea] = useState<AreaSugestao>('GASTOS');
  const { dados, carregando, erro } = useDados<AnaliseDTO>('/analise?meses=' + meses);

  const seletorPeriodo = (
    <Selecao
      rotulo="Período"
      valor={String(meses)}
      aoMudar={(valor) => setMeses(Number(valor))}
      opcoes={PERIODOS}
    />
  );

  if (!dados) {
    return (
      <Pagina titulo="Análise" acoes={seletorPeriodo}>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {carregando && <Carregando />}
      </Pagina>
    );
  }

  const listaMeses: MesAnalise[] = dados.meses ?? [];
  const sugestoes: Sugestao[] = dados.sugestoes ?? [];
  const contagemDe = (a: AreaSugestao) => sugestoes.filter((s) => s.area === a).length;
  const sugestoesDaArea = sugestoes.filter((s) => s.area === area);

  const maiorValorDoGrafico = Math.max(0, ...listaMeses.flatMap((m) => [m.receitas, m.despesas]));
  const semLancamentos = listaMeses.every((m) => m.receitas === 0 && m.despesas === 0);

  const despesasPorCategoria = dados.despesasPorCategoria ?? [];
  const receitasPorCategoria = dados.receitasPorCategoria ?? [];
  const investimentos = dados.investimentos;
  const classesInvestimento = investimentos.classes ?? [];

  return (
    <Pagina titulo="Análise" acoes={seletorPeriodo}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {carregando && <Carregando />}

      <div className="resumo">
        <ResumoItem
          icone="seta-cima"
          cor="verde"
          valor={formatarReais(dados.resumo.receitaMedia)}
          rotulo="Receita média por mês"
        />
        <ResumoItem
          icone="seta-baixo"
          cor="vermelho"
          valor={formatarReais(dados.resumo.despesaMedia)}
          rotulo="Gasto médio por mês"
        />
        <ResumoItem
          icone="financeiro"
          cor="azul"
          valor={dados.resumo.sobraMedia === null ? '—' : formatarReais(dados.resumo.sobraMedia)}
          rotulo="Sobra média por mês"
        />
        <ResumoItem
          icone="metas"
          cor="roxo"
          valor={dados.resumo.taxaDePoupanca === null ? '—' : formatarNumero(dados.resumo.taxaDePoupanca) + '%'}
          rotulo="Do que entra, você guarda"
        />
      </div>

      <Cartao titulo="Sugestões">
        <Abas
          abas={ABAS_AREA.map((a) => ({ id: a.id, rotulo: `${a.rotulo} (${contagemDe(a.id)})` }))}
          ativa={area}
          aoMudar={(id) => setArea(id as AreaSugestao)}
        />
        {sugestoesDaArea.length === 0 ? (
          <p className="analise-suave">Nenhuma sugestão por enquanto.</p>
        ) : (
          <ul className="analise-lista">
            {sugestoesDaArea.map((s, i) => (
              <li key={i} className={`analise-sugestao analise-sugestao-${s.tom}`}>
                <div>
                  <Selo cor={SELO_TOM[s.tom].cor}>{SELO_TOM[s.tom].rotulo}</Selo>
                </div>
                <strong>{s.titulo}</strong>
                <p>{s.texto}</p>
                {s.caminho !== null && s.acao !== null && <Link to={s.caminho}>{s.acao}</Link>}
              </li>
            ))}
          </ul>
        )}
      </Cartao>

      {semLancamentos ? (
        <Vazio
          icone="transacoes"
          titulo="Ainda não há lançamentos"
          texto="Importe a fatura do cartão e o extrato da conta para ver a análise."
        />
      ) : (
        <>
          <Cartao titulo="Receitas e gastos por mês">
            <div className="analise-barras">
              {listaMeses.map((m) => {
                const rotulo = rotuloMes(m.mes);
                const resumoTexto = `Receitas ${formatarReais(m.receitas)} · Gastos ${formatarReais(m.despesas)} · Saldo ${formatarReais(m.saldo)}`;
                return (
                  <div key={m.mes} className="analise-grupo" title={`${rotulo}: ${resumoTexto}`}>
                    <div className="analise-colunas" aria-hidden="true">
                      <span
                        className="analise-barra analise-barra-receita"
                        style={{ height: alturaDaBarra(m.receitas, maiorValorDoGrafico) }}
                      />
                      <span
                        className="analise-barra analise-barra-despesa"
                        style={{ height: alturaDaBarra(m.despesas, maiorValorDoGrafico) }}
                      />
                    </div>
                    <span className="analise-rotulo-mes" aria-hidden="true">
                      {rotulo.slice(0, 3)}
                    </span>
                    <span className="analise-sr">{`${rotulo}. ${resumoTexto}`}</span>
                  </div>
                );
              })}
            </div>
            <ul className="analise-legenda" aria-hidden="true">
              <li>
                <span className="analise-cor analise-barra-receita" />
                Receitas
              </li>
              <li>
                <span className="analise-cor analise-barra-despesa" />
                Gastos
              </li>
            </ul>
            <div style={{ marginTop: '1rem' }}>
              <Tabela<MesAnalise>
                chave={(m) => m.mes}
                dados={[...listaMeses].reverse()}
                colunas={[
                  { titulo: 'Mês', celula: (m) => rotuloMes(m.mes) },
                  { titulo: 'Receitas', alinhar: 'direita', celula: (m) => formatarReais(m.receitas) },
                  { titulo: 'Gastos', alinhar: 'direita', celula: (m) => formatarReais(m.despesas) },
                  {
                    titulo: 'Saldo',
                    alinhar: 'direita',
                    celula: (m) => (
                      <span className={m.saldo >= 0 ? 'analise-positivo' : 'analise-negativo'}>
                        {formatarReais(m.saldo)}
                      </span>
                    ),
                  },
                ]}
              />
            </div>
          </Cartao>

          <div className="fin-duas-colunas">
            <Cartao titulo="Gastos por categoria">
              {despesasPorCategoria.length > 0 && <Rosca fatias={fatiasDeCategorias(despesasPorCategoria)} />}
              <Tabela<CategoriaAnalise>
                chave={(c) => c.id ?? 'sem-categoria'}
                dados={despesasPorCategoria}
                colunas={[
                  {
                    titulo: 'Categoria',
                    celula: (c) => <NomeComCor cor={c.cor}>{c.nome}</NomeComCor>,
                  },
                  { titulo: 'Total', alinhar: 'direita', celula: (c) => formatarReais(c.total) },
                  { titulo: '%', alinhar: 'direita', celula: (c) => formatarPercentual(c.parte) },
                  { titulo: 'Média/mês', alinhar: 'direita', celula: (c) => formatarReais(c.mediaMensal) },
                  { titulo: 'Último mês fechado', alinhar: 'direita', celula: (c) => formatarReais(c.naReferencia) },
                  {
                    titulo: 'Variação',
                    alinhar: 'direita',
                    celula: (c) => (
                      <span
                        className={
                          c.variacao === null ? undefined : c.variacao > 0 ? 'analise-negativo' : c.variacao < 0 ? 'analise-positivo' : undefined
                        }
                      >
                        {textoVariacao(c.variacao)}
                      </span>
                    ),
                  },
                ]}
              />
            </Cartao>

            <Cartao titulo="Receitas por categoria">
              {receitasPorCategoria.length === 0 ? (
                <p className="analise-suave">Nenhuma receita no período. Importe o extrato da conta em Importar.</p>
              ) : (
                <>
                  <Rosca fatias={fatiasDeCategorias(receitasPorCategoria)} />
                  <Tabela<CategoriaAnalise>
                    chave={(c) => c.id ?? 'sem-categoria'}
                    dados={receitasPorCategoria}
                    colunas={[
                      {
                        titulo: 'Categoria',
                        celula: (c) => <NomeComCor cor={c.cor}>{c.nome}</NomeComCor>,
                      },
                      { titulo: 'Total', alinhar: 'direita', celula: (c) => formatarReais(c.total) },
                      { titulo: '%', alinhar: 'direita', celula: (c) => formatarPercentual(c.parte) },
                      { titulo: 'Média/mês', alinhar: 'direita', celula: (c) => formatarReais(c.mediaMensal) },
                    ]}
                  />
                </>
              )}
            </Cartao>
          </div>

          <div className="fin-duas-colunas">
            <Cartao titulo="Onde você mais gasta">
              <Tabela
                chave={(g) => g.descricao}
                dados={dados.maioresGastos ?? []}
                colunas={[
                  { titulo: 'Estabelecimento', celula: (g) => g.descricao },
                  { titulo: 'Compras', alinhar: 'direita', celula: (g) => formatarNumero(g.vezes) },
                  { titulo: 'Total', alinhar: 'direita', celula: (g) => formatarReais(g.total) },
                ]}
              />
            </Cartao>

            <Cartao titulo="Gastos que se repetem">
              <p className="analise-suave">
                Mesma descrição em 3 meses ou mais, com valor parecido: assinaturas e mensalidades. Somam{' '}
                {formatarReais(dados.resumo.recorrenteMensal)} por mês.
              </p>
              <Tabela
                chave={(r) => r.descricao}
                dados={dados.recorrentes ?? []}
                vazio="Nenhum gasto repetido encontrado."
                colunas={[
                  { titulo: 'Descrição', celula: (r) => r.descricao },
                  { titulo: 'Meses', alinhar: 'direita', celula: (r) => formatarNumero(r.meses) },
                  { titulo: 'Por mês', alinhar: 'direita', celula: (r) => formatarReais(r.valorMensal) },
                ]}
              />
            </Cartao>
          </div>
        </>
      )}

      <Cartao titulo="Investimentos e reserva">
        <div className="resumo">
          <ResumoItem icone="investimentos" cor="roxo" valor={formatarReais(investimentos.saldo)} rotulo="Investido" />
          <ResumoItem icone="contas" cor="azul" valor={formatarReais(investimentos.emConta)} rotulo="Em conta" />
          <ResumoItem
            icone="financeiro"
            cor="verde"
            valor={formatarReais(investimentos.proventosMensais)}
            rotulo="Proventos por mês"
          />
          <ResumoItem
            icone="metas"
            cor="laranja"
            valor={
              investimentos.mesesDeReserva === null || investimentos.emConta <= 0
                ? '—'
                : formatarNumero(investimentos.mesesDeReserva) + (investimentos.mesesDeReserva === 1 ? ' mês' : ' meses')
            }
            rotulo="Reserva (meses de gastos)"
          />
        </div>

        {classesInvestimento.length === 0 ? (
          <p className="analise-suave">Nenhum investimento cadastrado.</p>
        ) : (
          <Rosca
            fatias={classesInvestimento.map((c) => ({
              rotulo: rotuloDe(TIPOS_INVESTIMENTO, c.tipo),
              valor: c.saldo,
              cor: COR_TIPO_INVESTIMENTO[c.tipo],
            }))}
          />
        )}

        <p className="analise-investimentos-acoes">
          <Link to="/app/rendimento">Comparar com Selic, IPCA, Ibovespa e IFIX</Link>
        </p>
      </Cartao>
    </Pagina>
  );
}
