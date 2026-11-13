import type { Perfil } from '../../lib/tipos';

export interface Atalho {
  caminho: string;
  titulo: string;
  texto: string; // uma linha de explicação
}

// Cópia do filtro de App.tsx (CAMINHOS_SO_TITULAR): telas que o LEITOR não abre.
// Se a lista mudar lá, mude aqui também.
const CAMINHOS_SO_TITULAR = [
  '/app/usuarios',
  '/app/configuracoes',
  '/app/logs',
  '/app/atividades',
  '/app/perfis',
  '/app/ia',
  '/app/drive',
  '/app/atualizacao',
  '/app/seguranca',
  '/app/entrada',
  '/app/importar',
  '/app/rapido',
  '/app/regras',
  '/app/cupom',
  '/app/avisos',
  '/app/conexoes',
];

// Uma central só mostra atalho para tela que o perfil pode abrir.
export function atalhoLiberado(caminho: string, perfil: Perfil): boolean {
  if (perfil === 'TITULAR') return true;
  return !CAMINHOS_SO_TITULAR.some((c) => caminho === c || caminho.startsWith(c + '/'));
}

export const ATALHOS_INVESTIMENTOS: Atalho[] = [
  { caminho: '/app/rendimento', titulo: 'Rendimento', texto: 'Quanto os investimentos renderam no período.' },
  { caminho: '/app/ativo', titulo: 'Ficha do ativo', texto: 'Histórico, preço médio e proventos de um ativo.' },
  { caminho: '/app/alvo', titulo: 'Carteira-alvo', texto: 'Compare a carteira atual com a divisão que você quer.' },
  { caminho: '/app/ir', titulo: 'Imposto de renda', texto: 'Resumo de vendas e imposto estimado do ano.' },
  { caminho: '/app/simulador', titulo: 'Simulador', texto: 'Veja quanto um aporte pode render ao longo do tempo.' },
];

export const ATALHOS_DADOS: Atalho[] = [
  { caminho: '/app/entrada', titulo: 'Pasta de entrada', texto: 'Arquivos guardados para importar depois.' },
  { caminho: '/app/regras', titulo: 'Regras de categoria', texto: 'Categorias automáticas para novos lançamentos.' },
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
  { caminho: '/app/ia', titulo: 'Conectar IA', texto: 'Ligue assistentes de IA ao sistema.' },
  { caminho: '/app/cupom', titulo: 'Leitura de cupom', texto: 'Leia cupons fiscais por foto.' },
  { caminho: '/app/avisos', titulo: 'Avisos', texto: 'Receba avisos por e-mail ou Telegram.' },
  { caminho: '/app/atualizacao', titulo: 'Atualização', texto: 'Atualize o sistema pelo GitHub.' },
  { caminho: '/app/logs', titulo: 'Log do sistema', texto: 'Registros técnicos do funcionamento.' },
  { caminho: '/app/atividades', titulo: 'Atividade', texto: 'Quem fez o quê e quando.' },
];
