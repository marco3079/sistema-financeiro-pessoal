import { useState } from 'react';
import { api } from '../../lib/api';
import { formatarDia, formatarReais, mensagemErro } from '../../lib/financas';
import { useDados } from '../../lib/useDados';
import { Abas, Aviso, Botao, Cartao, Carregando, Pagina, Selo, Tabela } from '../../ui';
import type { ColunaTabela } from '../../ui';
import { ResumoItem } from '../../ui/financas';
import { AtualizarSuno } from './AtualizarSuno';
import './suno.css';

// Carteiras recomendadas da Suno (trazidas pelo script ferramentas/suno) cruzadas com a carteira da pessoa.

type Situacao = 'COMPRAR' | 'AGUARDAR' | 'TEM' | 'ENCERRADA' | 'FORA';

interface LinhaSuno {
  ticker: string;
  setor: string | null;
  vies: string | null;
  precoTeto: number | null;
  precoAtual: number | null;
  precoEntrada: number | null;
  dataEntrada: string | null;
  alocacao: number | null;
  dyEsperado: number | null;
  rentabilidade: number | null;
  situacao: Situacao;
  acimaDoTeto: boolean;
  quantidade: number;
  saldo: number;
  investimentoId: number | null;
  minhaAlocacao: number | null;
  diferenca: number | null;
  valorAplicado: number;
  retorno: number | null;
  retornoPct: number | null;
  proventos: number;
  retornoComProventosPct: number | null;
}

// Sua posição num ativo (calculada no servidor a partir dos seus investimentos e proventos).
interface MinhaPosicao {
  quantidade: number;
  saldo: number;
  valorAplicado: number;
  precoMedio: number | null;
  precoAtual: number | null;
  retorno: number | null;
  retornoPct: number | null;
  proventos: number;
  retornoComProventosPct: number | null;
  investimentoId: number;
}

interface Encerrada extends MinhaPosicao {
  ticker: string;
  inicio: string | null;
  encerramento: string | null;
  precoEntrada: number | null;
  precoSaida: number | null;
  retornoSuno: number | null; // retorno da recomendação na Suno, em %
  desdeASaidaPct: number | null; // quanto o preço andou desde a saída da Suno
}

interface Fora extends MinhaPosicao {
  ticker: string;
  nome: string;
}

interface AssinaturaSuno {
  plano: string;
  inicio: string | null;
  fim: string | null;
  diasParaVencer: number | null;
  atualizadoEm: string;
}

interface ForaDeTodas extends Fora {
  tipo: string;
  encerradaNa: string | null;
  encerradaEm: string | null;
}

interface RespostaSuno {
  carteiras: CarteiraSuno[];
  foraDeTodas: ForaDeTodas[];
  ultimaAtualizacao: string | null;
  assinatura: AssinaturaSuno | null;
}

interface TabelaBruta {
  titulo: string | null;
  colunas: string[];
  linhas: string[][];
}

interface CarteiraSuno {
  id: number;
  slug: string;
  nome: string;
  url: string;
  atualizadoEm: string;
  atualizadoNoDia: string;
  tiposComparados: string[];
  base: number;
  linhas: LinhaSuno[];
  outrasAlocacoes?: { nome: string; alocacao: number }[]; // renda fixa, Tesouro Selic...
  encerradasQueTenho: Encerrada[];
  fora: Fora[];
  resumo: { ativos: number; comprarQueNaoTenho: number; tenho: number; encerradasQueTenho: number; fora: number };
  tabelas: TabelaBruta[];
}

const COMANDO = 'powershell -ExecutionPolicy Bypass -File ferramentas\\suno\\sincronizar-suno.ps1';

function numero(valor: number | null, casas = 2): string {
  return valor === null ? '—' : valor.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

function pct(valor: number | null): string {
  return valor === null ? '—' : `${numero(valor, 1)}%`;
}

const ROTULO_TIPO: Record<string, string> = { FII: 'fundos imobiliários', ACAO: 'ações', ETF: 'ETFs' };

// Percentual com sinal e cor (verde ganho, vermelho perda).
function Percentual({ valor }: { valor: number | null }) {
  if (valor === null) return <span>—</span>;
  const classe = valor > 0 ? 'suno-ganho' : valor < 0 ? 'suno-perda' : undefined;
  return <span className={classe}>{`${valor > 0 ? '+' : ''}${numero(valor)}%`}</span>;
}

// Colunas da sua posição: retorno sem e com proventos, proventos recebidos e saldo.
type ComRetorno = Pick<MinhaPosicao, 'saldo' | 'valorAplicado' | 'retorno' | 'retornoPct' | 'proventos' | 'retornoComProventosPct'>;

function colunasDeRetorno<T extends ComRetorno>(): ColunaTabela<T>[] {
  return [
    {
      titulo: 'Seu retorno',
      alinhar: 'direita',
      celula: (p) =>
        p.retorno === null ? (
          '—'
        ) : (
          <span className="suno-ativo suno-direita">
            <span className={p.retorno >= 0 ? 'suno-ganho' : 'suno-perda'}>{formatarReais(p.retorno)}</span>
            <Percentual valor={p.retornoPct} />
          </span>
        ),
    },
    { titulo: 'Proventos recebidos', alinhar: 'direita', celula: (p) => (p.proventos > 0 ? formatarReais(p.proventos) : '—') },
    { titulo: 'Retorno c/ proventos', alinhar: 'direita', celula: (p) => <Percentual valor={p.retornoComProventosPct} /> },
    {
      titulo: 'Seu saldo',
      alinhar: 'direita',
      celula: (p) =>
        p.saldo <= 0 ? (
          '—'
        ) : (
        <span className="suno-ativo suno-direita">
          <span>{formatarReais(p.saldo)}</span>
          <span className="fin-suave suno-pequeno">aplicado {formatarReais(p.valorAplicado)}</span>
        </span>
      ),
    },
  ];
}

function SeloSituacao({ l }: { l: LinhaSuno }) {
  if (l.situacao === 'TEM') return <Selo cor="verde">Você tem</Selo>;
  if (l.situacao === 'COMPRAR') return <Selo cor="azul">Comprar · você não tem</Selo>;
  return <Selo cor="cinza">Aguardar · você não tem</Selo>;
}

function dataHora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Passo a passo para atualizar com a conta da Suno da pessoa (o login é pedido a cada atualização).
function ComoAtualizar({ primeiraVez }: { primeiraVez: boolean }) {
  return (
    <ol className="suno-passos">
      {primeiraVez && (
        <li>
          Em <strong>Conectar IA</strong>, crie uma chave com permissão <strong>consulta e lança</strong> e copie-a. O
          script pede a chave só na primeira vez.
        </li>
      )}
      <li>
        Na pasta do sistema, rode no PowerShell:
        <code className="suno-codigo">{COMANDO}</code>
      </li>
      <li>
        Abre uma janela do Chrome na página de login da Suno: entre com a <strong>sua</strong> conta. A cada atualização
        o login é pedido de novo; nada fica salvo.
      </li>
      <li>O script lê as carteiras que você assina e o seu plano, manda para cá e fecha a janela.</li>
    </ol>
  );
}

// Plano da Suno, vencimento e a data dos dados.
function SuaContaSuno({ dados, aoAtualizar }: { dados: RespostaSuno; aoAtualizar: () => void }) {
  const [mostrarComo, setMostrarComo] = useState(false);
  const a = dados.assinatura;
  const dias = a?.diasParaVencer ?? null;
  const vencimento =
    dias === null ? null : dias < 0 ? (
      <Selo cor="vermelho">Venceu há {Math.abs(dias)} dias</Selo>
    ) : dias <= 30 ? (
      <Selo cor="amarelo">Vence em {dias} dias</Selo>
    ) : (
      <Selo cor="verde">Vence em {dias} dias</Selo>
    );
  return (
    <Cartao titulo="Sua conta Suno">
      <div className="suno-conta">
        <div>
          <span className="fin-suave">Plano</span>
          <strong>{a?.plano ?? 'Não informado'}</strong>
        </div>
        <div>
          <span className="fin-suave">Vigência</span>
          <strong>{a?.fim ? `${formatarDia(a.inicio)} a ${formatarDia(a.fim)}` : '—'}</strong>
          {vencimento}
        </div>
        <div>
          <span className="fin-suave">Dados da Suno atualizados em</span>
          <strong>{dados.ultimaAtualizacao ? dataHora(dados.ultimaAtualizacao) : 'Nunca'}</strong>
        </div>
        <div className="suno-conta-acao">
          <Botao aoClicar={aoAtualizar}>Atualizar com a minha conta Suno</Botao>
          <Botao variante="texto" aoClicar={() => setMostrarComo(!mostrarComo)}>
            {mostrarComo ? 'Fechar' : 'Usar o script no computador'}
          </Botao>
        </div>
      </div>
      {mostrarComo && <ComoAtualizar primeiraVez={false} />}
    </Cartao>
  );
}

function Instrucoes({ aoAtualizar }: { aoAtualizar: () => void }) {
  const [mostrarComo, setMostrarComo] = useState(false);
  return (
    <Cartao titulo="Traga as carteiras da Suno">
      <p className="fin-suave">
        Entre com a sua conta da Suno: o sistema lê as carteiras que você assina e o seu plano, e compara com a sua
        carteira. A senha é usada só na atualização e não fica guardada.
      </p>
      <div className="pagina-acoes">
        <Botao variante="texto" aoClicar={() => setMostrarComo(!mostrarComo)}>
          {mostrarComo ? 'Fechar' : 'Usar o script no computador'}
        </Botao>
        <Botao aoClicar={aoAtualizar}>Atualizar com a minha conta Suno</Botao>
      </div>
      {mostrarComo && <ComoAtualizar primeiraVez />}
    </Cartao>
  );
}

export function Suno() {
  const { dados, carregando, erro, recarregar } = useDados<RespostaSuno>('/suno');
  const [ativa, setAtiva] = useState<string | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const [atualizando, setAtualizando] = useState(false);
  const carteiras = dados?.carteiras ?? [];
  const foraDeTodas = dados?.foraDeTodas ?? [];
  const naAbaFora = ativa === ABA_FORA && foraDeTodas.length > 0;
  const carteira = carteiras.find((c) => c.slug === ativa) ?? carteiras[0] ?? null;
  const abas = [
    ...carteiras.map((c) => ({ id: c.slug, rotulo: c.nome })),
    ...(foraDeTodas.length > 0 ? [{ id: ABA_FORA, rotulo: 'Fora das carteiras' }] : []),
  ];

  async function apagar() {
    if (!window.confirm('Apagar as carteiras da Suno guardadas aqui? Rode o script de novo para trazê-las.')) return;
    setErroAcao(null);
    try {
      await api.del('/suno');
      recarregar();
    } catch (e) {
      setErroAcao(mensagemErro(e));
    }
  }

  return (
    <Pagina
      titulo="Carteiras Suno"
      acoes={
        carteiras.length > 0 ? (
          <Botao variante="texto" aoClicar={apagar}>
            Apagar carteiras
          </Botao>
        ) : undefined
      }
    >
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {erroAcao && <Aviso tipo="erro">{erroAcao}</Aviso>}
      {carregando && !dados && <Carregando />}
      {dados && carteiras.length === 0 && <Instrucoes aoAtualizar={() => setAtualizando(true)} />}
      {dados && carteiras.length > 0 && <SuaContaSuno dados={dados} aoAtualizar={() => setAtualizando(true)} />}
      <AtualizarSuno aberto={atualizando} aoFechar={() => setAtualizando(false)} aoConcluir={recarregar} />
      {carteira && (
        <>
          <Abas abas={abas} ativa={naAbaFora ? ABA_FORA : carteira.slug} aoMudar={setAtiva} />
          {naAbaFora ? <ForaDasCarteiras lista={foraDeTodas} /> : <DetalheCarteira carteira={carteira} />}
          <p className="fin-suave suno-rodape">
            {naAbaFora
              ? 'Comparado com todas as carteiras da Suno que você assina.'
              : `Carteira ${carteira.nome} atualizada em ${dataHora(carteira.atualizadoEm)}.`}{' '}
            O sistema só cruza o que a Suno publica com o que você tem: não é recomendação de compra ou venda.
          </p>
        </>
      )}
    </Pagina>
  );
}

const ABA_FORA = '__fora-das-carteiras';
const ROTULO_TIPO_ATIVO: Record<string, string> = { FII: 'FII', ACAO: 'Ação', ETF: 'ETF', BDR: 'BDR' };

// Seus ativos que não aparecem na carteira recomendada de nenhuma carteira da Suno.
function ForaDasCarteiras({ lista }: { lista: ForaDeTodas[] }) {
  const total = lista.reduce((s, f) => s + f.saldo, 0);
  return (
    <Cartao titulo="Seus ativos fora das carteiras da Suno">
      <p className="fin-suave">
        {lista.length} {lista.length === 1 ? 'ativo' : 'ativos'} ({formatarReais(total)}) que não estão na carteira
        recomendada de nenhuma carteira da Suno que você assina. Quando a Suno já recomendou e encerrou, aparece em qual
        carteira e quando.
      </p>
      <Tabela<ForaDeTodas>
        chave={(f) => f.ticker}
        dados={lista}
        colunas={[
          {
            titulo: 'Ativo',
            celula: (f) => (
              <span className="suno-ativo">
                <strong>{f.ticker}</strong>
                <span className="fin-suave">{f.nome}</span>
              </span>
            ),
          },
          { titulo: 'Tipo', celula: (f) => ROTULO_TIPO_ATIVO[f.tipo] ?? f.tipo },
          {
            titulo: 'Na Suno',
            celula: (f) =>
              f.encerradaNa ? (
                <span className="suno-ativo">
                  <Selo cor="vermelho">Encerrada</Selo>
                  <span className="fin-suave suno-pequeno">
                    {f.encerradaNa}
                    {f.encerradaEm ? ` em ${formatarDia(f.encerradaEm)}` : ''}
                  </span>
                </span>
              ) : (
                <Selo cor="cinza">Nunca recomendada</Selo>
              ),
          },
          { titulo: 'Suas cotas', alinhar: 'direita', celula: (f) => numero(f.quantidade, 0) },
          { titulo: 'Seu preço médio', alinhar: 'direita', celula: (f) => numero(f.precoMedio) },
          { titulo: 'Preço hoje', alinhar: 'direita', celula: (f) => numero(f.precoAtual) },
          ...colunasDeRetorno<ForaDeTodas>(),
        ]}
      />
    </Cartao>
  );
}

function DetalheCarteira({ carteira: c }: { carteira: CarteiraSuno }) {
  const tipos = c.tiposComparados.map((t) => ROTULO_TIPO[t] ?? t).join(' e ');

  if (c.linhas.length === 0) {
    // Carteira sem colunas de ativos reconhecidas (renda fixa, reserva...): mostra as tabelas como vieram.
    return (
      <>
        {c.tabelas.map((t, i) => (
          <Cartao key={i} titulo={t.titulo ?? c.nome}>
            <div className="suno-rolagem">
              <table className="suno-bruta">
                <thead>
                  <tr>
                    {t.colunas.map((col, k) => (
                      <th key={k}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {t.linhas.map((l, k) => (
                    <tr key={k}>
                      {l.map((v, j) => (
                        <td key={j}>{v}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Cartao>
        ))}
      </>
    );
  }

  const colunas: ColunaTabela<LinhaSuno>[] = [
    {
      titulo: 'Ativo',
      celula: (l) => (
        <span className="suno-ativo">
          <strong>{l.ticker}</strong>
          {l.setor && <span className="fin-suave">{l.setor}</span>}
        </span>
      ),
    },
    {
      titulo: 'Viés Suno',
      celula: (l) => (l.vies ? <Selo cor={/compra/i.test(l.vies) ? 'verde' : 'amarelo'}>{l.vies}</Selo> : '—'),
    },
    {
      titulo: 'Preço / teto',
      alinhar: 'direita',
      celula: (l) => (
        <span className="suno-ativo suno-direita">
          <span>
            {numero(l.precoAtual)} / {numero(l.precoTeto)}
          </span>
          {l.acimaDoTeto && <span className="suno-alerta">acima do teto</span>}
        </span>
      ),
    },
    { titulo: 'DY esperado', alinhar: 'direita', celula: (l) => pct(l.dyEsperado) },
    { titulo: 'Alocação Suno', alinhar: 'direita', celula: (l) => pct(l.alocacao) },
  ];
  // Sem nada do tipo da carteira (ex.: só FIIs numa carteira de ações), as colunas da sua posição ficariam vazias.
  const temPosicao = c.base > 0 || c.linhas.some((l) => l.saldo > 0);
  const colunasDaPosicao: ColunaTabela<LinhaSuno>[] = [
    { titulo: 'Sua alocação', alinhar: 'direita', celula: (l) => (l.situacao === 'TEM' ? pct(l.minhaAlocacao) : '—') },
    ...colunasDeRetorno<LinhaSuno>(),
    {
      titulo: 'Para a alocação Suno',
      alinhar: 'direita',
      celula: (l) =>
        l.diferenca === null ? (
          '—'
        ) : (
          <span className={l.diferenca >= 0 ? 'suno-falta' : 'suno-sobra'}>
            {l.diferenca >= 0 ? 'faltam ' : 'sobram '}
            {formatarReais(Math.abs(l.diferenca))}
          </span>
        ),
    },
  ];
  colunas.push(...(temPosicao ? colunasDaPosicao : []), { titulo: 'Situação', celula: (l) => <SeloSituacao l={l} /> });

  const ordenadas = [...c.linhas].sort((a, b) => {
    const ordem: Record<Situacao, number> = { COMPRAR: 0, TEM: 1, AGUARDAR: 2, ENCERRADA: 3, FORA: 4 };
    return ordem[a.situacao] - ordem[b.situacao] || (b.diferenca ?? 0) - (a.diferenca ?? 0);
  });

  return (
    <>
      <div className="resumo">
        <ResumoItem icone="investimentos" cor="azul" valor={c.resumo.ativos} rotulo="Ativos na carteira Suno" />
        <ResumoItem icone="seta-cima" cor="verde" valor={c.resumo.comprarQueNaoTenho} rotulo="Com viés comprar que você não tem" />
        <ResumoItem icone="visto" cor="roxo" valor={c.resumo.tenho} rotulo="Da carteira Suno que você tem" />
        <ResumoItem
          icone="seta-baixo"
          cor="vermelho"
          valor={c.resumo.encerradasQueTenho}
          rotulo="Encerradas pela Suno que você ainda tem"
        />
      </div>

      <Cartao titulo={`Carteira recomendada: ${c.nome}`}>
        {!temPosicao && tipos && (
          <p className="fin-suave">
            Você não tem {tipos} na sua carteira, então as colunas da sua posição (alocação, retorno, proventos e saldo)
            ficam de fora desta tabela.
          </p>
        )}
        {c.base > 0 && tipos && (
          <p className="fin-suave">
            "Para a alocação Suno" compara a alocação da Suno com o que você tem em {tipos} ({formatarReais(c.base)}): é
            quanto faltaria aportar (ou sobra) em cada ativo para ficar igual.
          </p>
        )}
        <Tabela<LinhaSuno> chave={(l) => l.ticker} dados={ordenadas} vazio="Nenhum ativo." colunas={colunas} />
        {(c.outrasAlocacoes ?? []).length > 0 && (
          <p className="fin-suave">
            Além dos ativos, a carteira tem{' '}
            {(c.outrasAlocacoes ?? []).map((o) => `${pct(o.alocacao)} em ${o.nome.toLowerCase()}`).join(', ')}.
          </p>
        )}
      </Cartao>

      {c.encerradasQueTenho.length > 0 && (
        <Cartao titulo="Encerradas pela Suno que você ainda tem">
          <p className="fin-suave">
            A Suno tirou estes ativos da carteira; você ainda tem posição neles. "Desde a saída" é quanto o preço andou
            depois que a Suno saiu; o seu retorno compara o saldo de hoje com o que você aplicou.
          </p>
          <Tabela<Encerrada>
            chave={(e) => e.ticker}
            dados={c.encerradasQueTenho}
            colunas={[
              {
                titulo: 'Ativo',
                celula: (e) => (
                  <span className="suno-ativo">
                    <strong>{e.ticker}</strong>
                    <span className="fin-suave">encerrada em {formatarDia(e.encerramento)}</span>
                  </span>
                ),
              },
              {
                titulo: 'Suno: saída / retorno',
                alinhar: 'direita',
                celula: (e) => (
                  <span className="suno-ativo suno-direita">
                    <span>{numero(e.precoSaida)}</span>
                    <Percentual valor={e.retornoSuno} />
                  </span>
                ),
              },
              { titulo: 'Suas cotas', alinhar: 'direita', celula: (e) => numero(e.quantidade, 0) },
              { titulo: 'Seu preço médio', alinhar: 'direita', celula: (e) => numero(e.precoMedio) },
              {
                titulo: 'Preço hoje',
                alinhar: 'direita',
                celula: (e) => (
                  <span className="suno-ativo suno-direita">
                    <span>{numero(e.precoAtual)}</span>
                    {e.desdeASaidaPct !== null && (
                      <span className="fin-suave suno-pequeno">
                        <Percentual valor={e.desdeASaidaPct} /> desde a saída
                      </span>
                    )}
                  </span>
                ),
              },
              ...colunasDeRetorno<Encerrada>(),
            ]}
          />
        </Cartao>
      )}

      {c.fora.length > 0 && (
        <Cartao titulo={`Você tem, mas não estão na carteira ${c.nome}`}>
          <Tabela<Fora>
            chave={(f) => f.ticker}
            dados={c.fora}
            colunas={[
              {
                titulo: 'Ativo',
                celula: (f) => (
                  <span className="suno-ativo">
                    <strong>{f.ticker}</strong>
                    <span className="fin-suave">{f.nome}</span>
                  </span>
                ),
              },
              { titulo: 'Suas cotas', alinhar: 'direita', celula: (f) => numero(f.quantidade, 0) },
              { titulo: 'Seu preço médio', alinhar: 'direita', celula: (f) => numero(f.precoMedio) },
              { titulo: 'Preço hoje', alinhar: 'direita', celula: (f) => numero(f.precoAtual) },
              ...colunasDeRetorno<Fora>(),
            ]}
          />
        </Cartao>
      )}
    </>
  );
}
