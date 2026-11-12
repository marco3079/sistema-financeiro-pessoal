import { useEffect, useId, useRef, useState } from 'react';

// Gráfico de linha em SVG feito à mão (sem biblioteca). As cores vêm das classes painel-grafico-*,
// que usam só as variáveis do contrato visual (atributos de apresentação não leem var(), por isso classes).
// O desenho usa as dimensões reais do contêiner, medidas com ResizeObserver: nada distorce.

export interface PontoGrafico {
  rotulo: string;
  valor: number | null;
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
    p.valor === null ? [] : [{ x: xDe(i), y: yDe(p.valor), valor: p.valor, rotulo: p.rotulo }],
  );

  const caminho = marcados.map((m, k) => `${k === 0 ? 'M' : 'L'}${m.x} ${m.y}`).join(' ');
  const primeiro = marcados[0];
  const ultimo = marcados[marcados.length - 1];
  const caminhoArea =
    primeiro && ultimo ? `${caminho} L${ultimo.x} ${Y_BASE} L${primeiro.x} ${Y_BASE} Z` : '';

  let balao = null;
  if (ultimo) {
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

  return (
    <div ref={ref} className="painel-grafico-area-medida">
      <svg
        className="painel-grafico"
        viewBox={`0 0 ${larguraDesenho} ${alturaDesenho}`}
        width={larguraDesenho}
        height={alturaDesenho}
        role="img"
        aria-label="Gráfico de vendas por mês"
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

        {marcados.map((m, k) => (
          <circle key={k} className="painel-grafico-ponto" cx={m.x} cy={m.y} r={5} strokeWidth={3}>
            <title>{`${m.rotulo}: ${formatarValor(m.valor)}`}</title>
          </circle>
        ))}

        {balao}
      </svg>
    </div>
  );
}
