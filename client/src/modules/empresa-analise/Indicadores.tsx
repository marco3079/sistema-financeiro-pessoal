import { useState } from 'react';
import { formatarDia, formatarPercentual, formatarReais } from '../../lib/financas';
import { useDados } from '../../lib/useDados';
import { Aviso, Cartao, Carregando, Pagina, Selecao } from '../../ui';
import './analise.css';

type Meses = 3 | 6 | 12;
type Formato = 'dinheiro' | 'percentual' | 'dias' | 'meses';

interface IndicadoresDTO {
  periodo: { de: string; ate: string };
  receita: number;
  custos: number;
  despesas: number;
  lucro: number;
  margemBruta: number | null;
  margemLiquida: number | null;
  ticketMedio: number | null;
  prazoMedioRecebimento: number | null;
  prazoMedioPagamento: number | null;
  inadimplencia: number | null;
  pontoDeEquilibrio: number | null;
  despesaMensalMedia: number | null;
  mesesDeCaixa: number | null;
}

interface Definicao {
  chave: keyof Omit<IndicadoresDTO, 'periodo'>;
  rotulo: string;
  formato: Formato;
  texto: string;
}

const DEFINICOES: Definicao[] = [
  { chave: 'receita', rotulo: 'Receita', formato: 'dinheiro', texto: 'Soma das receitas do período, pelos grupos da DRE.' },
  { chave: 'custos', rotulo: 'Custos', formato: 'dinheiro', texto: 'Quanto foi gasto com custos no período (grupo Custos da DRE).' },
  { chave: 'despesas', rotulo: 'Despesas operacionais', formato: 'dinheiro', texto: 'Quanto foi gasto com despesas operacionais no período (grupo Despesas da DRE).' },
  { chave: 'lucro', rotulo: 'Lucro líquido', formato: 'dinheiro', texto: 'O que sobra no período depois de todos os grupos da DRE, impostos incluídos.' },
  { chave: 'margemBruta', rotulo: 'Margem bruta', formato: 'percentual', texto: 'Quanto da receita líquida sobra depois dos custos.' },
  { chave: 'margemLiquida', rotulo: 'Margem líquida', formato: 'percentual', texto: 'Quanto da receita líquida vira lucro líquido.' },
  { chave: 'ticketMedio', rotulo: 'Ticket médio', formato: 'dinheiro', texto: 'Valor médio de cada lançamento de receita.' },
  { chave: 'prazoMedioRecebimento', rotulo: 'Prazo médio de recebimento', formato: 'dias', texto: 'Quantos dias, em média, os clientes levam para pagar depois da emissão.' },
  { chave: 'prazoMedioPagamento', rotulo: 'Prazo médio de pagamento', formato: 'dias', texto: 'Quantos dias, em média, a empresa leva para pagar depois da emissão.' },
  { chave: 'inadimplencia', rotulo: 'Inadimplência', formato: 'percentual', texto: 'Parte do que está a receber que já venceu e não foi pago.' },
  { chave: 'pontoDeEquilibrio', rotulo: 'Ponto de equilíbrio', formato: 'dinheiro', texto: 'Quanto precisa entrar por mês para cobrir as despesas fixas médias.' },
  { chave: 'despesaMensalMedia', rotulo: 'Despesa mensal média', formato: 'dinheiro', texto: 'Média mensal das despesas no período.' },
  { chave: 'mesesDeCaixa', rotulo: 'Meses de caixa', formato: 'meses', texto: 'Quantos meses o dinheiro em contas dura com a despesa média atual.' },
];

function paraMeses(valor: string): Meses {
  if (valor === '3') return 3;
  if (valor === '12') return 12;
  return 6;
}

function formatarIndicador(valor: number | null, formato: Formato): string | null {
  if (valor === null) return null;
  if (formato === 'dinheiro') return formatarReais(valor);
  if (formato === 'percentual') return formatarPercentual(valor);
  const numero = valor.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  if (formato === 'dias') return `${numero} ${valor === 1 ? 'dia' : 'dias'}`;
  return `${numero} ${valor === 1 ? 'mês' : 'meses'}`;
}

export function Indicadores() {
  const [meses, setMeses] = useState<Meses>(6);
  const { dados, carregando, erro } = useDados<IndicadoresDTO>('/empresa/indicadores?meses=' + meses);

  return (
    <Pagina
      titulo="Indicadores"
      acoes={
        <Selecao
          rotulo="Período"
          valor={String(meses)}
          aoMudar={(v) => setMeses(paraMeses(v))}
          opcoes={[
            { valor: '3', rotulo: 'Últimos 3 meses' },
            { valor: '6', rotulo: 'Últimos 6 meses' },
            { valor: '12', rotulo: 'Últimos 12 meses' },
          ]}
        />
      }
    >
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {carregando && <Carregando />}

      {dados && (
        <>
          <p className="analise-periodo">
            Período: de {formatarDia(dados.periodo.de)} a {formatarDia(dados.periodo.ate)}
          </p>
          <div className="analise-indicadores">
            {DEFINICOES.map((d) => {
              const texto = formatarIndicador(dados[d.chave], d.formato);
              return (
                <Cartao key={d.chave} titulo={d.rotulo}>
                  {texto === null ? (
                    <>
                      <p className="analise-indicador-valor">—</p>
                      <p className="analise-sem-dados">Sem dados suficientes</p>
                    </>
                  ) : (
                    <p className="analise-indicador-valor">{texto}</p>
                  )}
                  <p className="analise-indicador-texto">{d.texto}</p>
                </Cartao>
              );
            })}
          </div>
        </>
      )}
    </Pagina>
  );
}
