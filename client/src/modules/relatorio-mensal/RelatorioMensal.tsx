import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../../lib/api';
import {
  formatarDia,
  formatarPercentual,
  formatarReais,
  mensagemErro,
  mesAtual,
  queryString,
  rotuloDe,
  rotuloMes,
  STATUS_FATURA,
  TIPOS_CONTA,
} from '../../lib/financas';
import type { ContaDTO, FaturaDTO, OrcamentoDTO, TransacaoDTO } from '../../lib/financas';
import { useDados } from '../../lib/useDados';
import { Aviso, Botao, Cartao, Carregando, Pagina, Selo, Tabela, formatarDataHora } from '../../ui';
import type { ColunaTabela } from '../../ui';
import { NomeComCor, SeletorMes, Vazio } from '../../ui/financas';
import './relatorio-mensal.css';

// Resposta de GET /transacoes (receitas e despesas já somam sem transferências).
interface RespostaTransacoes {
  itens: TransacaoDTO[];
  total: number;
  receitas: number;
  despesas: number;
}

// Resposta de GET /orcamentos?mes= (só os campos usados aqui).
interface RespostaOrcamento {
  mes: string;
  itens: OrcamentoDTO[];
}

// Resposta de GET /carteira/proventos?meses=12 (só o histórico mensal).
interface RespostaProventos {
  historico: { mes: string; total: number }[];
}

interface LinhaCategoria {
  chave: string;
  nome: string;
  cor: string;
  total: number;
  parte: number; // % do total de despesas do mês
  limite: number | null;
}

const PAGINAS_MAXIMAS = 10;
const POR_PAGINA = 200;
const MAIORES_GASTOS = 10;
const COR_SEM_CATEGORIA = '#64748b';

// Lê as páginas de lançamentos do mês até acabar (no máximo PAGINAS_MAXIMAS).
async function buscarLancamentos(mes: string): Promise<RespostaTransacoes> {
  const itens: TransacaoDTO[] = [];
  let total = 0;
  let receitas = 0;
  let despesas = 0;

  for (let pagina = 1; pagina <= PAGINAS_MAXIMAS; pagina++) {
    const resposta = await api.get<RespostaTransacoes>(
      '/transacoes' + queryString({ mes, porPagina: POR_PAGINA, pagina }),
    );
    itens.push(...resposta.itens);
    total = resposta.total;
    receitas = resposta.receitas;
    despesas = resposta.despesas;
    if (resposta.itens.length === 0 || itens.length >= resposta.total) break;
  }

  return { itens, total, receitas, despesas };
}

// Faixa de números do resumo.
function Numero({ rotulo, valor, classe }: { rotulo: string; valor: string; classe?: string }) {
  return (
    <div className="relmes-faixa-item">
      <span className="relmes-faixa-rotulo">{rotulo}</span>
      <strong className={classe ? `relmes-faixa-valor ${classe}` : 'relmes-faixa-valor'}>{valor}</strong>
    </div>
  );
}

// Texto da situação do orçamento: quanto sobrou ou quanto estourou.
function situacaoOrcamento(linha: LinhaCategoria): ReactNode {
  if (linha.limite === null) return '—';
  const sobra = linha.limite - linha.total;
  if (sobra >= 0) return <span className="relmes-positivo">Sobrou {formatarReais(sobra)}</span>;
  return <span className="relmes-negativo">Estourou {formatarReais(-sobra)}</span>;
}

const COLUNAS_CATEGORIAS: ColunaTabela<LinhaCategoria>[] = [
  { titulo: 'Categoria', celula: (l) => <NomeComCor cor={l.cor}>{l.nome}</NomeComCor> },
  { titulo: 'Gasto', celula: (l) => formatarReais(l.total), alinhar: 'direita' },
  { titulo: '%', celula: (l) => formatarPercentual(l.parte), alinhar: 'direita' },
  { titulo: 'Limite', celula: (l) => (l.limite === null ? '—' : formatarReais(l.limite)), alinhar: 'direita' },
  { titulo: 'Situação', celula: (l) => situacaoOrcamento(l), alinhar: 'direita' },
];

const COLUNAS_MAIORES: ColunaTabela<TransacaoDTO>[] = [
  { titulo: 'Data', celula: (t) => formatarDia(t.data) },
  { titulo: 'Descrição', celula: (t) => t.descricao },
  { titulo: 'Categoria', celula: (t) => t.categoriaNome ?? '—' },
  { titulo: 'Conta', celula: (t) => t.contaNome },
  { titulo: 'Valor', celula: (t) => formatarReais(t.valor), alinhar: 'direita' },
];

const COLUNAS_FATURAS: ColunaTabela<FaturaDTO>[] = [
  { titulo: 'Cartão', celula: (f) => f.contaNome },
  { titulo: 'Vencimento', celula: (f) => formatarDia(f.vencimento) },
  { titulo: 'Total', celula: (f) => formatarReais(f.total), alinhar: 'direita' },
  {
    titulo: 'Situação',
    celula: (f) => <Selo cor={STATUS_FATURA[f.status].cor}>{STATUS_FATURA[f.status].rotulo}</Selo>,
  },
];

const COLUNAS_CONTAS: ColunaTabela<ContaDTO>[] = [
  { titulo: 'Conta', celula: (c) => <NomeComCor cor={c.cor}>{c.nome}</NomeComCor> },
  { titulo: 'Tipo', celula: (c) => rotuloDe(TIPOS_CONTA, c.tipo) },
  {
    titulo: 'Saldo',
    celula: (c) => (c.tipo === 'CARTAO' ? `Dívida ${formatarReais(c.saldo)}` : formatarReais(c.saldo)),
    alinhar: 'direita',
  },
];

export function RelatorioMensal() {
  const [mes, setMes] = useState(mesAtual);
  const [geradoEm] = useState(() => new Date().toISOString());
  const [lancamentos, setLancamentos] = useState<RespostaTransacoes | null>(null);
  const [carregandoLancamentos, setCarregandoLancamentos] = useState(true);
  const [erroLancamentos, setErroLancamentos] = useState<string | null>(null);

  const orcamentos = useDados<RespostaOrcamento>('/orcamentos?mes=' + mes);
  const contas = useDados<ContaDTO[]>('/contas');
  const faturas = useDados<FaturaDTO[]>('/faturas');
  const proventos = useDados<RespostaProventos>('/carteira/proventos?meses=12');

  useEffect(() => {
    let cancelado = false;
    setCarregandoLancamentos(true);
    setErroLancamentos(null);

    buscarLancamentos(mes)
      .then((resposta) => {
        if (!cancelado) setLancamentos(resposta);
      })
      .catch((e: unknown) => {
        if (!cancelado) setErroLancamentos(mensagemErro(e));
      })
      .finally(() => {
        if (!cancelado) setCarregandoLancamentos(false);
      });

    return () => {
      cancelado = true;
    };
  }, [mes]);

  const carregando =
    carregandoLancamentos || orcamentos.carregando || contas.carregando || faturas.carregando || proventos.carregando;
  const erro =
    erroLancamentos ?? orcamentos.erro ?? contas.erro ?? faturas.erro ?? proventos.erro;

  // Sem transferências (o servidor já exclui nos totais; aqui também nas tabelas).
  const despesas = (lancamentos?.itens ?? []).filter((t) => t.tipo === 'DESPESA' && !t.transferencia);
  const totalDespesas = despesas.reduce((soma, t) => soma + t.valor, 0);

  const limites = new Map<number, number>();
  for (const o of orcamentos.dados?.itens ?? []) limites.set(o.categoriaId, o.limite);

  const porCategoria = new Map<string, LinhaCategoria>();
  for (const t of despesas) {
    const chave = t.categoriaId === null ? 'sem-categoria' : String(t.categoriaId);
    const atual: LinhaCategoria = porCategoria.get(chave) ?? {
      chave,
      nome: t.categoriaNome ?? 'Sem categoria',
      cor: t.categoriaCor ?? COR_SEM_CATEGORIA,
      total: 0,
      parte: 0,
      limite: t.categoriaId === null ? null : (limites.get(t.categoriaId) ?? null),
    };
    atual.total += t.valor;
    porCategoria.set(chave, atual);
  }
  const categorias = [...porCategoria.values()]
    .map((l) => ({ ...l, parte: totalDespesas > 0 ? (l.total / totalDespesas) * 100 : 0 }))
    .sort((a, b) => b.total - a.total);

  const maiores = [...despesas].sort((a, b) => b.valor - a.valor).slice(0, MAIORES_GASTOS);

  const faturasDoMes = (faturas.dados ?? [])
    .filter((f) => f.vencimento.startsWith(mes))
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento));

  const proventosDoMes = proventos.dados?.historico.find((h) => h.mes === mes)?.total ?? null;

  const semLancamentos = lancamentos !== null && lancamentos.total === 0;
  const saldoDoMes = lancamentos ? lancamentos.receitas - lancamentos.despesas : 0;
  const lidos = lancamentos?.itens.length ?? 0;
  const incompleto = lancamentos !== null && lidos < lancamentos.total;

  return (
    <Pagina titulo={`Relatório de ${rotuloMes(mes)}`}>
      <div className="relmes">
        <div className="relmes-acoes">
          <SeletorMes mes={mes} aoMudar={setMes} />
          <Botao variante="secundario" aoClicar={() => window.print()}>
            Imprimir ou salvar em PDF
          </Botao>
        </div>

        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {incompleto && (
          <Aviso tipo="info">
            Foram lidos {lidos} de {lancamentos?.total} lançamentos. Os totais de receitas e despesas vêm do servidor;
            as tabelas abaixo podem estar incompletas.
          </Aviso>
        )}

        {carregando && !lancamentos ? (
          <Carregando />
        ) : (
          <>
            {semLancamentos ? (
              <Cartao>
                <Vazio
                  icone="documento"
                  titulo="Sem lançamentos neste mês"
                  texto="Escolha outro mês no seletor acima."
                />
              </Cartao>
            ) : (
              lancamentos && (
                <>
                  <Cartao titulo="Resumo">
                    <div className="relmes-faixa">
                      <Numero rotulo="Receitas" valor={formatarReais(lancamentos.receitas)} />
                      <Numero rotulo="Despesas" valor={formatarReais(lancamentos.despesas)} />
                      <Numero
                        rotulo="Saldo do mês"
                        valor={formatarReais(saldoDoMes)}
                        classe={saldoDoMes >= 0 ? 'relmes-positivo' : 'relmes-negativo'}
                      />
                      <Numero
                        rotulo="Proventos do mês"
                        valor={proventosDoMes === null ? '—' : formatarReais(proventosDoMes)}
                      />
                    </div>
                  </Cartao>

                  <Cartao titulo="Gastos por categoria">
                    <Tabela
                      colunas={COLUNAS_CATEGORIAS}
                      dados={categorias}
                      chave={(l) => l.chave}
                      vazio="Nenhuma despesa neste mês."
                    />
                  </Cartao>

                  <Cartao titulo="Maiores gastos">
                    <Tabela
                      colunas={COLUNAS_MAIORES}
                      dados={maiores}
                      chave={(t) => t.id}
                      vazio="Nenhuma despesa neste mês."
                    />
                  </Cartao>
                </>
              )
            )}

            <Cartao titulo="Faturas do mês">
              <Tabela
                colunas={COLUNAS_FATURAS}
                dados={faturasDoMes}
                chave={(f) => f.id}
                vazio="Nenhuma fatura vence neste mês."
              />
            </Cartao>

            <Cartao titulo="Saldo das contas (hoje)">
              <Tabela
                colunas={COLUNAS_CONTAS}
                dados={contas.dados ?? []}
                chave={(c) => c.id}
                vazio="Nenhuma conta cadastrada."
              />
            </Cartao>
          </>
        )}

        <p className="relmes-rodape">Gerado em {formatarDataHora(geradoEm)}</p>
      </div>
    </Pagina>
  );
}
