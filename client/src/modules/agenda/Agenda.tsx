import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { formatarDia, formatarReais, lerValor, mensagemErro, mesAtual, rotuloDe, valorParaCampo } from '../../lib/financas';
import type { CategoriaDTO, ContaDTO, TipoTransacao } from '../../lib/financas';
import { useDados } from '../../lib/useDados';
import { Abas, Aviso, Botao, Caixa, Campo, Cartao, Carregando, Modal, Pagina, Selecao, Selo, Tabela } from '../../ui';
import type { ColunaTabela } from '../../ui';
import { ResumoItem, SeletorMes, Valor, Vazio } from '../../ui/financas';
import { GraficoLinhas } from '../../ui/graficos';
import './agenda.css';

// ---------- Tipos (formatos da API de server/src/modules/agenda/routes.ts) ----------

type Situacao = 'PAGA' | 'ABERTA' | 'ATRASADA';

interface ItemAgenda {
  chave: string;
  origem: 'FATURA' | 'CONTA_FIXA';
  id: number;
  descricao: string;
  tipo: TipoTransacao;
  valor: number;
  data: string;
  situacao: Situacao;
  contaFixaId?: number;
  faturaId?: number;
}

interface AgendaDTO {
  mes: string;
  itens: ItemAgenda[];
  aPagar: number;
  aReceber: number;
  pago: number;
  emAberto: number;
}

interface ContaFixaDTO {
  id: number;
  descricao: string;
  tipo: TipoTransacao;
  valor: number;
  diaDoMes: number;
  categoriaId: number | null;
  contaId: number | null;
  ativa: boolean;
}

interface LinhaFluxo {
  mes: string;
  entradas: number;
  saidas: number;
  faturas: number;
  saldoFinal: number;
}

interface FluxoDTO {
  saldoInicial: number;
  meses: LinhaFluxo[];
}

// ---------- Auxiliares ----------

const TIPOS_CONTA_FIXA: { valor: TipoTransacao; rotulo: string }[] = [
  { valor: 'DESPESA', rotulo: 'A pagar' },
  { valor: 'RECEITA', rotulo: 'A receber' },
];

const MESES_CURTOS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

// 'AAAA-MM' -> 'Nov/26'.
function mesCurto(mes: string): string {
  const [ano, m] = mes.split('-');
  return `${MESES_CURTOS[Number(m) - 1] ?? mes}/${ano.slice(2)}`;
}

const formatoCompacto = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
});

const COR_SITUACAO: Record<Situacao, 'verde' | 'azul' | 'vermelho'> = {
  PAGA: 'verde',
  ABERTA: 'azul',
  ATRASADA: 'vermelho',
};

function rotuloSituacao(item: ItemAgenda): string {
  if (item.situacao === 'PAGA') return item.tipo === 'RECEITA' ? 'Recebida' : 'Paga';
  return item.situacao === 'ATRASADA' ? 'Atrasada' : 'Em aberto';
}

// Agrupa os itens (já ordenados) por dia, na ordem em que aparecem.
function agruparPorDia(itens: ItemAgenda[]): [string, ItemAgenda[]][] {
  const mapa = new Map<string, ItemAgenda[]>();
  for (const item of itens) {
    const lista = mapa.get(item.data);
    if (lista) lista.push(item);
    else mapa.set(item.data, [item]);
  }
  return [...mapa.entries()];
}

// ---------- Criar / editar conta fixa ----------

function FormContaFixa({
  conta,
  categorias,
  contas,
  aoSalvo,
}: {
  conta: ContaFixaDTO | null;
  categorias: CategoriaDTO[];
  contas: ContaDTO[];
  aoSalvo: () => void;
}) {
  const [descricao, setDescricao] = useState(conta?.descricao ?? '');
  const [tipo, setTipo] = useState<TipoTransacao>(conta?.tipo ?? 'DESPESA');
  const [valor, setValor] = useState(valorParaCampo(conta?.valor));
  const [dia, setDia] = useState(conta ? String(conta.diaDoMes) : '');
  const [categoriaId, setCategoriaId] = useState(conta?.categoriaId ? String(conta.categoriaId) : '');
  const [contaId, setContaId] = useState(conta?.contaId ? String(conta.contaId) : '');
  const [ativa, setAtiva] = useState(conta?.ativa ?? true);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const categoriasDoTipo = categorias.filter((c) => c.tipo === tipo);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const limpa = descricao.trim();
    const valorNumero = lerValor(valor);
    const diaNumero = Number(dia);
    if (limpa === '') {
      setErro('Informe a descrição.');
      return;
    }
    if (valorNumero === null || valorNumero <= 0) {
      setErro('Informe um valor maior que zero.');
      return;
    }
    if (!Number.isInteger(diaNumero) || diaNumero < 1 || diaNumero > 31) {
      setErro('O dia do mês deve estar entre 1 e 31.');
      return;
    }
    const corpo = {
      descricao: limpa,
      tipo,
      valor: valorNumero,
      diaDoMes: diaNumero,
      categoriaId: categoriaId ? Number(categoriaId) : null,
      contaId: contaId ? Number(contaId) : null,
      ativa,
    };
    setOcupado(true);
    try {
      if (conta) await api.put(`/contas-fixas/${conta.id}`, corpo);
      else await api.post('/contas-fixas', corpo);
      aoSalvo();
    } catch (err) {
      setErro(mensagemErro(err));
      setOcupado(false);
    }
  }

  return (
    <form onSubmit={salvar}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <Campo rotulo="Descrição" valor={descricao} aoMudar={setDescricao} obrigatorio />
      <Selecao
        rotulo="Tipo"
        valor={tipo}
        aoMudar={(v) => {
          setTipo(v as TipoTransacao);
          setCategoriaId('');
        }}
        opcoes={TIPOS_CONTA_FIXA}
      />
      <Campo rotulo="Valor (R$)" valor={valor} aoMudar={setValor} obrigatorio />
      <Campo rotulo="Dia do mês (1 a 31)" valor={dia} aoMudar={setDia} tipo="number" obrigatorio />
      <Selecao
        rotulo="Categoria"
        valor={categoriaId}
        aoMudar={setCategoriaId}
        opcoes={categoriasDoTipo.map((c) => ({ valor: String(c.id), rotulo: c.nome }))}
        vazio="Sem categoria"
      />
      <Selecao
        rotulo="Conta"
        valor={contaId}
        aoMudar={setContaId}
        opcoes={contas.map((c) => ({ valor: String(c.id), rotulo: c.nome }))}
        vazio="Sem conta"
      />
      <Caixa rotulo="Ativa (aparece na agenda e no fluxo)" marcado={ativa} aoMudar={setAtiva} />
      <div className="pagina-acoes">
        <Botao tipo="submit" desabilitado={ocupado}>
          Salvar
        </Botao>
      </div>
    </form>
  );
}

// ---------- Calendário ----------

function LinhaItem({
  item,
  ocupado,
  aoAlternar,
}: {
  item: ItemAgenda;
  ocupado: boolean;
  aoAlternar: (item: ItemAgenda) => void;
}) {
  return (
    <li className="agenda-item">
      <div className="agenda-item-texto">
        <strong>{item.descricao}</strong>
        <span className="agenda-item-origem">{item.origem === 'FATURA' ? 'Fatura do cartão' : 'Conta fixa'}</span>
      </div>
      <div className="agenda-item-direita">
        <Valor valor={item.valor} sentido={item.tipo === 'RECEITA' ? 'entrada' : 'saida'} />
        <Selo cor={COR_SITUACAO[item.situacao]}>{rotuloSituacao(item)}</Selo>
      </div>
      {item.origem === 'CONTA_FIXA' && (
        <div className="agenda-item-acao">
          <Botao variante="texto" desabilitado={ocupado} aoClicar={() => aoAlternar(item)}>
            {item.situacao === 'PAGA' ? 'Desfazer' : 'Marcar como paga'}
          </Botao>
        </div>
      )}
    </li>
  );
}

function Calendario() {
  const [mes, setMes] = useState(mesAtual());
  const agenda = useDados<AgendaDTO>(`/agenda?mes=${mes}`);
  const fixas = useDados<ContaFixaDTO[]>('/contas-fixas');
  const categorias = useDados<CategoriaDTO[]>('/categorias');
  const contas = useDados<ContaDTO[]>('/contas');

  const [formulario, setFormulario] = useState<{ conta: ContaFixaDTO | null } | null>(null);
  const [aApagar, setAApagar] = useState<ContaFixaDTO | null>(null);
  const [ocupadoApagar, setOcupadoApagar] = useState(false);
  const [erroApagar, setErroApagar] = useState<string | null>(null);
  const [ocupadoItem, setOcupadoItem] = useState<string | null>(null);
  const [erroItem, setErroItem] = useState<string | null>(null);

  function atualizarTudo() {
    agenda.recarregar();
    fixas.recarregar();
  }

  async function alternarPaga(item: ItemAgenda) {
    if (item.contaFixaId === undefined) return;
    setOcupadoItem(item.chave);
    setErroItem(null);
    try {
      if (item.situacao === 'PAGA') await api.del(`/contas-fixas/${item.contaFixaId}/pagar?mes=${mes}`);
      else await api.post(`/contas-fixas/${item.contaFixaId}/pagar`, { mes });
      agenda.recarregar();
    } catch (err) {
      setErroItem(mensagemErro(err));
    } finally {
      setOcupadoItem(null);
    }
  }

  async function confirmarApagar() {
    if (!aApagar) return;
    setOcupadoApagar(true);
    setErroApagar(null);
    try {
      await api.del(`/contas-fixas/${aApagar.id}`);
      setAApagar(null);
      atualizarTudo();
    } catch (err) {
      setErroApagar(mensagemErro(err));
    } finally {
      setOcupadoApagar(false);
    }
  }

  const dados = agenda.dados;

  return (
    <>
      <div className="agenda-controles">
        <SeletorMes mes={mes} aoMudar={setMes} />
      </div>

      {agenda.erro && <Aviso tipo="erro">{agenda.erro}</Aviso>}
      {agenda.carregando && !dados && <Carregando />}
      {erroItem && <Aviso tipo="erro">{erroItem}</Aviso>}

      {dados && (
        <>
          <div className="resumo">
            <ResumoItem icone="seta-baixo" cor="vermelho" valor={formatarReais(dados.aPagar)} rotulo="A pagar" />
            <ResumoItem icone="seta-cima" cor="verde" valor={formatarReais(dados.aReceber)} rotulo="A receber" />
            <ResumoItem icone="sino" cor="laranja" valor={formatarReais(dados.emAberto)} rotulo="Em aberto" />
          </div>

          {dados.itens.length === 0 ? (
            <Vazio icone="calendario" titulo="Nada previsto neste mês" texto="Faturas dos cartões e contas fixas aparecem aqui." />
          ) : (
            agruparPorDia(dados.itens).map(([data, itens]) => (
              <section key={data} className="agenda-dia">
                <h3>{formatarDia(data)}</h3>
                <ul className="agenda-lista">
                  {itens.map((item) => (
                    <LinhaItem
                      key={item.chave}
                      item={item}
                      ocupado={ocupadoItem === item.chave}
                      aoAlternar={alternarPaga}
                    />
                  ))}
                </ul>
              </section>
            ))
          )}
        </>
      )}

      <Cartao titulo="Contas fixas">
        <div className="agenda-acoes">
          <Botao aoClicar={() => setFormulario({ conta: null })}>Nova conta fixa</Botao>
        </div>
        {fixas.erro && <Aviso tipo="erro">{fixas.erro}</Aviso>}
        {fixas.carregando && !fixas.dados && <Carregando />}
        {fixas.dados && fixas.dados.length === 0 && (
          <Vazio icone="calendario" titulo="Nenhuma conta fixa" texto="Cadastre aluguel, salário ou mensalidades." />
        )}
        {fixas.dados && fixas.dados.length > 0 && (
          <ul className="agenda-lista">
            {fixas.dados.map((c) => (
              <li key={c.id} className="agenda-item">
                <div className="agenda-item-texto">
                  <strong>{c.descricao}</strong>
                  <span className="agenda-item-origem">
                    {rotuloDe(TIPOS_CONTA_FIXA, c.tipo)} · todo dia {c.diaDoMes}
                  </span>
                </div>
                <div className="agenda-item-direita">
                  <Valor valor={c.valor} sentido={c.tipo === 'RECEITA' ? 'entrada' : 'saida'} />
                  {!c.ativa && <Selo>Inativa</Selo>}
                </div>
                <div className="agenda-item-acao agenda-acoes">
                  <Botao variante="texto" aoClicar={() => setFormulario({ conta: c })}>
                    Editar
                  </Botao>
                  <Botao variante="perigo" aoClicar={() => setAApagar(c)}>
                    Excluir
                  </Botao>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Cartao>

      <Modal
        aberto={formulario !== null}
        titulo={formulario?.conta ? 'Editar conta fixa' : 'Nova conta fixa'}
        aoFechar={() => setFormulario(null)}
      >
        {formulario && (
          <FormContaFixa
            key={formulario.conta?.id ?? 'nova'}
            conta={formulario.conta}
            categorias={categorias.dados ?? []}
            contas={contas.dados ?? []}
            aoSalvo={() => {
              setFormulario(null);
              atualizarTudo();
            }}
          />
        )}
      </Modal>

      <Modal
        aberto={aApagar !== null}
        titulo="Excluir conta fixa"
        aoFechar={() => {
          if (!ocupadoApagar) setAApagar(null);
        }}
      >
        {aApagar && (
          <div>
            {erroApagar && <Aviso tipo="erro">{erroApagar}</Aviso>}
            <p>
              {`Excluir "${aApagar.descricao}"? Ela sai da agenda de todos os meses, e as marcas de paga também. Não dá para desfazer.`}
            </p>
            <div className="pagina-acoes">
              <Botao variante="secundario" aoClicar={() => setAApagar(null)} desabilitado={ocupadoApagar}>
                Cancelar
              </Botao>
              <Botao variante="perigo" aoClicar={confirmarApagar} desabilitado={ocupadoApagar}>
                Excluir
              </Botao>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

// ---------- Fluxo de caixa ----------

const colunasFluxo: ColunaTabela<LinhaFluxo>[] = [
  { titulo: 'Mês', celula: (m) => mesCurto(m.mes) },
  { titulo: 'Entradas', alinhar: 'direita', celula: (m) => formatarReais(m.entradas) },
  { titulo: 'Saídas', alinhar: 'direita', celula: (m) => formatarReais(m.saidas) },
  { titulo: 'Faturas', alinhar: 'direita', celula: (m) => formatarReais(m.faturas) },
  {
    titulo: 'Saldo final',
    alinhar: 'direita',
    celula: (m) => <span className={m.saldoFinal < 0 ? 'agenda-negativo' : 'agenda-positivo'}>{formatarReais(m.saldoFinal)}</span>,
  },
];

function Fluxo() {
  const [quantos, setQuantos] = useState('6');
  const fluxo = useDados<FluxoDTO>(`/fluxo?meses=${quantos}`);
  const dados = fluxo.dados;

  return (
    <>
      <div className="agenda-controles">
        <Selecao
          rotulo="Período"
          valor={quantos}
          aoMudar={setQuantos}
          opcoes={[
            { valor: '3', rotulo: 'Próximos 3 meses' },
            { valor: '6', rotulo: 'Próximos 6 meses' },
            { valor: '12', rotulo: 'Próximos 12 meses' },
          ]}
        />
      </div>

      {fluxo.erro && <Aviso tipo="erro">{fluxo.erro}</Aviso>}
      {fluxo.carregando && !dados && <Carregando />}

      {dados && (
        <>
          <p className="agenda-texto-suave">
            Saldo atual das contas: <strong>{formatarReais(dados.saldoInicial)}</strong>
          </p>
          <Cartao>
            <GraficoLinhas
              rotulos={dados.meses.map((m) => mesCurto(m.mes))}
              series={[
                {
                  nome: 'Saldo final',
                  cor: 'var(--cor-primaria)',
                  valores: dados.meses.map((m) => m.saldoFinal),
                },
              ]}
              formato={(v) => formatoCompacto.format(v)}
              descricao="Saldo final projetado mês a mês"
            />
          </Cartao>
          <Tabela colunas={colunasFluxo} dados={dados.meses} chave={(m) => m.mes} />
        </>
      )}

      <Aviso tipo="info">
        Projeção com o que já está cadastrado: contas fixas, faturas e parcelas. Gastos do dia a dia não entram.
      </Aviso>
    </>
  );
}

// ---------- Tela ----------

export function Agenda() {
  const [aba, setAba] = useState<'calendario' | 'fluxo'>('calendario');
  return (
    <Pagina titulo="Contas a pagar">
      <Abas
        abas={[
          { id: 'calendario', rotulo: 'Calendário' },
          { id: 'fluxo', rotulo: 'Fluxo de caixa' },
        ]}
        ativa={aba}
        aoMudar={(id) => setAba(id === 'fluxo' ? 'fluxo' : 'calendario')}
      />
      {aba === 'calendario' ? <Calendario /> : <Fluxo />}
    </Pagina>
  );
}
