import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { formatarDia, formatarReais, mensagemErro, rotuloMes } from '../../lib/financas';
import { useDados } from '../../lib/useDados';
import { Abas, Aviso, Cartao, Carregando, Escolha, Pagina, Selecao, Selo, Tabela } from '../../ui';
import { ResumoItem, Rosca } from '../../ui/financas';
import { GraficoBarras } from '../../ui/graficos';
import {
  COMPONENTES,
  CORES_DIRETO,
  COR_DIRETO,
  COR_INDIRETO,
  type EventoCalendarioDTO,
  type IrDTO,
  type LinhaCategoriaDTO,
  type ResumoDTO,
  type TiposDTO,
  type TipoGastoDTO,
} from './tipos';
import { Dedutiveis, Economia, Estabelecimentos, Restituicao } from './AbasIrpf';
import { BlocosVisaoGeral, ControleDarf, IofTarifas, MediaBrasileira, RendaFixa, SimulacaoVenda } from './AbasExtras';
import './impostos.css';

// Área Impostos: quanto do que você gasta é imposto (direto e indireto), em várias abas.

const MESES_CURTOS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const mesCurto = (mes: string) => MESES_CURTOS[Number(mes.slice(5, 7)) - 1] ?? mes;
const pct = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
const reaisInteiros = (n: number) => `R$ ${Math.round(n).toLocaleString('pt-BR')}`;
const reaisCurto = (n: number) =>
  Math.abs(n) >= 1000 ? `R$ ${(n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : formatarReais(n);

// Referência dos estudos anuais do IBPT para o brasileiro médio.
const DIAS_IBPT = 150;

function AvisoEstimativa() {
  return (
    <p className="imp-nota">
      <Selo cor="amarelo">Estimativa</Selo> Os impostos <strong>indiretos</strong> (ICMS, PIS/Cofins, IPI, ISS e outros embutidos no
      preço) são estimados com a carga média de cada tipo de gasto, no espírito das tabelas do IBPT usadas no "De Olho no
      Imposto" (Lei 12.741/2012). O valor real muda por produto, estado e regime da loja. Os <strong>diretos</strong> (IOF, IPVA,
      IPTU, DARF...) são o que você pagou de fato.
    </p>
  );
}

// ---------- Visão geral ----------

function VisaoGeral({ dados, irAba, recarregar }: { dados: ResumoDTO; irAba: (id: string) => void; recarregar: () => void }) {
  const t = dados.totais;
  const top = dados.categorias.filter((c) => c.imposto > 0).slice(0, 6);
  const maiorTop = Math.max(1, ...top.map((c) => c.imposto));
  return (
    <>
      <div className="resumo">
        <ResumoItem icone="financeiro" cor="vermelho" valor={reaisInteiros(t.imposto)} rotulo="Impostos no período" />
        <ResumoItem icone="grafico" cor="azul" valor={pct(t.percentualGasto)} rotulo="Do que você gastou" />
        <ResumoItem
          icone="seta-cima"
          cor="roxo"
          valor={t.percentualRenda === null ? '—' : pct(t.percentualRenda)}
          rotulo="Da sua renda"
        />
        <ResumoItem
          icone="calendario"
          cor="laranja"
          valor={dados.dias.dias === null ? '—' : `${dados.dias.dias} dias`}
          rotulo="Trabalhados para o imposto"
        />
      </div>

      <div className="imp-grade-2">
        <Cartao titulo="Impostos por mês">
          <GraficoBarras
            rotulos={dados.meses.map((m) => mesCurto(m.mes))}
            series={[
              { nome: 'Indiretos (estimados)', cor: COR_INDIRETO, valores: dados.meses.map((m) => m.indireto) },
              { nome: 'Diretos (pagos)', cor: COR_DIRETO, valores: dados.meses.map((m) => m.direto) },
            ]}
            formato={reaisCurto}
            empilhar
            descricao="Impostos indiretos e diretos em cada mês do ano"
          />
        </Cartao>
        <Cartao titulo="Para onde vai">
          <Rosca
            centro={reaisCurto(t.imposto)}
            fatias={[
              ...COMPONENTES.map((c) => ({ rotulo: c.rotulo, valor: t.componentes[c.chave], cor: c.cor })),
              { rotulo: 'Diretos', valor: t.direto, cor: COR_DIRETO },
            ]}
          />
        </Cartao>
      </div>

      <div className="imp-grade-2">
        <Cartao titulo="Direto x indireto">
          <div className="imp-barra-dupla" aria-hidden="true">
            <span style={{ flex: Math.max(t.indireto, 0.0001), background: COR_INDIRETO }} />
            <span style={{ flex: Math.max(t.direto, 0.0001), background: COR_DIRETO }} />
          </div>
          <dl className="imp-pares">
            <div>
              <dt>Indiretos (embutidos nos preços)</dt>
              <dd>{formatarReais(t.indireto)}</dd>
            </div>
            <div>
              <dt>Diretos (pagos por você)</dt>
              <dd>{formatarReais(t.direto)}</dd>
            </div>
            <div>
              <dt>Gasto total no período</dt>
              <dd>{formatarReais(t.gasto)}</dd>
            </div>
            <div>
              <dt>Renda no período</dt>
              <dd>{formatarReais(t.renda)}</dd>
            </div>
          </dl>
          <button type="button" className="imp-link" onClick={() => irAba('diretos')}>
            Ver impostos diretos →
          </button>
        </Cartao>
        <Cartao titulo="Categorias com mais imposto">
          {top.length === 0 ? (
            <p className="fin-suave">Nenhum gasto com categoria no período.</p>
          ) : (
            <ul className="imp-ranking">
              {top.map((c) => (
                <li key={c.categoriaId}>
                  <span className="imp-ranking-nome">
                    <span className="imp-ponto" style={{ background: c.cor }} aria-hidden="true" />
                    {c.nome}
                  </span>
                  <span className="imp-ranking-valor">{formatarReais(c.imposto)}</span>
                  <span className="imp-ranking-barra" aria-hidden="true">
                    <span style={{ width: `${(c.imposto / maiorTop) * 100}%`, background: c.cor }} />
                  </span>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="imp-link" onClick={() => irAba('indiretos')}>
            Ajustar categorias e alíquotas →
          </button>
        </Cartao>
      </div>
      {t.semCategoria > 0 && (
        <Aviso tipo="info">
          {formatarReais(t.semCategoria)} em gastos sem categoria ficaram fora da estimativa (muitas vezes são Pix para pessoas,
          que não têm imposto embutido). Dê uma categoria a eles em Lançamentos para entrarem na conta.
        </Aviso>
      )}
      <BlocosVisaoGeral dados={dados} recarregar={recarregar} />
      <AvisoEstimativa />
    </>
  );
}

// ---------- Indiretos por categoria ----------

function CampoAliquota({ linha, salvar }: { linha: LinhaCategoriaDTO; salvar: (valor: number | null) => void }) {
  const inicial = linha.aliquotaPropria === null ? '' : String(linha.aliquotaPropria).replace('.', ',');
  const [texto, setTexto] = useState(inicial);
  const confirmar = () => {
    const limpo = texto.trim().replace('%', '').replace(',', '.');
    if (limpo === '') {
      if (linha.aliquotaPropria !== null) salvar(null);
      return;
    }
    const n = Number(limpo);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      setTexto(inicial);
      return;
    }
    if (n !== linha.aliquotaPropria) salvar(n);
  };
  return (
    <input
      className="campo-controle imp-aliquota"
      inputMode="decimal"
      placeholder={pct(linha.aliquotaDoTipo)}
      value={texto}
      aria-label={`Alíquota de ${linha.nome} (vazio = média do tipo)`}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={confirmar}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

// Barra com a divisão do imposto da categoria entre ICMS, PIS/Cofins, IPI, ISS e outros (valores no título).
function Composicao({ linha }: { linha: LinhaCategoriaDTO }) {
  const partes = COMPONENTES.filter((c) => linha.componentes[c.chave] > 0);
  if (linha.imposto <= 0 || partes.length === 0) return <span className="fin-suave">—</span>;
  const titulo = partes.map((c) => `${c.rotulo}: ${formatarReais(linha.componentes[c.chave])}`).join(' · ');
  return (
    <span className="imp-composicao" title={titulo} role="img" aria-label={titulo}>
      {partes.map((c) => (
        <span key={c.chave} style={{ flex: linha.componentes[c.chave], background: c.cor }} />
      ))}
    </span>
  );
}

function Indiretos({ dados, recarregar }: { dados: ResumoDTO; recarregar: () => void }) {
  const tipos = useDados<TiposDTO>('/impostos/tipos');
  const [erro, setErro] = useState<string | null>(null);
  const [soComGasto, setSoComGasto] = useState(true);
  const t = dados.totais;

  async function salvar(linha: LinhaCategoriaDTO, mudanca: { tipo?: string | null; aliquota?: number | null }) {
    setErro(null);
    try {
      await api.put(`/impostos/categorias/${linha.categoriaId}`, {
        tipo: mudanca.tipo !== undefined ? mudanca.tipo : linha.tipoEscolhido ? linha.tipo : null,
        aliquota: mudanca.aliquota !== undefined ? mudanca.aliquota : linha.aliquotaPropria,
      });
      recarregar();
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }

  const linhas = soComGasto ? dados.categorias.filter((c) => c.gasto > 0) : dados.categorias;
  const rotuloTipo = (id: string) => tipos.dados?.tipos.find((x) => x.id === id)?.rotulo ?? id;

  return (
    <>
      <div className="imp-grade-2">
        <Cartao titulo="Indiretos por tributo">
          <Rosca
            centro={reaisCurto(t.indireto)}
            fatias={COMPONENTES.map((c) => ({ rotulo: c.rotulo, valor: t.componentes[c.chave], cor: c.cor }))}
          />
        </Cartao>
        <Cartao titulo="O que é cada um">
          <ul className="imp-glossario">
            {COMPONENTES.map((c) => (
              <li key={c.chave}>
                <span className="imp-ponto" style={{ background: c.cor }} aria-hidden="true" />
                <span>
                  <strong>{c.rotulo}</strong> {c.descricao}
                </span>
              </li>
            ))}
          </ul>
        </Cartao>
      </div>

      <Cartao>
        <div className="fin-cabecalho">
          <div>
            <strong>Categorias de gasto</strong>
            <p className="fin-suave">
              Cada categoria tem um tipo de gasto com a carga média de impostos sobre o preço. O tipo é um palpite pelo nome:
              troque se não combinar. Digite uma alíquota para usar a sua no lugar da média (deixe vazio para voltar à média).
            </p>
          </div>
          <label className="imp-check">
            <input type="checkbox" checked={soComGasto} onChange={(e) => setSoComGasto(e.target.checked)} /> Só com gasto no período
          </label>
        </div>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Tabela<LinhaCategoriaDTO>
          chave={(l) => l.categoriaId}
          dados={linhas}
          vazio="Nenhuma categoria de despesa com gasto no período."
          colunas={[
            {
              titulo: 'Categoria',
              celula: (l) => (
                <span className="imp-categoria">
                  <span className="imp-ponto" style={{ background: l.cor }} aria-hidden="true" />
                  {l.nome}
                </span>
              ),
            },
            {
              titulo: 'Tipo de gasto',
              celula: (l) =>
                tipos.dados ? (
                  <Escolha
                    className="campo-controle imp-select"
                    valor={l.tipo}
                    rotuloAcessivel={`Tipo de gasto de ${l.nome}`}
                    titulo={`Tipo de gasto: ${l.nome}`}
                    aoMudar={(v) => void salvar(l, { tipo: v })}
                    opcoes={tipos.dados.tipos.map((x) => ({ valor: x.id, rotulo: x.rotulo, detalhe: x.exemplo }))}
                  />
                ) : (
                  rotuloTipo(l.tipo)
                ),
            },
            {
              titulo: 'Alíquota',
              alinhar: 'direita',
              celula: (l) => <CampoAliquota key={`${l.categoriaId}-${l.aliquotaPropria}`} linha={l} salvar={(v) => void salvar(l, { aliquota: v })} />,
            },
            { titulo: 'Gasto', alinhar: 'direita', celula: (l) => formatarReais(l.gasto) },
            { titulo: 'Composição', celula: (l) => <Composicao linha={l} /> },
            { titulo: 'Imposto', alinhar: 'direita', celula: (l) => <strong>{formatarReais(l.imposto)}</strong> },
          ]}
        />
        <p className="fin-suave">
          "Imposto pago diretamente": os lançamentos da categoria entram na aba Diretos. "Sem imposto embutido": Pix para pessoas,
          família e reembolsos ficam fora da conta. O que você escolher aqui fica salvo e não é trocado pelo palpite.
        </p>
      </Cartao>

      {tipos.dados && (
        <Cartao titulo="Tabela de referência (carga média sobre o preço)">
          <Tabela
            chave={(x) => x.id}
            dados={tipos.dados.tipos}
            colunas={[
              { titulo: 'Tipo de gasto', celula: (x) => <span title={x.exemplo}>{x.rotulo}</span> },
              { titulo: 'Exemplos', celula: (x) => <span className="fin-suave">{x.exemplo}</span> },
              ...COMPONENTES.map((c) => ({
                titulo: c.rotulo,
                alinhar: 'direita' as const,
                celula: (x: TipoGastoDTO) => (x.componentes[c.chave] > 0 ? pct(x.componentes[c.chave]) : '—'),
              })),
              { titulo: 'Total', alinhar: 'direita', celula: (x) => <strong>{pct(x.total)}</strong> },
            ]}
          />
        </Cartao>
      )}
      <AvisoEstimativa />
    </>
  );
}

// ---------- Diretos ----------

function Diretos({ dados }: { dados: ResumoDTO }) {
  const d = dados.diretos;
  return (
    <>
      {d.porTipo.length === 0 ? (
        <Cartao>
          <p className="fin-suave">
            Nenhum imposto direto encontrado em {dados.ano}. O sistema procura IOF, IPVA, IPTU, DARF, IRPF, INSS e taxas pela
            descrição do lançamento, e todos os lançamentos de categorias do tipo "Imposto pago diretamente".
          </p>
        </Cartao>
      ) : (
        <div className="imp-grade-2">
          <Cartao titulo="Por tipo">
            <Rosca
              centro={reaisCurto(dados.totais.direto)}
              fatias={d.porTipo.map((p) => ({ rotulo: p.rotulo, valor: p.total, cor: CORES_DIRETO[p.tipo] ?? COR_DIRETO }))}
            />
          </Cartao>
          <Cartao titulo="Resumo">
            <dl className="imp-pares">
              {d.porTipo.map((p) => (
                <div key={p.tipo}>
                  <dt>
                    {p.rotulo} <span className="fin-suave">({p.quantidade})</span>
                  </dt>
                  <dd>{formatarReais(p.total)}</dd>
                </div>
              ))}
            </dl>
          </Cartao>
        </div>
      )}
      {d.lancamentos.length > 0 && (
        <Cartao titulo="Lançamentos">
          <Tabela
            chave={(l) => l.id}
            dados={d.lancamentos}
            colunas={[
              { titulo: 'Data', celula: (l) => formatarDia(l.data) },
              { titulo: 'Descrição', celula: (l) => l.descricao },
              {
                titulo: 'Tipo',
                celula: (l) => (
                  <span className="imp-categoria">
                    <span className="imp-ponto" style={{ background: CORES_DIRETO[l.tipo] ?? COR_DIRETO }} aria-hidden="true" />
                    {d.porTipo.find((p) => p.tipo === l.tipo)?.rotulo ?? l.tipo}
                  </span>
                ),
              },
              { titulo: 'Categoria', celula: (l) => l.categoria ?? '—' },
              { titulo: 'Valor', alinhar: 'direita', celula: (l) => <strong>{formatarReais(l.valor)}</strong> },
            ]}
            itemCelular={(l) => (
              <div className="item-app">
                <div className="item-app-texto">
                  <span className="item-app-titulo">{l.descricao}</span>
                  <span className="item-app-sub">
                    {formatarDia(l.data)} · {d.porTipo.find((p) => p.tipo === l.tipo)?.rotulo ?? l.tipo}
                  </span>
                </div>
                <strong className="imp-valor-celular">{formatarReais(l.valor)}</strong>
              </div>
            )}
          />
        </Cartao>
      )}
      <p className="imp-nota">
        Fica de fora o que não passa pela sua conta como despesa: o IR e o INSS descontados do salário (a renda já entra
        líquida) e o IR retido em aplicações que só aparece no informe de rendimentos.
      </p>
    </>
  );
}

// ---------- Investimentos ----------

function Investimentos({ dados }: { dados: ResumoDTO }) {
  const ir = useDados<IrDTO>(`/ir?ano=${dados.ano}`);
  const retido = dados.diretos.porTipo.find((p) => p.tipo === 'INVESTIMENTOS')?.total ?? 0;
  if (ir.erro) return <Aviso tipo="erro">{ir.erro}</Aviso>;
  if (!ir.dados) return <Carregando />;
  const i = ir.dados;
  const proventos = i.totais.proventos;
  return (
    <>
      <div className="resumo">
        <ResumoItem icone="investimentos" cor="verde" valor={formatarReais(proventos)} rotulo="Proventos isentos de IR" />
        <ResumoItem icone="financeiro" cor="vermelho" valor={formatarReais(i.imposto.totalNoAno)} rotulo="IR sobre vendas (DARF)" />
        <ResumoItem icone="grafico" cor="azul" valor={formatarReais(i.totais.resultado)} rotulo="Resultado das vendas" />
        <ResumoItem icone="documento" cor="roxo" valor={formatarReais(retido)} rotulo="IR retido lançado" />
      </div>

      <div className="imp-grade-2">
        <Cartao titulo="Isenção dos proventos">
          <p>
            Os rendimentos de FII que você recebeu em {dados.ano} somam <strong>{formatarReais(proventos)}</strong> e são isentos de IR
            para pessoa física (Lei 11.033/2004, art. 3º), desde que o fundo cumpra as regras (cotas em bolsa, 100 cotistas ou mais e
            você com menos de 10% das cotas).
          </p>
          <p className="fin-suave">
            Para comparar: se fossem tributados como a renda fixa mais longa (15%), seriam {formatarReais(proventos * 0.15)} de imposto.
          </p>
        </Cartao>
        <Cartao titulo="Prejuízo a compensar">
          <dl className="imp-pares">
            {Object.entries(i.imposto.prejuizoAcumulado).map(([classe, valor]) => (
              <div key={classe}>
                <dt>{classe === 'ACOES' ? 'Ações' : classe === 'FII' ? 'FII' : 'ETF'}</dt>
                <dd>{formatarReais(valor)}</dd>
              </div>
            ))}
          </dl>
          <p className="fin-suave">Prejuízo em vendas abate o lucro futuro da mesma classe antes do imposto.</p>
        </Cartao>
      </div>

      <ControleDarf ir={i} dados={dados} />
      <SimulacaoVenda ir={i} />
      <RendaFixa />
      {i.incompletos.length > 0 && (
        <Aviso tipo="info">
          Alguns ativos ficaram fora do cálculo porque o histórico está incompleto:{' '}
          {i.incompletos.map((x) => `${x.codigo} (${x.motivo})`).join('; ')}.
        </Aviso>
      )}
      <p className="imp-nota">
        Cálculo do mesmo jeito da tela <Link to="/app/ir">Imposto de renda</Link>: custo médio, isenção de R$ 20 mil por mês nas
        vendas de ações e alíquota de 20% para FII. Confira com o informe da corretora antes de pagar.
      </p>
    </>
  );
}

// Último dia útil (seg a sex) do mês seguinte a 'AAAA-MM'. Não considera feriados.
function vencimentoDarf(mes: string): string {
  const [ano, m] = mes.split('-').map(Number);
  const d = new Date(Date.UTC(ano, m + 1, 0));
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// ---------- Reforma ----------

function Reforma({ dados }: { dados: ResumoDTO }) {
  const r = dados.reforma;
  const hoje = r.consumoHoje;
  const em2033 = r.porAno.find((a) => a.ano === 2033)?.total ?? 0;
  const diferenca = em2033 - hoje;
  return (
    <>
      <div className="resumo">
        <ResumoItem icone="documento" cor="azul" valor={formatarReais(hoje)} rotulo="Tributos de consumo hoje" />
        <ResumoItem icone="calendario" cor="roxo" valor={formatarReais(em2033)} rotulo="CBS + IBS em 2033" />
        <ResumoItem
          icone={diferenca > 0 ? 'seta-cima' : 'seta-baixo'}
          cor={diferenca > 0 ? 'vermelho' : 'verde'}
          valor={`${diferenca > 0 ? '+' : ''}${formatarReais(diferenca)}`}
          rotulo="Diferença no mesmo gasto"
        />
      </div>
      <Cartao titulo="O mesmo gasto em cada ano da transição">
        <GraficoBarras
          rotulos={r.porAno.map((a) => String(a.ano))}
          series={[
            { nome: 'ICMS, ISS, PIS/Cofins e IPI', cor: '#3b82f6', valores: r.porAno.map((a) => a.antigos) },
            { nome: 'CBS + IBS', cor: '#22c55e', valores: r.porAno.map((a) => a.novos) },
          ]}
          formato={reaisCurto}
          empilhar
          descricao="Tributos sobre o consumo no mesmo gasto, de 2026 a 2033"
        />
        <p className="fin-suave">
          PIS, Cofins e IPI dão lugar à CBS em 2027; ICMS e ISS caem 10% ao ano de 2029 a 2032 e acabam em 2033, quando o IBS
          fica cheio. Em 2026 a CBS e o IBS são só um teste, compensado com PIS e Cofins. Ficam fora da comparação os "outros
          embutidos" ({formatarReais(r.outrosHoje)}), que a reforma não muda, e o Imposto Seletivo (cigarro, bebida, carro).
        </p>
      </Cartao>
      <Cartao titulo="Por categoria: hoje x 2033">
        <Tabela
          chave={(l) => l.categoriaId}
          dados={r.porCategoria}
          vazio="Nenhum gasto com categoria no período."
          colunas={[
            {
              titulo: 'Categoria',
              celula: (l) => (
                <span className="imp-categoria">
                  <span className="imp-ponto" style={{ background: l.cor }} aria-hidden="true" />
                  {l.nome}
                </span>
              ),
            },
            { titulo: 'Gasto', alinhar: 'direita', celula: (l) => formatarReais(l.gasto) },
            { titulo: 'Hoje', alinhar: 'direita', celula: (l) => formatarReais(l.hoje) },
            { titulo: '2033', alinhar: 'direita', celula: (l) => formatarReais(l.depois) },
            {
              titulo: 'Diferença',
              alinhar: 'direita',
              celula: (l) => (
                <strong className={l.diferenca > 0 ? 'imp-pior' : l.diferenca < 0 ? 'imp-melhor' : undefined}>
                  {l.diferenca > 0 ? '+' : ''}
                  {formatarReais(l.diferenca)}
                </strong>
              ),
            },
          ]}
        />
        <p className="fin-suave">
          O tratamento de cada categoria na reforma (alíquota cheia, reduzida, zero) é o mesmo da tela{' '}
          <Link to="/app/reforma-tributaria">Reforma tributária</Link>, onde dá para trocá-lo. As alíquotas de 2027 em diante
          são estimativas.
        </p>
      </Cartao>
    </>
  );
}

// ---------- Dias trabalhados ----------

function Dias({ dados }: { dados: ResumoDTO }) {
  const d = dados.dias;
  if (d.dias === null || d.fracao === null) {
    return (
      <Cartao>
        <p className="fin-suave">Sem receitas lançadas em {dados.ano}: não dá para calcular a parte da renda que vai para impostos.</p>
      </Cartao>
    );
  }
  const percentualAno = (d.dias / d.diasNoAno) * 100;
  const referencia = (DIAS_IBPT / d.diasNoAno) * 100;
  const porMes = dados.meses.map((m) => (m.renda > 0 ? Math.round(((m.indireto + m.direto) / m.renda) * 1000) / 10 : null));
  return (
    <>
      <Cartao>
        <div className="imp-dias">
          <div className="imp-dias-numero">
            <strong>{d.dias}</strong>
            <span>dias</span>
          </div>
          <div>
            <p>
              No ritmo de {dados.ano}, <strong>{pct(d.fracao)}</strong> do que você recebe vai para impostos. É como se você
              trabalhasse de 1º de janeiro até <strong>{formatarDia(d.libertacao)}</strong> só para pagá-los.
            </p>
            <p className="fin-suave">
              Os estudos anuais do IBPT apontam cerca de {DIAS_IBPT} dias para o brasileiro médio, mas contando também o IR e o INSS
              descontados do salário, que aqui não aparecem (sua renda já entra líquida).
            </p>
          </div>
        </div>
        <div className="imp-linha-ano" aria-label={`${d.dias} de ${d.diasNoAno} dias`}>
          <span className="imp-linha-ano-voce" style={{ width: `${Math.min(100, percentualAno)}%` }} />
          <span className="imp-linha-ano-marca" style={{ left: `${Math.min(100, referencia)}%` }} title={`IBPT: ~${DIAS_IBPT} dias`} />
        </div>
        <div className="imp-linha-ano-legenda">
          <span>1º jan</span>
          <span>Você: {d.dias} dias · Média IBPT: ~{DIAS_IBPT} dias</span>
          <span>31 dez</span>
        </div>
      </Cartao>
      <Cartao titulo="Parte da renda que foi para impostos, por mês">
        <GraficoBarras
          rotulos={dados.meses.map((m) => mesCurto(m.mes))}
          series={[{ nome: '% da renda', cor: '#f97316', valores: porMes }]}
          formato={(v) => pct(v)}
          descricao="Percentual da renda de cada mês que foi para impostos"
        />
        <p className="fin-suave">
          Renda = receitas lançadas no mês (sem transferências). Meses com renda baixa ou alta demais distorcem a barra; o número
          do ano é o que vale.
        </p>
      </Cartao>
    </>
  );
}

// ---------- Calendário ----------

function Calendario({ dados }: { dados: ResumoDTO }) {
  const ir = useDados<IrDTO>(`/ir?ano=${dados.ano}`);
  const darfs: EventoCalendarioDTO[] = (ir.dados?.imposto.meses ?? [])
    .filter((m) => m.imposto > 0)
    .map((m) => ({
      data: vencimentoDarf(m.mes),
      titulo: `DARF ${m.classe} (${rotuloMes(m.mes)})`,
      detalhe: 'IR sobre o lucro das vendas do mês (código 6015).',
      valor: m.imposto,
      tipo: 'IR',
      estimado: true,
    }));
  const eventos = [...dados.calendario, ...darfs].sort((a, b) => a.data.localeCompare(b.data));
  const hojeISO = new Date().toISOString().slice(0, 10);
  const porMes = new Map<string, EventoCalendarioDTO[]>();
  for (const e of eventos) {
    const mes = e.data.slice(0, 7);
    porMes.set(mes, [...(porMes.get(mes) ?? []), e]);
  }
  return (
    <>
      <Cartao>
        <ol className="imp-calendario">
          {Array.from(porMes.entries()).map(([mes, lista]) => (
            <li key={mes}>
              <h3>{rotuloMes(mes)}</h3>
              <ul>
                {lista.map((e, i) => (
                  <li key={`${e.data}-${i}`} className={e.data < hojeISO ? 'imp-evento imp-evento-passado' : 'imp-evento'}>
                    <span className="imp-evento-dia" style={{ borderColor: CORES_DIRETO[e.tipo] ?? COR_DIRETO }}>
                      {e.data.slice(8, 10)}
                    </span>
                    <span className="imp-evento-texto">
                      <strong>{e.titulo}</strong>
                      <span className="fin-suave">{e.detalhe}</span>
                    </span>
                    <span className="imp-evento-valor">
                      {e.valor !== null ? formatarReais(e.valor) : ''}
                      {e.estimado && <Selo cor="cinza">previsto</Selo>}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </Cartao>
      <p className="imp-nota">
        Datas aproximadas e sem feriados. IPVA e IPTU usam o mês e o valor do que você pagou no ano mais recente encontrado; sem
        histórico, aparece a época de costume. Confira sempre o boleto oficial.
      </p>
    </>
  );
}

// ---------- Página ----------

const ABAS = [
  { id: 'geral', rotulo: 'Visão geral' },
  { id: 'indiretos', rotulo: 'Indiretos' },
  { id: 'diretos', rotulo: 'Diretos' },
  { id: 'iof', rotulo: 'IOF e tarifas' },
  { id: 'estabelecimentos', rotulo: 'Estabelecimentos' },
  { id: 'economia', rotulo: 'Onde economizar' },
  { id: 'restituicao', rotulo: 'Restituição (IRPF)' },
  { id: 'dedutiveis', rotulo: 'Despesas dedutíveis' },
  { id: 'investimentos', rotulo: 'Investimentos' },
  { id: 'reforma', rotulo: 'Antes x depois da reforma' },
  { id: 'dias', rotulo: 'Dias trabalhados' },
  { id: 'media', rotulo: 'Comparar com a média' },
  { id: 'calendario', rotulo: 'Calendário' },
];

export function Impostos() {
  const [ano, setAno] = useState(String(new Date().getFullYear()));
  const [aba, setAba] = useState('geral');
  const resposta = useDados<ResumoDTO>(`/impostos/resumo?ano=${ano}`);
  const { carregando, erro, recarregar } = resposta;
  // No ano em andamento, os gráficos mensais param no mês atual (sem barras vazias no fim).
  const dados = resposta.dados && {
    ...resposta.dados,
    meses: resposta.dados.meses.filter((m) => m.mes <= resposta.dados!.periodo.ate.slice(0, 7)),
  };
  const anos = dados?.anos ?? [Number(ano)];
  return (
    <Pagina
      titulo="Impostos"
      acoes={
        <div className="imp-ano">
          <Selecao
            rotulo="Ano"
            valor={ano}
            aoMudar={(v) => v && setAno(v)}
            vazio="Ano"
            opcoes={anos.map((a) => ({ valor: String(a), rotulo: String(a) }))}
          />
        </div>
      }
    >
      <div className="imp-abas">
        <Abas abas={ABAS} ativa={aba} aoMudar={setAba} />
      </div>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {!dados && carregando && <Carregando />}
      {dados && !dados.periodo.completo && (
        <p className="fin-suave imp-periodo">
          De {formatarDia(dados.periodo.de)} a {formatarDia(dados.periodo.ate)} (ano em andamento).
        </p>
      )}
      {dados && aba === 'geral' && <VisaoGeral dados={dados} irAba={setAba} recarregar={recarregar} />}
      {dados && aba === 'indiretos' && <Indiretos dados={dados} recarregar={recarregar} />}
      {dados && aba === 'diretos' && <Diretos dados={dados} />}
      {dados && aba === 'iof' && <IofTarifas ano={dados.ano} />}
      {dados && aba === 'media' && <MediaBrasileira dados={dados} />}
      {dados && aba === 'estabelecimentos' && <Estabelecimentos ano={dados.ano} />}
      {dados && aba === 'economia' && <Economia resumo={dados} />}
      {dados && aba === 'restituicao' && <Restituicao ano={dados.ano} />}
      {dados && aba === 'dedutiveis' && <Dedutiveis ano={dados.ano} />}
      {dados && aba === 'investimentos' && <Investimentos dados={dados} />}
      {dados && aba === 'reforma' && <Reforma dados={dados} />}
      {dados && aba === 'dias' && <Dias dados={dados} />}
      {dados && aba === 'calendario' && <Calendario dados={dados} />}
    </Pagina>
  );
}
