import { useSearchParams } from 'react-router-dom';
import { useDados } from '../../lib/useDados';
import {
  TIPOS_INVESTIMENTO,
  TIPOS_MOVIMENTO,
  formatarDia,
  formatarPercentual,
  formatarReais,
  queryString,
  rotuloDe,
} from '../../lib/financas';
import type { InvestimentoDTO, TipoInvestimento, TipoMovimentoInvestimento } from '../../lib/financas';
import { Aviso, Cartao, Carregando, Pagina, Selecao, Tabela } from '../../ui';
import type { ColunaTabela } from '../../ui';
import { ResumoItem, Vazio } from '../../ui/financas';
import { CORES_SERIE, GraficoBarras, GraficoLinhas } from '../../ui/graficos';
import type { SerieGrafico } from '../../ui/graficos';
import './ativo.css';

// Ficha de um ativo: preço, compras e vendas, proventos e eventos. Só leitura.

interface RespostaInvestimentos {
  itens: InvestimentoDTO[];
}

interface MovimentoFicha {
  data: string;
  tipo: TipoMovimentoInvestimento;
  valor: number;
  quantidade: number | null;
  descricao: string | null;
}

interface FichaAtivoDTO {
  investimento: {
    id: number;
    nome: string;
    codigo: string | null;
    tipo: TipoInvestimento;
    quantidade: number | null;
    valorAplicado: number;
    saldo: number;
    precoMedio: number | null;
  };
  precos: { datas: string[]; valores: number[] };
  movimentos: MovimentoFicha[];
  proventosPorAno: { ano: number; total: number }[];
  proventosDozeMeses: number;
  rendimentoSobreOCusto: number | null;
  eventos: { data: string; tipo: string; fator: number }[];
}

interface LinhaCompraVenda extends MovimentoFicha {
  linha: number;
}

interface LinhaEvento {
  linha: number;
  data: string;
  tipo: string;
  fator: number;
}

const ROTULO_EVENTO: Record<string, string> = {
  DESDOBRAMENTO: 'Desdobramento',
  GRUPAMENTO: 'Grupamento',
  BONIFICACAO: 'Bonificação',
};

const TEXTO_PRECO_AJUSTADO = 'Preço de fechamento ajustado por desdobramentos (Yahoo Finance).';

function formatarQuantidade(valor: number): string {
  return valor.toLocaleString('pt-BR', { maximumFractionDigits: 8 });
}

const COLUNAS_COMPRAS: ColunaTabela<LinhaCompraVenda>[] = [
  { titulo: 'Data', celula: (m) => formatarDia(m.data) },
  { titulo: 'Tipo', celula: (m) => rotuloDe(TIPOS_MOVIMENTO, m.tipo) },
  {
    titulo: 'Quantidade',
    alinhar: 'direita',
    celula: (m) => (m.quantidade !== null ? formatarQuantidade(m.quantidade) : '—'),
  },
  {
    titulo: 'Preço unitário',
    alinhar: 'direita',
    celula: (m) => (m.quantidade !== null && m.quantidade > 0 ? formatarReais(m.valor / m.quantidade) : '—'),
  },
  { titulo: 'Valor', alinhar: 'direita', celula: (m) => formatarReais(m.valor) },
];

const COLUNAS_EVENTOS: ColunaTabela<LinhaEvento>[] = [
  { titulo: 'Data', celula: (e) => formatarDia(e.data) },
  { titulo: 'Tipo', celula: (e) => ROTULO_EVENTO[e.tipo] ?? e.tipo },
  { titulo: 'Fator', alinhar: 'direita', celula: (e) => `× ${formatarQuantidade(e.fator)}` },
];

export function FichaAtivo() {
  const [params, setParams] = useSearchParams();
  const idTexto = params.get('id') ?? '';
  const idValido = /^\d+$/.test(idTexto);

  const lista = useDados<RespostaInvestimentos>('/investimentos' + queryString({ inativos: 'true' }));
  const ficha = useDados<FichaAtivoDTO>(idValido ? `/ativo/${idTexto}` : null);

  const opcoes = (lista.dados?.itens ?? []).map((i) => ({
    valor: String(i.id),
    rotulo: i.codigo ? `${i.nome} (${i.codigo})` : i.nome,
  }));

  function escolher(valor: string) {
    setParams(valor ? { id: valor } : {});
  }

  let conteudo;
  if (!idValido) {
    conteudo = (
      <Vazio
        icone="investimentos"
        titulo="Escolha um ativo"
        texto="Use a lista acima para ver a ficha de um ativo."
      />
    );
  } else if (ficha.erro) {
    conteudo = <Aviso tipo="erro">{ficha.erro}</Aviso>;
  } else if (ficha.carregando || !ficha.dados) {
    conteudo = <Carregando />;
  } else {
    conteudo = <Detalhe f={ficha.dados} />;
  }

  return (
    <Pagina titulo="Ficha do ativo">
      <Cartao>
        {lista.erro && <Aviso tipo="erro">{lista.erro}</Aviso>}
        {lista.carregando && !lista.dados ? (
          <Carregando />
        ) : lista.dados && lista.dados.itens.length === 0 ? (
          <Vazio icone="investimentos" titulo="Nenhum ativo cadastrado" texto="Cadastre um investimento para ver a ficha dele." />
        ) : (
          <Selecao rotulo="Ativo" valor={idValido ? idTexto : ''} aoMudar={escolher} opcoes={opcoes} vazio="Escolha um ativo" />
        )}
      </Cartao>
      {conteudo}
    </Pagina>
  );
}

function Detalhe({ f }: { f: FichaAtivoDTO }) {
  const inv = f.investimento;
  const ganho = inv.saldo - inv.valorAplicado;
  const precoAtual = f.precos.valores.length > 0 ? f.precos.valores[f.precos.valores.length - 1] : null;
  const precoMedio = inv.precoMedio;

  const textoPrecos =
    precoMedio !== null && precoAtual !== null
      ? `${formatarReais(precoMedio)} × ${formatarReais(precoAtual)}`
      : precoMedio !== null
        ? formatarReais(precoMedio)
        : '—';

  const series: SerieGrafico[] = [{ nome: 'Preço', cor: CORES_SERIE.carteira, valores: f.precos.valores }];
  if (precoMedio !== null) {
    series.push({ nome: 'Preço médio', cor: 'var(--cor-aviso)', valores: f.precos.valores.map(() => precoMedio) });
  }

  const compras: LinhaCompraVenda[] = f.movimentos
    .filter((m) => m.tipo === 'APLICACAO' || m.tipo === 'RESGATE')
    .map((m, i) => ({ ...m, linha: i }))
    .reverse();

  const eventos: LinhaEvento[] = f.eventos.map((e, i) => ({ ...e, linha: i }));

  return (
    <>
      <p className="ativo-cabecalho">
        <strong>{inv.nome}</strong>
        {inv.codigo ? ` · ${inv.codigo}` : ''} · {rotuloDe(TIPOS_INVESTIMENTO, inv.tipo)}
        {inv.quantidade !== null ? ` · ${formatarQuantidade(inv.quantidade)} em mãos` : ''}
      </p>

      <div className="resumo ativo-resumo">
        <ResumoItem icone="investimentos" cor="azul" valor={formatarReais(inv.saldo)} rotulo="Saldo atual" />
        <ResumoItem icone="financeiro" cor="roxo" valor={formatarReais(inv.valorAplicado)} rotulo="Aplicado" />
        <ResumoItem
          icone="grafico"
          cor={ganho < 0 ? 'vermelho' : 'verde'}
          valor={formatarReais(ganho)}
          rotulo="Ganho ou perda"
        />
        <ResumoItem icone="lista" cor="laranja" valor={textoPrecos} rotulo="Preço médio × atual" />
        <ResumoItem icone="medalha" cor="verde" valor={formatarReais(f.proventosDozeMeses)} rotulo="Proventos em 12 meses" />
        <ResumoItem
          icone="somar"
          cor="azul"
          valor={f.rendimentoSobreOCusto !== null ? formatarPercentual(f.rendimentoSobreOCusto) : '—'}
          rotulo="Rendimento sobre o custo"
        />
      </div>

      {f.precos.datas.length > 0 && (
        <Cartao titulo="Preço">
          <GraficoLinhas
            rotulos={f.precos.datas.map((d) => formatarDia(d))}
            series={series}
            formato={formatarReais}
            descricao="Gráfico do preço do ativo ao longo do tempo, com a linha do preço médio"
          />
          <p className="ativo-nota">{TEXTO_PRECO_AJUSTADO}</p>
        </Cartao>
      )}

      <Cartao titulo="Compras e vendas">
        <Tabela<LinhaCompraVenda>
          colunas={COLUNAS_COMPRAS}
          dados={compras}
          chave={(m) => m.linha}
          vazio="Nenhuma compra ou venda registrada."
        />
      </Cartao>

      <Cartao titulo="Proventos por ano">
        {f.proventosPorAno.length === 0 ? (
          <Vazio icone="medalha" titulo="Sem proventos" texto="Nenhum dividendo, juro ou rendimento registrado para este ativo." />
        ) : (
          <GraficoBarras
            rotulos={f.proventosPorAno.map((p) => String(p.ano))}
            series={[{ nome: 'Proventos', cor: 'var(--cor-verde)', valores: f.proventosPorAno.map((p) => p.total) }]}
            formato={formatarReais}
            descricao="Gráfico de barras com os proventos recebidos em cada ano"
          />
        )}
      </Cartao>

      {eventos.length > 0 && (
        <Cartao titulo="Eventos">
          <Tabela<LinhaEvento> colunas={COLUNAS_EVENTOS} dados={eventos} chave={(e) => e.linha} />
        </Cartao>
      )}
    </>
  );
}
