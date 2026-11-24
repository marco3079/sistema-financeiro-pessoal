import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatarPercentual, formatarReais, mesAtual } from '../../lib/financas';
import type { TipoTransacao } from '../../lib/financas';
import { useDados } from '../../lib/useDados';
import { Aviso, Cartao, Carregando, Pagina, Tabela } from '../../ui';
import type { ColunaTabela } from '../../ui';
import { BarraProgresso, NomeComCor, ResumoItem, SeletorMes, Vazio } from '../../ui/financas';
import './analise.css';

interface LinhaOrcado {
  categoriaId: number;
  categoriaNome: string;
  categoriaCor: string;
  tipo: TipoTransacao;
  orcado: number;
  realizado: number;
  diferenca: number;
  percentual: number | null;
}

interface RespostaOrcado {
  mes: string;
  linhas: LinhaOrcado[];
  totais: { orcado: number; realizado: number; diferenca: number };
}

function colunasOrcado(): ColunaTabela<LinhaOrcado>[] {
  return [
    { titulo: 'Categoria', celula: (l) => <NomeComCor cor={l.categoriaCor}>{l.categoriaNome}</NomeComCor> },
    { titulo: 'Orçado', alinhar: 'direita', celula: (l) => formatarReais(l.orcado) },
    { titulo: 'Realizado', alinhar: 'direita', celula: (l) => formatarReais(l.realizado) },
    { titulo: 'Diferença', alinhar: 'direita', celula: (l) => formatarReais(l.diferenca) },
    {
      titulo: '% do orçado',
      celula: (l) =>
        l.percentual === null ? (
          <span className="analise-sem-dados">—</span>
        ) : (
          <div className="analise-progresso">
            <span>{formatarPercentual(l.percentual)}</span>
            <BarraProgresso percentual={l.percentual} cor={l.categoriaCor} />
          </div>
        ),
    },
  ];
}

export function Orcado() {
  const [mes, setMes] = useState(mesAtual());
  const { dados, carregando, erro } = useDados<RespostaOrcado>('/empresa/orcado?mes=' + mes);
  const despesas = dados ? dados.linhas.filter((l) => l.tipo === 'DESPESA') : [];
  const receitas = dados ? dados.linhas.filter((l) => l.tipo === 'RECEITA') : [];

  return (
    <Pagina titulo="Orçado x realizado" acoes={<SeletorMes mes={mes} aoMudar={setMes} />}>
      <div className="analise-topo">
        <Link className="botao botao-secundario" to="/app/orcamento">
          Definir orçamento
        </Link>
      </div>

      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {carregando && <Carregando />}

      {dados && (
        <>
          <div className="resumo">
            <ResumoItem icone="orcamento" cor="azul" valor={formatarReais(dados.totais.orcado)} rotulo="Orçado" />
            <ResumoItem icone="seta-baixo" cor="laranja" valor={formatarReais(dados.totais.realizado)} rotulo="Realizado" />
            <ResumoItem icone="financeiro" cor="roxo" valor={formatarReais(dados.totais.diferenca)} rotulo="Diferença" />
          </div>

          {dados.linhas.length === 0 ? (
            <Cartao>
              <Vazio
                icone="orcamento"
                titulo="Nada para comparar neste mês"
                texto="Defina limites por categoria ou lance despesas e receitas para ver a comparação."
              />
            </Cartao>
          ) : (
            <>
              <Cartao titulo="Despesas">
                <Tabela<LinhaOrcado>
                  chave={(l) => l.categoriaId}
                  dados={despesas}
                  vazio="Nenhuma despesa neste mês."
                  colunas={colunasOrcado()}
                />
              </Cartao>
              <Cartao titulo="Receitas">
                <Tabela<LinhaOrcado>
                  chave={(l) => l.categoriaId}
                  dados={receitas}
                  vazio="Nenhuma receita neste mês."
                  colunas={colunasOrcado()}
                />
              </Cartao>
            </>
          )}
        </>
      )}
    </Pagina>
  );
}
