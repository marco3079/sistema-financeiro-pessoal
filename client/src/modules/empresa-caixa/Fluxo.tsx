import { useState } from 'react';
import type { ReactNode } from 'react';
import { formatarDia, formatarReais } from '../../lib/financas';
import { useDados } from '../../lib/useDados';
import { Aviso, Cartao, Carregando, Pagina, Selecao, Tabela } from '../../ui';
import type { ColunaTabela } from '../../ui';
import { GraficoLinhas } from '../../ui/graficos';
import { ResumoItem, Valor } from '../../ui/financas';

// Contrato de GET /empresa/fluxo?dias=30|60|90 (seção e4 do plano lote6).
interface DiaFluxo {
  data: string; // 'AAAA-MM-DD'
  entradas: number;
  saidas: number;
  saldo: number;
}

interface MesFluxo {
  mes: string; // 'AAAA-MM'
  entradas: number;
  saidas: number;
  saldo: number;
}

interface FluxoDTO {
  saldoInicial: number;
  dias: DiaFluxo[];
  meses: MesFluxo[];
  menorSaldo: { data: string; valor: number } | null;
  vencidosNaoConsiderados: { aReceber: number; aPagar: number };
}

const OPCOES_DIAS = [30, 60, 90];
const ROTULOS_MES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function somar(valores: number[]): number {
  return valores.reduce((s, v) => s + v, 0);
}

// 'AAAA-MM-DD' -> 'DD/MM' (rótulo do eixo do gráfico).
function diaCurto(data: string): string {
  return `${data.slice(8, 10)}/${data.slice(5, 7)}`;
}

// 'AAAA-MM' -> 'Jan/2026'.
function mesCurto(mes: string): string {
  const [ano, m] = mes.split('-');
  return `${ROTULOS_MES[Number(m) - 1] ?? mes}/${ano}`;
}

// Zero vira travessão; valor não nulo ganha sinal e cor (entrada verde, saída vermelha).
function celulaMovimento(valor: number, sentido: 'entrada' | 'saida'): ReactNode {
  return valor === 0 ? '—' : <Valor valor={valor} sentido={sentido} />;
}

const COLUNAS_DIAS: ColunaTabela<DiaFluxo>[] = [
  { titulo: 'Data', celula: (d) => formatarDia(d.data) },
  { titulo: 'Entradas', alinhar: 'direita', celula: (d) => celulaMovimento(d.entradas, 'entrada') },
  { titulo: 'Saídas', alinhar: 'direita', celula: (d) => celulaMovimento(d.saidas, 'saida') },
  { titulo: 'Saldo previsto', alinhar: 'direita', celula: (d) => <Valor valor={d.saldo} sentido="auto" /> },
];

const COLUNAS_MESES: ColunaTabela<MesFluxo>[] = [
  { titulo: 'Mês', celula: (m) => mesCurto(m.mes) },
  { titulo: 'Entradas', alinhar: 'direita', celula: (m) => celulaMovimento(m.entradas, 'entrada') },
  { titulo: 'Saídas', alinhar: 'direita', celula: (m) => celulaMovimento(m.saidas, 'saida') },
  { titulo: 'Saldo previsto', alinhar: 'direita', celula: (m) => <Valor valor={m.saldo} sentido="auto" /> },
];

export function Fluxo() {
  const [dias, setDias] = useState(30);
  const { dados, carregando, erro } = useDados<FluxoDTO>(`/empresa/fluxo?dias=${dias}`);

  const seletorDias = (
    <Selecao
      rotulo="Período"
      valor={String(dias)}
      aoMudar={(valor) => setDias(Number(valor))}
      opcoes={OPCOES_DIAS.map((d) => ({ valor: String(d), rotulo: `${d} dias` }))}
    />
  );

  if (!dados) {
    return (
      <Pagina titulo="Fluxo de caixa" acoes={seletorDias}>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {carregando && <Carregando />}
      </Pagina>
    );
  }

  const entradasPrevistas = somar(dados.dias.map((d) => d.entradas));
  const saidasPrevistas = somar(dados.dias.map((d) => d.saidas));
  const saldoNoFim = dados.dias.length > 0 ? dados.dias[dados.dias.length - 1].saldo : dados.saldoInicial;
  const menor = dados.menorSaldo;
  const diasComMovimento = dados.dias.filter((d) => d.entradas !== 0 || d.saidas !== 0);
  const { aReceber, aPagar } = dados.vencidosNaoConsiderados;

  const partesVencidos: string[] = [];
  if (aReceber > 0) partesVencidos.push(`${formatarReais(aReceber)} a receber`);
  if (aPagar > 0) partesVencidos.push(`${formatarReais(aPagar)} a pagar`);

  return (
    <Pagina titulo="Fluxo de caixa" acoes={seletorDias}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {carregando && <Carregando />}

      <div className="resumo">
        <ResumoItem icone="financeiro" cor="azul" valor={formatarReais(dados.saldoInicial)} rotulo="Saldo em contas hoje" />
        <ResumoItem icone="seta-cima" cor="verde" valor={formatarReais(entradasPrevistas)} rotulo={`Entradas previstas em ${dias} dias`} />
        <ResumoItem icone="seta-baixo" cor="vermelho" valor={formatarReais(saidasPrevistas)} rotulo={`Saídas previstas em ${dias} dias`} />
        <ResumoItem
          icone="calendario"
          cor={saldoNoFim < 0 ? 'vermelho' : 'roxo'}
          valor={formatarReais(saldoNoFim)}
          rotulo={`Saldo no fim de ${dias} dias`}
        />
        <ResumoItem
          icone="grafico"
          cor={menor && menor.valor < 0 ? 'vermelho' : 'laranja'}
          valor={menor ? formatarReais(menor.valor) : '—'}
          rotulo={menor ? `Menor saldo, em ${formatarDia(menor.data)}` : 'Menor saldo'}
        />
      </div>

      {partesVencidos.length > 0 && (
        <Aviso tipo="info">Há {partesVencidos.join(' e ')} vencidos, fora desta projeção.</Aviso>
      )}

      <Cartao titulo="Saldo previsto dia a dia">
        <GraficoLinhas
          rotulos={dados.dias.map((d) => diaCurto(d.data))}
          series={[{ nome: 'Saldo previsto', cor: 'var(--cor-primaria)', valores: dados.dias.map((d) => d.saldo) }]}
          formato={formatarReais}
          descricao={`Saldo previsto de cada dia nos próximos ${dias} dias.`}
        />
      </Cartao>

      <Cartao titulo="Dias com movimento">
        <Tabela
          colunas={COLUNAS_DIAS}
          dados={diasComMovimento}
          chave={(d) => d.data}
          vazio={`Nenhum vencimento nos próximos ${dias} dias.`}
        />
      </Cartao>

      <Cartao titulo="Próximos 6 meses">
        <Tabela
          colunas={COLUNAS_MESES}
          dados={dados.meses}
          chave={(m) => m.mes}
          vazio="Sem previsão para os próximos meses."
        />
      </Cartao>
    </Pagina>
  );
}
