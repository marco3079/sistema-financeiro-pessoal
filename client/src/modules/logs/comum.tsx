import { useEffect, useRef, useState } from 'react';
import { Selo } from '../../ui';

// ---------- Tipos (formato de segunda-leva.md: LogDTO e ResumoLogDTO) ----------

export interface LogDTO {
  id: number;
  criadoEm: string;
  usuarioId: number | null;
  usuarioNome: string | null;
  perfil: string | null;
  tipo: string;
  modulo: string;
  descricao: string;
  metodo: string | null;
  caminho: string | null;
  status: number | null;
  duracaoMs: number | null;
  ip: string | null;
  navegador: string | null;
}

export interface ResumoLogDTO {
  agora: string;
  online: {
    usuarioId: number;
    nome: string;
    perfil: string;
    ultimaDescricao: string;
    ultimoTipo: string;
    telaAtual: string | null;
    ultimaAtividade: string;
  }[];
  hoje: {
    atividades: number;
    usuariosAtivos: number;
    logins: number;
    falhasLogin: number;
    alteracoes: number;
  };
  porHora: { hora: string; total: number }[];
  porModulo: { modulo: string; total: number }[];
  porTipo: { tipo: string; total: number }[];
  topUsuarios: { usuarioId: number; nome: string; perfil: string; total: number }[];
  recentes: LogDTO[];
}

// ---------- Constantes ----------

export const INTERVALO_AO_VIVO_MS = 5000;

type CorSelo = 'verde' | 'amarelo' | 'vermelho' | 'azul' | 'cinza';

const ROTULO_TIPO: Record<string, { rotulo: string; cor: CorSelo }> = {
  LOGIN: { rotulo: 'Entrada', cor: 'verde' },
  FALHA_LOGIN: { rotulo: 'Falha de login', cor: 'vermelho' },
  SAIDA: { rotulo: 'Saída', cor: 'cinza' },
  TELA: { rotulo: 'Tela', cor: 'azul' },
  CONSULTA: { rotulo: 'Consulta', cor: 'cinza' },
  CRIACAO: { rotulo: 'Criação', cor: 'verde' },
  ALTERACAO: { rotulo: 'Alteração', cor: 'amarelo' },
  EXCLUSAO: { rotulo: 'Exclusão', cor: 'vermelho' },
};

const ROTULO_PERFIL: Record<string, { rotulo: string; cor: CorSelo }> = {
  TITULAR: { rotulo: 'Titular', cor: 'azul' },
};

export const TIPOS_LOG: { valor: string; rotulo: string }[] = Object.keys(ROTULO_TIPO).map((t) => ({
  valor: t,
  rotulo: ROTULO_TIPO[t].rotulo,
}));

// ---------- Formatação ----------

export function rotuloPerfil(perfil: string | null): string {
  if (!perfil) return '—';
  return ROTULO_PERFIL[perfil]?.rotulo ?? perfil;
}

// Rótulos com acento para os módulos conhecidos. A chave é comparada sem maiúsculas e sem acentos.
const ROTULO_MODULO: Record<string, string> = {
  contas: 'Contas',
  transacoes: 'Lançamentos',
  categorias: 'Categorias',
  cartoes: 'Cartões',
  faturas: 'Faturas',
  investimentos: 'Investimentos',
  orcamentos: 'Orçamento',
  metas: 'Metas',
  openfinance: 'Open Finance',
  usuarios: 'Usuários',
  atividades: 'Atividades',
  configuracoes: 'Configurações',
  cadastros: 'Cadastros',
  logs: 'Logs',
  painel: 'Início',
  auth: 'Sessão',
};

function chaveModulo(valor: string): string {
  return valor.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

const MAPA_MODULOS = new Map(Object.entries(ROTULO_MODULO).map(([k, v]) => [chaveModulo(k), v]));

// Módulo fora do mapa aparece como veio.
export function rotuloModulo(modulo: string | null | undefined): string {
  if (modulo === null || modulo === undefined || modulo.trim() === '') return '—';
  return MAPA_MODULOS.get(chaveModulo(modulo)) ?? modulo;
}

export function tempoRelativo(iso: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const segundos = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (segundos < 10) return 'agora';
  if (segundos < 60) return `há ${segundos} s`;
  const minutos = Math.floor(segundos / 60);
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${horas} h`;
  return `há ${Math.floor(horas / 24)} d`;
}

export function horaCurta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function dataHoraCompleta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function textoOuTraco(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined || valor === '') return '—';
  return String(valor);
}

export function mensagemErro(e: unknown): string {
  return e instanceof Error ? e.message : 'Erro inesperado';
}

// ---------- Peças compartilhadas ----------

function iniciais(nome: string | null): string {
  if (!nome) return '?';
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  const primeira = partes[0].charAt(0);
  const ultima = partes.length > 1 ? partes[partes.length - 1].charAt(0) : '';
  return (primeira + ultima).toUpperCase();
}

export function Avatar({ nome, pequeno }: { nome: string | null; pequeno?: boolean }) {
  return (
    <span className={pequeno ? 'logs-avatar logs-avatar-pequeno' : 'logs-avatar'} aria-hidden="true">
      {iniciais(nome)}
    </span>
  );
}

export function SeloTipo({ tipo }: { tipo: string }) {
  const info = ROTULO_TIPO[tipo];
  return <Selo cor={info?.cor ?? 'cinza'}>{info?.rotulo ?? tipo}</Selo>;
}

export function SeloPerfil({ perfil }: { perfil: string | null }) {
  const info = perfil ? ROTULO_PERFIL[perfil] : undefined;
  return <Selo cor={info?.cor ?? 'cinza'}>{rotuloPerfil(perfil)}</Selo>;
}

export function IndicadorAoVivo({ ativo, visivel }: { ativo: boolean; visivel: boolean }) {
  const texto = ativo ? 'Ao vivo' : visivel ? 'Pausado' : 'Pausado (aba oculta)';
  return (
    <span className={ativo ? 'logs-vivo logs-vivo-ativo' : 'logs-vivo'} role="status" aria-live="polite">
      <span className="logs-ponto" aria-hidden="true" />
      {texto}
    </span>
  );
}

// ---------- Tempo real ----------

// Pausa manual e pausa automática com a aba oculta. "ativo" diz se a atualização periódica deve rodar.
export function usePausaAoVivo(): {
  pausado: boolean;
  visivel: boolean;
  ativo: boolean;
  alternarPausa(): void;
} {
  const [pausado, setPausado] = useState(false);
  const [visivel, setVisivel] = useState<boolean>(() => document.visibilityState !== 'hidden');

  useEffect(() => {
    const aoMudarVisibilidade = () => setVisivel(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', aoMudarVisibilidade);
    return () => document.removeEventListener('visibilitychange', aoMudarVisibilidade);
  }, []);

  return {
    pausado,
    visivel,
    ativo: !pausado && visivel,
    alternarPausa: () => setPausado((p) => !p),
  };
}

// Chama "atualizar" a cada 5 s enquanto "ativo" for true. Ao retomar, atualiza na hora. Sempre limpa o intervalo.
export function useAoVivo(atualizar: () => void, ativo: boolean): void {
  const atualizarRef = useRef(atualizar);
  const estavaAtivo = useRef(ativo);

  useEffect(() => {
    atualizarRef.current = atualizar;
  }, [atualizar]);

  useEffect(() => {
    const eraAtivo = estavaAtivo.current;
    estavaAtivo.current = ativo;
    if (!ativo) return;
    if (!eraAtivo) atualizarRef.current();

    const id = window.setInterval(() => atualizarRef.current(), INTERVALO_AO_VIVO_MS);
    return () => window.clearInterval(id);
  }, [ativo]);
}
