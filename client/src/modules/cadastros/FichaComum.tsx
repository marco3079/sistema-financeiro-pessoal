import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Botao, Selo } from '../../ui';
import './fichas.css';
import { Icone } from '../../ui/icones';
import type { NomeIcone } from '../../ui/icones';

// Peças usadas pelas fichas do aluno e do professor (popup, indicadores, seções, linhas, selos).

export type CorFicha = 'azul' | 'roxo' | 'verde' | 'laranja';
type CorSelo = 'verde' | 'amarelo' | 'vermelho' | 'azul' | 'cinza';

// ---------- Formatação ----------

export function formatarNota(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return n.toFixed(1).replace('.', ',');
}

export function formatarPercentual(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return `${n.toFixed(1).replace('.', ',')}%`;
}

export function formatarHoras(n: number): string {
  return `${n.toFixed(1).replace('.', ',')} h`;
}

export function iniciaisDe(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '';
  const primeira = partes[0][0];
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] : '';
  return (primeira + ultima).toUpperCase();
}

// ---------- Rótulos de status (português + cor do Selo) ----------

export interface Status {
  rotulo: string;
  cor: CorSelo;
}

export const STATUS_MATRICULA: Record<string, Status> = {
  ATIVA: { rotulo: 'Ativa', cor: 'verde' },
  TRANCADA: { rotulo: 'Trancada', cor: 'amarelo' },
  CONCLUIDA: { rotulo: 'Concluída', cor: 'azul' },
  CANCELADA: { rotulo: 'Cancelada', cor: 'cinza' },
};

export const STATUS_INSCRICAO: Record<string, Status> = {
  CURSANDO: { rotulo: 'Cursando', cor: 'azul' },
  APROVADO: { rotulo: 'Aprovado', cor: 'verde' },
  REPROVADO_NOTA: { rotulo: 'Reprovado por nota', cor: 'vermelho' },
  REPROVADO_FALTA: { rotulo: 'Reprovado por falta', cor: 'vermelho' },
  TRANCADO: { rotulo: 'Trancado', cor: 'cinza' },
};

export const STATUS_MENSALIDADE: Record<string, Status> = {
  ABERTA: { rotulo: 'Em aberto', cor: 'azul' },
  PAGA: { rotulo: 'Paga', cor: 'verde' },
  ATRASADA: { rotulo: 'Atrasada', cor: 'vermelho' },
  CANCELADA: { rotulo: 'Cancelada', cor: 'cinza' },
};

export const STATUS_PROJETO: Record<string, Status> = {
  EM_ELABORACAO: { rotulo: 'Em elaboração', cor: 'cinza' },
  QUALIFICADO: { rotulo: 'Qualificado', cor: 'azul' },
  APROVADO: { rotulo: 'Aprovado', cor: 'verde' },
  REPROVADO: { rotulo: 'Reprovado', cor: 'vermelho' },
};

export const ROTULO_BANCA_TIPO: Record<string, string> = {
  QUALIFICACAO: 'Qualificação',
  DEFESA: 'Defesa',
};

export const STATUS_BANCA_RESULTADO: Record<string, Status> = {
  PENDENTE: { rotulo: 'Pendente', cor: 'cinza' },
  APROVADO: { rotulo: 'Aprovado', cor: 'verde' },
  APROVADO_COM_RESSALVAS: { rotulo: 'Aprovado com ressalvas', cor: 'amarelo' },
  REPROVADO: { rotulo: 'Reprovado', cor: 'vermelho' },
};

// diaSemana da API: 1 = segunda ... 6 = sábado, 7 = domingo.
export const DIAS_SEMANA_LONGO: Record<number, string> = {
  1: 'Segunda-feira',
  2: 'Terça-feira',
  3: 'Quarta-feira',
  4: 'Quinta-feira',
  5: 'Sexta-feira',
  6: 'Sábado',
  7: 'Domingo',
};

// ---------- Modal da ficha ----------

export function FichaModal({
  aberto,
  titulo,
  aoFechar,
  children,
}: {
  aberto: boolean;
  titulo: string;
  aoFechar: () => void;
  children?: ReactNode;
}) {
  const botaoFechar = useRef<HTMLButtonElement>(null);
  const caixa = useRef<HTMLDivElement>(null);
  const aoFecharAtual = useRef(aoFechar);

  useEffect(() => {
    aoFecharAtual.current = aoFechar;
  });

  useEffect(() => {
    if (!aberto) return;
    // Elemento que estava focado antes de abrir: o foco volta a ele ao fechar.
    const anterior = document.activeElement as HTMLElement | null;
    botaoFechar.current?.focus();
    function tecla(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        aoFecharAtual.current();
        return;
      }
      // Prende o Tab dentro do popup: último -> primeiro, e Shift+Tab no primeiro -> último.
      if (e.key !== 'Tab' || !caixa.current) return;
      const focaveis = Array.from(
        caixa.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
      if (focaveis.length === 0) return;
      const primeiro = focaveis[0];
      const ultimo = focaveis[focaveis.length - 1];
      const ativo = document.activeElement as HTMLElement | null;
      const dentro = ativo !== null && caixa.current.contains(ativo);
      if (e.shiftKey && (!dentro || ativo === primeiro)) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && (!dentro || ativo === ultimo)) {
        e.preventDefault();
        primeiro.focus();
      }
    }
    document.addEventListener('keydown', tecla);
    return () => {
      document.removeEventListener('keydown', tecla);
      anterior?.focus?.();
    };
  }, [aberto]);

  if (!aberto) return null;

  return (
    <div className="ficha-fundo" onClick={aoFechar}>
      <div
        ref={caixa}
        className="ficha-caixa"
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          ref={botaoFechar}
          type="button"
          className="ficha-fechar"
          aria-label="Fechar"
          onClick={aoFechar}
        >
          <Icone nome="fechar" tamanho={18} />
        </button>
        <div className="ficha-corpo">{children}</div>
      </div>
    </div>
  );
}

// ---------- Cabeçalho ----------

export function FichaCabecalho({
  nome,
  subtitulo,
  detalhe,
  ativo,
  aoEditar,
}: {
  nome: string;
  subtitulo: string;
  detalhe?: string;
  ativo: boolean;
  aoEditar: () => void;
}) {
  return (
    <header className="ficha-cabecalho">
      <div className="ficha-cabecalho-pessoa">
        <span className="ficha-avatar" aria-hidden="true">
          {iniciaisDe(nome)}
        </span>
        <div className="ficha-cabecalho-texto">
          <h2 className="ficha-nome">{nome}</h2>
          <p className="ficha-subtitulo">{subtitulo}</p>
          {detalhe && <p className="ficha-subtitulo">{detalhe}</p>}
          <span>
            <Selo cor={ativo ? 'verde' : 'cinza'}>{ativo ? 'Ativo' : 'Inativo'}</Selo>
          </span>
        </div>
      </div>
      <div className="ficha-cabecalho-acoes">
        <Botao variante="secundario" aoClicar={aoEditar}>
          Editar
        </Botao>
      </div>
    </header>
  );
}

// ---------- Indicadores ----------

export function FichaIndicador({
  icone,
  cor,
  valor,
  rotulo,
  detalhe,
}: {
  icone: NomeIcone;
  cor: CorFicha;
  valor: ReactNode;
  rotulo: string;
  detalhe?: ReactNode;
}) {
  return (
    <div className="ficha-indicador">
      <span className={`ficha-indicador-icone ficha-cor-${cor}`} aria-hidden="true">
        <Icone nome={icone} tamanho={24} />
      </span>
      <div className="ficha-indicador-texto">
        <span className="ficha-indicador-valor">{valor}</span>
        <span className="ficha-indicador-rotulo">{rotulo}</span>
        {detalhe && <span className="ficha-indicador-detalhe">{detalhe}</span>}
      </div>
    </div>
  );
}

// ---------- Seções e linhas ----------

export function FichaSecao({
  titulo,
  icone,
  children,
}: {
  titulo: string;
  icone: NomeIcone;
  children?: ReactNode;
}) {
  return (
    <section className="ficha-secao">
      <h3 className="ficha-secao-titulo">
        <span className="ficha-secao-icone" aria-hidden="true">
          <Icone nome={icone} tamanho={18} />
        </span>
        {titulo}
      </h3>
      {children}
    </section>
  );
}

export function FichaLinha({
  rotulo,
  valor,
}: {
  rotulo: string;
  valor: ReactNode | null | undefined;
}) {
  const vazio = valor === null || valor === undefined || valor === '';
  return (
    <div className="ficha-linha">
      <span className="ficha-linha-rotulo">{rotulo}</span>
      <span className="ficha-linha-valor">{vazio ? '—' : valor}</span>
    </div>
  );
}

// Item de lista dentro de uma seção (título em destaque, detalhes e selo opcional).
export function FichaItem({
  titulo,
  selo,
  children,
}: {
  titulo: ReactNode;
  selo?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="ficha-item">
      <div className="ficha-item-topo">
        <span className="ficha-item-titulo">{titulo}</span>
        {selo}
      </div>
      {children && <div className="ficha-item-detalhe">{children}</div>}
    </div>
  );
}

// ---------- Selo de status ----------

export function SeloStatus({ valor, mapa }: { valor: string; mapa: Record<string, Status> }) {
  const item = mapa[valor];
  return <Selo cor={item?.cor ?? 'cinza'}>{item?.rotulo ?? valor}</Selo>;
}
