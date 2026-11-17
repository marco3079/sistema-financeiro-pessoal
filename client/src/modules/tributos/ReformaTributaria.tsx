import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { mensagemErro } from '../../lib/financas';
import { useDados } from '../../lib/useDados';
import { Abas, Aviso, Botao, Campo, Cartao, Carregando, Pagina, Selecao, Tabela, formatarMoeda } from '../../ui';
import './tributos.css';

// Reforma Tributária do Consumo (CBS, IBS e Imposto Seletivo): quanto dos seus gastos vira esses tributos e um
// simulador por produto ou nota, com a calculadora oficial da Receita Federal.

interface AnoDTO {
  ano: number;
  cbs: number;
  ibsUf: number;
  ibsMun: number;
  oficial: boolean;
  nota: string;
}

interface TratamentoDTO {
  id: string;
  rotulo: string;
  fator: number;
  exemplo: string;
}

interface AliquotasDTO {
  anos: AnoDTO[];
  tratamentos: TratamentoDTO[];
  calculadora: boolean;
}

interface LinhaGastoDTO {
  categoriaId: number | null;
  nome: string;
  cor: string;
  tratamento: string;
  escolhidoPorVoce: boolean;
  gasto: number;
  cbs: number;
  ibs: number;
  total: number;
  aliquotaEfetiva: number;
}

interface GastosDTO {
  ano: number;
  aliquotas: AnoDTO;
  periodo: { de: string; ate: string };
  gasto: number;
  imposto: number;
  percentual: number;
  semCategoria: number;
  linhas: LinhaGastoDTO[];
  porAno: { ano: number; total: number }[];
}

const pct = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;

function SeusGastos({ aliquotas }: { aliquotas: AliquotasDTO }) {
  const [ano, setAno] = useState('2033');
  const { dados, carregando, erro, recarregar } = useDados<GastosDTO>(`/tributos/gastos?ano=${ano}`);
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  async function trocarTratamento(linha: LinhaGastoDTO, tratamento: string) {
    if (linha.categoriaId === null) return;
    setErroAcao(null);
    try {
      await api.put(`/tributos/categorias/${linha.categoriaId}`, { tratamento: tratamento || null });
      recarregar();
    } catch (e) {
      setErroAcao(mensagemErro(e));
    }
  }

  const maior = Math.max(1, ...(dados?.porAno ?? []).map((p) => p.total));
  return (
    <>
      <Cartao>
        <div className="fin-cabecalho">
          <div>
            <strong>Quanto dos seus gastos seria CBS e IBS</strong>
            <p className="fin-suave">
              Gastos dos últimos 12 meses, por categoria, com a parte do preço que vai para os tributos novos no ano
              escolhido. CBS e IBS substituem PIS, Cofins, ICMS e ISS: não é um custo somado ao de hoje, é como o
              imposto que já está no preço passa a ser cobrado.
            </p>
          </div>
          <Selecao
            rotulo="Ano"
            valor={ano}
            aoMudar={(v) => setAno(v || '2033')}
            opcoes={aliquotas.anos.map((a) => ({ valor: String(a.ano), rotulo: String(a.ano) }))}
          />
        </div>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {erroAcao && <Aviso tipo="erro">{erroAcao}</Aviso>}
        {!dados && carregando && <Carregando />}
        {dados && (
          <>
            <div className="trib-resumo">
              <div>
                <span className="fin-suave">Gasto em 12 meses</span>
                <strong>{formatarMoeda(dados.gasto)}</strong>
              </div>
              <div>
                <span className="fin-suave">CBS + IBS embutidos ({dados.ano})</span>
                <strong>{formatarMoeda(dados.imposto)}</strong>
              </div>
              <div>
                <span className="fin-suave">Parte do que você gastou</span>
                <strong>{pct(dados.percentual)}</strong>
              </div>
            </div>
            <p className="fin-suave">
              {dados.aliquotas.oficial ? 'Alíquota oficial de referência' : 'Alíquota estimada'}: CBS {pct(dados.aliquotas.cbs)} + IBS{' '}
              {pct(dados.aliquotas.ibsUf + dados.aliquotas.ibsMun)}. {dados.aliquotas.nota}
            </p>
            {dados.semCategoria > 0 && (
              <Aviso tipo="info">
                {formatarMoeda(dados.semCategoria)} de gastos sem categoria ficaram fora da conta (muitas vezes são Pix
                para pessoas, que não pagam CBS/IBS). Dê uma categoria a eles em Lançamentos para entrarem aqui.
              </Aviso>
            )}
            <div className="trib-anos" aria-label="Imposto embutido por ano da transição">
              {dados.porAno.map((p) => (
                <button
                  type="button"
                  key={p.ano}
                  className={String(p.ano) === ano ? 'trib-ano trib-ano-ativo' : 'trib-ano'}
                  onClick={() => setAno(String(p.ano))}
                  title={`${p.ano}: ${formatarMoeda(p.total)}`}
                >
                  <span className="trib-ano-barra" style={{ height: `${Math.max(4, (p.total / maior) * 100)}%` }} />
                  <span className="trib-ano-rotulo">{p.ano}</span>
                </button>
              ))}
            </div>
            <Tabela<LinhaGastoDTO>
              chave={(l) => String(l.categoriaId ?? 'sem')}
              dados={dados.linhas}
              vazio="Nenhum gasto nos últimos 12 meses."
              colunas={[
                {
                  titulo: 'Categoria',
                  celula: (l) => (
                    <span className="trib-categoria">
                      <span className="trib-ponto" style={{ background: l.cor }} aria-hidden="true" />
                      {l.nome}
                    </span>
                  ),
                },
                { titulo: 'Gasto', alinhar: 'direita', celula: (l) => formatarMoeda(l.gasto) },
                {
                  titulo: 'Tratamento na reforma',
                  celula: (l) =>
                    l.categoriaId === null ? (
                      <span className="fin-suave">Alíquota cheia</span>
                    ) : (
                      <select
                        className="campo-controle trib-select"
                        value={l.tratamento}
                        aria-label={`Tratamento de ${l.nome}`}
                        onChange={(e) => void trocarTratamento(l, e.target.value)}
                      >
                        {aliquotas.tratamentos.map((t) => (
                          <option key={t.id} value={t.id} title={t.exemplo}>
                            {t.rotulo}
                          </option>
                        ))}
                      </select>
                    ),
                },
                { titulo: 'Alíquota', alinhar: 'direita', celula: (l) => pct(l.aliquotaEfetiva) },
                { titulo: 'CBS + IBS', alinhar: 'direita', celula: (l) => <strong>{formatarMoeda(l.total)}</strong> },
              ]}
            />
            <p className="fin-suave">
              O tratamento de cada categoria é um palpite pelo nome; troque se não combinar com o que você compra.
              Exemplos: {aliquotas.tratamentos.map((t) => `${t.rotulo.toLowerCase()} (${t.exemplo.toLowerCase()})`).join('; ')}.
            </p>
          </>
        )}
      </Cartao>
    </>
  );
}

// ---------- Simulador ----------

const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];

interface ClassificacaoDTO {
  codigo: string;
  descricao: string;
  reducaoCbs: number;
  reducaoIbs: number;
  paraConsumidor: boolean;
}

interface NcmDTO {
  tributadoPeloImpostoSeletivo?: boolean;
  capitulo?: string;
  posicao?: string;
  subposicao?: string;
  item?: string;
  subitem?: string;
  classificacoes: ClassificacaoDTO[];
}

interface ItemForm {
  chave: number;
  descricao: string;
  ncm: string;
  info: NcmDTO | null;
  buscando: boolean;
  erro: string | null;
  cClassTrib: string;
  valor: string;
  quantidade: string;
  unidade: string;
  seletivo: string;
}

interface ResultadoItemDTO {
  numero: number;
  descricao: string | null;
  ncm: string;
  cClassTrib: string;
  valor: number;
  estado: string;
  calculado: boolean;
  erros: string[];
  cbs: number;
  ibs: number;
  seletivo: number;
  total: number;
  aliquotaEfetiva: number;
  reducao: number;
  embutido: number;
  memoria: string | null;
}

interface ResultadoDTO {
  ano: number;
  simulado: boolean;
  itens: ResultadoItemDTO[];
  total: { base: number; cbs: number; ibs: number; seletivo: number; imposto: number; embutido: number };
}

let proximaChave = 1;
const itemVazio = (): ItemForm => ({
  chave: proximaChave++,
  descricao: '',
  ncm: '',
  info: null,
  buscando: false,
  erro: null,
  cClassTrib: '000001',
  valor: '',
  quantidade: '1',
  unidade: 'UN',
  seletivo: '0',
});

const numeroDe = (t: string) => Number(t.replace(/\./g, '').replace(',', '.'));

function descricaoNcm(i: NcmDTO): string {
  return [i.posicao, i.subposicao, i.item, i.subitem].filter(Boolean).join(' › ') || i.capitulo || '';
}

function Simulador({ aliquotas }: { aliquotas: AliquotasDTO }) {
  const [ano, setAno] = useState('2027');
  const [uf, setUf] = useState('SP');
  const [municipios, setMunicipios] = useState<{ codigo: number; nome: string }[]>([]);
  const [municipio, setMunicipio] = useState('');
  const [itens, setItens] = useState<ItemForm[]>([itemVazio()]);
  const [resultado, setResultado] = useState<ResultadoDTO | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    let ativo = true;
    setMunicipios([]);
    api
      .get<{ codigo: number; nome: string }[]>(`/tributos/municipios?uf=${uf}`)
      .then((lista) => {
        if (!ativo) return;
        setMunicipios(lista);
        // Capital como padrão quando existir (o primeiro da lista, senão).
        const capitais: Record<string, string> = { SP: 'São Paulo', RJ: 'Rio de Janeiro', PE: 'Recife', MG: 'Belo Horizonte', RS: 'Porto Alegre', PR: 'Curitiba', BA: 'Salvador', DF: 'Brasília', CE: 'Fortaleza', SC: 'Florianópolis', GO: 'Goiânia' };
        const capital = lista.find((m) => m.nome === capitais[uf]) ?? lista[0];
        setMunicipio(capital ? String(capital.codigo) : '');
      })
      .catch((e) => ativo && setErro(mensagemErro(e)));
    return () => {
      ativo = false;
    };
  }, [uf]);

  function mudar(chave: number, parcial: Partial<ItemForm>) {
    setItens((lista) => lista.map((i) => (i.chave === chave ? { ...i, ...parcial } : i)));
  }

  async function buscarNcm(item: ItemForm) {
    const ncm = item.ncm.replace(/\D/g, '');
    if (ncm.length !== 8) {
      mudar(item.chave, { erro: 'O NCM tem 8 dígitos.' });
      return;
    }
    mudar(item.chave, { buscando: true, erro: null });
    try {
      const info = await api.get<NcmDTO>(`/tributos/ncm/${ncm}?ano=${ano}`);
      const sugerida = info.classificacoes.find((c) => c.paraConsumidor) ?? info.classificacoes[0];
      mudar(item.chave, { info, ncm, buscando: false, cClassTrib: sugerida?.codigo ?? '000001' });
    } catch (e) {
      mudar(item.chave, { buscando: false, info: null, erro: mensagemErro(e) });
    }
  }

  function operacao() {
    return {
      ano: Number(ano),
      uf,
      municipio: Number(municipio),
      itens: itens.map((i) => ({
        descricao: i.descricao.trim() || undefined,
        ncm: i.ncm.replace(/\D/g, ''),
        cClassTrib: i.cClassTrib,
        valor: numeroDe(i.valor),
        quantidade: numeroDe(i.quantidade) || 1,
        unidade: i.unidade.trim() || 'UN',
        ...(i.info?.tributadoPeloImpostoSeletivo ? { impostoSeletivo: numeroDe(i.seletivo) || 0 } : {}),
      })),
    };
  }

  function validar(): boolean {
    const ruim = itens.find((i) => i.ncm.replace(/\D/g, '').length !== 8 || !(numeroDe(i.valor) > 0));
    if (ruim) {
      setErro('Cada item precisa de NCM (8 dígitos) e valor.');
      return false;
    }
    if (!municipio) {
      setErro('Escolha o município.');
      return false;
    }
    return true;
  }

  async function calcular() {
    setErro(null);
    if (!validar()) return;
    setOcupado(true);
    try {
      setResultado(await api.post<ResultadoDTO>('/tributos/calcular', operacao()));
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  async function baixarXml() {
    setErro(null);
    if (!validar()) return;
    setOcupado(true);
    try {
      const { xml } = await api.post<{ xml: string }>('/tributos/xml', operacao());
      const url = URL.createObjectURL(new Blob([xml], { type: 'application/xml' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `tributacao-nfe-${ano}.xml`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  const dadosAno = aliquotas.anos.find((a) => String(a.ano) === ano);
  return (
    <Cartao>
      <div className="fin-cabecalho">
        <div>
          <strong>Simulador de produto ou nota</strong>
          <p className="fin-suave">
            Calcula CBS, IBS e Imposto Seletivo de cada item com a calculadora oficial da Receita Federal. Serve para uma
            compra ou para as notas da sua empresa (com o XML do grupo de tributação da NF-e). O NCM está na nota fiscal
            de cada produto.
          </p>
        </div>
      </div>
      {!aliquotas.calculadora && (
        <Aviso tipo="info">A calculadora oficial está iniciando (ou parada). Se der erro, tente de novo em um minuto.</Aviso>
      )}
      <div className="trib-filtros">
        <Selecao rotulo="Ano" valor={ano} aoMudar={(v) => setAno(v || '2027')} opcoes={aliquotas.anos.map((a) => ({ valor: String(a.ano), rotulo: String(a.ano) }))} />
        <Selecao rotulo="UF" valor={uf} aoMudar={(v) => setUf(v || 'SP')} opcoes={UFS.map((u) => ({ valor: u, rotulo: u }))} />
        <Selecao
          rotulo="Município"
          valor={municipio}
          aoMudar={setMunicipio}
          opcoes={municipios.map((m) => ({ valor: String(m.codigo), rotulo: m.nome }))}
          vazio={municipios.length === 0 ? 'Carregando...' : 'Selecione'}
        />
      </div>
      {dadosAno && (
        <p className="fin-suave">
          {dadosAno.oficial ? 'Alíquotas oficiais de referência' : 'Alíquotas estimadas (o cálculo sai como simulação)'}: CBS{' '}
          {pct(dadosAno.cbs)}, IBS {pct(dadosAno.ibsUf + dadosAno.ibsMun)}. {dadosAno.nota}
        </p>
      )}

      {itens.map((i, n) => (
        <div key={i.chave} className="trib-item">
          <div className="trib-item-linha">
            <strong>Item {n + 1}</strong>
            {itens.length > 1 && (
              <Botao variante="texto" aoClicar={() => setItens((l) => l.filter((x) => x.chave !== i.chave))}>
                Remover
              </Botao>
            )}
          </div>
          <div className="trib-item-campos">
            <Campo rotulo="Descrição (opcional)" valor={i.descricao} aoMudar={(v) => mudar(i.chave, { descricao: v })} />
            <div className="trib-ncm">
              <Campo rotulo="NCM (8 dígitos)" valor={i.ncm} aoMudar={(v) => mudar(i.chave, { ncm: v, info: null })} />
              <Botao variante="secundario" desabilitado={i.buscando} aoClicar={() => void buscarNcm(i)}>
                {i.buscando ? 'Buscando...' : 'Buscar'}
              </Botao>
            </div>
            <Campo rotulo="Valor (R$)" valor={i.valor} aoMudar={(v) => mudar(i.chave, { valor: v })} />
            <Campo rotulo="Quantidade" valor={i.quantidade} aoMudar={(v) => mudar(i.chave, { quantidade: v })} />
            <Campo rotulo="Unidade" valor={i.unidade} aoMudar={(v) => mudar(i.chave, { unidade: v })} />
          </div>
          {i.erro && <Aviso tipo="erro">{i.erro}</Aviso>}
          {i.info && (
            <>
              <p className="fin-suave">{descricaoNcm(i.info)}</p>
              <Selecao
                rotulo="Classificação tributária"
                valor={i.cClassTrib}
                aoMudar={(v) => mudar(i.chave, { cClassTrib: v || '000001' })}
                opcoes={i.info.classificacoes.map((c) => ({
                  valor: c.codigo,
                  rotulo: `${c.codigo} · ${c.reducaoCbs > 0 ? `redução de ${c.reducaoCbs}% · ` : ''}${c.descricao}${c.paraConsumidor ? '' : ' (situação especial)'}`,
                }))}
              />
              {i.info.tributadoPeloImpostoSeletivo && (
                <Campo
                  rotulo="Imposto Seletivo (% sobre o valor; a alíquota ainda não foi fixada em lei)"
                  valor={i.seletivo}
                  aoMudar={(v) => mudar(i.chave, { seletivo: v })}
                />
              )}
            </>
          )}
        </div>
      ))}

      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <div className="pagina-acoes">
        <Botao variante="secundario" aoClicar={() => setItens((l) => [...l, itemVazio()])}>
          Adicionar item
        </Botao>
        <Botao variante="secundario" desabilitado={ocupado} aoClicar={() => void baixarXml()}>
          Baixar XML (NF-e)
        </Botao>
        <Botao desabilitado={ocupado} aoClicar={() => void calcular()}>
          {ocupado ? 'Calculando...' : 'Calcular'}
        </Botao>
      </div>

      {resultado && (
        <div className="trib-resultado">
          <div className="trib-resumo">
            <div>
              <span className="fin-suave">Base</span>
              <strong>{formatarMoeda(resultado.total.base)}</strong>
            </div>
            <div>
              <span className="fin-suave">CBS</span>
              <strong>{formatarMoeda(resultado.total.cbs)}</strong>
            </div>
            <div>
              <span className="fin-suave">IBS</span>
              <strong>{formatarMoeda(resultado.total.ibs)}</strong>
            </div>
            {resultado.total.seletivo > 0 && (
              <div>
                <span className="fin-suave">Imposto Seletivo</span>
                <strong>{formatarMoeda(resultado.total.seletivo)}</strong>
              </div>
            )}
            <div>
              <span className="fin-suave">Total de tributos</span>
              <strong>{formatarMoeda(resultado.total.imposto)}</strong>
            </div>
          </div>
          <Tabela<ResultadoItemDTO>
            chave={(r) => String(r.numero)}
            dados={resultado.itens}
            colunas={[
              {
                titulo: 'Item',
                celula: (r) => (
                  <span>
                    {r.descricao ?? `Item ${r.numero}`}
                    <br />
                    <span className="fin-suave">
                      NCM {r.ncm} · {r.cClassTrib}
                    </span>
                    {r.erros.map((e) => (
                      <span key={e} className="trib-erro">
                        {e}
                      </span>
                    ))}
                  </span>
                ),
              },
              { titulo: 'Valor', alinhar: 'direita', celula: (r) => formatarMoeda(r.valor) },
              { titulo: 'Alíquota', alinhar: 'direita', celula: (r) => (r.calculado ? pct(r.aliquotaEfetiva) : '—') },
              { titulo: 'CBS', alinhar: 'direita', celula: (r) => formatarMoeda(r.cbs) },
              { titulo: 'IBS', alinhar: 'direita', celula: (r) => formatarMoeda(r.ibs) },
              { titulo: 'IS', alinhar: 'direita', celula: (r) => formatarMoeda(r.seletivo) },
              { titulo: 'Embutido no preço', alinhar: 'direita', celula: (r) => <strong>{formatarMoeda(r.embutido)}</strong> },
            ]}
          />
          <p className="fin-suave">
            Os tributos novos são calculados "por fora" (somados ao valor). "Embutido no preço" é quanto deles haveria
            dentro de um preço igual ao valor informado. {resultado.simulado && 'De 2027 em diante, as alíquotas são estimativas.'}
          </p>
          {resultado.itens.some((r) => r.memoria) && (
            <details className="trib-memoria">
              <summary>Memória de cálculo (da calculadora oficial)</summary>
              {resultado.itens.map((r) => r.memoria && <pre key={r.numero}>{r.memoria}</pre>)}
            </details>
          )}
        </div>
      )}
    </Cartao>
  );
}

export function ReformaTributaria() {
  const { dados, carregando, erro } = useDados<AliquotasDTO>('/tributos/aliquotas');
  const [aba, setAba] = useState('gastos');
  return (
    <Pagina titulo="Reforma tributária">
      <Abas
        abas={[
          { id: 'gastos', rotulo: 'Seus gastos' },
          { id: 'simulador', rotulo: 'Simulador (produto ou nota)' },
        ]}
        ativa={aba}
        aoMudar={setAba}
      />
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {!dados && carregando && <Carregando />}
      {dados && aba === 'gastos' && <SeusGastos aliquotas={dados} />}
      {dados && aba === 'simulador' && <Simulador aliquotas={dados} />}
    </Pagina>
  );
}
