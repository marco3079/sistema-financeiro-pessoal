import { useEffect, useRef, useState } from 'react';
import { formatarPercentual, formatarReais, lerValor, valorParaCampo } from '../../lib/financas';
import { useDados } from '../../lib/useDados';
import { Aviso, Campo, Cartao, Carregando, Pagina, Tabela } from '../../ui';
import type { ColunaTabela } from '../../ui';
import { ResumoItem } from '../../ui/financas';
import { GraficoLinhas } from '../../ui/graficos';
import './simulador.css';

interface ResumoContas {
  contas: number;
  investimentos: number;
  cartoes: number;
  patrimonio: number;
}

// Texto digitado nos campos.
interface Formulario {
  valorInicial: string;
  aporte: string;
  taxa: string;
  inflacao: string;
  prazo: string;
}

// Valores já convertidos e validados.
interface Entrada {
  valorInicial: number;
  aporte: number;
  taxa: number;
  inflacao: number | null;
  prazo: number;
}

interface PontoAno {
  ano: number;
  aportado: number;
  saldo: number;
  saldoHoje: number | null; // null quando não há inflação informada
}

interface Cenario {
  rotulo: string;
  taxa: number;
  pontos: PontoAno[];
}

const PRAZO_MAXIMO = 50;
const FORMULARIO_INICIAL: Formulario = { valorInicial: '', aporte: '', taxa: '', inflacao: '', prazo: '10' };

// Taxa mensal equivalente à taxa anual (juros compostos).
function taxaMensal(taxaAno: number): number {
  return Math.pow(1 + taxaAno / 100, 1 / 12) - 1;
}

// Mês a mês: saldo = saldo × (1 + i) + aporte. Devolve um ponto no ano 0 e um no fim de cada ano.
function projetar(entrada: Entrada, taxaAno: number): PontoAno[] {
  const i = taxaMensal(taxaAno);
  let saldo = entrada.valorInicial;
  let aportado = entrada.valorInicial;
  const pontos: PontoAno[] = [];

  const fotografar = (ano: number) => {
    pontos.push({
      ano,
      aportado,
      saldo,
      saldoHoje: entrada.inflacao === null ? null : saldo / Math.pow(1 + entrada.inflacao / 100, ano),
    });
  };

  fotografar(0);
  for (let ano = 1; ano <= entrada.prazo; ano++) {
    for (let mes = 0; mes < 12; mes++) {
      saldo = saldo * (1 + i) + entrada.aporte;
      aportado += entrada.aporte;
    }
    fotografar(ano);
  }
  return pontos;
}

// Converte o formulário. Devolve a mensagem do primeiro campo inválido, em vez de quebrar a tela.
function lerEntrada(f: Formulario): Entrada | string {
  const valorInicial = lerValor(f.valorInicial);
  if (valorInicial === null || valorInicial < 0) return 'Confira o valor inicial (zero ou mais).';

  const aporte = lerValor(f.aporte);
  if (aporte === null || aporte < 0) return 'Confira o aporte mensal (zero ou mais).';

  // Menor que -98 faria o cenário "−2 pontos" ficar abaixo de -100%.
  const taxa = lerValor(f.taxa.replace('%', ''));
  if (taxa === null || taxa <= -98) return 'Confira a taxa ao ano.';

  let inflacao: number | null = null;
  const textoInflacao = f.inflacao.trim();
  if (textoInflacao !== '') {
    inflacao = lerValor(textoInflacao.replace('%', ''));
    if (inflacao === null || inflacao <= -98) return 'Confira a inflação ao ano.';
  }

  const textoPrazo = f.prazo.trim();
  const prazo = /^\d+$/.test(textoPrazo) ? Number(textoPrazo) : NaN;
  if (!(prazo >= 1 && prazo <= PRAZO_MAXIMO)) return `Informe um prazo de 1 a ${PRAZO_MAXIMO} anos.`;

  return { valorInicial, aporte, taxa, inflacao, prazo };
}

// Três cenários: a taxa informada e ±2 pontos.
function montarCenarios(entrada: Entrada): Cenario[] {
  return [
    { rotulo: 'Taxa 2 pontos abaixo', taxa: entrada.taxa - 2 },
    { rotulo: 'Taxa informada', taxa: entrada.taxa },
    { rotulo: 'Taxa 2 pontos acima', taxa: entrada.taxa + 2 },
  ].map((c) => ({ ...c, pontos: projetar(entrada, c.taxa) }));
}

// Eixo do gráfico: valor curto (ex.: "R$ 1,2 mi") para caber na margem.
function formatarEixo(valor: number): string {
  return valor.toLocaleString('pt-BR', {
    notation: 'compact',
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 1,
  });
}

export function Simulador() {
  const resumo = useDados<ResumoContas>('/contas/resumo');
  const [form, setForm] = useState<Formulario>(FORMULARIO_INICIAL);
  // Depois que a pessoa digita o valor inicial, a sugestão dos investimentos não sobrescreve mais.
  const valorEditado = useRef(false);

  useEffect(() => {
    if (resumo.dados && !valorEditado.current) {
      const investimentos = resumo.dados.investimentos;
      setForm((f) => ({ ...f, valorInicial: valorParaCampo(investimentos) }));
    }
  }, [resumo.dados]);

  function mudar(campo: keyof Formulario) {
    return (valor: string) => {
      if (campo === 'valorInicial') valorEditado.current = true;
      setForm((f) => ({ ...f, [campo]: valor }));
    };
  }

  const entrada = lerEntrada(form);
  const cenarios = typeof entrada === 'string' ? null : montarCenarios(entrada);
  const principal = cenarios ? cenarios[1] : null;
  const final = principal ? principal.pontos[principal.pontos.length - 1] : null;
  const temInflacao = typeof entrada !== 'string' && entrada.inflacao !== null;

  const colunas: ColunaTabela<PontoAno>[] = [
    { titulo: 'Ano', celula: (p) => p.ano, alinhar: 'esquerda' },
    { titulo: 'Total aportado', celula: (p) => formatarReais(p.aportado), alinhar: 'direita' },
    { titulo: 'Saldo', celula: (p) => formatarReais(p.saldo), alinhar: 'direita' },
    { titulo: 'Rendimento', celula: (p) => formatarReais(p.saldo - p.aportado), alinhar: 'direita' },
    ...(temInflacao
      ? [
          {
            titulo: 'Saldo em valores de hoje',
            celula: (p: PontoAno) => (p.saldoHoje === null ? '' : formatarReais(p.saldoHoje)),
            alinhar: 'direita' as const,
          },
        ]
      : []),
  ];

  return (
    <Pagina titulo="Simulador">
      <p className="sim-explicacao">Veja quanto um valor cresce com aportes mensais e uma taxa fixa.</p>

      {resumo.carregando && <Carregando />}
      {resumo.erro && (
        <Aviso tipo="info">Não foi possível buscar o saldo dos investimentos. Digite o valor inicial.</Aviso>
      )}

      <div className="sim-campos">
        <Campo rotulo="Valor inicial" valor={form.valorInicial} aoMudar={mudar('valorInicial')} />
        <Campo rotulo="Aporte mensal" valor={form.aporte} aoMudar={mudar('aporte')} />
        <Campo rotulo="Taxa ao ano (%)" valor={form.taxa} aoMudar={mudar('taxa')} />
        <Campo rotulo="Inflação ao ano (%) (opcional)" valor={form.inflacao} aoMudar={mudar('inflacao')} />
        <Campo rotulo="Prazo em anos" valor={form.prazo} aoMudar={mudar('prazo')} tipo="number" />
      </div>

      {typeof entrada === 'string' && <Aviso tipo="info">{entrada}</Aviso>}

      {cenarios && principal && final && (
        <>
          <Cartao titulo="Resultado">
            <div className="resumo">
              <ResumoItem icone="investimentos" cor="verde" valor={formatarReais(final.saldo)} rotulo="Saldo final" />
              <ResumoItem icone="somar" cor="azul" valor={formatarReais(final.aportado)} rotulo="Total aportado" />
              <ResumoItem
                icone="grafico"
                cor="roxo"
                valor={formatarReais(final.saldo - final.aportado)}
                rotulo="Rendimento"
              />
              {final.saldoHoje !== null && (
                <ResumoItem
                  icone="calendario"
                  cor="laranja"
                  valor={formatarReais(final.saldoHoje)}
                  rotulo="Saldo final em valores de hoje"
                />
              )}
            </div>
          </Cartao>

          <Cartao titulo="Evolução ano a ano">
            <GraficoLinhas
              rotulos={principal.pontos.map((p) => String(p.ano))}
              series={[
                { nome: 'Saldo', cor: 'var(--cor-primaria)', valores: principal.pontos.map((p) => p.saldo) },
                {
                  nome: 'Total aportado',
                  cor: 'var(--cor-texto-suave)',
                  valores: principal.pontos.map((p) => p.aportado),
                },
              ]}
              formato={formatarEixo}
              descricao="Saldo e total aportado ano a ano."
            />
          </Cartao>

          <div className="sim-cenarios">
            {cenarios.map((c) => {
              const ultimo = c.pontos[c.pontos.length - 1];
              return (
                <Cartao key={c.rotulo} titulo={c.rotulo}>
                  <p>Taxa: {formatarPercentual(c.taxa)} ao ano</p>
                  <p>
                    Saldo final: <strong>{formatarReais(ultimo.saldo)}</strong>
                  </p>
                  <p>Rendimento: {formatarReais(ultimo.saldo - ultimo.aportado)}</p>
                  {ultimo.saldoHoje !== null && <p>Em valores de hoje: {formatarReais(ultimo.saldoHoje)}</p>}
                </Cartao>
              );
            })}
          </div>

          <Cartao titulo="Ano a ano">
            <Tabela
              colunas={colunas}
              dados={principal.pontos.slice(1)}
              chave={(p) => p.ano}
              vazio="Sem anos para mostrar."
            />
          </Cartao>
        </>
      )}

      <Aviso tipo="info">
        É uma conta com a taxa que você informou, constante todos os meses. Não é previsão nem recomendação.
      </Aviso>
    </Pagina>
  );
}
