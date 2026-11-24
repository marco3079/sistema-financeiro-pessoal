import type { NivelPerfil } from '../../lib/perfilFinanceiro';
import type { Perfil } from '../../lib/tipos';

export interface Atalho {
  caminho: string;
  titulo: string;
  texto: string; // uma linha de explicação
}

// Cópia do filtro de App.tsx (CAMINHOS_SO_TITULAR e CAMINHOS_DE_EDICAO): telas que o membro não abre.
// Se a lista mudar lá, mude aqui também.
const CAMINHOS_SO_TITULAR = [
  '/app/usuarios',
  '/app/configuracoes',
  '/app/logs',
  '/app/atividades',
  '/app/ia',
  '/app/drive',
  '/app/atualizacao',
  '/app/entrada',
  '/app/automacoes',
  '/app/acesso-seguro',
  '/app/status-servidor',
  '/app/cupom',
  '/app/avisos',
  '/app/conexoes',
];
const CAMINHOS_DE_EDICAO = ['/app/importar', '/app/rapido', '/app/regras'];

function casa(caminho: string, lista: string[]): boolean {
  return lista.some((c) => caminho === c || caminho.startsWith(c + '/'));
}

// Uma central só mostra atalho para tela que o usuário pode abrir (nível do membro no perfil em uso).
export function atalhoLiberado(caminho: string, perfil: Perfil, nivel: NivelPerfil | null = null): boolean {
  if (perfil === 'TITULAR') return true;
  if (casa(caminho, CAMINHOS_SO_TITULAR)) return false;
  return nivel === 'EDICAO' || !casa(caminho, CAMINHOS_DE_EDICAO);
}

export const ATALHOS_INVESTIMENTOS: Atalho[] = [
  { caminho: '/app/rendimento', titulo: 'Rendimento', texto: 'Quanto os investimentos renderam no período.' },
  { caminho: '/app/ativo', titulo: 'Ficha do ativo', texto: 'Histórico, preço médio e proventos de um ativo.' },
  { caminho: '/app/alvo', titulo: 'Carteira-alvo', texto: 'Compare a carteira atual com a divisão que você quer.' },
  { caminho: '/app/suno', titulo: 'Carteiras Suno', texto: 'O que falta comprar ou já saiu das carteiras da Suno que você assina.' },
  { caminho: '/app/ir', titulo: 'Imposto de renda', texto: 'Resumo de vendas e imposto estimado do ano.' },
  { caminho: '/app/simulador', titulo: 'Simulador', texto: 'Veja quanto um aporte pode render ao longo do tempo.' },
];

export const ATALHOS_DADOS: Atalho[] = [
  { caminho: '/app/entrada', titulo: 'Pasta de entrada', texto: 'Arquivos guardados para importar depois.' },
  { caminho: '/app/regras', titulo: 'Regras de categoria', texto: 'Categorias automáticas para novos lançamentos.' },
  { caminho: '/app/automacoes', titulo: 'Automações', texto: 'Condições que marcam transferências, categorias e o que sai da lista.' },
  { caminho: '/app/categorias', titulo: 'Categorias', texto: 'Crie e organize as categorias de gastos e receitas.' },
  { caminho: '/app/conciliacao', titulo: 'Conciliação', texto: 'Confira os lançamentos com a fatura do cartão.' },
  { caminho: '/app/conexoes', titulo: 'Conexões', texto: 'Bancos e serviços ligados ao sistema.' },
  { caminho: '/app/drive', titulo: 'Drive', texto: 'Veja a ligação e os arquivos do Drive.' },
];

export const ATALHOS_CONFIGURACOES: Atalho[] = [
  { caminho: '/app/configuracoes', titulo: 'Configurações gerais', texto: 'Ajustes básicos do sistema.' },
  { caminho: '/app/perfis', titulo: 'Perfis financeiros', texto: 'Separe as finanças em perfis diferentes.' },
  { caminho: '/app/usuarios', titulo: 'Usuários', texto: 'Quem pode entrar e o que cada pessoa vê.' },
  { caminho: '/app/seguranca', titulo: 'Segurança', texto: 'Senha e proteção da conta.' },
  { caminho: '/app/acesso-seguro', titulo: 'Acesso seguro (HTTPS)', texto: 'Endereço https para o celular, pelo Tailscale.' },
  { caminho: '/app/status-servidor', titulo: 'Status do servidor', texto: 'Situação de cada contêiner do sistema.' },
  { caminho: '/app/ia', titulo: 'Conectar IA', texto: 'Ligue assistentes de IA ao sistema.' },
  { caminho: '/app/cupom', titulo: 'Leitura de cupom', texto: 'Leia cupons fiscais por foto.' },
  { caminho: '/app/avisos', titulo: 'Avisos', texto: 'Receba avisos por e-mail ou Telegram.' },
  { caminho: '/app/atualizacao', titulo: 'Atualização', texto: 'Atualize o sistema pelo GitHub.' },
  { caminho: '/app/logs', titulo: 'Log do sistema', texto: 'Registros técnicos do funcionamento.' },
  { caminho: '/app/atividades', titulo: 'Atividade', texto: 'Quem fez o quê e quando.' },
];
