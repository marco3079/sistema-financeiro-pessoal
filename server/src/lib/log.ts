import { prisma } from './prisma';

export type TipoLog =
  | 'LOGIN'
  | 'FALHA_LOGIN'
  | 'SAIDA'
  | 'TELA'
  | 'CONSULTA'
  | 'CRIACAO'
  | 'ALTERACAO'
  | 'EXCLUSAO';

export interface DadosLog {
  usuarioId?: number | null;
  usuarioNome?: string | null;
  perfil?: string | null;
  tipo: TipoLog;
  modulo: string;
  descricao: string;
  metodo?: string;
  caminho?: string;
  status?: number;
  duracaoMs?: number;
  ip?: string | null;
  navegador?: string | null;
}

const DIAS_RETENCAO = 90;
const MS_DIA = 24 * 60 * 60 * 1000;
const VALIDADE_NOME_MS = 10 * 60 * 1000;
const JANELA_CONSULTA_MS = 90 * 1000;
const LIMITE_CHAVES_CONSULTA = 5000;

const ROTULOS_MODULO: Record<string, string> = {
  usuarios: 'Usuários',
  contas: 'Contas',
  transacoes: 'Lançamentos',
  categorias: 'Categorias',
  cartoes: 'Cartões',
  faturas: 'Faturas',
  investimentos: 'Investimentos',
  orcamentos: 'Orçamento',
  metas: 'Metas',
  openfinance: 'Open Finance',
  notificacoes: 'Avisos',
  painel: 'Painel',
  busca: 'Busca',
  perfil: 'Perfil',
  configuracoes: 'Configurações',
  auth: 'Sessão',
};

// Ações: POST ou PUT cujo último segmento do caminho está aqui vira ALTERACAO com frase própria.
const ACOES = new Set([
  'sincronizar',
  'pagar',
  'reabrir',
  'saldo',
  'credenciais',
  'redefinir-senha',
  'trocar-senha',
]);

// Frases próprias: chave "modulo/acao" (caminho) ou só "acao" (válida para qualquer módulo).
const FRASES_ACAO: Record<string, string> = {
  'openfinance/sincronizar': 'Sincronizou os dados do Open Finance',
  'openfinance/credenciais': 'Alterou as credenciais do Open Finance',
  'faturas/pagar': 'Marcou uma fatura como paga',
  'faturas/reabrir': 'Reabriu uma fatura',
  'contas/saldo': 'Ajustou o saldo de uma conta',
  'redefinir-senha': 'Redefiniu a senha de um usuário',
  'trocar-senha': 'Trocou a própria senha',
};

// Cache de nomes: id -> nome, válido por 10 minutos.
const cacheNomes = new Map<number, { nome: string; ate: number }>();

// Anti-repetição de CONSULTA: "usuarioId caminho" -> instante da última gravação.
const ultimasConsultas = new Map<string, number>();

let limpezaIniciada = false;

async function nomeDoUsuario(id: number): Promise<string | null> {
  const agora = Date.now();
  const entrada = cacheNomes.get(id);
  if (entrada && entrada.ate > agora) {
    return entrada.nome;
  }
  try {
    const usuario = await prisma.usuario.findUnique({ where: { id }, select: { nome: true } });
    if (!usuario) {
      return null;
    }
    cacheNomes.set(id, { nome: usuario.nome, ate: agora + VALIDADE_NOME_MS });
    return usuario.nome;
  } catch {
    return null;
  }
}

async function gravar(dados: DadosLog): Promise<void> {
  let usuarioNome = dados.usuarioNome ?? null;
  if (!usuarioNome && dados.usuarioId != null) {
    usuarioNome = await nomeDoUsuario(dados.usuarioId);
  }
  await prisma.logAtividade.create({
    data: {
      usuarioId: dados.usuarioId ?? null,
      usuarioNome,
      perfil: dados.perfil ?? null,
      tipo: dados.tipo,
      modulo: dados.modulo,
      descricao: dados.descricao,
      metodo: dados.metodo ?? null,
      caminho: dados.caminho ?? null,
      status: dados.status ?? null,
      duracaoMs: dados.duracaoMs ?? null,
      ip: dados.ip ?? null,
      navegador: dados.navegador ?? null,
    },
  });
}

function limparConsultasVencidas(agora: number): void {
  for (const [chave, instante] of ultimasConsultas) {
    if (agora - instante >= JANELA_CONSULTA_MS) {
      ultimasConsultas.delete(chave);
    }
  }
}

// Nunca lança e não espera a gravação: a resposta da requisição não é atrasada.
export function registrarLog(dados: DadosLog): void {
  try {
    if (dados.tipo === 'CONSULTA' && dados.usuarioId != null) {
      const chave = dados.usuarioId + ' ' + (dados.caminho ?? '');
      const agora = Date.now();
      const ultima = ultimasConsultas.get(chave);
      if (ultima !== undefined && agora - ultima < JANELA_CONSULTA_MS) {
        return;
      }
      ultimasConsultas.set(chave, agora);
      if (ultimasConsultas.size > LIMITE_CHAVES_CONSULTA) {
        limparConsultasVencidas(agora);
      }
    }
    gravar(dados).catch((erro: unknown) => {
      console.error(
        'Falha ao gravar log de atividade:',
        erro instanceof Error ? erro.message : String(erro)
      );
    });
  } catch (erro) {
    console.error(
      'Falha ao registrar log de atividade:',
      erro instanceof Error ? erro.message : String(erro)
    );
  }
}

// Recebe o método e o caminho da API (ex.: "/api/pedidos/5/status", sem query string).
export function descreverRequisicao(
  metodo: string,
  caminho: string
): { tipo: TipoLog; modulo: string; descricao: string } {
  const segmentos = caminho.split('/').filter((s) => s.length > 0);
  if (segmentos[0] === 'api') {
    segmentos.shift();
  }
  const segmentoModulo = segmentos[0] ?? '';
  const ultimo = segmentos.length > 0 ? segmentos[segmentos.length - 1] : '';
  const modulo = ROTULOS_MODULO[segmentoModulo] ?? (segmentoModulo || 'Sistema');
  const metodoMaiusculo = metodo.toUpperCase();

  if ((metodoMaiusculo === 'POST' || metodoMaiusculo === 'PUT') && ACOES.has(ultimo)) {
    const frase =
      FRASES_ACAO[segmentoModulo + '/' + ultimo] ?? FRASES_ACAO[ultimo] ?? null;
    return {
      tipo: 'ALTERACAO',
      modulo,
      descricao: frase ?? `Realizou uma ação em ${modulo}`,
    };
  }

  switch (metodoMaiusculo) {
    case 'POST':
      return { tipo: 'CRIACAO', modulo, descricao: `Criou um registro em ${modulo}` };
    case 'PUT':
    case 'PATCH':
      return { tipo: 'ALTERACAO', modulo, descricao: `Alterou um registro em ${modulo}` };
    case 'DELETE':
      return { tipo: 'EXCLUSAO', modulo, descricao: `Excluiu um registro em ${modulo}` };
    default:
      return { tipo: 'CONSULTA', modulo, descricao: `Consultou ${modulo}` };
  }
}

async function apagarAntigos(): Promise<void> {
  const limite = new Date(Date.now() - DIAS_RETENCAO * MS_DIA);
  await prisma.logAtividade.deleteMany({ where: { criadoEm: { lt: limite } } });
}

// Apaga registros com mais de 90 dias ao subir e a cada 24 horas.
export function iniciarLimpezaDeLogs(): void {
  if (limpezaIniciada) {
    return;
  }
  limpezaIniciada = true;
  const executar = () => {
    apagarAntigos().catch((erro: unknown) => {
      console.error(
        'Falha ao limpar logs antigos:',
        erro instanceof Error ? erro.message : String(erro)
      );
    });
  };
  executar();
  const temporizador = setInterval(executar, MS_DIA);
  temporizador.unref();
}
