import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
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

// ---------- Atalhos por perfil ----------

interface Atalho {
  rotulo: string;
  icone: NomeIcone;
  caminho: string;
}

const ATALHOS: Atalho[] = [
  { rotulo: 'Novo lançamento', icone: 'transacoes', caminho: '/app/transacoes' },
  { rotulo: 'Contas', icone: 'contas', caminho: '/app/contas' },
  { rotulo: 'Cartões e faturas', icone: 'cartao', caminho: '/app/cartoes' },
  { rotulo: 'Investimentos', icone: 'investimentos', caminho: '/app/investimentos' },
  { rotulo: 'Orçamento', icone: 'orcamento', caminho: '/app/orcamento' },
  { rotulo: 'Metas', icone: 'metas', caminho: '/app/metas' },
  { rotulo: 'Importar arquivo', icone: 'importar', caminho: '/app/importar' },
  { rotulo: 'Categorias', icone: 'categorias', caminho: '/app/categorias' },
  { rotulo: 'Configurações', icone: 'engrenagem', caminho: '/app/configuracoes' },
];

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

// ---------- Tela inicial ----------

export function Painel() {
  const { usuario } = useAuth();
  const resumo = useDados<RespostaResumo>('/painel/resumo');
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
  const atalhos = ATALHOS;

  const pontos = dados ? dados.desempenho.slice(-periodo) : [];
  const temValor = pontos.some((p) => p.valor !== null);

  const avisos = dados?.recentes ?? [];

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
