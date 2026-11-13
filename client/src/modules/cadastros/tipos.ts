// Formatos devolvidos pela API do módulo cadastros (sem senhaHash).

export interface UsuarioDTO {
  id: number;
  nome: string;
  email: string;
  perfil: string;
  ativo: boolean;
  cpf: string | null;
  telefone: string | null;
  criadoEm: string;
}

export type PerfilMeu = UsuarioDTO;

export const PERFIS: { valor: string; rotulo: string }[] = [
  { valor: 'TITULAR', rotulo: 'Titular' },
  { valor: 'LEITOR', rotulo: 'Somente leitura' },
];

export function rotuloPerfil(valor: string): string {
  return PERFIS.find((p) => p.valor === valor)?.rotulo ?? valor;
}

// Campo vazio vira null (opcional); senão devolve o texto sem espaços das pontas.
export function nulo(valor: string): string | null {
  const limpo = valor.trim();
  return limpo === '' ? null : limpo;
}

// Datas de nascimento: a API guarda meia-noite UTC, então usa-se o dia do ISO direto
// (evita deslocamento de um dia no fuso do Brasil).
export function dataParaInput(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '';
}

export function dataBr(iso: string | null): string {
  const dia = dataParaInput(iso);
  if (!dia) return '—';
  const [ano, mes, d] = dia.split('-');
  return `${d}/${mes}/${ano}`;
}

export function mensagemErro(e: unknown): string {
  return e instanceof Error ? e.message : 'Erro inesperado';
}

// Monta a query string ignorando valores vazios: queryString({ busca: '', perfil: 'TITULAR' }) -> '?perfil=TITULAR'.
export function queryString(params: Record<string, string>): string {
  const partes = Object.entries(params)
    .filter(([, v]) => v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  return partes.length ? `?${partes.join('&')}` : '';
}

// Log de atividades: GET /logs, GET /logs/usuarios/:id/resumo.

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

export interface ListaLogDTO {
  itens: LogDTO[];
  haMais: boolean;
}

export interface ResumoUsuarioLogDTO {
  ultimoLogin: string | null;
  ultimaAtividade: string | null;
  telaAtual: string | null;
  online: boolean;
  atividadesHoje: number;
  atividades7Dias: number;
  porTipo: { tipo: string; total: number }[];
}
