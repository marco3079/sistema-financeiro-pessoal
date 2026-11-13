import { useState } from 'react';
import type { CSSProperties } from 'react';
import {
  CORES_PALETA,
  formatarDia,
  formatarPercentual,
  formatarReais,
  hojeISO,
  rotuloMes,
  somarMeses,
} from '../../lib/financas';
import { useDados } from '../../lib/useDados';
import { Abas, Aviso, Botao, Campo, Cartao, Carregando, Selecao, Selo, Tabela } from '../../ui';
import { ResumoItem, Rosca, Vazio } from '../../ui/financas';
import type { Fatia } from '../../ui/financas';
import { CORES_SERIE, GraficoBarras } from '../../ui/graficos';
import { mesCurto } from './tipos';
import type { ItemAgenda, ProventosDTO } from './tipos';
import './aba-proventos.css';

type Visao = 'resumo' | 'agenda';

const ABAS: { id: Visao; rotulo: string }[] = [
  { id: 'resumo', rotulo: 'Resumo' },
  { id: 'agenda', rotulo: 'Agenda' },
];

const PERIODOS = [
  { valor: '12', rotulo: '12 meses' },
  { valor: '24', rotulo: '24 meses' },
  { valor: '60', rotulo: '5 anos' },
  { valor: '0', rotulo: 'Desde o início' },
];

const LINHAS_INICIAIS = 15;
const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MESES_MINUSCULOS = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

function duasCasas(valor: number): string {
  return valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// 850 -> 'R$ 850,00'; 1200 -> 'R$ 1,2 mil'.
function dinheiroCurto(valor: number): string {
  if (Math.abs(valor) < 1000) return formatarReais(valor);
  return `R$ ${(valor / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mil`;
}

// '2026-11-12' -> 12
function diaDaData(data: string): number {
  return Number(data.slice(8, 10));
}

// '2026-11-12' -> '12/11'
function diaMesCurto(data: string): string {
  return `${data.slice(8, 10)}/${data.slice(5, 7)}`;
}

function classes(...nomes: (string | false | null | undefined)[]): string {
  return nomes.filter(Boolean).join(' ');
}

export function AbaProventos() {
  const [visao, setVisao] = useState<Visao>('resumo');
  const [meses, setMeses] = useState('24');
  const { dados, carregando, erro } = useDados<ProventosDTO>('/carteira/proventos?meses=' + meses);

  const vazio = dados !== null && dados.porAtivo.length === 0 && dados.agenda.itens.length === 0;

  return (
    <>
      <div className="proventos-topo">
        <Abas
          abas={ABAS}
          ativa={visao}
          aoMudar={(id) => setVisao(id === 'agenda' ? 'agenda' : 'resumo')}
        />
        {visao === 'resumo' && <Selecao rotulo="Período" valor={meses} aoMudar={setMeses} opcoes={PERIODOS} />}
      </div>

      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {!dados && carregando && <Carregando />}
      {vazio && (
        <Vazio
          icone="investimentos"
          titulo="Nenhum provento registrado"
          texto="Os dividendos e rendimentos aparecem aqui depois que você importa a planilha de movimentação da B3 ou sincroniza a corretora em Conexões."
        />
      )}
      {dados && !vazio && (
        <div className={carregando ? 'cart-conteudo cart-atualizando' : 'cart-conteudo'}>
          {visao === 'resumo' ? <VisaoResumo dados={dados} /> : <VisaoAgenda dados={dados} />}
        </div>
      )}
    </>
  );
}

function VisaoResumo({ dados }: { dados: ProventosDTO }) {
  const [mostrarTodos, setMostrarTodos] = useState(false);

  const ordenados = [...dados.porAtivo].sort((a, b) => b.total - a.total);

  const fatias: Fatia[] = ordenados.slice(0, 8).map((a, i) => ({
    rotulo: a.rotulo,
    valor: a.total,
    cor: CORES_PALETA[i % CORES_PALETA.length] ?? CORES_PALETA[0] ?? '#2563eb',
  }));
  const resto = ordenados.slice(8).reduce((soma, a) => soma + a.total, 0);
  if (resto > 0) fatias.push({ rotulo: 'Outros', valor: resto, cor: CORES_PALETA[8] ?? '#64748b' });

  const linhas = dados.mapa.linhas;
  const maiorCelula = linhas.reduce((maior, l) => Math.max(maior, ...l.valores), 0);
  const linhasVisiveis = mostrarTodos ? linhas : linhas.slice(0, LINHAS_INICIAIS);
  const totaisPorMes = dados.mapa.meses.map((_, i) => linhas.reduce((soma, l) => soma + (l.valores[i] ?? 0), 0));
  const totalGeral = totaisPorMes.reduce((soma, v) => soma + v, 0);

  return (
    <>
      <div className="resumo">
        <ResumoItem icone="somar" cor="verde" valor={formatarReais(dados.total)} rotulo="Recebido no período" />
        <ResumoItem icone="calendario" cor="azul" valor={formatarReais(dados.mediaMensal)} rotulo="Média por mês" />
        <ResumoItem icone="grafico" cor="roxo" valor={formatarReais(dados.ultimosDozeMeses)} rotulo="Últimos 12 meses" />
        <ResumoItem
          icone="investimentos"
          cor="laranja"
          valor={
            dados.rendimentoSobreOCusto === null
              ? '—'
              : dados.rendimentoSobreOCusto.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%'
          }
          rotulo="Rendimento sobre o custo (12 meses)"
        />
      </div>

      <Cartao titulo="Histórico de proventos">
        <GraficoBarras
          rotulos={dados.historico.map((h) => mesCurto(h.mes))}
          series={[{ nome: 'Proventos', cor: CORES_SERIE.carteira, valores: dados.historico.map((h) => h.total) }]}
          formato={dinheiroCurto}
          descricao="Gráfico de barras com o total de proventos recebido por mês"
        />
      </Cartao>

      <Cartao titulo="Mapa de calor mensal">
        <p className="cart-suave">Quanto cada ativo pagou em cada um dos últimos 12 meses.</p>
        {linhas.length === 0 ? (
          <p className="cart-suave">Nenhum pagamento nos últimos 12 meses.</p>
        ) : (
          <>
            <div className="proventos-rolagem">
              <table className="proventos-mapa">
                <thead>
                  <tr>
                    <th scope="col">Ativo</th>
                    {dados.mapa.meses.map((m) => (
                      <th scope="col" key={m}>
                        {mesCurto(m)}
                      </th>
                    ))}
                    <th scope="col">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {linhasVisiveis.map((l) => (
                    <tr key={l.id}>
                      <th scope="row" className="proventos-mapa-rotulo">
                        {l.rotulo}
                      </th>
                      {l.valores.map((v, i) => {
                        const intensidade = maiorCelula > 0 && v > 0 ? Math.round((v / maiorCelula) * 70) : 0;
                        const estilo: CSSProperties | undefined =
                          intensidade > 0
                            ? { background: `color-mix(in srgb, var(--cor-primaria) ${intensidade}%, transparent)` }
                            : undefined;
                        const mes = dados.mapa.meses[i] ?? '';
                        return (
                          <td
                            key={i}
                            style={estilo}
                            title={`${l.rotulo} · ${rotuloMes(mes)}: ${formatarReais(v)}`}
                          >
                            {v === 0 ? '' : duasCasas(v)}
                          </td>
                        );
                      })}
                      <td>{duasCasas(l.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">Total</th>
                    {totaisPorMes.map((v, i) => (
                      <td key={i}>{v === 0 ? '' : duasCasas(v)}</td>
                    ))}
                    <td>{duasCasas(totalGeral)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {linhas.length > LINHAS_INICIAIS && (
              <Botao variante="texto" aoClicar={() => setMostrarTodos(!mostrarTodos)}>
                {mostrarTodos ? 'Mostrar menos' : `Mostrar todos (${linhas.length})`}
              </Botao>
            )}
          </>
        )}
      </Cartao>

      <div className="cart-dupla">
        <Cartao titulo="Distribuição de proventos">
          <Rosca fatias={fatias} />
        </Cartao>
        <Cartao titulo="Quem mais pagou">
          <ul className="proventos-lista-simples">
            {ordenados.slice(0, 5).map((a) => (
              <li key={a.id}>
                <strong>{a.rotulo}</strong>
                <span>{formatarReais(a.total)}</span>
                <span className="cart-suave">{formatarPercentual(a.parte)}</span>
              </li>
            ))}
          </ul>
        </Cartao>
      </div>

      <Cartao titulo="Ativos">
        <Tabela
          chave={(a) => a.id}
          dados={dados.porAtivo}
          vazio="Nenhum ativo com proventos no período."
          colunas={[
            {
              titulo: 'Ativo',
              celula: (a) => (
                <span className="proventos-ativo">
                  <strong>{a.rotulo}</strong>
                  <span className="cart-suave">{a.nome}</span>
                </span>
              ),
            },
            { titulo: 'Recebido', alinhar: 'direita', celula: (a) => formatarReais(a.total) },
            { titulo: '% do total', alinhar: 'direita', celula: (a) => formatarPercentual(a.parte) },
            { titulo: 'Pagamentos', alinhar: 'direita', celula: (a) => a.pagamentos },
            {
              titulo: 'Último pagamento',
              celula: (a) => (
                <span className="proventos-ativo">
                  <span>{formatarDia(a.ultimaData)}</span>
                  {a.ultimoValor !== null && <span className="cart-suave">{formatarReais(a.ultimoValor)}</span>}
                </span>
              ),
            },
            {
              titulo: 'Rendimento sobre o custo',
              alinhar: 'direita',
              celula: (a) => (a.rendimentoSobreOCusto === null ? '—' : duasCasas(a.rendimentoSobreOCusto) + '%'),
            },
          ]}
        />
      </Cartao>
    </>
  );
}

function VisaoAgenda({ dados }: { dados: ProventosDTO }) {
  const [mes, setMes] = useState(() => hojeISO().slice(0, 7));
  const [diaSel, setDiaSel] = useState<number | null>(null);
  const [busca, setBusca] = useState('');

  const hoje = hojeISO();
  const { esteMes, proximosTresMeses, proximosDozeMeses, itens } = dados.agenda;

  const itensDoMes = itens.filter((i) => i.data.slice(0, 7) === mes);
  const totalDoMes = itensDoMes.reduce((soma, i) => soma + i.valor, 0);

  const porDia = new Map<number, ItemAgenda[]>();
  for (const item of itensDoMes) {
    const dia = diaDaData(item.data);
    porDia.set(dia, [...(porDia.get(dia) ?? []), item]);
  }

  const ano = Number(mes.slice(0, 4));
  const numeroDoMes = Number(mes.slice(5, 7));
  const primeiroDiaDaSemana = new Date(ano, numeroDoMes - 1, 1).getDay();
  const diasNoMes = new Date(ano, numeroDoMes, 0).getDate();
  const celulas: (number | null)[] = [];
  for (let i = 0; i < primeiroDiaDaSemana; i++) celulas.push(null);
  for (let d = 1; d <= diasNoMes; d++) celulas.push(d);

  const dataDoDia = (dia: number) => `${mes}-${String(dia).padStart(2, '0')}`;

  const termo = busca.trim().toLowerCase();
  const listaVisivel = itensDoMes
    .filter((i) => diaSel === null || diaDaData(i.data) === diaSel)
    .filter((i) => termo === '' || i.rotulo.toLowerCase().includes(termo));

  function trocarMes(novo: string) {
    setMes(novo);
    setDiaSel(null);
  }

  return (
    <>
      <Aviso tipo="info">
        Os valores marcados como previstos são estimativas: repetem o que cada ativo pagou nos últimos 12 meses. As datas
        e os valores reais só são conhecidos quando o fundo ou a empresa anuncia.
      </Aviso>

      <div className="cart-tripla">
        <div className="cart-destaque">
          <span className="cart-destaque-rotulo">Proventos este mês</span>
          <span className="cart-destaque-valor">{formatarReais(esteMes.recebido + esteMes.previsto)}</span>
          <span className="cart-suave">
            Recebido {formatarReais(esteMes.recebido)} · Previsto {formatarReais(esteMes.previsto)}
          </span>
        </div>
        <div className="cart-destaque">
          <span className="cart-destaque-rotulo">Próximos 3 meses</span>
          <span className="cart-destaque-valor">{formatarReais(proximosTresMeses)}</span>
          <span className="cart-suave">previsto</span>
        </div>
        <div className="cart-destaque">
          <span className="cart-destaque-rotulo">Próximos 12 meses</span>
          <span className="cart-destaque-valor">{formatarReais(proximosDozeMeses)}</span>
        </div>
      </div>

      <Cartao titulo="Agenda mensal de proventos">
        <div className="proventos-agenda">
          <div>
            <div className="proventos-mes">
              <button
                type="button"
                className="proventos-nav"
                aria-label="Mês anterior"
                onClick={() => trocarMes(somarMeses(mes, -1))}
              >
                ‹
              </button>
              <strong>{rotuloMes(mes)}</strong>
              <button
                type="button"
                className="proventos-nav"
                aria-label="Próximo mês"
                onClick={() => trocarMes(somarMeses(mes, 1))}
              >
                ›
              </button>
            </div>

            <div className="proventos-semana">
              {DIAS_SEMANA.map((d) => (
                <span key={d}>{d}</span>
              ))}
            </div>
            <div className="proventos-grade">
              {celulas.map((dia, i) => {
                if (dia === null) return <span key={`vazio-${i}`} aria-hidden="true" />;
                const doDia = porDia.get(dia) ?? [];
                const temRecebido = doDia.some((x) => x.situacao === 'RECEBIDO');
                const temPrevisto = doDia.some((x) => x.situacao === 'PREVISTO');
                const selecionado = diaSel === dia;
                const iso = dataDoDia(dia);
                const rotulo =
                  doDia.length > 0
                    ? `${dia} de ${MESES_MINUSCULOS[numeroDoMes - 1]}: ${doDia.length} ${doDia.length === 1 ? 'pagamento' : 'pagamentos'}`
                    : `${dia} de ${MESES_MINUSCULOS[numeroDoMes - 1]}`;
                return (
                  <button
                    key={dia}
                    type="button"
                    className={classes(
                      'proventos-dia',
                      temRecebido && 'proventos-dia-recebido',
                      temPrevisto && 'proventos-dia-previsto',
                      iso === hoje && 'proventos-dia-hoje'
                    )}
                    aria-pressed={selecionado}
                    aria-label={rotulo}
                    onClick={() => setDiaSel(selecionado ? null : dia)}
                  >
                    {dia}
                  </button>
                );
              })}
            </div>

            <div className="proventos-total-mes">
              <span className="cart-suave">Total do mês</span>
              <strong>{formatarReais(totalDoMes)}</strong>
            </div>
            <div className="proventos-legenda">
              <span>
                <i className="proventos-marca proventos-marca-recebido" aria-hidden="true" />
                Recebido
              </span>
              <span>
                <i className="proventos-marca proventos-marca-previsto" aria-hidden="true" />
                Previsto
              </span>
            </div>
          </div>

          <div>
            <Campo rotulo="Buscar ativo" valor={busca} aoMudar={setBusca} />
            {listaVisivel.length === 0 ? (
              <p className="cart-suave">
                {diaSel !== null ? 'Nenhum pagamento neste dia.' : 'Nenhum pagamento neste mês.'}
              </p>
            ) : (
              <ul className="proventos-itens">
                {listaVisivel.map((i, idx) => {
                  const recebido = i.situacao === 'RECEBIDO';
                  return (
                    <li key={`${i.data}-${i.id}-${i.situacao}-${idx}`} className="proventos-item">
                      <span className="proventos-item-dia">{diaMesCurto(i.data)}</span>
                      <span className="proventos-item-nome">
                        <strong>{i.rotulo}</strong>
                        <Selo cor={recebido ? 'verde' : 'amarelo'}>{recebido ? 'Recebido' : 'Previsto'}</Selo>
                      </span>
                      <span className="proventos-item-valor">{formatarReais(i.valor)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </Cartao>
    </>
  );
}
