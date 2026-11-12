// Componentes visuais compartilhados pelas telas financeiras.
// Todas as cores vêm das variáveis de estilo.css; as classes "fin-" ficam em financas.css.
import type { ReactNode } from 'react';
import { CORES_PALETA, formatarPercentual, formatarReais, rotuloMes, somarMeses } from '../lib/financas';
import { Icone } from './icones';
import type { NomeIcone } from './icones';
import './financas.css';

// Cartão de indicador (mesmo desenho do resumo da tela Usuários). Use dentro de <div className="resumo">.
export function ResumoItem({
  icone,
  cor,
  valor,
  rotulo,
}: {
  icone: NomeIcone;
  cor: 'azul' | 'roxo' | 'verde' | 'laranja' | 'vermelho';
  valor: string | number;
  rotulo: string;
}) {
  return (
    <div className="resumo-item">
      <span className={`resumo-icone resumo-icone-${cor}`} aria-hidden="true">
        <Icone nome={icone} tamanho={24} />
      </span>
      <div className="fin-resumo-texto">
        <span className="resumo-valor">{valor}</span>
        <span className="resumo-rotulo">{rotulo}</span>
      </div>
    </div>
  );
}

// Navegação de mês: seta, "Novembro de 2026", seta. `mes` é 'AAAA-MM'.
export function SeletorMes({ mes, aoMudar }: { mes: string; aoMudar: (mes: string) => void }) {
  return (
    <div className="fin-mes" role="group" aria-label="Mês">
      <button type="button" className="fin-mes-botao" aria-label="Mês anterior" onClick={() => aoMudar(somarMeses(mes, -1))}>
        <Icone nome="seta-esquerda" tamanho={18} />
      </button>
      <span className="fin-mes-rotulo">{rotuloMes(mes)}</span>
      <button type="button" className="fin-mes-botao" aria-label="Próximo mês" onClick={() => aoMudar(somarMeses(mes, 1))}>
        <Icone nome="seta-direita" tamanho={18} />
      </button>
    </div>
  );
}

// Dinheiro colorido: 'entrada' verde com "+", 'saida' vermelho com "-", 'neutro' na cor do texto.
// Em 'auto', o sinal do número decide (negativo = saída).
export function Valor({
  valor,
  sentido = 'neutro',
}: {
  valor: number;
  sentido?: 'entrada' | 'saida' | 'neutro' | 'auto';
}) {
  const efetivo = sentido === 'auto' ? (valor < 0 ? 'saida' : valor > 0 ? 'entrada' : 'neutro') : sentido;
  const texto = formatarReais(Math.abs(valor));
  if (efetivo === 'entrada') return <span className="fin-valor fin-valor-entrada">+ {texto}</span>;
  if (efetivo === 'saida') return <span className="fin-valor fin-valor-saida">- {texto}</span>;
  return <span className="fin-valor">{formatarReais(valor)}</span>;
}

// Barra de progresso. Acima de 100% fica vermelha; `cor` (hex) troca a cor normal.
export function BarraProgresso({ percentual, cor }: { percentual: number; cor?: string }) {
  const largura = Math.max(0, Math.min(100, percentual));
  const estourou = percentual > 100;
  return (
    <div
      className={estourou ? 'fin-barra fin-barra-estourou' : 'fin-barra'}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(largura)}
    >
      <span className="fin-barra-cheio" style={{ width: `${largura}%`, background: estourou ? undefined : cor }} />
    </div>
  );
}

// Bolinha com a cor de uma conta ou categoria.
export function PontoCor({ cor }: { cor: string | null | undefined }) {
  return <span className="fin-ponto" style={{ background: cor ?? 'var(--cor-texto-suave)' }} aria-hidden="true" />;
}

// Nome com a bolinha de cor na frente (célula de tabela).
export function NomeComCor({ cor, children }: { cor: string | null | undefined; children: ReactNode }) {
  return (
    <span className="fin-nome-cor">
      <PontoCor cor={cor} />
      <span>{children}</span>
    </span>
  );
}

// Escolha de cor numa paleta fixa. `valor` é hex com # (ex.: "#2563eb").
export function CampoCor({ rotulo, valor, aoMudar }: { rotulo: string; valor: string; aoMudar: (cor: string) => void }) {
  return (
    <div className="campo">
      <span className="campo-rotulo">{rotulo}</span>
      <div className="fin-paleta" role="radiogroup" aria-label={rotulo}>
        {CORES_PALETA.map((cor) => (
          <button
            key={cor}
            type="button"
            role="radio"
            aria-checked={valor.toLowerCase() === cor}
            aria-label={`Cor ${cor}`}
            className={valor.toLowerCase() === cor ? 'fin-cor fin-cor-ativa' : 'fin-cor'}
            style={{ background: cor }}
            onClick={() => aoMudar(cor)}
          />
        ))}
      </div>
    </div>
  );
}

export interface Fatia {
  rotulo: string;
  valor: number;
  cor: string;
}

// Gráfico de rosca com legenda (alocação de investimentos, despesas por categoria).
// `centro` aparece no meio da rosca (ex.: o total).
export function Rosca({ fatias, centro }: { fatias: Fatia[]; centro?: string }) {
  const validas = fatias.filter((f) => f.valor > 0);
  const total = validas.reduce((soma, f) => soma + f.valor, 0);
  const RAIO = 42;
  const COMPRIMENTO = 2 * Math.PI * RAIO;
  let acumulado = 0;
  return (
    <div className="fin-rosca">
      <svg viewBox="0 0 120 120" className="fin-rosca-desenho" role="img" aria-label="Distribuição">
        <circle cx="60" cy="60" r={RAIO} className="fin-rosca-fundo" />
        {total > 0 &&
          validas.map((f) => {
            const parte = (f.valor / total) * COMPRIMENTO;
            const inicio = acumulado;
            acumulado += parte;
            return (
              <circle
                key={f.rotulo}
                cx="60"
                cy="60"
                r={RAIO}
                fill="none"
                stroke={f.cor}
                strokeWidth="16"
                strokeDasharray={`${parte} ${COMPRIMENTO - parte}`}
                strokeDashoffset={-inicio}
                transform="rotate(-90 60 60)"
              >
                <title>{`${f.rotulo}: ${formatarReais(f.valor)}`}</title>
              </circle>
            );
          })}
        {centro && (
          <text x="60" y="64" textAnchor="middle" className="fin-rosca-centro">
            {centro}
          </text>
        )}
      </svg>
      <ul className="fin-legenda">
        {validas.map((f) => (
          <li key={f.rotulo}>
            <PontoCor cor={f.cor} />
            <span className="fin-legenda-rotulo">{f.rotulo}</span>
            <span className="fin-legenda-valor">
              {formatarReais(f.valor)} · {formatarPercentual(total > 0 ? (f.valor / total) * 100 : 0)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Estado vazio com ícone, título, texto e (opcional) um botão.
export function Vazio({
  icone,
  titulo,
  texto,
  children,
}: {
  icone: NomeIcone;
  titulo: string;
  texto?: string;
  children?: ReactNode;
}) {
  return (
    <div className="fin-vazio">
      <span className="fin-vazio-icone" aria-hidden="true">
        <Icone nome={icone} tamanho={28} />
      </span>
      <strong>{titulo}</strong>
      {texto && <p>{texto}</p>}
      {children}
    </div>
  );
}

// Selo "Open Finance" para registros trazidos pela conexão bancária.
export function SeloOrigem({ origem }: { origem: 'MANUAL' | 'OPEN_FINANCE' }) {
  if (origem !== 'OPEN_FINANCE') return null;
  return (
    <span className="selo selo-azul fin-selo-origem" title="Atualizado automaticamente pelo Open Finance">
      Open Finance
    </span>
  );
}
