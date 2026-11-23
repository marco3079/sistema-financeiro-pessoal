import { useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../../lib/api';
import { formatarDia, formatarReais, lerValor, mensagemErro, valorParaCampo } from '../../lib/financas';
import { useDados } from '../../lib/useDados';
import { Aviso, Botao, Cartao, Carregando, Escolha, Selo, Tabela } from '../../ui';
import { ResumoItem, Rosca } from '../../ui/financas';
import { Icone } from '../../ui/icones';
import type { NomeIcone } from '../../ui/icones';
import { CORES_DEDUTIVEL, type EstabelecimentosDTO, type IrpfDTO, type ResumoDTO } from './tipos';

// Abas da área Impostos ligadas ao IRPF e aos lugares onde a pessoa compra:
// Restituição, Despesas dedutíveis, Onde economizar e Imposto por estabelecimento.

const pct = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

function useIrpf(ano: number) {
  return useDados<IrpfDTO>(`/impostos/irpf?ano=${ano}`);
}

function Linha({ rotulo, valor, forte, sinal }: { rotulo: ReactNode; valor: number; forte?: boolean; sinal?: '-' | '+' }) {
  return (
    <div className={forte ? 'imp-linha-conta imp-linha-conta-forte' : 'imp-linha-conta'}>
      <dt>{rotulo}</dt>
      <dd>
        {sinal === '-' && valor > 0 ? '− ' : ''}
        {formatarReais(valor)}
      </dd>
    </div>
  );
}

// ---------- Restituição e IRPF do ano ----------

function SeloModelo({ melhor, diferenca }: { melhor: boolean; diferenca: number }) {
  return (
    <div className="imp-selo-modelo">
      {melhor ? <Selo cor="verde">Melhor para você</Selo> : <Selo cor="cinza">{diferenca > 0 ? `+${formatarReais(diferenca)} de imposto` : 'Mesmo imposto'}</Selo>}
    </div>
  );
}

function CampoValor({ rotulo, valor, aoMudar, dica }: { rotulo: string; valor: string; aoMudar: (v: string) => void; dica: string }) {
  return (
    <label className="campo">
      <span className="campo-rotulo">{rotulo}</span>
      <input className="campo-controle" inputMode="decimal" placeholder={dica} value={valor} onChange={(e) => aoMudar(e.target.value)} />
    </label>
  );
}

function DadosDoAno({ dados, aoSalvar }: { dados: IrpfDTO; aoSalvar: () => void }) {
  const [renda, setRenda] = useState(valorParaCampo(dados.config.rendaBruta));
  const [retido, setRetido] = useState(valorParaCampo(dados.config.irRetido));
  const [inss, setInss] = useState(valorParaCampo(dados.config.inss));
  const [dependentes, setDependentes] = useState(String(dados.config.dependentes));
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setErro(null);
    const ler = (t: string) => (t.trim() === '' ? null : lerValor(t));
    const valores = { rendaBruta: ler(renda), irRetido: ler(retido), inss: ler(inss) };
    if (Object.entries(valores).some(([, v], i) => v === null && [renda, retido, inss][i].trim() !== '')) {
      setErro('Confira os valores: use números como 85.000,00.');
      return;
    }
    const dep = Number(dependentes || '0');
    if (!Number.isInteger(dep) || dep < 0 || dep > 30) {
      setErro('Dependentes: um número inteiro de 0 a 30.');
      return;
    }
    setSalvando(true);
    try {
      await api.put('/impostos/irpf', { ano: dados.ano, ...valores, dependentes: dep });
      aoSalvar();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Cartao titulo={`Seus dados de ${dados.ano}`}>
      <p className="fin-suave">
        O sistema só vê o que caiu na conta (salário líquido). Copie do informe de rendimentos da empresa os valores do ano todo
        para a simulação ficar perto da real. Campo vazio = estimativa.
      </p>
      <div className="imp-form">
        <CampoValor
          rotulo="Rendimentos tributáveis (bruto)"
          valor={renda}
          aoMudar={setRenda}
          dica={`${formatarReais(dados.entradas.receitasLancadas)} (receitas lançadas)`}
        />
        <CampoValor rotulo="IR retido na fonte" valor={retido} aoMudar={setRetido} dica="R$ 0,00" />
        <CampoValor rotulo="INSS (contribuição oficial)" valor={inss} aoMudar={setInss} dica="R$ 0,00" />
        <label className="campo">
          <span className="campo-rotulo">Dependentes</span>
          <input className="campo-controle" inputMode="numeric" value={dependentes} onChange={(e) => setDependentes(e.target.value.replace(/\D/g, ''))} />
        </label>
      </div>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <Botao aoClicar={() => void salvar()} desabilitado={salvando}>
        {salvando ? 'Salvando...' : 'Salvar e recalcular'}
      </Botao>
    </Cartao>
  );
}

export function Restituicao({ ano }: { ano: number }) {
  const { dados, carregando, erro, recarregar } = useIrpf(ano);
  if (erro) return <Aviso tipo="erro">{erro}</Aviso>;
  if (!dados) return carregando ? <Carregando /> : null;
  const restituir = dados.resultado >= 0;
  const c = dados.modelos.completo;
  const s = dados.modelos.simplificado;
  const semRetido = dados.config.irRetido === null;
  return (
    <>
      <div className={restituir ? 'imp-veredito imp-veredito-bom' : 'imp-veredito imp-veredito-ruim'}>
        <span className="imp-veredito-icone" aria-hidden="true">
          <Icone nome={restituir ? 'seta-baixo' : 'seta-cima'} tamanho={28} />
        </span>
        <div>
          <span className="imp-veredito-rotulo">
            Tendência em {dados.ano} <Selo cor="amarelo">Estimativa</Selo>
          </span>
          <strong>
            {restituir ? 'Restituir' : 'Pagar'} {formatarReais(Math.abs(dados.resultado))}
          </strong>
          <span className="fin-suave">
            Imposto devido {formatarReais(dados.devido)} (alíquota efetiva {pct(dados.aliquotaEfetiva)}) − IR retido{' '}
            {formatarReais(dados.entradas.irRetido)}. Melhor modelo: <strong>{dados.modelos.melhor === 'COMPLETO' ? 'completo' : 'simplificado'}</strong>.
          </span>
        </div>
      </div>
      {semRetido && (
        <Aviso tipo="info">
          Sem o IR retido na fonte, a conta mostra o imposto inteiro como "a pagar". Preencha o valor do informe de rendimentos
          abaixo.
        </Aviso>
      )}
      {dados.entradas.rendaEstimada && (
        <Aviso tipo="info">
          Rendimentos estimados pelas receitas lançadas ({formatarReais(dados.entradas.receitasLancadas)}
          {dados.completo ? '' : ', até hoje'}). Elas incluem tudo o que entrou e já vêm sem os descontos do salário.
        </Aviso>
      )}

      <div className="imp-grade-2">
        <Cartao titulo="Modelo completo">
          <SeloModelo melhor={dados.modelos.melhor === 'COMPLETO'} diferenca={c.imposto - s.imposto} />
          <dl className="imp-conta">
            <Linha rotulo="Rendimentos tributáveis" valor={dados.entradas.rendaBruta} />
            <Linha rotulo="INSS" valor={dados.deducoes.inss} sinal="-" />
            <Linha rotulo={`Dependentes (${dados.config.dependentes})`} valor={dados.deducoes.dependentes} sinal="-" />
            <Linha rotulo="Saúde" valor={dados.deducoes.saude} sinal="-" />
            <Linha rotulo="Educação (com limite)" valor={dados.deducoes.educacao} sinal="-" />
            <Linha rotulo="Previdência (até 12%)" valor={dados.deducoes.previdencia} sinal="-" />
            <Linha rotulo="Base de cálculo" valor={c.base} forte />
            {c.reducao > 0 && <Linha rotulo="Redução da Lei 15.270" valor={c.reducao} sinal="-" />}
            <Linha rotulo={`Imposto devido (faixa de ${pct(c.aliquotaMarginal * 100)})`} valor={c.imposto} forte />
          </dl>
        </Cartao>
        <Cartao titulo="Modelo simplificado">
          <SeloModelo melhor={dados.modelos.melhor === 'SIMPLIFICADO'} diferenca={s.imposto - c.imposto} />
          <dl className="imp-conta">
            <Linha rotulo="Rendimentos tributáveis" valor={dados.entradas.rendaBruta} />
            <Linha
              rotulo={`Desconto de ${pct(dados.parametros.descontoSimplificado * 100)} (teto ${formatarReais(dados.parametros.tetoSimplificado)})`}
              valor={s.desconto}
              sinal="-"
            />
            <Linha rotulo="Base de cálculo" valor={s.base} forte />
            {s.reducao > 0 && <Linha rotulo="Redução da Lei 15.270" valor={s.reducao} sinal="-" />}
            <Linha rotulo={`Imposto devido (faixa de ${pct(s.aliquotaMarginal * 100)})`} valor={s.imposto} forte />
          </dl>
          <p className="fin-suave">O simplificado troca todas as deduções por um desconto fixo de 20%, até o teto.</p>
        </Cartao>
      </div>

      <div className="imp-grade-2">
        <DadosDoAno key={JSON.stringify(dados.config)} dados={dados} aoSalvar={recarregar} />
        <Cartao titulo="Rendimentos isentos e tabela usada">
          <dl className="imp-pares">
            <div>
              <dt>Proventos de FII (isentos)</dt>
              <dd>{formatarReais(dados.entradas.proventosIsentos)}</dd>
            </div>
          </dl>
          <table className="imp-tabela-ir">
            <thead>
              <tr>
                <th>Base anual até</th>
                <th>Alíquota</th>
                <th>Parcela a deduzir</th>
              </tr>
            </thead>
            <tbody>
              {dados.parametros.faixas.map((f, i) => (
                <tr key={i}>
                  <td>{f.ate === null ? 'acima' : formatarReais(f.ate)}</td>
                  <td>{f.aliquota === 0 ? 'isento' : pct(f.aliquota * 100)}</td>
                  <td>{formatarReais(f.deducao)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {dados.parametros.reducao && (
            <p className="fin-suave">
              Redução: quem tem até {formatarReais(dados.parametros.reducao.isentoAte)} de rendimentos tributáveis no ano não paga;
              até {formatarReais(dados.parametros.reducao.ate)} paga menos.
            </p>
          )}
          <p className="fin-suave">Fonte: {dados.fonte}.</p>
        </Cartao>
      </div>
      <p className="imp-nota">
        <Selo cor="amarelo">Estimativa</Selo> Simulação simplificada: não considera rendimentos de outras fontes, pensão, livro-caixa,
        ganho de capital, 13º (tributação exclusiva) nem o abatimento do IR de aplicações. A declaração oficial é feita no programa da
        Receita Federal.
      </p>
    </>
  );
}

// ---------- Despesas dedutíveis ----------

export function Dedutiveis({ ano }: { ano: number }) {
  const { dados, carregando, erro, recarregar } = useIrpf(ano);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  if (erro) return <Aviso tipo="erro">{erro}</Aviso>;
  if (!dados) return carregando ? <Carregando /> : null;
  const d = dados.dedutiveis;
  const rotulo = (id: string) => d.tipos.find((t) => t.id === id)?.rotulo ?? id;

  async function trocar(categoriaId: number, dedutivel: string) {
    setErroAcao(null);
    try {
      await api.put(`/impostos/categorias/${categoriaId}/dedutivel`, { dedutivel });
      recarregar();
    } catch (e) {
      setErroAcao(mensagemErro(e));
    }
  }

  const educacaoAcima = d.educacao > d.educacaoLimite;
  return (
    <>
      <div className="resumo">
        <ResumoItem icone="suporte" cor="verde" valor={formatarReais(d.saude)} rotulo="Saúde (sem limite)" />
        <ResumoItem icone="cursos" cor="azul" valor={formatarReais(d.educacao)} rotulo={`Educação (limite ${formatarReais(d.educacaoLimite)})`} />
        <ResumoItem icone="metas" cor="roxo" valor={formatarReais(d.previdencia)} rotulo={`Previdência (limite ${formatarReais(d.previdenciaLimite)})`} />
      </div>
      {educacaoAcima && (
        <Aviso tipo="info">
          Os gastos com educação ({formatarReais(d.educacao)}) passam do limite de {formatarReais(dados.parametros.limiteEducacao)} por
          pessoa: só {formatarReais(d.educacaoLimite)} abatem.
        </Aviso>
      )}

      <div className="imp-grade-2">
        <Cartao titulo="Por tipo">
          <Rosca
            centro={formatarReais(d.saude + d.educacao + d.previdencia)}
            fatias={[
              { rotulo: 'Saúde', valor: d.saude, cor: CORES_DEDUTIVEL.SAUDE },
              { rotulo: 'Educação', valor: d.educacao, cor: CORES_DEDUTIVEL.EDUCACAO },
              { rotulo: 'Previdência', valor: d.previdencia, cor: CORES_DEDUTIVEL.PREVIDENCIA },
            ]}
          />
        </Cartao>
        <Cartao titulo="O que abate">
          <ul className="imp-glossario">
            <li>
              <span className="imp-ponto" style={{ background: CORES_DEDUTIVEL.SAUDE }} aria-hidden="true" />
              <span>
                <strong>Saúde, sem limite:</strong> médicos, dentistas, psicólogos, fisioterapeutas, exames, hospitais e plano de saúde.
                Remédio de farmácia não abate (compras em drogarias ficam fora da conta).
              </span>
            </li>
            <li>
              <span className="imp-ponto" style={{ background: CORES_DEDUTIVEL.EDUCACAO }} aria-hidden="true" />
              <span>
                <strong>Educação, até {formatarReais(dados.parametros.limiteEducacao)} por pessoa:</strong> escola, faculdade, pós e
                curso técnico. Idiomas e cursos livres não.
              </span>
            </li>
            <li>
              <span className="imp-ponto" style={{ background: CORES_DEDUTIVEL.PREVIDENCIA }} aria-hidden="true" />
              <span>
                <strong>Previdência:</strong> PGBL e fundos de pensão, até 12% da renda tributável (só no modelo completo e para quem
                contribui ao INSS).
              </span>
            </li>
          </ul>
        </Cartao>
      </div>

      <Cartao titulo="Categorias">
        <p className="fin-suave">O tipo é um palpite pelo nome da categoria; troque se precisar. O que você escolher fica salvo.</p>
        {erroAcao && <Aviso tipo="erro">{erroAcao}</Aviso>}
        <Tabela
          chave={(c) => c.categoriaId}
          dados={d.porCategoria}
          vazio="Nenhuma categoria de saúde, educação ou previdência."
          colunas={[
            {
              titulo: 'Categoria',
              celula: (c) => (
                <span className="imp-categoria">
                  <span className="imp-ponto" style={{ background: c.cor }} aria-hidden="true" />
                  {c.nome}
                </span>
              ),
            },
            {
              titulo: 'Abate no IR como',
              celula: (c) => (
                <Escolha
                  className="campo-controle imp-select"
                  valor={c.dedutivel}
                  rotuloAcessivel={`Dedução de ${c.nome}`}
                  titulo={`Abate no IR: ${c.nome}`}
                  aoMudar={(v) => void trocar(c.categoriaId, v)}
                  opcoes={d.tipos.map((t) => ({ valor: t.id, rotulo: t.rotulo }))}
                />
              ),
            },
            { titulo: 'No ano', alinhar: 'direita', celula: (c) => <strong>{formatarReais(c.total)}</strong> },
          ]}
        />
      </Cartao>

      <Cartao titulo={`Lançamentos (${d.lancamentos.length})`}>
        <Tabela
          chave={(l) => l.id}
          dados={d.lancamentos}
          vazio="Nenhum gasto dedutível encontrado no ano."
          colunas={[
            { titulo: 'Data', celula: (l) => formatarDia(l.data) },
            { titulo: 'Descrição', celula: (l) => l.descricao },
            {
              titulo: 'Tipo',
              celula: (l) => (
                <span className="imp-categoria">
                  <span className="imp-ponto" style={{ background: CORES_DEDUTIVEL[l.tipo] }} aria-hidden="true" />
                  {rotulo(l.tipo)}
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
                  {formatarDia(l.data)} · {rotulo(l.tipo)}
                </span>
              </div>
              <strong className="imp-valor-celular">{formatarReais(l.valor)}</strong>
            </div>
          )}
        />
      </Cartao>
      <Aviso tipo="info">
        <strong>Guarde os comprovantes</strong> (nota fiscal ou recibo com nome, CPF ou CNPJ de quem prestou o serviço) por 5 anos.
        A Receita cruza esses gastos com o que médicos, clínicas, escolas e planos declaram, e despesa sem comprovante pode cair na
        malha fina.
      </Aviso>
    </>
  );
}

// ---------- Onde economizar imposto ----------

interface Sugestao {
  icone: NomeIcone;
  cor: string;
  titulo: string;
  valor: number | null;
  rotuloValor?: string;
  texto: ReactNode;
}

export function Economia({ resumo }: { resumo: ResumoDTO }) {
  const irpf = useIrpf(resumo.ano);
  const est = useDados<EstabelecimentosDTO>(`/impostos/estabelecimentos?ano=${resumo.ano}`);
  if (irpf.erro || est.erro) return <Aviso tipo="erro">{irpf.erro ?? est.erro}</Aviso>;
  if (!irpf.dados || !est.dados) return <Carregando />;
  const i = irpf.dados;
  const sugestoes: Sugestao[] = [];

  if (i.pgbl.economia > 0) {
    sugestoes.push({
      icone: 'metas',
      cor: '#8b5cf6',
      titulo: 'PGBL para abater no IR',
      valor: i.pgbl.economia,
      rotuloValor: 'a menos no IR do ano',
      texto: (
        <>
          Cabem até {formatarReais(i.pgbl.espaco)} em PGBL este ano (12% da renda tributável). Isso reduziria o imposto devido em cerca
          de {formatarReais(i.pgbl.economia)}. Vale só no modelo completo, e o imposto é cobrado no resgate (de preferência na tabela
          regressiva, até 10% depois de 10 anos).
        </>
      ),
    });
  }

  const dif = Math.abs(i.modelos.completo.imposto - i.modelos.simplificado.imposto);
  if (dif > 0) {
    sugestoes.push({
      icone: 'documento',
      cor: '#3b82f6',
      titulo: `Declare no modelo ${i.modelos.melhor === 'COMPLETO' ? 'completo' : 'simplificado'}`,
      valor: dif,
      rotuloValor: 'de diferença entre os modelos',
      texto:
        i.modelos.melhor === 'COMPLETO'
          ? 'Suas deduções passam o desconto simplificado. Junte os comprovantes de saúde, educação e previdência.'
          : `Suas deduções (${formatarReais(i.modelos.completo.deducoes)}) ficam abaixo do desconto simplificado (${formatarReais(i.modelos.simplificado.desconto)}).`,
    });
  }

  const iofs = resumo.diretos.lancamentos.filter((l) => l.tipo === 'IOF');
  const rotativo = iofs.filter((l) => /rotativo|atraso|parcelamento|iofv/i.test(l.descricao)).reduce((s, l) => s + l.valor, 0);
  const internacional = iofs.reduce((s, l) => s + l.valor, 0) - rotativo;
  if (rotativo > 0) {
    sugestoes.push({
      icone: 'cartao',
      cor: '#ef4444',
      titulo: 'IOF de rotativo e parcelamento da fatura',
      valor: rotativo,
      rotuloValor: 'pagos em IOF',
      texto: 'Esse IOF só existe quando a fatura não é paga inteira. Pagar o total no vencimento zera esse imposto e os juros que vêm junto.',
    });
  }
  if (internacional > 0) {
    sugestoes.push({
      icone: 'mais-circulo',
      cor: '#f97316',
      titulo: 'IOF em compras internacionais',
      valor: internacional,
      rotuloValor: 'pagos em IOF',
      texto:
        'Compras em moeda estrangeira (sites, assinaturas e viagens) pagam IOF sobre cada transação. Prefira a versão brasileira da assinatura, quando existe, e concentre as compras de viagem.',
    });
  }

  const topCat = resumo.categorias.filter((c) => c.imposto > 0)[0];
  if (topCat) {
    sugestoes.push({
      icone: 'grafico',
      cor: topCat.cor,
      titulo: `${topCat.nome}: a categoria com mais imposto embutido`,
      valor: topCat.imposto,
      rotuloValor: `estimados em ${formatarReais(topCat.gasto)} gastos`,
      texto: `Cerca de ${pct(topCat.aliquota)} de cada compra aqui é imposto. Cortar 10% desses gastos economizaria uns ${formatarReais(topCat.imposto * 0.1)} só em tributos.`,
    });
  }

  const topEst = [...est.dados.estabelecimentos].sort((a, b) => b.imposto - a.imposto)[0];
  if (topEst && topEst.imposto > 0) {
    sugestoes.push({
      icone: 'pedidos',
      cor: '#06b6d4',
      titulo: `${topEst.nome}: o lugar onde você mais paga imposto`,
      valor: topEst.imposto,
      rotuloValor: `em ${topEst.lancamentos} compras`,
      texto: `Você gastou ${formatarReais(topEst.gasto)} aqui no ano. Veja a aba Estabelecimentos para comparar com os outros lugares.`,
    });
  }

  if (resumo.totais.semCategoria > 0) {
    sugestoes.push({
      icone: 'categorias',
      cor: '#94a3b8',
      titulo: 'Gastos sem categoria',
      valor: resumo.totais.semCategoria,
      rotuloValor: 'fora das contas de imposto',
      texto: 'Dê uma categoria a esses lançamentos para a estimativa de imposto e as deduções do IR ficarem completas.',
    });
  }

  if (i.entradas.proventosIsentos > 0) {
    sugestoes.push({
      icone: 'investimentos',
      cor: '#22c55e',
      titulo: 'Proventos de FII isentos',
      valor: i.entradas.proventosIsentos,
      rotuloValor: 'recebidos sem IR',
      texto: 'Os rendimentos de FII são isentos para pessoa física. Na declaração, eles vão em "Rendimentos isentos e não tributáveis" (código 26).',
    });
  }

  return (
    <>
      {sugestoes.length === 0 ? (
        <Cartao>
          <p className="fin-suave">Ainda não há dados suficientes em {resumo.ano} para sugerir economias.</p>
        </Cartao>
      ) : (
        <div className="imp-sugestoes">
          {sugestoes.map((s) => (
            <article key={s.titulo} className="imp-sugestao">
              <span className="imp-sugestao-icone" style={{ color: s.cor, background: `color-mix(in srgb, ${s.cor} 15%, transparent)` }} aria-hidden="true">
                <Icone nome={s.icone} tamanho={22} />
              </span>
              <div className="imp-sugestao-texto">
                <strong>{s.titulo}</strong>
                <p>{s.texto}</p>
              </div>
              {s.valor !== null && (
                <div className="imp-sugestao-valor">
                  <strong>{formatarReais(s.valor)}</strong>
                  {s.rotuloValor && <span className="fin-suave">{s.rotuloValor}</span>}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      <p className="imp-nota">
        <Selo cor="amarelo">Estimativa</Selo> Sugestões geradas pelos seus lançamentos. Não são recomendação de investimento: antes de
        contratar um PGBL, compare taxas e prazos.
      </p>
    </>
  );
}

// ---------- Imposto por estabelecimento ----------

export function Estabelecimentos({ ano }: { ano: number }) {
  const { dados, carregando, erro } = useDados<EstabelecimentosDTO>(`/impostos/estabelecimentos?ano=${ano}`);
  if (erro) return <Aviso tipo="erro">{erro}</Aviso>;
  if (!dados) return carregando ? <Carregando /> : null;
  const top = [...dados.estabelecimentos].sort((a, b) => b.imposto - a.imposto).slice(0, 10);
  const maior = Math.max(1, ...top.map((e) => e.imposto));
  return (
    <>
      <div className="resumo">
        <ResumoItem icone="pedidos" cor="azul" valor={String(dados.quantidade)} rotulo="Lugares diferentes" />
        <ResumoItem icone="financeiro" cor="vermelho" valor={formatarReais(dados.totalImposto)} rotulo="Imposto estimado" />
        <ResumoItem
          icone="grafico"
          cor="roxo"
          valor={dados.totalGasto > 0 ? pct((dados.totalImposto / dados.totalGasto) * 100) : '—'}
          rotulo="Do que você gastou neles"
        />
      </div>
      <Cartao titulo="Onde você mais paga imposto">
        {top.length === 0 ? (
          <p className="fin-suave">Sem gastos no período.</p>
        ) : (
          <ul className="imp-ranking">
            {top.map((e) => (
              <li key={e.nome}>
                <span className="imp-ranking-nome">
                  <span className="imp-ponto" style={{ background: e.categoria?.cor ?? '#94a3b8' }} aria-hidden="true" />
                  {e.nome}
                </span>
                <span className="imp-ranking-valor">{formatarReais(e.imposto)}</span>
                <span className="imp-ranking-barra" aria-hidden="true">
                  <span style={{ width: `${(e.imposto / maior) * 100}%`, background: e.categoria?.cor ?? '#94a3b8' }} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Cartao>
      <Cartao titulo="Os 50 lugares onde você mais gasta">
        <Tabela
          chave={(e) => e.nome}
          dados={dados.estabelecimentos}
          vazio="Sem gastos no período."
          colunas={[
            { titulo: 'Estabelecimento', celula: (e) => e.nome },
            {
              titulo: 'Categoria',
              celula: (e) =>
                e.categoria ? (
                  <span className="imp-categoria">
                    <span className="imp-ponto" style={{ background: e.categoria.cor }} aria-hidden="true" />
                    {e.categoria.nome}
                  </span>
                ) : (
                  <span className="fin-suave">Sem categoria</span>
                ),
            },
            { titulo: 'Compras', alinhar: 'direita', celula: (e) => e.lancamentos },
            { titulo: 'Gasto', alinhar: 'direita', celula: (e) => formatarReais(e.gasto) },
            { titulo: 'Alíquota', alinhar: 'direita', celula: (e) => (e.imposto > 0 ? pct(e.aliquota) : '—') },
            { titulo: 'Imposto', alinhar: 'direita', celula: (e) => <strong>{formatarReais(e.imposto)}</strong> },
          ]}
          itemCelular={(e) => (
            <div className="item-app">
              <div className="item-app-texto">
                <span className="item-app-titulo">{e.nome}</span>
                <span className="item-app-sub">
                  {e.lancamentos} compras · {formatarReais(e.gasto)}
                  {e.categoria ? ` · ${e.categoria.nome}` : ''}
                </span>
              </div>
              <strong className="imp-valor-celular">{formatarReais(e.imposto)}</strong>
            </div>
          )}
        />
        <p className="fin-suave">
          Lugares agrupados pela descrição do lançamento (sem parcelas e códigos da maquininha). O imposto usa a alíquota da categoria
          de cada compra; lançamentos sem categoria (como Pix para pessoas) ficam com imposto zero.
        </p>
      </Cartao>
    </>
  );
}
