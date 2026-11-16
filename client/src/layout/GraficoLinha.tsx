import { useEffect, useId, useRef, useState } from 'react';

// Gráfico de linha em SVG feito à mão (sem biblioteca). As cores vêm das classes painel-grafico-*,
// que usam só as variáveis do contrato visual (atributos de apresentação não leem var(), por isso classes).
// O desenho usa as dimensões reais do contêiner, medidas com ResizeObserver: nada distorce.

export interface PontoGrafico {
  rotulo: string;
  valor: number | null;
  mes?: string; // 'AAAA-MM': no balão, o mês por extenso
  detalhe?: { contas: number; investimentos: number; cartoes: number } | null;
  estimado?: boolean;
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function mesPorExtenso(p: { rotulo: string; mes?: string }): string {
  if (!p.mes) return p.rotulo;
  const nome = MESES[Number(p.mes.slice(5, 7)) - 1] ?? p.rotulo;
  return `${nome.charAt(0).toUpperCase()}${nome.slice(1)} de ${p.mes.slice(0, 4)}`;
}

function formatarVariacao(diferenca: number, anterior: number): string {
  const sinal = diferenca > 0 ? '+' : diferenca < 0 ? '−' : '';
  const pct = anterior !== 0 ? ` (${sinal}${Math.abs((diferenca / Math.abs(anterior)) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%)` : '';
  return `${sinal}${formatarValor(Math.abs(diferenca))}${pct}`;
}

const LIMITE_ROTULOS_TODOS = 6; // acima disso, só um rótulo sim e outro não (o último sempre aparece)
const TAM_PADRAO = { l: 480, a: 240 };
const TAM_MINIMO = { l: 280, a: 200 };

function formatarValor(valor: number): string {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

// Rótulo curto do eixo: 0, 500, 1,5 mil, 20 mil.
function formatarEixo(valor: number): string {
  if (valor >= 1000) {
    return `${(valor / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  }
  return valor.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

// Teto "redondo" do eixo, logo acima do maior valor (1, 2, 2,5, 5 ou 10 vezes uma potência de 10).
function tetoDoEixo(maior: number): number {
  if (maior <= 0) return 100;
  const potencia = Math.pow(10, Math.floor(Math.log10(maior)));
  const passo = [1, 2, 2.5, 5, 10].find((m) => m * potencia >= maior) ?? 10;
  return passo * potencia;
}

export function GraficoLinha({ pontos }: { pontos: PontoGrafico[] }) {
  // Id único por instância; os dois-pontos do useId são trocados para a referência url(#...) ficar válida.
  const id = 'painel-degrade-' + useId().replace(/:/g, '');
  const ref = useRef<HTMLDivElement>(null);
  const [tam, setTam] = useState<{ l: number; a: number }>(TAM_PADRAO);
  const [sobre, setSobre] = useState<number | null>(null); // ponto sob o mouse (índice em `marcados`)

  useEffect(() => {
    const elemento = ref.current;
    if (!elemento || typeof ResizeObserver === 'undefined') return;
    const observador = new ResizeObserver((entradas) => {
      const entrada = entradas[0];
      if (!entrada) return;
      const l = Math.max(TAM_MINIMO.l, Math.round(entrada.contentRect.width));
      const a = Math.max(TAM_MINIMO.a, Math.round(entrada.contentRect.height));
      // Só atualiza se mudou, para não criar laço de renderização.
      setTam((anterior) => (anterior.l === l && anterior.a === a ? anterior : { l, a }));
    });
    observador.observe(elemento);
    return () => observador.disconnect();
  }, []);

  const larguraDesenho = tam.l;
  const alturaDesenho = tam.a;
  const X_ESQ = 58;
  const X_DIR = larguraDesenho - 12;
  const Y_TOPO = 20; // teto do eixo
  const Y_BASE = alturaDesenho - 40; // zero
  const Y_ROTULOS = alturaDesenho - 14;

  const n = pontos.length;
  const mostrarTodosRotulos = n <= LIMITE_ROTULOS_TODOS;

  const xDe = (i: number): number =>
    n <= 1 ? (X_ESQ + X_DIR) / 2 : X_ESQ + (i * (X_DIR - X_ESQ)) / (n - 1);

  const teto = tetoDoEixo(Math.max(0, ...pontos.map((p) => p.valor ?? 0)));

  const yDe = (valor: number): number => {
    const limitado = Math.min(teto, Math.max(0, valor));
    return Y_BASE - (limitado / teto) * (Y_BASE - Y_TOPO);
  };

  // Só os pontos com valor; buracos (null) são pulados e a linha segue para o próximo valor.
  const marcados = pontos.flatMap((p, i) =>
    p.valor === null ? [] : [{ x: xDe(i), y: yDe(p.valor), valor: p.valor, rotulo: p.rotulo, ponto: p }],
  );

  const caminho = marcados.map((m, k) => `${k === 0 ? 'M' : 'L'}${m.x} ${m.y}`).join(' ');
  const primeiro = marcados[0];
  const ultimo = marcados[marcados.length - 1];
  const caminhoArea =
    primeiro && ultimo ? `${caminho} L${ultimo.x} ${Y_BASE} L${primeiro.x} ${Y_BASE} Z` : '';

  let balao = null;
  // Com o mouse sobre um mês, o balão do último mês sai e entra o quadro do mês apontado (fora do SVG).
  if (ultimo && sobre === null) {
    const texto = formatarValor(ultimo.valor);
    const largura = Math.max(48, texto.length * 8 + 16);
    const altura = 24;
    // Centralizado sobre o ponto, mas preso entre 4 e a largura do desenho.
    const esquerda = Math.min(Math.max(ultimo.x - largura / 2, 4), larguraDesenho - 4 - largura);
    // Acima do ponto; se não couber no topo, fica abaixo.
    let topo = ultimo.y - 12 - altura;
    if (topo < 2) topo = ultimo.y + 12;
    balao = (
      <g>
        <rect className="painel-grafico-balao" x={esquerda} y={topo} width={largura} height={altura} rx={8} />
        <text
          className="painel-grafico-balao-texto"
          x={esquerda + largura / 2}
          y={topo + altura / 2}
          textAnchor="middle"
          dominantBaseline="central"
        >
          {texto}
        </text>
      </g>
    );
  }

  const niveis = [0, 0.25, 0.5, 0.75, 1].map((fracao) => fracao * teto);

  // Quadro do mês apontado: mês por extenso, patrimônio, variação sobre o mês anterior e a composição.
  const apontado = sobre !== null ? marcados[sobre] : null;
  const anterior = sobre !== null && sobre > 0 ? marcados[sobre - 1] : null;
  const LARGURA_DICA = 230;
  const dica = apontado ? (
    <div
      className="painel-grafico-dica"
      role="status"
      style={{
        left: Math.min(Math.max(apontado.x - LARGURA_DICA / 2, 4), larguraDesenho - LARGURA_DICA - 4),
        top: apontado.y > alturaDesenho / 2 ? Math.max(4, apontado.y - 150) : apontado.y + 16,
        width: LARGURA_DICA,
      }}
    >
      <strong>{mesPorExtenso(apontado.ponto)}</strong>
      <span className="painel-grafico-dica-valor">{formatarValor(apontado.valor)}</span>
      {anterior && (
        <span className={apontado.valor - anterior.valor >= 0 ? 'painel-grafico-dica-sobe' : 'painel-grafico-dica-desce'}>
          {formatarVariacao(apontado.valor - anterior.valor, anterior.valor)} sobre {mesPorExtenso(anterior.ponto).split(' de ')[0].toLowerCase()}
        </span>
      )}
      {apontado.ponto.detalhe && (
        <dl>
          <dt>Contas</dt>
          <dd>{formatarValor(apontado.ponto.detalhe.contas)}</dd>
          <dt>Investimentos</dt>
          <dd>{formatarValor(apontado.ponto.detalhe.investimentos)}</dd>
          {apontado.ponto.detalhe.cartoes > 0 && (
            <>
              <dt>Cartões a pagar</dt>
              <dd>−{formatarValor(apontado.ponto.detalhe.cartoes)}</dd>
            </>
          )}
        </dl>
      )}
      {apontado.ponto.estimado && <span className="painel-grafico-dica-nota">Estimado pelos movimentos e preços (antes da instalação).</span>}
    </div>
  ) : null;

  // Área de cada mês para o mouse: do meio entre ele e o anterior até o meio entre ele e o próximo.
  const faixas = marcados.map((m, k) => {
    const esquerda = k === 0 ? X_ESQ - 10 : (marcados[k - 1].x + m.x) / 2;
    const direita = k === marcados.length - 1 ? X_DIR + 10 : (m.x + marcados[k + 1].x) / 2;
    return { k, x: esquerda, largura: Math.max(1, direita - esquerda) };
  });

  return (
    <div ref={ref} className="painel-grafico-area-medida" onMouseLeave={() => setSobre(null)}>
      {dica}
      <svg
        className="painel-grafico"
        viewBox={`0 0 ${larguraDesenho} ${alturaDesenho}`}
        width={larguraDesenho}
        height={alturaDesenho}
        role="img"
        aria-label="Gráfico do patrimônio por mês"
      >
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" className="painel-grafico-degrade-topo" />
            <stop offset="1" className="painel-grafico-degrade-base" />
          </linearGradient>
        </defs>

        {niveis.map((nivel) => {
          const y = yDe(nivel);
          return (
            <g key={nivel}>
              <line className="painel-grafico-grade" x1={X_ESQ} x2={X_DIR} y1={y} y2={y} />
              <text className="painel-grafico-eixo" x={X_ESQ - 8} y={y + 4} textAnchor="end">
                {formatarEixo(nivel)}
              </text>
            </g>
          );
        })}

        {pontos.map((p, i) =>
          // Com muitos meses, mostra um sim e outro não contando a partir do último (que sempre aparece).
          mostrarTodosRotulos || (n - 1 - i) % 2 === 0 ? (
            <text
              key={`${p.rotulo}-${i}`}
              className="painel-grafico-eixo"
              x={xDe(i)}
              y={Y_ROTULOS}
              textAnchor="middle"
            >
              {p.rotulo}
            </text>
          ) : null,
        )}

        {caminhoArea && <path className="painel-grafico-area" d={caminhoArea} fill={`url(#${id})`} />}
        {caminho && <path className="painel-grafico-linha" d={caminho} />}

        {apontado && <line className="painel-grafico-guia" x1={apontado.x} x2={apontado.x} y1={Y_TOPO} y2={Y_BASE} />}

        {marcados.map((m, k) => (
          <circle
            key={k}
            className={sobre === k ? 'painel-grafico-ponto painel-grafico-ponto-ativo' : 'painel-grafico-ponto'}
            cx={m.x}
            cy={m.y}
            r={sobre === k ? 7 : 5}
            strokeWidth={3}
            tabIndex={0}
            aria-label={`${mesPorExtenso(m.ponto)}: ${formatarValor(m.valor)}`}
            onFocus={() => setSobre(k)}
            onBlur={() => setSobre(null)}
          />
        ))}

        {/* Por cima de tudo: faixas transparentes que acham o mês sob o mouse (ou o toque). */}
        {faixas.map((f) => (
          <rect
            key={f.k}
            className="painel-grafico-faixa"
            x={f.x}
            y={Y_TOPO - 10}
            width={f.largura}
            height={Y_BASE - Y_TOPO + 20}
            onMouseEnter={() => setSobre(f.k)}
            onClick={() => setSobre((atual) => (atual === f.k ? null : f.k))}
          />
        ))}

        {balao}
      </svg>
    </div>
  );
}
