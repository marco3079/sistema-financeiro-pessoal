import { useState } from 'react';
import { formatarReais, rotuloMes } from '../../lib/financas';
import { useDados } from '../../lib/useDados';
import { Aviso, Botao, Cartao, Carregando, Pagina, Selecao, Selo, Tabela } from '../../ui';
import { ResumoItem, Valor, Vazio } from '../../ui/financas';
import './ir.css';

type Classe = 'ACOES' | 'FII' | 'ETF';

interface RespostaIR {
  ano: number;
  meses: {
    mes: string;
    classes: { classe: Classe; vendas: number; resultado: number }[];
    vendasAcoes: number;
    isentoAcoes: boolean;
  }[];
  posicoes: {
    id: number;
    codigo: string;
    nome: string;
    tipo: string;
    quantidade: number;
    custoTotal: number;
    custoMedio: number;
  }[];
  proventos: { id: number; codigo: string; nome: string; total: number }[];
  totais: { vendas: number; resultado: number; proventos: number };
  incompletos: { codigo: string; motivo: string }[];
  anos: number[];
}

interface LinhaVenda {
  chave: string;
  mes: string;
  classe: Classe;
  vendas: number;
  resultado: number;
  isento: boolean;
  primeira: boolean;
}

const ROTULO_CLASSE: Record<Classe, string> = { ACOES: 'Ações', FII: 'FII', ETF: 'ETF' };

const AVISO_APOIO =
  'Apoio à declaração: os valores são calculados pelos movimentos importados e podem ter diferença em relação à nota de corretagem (taxas, desdobramentos, operações no mesmo dia). Confira com os informes da corretora. O sistema não calcula o imposto a pagar.';

const quantidadeBR = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 8 });

export function ImpostoRenda() {
  const anoAtual = new Date().getFullYear();
  const [ano, setAno] = useState(anoAtual);
  const { dados, carregando, erro } = useDados<RespostaIR>(`/ir?ano=${ano}`);

  const opcoesAnos = Array.from(new Set([anoAtual, ...(dados?.anos ?? [])])).sort((a, b) => b - a);
  const mostrar = dados !== null && !carregando;

  const linhasVendas: LinhaVenda[] = (dados?.meses ?? []).flatMap((m) =>
    m.classes.map((c, indice) => ({
      chave: `${m.mes}-${c.classe}`,
      mes: m.mes,
      classe: c.classe,
      vendas: c.vendas,
      resultado: c.resultado,
      isento: m.isentoAcoes,
      primeira: indice === 0,
    }))
  );

  return (
    <Pagina
      titulo="Imposto de renda"
      acoes={
        <span className="ir-nao-imprimir">
          <Botao variante="secundario" aoClicar={() => window.print()}>
            Imprimir
          </Botao>
        </span>
      }
    >
      <Aviso tipo="info">{AVISO_APOIO}</Aviso>

      <div className="ir-ano ir-nao-imprimir">
        <Selecao
          rotulo="Ano"
          valor={String(ano)}
          aoMudar={(valor) => setAno(Number(valor))}
          opcoes={opcoesAnos.map((a) => ({ valor: String(a), rotulo: String(a) }))}
        />
      </div>

      {carregando && <Carregando />}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      {mostrar && dados && (
        <>
          {dados.anos.length === 0 && (
            <Vazio
              icone="investimentos"
              titulo="Sem movimentos de investimentos"
              texto="Importe a planilha da B3 ou cadastre investimentos com movimentos para ver o apoio à declaração."
            />
          )}

          <div className="resumo">
            <ResumoItem icone="transacoes" cor="azul" valor={formatarReais(dados.totais.vendas)} rotulo="Total vendido" />
            <ResumoItem
              icone="grafico"
              cor={dados.totais.resultado < 0 ? 'vermelho' : 'verde'}
              valor={formatarReais(dados.totais.resultado)}
              rotulo="Resultado das vendas"
            />
            <ResumoItem icone="investimentos" cor="roxo" valor={formatarReais(dados.totais.proventos)} rotulo="Proventos recebidos" />
          </div>

          <Cartao titulo="Vendas por mês">
            <Tabela<LinhaVenda>
              chave={(l) => l.chave}
              dados={linhasVendas}
              vazio="Nenhuma venda neste ano."
              colunas={[
                {
                  titulo: 'Mês',
                  celula: (l) => (
                    <>
                      {rotuloMes(l.mes)}
                      {l.primeira && l.isento && (
                        <>
                          {' '}
                          <Selo cor="verde">Ações: vendas até R$ 20 mil no mês</Selo>
                        </>
                      )}
                    </>
                  ),
                },
                { titulo: 'Classe', celula: (l) => ROTULO_CLASSE[l.classe] },
                { titulo: 'Vendido', celula: (l) => formatarReais(l.vendas), alinhar: 'direita' },
                { titulo: 'Resultado', celula: (l) => <Valor valor={l.resultado} sentido="auto" />, alinhar: 'direita' },
              ]}
            />
          </Cartao>

          <Cartao titulo="Posição em 31/12">
            <p className="ir-ajuda">Use estes valores na ficha Bens e direitos.</p>
            <Tabela<RespostaIR['posicoes'][number]>
              chave={(p) => p.id}
              dados={dados.posicoes}
              vazio="Nenhuma posição em 31/12 deste ano."
              colunas={[
                { titulo: 'Código', celula: (p) => p.codigo },
                { titulo: 'Nome', celula: (p) => p.nome },
                { titulo: 'Quantidade', celula: (p) => quantidadeBR.format(p.quantidade), alinhar: 'direita' },
                { titulo: 'Custo médio', celula: (p) => formatarReais(p.custoMedio), alinhar: 'direita' },
                { titulo: 'Custo total', celula: (p) => formatarReais(p.custoTotal), alinhar: 'direita' },
              ]}
            />
          </Cartao>

          <Cartao titulo="Proventos recebidos no ano">
            <Tabela<RespostaIR['proventos'][number]>
              chave={(p) => p.id}
              dados={dados.proventos}
              vazio="Nenhum provento recebido neste ano."
              colunas={[
                { titulo: 'Código', celula: (p) => p.codigo },
                { titulo: 'Nome', celula: (p) => p.nome },
                { titulo: 'Total', celula: (p) => formatarReais(p.total), alinhar: 'direita' },
              ]}
            />
          </Cartao>

          {dados.incompletos.length > 0 && (
            <Cartao titulo="Ativos com histórico incompleto">
              <p className="ir-ajuda">As vendas desses ativos não entram nos totais.</p>
              <ul className="ir-lista">
                {dados.incompletos.map((i) => (
                  <li key={i.codigo}>
                    <strong>{i.codigo}</strong>: {i.motivo}
                  </li>
                ))}
              </ul>
            </Cartao>
          )}
        </>
      )}
    </Pagina>
  );
}
