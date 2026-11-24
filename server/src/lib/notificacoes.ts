import webpush from 'web-push';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma, comPerfil } from './prisma';
import { chamarApiInterna } from './mcp';
import { lerConfiguracao, limparCacheConfiguracao } from './email';
import { cifrar, decifrar } from './cripto';
import { enderecoSeguro } from './acessoSeguro';
import { dataISO, hoje, intervaloDoMes, mesDe, moeda, num, paraData } from './financas';
import { PREFIXO_ACERTO, PREFIXO_PREVISTA } from './sincronizacao';
import { aoChegarNovidade } from './sinais';

// Notificações no celular (Web Push). Cada aparelho se inscreve pelo navegador (InscricaoPush); o servidor guarda
// um par de chaves VAPID e manda as mensagens pelo serviço de push do navegador (Google, Apple, Mozilla).
//
// Um verificador roda a cada 5 minutos (e logo depois de cada sincronização que trouxe dados novos) em cada perfil
// financeiro e gera as notificações dos tipos abaixo. Cada
// notificação tem uma chave estável gravada em NotificacaoEnviada: a mesma não sai duas vezes. A de segurança
// (novo acesso) sai na hora do login, direto para o usuário.

// ---------- Tipos ----------

export const TIPOS_NOTIFICACAO = [
  { id: 'movimentacao', rotulo: 'Movimentação nova', descricao: 'Lançamento novo vindo do banco (Open Finance) ou de arquivo importado.' },
  { id: 'vencimento', rotulo: 'Conta a pagar vencendo', descricao: 'Na véspera e no dia do vencimento.' },
  { id: 'fatura', rotulo: 'Fatura do cartão', descricao: 'Quando a fatura está para fechar e para vencer.' },
  { id: 'orcamento', rotulo: 'Orçamento', descricao: 'Categoria com 80% do orçamento do mês e quando estoura.' },
  { id: 'limite', rotulo: 'Limite do cartão', descricao: 'Quando o cartão usa 80% e 95% do limite.' },
  { id: 'meta', rotulo: 'Metas', descricao: 'Meta com 90% guardado e meta batida.' },
  { id: 'alerta', rotulo: 'Cobrança estranha', descricao: 'Cobrança repetida, valor fora do comum e outras suspeitas.' },
  { id: 'saldo', rotulo: 'Saldo negativo', descricao: 'Conta corrente, poupança ou carteira que ficou no vermelho.' },
  { id: 'provento', rotulo: 'Proventos', descricao: 'Dividendos, juros e rendimentos de FII recebidos.' },
  { id: 'imposto', rotulo: 'Impostos a vencer', descricao: 'IPVA, IPTU, DARF e IRPF três dias antes e na véspera.' },
  { id: 'conexao', rotulo: 'Conexão com o banco', descricao: 'Quando a ligação com um banco para de funcionar.' },
  { id: 'seguranca', rotulo: 'Segurança', descricao: 'Novo acesso à sua conta. Toca mesmo no horário de silêncio.' },
] as const;

export type TipoNotificacao = (typeof TIPOS_NOTIFICACAO)[number]['id'];
const IDS_TIPOS = new Set<string>(TIPOS_NOTIFICACAO.map((t) => t.id));

export interface Notificacao {
  tipo: TipoNotificacao;
  chave: string;
  titulo: string;
  corpo: string;
  url: string; // caminho dentro do site, aberto ao tocar
}

const DIA_MS = 24 * 60 * 60 * 1000;
const INTERVALO_MS = 5 * 60 * 1000;
const JANELA_NOVOS_MS = 24 * 60 * 60 * 1000; // lançamentos e proventos criados nas últimas 24 h
const MAXIMO_INDIVIDUAIS = 3; // acima disso, as movimentações novas saem num resumo só
const TEMPO_DE_VIDA_S = 24 * 60 * 60; // o serviço de push guarda a mensagem por até 1 dia (aparelho desligado)

// ---------- Chaves VAPID ----------

let vapidPronto: { publica: string; privada: string } | null = null;

// Identificação que vai junto com cada envio (campo "sub" do VAPID). A Apple recusa o envio (BadJwtToken) quando
// ela não é um endereço https de verdade ou um e-mail de domínio real: "algo@financas.local" não serve.
// Ordem: endereço do site nas Configurações, endereço seguro do Tailscale, e-mail do titular, e-mail neutro.
async function identificacaoVapid(enderecoSite: string | null): Promise<string> {
  if (enderecoSite && /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(:\d+)?\/?$/i.test(enderecoSite)) return enderecoSite;
  const seguro = await enderecoSeguro().catch(() => null);
  if (seguro) return seguro;
  const email = (process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
  if (/^[^@\s]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(email) && !/\.(local|localhost|lan|test|invalid)$/.test(email)) return `mailto:${email}`;
  return 'mailto:avisos@example.com';
}

// Lê (ou gera, no primeiro uso) o par de chaves VAPID e configura o web-push.
export async function chavesVapid(): Promise<{ publica: string }> {
  if (vapidPronto) {
    // As chaves não mudam; a identificação pode mudar (o endereço seguro passa a existir depois do login no Tailscale).
    const atual = await lerConfiguracao();
    webpush.setVapidDetails(await identificacaoVapid(atual.enderecoSite ?? null), vapidPronto.publica, vapidPronto.privada);
    return { publica: vapidPronto.publica };
  }
  const config = await lerConfiguracao();
  let publica = config.vapidPublica;
  let privada = config.vapidPrivadaCifrada ? decifrar(config.vapidPrivadaCifrada) : null;
  if (!publica || !privada) {
    // Sem chave (ou chave cifrada com outro JWT_SECRET): gera outra. Aparelhos antigos precisam se inscrever de novo.
    const novas = webpush.generateVAPIDKeys();
    publica = novas.publicKey;
    privada = novas.privateKey;
    await prisma.configuracaoPlataforma.update({
      where: { id: 1 },
      data: { vapidPublica: publica, vapidPrivadaCifrada: cifrar(privada) },
    });
    limparCacheConfiguracao();
  }
  webpush.setVapidDetails(await identificacaoVapid(config.enderecoSite ?? null), publica, privada);
  vapidPronto = { publica, privada };
  return { publica };
}

// ---------- Preferências ----------

export interface Preferencias {
  desligados: TipoNotificacao[];
  perfisLigados: number[]; // perfis financeiros habilitados por esta pessoa
  silencioAtivo: boolean;
  silencioInicio: number;
  silencioFim: number;
}

export async function lerPreferencias(usuarioId: number): Promise<Preferencias> {
  const linha = await prisma.preferenciaNotificacao.findUnique({ where: { usuarioId } });
  return {
    desligados: (linha?.desligados ?? '')
      .split(',')
      .filter((t): t is TipoNotificacao => IDS_TIPOS.has(t)),
    perfisLigados: (linha?.perfisLigados ?? '')
      .split(',')
      .map((t) => Number(t))
      .filter((n) => Number.isInteger(n) && n > 0),
    silencioAtivo: linha?.silencioAtivo ?? false,
    silencioInicio: linha?.silencioInicio ?? 22,
    silencioFim: linha?.silencioFim ?? 7,
  };
}

export async function salvarPreferencias(usuarioId: number, p: Preferencias): Promise<void> {
  const dados = {
    desligados: p.desligados.filter((t) => IDS_TIPOS.has(t)).join(','),
    perfisLigados: [...new Set(p.perfisLigados.filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b).join(','),
    silencioAtivo: p.silencioAtivo,
    silencioInicio: p.silencioInicio,
    silencioFim: p.silencioFim,
  };
  await prisma.preferenciaNotificacao.upsert({ where: { usuarioId }, create: { usuarioId, ...dados }, update: dados });
}

// Hora atual dentro do horário de silêncio (pelo relógio do servidor). Ex.: 22 a 7 atravessa a meia-noite.
function emSilencio(p: Preferencias, agora = new Date()): boolean {
  if (!p.silencioAtivo || p.silencioInicio === p.silencioFim) return false;
  const h = agora.getHours();
  return p.silencioInicio < p.silencioFim
    ? h >= p.silencioInicio && h < p.silencioFim
    : h >= p.silencioInicio || h < p.silencioFim;
}

// ---------- Envio ----------

export async function inscrever(
  usuarioId: number,
  dados: { endpoint: string; p256dh: string; auth: string; aparelho: string | null }
): Promise<void> {
  // O mesmo aparelho pode trocar de usuário (outra pessoa entrou nele): o endpoint passa para o novo dono.
  await prisma.inscricaoPush.upsert({
    where: { endpoint: dados.endpoint },
    create: { usuarioId, ...dados },
    update: { usuarioId, p256dh: dados.p256dh, auth: dados.auth, aparelho: dados.aparelho },
  });
}

export async function desinscrever(usuarioId: number, endpoint: string): Promise<void> {
  await prisma.inscricaoPush.deleteMany({ where: { usuarioId, endpoint } });
}

export interface FalhaDeEnvio {
  aparelho: string | null;
  status: number | null;
  motivo: string;
  servico: string;
}

// Nome do serviço de push pelo endereço da inscrição (só o nome: o endereço completo identifica o aparelho).
function servicoDePush(endpoint: string): string {
  try {
    const host = new URL(endpoint).hostname;
    if (host.endsWith('push.apple.com')) return 'Apple';
    if (host.endsWith('googleapis.com')) return 'Google';
    if (host.endsWith('mozilla.com')) return 'Mozilla';
    if (host.endsWith('windows.com')) return 'Microsoft';
    return 'outro';
  } catch {
    return 'outro';
  }
}

// Manda uma notificação a todos os aparelhos de um usuário, respeitando as preferências dele.
// Devolve quantos aparelhos receberam. `forcar` ignora o tipo desligado (usado no teste).
export async function enviarParaUsuario(
  usuarioId: number,
  n: Omit<Notificacao, 'chave'> & { chave?: string },
  forcar = false,
  falhas?: FalhaDeEnvio[],
  perfilId?: number
): Promise<number> {
  const inscricoes = await prisma.inscricaoPush.findMany({ where: { usuarioId } });
  if (inscricoes.length === 0) return 0;
  const pref = await lerPreferencias(usuarioId);
  // Aviso de um perfil financeiro só sai para quem habilitou esse perfil.
  if (perfilId !== undefined && !pref.perfisLigados.includes(perfilId)) return 0;
  if (!forcar && pref.desligados.includes(n.tipo)) return 0;
  await chavesVapid();
  const silenciosa = n.tipo !== 'seguranca' && emSilencio(pref);
  const carga = JSON.stringify({
    titulo: n.titulo,
    corpo: n.corpo,
    url: n.url,
    tag: n.chave ?? `${n.tipo}-${Date.now()}`,
    silenciosa,
  });
  let entregues = 0;
  for (const i of inscricoes) {
    try {
      await webpush.sendNotification(
        { endpoint: i.endpoint, keys: { p256dh: i.p256dh, auth: i.auth } },
        carga,
        { TTL: TEMPO_DE_VIDA_S, urgency: n.tipo === 'seguranca' ? 'high' : 'normal' }
      );
      entregues++;
      await prisma.inscricaoPush.update({ where: { id: i.id }, data: { usadoEm: new Date() } });
    } catch (erro) {
      const status = (erro as { statusCode?: number }).statusCode;
      // 404/410: o aparelho cancelou a inscrição (app desinstalado, permissão tirada). Sai da lista.
      if (status === 404 || status === 410) {
        await prisma.inscricaoPush.delete({ where: { id: i.id } }).catch(() => undefined);
      } else {
        console.error('Falha ao enviar notificação', status ?? '', erro instanceof Error ? erro.message : erro);
      }
      if (falhas) {
        const corpo = (erro as { body?: unknown }).body;
        falhas.push({
          aparelho: i.aparelho ?? null,
          status: typeof status === 'number' ? status : null,
          motivo: (typeof corpo === 'string' && corpo.trim() ? corpo : erro instanceof Error ? erro.message : 'erro desconhecido').slice(0, 200),
          servico: servicoDePush(i.endpoint),
        });
      }
    }
  }
  return entregues;
}

// Usuários que enxergam um perfil financeiro: titulares ativos e membros com acesso a ele.
async function destinatariosDoPerfil(perfilId: number): Promise<number[]> {
  const [titulares, membros] = await Promise.all([
    prisma.usuario.findMany({ where: { perfil: 'TITULAR', ativo: true }, select: { id: true } }),
    prisma.acessoPerfil.findMany({
      where: { perfilFinanceiroId: perfilId, usuario: { ativo: true } },
      select: { usuarioId: true },
    }),
  ]);
  return [...new Set([...titulares.map((u) => u.id), ...membros.map((m) => m.usuarioId)])];
}

// Grava a chave (se já existia, não manda de novo) e envia aos usuários do perfil.
async function notificarPerfil(perfilId: number, nomePerfil: string | null, n: Notificacao): Promise<void> {
  try {
    await prisma.notificacaoEnviada.create({ data: { perfilId, chave: n.chave } });
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') return;
    throw erro;
  }
  // Com mais de um perfil, o título diz de qual é.
  const titulo = nomePerfil ? `${n.titulo} · ${nomePerfil}` : n.titulo;
  const url = `${n.url}${n.url.includes('?') ? '&' : '?'}perfil=${perfilId}`;
  for (const usuarioId of await destinatariosDoPerfil(perfilId)) {
    await enviarParaUsuario(usuarioId, { ...n, titulo, url }, false, undefined, perfilId);
  }
}

// Esquece chaves para a notificação poder sair de novo quando a situação voltar (ex.: saldo negativo de novo).
async function esquecerChaves(perfilId: number, prefixo: string, manter: Set<string>): Promise<void> {
  const linhas = await prisma.notificacaoEnviada.findMany({
    where: { perfilId, chave: { startsWith: prefixo } },
    select: { id: true, chave: true },
  });
  const apagar = linhas.filter((l) => !manter.has(l.chave)).map((l) => l.id);
  if (apagar.length > 0) await prisma.notificacaoEnviada.deleteMany({ where: { id: { in: apagar } } });
}

// ---------- Novo acesso (segurança) ----------

// "Chrome no Android", "Safari no iPhone"... a partir do user-agent.
function resumirNavegador(ua: string | null): string | null {
  if (!ua) return null;
  const nav = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : null;
  const so = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : null;
  if (nav && so) return `${nav} no ${so}`;
  return nav ?? so;
}

// Chamado depois de um login com sucesso. Não espera o envio (o login não pode atrasar).
export function avisarNovoAcesso(usuarioId: number, userAgent: string | null): void {
  const navegador = resumirNavegador(userAgent);
  const quando = new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  void enviarParaUsuario(usuarioId, {
    tipo: 'seguranca',
    titulo: 'Novo acesso à sua conta',
    corpo: `Entrada em ${quando}${navegador ? ` pelo ${navegador}` : ''}. Se não foi você, troque a senha.`,
    url: '/app/perfil',
  }).catch(() => undefined);
}

// ---------- Verificador ----------

function diasEntre(inicio: Date, fim: Date): number {
  return Math.round((fim.getTime() - inicio.getTime()) / DIA_MS);
}

function quandoVence(dias: number): string {
  return dias <= 0 ? 'vence hoje' : dias === 1 ? 'vence amanhã' : `vence em ${dias} dias`;
}

function vencimentoNoMes(mes: string, diaDoMes: number): Date {
  const [ano, m] = mes.split('-').map(Number);
  const ultimo = new Date(Date.UTC(ano, m, 0)).getUTCDate();
  return paraData(`${mes}-${String(Math.min(diaDoMes, ultimo)).padStart(2, '0')}`);
}

function mesSeguinte(mes: string): string {
  const [ano, m] = mes.split('-').map(Number);
  return m === 12 ? `${ano + 1}-01` : `${ano}-${String(m + 1).padStart(2, '0')}`;
}

const RESPOSTA_ALERTAS = z.object({
  alertas: z.array(
    z.object({
      tipo: z.string(),
      gravidade: z.string(),
      titulo: z.string(),
      texto: z.string(),
      lancamentos: z.array(z.object({ id: z.number() })),
    })
  ),
});

const RESPOSTA_METAS = z.array(
  z.object({ id: z.number(), nome: z.string(), valorAlvo: z.number(), valorAtual: z.number() })
);

const RESPOSTA_IMPOSTOS = z.object({
  vencimentos: z.array(
    z.object({ data: z.string(), titulo: z.string(), valor: z.number().nullable(), diasFaltando: z.number() })
  ),
});

// Consulta interna que pode falhar sem derrubar as outras verificações.
async function consultar<T>(perfilId: number, caminho: string, esquema: z.ZodType<T>): Promise<T | null> {
  try {
    return esquema.parse(await chamarApiInterna(perfilId, 'GET', caminho));
  } catch {
    return null;
  }
}

interface Movimentacao {
  id: number;
  contaId: number;
  data: Date;
  valor: Prisma.Decimal;
  tipo: string;
  pendente: boolean;
  transferencia: boolean;
  criadoEm: Date;
  pluggyTransactionId: string | null;
  chaveImportacao: string | null;
  conta: { tipo: string };
}

// Chave estável da notificação de uma movimentação: o id do banco (Open Finance) ou a chave da importação.
function chaveDaMovimentacao(t: Movimentacao): string {
  if (t.pluggyTransactionId) return `mov-of-${t.pluggyTransactionId}`;
  if (t.chaveImportacao) return `mov-imp-${t.chaveImportacao}`;
  return `mov-${t.id}`;
}

// "Compra" e "Reembolso" no cartão; "Saída" e "Entrada" nas contas.
function rotuloDaMovimentacao(t: Movimentacao): string {
  if (t.conta.tipo === 'CARTAO' && !t.transferencia) return t.tipo === 'DESPESA' ? 'Compra' : 'Reembolso';
  return t.tipo === 'DESPESA' ? 'Saída' : 'Entrada';
}

// Compra que o banco mandou primeiro como pendente e depois de novo com outro id (pendente repetida ou já lançada):
// se a versão pendente, de mesmo valor e na mesma conta, já foi avisada nos últimos dias, esta não avisa de novo.
async function jaAvisadaComoPendente(perfilId: number, t: Movimentacao): Promise<boolean> {
  const irmas = await prisma.transacao.findMany({
    where: {
      id: { not: t.id },
      contaId: t.contaId,
      tipo: t.tipo as 'DESPESA' | 'RECEITA',
      valor: t.valor,
      pendente: true,
      criadoEm: { lt: t.criadoEm },
      data: { gte: new Date(t.data.getTime() - 3 * DIA_MS), lte: new Date(t.data.getTime() + 3 * DIA_MS) },
    },
    select: { id: true, contaId: true, data: true, valor: true, tipo: true, pendente: true, transferencia: true, criadoEm: true, pluggyTransactionId: true, chaveImportacao: true, conta: { select: { tipo: true } } },
    take: 10,
  });
  if (irmas.length === 0) return false;
  const avisadas = await prisma.notificacaoEnviada.count({
    where: { perfilId, chave: { in: irmas.flatMap((i) => [chaveDaMovimentacao(i), `mov-${i.id}`]) } },
  });
  return avisadas > 0;
}

// Tudo o que merece notificação agora no perfil (dentro de comPerfil). As chaves repetidas são descartadas depois.
async function coletar(perfilId: number): Promise<Notificacao[]> {
  const lista: Notificacao[] = [];
  const hojeData = hoje();
  const mes = mesDe(hojeData);
  const desde = new Date(Date.now() - JANELA_NOVOS_MS);

  // 1. Movimentações novas (Open Finance, bancos diretos e importação). Manual não: foi a própria pessoa que lançou.
  // Parcelas previstas e acertos de fatura ficam de fora: o sistema os recria a cada sincronização (com id novo)
  // e não são movimentações que o banco mandou.
  const novas = await prisma.transacao.findMany({
    where: {
      criadoEm: { gte: desde },
      oculto: false,
      provento: false,
      AND: [
        { OR: [{ origem: 'OPEN_FINANCE' }, { importacaoId: { not: null } }, { chaveImportacao: { startsWith: 'api:' } }] },
        {
          OR: [
            { pluggyTransactionId: null },
            { NOT: [{ pluggyTransactionId: { startsWith: PREFIXO_PREVISTA } }, { pluggyTransactionId: { startsWith: PREFIXO_ACERTO } }] },
          ],
        },
      ],
    },
    include: { conta: { select: { nome: true, tipo: true } } },
    orderBy: { id: 'asc' },
    take: 200,
  });
  // A chave usa o id do banco (estável), não o id da linha: lançamento apagado e gravado de novo não avisa outra vez.
  // A chave antiga (mov-<id da linha>) continua valendo para o que já foi avisado antes desta mudança.
  const jaVistas = new Set(
    (
      await prisma.notificacaoEnviada.findMany({
        where: { perfilId, chave: { in: novas.flatMap((t) => [chaveDaMovimentacao(t), `mov-${t.id}`]) } },
        select: { chave: true },
      })
    ).map((l) => l.chave)
  );
  const candidatas = novas.filter((t) => !jaVistas.has(chaveDaMovimentacao(t)) && !jaVistas.has(`mov-${t.id}`));
  const ineditas: typeof candidatas = [];
  for (const t of candidatas) {
    if (await jaAvisadaComoPendente(perfilId, t)) {
      await prisma.notificacaoEnviada.create({ data: { perfilId, chave: chaveDaMovimentacao(t) } }).catch(() => undefined);
    } else {
      ineditas.push(t);
    }
  }
  if (ineditas.length > MAXIMO_INDIVIDUAIS) {
    // Resumo: as chaves individuais são gravadas para não saírem depois uma a uma.
    for (const t of ineditas) {
      await prisma.notificacaoEnviada.create({ data: { perfilId, chave: chaveDaMovimentacao(t) } }).catch(() => undefined);
    }
    const despesas = ineditas.filter((t) => t.tipo === 'DESPESA').reduce((s, t) => s + num(t.valor), 0);
    const receitas = ineditas.filter((t) => t.tipo === 'RECEITA').reduce((s, t) => s + num(t.valor), 0);
    lista.push({
      tipo: 'movimentacao',
      chave: `mov-lote-${ineditas[ineditas.length - 1].id}`,
      titulo: `${ineditas.length} movimentações novas`,
      corpo: [despesas > 0 ? `Saídas: ${moeda(despesas)}` : '', receitas > 0 ? `Entradas: ${moeda(receitas)}` : '']
        .filter(Boolean)
        .join(' · '),
      url: '/app/transacoes',
    });
  } else {
    for (const t of ineditas) {
      lista.push({
        tipo: 'movimentacao',
        chave: chaveDaMovimentacao(t),
        titulo: `${rotuloDaMovimentacao(t)} de ${moeda(num(t.valor))}`,
        corpo: `${t.descricao} · ${t.conta.nome}`,
        url: '/app/transacoes',
      });
    }
  }

  // 2. Contas a pagar (contas fixas) na véspera e no dia.
  const fixas = await prisma.contaFixa.findMany({ where: { ativa: true, tipo: 'DESPESA' } });
  if (fixas.length > 0) {
    const proximo = mesSeguinte(mes);
    const pagas = new Set(
      (await prisma.pagamentoContaFixa.findMany({ where: { mes: { in: [mes, proximo] } }, select: { contaFixaId: true, mes: true } })).map(
        (p) => `${p.contaFixaId}|${p.mes}`
      )
    );
    for (const c of fixas) for (const alvo of [mes, proximo]) {
      if (pagas.has(`${c.id}|${alvo}`)) continue;
      const venc = vencimentoNoMes(alvo, c.diaDoMes);
      const dias = diasEntre(hojeData, venc);
      if (dias < 0 || dias > 1) continue;
      lista.push({
        tipo: 'vencimento',
        chave: `venc-${c.id}-${dataISO(venc)}-${dias}`,
        titulo: `${c.descricao} ${quandoVence(dias)}`,
        corpo: `${moeda(num(c.valor))}. Toque para marcar como paga.`,
        url: '/app/agenda',
      });
    }
  }

  // 3. Faturas: fechando (véspera e dia) e vencendo (2 dias antes, véspera e dia).
  const faturas = await prisma.fatura.findMany({
    where: { status: { not: 'PAGA' } },
    include: { conta: { select: { nome: true } } },
  });
  for (const f of faturas) {
    if (f.status === 'ABERTA' && f.fechamento) {
      const dias = diasEntre(hojeData, f.fechamento);
      if (dias >= 0 && dias <= 1) {
        lista.push({
          tipo: 'fatura',
          chave: `fatura-fecha-${f.id}-${dias}`,
          titulo: `Fatura de ${f.conta.nome} ${dias === 0 ? 'fecha hoje' : 'fecha amanhã'}`,
          corpo: `Até agora: ${moeda(num(f.total))}. Compras depois disso vão para a próxima.`,
          url: '/app/cartoes',
        });
      }
    }
    const total = num(f.total);
    const dias = diasEntre(hojeData, f.vencimento);
    if (total > 0 && dias >= 0 && dias <= 2) {
      lista.push({
        tipo: 'fatura',
        chave: `fatura-vence-${f.id}-${dias}`,
        titulo: `Fatura de ${f.conta.nome} ${quandoVence(dias)}`,
        corpo: `${moeda(total)}${f.minimo ? ` (mínimo ${moeda(num(f.minimo))})` : ''}.`,
        url: '/app/cartoes',
      });
    }
  }

  // 4. Orçamento do mês: 80% e estourado.
  const { inicio, fim } = intervaloDoMes(mes);
  const [gastos, orcamentos] = await Promise.all([
    prisma.transacao.groupBy({
      by: ['categoriaId'],
      where: { tipo: 'DESPESA', transferencia: false, data: { gte: inicio, lt: fim } },
      _sum: { valor: true },
    }),
    prisma.orcamento.findMany({ include: { categoria: { select: { nome: true } } } }),
  ]);
  const gastoPor = new Map<number, number>();
  for (const g of gastos) if (g.categoriaId !== null) gastoPor.set(g.categoriaId, num(g._sum.valor));
  for (const o of orcamentos) {
    const limite = num(o.limite);
    const gasto = gastoPor.get(o.categoriaId) ?? 0;
    if (limite <= 0) continue;
    const fracao = gasto / limite;
    if (fracao >= 1) {
      lista.push({
        tipo: 'orcamento',
        chave: `orc-${o.categoriaId}-${mes}-100`,
        titulo: `Orçamento de ${o.categoria.nome} estourou`,
        corpo: `${moeda(gasto)} de ${moeda(limite)} (${Math.round(fracao * 100)}%).`,
        url: '/app/orcamento',
      });
    } else if (fracao >= 0.8) {
      lista.push({
        tipo: 'orcamento',
        chave: `orc-${o.categoriaId}-${mes}-80`,
        titulo: `${o.categoria.nome}: ${Math.round(fracao * 100)}% do orçamento`,
        corpo: `Restam ${moeda(limite - gasto)} até o fim do mês.`,
        url: '/app/orcamento',
      });
    }
  }

  // 5. Limite do cartão (80% e 95% usados), uma vez por mês em cada faixa.
  const cartoes = await prisma.conta.findMany({ where: { tipo: 'CARTAO', ativo: true, limite: { not: null }, limiteDisponivel: { not: null } } });
  for (const c of cartoes) {
    const limite = num(c.limite);
    if (limite <= 0) continue;
    const usado = 1 - num(c.limiteDisponivel) / limite;
    const faixa = usado >= 0.95 ? 95 : usado >= 0.8 ? 80 : null;
    if (faixa === null) continue;
    lista.push({
      tipo: 'limite',
      chave: `limite-${c.id}-${mes}-${faixa}`,
      titulo: `${c.nome}: ${Math.round(usado * 100)}% do limite usado`,
      corpo: `Disponível: ${moeda(num(c.limiteDisponivel))} de ${moeda(limite)}.`,
      url: '/app/cartoes',
    });
  }

  // 6. Metas: 90% e batida.
  const metas = await consultar(perfilId, '/metas', RESPOSTA_METAS);
  for (const m of metas ?? []) {
    if (m.valorAlvo <= 0) continue;
    const fracao = m.valorAtual / m.valorAlvo;
    if (fracao >= 1) {
      lista.push({ tipo: 'meta', chave: `meta-${m.id}-100`, titulo: `Meta batida: ${m.nome}! 🎉`, corpo: `Você juntou ${moeda(m.valorAtual)}.`, url: '/app/metas' });
    } else if (fracao >= 0.9) {
      lista.push({
        tipo: 'meta',
        chave: `meta-${m.id}-90`,
        titulo: `Falta pouco para ${m.nome}`,
        corpo: `${Math.round(fracao * 100)}% guardado. Faltam ${moeda(m.valorAlvo - m.valorAtual)}.`,
        url: '/app/metas',
      });
    }
  }

  // 7. Cobranças estranhas (média e alta gravidade).
  const alertas = await consultar(perfilId, '/alertas', RESPOSTA_ALERTAS);
  for (const a of alertas?.alertas ?? []) {
    if (a.gravidade === 'baixa') continue;
    const ids = a.lancamentos.map((l) => l.id).sort((x, y) => x - y).join('-');
    lista.push({ tipo: 'alerta', chave: `alerta-${a.tipo}-${ids}`, titulo: a.titulo, corpo: a.texto, url: '/app/alertas' });
  }

  // 8. Saldo negativo. Quando a conta volta ao azul, a chave é esquecida (avisa de novo se ficar negativa outra vez).
  const contas = await prisma.conta.findMany({ where: { ativo: true, tipo: { in: ['CORRENTE', 'POUPANCA', 'CARTEIRA'] } } });
  const negativas = new Set<string>();
  for (const c of contas) {
    const saldo = num(c.saldo);
    if (saldo >= 0) continue;
    const chave = `saldo-neg-${c.id}`;
    negativas.add(chave);
    lista.push({ tipo: 'saldo', chave, titulo: `${c.nome} ficou negativa`, corpo: `Saldo: ${moeda(saldo)}.`, url: '/app/contas' });
  }
  await esquecerChaves(perfilId, 'saldo-neg-', negativas);

  // 9. Proventos recebidos (movimentos de rendimento e créditos marcados como provento).
  const [rendimentos, creditos] = await Promise.all([
    prisma.movimentoInvestimento.findMany({
      where: { tipo: 'RENDIMENTO', criadoEm: { gte: desde }, data: { gte: new Date(hojeData.getTime() - 7 * DIA_MS) } },
      include: { investimento: { select: { nome: true } } },
      take: 50,
    }),
    prisma.transacao.findMany({ where: { provento: true, criadoEm: { gte: desde } }, take: 50 }),
  ]);
  for (const r of rendimentos) {
    lista.push({
      tipo: 'provento',
      chave: `prov-mov-${r.id}`,
      titulo: `Provento recebido: ${moeda(num(r.valor))}`,
      corpo: r.investimento.nome,
      url: '/app/carteira',
    });
  }
  for (const t of creditos) {
    lista.push({ tipo: 'provento', chave: `prov-tr-${t.id}`, titulo: `Provento recebido: ${moeda(num(t.valor))}`, corpo: t.descricao, url: '/app/carteira' });
  }

  // 10. Impostos a vencer: 3 dias antes e na véspera (ou no dia).
  const impostos = await consultar(perfilId, '/impostos/vencimentos?dias=3', RESPOSTA_IMPOSTOS);
  for (const v of impostos?.vencimentos ?? []) {
    const faixa = v.diasFaltando <= 1 ? 1 : v.diasFaltando <= 3 ? 3 : null;
    if (faixa === null || v.diasFaltando < 0) continue;
    lista.push({
      tipo: 'imposto',
      chave: `imp-${v.data}-${v.titulo}-${faixa}`,
      titulo: `${v.titulo} ${quandoVence(v.diasFaltando)}`,
      corpo: v.valor !== null ? `Valor estimado: ${moeda(v.valor)}.` : 'Confira o valor na área Impostos.',
      url: '/app/impostos',
    });
  }

  // 11. Conexões com erro (Open Finance e bancos diretos). Voltou a funcionar: a chave é esquecida.
  const [conexoes, diretas] = await Promise.all([
    prisma.conexaoBancaria.findMany({ select: { id: true, instituicao: true, status: true } }),
    prisma.conexaoDireta.findMany({ select: { id: true, apelido: true, status: true } }),
  ]);
  const comErro = new Set<string>();
  for (const c of [
    ...conexoes.map((c) => ({ chave: `conexao-of-${c.id}-${c.status}`, nome: c.instituicao, status: c.status })),
    ...diretas.map((c) => ({ chave: `conexao-dir-${c.id}-${c.status}`, nome: c.apelido, status: c.status })),
  ]) {
    if (c.status !== 'ERRO' && c.status !== 'ERRO_LOGIN') continue;
    comErro.add(c.chave);
    lista.push({
      tipo: 'conexao',
      chave: c.chave,
      titulo: c.status === 'ERRO_LOGIN' ? `Reconecte ${c.nome}` : `Falha ao atualizar ${c.nome}`,
      corpo: c.status === 'ERRO_LOGIN' ? 'O banco pediu para autorizar de novo. Sem isso, os lançamentos param de chegar.' : 'Os dados deste banco não estão sendo atualizados.',
      url: '/app/central/dados',
    });
  }
  await esquecerChaves(perfilId, 'conexao-', comErro);

  return lista;
}

let primeiraRodada = true;

// Uma rodada do verificador em todos os perfis.
export async function verificarTudo(): Promise<void> {
  const perfis = await prisma.perfilFinanceiro.findMany({ select: { id: true, nome: true } });
  const comNome = perfis.length > 1;
  // Na primeira vez (banco sem nenhuma chave), só grava o que já existe: quem liga as notificações não recebe
  // uma enxurrada do passado.
  const silenciosa = primeiraRodada && (await prisma.notificacaoEnviada.count()) === 0;
  primeiraRodada = false;
  for (const p of perfis) {
    try {
      await comPerfil(p.id, async () => {
        const lista = await coletar(p.id);
        for (const n of lista) {
          if (silenciosa) {
            await prisma.notificacaoEnviada.create({ data: { perfilId: p.id, chave: n.chave } }).catch(() => undefined);
          } else {
            await notificarPerfil(p.id, comNome ? p.nome : null, n);
          }
        }
      });
    } catch (erro) {
      console.error('Falha nas notificações do perfil', p.id, erro instanceof Error ? erro.message : erro);
    }
  }
  // Limpeza: chaves com mais de 120 dias (as de mês e de data já não voltam a valer).
  await prisma.notificacaoEnviada.deleteMany({ where: { enviadaEm: { lt: new Date(Date.now() - 120 * DIA_MS) } } }).catch(() => undefined);
}

let iniciado = false;
let rodando = false;
let repetir = false;
let agendado: NodeJS.Timeout | null = null;

const ESPERA_NOVIDADE_MS = 3 * 1000; // junta avisos seguidos (várias conexões sincronizando) numa rodada só

// Chamado uma vez ao carregar o módulo de notificações.
export function iniciarVerificador(): void {
  if (iniciado) return;
  iniciado = true;
  const rodar = () => {
    if (rodando) {
      // Chegou novidade no meio de uma rodada: roda de novo quando ela acabar, para nada ficar esperando 5 minutos.
      repetir = true;
      return;
    }
    rodando = true;
    void verificarTudo()
      .catch((e) => console.error('Falha no verificador de notificações', e instanceof Error ? e.message : e))
      .finally(() => {
        rodando = false;
        if (repetir) {
          repetir = false;
          rodar();
        }
      });
  };
  // Primeira rodada um minuto depois de subir (o banco e as rotas internas já estão prontos).
  setTimeout(rodar, 60 * 1000).unref();
  setInterval(rodar, INTERVALO_MS).unref();
  // Sincronização que gravou dados novos: avisa logo, sem esperar a rodada de 5 minutos.
  aoChegarNovidade(() => {
    if (agendado) return;
    agendado = setTimeout(() => {
      agendado = null;
      rodar();
    }, ESPERA_NOVIDADE_MS);
    agendado.unref();
  });
}
