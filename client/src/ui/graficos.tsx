import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import './graficos.css';

// Gráficos em SVG feitos à mão (sem biblioteca): linhas e barras agrupadas, com várias séries, valores negativos,
// legenda e leitura do ponto sob o cursor. As cores chegam por `style` (aceita var(--...)).

export interface SerieGrafico {
  nome: string;
  cor: string; // valor de CSS: 'var(--cor-primaria)', '#f59e0b'...
  valores: (number | null)[];
}

// Cores fixas das séries de comparação (iguais nos dois temas, com contraste nos dois).
export const CORES_SERIE = {
  carteira: 'var(--cor-primaria)',
  cdi: '#f59e0b',
  ibov: '#ec4899',
  ipca: '#8b5cf6',
  ifix: '#06b6d4',
} as const;

const MARGEM = { cima: 12, direita: 12, baixo: 28, esquerda: 76 };

function useLargura(): [React.RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [largura, setLargura] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const medir = () => setLargura(Math.max(280, Math.floor(el.clientWidth)));
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(el);
    return () => observador.disconnect();
  }, []);
  return [ref, largura];
}

// Limites "redondos" do eixo que sempre incluem o zero.
function limites(series: SerieGrafico[]): { min: number; max: number; passos: number[] } {
  let min = 0;
  let max = 0;
  for (const s of series) {
    for (const v of s.valores) {
      if (v === null || !Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (min === 0 && max === 0) max = 1;
  const bruto = (max - min) / 4;
  const potencia = Math.pow(10, Math.floor(Math.log10(bruto)));
  const passo = ([1, 2, 2.5, 5, 10].find((m) => m * potencia >= bruto) ?? 10) * potencia;
  const inicio = Math.floor(min / passo) * passo;
  const fim = Math.ceil(max / passo) * passo;
  const passos: number[] = [];
  for (let v = inicio; v <= fim + passo / 2; v += passo) passos.push(Math.round(v * 1e6) / 1e6);
  return { min: inicio, max: fim, passos };
}

// Índices dos rótulos do eixo X que cabem na largura.
function rotulosVisiveis(quantos: number, largura: number, larguraDoRotulo: number): Set<number> {
  const cabem = Math.max(2, Math.floor(largura / larguraDoRotulo));
  const visiveis = new Set<number>();
  if (quantos <= cabem) {
    for (let i = 0; i < quantos; i++) visiveis.add(i);
    return visiveis;
  }
  const salto = (quantos - 1) / (cabem - 1);
  for (let k = 0; k < cabem; k++) visiveis.add(Math.round(k * salto));
  return visiveis;
}

function Legenda({ series }: { series: SerieGrafico[] }) {
  return (
    <ul className="grafico-legenda">
      {series.map((s) => (
        <li key={s.nome}>
          <span className="grafico-legenda-cor" style={{ background: s.cor }} aria-hidden="true" />
          {s.nome}
        </li>
      ))}
    </ul>
  );
}

function Leitura({ rotulo, series, indice, formato }: { rotulo: string; series: SerieGrafico[]; indice: number; formato: (v: number) => string }) {
  return (
    <div className="grafico-leitura" role="status">
      <strong>{rotulo}</strong>
      {series.map((s) => {
        const v = s.valores[indice];
        return (
          <span key={s.nome}>
            <span className="grafico-legenda-cor" style={{ background: s.cor }} aria-hidden="true" />
            {s.nome}: {v === null || v === undefined ? '—' : formato(v)}
          </span>
        );
      })}
    </div>
  );
}

interface PropsGrafico {
  rotulos: string[]; // um por ponto do eixo X
  series: SerieGrafico[];
  formato: (valor: number) => string; // usado no eixo e na leitura
  altura?: number;
  descricao: string; // texto para leitor de tela
  rodape?: ReactNode;
}

// Linhas: uma por série. Passe `area` para preencher embaixo da primeira série (gráfico de patrimônio).
export function GraficoLinhas({ rotulos, series, formato, altura = 280, descricao, area = false }: PropsGrafico & { area?: boolean }) {
  const [ref, largura] = useLargura();
  const [sobre, setSobre] = useState<number | null>(null);
  const n = rotulos.length;
  // O contêiner medido existe mesmo sem dados: assim a largura já está certa quando os dados chegam.
  if (n === 0) {
    return (
      <div className="grafico" ref={ref}>
        <p className="grafico-vazio">Sem dados no período.</p>
      </div>
    );
  }
  const { min, max, passos } = limites(series);
  const l = largura - MARGEM.esquerda - MARGEM.direita;
  const a = altura - MARGEM.cima - MARGEM.baixo;
  const x = (i: number) => MARGEM.esquerda + (n === 1 ? l / 2 : (i / (n - 1)) * l);
  const y = (v: number) => MARGEM.cima + a - ((v - min) / (max - min)) * a;
  const visiveis = rotulosVisiveis(n, l, 76);
  const caminho = (valores: (number | null)[]) => {
    let d = '';
    let aberto = false;
    valores.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) {
        aberto = false;
        return;
      }
      d += `${aberto ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      aberto = true;
    });
    return d;
  };
  const indice = sobre ?? n - 1;
  return (
    <div className="grafico" ref={ref}>
      <svg
        width={largura}
        height={altura}
        role="img"
        aria-label={descricao}
        onMouseLeave={() => setSobre(null)}
        onMouseMove={(e) => {
          const caixa = e.currentTarget.getBoundingClientRect();
          const posicao = (e.clientX - caixa.left - MARGEM.esquerda) / Math.max(1, l);
          setSobre(Math.min(n - 1, Math.max(0, Math.round(posicao * (n - 1)))));
        }}
      >
        {passos.map((p) => (
          <g key={p}>
            <line className={p === 0 ? 'grafico-zero' : 'grafico-grade'} x1={MARGEM.esquerda} x2={largura - MARGEM.direita} y1={y(p)} y2={y(p)} />
            <text className="grafico-eixo" x={MARGEM.esquerda - 8} y={y(p) + 4} textAnchor="end">
              {formato(p)}
            </text>
          </g>
        ))}
        {rotulos.map((r, i) =>
          visiveis.has(i) ? (
            <text key={i} className="grafico-eixo" x={x(i)} y={altura - 8} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>
              {r}
            </text>
          ) : null
        )}
        {area && series[0] && (
          <path
            className="grafico-area"
            style={{ fill: series[0].cor }}
            d={`${caminho(series[0].valores)}L${x(n - 1).toFixed(1)},${y(Math.max(min, 0)).toFixed(1)}L${x(0).toFixed(1)},${y(Math.max(min, 0)).toFixed(1)}Z`}
          />
        )}
        {series.map((s) => (
          <path key={s.nome} className="grafico-linha" style={{ stroke: s.cor }} d={caminho(s.valores)} />
        ))}
        {n === 1 &&
          series.map((s) => {
            const v = s.valores[0];
            return v === null || v === undefined ? null : <circle key={s.nome} cx={x(0)} cy={y(v)} r={4} style={{ fill: s.cor }} />;
          })}
        {sobre !== null && <line className="grafico-cursor" x1={x(sobre)} x2={x(sobre)} y1={MARGEM.cima} y2={MARGEM.cima + a} />}
      </svg>
      <Leitura rotulo={rotulos[indice]} series={series} indice={indice} formato={formato} />
      {series.length > 1 && <Legenda series={series} />}
    </div>
  );
}

// Barras verticais agrupadas (uma barra por série em cada rótulo), com valores negativos abaixo do zero.
export function GraficoBarras({ rotulos, series, formato, altura = 260, descricao }: PropsGrafico) {
  const [ref, largura] = useLargura();
  const [sobre, setSobre] = useState<number | null>(null);
  const n = rotulos.length;
  // O contêiner medido existe mesmo sem dados: assim a largura já está certa quando os dados chegam.
  if (n === 0) {
    return (
      <div className="grafico" ref={ref}>
        <p className="grafico-vazio">Sem dados no período.</p>
      </div>
    );
  }
  const { min, max, passos } = limites(series);
  const l = largura - MARGEM.esquerda - MARGEM.direita;
  const a = altura - MARGEM.cima - MARGEM.baixo;
  const grupo = l / n;
  const barra = Math.max(2, Math.min(28, (grupo * 0.72) / series.length));
  const y = (v: number) => MARGEM.cima + a - ((v - min) / (max - min)) * a;
  const visiveis = rotulosVisiveis(n, l, 64);
  const indice = sobre ?? n - 1;
  return (
    <div className="grafico" ref={ref}>
      <svg width={largura} height={altura} role="img" aria-label={descricao} onMouseLeave={() => setSobre(null)}>
        {passos.map((p) => (
          <g key={p}>
            <line className={p === 0 ? 'grafico-zero' : 'grafico-grade'} x1={MARGEM.esquerda} x2={largura - MARGEM.direita} y1={y(p)} y2={y(p)} />
            <text className="grafico-eixo" x={MARGEM.esquerda - 8} y={y(p) + 4} textAnchor="end">
              {formato(p)}
            </text>
          </g>
        ))}
        {rotulos.map((r, i) => {
          const centro = MARGEM.esquerda + grupo * (i + 0.5);
          const inicio = centro - (barra * series.length) / 2;
          return (
            <g key={i} onMouseEnter={() => setSobre(i)}>
              <rect x={MARGEM.esquerda + grupo * i} y={MARGEM.cima} width={grupo} height={a} className={sobre === i ? 'grafico-faixa grafico-faixa-ativa' : 'grafico-faixa'} />
              {series.map((s, k) => {
                const v = s.valores[i];
                if (v === null || v === undefined || !Number.isFinite(v) || v === 0) return null;
                const topo = Math.min(y(v), y(0));
                return <rect key={s.nome} x={inicio + k * barra} y={topo} width={Math.max(1, barra - 1)} height={Math.max(1, Math.abs(y(v) - y(0)))} rx={2} style={{ fill: s.cor }} />;
              })}
              {visiveis.has(i) && (
                <text className="grafico-eixo" x={centro} y={altura - 8} textAnchor="middle">
                  {r}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <Leitura rotulo={rotulos[indice]} series={series} indice={indice} formato={formato} />
      {series.length > 1 && <Legenda series={series} />}
    </div>
  );
}
