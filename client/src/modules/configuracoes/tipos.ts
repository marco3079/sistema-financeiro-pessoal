import type { Plataforma } from '../../lib/plataforma';

// Contrato A: formato de GET /configuracoes e das respostas de PUT.
export interface ConfiguracoesDTO extends Plataforma {
  enderecoSite: string | null;
  smtpServidor: string | null;
  smtpPorta: number;
  smtpSeguro: boolean;
  smtpUsuario: string | null;
  smtpSenhaDefinida: boolean;
  emailRemetente: string | null;
  emailNomeRemetente: string | null;
  emailRecuperacao: boolean;
  emailBoasVindas: boolean;
  atualizadoEm: string | null;
}

// Campos enviados juntos em PUT /configuracoes/identidade.
export interface IdentidadeDados {
  nome: string;
  slogan: string;
  logo: string | null;
  corPrimaria: string;
  corSecundaria: string;
}

// Rascunho do formulário de e-mail (todos os campos como texto, exceto os booleanos).
export interface EmailFormulario {
  enderecoSite: string;
  smtpServidor: string;
  smtpPorta: string;
  smtpSeguro: boolean;
  smtpUsuario: string;
  smtpSenha: string;
  emailRemetente: string;
  emailNomeRemetente: string;
  emailAtivo: boolean;
  emailRecuperacao: boolean;
  emailBoasVindas: boolean;
}

// Contrato A: item de GET /configuracoes/email/historico.
export interface EmailEnviadoDTO {
  id: number;
  para: string;
  assunto: string;
  tipo: string;
  status: 'ENVIADO' | 'FALHOU';
  erro: string | null;
  criadoEm: string;
}

export const REGEX_COR = /^#[0-9a-fA-F]{6}$/;

export const COMBINACOES_CORES: { nome: string; corPrimaria: string; corSecundaria: string }[] = [
  { nome: 'Azul (padrão)', corPrimaria: '#2563eb', corSecundaria: '#1d4ed8' },
  { nome: 'Verde', corPrimaria: '#16a34a', corSecundaria: '#15803d' },
  { nome: 'Vermelho', corPrimaria: '#dc2626', corSecundaria: '#b91c1c' },
  { nome: 'Roxo', corPrimaria: '#7c3aed', corSecundaria: '#6d28d9' },
  { nome: 'Laranja', corPrimaria: '#ea580c', corSecundaria: '#c2410c' },
  { nome: 'Rosa', corPrimaria: '#db2777', corSecundaria: '#be185d' },
  { nome: 'Turquesa', corPrimaria: '#0891b2', corSecundaria: '#0e7490' },
  { nome: 'Grafite', corPrimaria: '#374151', corSecundaria: '#111827' },
];

const ROTULOS_TIPO_EMAIL: Record<string, string> = {
  TESTE: 'Teste',
  RECUPERACAO: 'Recuperação de senha',
  BOAS_VINDAS: 'Boas-vindas',
};

export function rotuloTipoEmail(tipo: string): string {
  return ROTULOS_TIPO_EMAIL[tipo] ?? tipo;
}

export function identidadeDe(c: ConfiguracoesDTO): IdentidadeDados {
  return {
    nome: c.nome,
    slogan: c.slogan,
    logo: c.logo,
    corPrimaria: c.corPrimaria,
    corSecundaria: c.corSecundaria,
  };
}

// Endereço do site vazio começa com a origem atual do navegador.
export function formularioDe(c: ConfiguracoesDTO): EmailFormulario {
  return {
    enderecoSite: c.enderecoSite || window.location.origin,
    smtpServidor: c.smtpServidor ?? '',
    smtpPorta: String(c.smtpPorta),
    smtpSeguro: c.smtpSeguro,
    smtpUsuario: c.smtpUsuario ?? '',
    smtpSenha: '',
    emailRemetente: c.emailRemetente ?? '',
    emailNomeRemetente: c.emailNomeRemetente ?? '',
    emailAtivo: c.emailAtivo,
    emailRecuperacao: c.emailRecuperacao,
    emailBoasVindas: c.emailBoasVindas,
  };
}
