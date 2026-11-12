import { Fragment, useState } from 'react';
import { Botao, Campo, Cartao, Tabela } from '../../ui';
import type { ColunaTabela } from '../../ui';
import { Rosca } from '../../ui/financas';
import type { Fatia } from '../../ui/financas';
import { CORES_SERIE, GraficoLinhas } from '../../ui/graficos';
import type { SerieGrafico } from '../../ui/graficos';
import { CORES_PALETA, formatarDia, formatarReais } from '../../lib/financas';
import { classeDoSinal, mesCurto, pct } from './tipos';
import type { CarteiraDTO } from './tipos';
import './aba-relatorio.css';

type Mes = CarteiraDTO['mensal'][number];
type Ativo = CarteiraDTO['ativos'][number];
type Instituicao = CarteiraDTO['instituicoes'][number];

const TAMANHO_PAGINA = 10;
const NOMES_MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

// Percentual sem sinal de mais (tabela de meses).
function semSinal(valor: number | null | undefined): string {
  if (valor === null || valor === undefined) return '—';
  return valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
}

function percentualDaParte(valor: number): string {
  return valor.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + '%';
}

function formatoGrafico(valor: number): string {
  return valor.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
}

// Acumulado de um índice mês a mês, em %: começa em 1 e multiplica pelo fator de cada mês (nulo conta como zero).
function acumularIndice(mensal: Mes[], escolher: (m: Mes) => number | null): number[] {
  let fator = 1;
  return mensal.map((m) => {
    fator *= 1 + (escolher(m) ?? 0) / 100;
    return (fator - 1) * 100;
  });
}

function Numero({ rotulo, valor, classe }: { rotulo: string; valor: string; classe?: string }) {
  return (
    <div className="relatorio-faixa-item">
      <span className="relatorio-faixa-rotulo">{rotulo}</span>
      <strong className={classe ? `relatorio-faixa-valor ${classe}` : 'relatorio-faixa-valor'}>{valor}</strong>
    </div>
  );
}

function Valor({ rotulo, valor }: { rotulo: string; valor: number | null }) {
  return (
    <span className="relatorio-valor">
      <span className="relatorio-valor-rotulo">{rotulo}</span>
      <span className={classeDoSinal(valor)}>{pct(valor)}</span>
    </span>
  );
}

export function AbaRelatorio({ dados }: { dados: CarteiraDTO }) {
  const [busca, setBusca] = useState('');
  const [pagina, setPagina] = useState(1);

  const { resumo, periodo, periodos, mensal, anual, estatisticas, classes, instituicoes, ativos } = dados;

  // Gráfico: carteira em %, índices acumulados a partir dos meses.
  const rotulos = mensal.map((m) => mesCurto(m.mes));
  const series: SerieGrafico[] = [
    { nome: 'Carteira', cor: CORES_SERIE.carteira, valores: mensal.map((m) => m.acumulado) },
    { nome: 'CDI', cor: CORES_SERIE.cdi, valores: acumularIndice(mensal, (m) => m.cdi) },
    { nome: 'Ibovespa', cor: CORES_SERIE.ibov, valores: acumularIndice(mensal, (m) => m.ibov) },
    { nome: 'IPCA', cor: CORES_SERIE.ipca, valores: acumularIndice(mensal, (m) => m.ipca) },
    { nome: 'IFIX', cor: CORES_SERIE.ifix, valores: acumularIndice(mensal, (m) => m.ifix) },
  ];

  // Tabela de meses: um bloco por ano, do mais recente para o mais antigo.
  const porMes = new Map(mensal.map((m) => [m.mes, m] as const));
  const anos = Array.from(new Set(mensal.map((m) => Number(m.mes.slice(0, 4))))).sort((a, b) => b - a);

  // Meus ativos: busca, paginação de 10 em 10.
  const termo = busca.trim().toLowerCase();
  const filtrados = termo
    ? ativos.filter((a) => (a.codigo ?? '').toLowerCase().includes(termo) || a.nome.toLowerCase().includes(termo))
    : ativos;
  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / TAMANHO_PAGINA));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const inicio = (paginaAtual - 1) * TAMANHO_PAGINA;
  const visiveis = filtrados.slice(inicio, inicio + TAMANHO_PAGINA);

  const fatiasClasses: Fatia[] = classes.map((c, i) => ({
    rotulo: c.rotulo,
    valor: c.saldo,
    cor: CORES_PALETA[i % CORES_PALETA.length],
  }));
  const fatiasInstituicoes: Fatia[] = instituicoes.map((i, idx) => ({
    rotulo: i.nome,
    valor: i.saldo,
    cor: CORES_PALETA[idx % CORES_PALETA.length],
  }));

  const colunasInstituicoes: ColunaTabela<Instituicao>[] = [
    { titulo: 'Instituição', celula: (i) => i.nome },
    { titulo: 'Patrimônio', alinhar: 'direita', celula: (i) => formatarReais(i.saldo) },
    { titulo: 'Peso na carteira', alinhar: 'direita', celula: (i) => percentualDaParte(i.parte) },
    { titulo: 'Mês', alinhar: 'direita', celula: (i) => <span className={classeDoSinal(i.mes)}>{pct(i.mes)}</span> },
    { titulo: 'Ano', alinhar: 'direita', celula: (i) => <span className={classeDoSinal(i.ano)}>{pct(i.ano)}</span> },
    { titulo: 'Acumulada', alinhar: 'direita', celula: (i) => <span className={classeDoSinal(i.acumulada)}>{pct(i.acumulada)}</span> },
  ];

  const colunasAtivos: ColunaTabela<Ativo>[] = [
    {
      titulo: 'Ativo',
      celula: (a) => (
        <>
          <strong>{a.codigo ?? a.nome}</strong>
          {a.codigo && <span className="cart-suave relatorio-ativo-nome">{a.nome}</span>}
        </>
      ),
    },
    { titulo: 'Classe', celula: (a) => a.classe },
    { titulo: 'Saldo', alinhar: 'direita', celula: (a) => formatarReais(a.saldo) },
    { titulo: 'Peso', alinhar: 'direita', celula: (a) => percentualDaParte(a.parte) },
    {
      titulo: 'Rent. acumulada',
      alinhar: 'direita',
      celula: (a) => <span className={classeDoSinal(a.rentabilidade)}>{pct(a.rentabilidade)}</span>,
    },
    {
      titulo: '% do CDI',
      alinhar: 'direita',
      celula: (a) =>
        a.percentualDoCdi === null
          ? '—'
          : a.percentualDoCdi.toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + '%',
    },
    { titulo: 'Preço médio', alinhar: 'direita', celula: (a) => (a.precoMedio === null ? '—' : formatarReais(a.precoMedio)) },
    { titulo: 'Preço atual', alinhar: 'direita', celula: (a) => (a.precoAtual === null ? '—' : formatarReais(a.precoAtual)) },
  ];

  return (
    <div className="relatorio">
      <div className="relatorio-acoes">
        <Botao variante="secundario" aoClicar={() => window.print()}>
          Imprimir ou salvar em PDF
        </Botao>
      </div>

      <div className="relatorio-faixa">
        <Numero rotulo="Saldo bruto" valor={formatarReais(resumo.saldo)} />
        <Numero
          rotulo="Ganho de capital"
          valor={(resumo.ganhoDeCapital > 0 ? '+' : '') + formatarReais(resumo.ganhoDeCapital)}
          classe={classeDoSinal(resumo.ganhoDeCapital)}
        />
        <Numero
          rotulo="Rentabilidade do início"
          valor={pct(resumo.rentabilidadeDoInicio)}
          classe={classeDoSinal(resumo.rentabilidadeDoInicio)}
        />
        <Numero rotulo="Ativos" valor={String(resumo.ativos)} />
      </div>

      <Cartao titulo="Rentabilidade geral">
        <GraficoLinhas
          rotulos={rotulos}
          series={series}
          formato={formatoGrafico}
          descricao="Rentabilidade acumulada da carteira, CDI, Ibovespa, IPCA e IFIX mês a mês"
        />
        <p className="cart-suave">Acumulado desde {formatarDia(periodo.inicio)}.</p>
      </Cartao>

      <div className="cart-dupla">
        <Cartao titulo="Rentabilidade por período">
          <ul className="relatorio-lista">
            {periodos.map((p) => (
              <li key={p.chave} className="relatorio-linha">
                <span className="relatorio-linha-rotulo">{p.rotulo}</span>
                <div className="relatorio-linha-valores">
                  <Valor rotulo="Carteira" valor={p.carteira} />
                  <Valor rotulo="CDI" valor={p.cdi} />
                  <Valor rotulo="IPCA" valor={p.ipca} />
                  <Valor rotulo="Ibovespa" valor={p.ibov} />
                </div>
              </li>
            ))}
          </ul>
        </Cartao>

        <Cartao titulo="Retornos e estatísticas">
          <dl className="relatorio-pares">
            <div className="relatorio-par">
              <dt>Meses positivos</dt>
              <dd>{estatisticas.mesesPositivos}</dd>
            </div>
            <div className="relatorio-par">
              <dt>Meses negativos</dt>
              <dd>{estatisticas.mesesNegativos}</dd>
            </div>
            <div className="relatorio-par">
              <dt>Meses acima do CDI</dt>
              <dd>{estatisticas.mesesAcimaDoCdi}</dd>
            </div>
            <div className="relatorio-par">
              <dt>Meses abaixo do CDI</dt>
              <dd>{estatisticas.mesesAbaixoDoCdi}</dd>
            </div>
            <div className="relatorio-par">
              <dt>Maior rentabilidade no mês</dt>
              <dd className={classeDoSinal(estatisticas.maior)}>{pct(estatisticas.maior)}</dd>
            </div>
            <div className="relatorio-par">
              <dt>Menor rentabilidade no mês</dt>
              <dd className={classeDoSinal(estatisticas.menor)}>{pct(estatisticas.menor)}</dd>
            </div>
            <div className="relatorio-par">
              <dt>Rentabilidade média por mês</dt>
              <dd className={classeDoSinal(estatisticas.media)}>{pct(estatisticas.media)}</dd>
            </div>
          </dl>
        </Cartao>
      </div>

      <div className="cart-dupla">
        <Cartao titulo="Divisão por mercado">
          <Rosca fatias={fatiasClasses} />
        </Cartao>
        <Cartao titulo="Divisão por instituição">
          <Rosca fatias={fatiasInstituicoes} />
        </Cartao>
      </div>

      <Cartao titulo="Rentabilidade por instituição">
        <Tabela colunas={colunasInstituicoes} dados={instituicoes} chave={(i) => i.nome} />
      </Cartao>

      <Cartao titulo="Rentabilidade bruta">
        <div className="relatorio-rolagem">
          <table className="relatorio-meses">
            <caption className="tabela-oculto-visual">Rentabilidade mensal da carteira e do CDI, por ano</caption>
            <thead>
              <tr>
                <th scope="col">Período</th>
                {NOMES_MESES.map((nome) => (
                  <th key={nome} scope="col">
                    {nome}
                  </th>
                ))}
                <th scope="col">No ano</th>
              </tr>
            </thead>
            <tbody>
              {anos.map((ano) => {
                const meses = NOMES_MESES.map((_, i) => porMes.get(`${ano}-${String(i + 1).padStart(2, '0')}`));
                const doAno = anual.find((a) => a.ano === ano);
                return (
                  <Fragment key={ano}>
                    <tr>
                      <th scope="row">{ano}</th>
                      {meses.map((m, i) => (
                        <td key={i} className={classeDoSinal(m?.carteira)}>
                          {semSinal(m?.carteira)}
                        </td>
                      ))}
                      <td className={classeDoSinal(doAno?.carteira)}>{semSinal(doAno?.carteira)}</td>
                    </tr>
                    <tr className="cart-suave">
                      <th scope="row">CDI</th>
                      {meses.map((m, i) => (
                        <td key={i}>{semSinal(m?.cdi)}</td>
                      ))}
                      <td>{semSinal(doAno?.cdi)}</td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Cartao>

      <Cartao titulo="Meus ativos">
        <Campo
          rotulo="Buscar ativo"
          valor={busca}
          aoMudar={(valor) => {
            setBusca(valor);
            setPagina(1);
          }}
        />
        <Tabela
          colunas={colunasAtivos}
          dados={visiveis}
          chave={(a) => a.id}
          vazio="Nenhum ativo encontrado."
        />
        {filtrados.length > 0 && (
          <div className="relatorio-paginas">
            <Botao variante="texto" desabilitado={paginaAtual <= 1} aoClicar={() => setPagina(paginaAtual - 1)}>
              Anterior
            </Botao>
            <span>
              {inicio + 1}–{inicio + visiveis.length} de {filtrados.length}
            </span>
            <Botao variante="texto" desabilitado={paginaAtual >= totalPaginas} aoClicar={() => setPagina(paginaAtual + 1)}>
              Próxima
            </Botao>
          </div>
        )}
      </Cartao>
    </div>
  );
}
