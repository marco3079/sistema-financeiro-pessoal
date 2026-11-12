import { useState } from 'react';
import { api } from '../../lib/api';
import { formatarDia, formatarReais, mensagemErro, rotuloDe, TIPOS_INVESTIMENTO } from '../../lib/financas';
import { useDados } from '../../lib/useDados';
import { Aviso, Botao, Cartao, Carregando, Pagina, Tabela } from '../../ui';
import { ResumoItem, Vazio } from '../../ui/financas';
import type { ComparacaoIndice, RelatorioRendimento } from './tipos';
import './rendimento.css';

// 12.34 -> "+12,34%"; -3.2 -> "-3,20%"; null -> "—"
function pct(valor: number | null): string {
  if (valor === null) return '—';
  const sinal = valor > 0 ? '+' : '';
  return `${sinal}${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

// "+R$ 1.234,56" / "-R$ 1.234,56"; null -> "—"
function reaisComSinal(valor: number | null): string {
  if (valor === null) return '—';
  const sinal = valor > 0 ? '+' : valor < 0 ? '-' : '';
  return `${sinal}${formatarReais(Math.abs(valor))}`;
}

// classe CSS pela direção: positivo -> verde, negativo -> vermelho, 0 ou null -> sem classe
function classeDoSinal(valor: number | null): string {
  if (valor === null) return '';
  if (valor > 0) return 'rend-positivo';
  if (valor < 0) return 'rend-negativo';
  return '';
}

// Barras comparando a carteira com cada índice. A largura é proporcional ao maior valor (mínimo 2%).
function Barras({ relatorio }: { relatorio: RelatorioRendimento }) {
  const linhas = [
    { chave: 'carteira', rotulo: 'Sua carteira', valor: relatorio.carteira.saldo, daCarteira: true },
    ...relatorio.carteira.comparacao
      .filter((c) => c.valorHoje !== null)
      .map((c) => ({ chave: c.indice, rotulo: c.rotulo, valor: c.valorHoje ?? 0, daCarteira: false })),
  ];
  const maior = Math.max(0, ...linhas.map((l) => Math.max(0, l.valor)));

  return (
    <div className="rend-barras">
      {linhas.map((l) => {
        const largura = maior > 0 ? Math.max(2, (Math.max(0, l.valor) / maior) * 100) : 2;
        return (
          <div className="rend-linha" key={l.chave}>
            <span className="rend-rotulo">{l.rotulo}</span>
            <div className="rend-trilho">
              <div
                className={l.daCarteira ? 'rend-barra rend-barra-carteira' : 'rend-barra rend-barra-indice'}
                style={{ width: `${largura}%` }}
              />
            </div>
            <span className="rend-valor">{formatarReais(l.valor)}</span>
          </div>
        );
      })}
    </div>
  );
}

export function Rendimento() {
  const { dados, carregando, erro } = useDados<RelatorioRendimento>('/rendimento');
  const [atualizado, setAtualizado] = useState<RelatorioRendimento | null>(null);
  const [atualizando, setAtualizando] = useState(false);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const relatorio = atualizado ?? dados;

  async function atualizar(): Promise<void> {
    setAtualizando(true);
    setErroAcao(null);
    try {
      setAtualizado(await api.post<RelatorioRendimento>('/rendimento/atualizar', {}));
    } catch (e) {
      setErroAcao(mensagemErro(e));
    } finally {
      setAtualizando(false);
    }
  }

  const botaoAtualizar = (
    <Botao variante="secundario" desabilitado={atualizando} aoClicar={() => void atualizar()}>
      {atualizando ? 'Atualizando…' : 'Atualizar índices'}
    </Botao>
  );

  if (!relatorio) {
    return (
      <Pagina titulo="Rendimento" acoes={botaoAtualizar}>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {erroAcao && <Aviso tipo="erro">{erroAcao}</Aviso>}
        {!erro && !erroAcao && (
          <>
            <Carregando />
            <p className="fin-suave">
              Buscando Selic, IPCA, Ibovespa e IFIX. Na primeira vez pode levar alguns segundos.
            </p>
          </>
        )}
      </Pagina>
    );
  }

  const { carteira, rendaFixa, projecao, semHistorico } = relatorio;
  const semInvestimentos = carteira.ativos === 0 && semHistorico.length === 0;

  return (
    <Pagina titulo="Rendimento" acoes={botaoAtualizar}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {erroAcao && <Aviso tipo="erro">{erroAcao}</Aviso>}
      {relatorio.avisos.map((texto, i) => (
        <Aviso key={i} tipo="info">
          {texto}
        </Aviso>
      ))}

      {semInvestimentos ? (
        <Vazio
          icone="investimentos"
          titulo="Nenhum investimento com histórico"
          texto="Importe a planilha de movimentação da B3 em Importar ou cadastre seus investimentos para comparar com os índices."
        />
      ) : (
        <>
          <div className="resumo">
            <ResumoItem icone="investimentos" cor="azul" valor={formatarReais(carteira.saldo)} rotulo="Valor hoje" />
            <ResumoItem
              icone="seta-cima"
              cor="verde"
              valor={reaisComSinal(carteira.ganho)}
              rotulo="Ganho total (com proventos)"
            />
            <ResumoItem icone="financeiro" cor="roxo" valor={pct(carteira.taxaAnual)} rotulo="Rentabilidade ao ano" />
            <ResumoItem
              icone="transacoes"
              cor="laranja"
              valor={formatarReais(carteira.proventos)}
              rotulo="Proventos recebidos"
            />
          </div>

          <Cartao titulo="Sua carteira contra os índices">
            <p className="fin-suave">
              Quanto os mesmos aportes e retiradas, nas mesmas datas, valeriam hoje se tivessem seguido cada índice.
              Desde {formatarDia(carteira.desde)}.
            </p>
            <Barras relatorio={relatorio} />
            <Tabela<ComparacaoIndice>
              chave={(c) => c.indice}
              dados={carteira.comparacao}
              colunas={[
                { titulo: 'Índice', celula: (c) => c.rotulo },
                {
                  titulo: 'Valeria hoje',
                  alinhar: 'direita',
                  celula: (c) => (c.valorHoje === null ? '—' : formatarReais(c.valorHoje)),
                },
                { titulo: 'Ganho', alinhar: 'direita', celula: (c) => reaisComSinal(c.ganho) },
                { titulo: 'Ao ano', alinhar: 'direita', celula: (c) => pct(c.taxaAnual) },
                {
                  titulo: 'Sua carteira rendeu',
                  alinhar: 'direita',
                  celula: (c) => (
                    <span className={classeDoSinal(c.diferenca)}>
                      {c.diferenca === null
                        ? '—'
                        : reaisComSinal(c.diferenca) + (c.diferenca >= 0 ? ' a mais' : ' a menos')}
                    </span>
                  ),
                },
              ]}
            />
          </Cartao>

          <Cartao titulo="Por classe de ativo">
            <Tabela<(typeof relatorio.classes)[number]>
              chave={(c) => c.tipo}
              dados={relatorio.classes}
              colunas={[
                {
                  titulo: 'Classe',
                  celula: (c) => (
                    <>
                      <strong>{rotuloDe(TIPOS_INVESTIMENTO, c.tipo)}</strong>
                      <span className="rend-sub">
                        {c.ativos} {c.ativos === 1 ? 'ativo' : 'ativos'}
                      </span>
                    </>
                  ),
                },
                { titulo: 'Aplicado', alinhar: 'direita', celula: (c) => formatarReais(c.aportes) },
                { titulo: 'Valor hoje', alinhar: 'direita', celula: (c) => formatarReais(c.saldo) },
                { titulo: 'Proventos', alinhar: 'direita', celula: (c) => formatarReais(c.proventos) },
                {
                  titulo: 'Ganho',
                  alinhar: 'direita',
                  celula: (c) => <span className={classeDoSinal(c.ganho)}>{reaisComSinal(c.ganho)}</span>,
                },
                { titulo: 'Ao ano', alinhar: 'direita', celula: (c) => pct(c.taxaAnual) },
                {
                  titulo: 'Referência',
                  celula: (c) => `${c.rotuloIndice}: ${pct(c.taxaAnualDoIndice)} ao ano`,
                },
                {
                  titulo: 'Diferença',
                  alinhar: 'direita',
                  celula: (c) => <span className={classeDoSinal(c.diferenca)}>{reaisComSinal(c.diferenca)}</span>,
                },
              ]}
            />
          </Cartao>

          <Cartao titulo="Por ativo">
            <Tabela<(typeof relatorio.ativos)[number]>
              chave={(a) => a.id}
              dados={relatorio.ativos}
              vazio="Nenhum ativo com histórico."
              colunas={[
                {
                  titulo: 'Ativo',
                  celula: (a) => (
                    <>
                      <strong>{a.codigo ?? a.nome}</strong>
                      {a.codigo ? <span className="rend-sub">{a.nome}</span> : null}
                    </>
                  ),
                },
                { titulo: 'Desde', celula: (a) => formatarDia(a.desde) },
                { titulo: 'Aplicado', alinhar: 'direita', celula: (a) => formatarReais(a.aportes) },
                { titulo: 'Valor hoje', alinhar: 'direita', celula: (a) => formatarReais(a.saldo) },
                { titulo: 'Proventos', alinhar: 'direita', celula: (a) => formatarReais(a.proventos) },
                {
                  titulo: 'Ganho',
                  alinhar: 'direita',
                  celula: (a) => <span className={classeDoSinal(a.ganho)}>{reaisComSinal(a.ganho)}</span>,
                },
                { titulo: 'Rentabilidade', alinhar: 'direita', celula: (a) => pct(a.rentabilidade) },
                { titulo: 'Ao ano', alinhar: 'direita', celula: (a) => pct(a.taxaAnual) },
                {
                  titulo: 'Contra o índice',
                  alinhar: 'direita',
                  celula: (a) => (
                    <span className={classeDoSinal(a.diferenca)}>
                      {a.rotuloIndice}: {reaisComSinal(a.diferenca)}
                    </span>
                  ),
                },
              ]}
            />
          </Cartao>

          {semHistorico.length > 0 && (
            <Cartao titulo="Fora da comparação">
              <p className="fin-suave">
                Estes ativos não têm aplicação registrada, então não dá para saber quando o dinheiro entrou.
              </p>
              <ul className="rend-lista">
                {semHistorico.map((s) => (
                  <li key={s.id}>
                    {s.nome} — {formatarReais(s.saldo)}
                  </li>
                ))}
              </ul>
            </Cartao>
          )}

          <Cartao titulo="Projeção para 12 meses">
            <div className="resumo">
              <ResumoItem icone="investimentos" cor="azul" valor={formatarReais(projecao.saldo)} rotulo="Hoje" />
              <ResumoItem icone="seta-cima" cor="verde" valor={formatarReais(projecao.projetado)} rotulo="Em 12 meses" />
              <ResumoItem
                icone="financeiro"
                cor="roxo"
                valor={`${reaisComSinal(projecao.ganho)} (${pct(projecao.taxa)})`}
                rotulo="Ganho estimado"
              />
            </div>
            <Tabela<(typeof projecao.classes)[number]>
              chave={(c) => c.tipo}
              dados={projecao.classes}
              colunas={[
                { titulo: 'Classe', celula: (c) => rotuloDe(TIPOS_INVESTIMENTO, c.tipo) },
                { titulo: 'Hoje', alinhar: 'direita', celula: (c) => formatarReais(c.saldo) },
                {
                  titulo: 'Taxa usada',
                  celula: (c) => (
                    <>
                      {pct(c.taxa)}
                      <span className="rend-sub">{c.referencia}</span>
                    </>
                  ),
                },
                { titulo: 'Em 12 meses', alinhar: 'direita', celula: (c) => formatarReais(c.projetado) },
              ]}
            />
            <Aviso tipo="info">
              Estimativa: supõe que cada classe repete o que o índice dela rendeu nos últimos 12 meses. Rendimento
              passado não garante rendimento futuro.
            </Aviso>
          </Cartao>
        </>
      )}

      <Cartao titulo="Renda fixa pela taxa">
        <p className="fin-suave">
          Títulos sem cotação têm o saldo corrigido pela taxa informada no cadastro ("110% do CDI", "IPCA + 6%", "12%
          a.a.").
        </p>
        {rendaFixa.estimados.length > 0 && (
          <Tabela
            chave={(e) => e.id}
            dados={rendaFixa.estimados}
            colunas={[
              { titulo: 'Título', celula: (e) => e.nome },
              { titulo: 'Taxa', celula: (e) => e.regra },
              { titulo: 'Saldo estimado', alinhar: 'direita', celula: (e) => formatarReais(e.saldo) },
            ]}
          />
        )}
        {rendaFixa.semEstimativa.length > 0 && (
          <>
            <h3 className="rend-subtitulo">Sem estimativa</h3>
            <ul className="rend-lista fin-suave">
              {rendaFixa.semEstimativa.map((s) => (
                <li key={s.id}>
                  {s.nome} — {s.motivo}
                </li>
              ))}
            </ul>
          </>
        )}
        {rendaFixa.estimados.length === 0 && rendaFixa.semEstimativa.length === 0 && (
          <p className="fin-suave">Nenhum título de renda fixa cadastrado.</p>
        )}
      </Cartao>

      <Cartao titulo="Índices de referência">
        <Tabela
          chave={(i) => i.indice}
          dados={relatorio.indices}
          colunas={[
            { titulo: 'Índice', celula: (i) => i.rotulo },
            {
              titulo: '12 meses',
              alinhar: 'direita',
              celula: (i) => <span className={classeDoSinal(i.retorno12m)}>{pct(i.retorno12m)}</span>,
            },
            {
              titulo: 'No ano',
              alinhar: 'direita',
              celula: (i) => <span className={classeDoSinal(i.retornoNoAno)}>{pct(i.retornoNoAno)}</span>,
            },
            { titulo: 'Último dado', celula: (i) => formatarDia(i.ultimaData) },
          ]}
        />
        <p className="fin-suave">Selic e IPCA: Banco Central. Ibovespa e IFIX: B3.</p>
      </Cartao>
    </Pagina>
  );
}
