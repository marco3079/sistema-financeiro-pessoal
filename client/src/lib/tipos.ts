export type Perfil = 'TITULAR' | 'LEITOR';

const PERFIS_VALIDOS: Perfil[] = ['TITULAR', 'LEITOR'];

// Perfil vindo da API ou do navegador. O servidor é quem decide o acesso; LEITOR só consulta.
export function lerPerfil(valor: unknown): Perfil {
  return PERFIS_VALIDOS.includes(valor as Perfil) ? (valor as Perfil) : 'TITULAR';
}

// Início de cada perfil.
export const RAIZ_DO_PERFIL: Record<Perfil, string> = {
  TITULAR: '/app',
  LEITOR: '/app',
};

export const NOME_DO_PERFIL: Record<Perfil, string> = {
  TITULAR: 'Painel pessoal',
  LEITOR: 'Somente leitura',
};

// Mantido por compatibilidade com as telas herdadas: o perfil verdadeiro é o próprio perfil.
export type PerfilReal = Perfil;

export interface UsuarioLogado {
  id: number;
  nome: string;
  email: string;
  perfil: Perfil;
  perfilReal: PerfilReal;
  foto: string | null; // data URL ou endereço http(s); null sem foto
}

export const PERFIS: { valor: Perfil; rotulo: string }[] = [
  { valor: 'TITULAR', rotulo: 'Titular' },
  { valor: 'LEITOR', rotulo: 'Somente leitura' },
];

export function rotuloPerfil(valor: string): string {
  return PERFIS.find((p) => p.valor === valor)?.rotulo ?? valor;
}
