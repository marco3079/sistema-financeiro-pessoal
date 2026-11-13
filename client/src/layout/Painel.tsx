import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { formatarDia, formatarReais, hojeISO, mesAtual } from '../lib/financas';
import { useDados } from '../lib/useDados';
import { Aviso, Carregando } from '../ui';
import { Icone } from '../ui/icones';
import type { NomeIcone } from '../ui/icones';
import { GraficoLinha } from './GraficoLinha';
import './painel.css';

// ---------- Contrato de GET /api/painel/resumo ----------

type CorCartao = 'azul' | 'roxo' | 'verde' | 'laranja';

interface CartaoIndicador {
  chave: string;
  rotulo: string;
  valor: string;
  icone: NomeIcone;
  cor: CorCartao;
  variacao: number | null;
}

interface PontoDesempenho {
  mes: string;
  rotulo: string;
  valor: number | null;
}

interface Destaque {
  etiqueta: string;
  titulo: string;
  subtitulo: string;
  caminho: string;
}

interface RespostaResumo {
  primeiroNome: string;
  cartoes: CartaoIndicador[];
  desempenho: PontoDesempenho[];
  destaque: Destaque | null;
  recentes: LancamentoRecente[];
}

interface LancamentoRecente {
  id: number;
  titulo: string;
  corpo: string;
  valor: string;
  criadoEm: string;
}

// ---------- Contratos de GET /api/agenda, /api/fluxo e /api/alertas ----------

interface ItemAgendaPainel {
  chave: string;
  descricao: string;
  tipo: 'DESPESA' | 'RECEITA';
  valor: number;
  data: string;
  situacao: 'PAGA' | 'ABERTA' | 'ATRASADA';
}

interface RespostaAgenda {
  mes: string;
  itens: ItemAgendaPainel[];
}

interface MesFluxo {
  mes: string;
  saldoFinal: number;
}

interface RespostaFluxo {
  saldoInicial: number;
  meses: MesFluxo[];
}

interface AlertaPainel {
  tipo: string;
  gravidade: 'alta' | 'media';
  titulo: string;
  texto: string;
}

interface RespostaAlertas {
  alertas: AlertaPainel[];
  analisados: number;
}

// ---------- Atalhos ----------

interface Atalho {
  rotulo: string;
  icone: NomeIcone;
  caminho: string;
}

const ATALHOS: Atalho[] = [
  { rotulo: 'Lançar rápido', icone: 'raio', caminho: '/app/rapido' },
  { rotulo: 'Importar', icone: 'importar', caminho: '/app/importar' },
  { rotulo: 'Contas a pagar', icone: 'calendario', caminho: '/app/agenda' },
  { rotulo: 'Carteira', icone: 'investimentos', caminho: '/app/carteira' },
  { rotulo: 'Análise', icone: 'transacoes', caminho: '/app/analise' },
  { rotulo: 'Relatório do mês', icone: 'documento', caminho: '/app/relatorio-mensal' },
];

// Telas de escrita: o LEITOR (somente leitura) não vê o atalho nem o link.
const CAMINHOS_DE_ESCRITA = ['/app/rapido', '/app/importar', '/app/agenda'];

// ---------- Formatação ----------

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const CORES_AVISOS: CorCartao[] = ['azul', 'roxo', 'verde'];
const PERIODOS: { valor: number; rotulo: string }[] = [
  { valor: 3, rotulo: 'Últimos 3 meses' },
  { valor: 6, rotulo: 'Últimos 6 meses' },
  { valor: 12, rotulo: 'Últimos 12 meses' },
];

function dataPorExtenso(d: Date): string {
  return `${DIAS[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

function horaCurta(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatarVariacao(variacao: number): string {
  const sinal = variacao >= 0 ? '+' : '-';
  const numero = Math.abs(variacao).toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return `${sinal}${numero}%`;
}

function primeiroNomeDe(nome: string | undefined): string {
  return nome?.trim().split(/\s+/)[0] ?? '';
}

// Dias de calendário entre duas datas AAAA-MM-DD (negativo se a data já passou).
function diasEntre(data: string, hoje: string): number {
  const [a1, m1, d1] = data.slice(0, 10).split('-').map(Number);
  const [a2, m2, d2] = hoje.slice(0, 10).split('-').map(Number);
  return Math.round((Date.UTC(a1, m1 - 1, d1) - Date.UTC(a2, m2 - 1, d2)) / 86400000);
}

type TomTexto = 'perigo' | 'aviso' | 'verde' | 'suave';

function textoPrazo(dias: number): { texto: string; tom: TomTexto } {
  if (dias < 0) {
    const atraso = -dias;
    return { texto: `Atrasada há ${atraso} ${atraso === 1 ? 'dia' : 'dias'}`, tom: 'perigo' };
  }
  if (dias === 0) return { texto: 'Vence hoje', tom: 'aviso' };
  return { texto: dias === 1 ? 'Falta 1 dia' : `Faltam ${dias} dias`, tom: 'suave' };
}

function rotuloCurtoMes(mes: string): string {
  return `${MESES[Number(mes.slice(5, 7)) - 1] ?? mes} ${mes.slice(0, 4)}`;
}

// ---------- Bloco genérico (carrega e falha sozinho) ----------

interface CartaoBlocoProps {
  titulo: string;
  icone: NomeIcone;
  carregando: boolean;
  erro: string | null;
  verTodos?: string;
  children?: ReactNode;
}

function CartaoBloco({ titulo, icone, carregando, erro, verTodos, children }: CartaoBlocoProps) {
  return (
    <section className="painel-cartao painel-bloco">
      <header className="painel-cartao-cabecalho">
        <Icone nome={icone} tamanho={20} className="painel-cartao-icone" />
        <h2 className="painel-cartao-titulo">{titulo}</h2>
        {verTodos && (
          <Link className="painel-ver-todos" to={verTodos}>
            Ver todos
            <Icone nome="seta-direita" tamanho={14} />
          </Link>
        )}
      </header>
      {carregando && <Carregando />}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {children}
    </section>
  );
}

// ---------- Tela inicial ----------

export function Painel() {
  const { usuario } = useAuth();
  const leitor = usuario?.perfil === 'LEITOR';
  const resumo = useDados<RespostaResumo>('/painel/resumo');
  const [mesCorrente] = useState<string>(() => mesAtual());
  const agenda = useDados<RespostaAgenda>(`/agenda?mes=${mesCorrente}`);
  const fluxo = useDados<RespostaFluxo>('/fluxo?meses=3');
  const alertas = useDados<RespostaAlertas>('/alertas');
  const [agora, setAgora] = useState<Date>(() => new Date());
  const [periodo, setPeriodo] = useState<number>(6);

  // A cada 30 s: acerta o relógio e busca os números de novo (só com a aba visível).
  const { recarregar } = resumo;
  useEffect(() => {
    const id = window.setInterval(() => {
      setAgora(new Date());
      if (document.visibilityState === 'visible') recarregar();
    }, 30000);
    return () => window.clearInterval(id);
  }, [recarregar]);

  const dados = resumo.dados;
  const primeiroNome = dados?.primeiroNome || primeiroNomeDe(usuario?.nome);
  const saudacao = primeiroNome ? `Olá, ${primeiroNome}!` : 'Olá!';
  const atalhos = leitor ? ATALHOS.filter((a) => !CAMINHOS_DE_ESCRITA.includes(a.caminho)) : ATALHOS;

  const pontos = dados ? dados.desempenho.slice(-periodo) : [];
  const temValor = pontos.some((p) => p.valor !== null);

  const avisos = dados?.recentes ?? [];

  const hoje = hojeISO();
  const proximos = agenda.dados?.itens.filter((i) => i.situacao !== 'PAGA').slice(0, 5) ?? [];
  const listaAlertas = alertas.dados?.alertas ?? [];
  const semAlertas = alertas.dados !== null && listaAlertas.length === 0;

  return (
    <section className="painel">
      <div className="painel-cabecalho">
        <div className="painel-boas-vindas">
          <h1 className="painel-saudacao">{saudacao}</h1>
          <p className="painel-subtitulo">Aqui está um resumo das suas finanças.</p>
          <span className="painel-traco" aria-hidden="true" />
        </div>
        <div className="painel-relogio">
          <p className="painel-data">
            <Icone nome="calendario" tamanho={18} />
            <span>{dataPorExtenso(agora)}</span>
          </p>
          <p className="painel-hora">{horaCurta(agora)}</p>
        </div>
      </div>

      {resumo.carregando && !dados && <Carregando />}
      {resumo.erro && <Aviso tipo="erro">{resumo.erro}</Aviso>}
      {dados && (
        <div className="painel-indicadores">
          {dados.cartoes.map((c) => (
            <article key={c.chave} className="painel-indicador">
              <div className={`painel-indicador-icone painel-cor-${c.cor}`}>
                <Icone nome={c.icone} tamanho={26} />
              </div>
              <div className="painel-indicador-texto">
                <span className="painel-indicador-valor">{c.valor}</span>
                <span className="painel-indicador-rotulo">{c.rotulo}</span>
              </div>
              {c.variacao !== null && (
                <span
                  className={`painel-variacao ${
                    c.variacao >= 0 ? 'painel-variacao-alta' : 'painel-variacao-baixa'
                  }`}
                >
                  <Icone nome={c.variacao >= 0 ? 'seta-cima' : 'seta-baixo'} tamanho={14} />
                  {formatarVariacao(c.variacao)}
                </span>
              )}
            </article>
          ))}
        </div>
      )}

      <div className="painel-faixa">
        <CartaoBloco
          titulo="Próximos vencimentos"
          icone="calendario"
          carregando={agenda.carregando && !agenda.dados}
          erro={agenda.erro}
          verTodos={leitor ? undefined : '/app/agenda'}
        >
          {agenda.dados &&
            (proximos.length === 0 ? (
              <p className="painel-vazio">Nenhuma conta em aberto neste mês.</p>
            ) : (
              <ul className="painel-lista">
                {proximos.map((item) => {
                  const prazo = textoPrazo(diasEntre(item.data, hoje));
                  return (
                    <li key={item.chave} className="painel-item">
                      <div className="painel-item-texto">
                        <span className="painel-item-titulo">{item.descricao}</span>
                        <span className="painel-item-corpo">
                          {formatarDia(item.data)} · {formatarReais(item.valor)}
                        </span>
                      </div>
                      <span className={`painel-item-prazo painel-tom-${prazo.tom}`}>{prazo.texto}</span>
                    </li>
                  );
                })}
              </ul>
            ))}
        </CartaoBloco>

        <CartaoBloco
          titulo="Saldo projetado"
          icone="grafico"
          carregando={fluxo.carregando && !fluxo.dados}
          erro={fluxo.erro}
        >
          {fluxo.dados && (
            <ul className="painel-lista">
              {fluxo.dados.meses.map((m) => (
                <li key={m.mes} className="painel-item">
                  <span className="painel-item-titulo">{rotuloCurtoMes(m.mes)}</span>
                  <span
                    className={`painel-saldo-valor painel-tom-${m.saldoFinal >= 0 ? 'verde' : 'perigo'}`}
                  >
                    {formatarReais(m.saldoFinal)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CartaoBloco>

        {!semAlertas && (
          <CartaoBloco
            titulo="Atenção"
            icone="sino"
            carregando={alertas.carregando && !alertas.dados}
            erro={alertas.erro}
            verTodos="/app/alertas"
          >
            {alertas.dados && (
              <>
                <p className="painel-bloco-resumo">
                  {listaAlertas.length} {listaAlertas.length === 1 ? 'alerta para conferir' : 'alertas para conferir'}
                </p>
                <ul className="painel-avisos-lista">
                  {listaAlertas.slice(0, 2).map((a, i) => (
                    <li key={`${a.tipo}-${i}`} className="painel-aviso">
                      <span className={`painel-aviso-marca painel-cor-${a.gravidade === 'alta' ? 'laranja' : 'roxo'}`}>
                        <span className="painel-aviso-bolinha" />
                      </span>
                      <div className="painel-aviso-texto">
                        <span className="painel-aviso-titulo">{a.titulo}</span>
                        <span className="painel-aviso-corpo">{a.texto}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </CartaoBloco>
        )}
      </div>

      <div
        className="painel-linha"
      >
        {(
          <section className="painel-cartao painel-desempenho">
            <header className="painel-cartao-cabecalho">
              <Icone nome="grafico" tamanho={20} className="painel-cartao-icone" />
              <h2 className="painel-cartao-titulo">Patrimônio por Mês</h2>
              <select
                className="painel-seletor"
                aria-label="Período do gráfico"
                value={periodo}
                disabled={!dados}
                onChange={(e) => setPeriodo(Number(e.target.value))}
              >
                {PERIODOS.map((p) => (
                  <option key={p.valor} value={p.valor}>
                    {p.rotulo}
                  </option>
                ))}
              </select>
            </header>
            {resumo.carregando && !dados && <Carregando />}
            {dados &&
              (temValor ? (
                <div className="painel-grafico-corpo">
                  <GraficoLinha pontos={pontos} />
                </div>
              ) : (
                <p className="painel-vazio">O gráfico aparece quando houver saldos registrados neste período.</p>
              ))}
          </section>
        )}

        {(
          <section className="painel-cartao painel-avisos">
            <header className="painel-cartao-cabecalho">
              <Icone nome="transacoes" tamanho={20} className="painel-cartao-icone" />
              <h2 className="painel-cartao-titulo">Lançamentos Recentes</h2>
              <Link className="painel-ver-todos" to="/app/transacoes">
                Ver todos
                <Icone nome="seta-direita" tamanho={14} />
              </Link>
            </header>
            {resumo.carregando && !dados && <Carregando />}
            {dados && avisos.length === 0 && <p className="painel-vazio">Nenhum lançamento por enquanto.</p>}
            {avisos.length > 0 && (
              <ul className="painel-avisos-lista">
                {avisos.map((c, i) => (
                  <li key={c.id} className="painel-aviso">
                    <span className={`painel-aviso-marca painel-cor-${CORES_AVISOS[i % 3]}`}>
                      <span className="painel-aviso-bolinha" />
                    </span>
                    <div className="painel-aviso-texto">
                      <span className="painel-aviso-titulo">{c.titulo}</span>
                      <span className="painel-aviso-corpo">
                        {c.valor} · {c.corpo}
                      </span>
                    </div>
                    <span className="painel-aviso-tempo">{c.criadoEm.slice(8, 10)}/{c.criadoEm.slice(5, 7)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <div className="painel-coluna">
          {!leitor && (
            <Link className="painel-lancar" to="/app/rapido">
              <Icone nome="raio" tamanho={26} />
              <span>Lançar gasto</span>
            </Link>
          )}

          {dados?.destaque && (
            <section className="painel-cartao painel-destaque">
              <div className="painel-destaque-texto">
                <span className="painel-destaque-etiqueta">
                  <Icone nome="estrela" tamanho={18} />
                  {dados.destaque.etiqueta}
                </span>
                <h2 className="painel-destaque-titulo">{dados.destaque.titulo}</h2>
                <p className="painel-destaque-subtitulo">{dados.destaque.subtitulo}</p>
                <Link className="painel-pilula" to={dados.destaque.caminho}>
                  Ver detalhes
                  <Icone nome="seta-direita" tamanho={14} />
                </Link>
              </div>
            </section>
          )}

          <section className="painel-cartao painel-atalhos">
            <header className="painel-cartao-cabecalho">
              <Icone nome="raio" tamanho={18} className="painel-cartao-icone" />
              <h2 className="painel-cartao-titulo">Atalhos Rápidos</h2>
            </header>
            <div className="painel-atalhos-grade">
              {atalhos.map((a) => (
                <Link key={a.rotulo} to={a.caminho} className="painel-atalho">
                  <Icone nome={a.icone} tamanho={22} />
                  <span>{a.rotulo}</span>
                </Link>
              ))}
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
