import { useState } from 'react';
import { api } from '../../lib/api';
import { formatarDia, formatarReais, mensagemErro } from '../../lib/financas';
import { useDados } from '../../lib/useDados';
import { Abas, Aviso, Botao, Cartao, Carregando, Pagina, Selo, Tabela } from '../../ui';
import type { ColunaTabela } from '../../ui';
import { ResumoItem } from '../../ui/financas';
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
}

interface Encerrada {
  ticker: string;
  inicio: string | null;
  encerramento: string | null;
  precoEntrada: number | null;
  precoSaida: number | null;
  retorno: number | null;
  quantidade: number;
  saldo: number;
}

interface Fora {
  ticker: string;
  nome: string;
  quantidade: number;
  saldo: number;
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

function SeloSituacao({ l }: { l: LinhaSuno }) {
  if (l.situacao === 'TEM') return <Selo cor="verde">Você tem</Selo>;
  if (l.situacao === 'COMPRAR') return <Selo cor="azul">Comprar · você não tem</Selo>;
  return <Selo cor="cinza">Aguardar · você não tem</Selo>;
}

function Instrucoes() {
  return (
    <Cartao titulo="Como trazer as carteiras da Suno">
      <ol className="suno-passos">
        <li>
          Em <strong>Conectar IA</strong>, crie uma chave com permissão <strong>consulta e lança</strong> e copie-a.
        </li>
        <li>
          Na pasta do sistema, rode no PowerShell:
          <code className="suno-codigo">{COMANDO}</code>
        </li>
        <li>
          Na primeira vez o script pede a chave e abre uma janela do Chrome: entre na sua conta da Suno nela. Ele lê as
          carteiras que você assina e manda para cá. Nas próximas vezes a janela já abre logada.
        </li>
      </ol>
      <p className="fin-suave">
        A senha da Suno fica só no navegador: o sistema não a recebe. Rode de novo sempre que quiser atualizar.
      </p>
    </Cartao>
  );
}

export function Suno() {
  const { dados, carregando, erro, recarregar } = useDados<{ carteiras: CarteiraSuno[] }>('/suno');
  const [ativa, setAtiva] = useState<string | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const carteiras = dados?.carteiras ?? [];
  const carteira = carteiras.find((c) => c.slug === ativa) ?? carteiras[0] ?? null;

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
      {dados && carteiras.length === 0 && <Instrucoes />}
      {carteira && (
        <>
          <Abas abas={carteiras.map((c) => ({ id: c.slug, rotulo: c.nome }))} ativa={carteira.slug} aoMudar={setAtiva} />
          <DetalheCarteira carteira={carteira} />
          <p className="fin-suave suno-rodape">
            Atualizada em {formatarDia(carteira.atualizadoNoDia)}. Para atualizar, rode <code>{COMANDO}</code>. O sistema
            só cruza o que a Suno publica com o que você tem: não é recomendação de compra ou venda.
          </p>
        </>
      )}
    </Pagina>
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
    { titulo: 'Sua alocação', alinhar: 'direita', celula: (l) => (l.situacao === 'TEM' ? pct(l.minhaAlocacao) : '—') },
    { titulo: 'Seu saldo', alinhar: 'direita', celula: (l) => (l.saldo > 0 ? formatarReais(l.saldo) : '—') },
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
    { titulo: 'Situação', celula: (l) => <SeloSituacao l={l} /> },
  ];

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
        {c.base > 0 && tipos && (
          <p className="fin-suave">
            "Para a alocação Suno" compara a alocação da Suno com o que você tem em {tipos} ({formatarReais(c.base)}): é
            quanto faltaria aportar (ou sobra) em cada ativo para ficar igual.
          </p>
        )}
        <Tabela<LinhaSuno> chave={(l) => l.ticker} dados={ordenadas} vazio="Nenhum ativo." colunas={colunas} />
      </Cartao>

      {c.encerradasQueTenho.length > 0 && (
        <Cartao titulo="Encerradas pela Suno que você ainda tem">
          <p className="fin-suave">A Suno tirou estes ativos da carteira; você ainda tem posição neles.</p>
          <Tabela<Encerrada>
            chave={(e) => e.ticker}
            dados={c.encerradasQueTenho}
            colunas={[
              { titulo: 'Ativo', celula: (e) => <strong>{e.ticker}</strong> },
              { titulo: 'Encerrada em', celula: (e) => formatarDia(e.encerramento) },
              { titulo: 'Preço de saída', alinhar: 'direita', celula: (e) => numero(e.precoSaida) },
              { titulo: 'Retorno Suno', alinhar: 'direita', celula: (e) => (e.retorno === null ? '—' : `${numero(e.retorno)}%`) },
              { titulo: 'Suas cotas', alinhar: 'direita', celula: (e) => numero(e.quantidade, 0) },
              { titulo: 'Seu saldo', alinhar: 'direita', celula: (e) => formatarReais(e.saldo) },
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
              { titulo: 'Seu saldo', alinhar: 'direita', celula: (f) => formatarReais(f.saldo) },
            ]}
          />
        </Cartao>
      )}
    </>
  );
}
