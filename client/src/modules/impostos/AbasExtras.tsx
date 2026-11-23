import { useState } from 'react';
import { api } from '../../lib/api';
import { formatarDia, formatarReais, lerValor, mensagemErro, rotuloMes, valorParaCampo } from '../../lib/financas';
import { useDados } from '../../lib/useDados';
import { Aviso, Botao, Cartao, Carregando, Selo, Tabela } from '../../ui';
import { BarraProgresso, ResumoItem, Rosca } from '../../ui/financas';
import { GraficoBarras } from '../../ui/graficos';
import {
  CORES_IOF,
  type InvestimentosListaDTO,
  type IofTarifasDTO,
  type IrDTO,
  type IrpfDTO,
  type RendaFixaDTO,
  type ResumoDTO,
} from './tipos';

// Blocos e abas extras da área Impostos: impostômetro, meta, mês mais pesado, esferas e combustível (Visão geral);
// IOF e tarifas; comparação com a média brasileira; DARF, renda fixa e simulação de venda (Investimentos).

const MESES_CURTOS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const mesCurto = (mes: string) => MESES_CURTOS[Number(mes.slice(5, 7)) - 1] ?? mes;
const pct = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
const reaisCurto = (n: number) =>
  Math.abs(n) >= 1000 ? `R$ ${(n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : formatarReais(n);

// Último dia útil (seg a sex) do mês seguinte a 'AAAA-MM'. Não considera feriados.
function vencimentoDarf(mes: string): string {
  const [ano, m] = mes.split('-').map(Number);
  const d = new Date(Date.UTC(ano, m + 1, 0));
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// ---------- Visão geral: blocos novos ----------

function Impostometro({ dados }: { dados: ResumoDTO }) {
  const i = dados.impostometro;
  return (
    <Cartao titulo="Impostômetro pessoal">
      <div className="imp-impostometro">
        <span className="fin-suave">Pago em {dados.ano} até {formatarDia(dados.periodo.ate)}</span>
        <strong>{formatarReais(i.total)}</strong>
        <span className="fin-suave">cerca de {formatarReais(i.porDia)} por dia</span>
      </div>
      {!i.completo && (
        <div className="imp-impostometro-projecao">
          <span>Projeção até dezembro</span>
          <strong>{formatarReais(i.projecao)}</strong>
        </div>
      )}
      <p className="fin-suave">Projeção pela média diária do ano (direto + indireto estimado).</p>
    </Cartao>
  );
}

function MetaIndireto({ dados, aoSalvar }: { dados: ResumoDTO; aoSalvar: () => void }) {
  const m = dados.meta;
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(m.valor === null ? '' : valorParaCampo(m.valor));
  const [erro, setErro] = useState<string | null>(null);

  async function salvar(valor: number | null) {
    setErro(null);
    try {
      await api.put('/impostos/meta', { ano: dados.ano, valor });
      setEditando(false);
      aoSalvar();
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }

  const formulario = (
    <div className="imp-meta-form">
      <label className="campo">
        <span className="campo-rotulo">No máximo (R$ no ano)</span>
        <input
          className="campo-controle"
          inputMode="decimal"
          value={texto}
          placeholder={valorParaCampo(Math.round(dados.totais.indireto * 0.9))}
          onChange={(e) => setTexto(e.target.value)}
        />
      </label>
      <Botao
        aoClicar={() => {
          const v = lerValor(texto);
          if (v === null || v <= 0) setErro('Digite um valor maior que zero.');
          else void salvar(v);
        }}
      >
        Salvar meta
      </Botao>
      {m.valor !== null && (
        <Botao variante="texto" aoClicar={() => void salvar(null)}>
          Tirar meta
        </Botao>
      )}
    </div>
  );

  return (
    <Cartao titulo="Meta de imposto indireto">
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {m.valor === null || editando ? (
        <>
          <p className="fin-suave">
            Escolha um teto de imposto embutido para {dados.ano}. O andamento compara o que já foi com o esperado para hoje.
          </p>
          {formulario}
        </>
      ) : (
        <>
          <div className="imp-meta-linha">
            <strong>{formatarReais(m.acumulado)}</strong>
            <span className="fin-suave">de {formatarReais(m.valor)}</span>
            <Selo cor={m.noRitmo ? 'verde' : 'vermelho'}>{m.noRitmo ? 'Dentro do ritmo' : 'Acima do ritmo'}</Selo>
          </div>
          <BarraProgresso percentual={Math.min(100, m.percentual ?? 0)} cor={m.noRitmo ? 'var(--cor-sucesso)' : 'var(--cor-perigo)'} />
          <dl className="imp-pares imp-pares-compacto">
            <div>
              <dt>Esperado até hoje</dt>
              <dd>{formatarReais(m.esperadoHoje)}</dd>
            </div>
            <div>
              <dt>Projeção do ano</dt>
              <dd className={m.projecao > m.valor ? 'imp-pior' : 'imp-melhor'}>{formatarReais(m.projecao)}</dd>
            </div>
          </dl>
          <button type="button" className="imp-link" onClick={() => setEditando(true)}>
            Mudar meta →
          </button>
        </>
      )}
    </Cartao>
  );
}

function MesMaisPesado({ dados }: { dados: ResumoDTO }) {
  const p = dados.mesMaisPesado;
  return (
    <Cartao titulo="Mês mais pesado">
      {!p ? (
        <p className="fin-suave">Sem impostos no período.</p>
      ) : (
        <>
          <div className="imp-meta-linha">
            <strong>{rotuloMes(p.mes)}</strong>
            <span className="fin-suave">
              {formatarReais(p.imposto)} · média {formatarReais(p.media)}
            </span>
          </div>
          {p.motivos.length > 0 && <p className="fin-suave">O que puxou para cima (acima da média do mês):</p>}
          <ul className="imp-ranking">
            {p.motivos.map((x) => (
              <li key={x.nome}>
                <span className="imp-ranking-nome">
                  <span className="imp-ponto" style={{ background: x.cor }} aria-hidden="true" />
                  {x.nome}
                </span>
                <span className="imp-ranking-valor">+{formatarReais(x.acimaDaMedia)}</span>
              </li>
            ))}
            {p.direto > 0 && (
              <li>
                <span className="imp-ranking-nome">
                  <span className="imp-ponto" style={{ background: '#ef4444' }} aria-hidden="true" />
                  Impostos diretos do mês
                </span>
                <span className="imp-ranking-valor">{formatarReais(p.direto)}</span>
              </li>
            )}
          </ul>
        </>
      )}
    </Cartao>
  );
}

function Esferas({ dados }: { dados: ResumoDTO }) {
  const e = dados.esferas;
  return (
    <Cartao titulo="Quem cobra">
      <Rosca
        centro={reaisCurto(e.uniao + e.estado + e.municipio + e.outras)}
        fatias={[
          { rotulo: 'União', valor: e.uniao, cor: '#22c55e' },
          { rotulo: 'Estado', valor: e.estado, cor: '#3b82f6' },
          { rotulo: 'Município', valor: e.municipio, cor: '#f59e0b' },
          { rotulo: 'Outras taxas', valor: e.outras, cor: '#94a3b8' },
        ]}
      />
      <p className="fin-suave">
        União: PIS/Cofins, IPI, IOF, IR, INSS e os encargos embutidos. Estado: ICMS e IPVA. Município: ISS e IPTU. Parte do que a União
        e o estado arrecadam é repassada depois a estados e municípios.
      </p>
    </Cartao>
  );
}

function Combustivel({ dados }: { dados: ResumoDTO }) {
  const c = dados.combustivel;
  return (
    <Cartao titulo="Combustível">
      {c.gasto === 0 ? (
        <p className="fin-suave">
          Nenhum abastecimento encontrado em {dados.ano}. O combustível tem a maior carga embutida entre os gastos comuns (cerca de{' '}
          {pct(c.aliquota)} do preço). Compras em postos são reconhecidas pela descrição (posto, Shell, Ipiranga, BR...).
        </p>
      ) : (
        <>
          <div className="imp-meta-linha">
            <strong>{formatarReais(c.imposto)}</strong>
            <span className="fin-suave">
              de imposto em {formatarReais(c.gasto)} ({c.lancamentos} abastecimentos)
            </span>
          </div>
          <p className="fin-suave">
            Cerca de {pct(c.aliquota)} do preço do combustível é imposto (ICMS, PIS/Cofins e CIDE): a maior carga entre os gastos do
            dia a dia.
          </p>
        </>
      )}
    </Cartao>
  );
}

export function BlocosVisaoGeral({ dados, recarregar }: { dados: ResumoDTO; recarregar: () => void }) {
  return (
    <>
      <div className="imp-grade-2">
        <Impostometro dados={dados} />
        <MetaIndireto key={String(dados.meta.valor)} dados={dados} aoSalvar={recarregar} />
      </div>
      <div className="imp-grade-2">
        <MesMaisPesado dados={dados} />
        <Esferas dados={dados} />
      </div>
      <div className="imp-grade-2">
        <Combustivel dados={dados} />
      </div>
    </>
  );
}

// ---------- IOF e tarifas ----------

export function IofTarifas({ ano }: { ano: number }) {
  const { dados, carregando, erro } = useDados<IofTarifasDTO>(`/impostos/iof-tarifas?ano=${ano}`);
  if (erro) return <Aviso tipo="erro">{erro}</Aviso>;
  if (!dados) return carregando ? <Carregando /> : null;
  const t = dados.totais;
  const rotulo = (tipo: string) => dados.tipos.find((x) => x.tipo === tipo)?.rotulo ?? tipo;
  return (
    <>
      <div className="resumo">
        <ResumoItem icone="financeiro" cor="vermelho" valor={formatarReais(t.total)} rotulo="Dinheiro que não virou consumo" />
        <ResumoItem icone="cartao" cor="laranja" valor={formatarReais(t.iof)} rotulo="IOF" />
        <ResumoItem icone="contas" cor="azul" valor={formatarReais(t.tarifas)} rotulo="Tarifas bancárias" />
      </div>
      {dados.tipos.length === 0 ? (
        <Cartao>
          <p className="fin-suave">Nenhum IOF ou tarifa bancária encontrado em {ano}.</p>
        </Cartao>
      ) : (
        <div className="imp-grade-2">
          <Cartao titulo="Por tipo">
            <Rosca
              centro={reaisCurto(t.total)}
              fatias={dados.tipos.map((x) => ({ rotulo: x.rotulo, valor: x.total, cor: CORES_IOF[x.tipo] ?? '#94a3b8' }))}
            />
          </Cartao>
          <Cartao titulo="Por mês">
            <GraficoBarras
              rotulos={dados.meses.map((m) => mesCurto(m.mes))}
              series={[
                { nome: 'IOF', cor: '#f97316', valores: dados.meses.map((m) => m.iof) },
                { nome: 'Tarifas', cor: '#64748b', valores: dados.meses.map((m) => m.tarifas) },
              ]}
              formato={reaisCurto}
              empilhar
              descricao="IOF e tarifas bancárias por mês"
            />
          </Cartao>
        </div>
      )}
      <Cartao titulo="Como evitar">
        <ul className="imp-glossario">
          <li>
            <span className="imp-ponto" style={{ background: CORES_IOF.ROTATIVO }} aria-hidden="true" />
            <span>
              <strong>Rotativo e parcelamento da fatura:</strong> o IOF (0,38% + uma taxa diária) só existe quando a fatura não é paga
              inteira. Pagar o total no vencimento zera esse imposto e os juros.
            </span>
          </li>
          <li>
            <span className="imp-ponto" style={{ background: CORES_IOF.INTERNACIONAL }} aria-hidden="true" />
            <span>
              <strong>Compras internacionais:</strong> cada compra em moeda estrangeira no cartão paga IOF. Assinaturas com versão
              brasileira, cobradas em reais, não pagam.
            </span>
          </li>
          <li>
            <span className="imp-ponto" style={{ background: CORES_IOF.TARIFA }} aria-hidden="true" />
            <span>
              <strong>Tarifas:</strong> todo banco é obrigado a oferecer os serviços essenciais sem tarifa (Resolução CMN 3.919/2010).
              Pacotes pagos podem ser trocados por esse pacote gratuito.
            </span>
          </li>
        </ul>
      </Cartao>
      {dados.lancamentos.length > 0 && (
        <Cartao titulo={`Lançamentos (${dados.lancamentos.length})`}>
          <Tabela
            chave={(l) => l.id}
            dados={dados.lancamentos}
            colunas={[
              { titulo: 'Data', celula: (l) => formatarDia(l.data) },
              { titulo: 'Descrição', celula: (l) => l.descricao },
              {
                titulo: 'Tipo',
                celula: (l) => (
                  <span className="imp-categoria">
                    <span className="imp-ponto" style={{ background: CORES_IOF[l.tipo] ?? '#94a3b8' }} aria-hidden="true" />
                    {rotulo(l.tipo)}
                  </span>
                ),
              },
              { titulo: 'Valor', alinhar: 'direita', celula: (l) => <strong>{formatarReais(l.valor)}</strong> },
            ]}
            itemCelular={(l) => (
              <div className="item-app">
                <div className="item-app-texto">
                  <span className="item-app-titulo">{l.descricao}</span>
                  <span className="item-app-sub">
                    {formatarDia(l.data)} · {rotulo(l.tipo)}
                  </span>
                </div>
                <strong className="imp-valor-celular">{formatarReais(l.valor)}</strong>
              </div>
            )}
          />
        </Cartao>
      )}
      <p className="imp-nota">
        Lançamentos reconhecidos pela descrição ("IOF", "tarifa", "pacote de serviços"...). Anuidade, juros e multas ficam de fora.
      </p>
    </>
  );
}

// ---------- Comparar com a média brasileira ----------

// Carga tributária total sobre a renda das famílias, por faixa de renda em salários mínimos.
// Fonte: Ipea, Comunicado da Presidência nº 22 (2009), com dados da POF 2008-2009 do IBGE.
const FAIXAS_IPEA: { rotulo: string; ateSm: number | null; carga: number }[] = [
  { rotulo: 'Até 2 SM', ateSm: 2, carga: 53.9 },
  { rotulo: '2 a 3 SM', ateSm: 3, carga: 41.9 },
  { rotulo: '3 a 5 SM', ateSm: 5, carga: 37.4 },
  { rotulo: '5 a 6 SM', ateSm: 6, carga: 35.3 },
  { rotulo: '6 a 8 SM', ateSm: 8, carga: 35.3 },
  { rotulo: '8 a 10 SM', ateSm: 10, carga: 34.9 },
  { rotulo: '10 a 15 SM', ateSm: 15, carga: 32.7 },
  { rotulo: '15 a 20 SM', ateSm: 20, carga: 30.5 },
  { rotulo: '20 a 30 SM', ateSm: 30, carga: 31.7 },
  { rotulo: 'Mais de 30 SM', ateSm: null, carga: 29.0 },
];

// Salário mínimo nacional por ano (para achar a faixa).
const SALARIO_MINIMO: Record<number, number> = { 2024: 1412, 2025: 1518, 2026: 1621 };

export function MediaBrasileira({ dados }: { dados: ResumoDTO }) {
  const irpf = useDados<IrpfDTO>(`/impostos/irpf?ano=${dados.ano}`);
  const sm = SALARIO_MINIMO[dados.ano] ?? SALARIO_MINIMO[2026];
  const meses = Math.max(1, Math.round(dados.periodo.dias / 30.44));
  const rendaBruta = irpf.dados && !irpf.dados.entradas.rendaEstimada ? irpf.dados.entradas.rendaBruta : null;
  const rendaAnual = rendaBruta ?? dados.totais.renda;
  const rendaMensal = rendaBruta !== null ? rendaBruta / 12 : dados.totais.renda / meses;
  const emSm = rendaMensal / sm;
  const faixa = FAIXAS_IPEA.find((f) => f.ateSm === null || emSm <= f.ateSm)!;
  const sua = rendaAnual > 0 ? (dados.totais.imposto / (rendaBruta !== null ? rendaAnual * (dados.periodo.dias / 365) : rendaAnual)) * 100 : null;

  return (
    <>
      <div className="resumo">
        <ResumoItem icone="perfil" cor="roxo" valor={sua === null ? '—' : pct(sua)} rotulo="Sua carga sobre a renda" />
        <ResumoItem icone="grupo" cor="azul" valor={pct(faixa.carga)} rotulo={`Média da sua faixa (${faixa.rotulo})`} />
        <ResumoItem icone="financeiro" cor="verde" valor={formatarReais(rendaMensal)} rotulo={`Renda por mês (${emSm.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} SM)`} />
      </div>
      <Cartao titulo="Carga de impostos por faixa de renda">
        <GraficoBarras
          rotulos={FAIXAS_IPEA.map((f) => f.rotulo.replace(' SM', ''))}
          series={[
            { nome: 'Média brasileira', cor: '#94a3b8', valores: FAIXAS_IPEA.map((f) => (f === faixa ? null : f.carga)) },
            { nome: 'Sua faixa', cor: 'var(--cor-primaria)', valores: FAIXAS_IPEA.map((f) => (f === faixa ? f.carga : null)) },
          ]}
          formato={(v) => pct(v)}
          descricao="Carga tributária sobre a renda das famílias por faixa de salários mínimos"
        />
        <p className="fin-suave">
          Quem ganha menos paga proporcionalmente mais, porque os impostos sobre o consumo pesam mais em quem gasta quase toda a renda.
          Faixas em salários mínimos (SM de {formatarReais(sm)} em {dados.ano}).
        </p>
      </Cartao>
      <Cartao titulo="Como ler a comparação">
        <ul className="imp-glossario">
          <li>
            <span className="imp-ponto" style={{ background: 'var(--cor-primaria)' }} aria-hidden="true" />
            <span>
              {sua === null ? (
                'Sem receitas lançadas no período, não dá para calcular a sua carga.'
              ) : (
                <>
                  A sua carga ({pct(sua)}) está {sua < faixa.carga ? 'abaixo' : 'acima'} da média da sua faixa ({pct(faixa.carga)}). A média
                  inclui o IR e o INSS descontados do salário e os tributos sobre a folha das empresas, que aqui não aparecem: a sua
                  carga real é maior que a mostrada.
                </>
              )}
            </span>
          </li>
          <li>
            <span className="imp-ponto" style={{ background: '#94a3b8' }} aria-hidden="true" />
            <span>
              {rendaBruta !== null
                ? 'Renda: o valor bruto que você informou na aba Restituição.'
                : 'Renda: as receitas lançadas (líquidas). Informe a renda bruta na aba Restituição para uma comparação mais justa.'}
            </span>
          </li>
          <li>
            <span className="imp-ponto" style={{ background: '#f97316' }} aria-hidden="true" />
            <span>Para o país todo, a carga tributária fica em torno de um terço do PIB (Receita Federal e Tesouro Nacional).</span>
          </li>
        </ul>
        <p className="fin-suave">
          Fonte: Ipea, Comunicado da Presidência nº 22 (2009), com dados da POF 2008-2009 do IBGE. É o estudo mais citado sobre carga por
          faixa de renda; os números são antigos e servem de referência de ordem de grandeza.
        </p>
      </Cartao>
    </>
  );
}

// ---------- Investimentos: DARF, renda fixa e simulação de venda ----------

export function ControleDarf({ ir, dados }: { ir: IrDTO; dados: ResumoDTO }) {
  const hojeISO = new Date().toISOString().slice(0, 10);
  const pagamentos = dados.diretos.lancamentos.filter((l) => l.tipo === 'IR');
  const linhas = ir.imposto.meses.map((m) => {
      const venc = vencimentoDarf(m.mes);
      const pago = pagamentos.find((p) => p.data.slice(0, 7) === venc.slice(0, 7) && Math.abs(p.valor - m.imposto) < Math.max(1, m.imposto * 0.05));
      const situacao = m.imposto <= 0 ? 'sem DARF' : pago ? 'pago' : venc < hojeISO ? 'vencido' : 'a vencer';
      return { ...m, venc, situacao };
    });
  return (
    <Cartao titulo="Controle de DARF">
      <Tabela
        chave={(l) => `${l.mes}-${l.classe}`}
        dados={linhas}
        vazio={`Nenhuma venda em ${dados.ano}: sem DARF a pagar.`}
        colunas={[
          { titulo: 'Mês da venda', celula: (l) => rotuloMes(l.mes) },
          { titulo: 'Classe', celula: (l) => l.classe },
          { titulo: 'Ganho', alinhar: 'direita', celula: (l) => formatarReais(l.resultado) },
          { titulo: 'Prejuízo usado', alinhar: 'direita', celula: (l) => formatarReais(l.prejuizoCompensado) },
          { titulo: 'DARF', alinhar: 'direita', celula: (l) => <strong>{formatarReais(l.imposto)}</strong> },
          { titulo: 'Vencimento', celula: (l) => (l.imposto > 0 ? formatarDia(l.venc) : '—') },
          {
            titulo: 'Situação',
            celula: (l) => (
              <Selo cor={l.situacao === 'pago' ? 'verde' : l.situacao === 'vencido' ? 'vermelho' : l.situacao === 'sem DARF' ? 'cinza' : 'amarelo'}>{l.situacao}</Selo>
            ),
          },
        ]}
      />
      <p className="fin-suave">
        "Pago" quando há um lançamento de DARF no mês do vencimento com valor parecido. DARF vencido paga multa de 0,33% ao dia (até 20%) e
        juros Selic: emita pelo Sicalc da Receita.
      </p>
    </Cartao>
  );
}

export function RendaFixa() {
  const { dados, carregando, erro } = useDados<RendaFixaDTO>('/impostos/renda-fixa');
  if (erro) return <Aviso tipo="erro">{erro}</Aviso>;
  if (!dados) return carregando ? <Carregando /> : null;
  return (
    <Cartao titulo="Renda fixa e fundos: IR regressivo e come-cotas">
      {dados.ativos.length === 0 ? (
        <p className="fin-suave">
          Nenhuma aplicação de renda fixa, fundo ou previdência cadastrada. Quando houver, aparece aqui o IR estimado no resgate pela tabela
          regressiva (22,5% até 180 dias, 20% até 360, 17,5% até 720 e 15% depois) e a data do próximo come-cotas dos fundos (
          {formatarDia(dados.proximoComeCotas)}).
        </p>
      ) : (
        <>
          <Tabela
            chave={(a) => a.id}
            dados={dados.ativos}
            colunas={[
              { titulo: 'Aplicação', celula: (a) => `${a.nome}${a.subtipo ? ` (${a.subtipo})` : ''}` },
              { titulo: 'Saldo', alinhar: 'direita', celula: (a) => formatarReais(a.saldo) },
              { titulo: 'Rendimento', alinhar: 'direita', celula: (a) => formatarReais(a.rendimento) },
              { titulo: 'Dias', alinhar: 'direita', celula: (a) => a.dias },
              {
                titulo: 'Alíquota',
                alinhar: 'direita',
                celula: (a) => (a.isento ? <Selo cor="verde">isento</Selo> : a.aliquota === null ? 'conforme o plano' : pct(a.aliquota)),
              },
              { titulo: 'IR no resgate', alinhar: 'direita', celula: (a) => (a.irEstimado === null ? '—' : <strong>{formatarReais(a.irEstimado)}</strong>) },
              { titulo: 'Come-cotas', celula: (a) => (a.comeCotas ? formatarDia(a.comeCotas.data) : '—') },
            ]}
          />
          <p className="fin-suave">
            IR estimado sobre o rendimento atual (saldo − aplicado). Nos fundos, o come-cotas antecipa 15% do rendimento em maio e novembro e
            o resto é acertado no resgate.
          </p>
        </>
      )}
    </Cartao>
  );
}

export function SimulacaoVenda({ ir }: { ir: IrDTO }) {
  const lista = useDados<InvestimentosListaDTO>('/investimentos');
  if (lista.erro) return <Aviso tipo="erro">{lista.erro}</Aviso>;
  if (!lista.dados) return <Carregando />;
  const saldos = new Map(lista.dados.itens.map((i) => [i.id, i.saldo]));
  const prejuizoFii = ir.imposto.prejuizoAcumulado.FII ?? 0;
  const prejuizoAcoes = ir.imposto.prejuizoAcumulado.ACOES ?? 0;
  const linhas = ir.posicoes
    .map((p) => {
      const valor = saldos.get(p.id) ?? 0;
      const lucro = valor - p.custoTotal;
      const aliquota = p.tipo === 'FII' ? 20 : 15;
      return { ...p, valor, lucro, aliquota, ir: Math.max(0, (lucro * aliquota) / 100) };
    })
    .filter((l) => l.valor > 0)
    .sort((a, b) => b.ir - a.ir || b.lucro - a.lucro);
  // Vendendo tudo: lucros e prejuízos da mesma classe se compensam, e o prejuízo acumulado abate o resto.
  // Só as ações têm a isenção de R$ 20 mil em vendas no mês; ETF paga 15% sempre.
  const irClasse = (tipo: string, prejuizo: number, aliquota: number) => {
    const ls = linhas.filter((l) => l.tipo === tipo);
    const vendas = ls.reduce((s, l) => s + l.valor, 0);
    const lucro = ls.reduce((s, l) => s + l.lucro, 0) - prejuizo;
    if (tipo === 'ACAO' && vendas <= 20000) return 0;
    return Math.max(0, (lucro * aliquota) / 100);
  };
  const totalTudo =
    irClasse('FII', prejuizoFii, 20) + irClasse('ACAO', prejuizoAcoes, 15) + irClasse('ETF', ir.imposto.prejuizoAcumulado.ETF ?? 0, 15);
  return (
    <Cartao titulo="Simulação: e se eu vender hoje?">
      <Tabela
        chave={(l) => l.id}
        dados={linhas}
        vazio="Nenhuma posição em ações, FII ou ETF com cotação."
        colunas={[
          { titulo: 'Ativo', celula: (l) => l.codigo },
          { titulo: 'Custo', alinhar: 'direita', celula: (l) => formatarReais(l.custoTotal) },
          { titulo: 'Valor hoje', alinhar: 'direita', celula: (l) => formatarReais(l.valor) },
          {
            titulo: 'Lucro',
            alinhar: 'direita',
            celula: (l) => <span className={l.lucro < 0 ? 'imp-pior' : 'imp-melhor'}>{formatarReais(l.lucro)}</span>,
          },
          { titulo: 'IR se vender só ele', alinhar: 'direita', celula: (l) => <strong>{formatarReais(l.ir)}</strong> },
        ]}
        itemCelular={(l) => (
          <div className="item-app">
            <div className="item-app-texto">
              <span className="item-app-titulo">{l.codigo}</span>
              <span className="item-app-sub">
                Lucro {formatarReais(l.lucro)} · valor {formatarReais(l.valor)}
              </span>
            </div>
            <strong className="imp-valor-celular">{formatarReais(l.ir)}</strong>
          </div>
        )}
      />
      {linhas.length > 0 && (
        <p className="imp-simulacao-total">
          Vendendo tudo hoje, de uma vez: <strong>{formatarReais(totalTudo)}</strong> de IR (lucros e prejuízos da mesma classe se
          compensam e o prejuízo acumulado abate o resto).
        </p>
      )}
      <p className="fin-suave">
        FII: 20% sobre o lucro, sem isenção. Ações: 15%, isentas se as vendas do mês somarem até R$ 20 mil. Valor de hoje pela última cotação;
        não considera corretagem e emolumentos.
      </p>
    </Cartao>
  );
}
