import { z } from 'zod';
import { prisma, comPerfil } from './prisma';
import { chamarApiInterna } from './mcp';
import { enviarEmailAgora, limparCacheConfiguracao, lerConfiguracao } from './email';
import { cifrar, decifrar } from './cripto';
import { dataISO, hoje, intervaloDoMes, mesDe, moeda, num, paraData } from './financas';

// Avisos por e-mail e Telegram. Roda uma vez por dia às 8h (relógio do servidor) para cada perfil financeiro,
// e também pelo botão "Enviar agora". Cada aviso tem uma chave estável gravada em AvisoEnviado: o mesmo aviso
// não sai duas vezes.

const DIA_MS = 24 * 60 * 60 * 1000;
const JANELA_DIAS = 3; // faturas e contas fixas vencendo em até 3 dias
const LIMITE_ORCAMENTO = 0.9; // categoria com mais de 90% do orçamento do mês
const HORA_DO_ENVIO = 8;
const TEMPO_LIMITE_TELEGRAM_MS = 15_000;
const TAMANHO_MAX_ERRO = 300;

export type SituacaoCanal = 'ENVIADO' | 'FALHOU' | 'NAO_CONFIGURADO' | 'DESLIGADO' | 'SEM_NOVIDADE';

export interface ResultadoCanal {
  situacao: SituacaoCanal;
  erro: string | null;
}

export interface ResultadoEnvio {
  enviados: number;
  canais: { email: ResultadoCanal; telegram: ResultadoCanal };
}

export interface ConfigAvisos {
  ativos: boolean;
  email: string | null;
  telegramConfigurado: boolean;
  telegramChatId: string | null;
}

interface AvisoPendente {
  chave: string;
  linha: string;
}

const SEM_CANAL: ResultadoCanal = { situacao: 'DESLIGADO', erro: null };

// ---------- Configuração ----------

// Configuração de avisos gravada em ConfiguracaoPlataforma (avisosAtivos, avisosEmail, telegramTokenCifrado, telegramChatId).
export async function lerConfigAvisos(): Promise<ConfigAvisos> {
  const configuracao = await lerConfiguracao();
  return {
    ativos: configuracao.avisosAtivos,
    email: configuracao.avisosEmail,
    telegramConfigurado: configuracao.telegramTokenCifrado !== null,
    telegramChatId: configuracao.telegramChatId,
  };
}

// Token do bot decifrado, só para uso interno (nunca sai pela API). Null se não há token ou se não decifra.
async function lerTokenTelegram(): Promise<string | null> {
  const configuracao = await lerConfiguracao();
  if (!configuracao.telegramTokenCifrado) return null;
  return decifrar(configuracao.telegramTokenCifrado);
}

export async function smtpConfigurado(): Promise<boolean> {
  const configuracao = await lerConfiguracao();
  return Boolean(configuracao.smtpServidor);
}

// ---------- Mensagens ----------

function limparErro(erro: unknown, segredos: string[]): string {
  let texto = erro instanceof Error ? erro.message : String(erro);
  for (const segredo of segredos) {
    if (segredo) texto = texto.split(segredo).join('***');
  }
  texto = texto.trim() || 'Falha ao enviar';
  return texto.slice(0, TAMANHO_MAX_ERRO);
}

function diasEntre(inicio: Date, fim: Date): number {
  return Math.round((fim.getTime() - inicio.getTime()) / DIA_MS);
}

// Dia de vencimento de uma conta fixa em um mês (em mês curto vale o último dia).
function vencimentoDaContaFixa(mes: string, diaDoMes: number): Date {
  const [ano, m] = mes.split('-').map(Number);
  const ultimoDia = new Date(Date.UTC(ano, m, 0)).getUTCDate();
  const dia = Math.min(diaDoMes, ultimoDia);
  return paraData(`${mes}-${String(dia).padStart(2, '0')}`);
}

// Avisos novos (ainda não enviados) do perfil atual. Precisa estar dentro de comPerfil.
async function coletarNovidades(perfilId: number, hojeData: Date): Promise<AvisoPendente[]> {
  const avisos: AvisoPendente[] = [];
  const mes = mesDe(hojeData);
  const limite = new Date(hojeData.getTime() + JANELA_DIAS * DIA_MS);

  // Faturas não pagas: vencendo em até 3 dias ou atrasadas.
  const faturas = await prisma.fatura.findMany({
    where: { status: { not: 'PAGA' }, vencimento: { lte: limite } },
    include: { conta: { select: { nome: true } } },
  });
  for (const f of faturas) {
    const total = num(f.total);
    if (total <= 0) continue;
    const dias = diasEntre(hojeData, f.vencimento);
    const quando = dias < 0 ? 'está atrasada' : dias === 0 ? 'vence hoje' : `vence em ${dias} dia(s)`;
    avisos.push({
      chave: `fatura-${f.id}-${dataISO(f.vencimento)}`,
      linha: `Fatura de ${f.conta.nome}: ${moeda(total)}, ${quando}.`,
    });
  }

  // Contas fixas a pagar que vencem em até 3 dias e ainda não foram marcadas como pagas no mês.
  const fixas = await prisma.contaFixa.findMany({ where: { ativa: true, tipo: 'DESPESA' } });
  const [anoMes, numMes] = mes.split('-').map(Number);
  const proximoMes = numMes === 12 ? `${anoMes + 1}-01` : `${anoMes}-${String(numMes + 1).padStart(2, '0')}`;
  if (fixas.length > 0) {
    const pagas = new Set(
      (
        await prisma.pagamentoContaFixa.findMany({
          where: { mes: { in: [mes, proximoMes] } },
          select: { contaFixaId: true, mes: true },
        })
      ).map((p) => `${p.contaFixaId}|${p.mes}`)
    );
    // Olha o mês atual e o seguinte: no fim do mês, a conta que vence no dia 1 ou 2 também entra.
    for (const c of fixas) for (const mesAlvo of [mes, proximoMes]) {
      if (pagas.has(`${c.id}|${mesAlvo}`)) continue;
      const vencimento = vencimentoDaContaFixa(mesAlvo, c.diaDoMes);
      const dias = diasEntre(hojeData, vencimento);
      if (dias < 0 || dias > JANELA_DIAS) continue;
      const quando = dias === 0 ? 'vence hoje' : `vence em ${dias} dia(s)`;
      avisos.push({
        chave: `conta-fixa-${c.id}-${dataISO(vencimento)}`,
        linha: `Conta a pagar ${c.descricao}: ${moeda(num(c.valor))}, ${quando}.`,
      });
    }
  }

  // Orçamento do mês: categorias acima de 90% do limite.
  const { inicio, fim } = intervaloDoMes(mes);
  const [gastos, orcamentos] = await Promise.all([
    prisma.transacao.groupBy({
      by: ['categoriaId'],
      where: { tipo: 'DESPESA', transferencia: false, data: { gte: inicio, lt: fim } },
      _sum: { valor: true },
    }),
    prisma.orcamento.findMany({ include: { categoria: { select: { nome: true } } } }),
  ]);
  const gastoPorCategoria = new Map<number, number>();
  for (const g of gastos) {
    if (g.categoriaId !== null) gastoPorCategoria.set(g.categoriaId, num(g._sum.valor));
  }
  for (const o of orcamentos) {
    const limiteOrcamento = num(o.limite);
    const gasto = gastoPorCategoria.get(o.categoriaId) ?? 0;
    if (limiteOrcamento <= 0 || gasto <= limiteOrcamento * LIMITE_ORCAMENTO) continue;
    const percentual = Math.round((gasto / limiteOrcamento) * 100);
    avisos.push({
      chave: `orcamento-${o.categoriaId}-${mes}`,
      linha: `Orçamento de ${o.categoria.nome} em ${percentual}% (${moeda(gasto)} de ${moeda(limiteOrcamento)}).`,
    });
  }

  // Alertas de gravidade alta de GET /alertas (cobranças estranhas).
  // Se a consulta falhar, os outros avisos saem do mesmo jeito.
  let alertas: z.infer<typeof RESPOSTA_ALERTAS>['alertas'] = [];
  try {
    const resposta = (await chamarApiInterna(perfilId, 'GET', '/alertas')) as unknown;
    alertas = RESPOSTA_ALERTAS.parse(resposta).alertas;
  } catch {
    alertas = [];
  }
  for (const a of alertas) {
    if (a.gravidade !== 'alta') continue;
    const ids = a.lancamentos.map((l) => l.id).sort((x, y) => x - y).join('-');
    avisos.push({ chave: `alerta-${a.tipo}-${ids}`, linha: `${a.titulo}: ${a.texto}` });
  }

  if (avisos.length === 0) return [];
  const jaEnviados = new Set(
    (
      await prisma.avisoEnviado.findMany({
        where: { chave: { in: avisos.map((a) => a.chave) } },
        select: { chave: true },
      })
    ).map((a) => a.chave)
  );
  return avisos.filter((a) => !jaEnviados.has(a.chave));
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

// ---------- Canais ----------

async function canalEmail(destino: string | null, titulo: string, paragrafos: string[]): Promise<ResultadoCanal> {
  if (!destino) return { situacao: 'NAO_CONFIGURADO', erro: 'Informe o e-mail de destino.' };
  if (!(await smtpConfigurado())) {
    return { situacao: 'NAO_CONFIGURADO', erro: 'E-mail indisponível: o servidor de e-mail (SMTP) não está configurado.' };
  }
  try {
    // Usa o envio que já existe em lib/email.ts. O tipo 'TESTE' é provisório (ver desvio no relatório do h05).
    await enviarEmailAgora({ para: destino, assunto: titulo, titulo, paragrafos, tipo: 'TESTE' });
    return { situacao: 'ENVIADO', erro: null };
  } catch (erro) {
    return { situacao: 'FALHOU', erro: limparErro(erro, []) };
  }
}

async function canalTelegram(texto: string): Promise<ResultadoCanal> {
  const configuracao = await lerConfigAvisos();
  const token = await lerTokenTelegram();
  const chatId = configuracao.telegramChatId;
  if (!token || !chatId) {
    return { situacao: 'NAO_CONFIGURADO', erro: 'Telegram não configurado (falta o token do bot ou o chat id).' };
  }
  try {
    const resposta = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: texto }),
      signal: AbortSignal.timeout(TEMPO_LIMITE_TELEGRAM_MS),
    });
    const dados = (await resposta.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
    if (!resposta.ok || !dados?.ok) {
      return { situacao: 'FALHOU', erro: limparErro(dados?.description ?? `Telegram recusou (${resposta.status}).`, [token]) };
    }
    return { situacao: 'ENVIADO', erro: null };
  } catch (erro) {
    return { situacao: 'FALHOU', erro: limparErro(erro, [token]) };
  }
}

// ---------- Envio ----------

async function nomeDoPerfil(perfilId: number): Promise<string> {
  const perfil = await prisma.perfilFinanceiro.findUnique({ where: { id: perfilId }, select: { nome: true } });
  return perfil?.nome ?? 'Finanças Pessoais';
}

// Envia uma mensagem só por canal. Falha de um canal não impede o outro.
async function enviarPelosCanais(
  config: ConfigAvisos,
  titulo: string,
  linhas: string[]
): Promise<{ email: ResultadoCanal; telegram: ResultadoCanal }> {
  const texto = [titulo, ...linhas].join('\n');
  const email = await canalEmail(config.email, titulo, linhas);
  const telegram = await canalTelegram(texto);
  return { email, telegram };
}

// Roda o aviso do dia para um perfil: só envia o que é novo. Registra em AvisoEnviado o que saiu por algum canal.
export function enviarAvisosPendentes(perfilId: number): Promise<ResultadoEnvio> {
  return comPerfil(perfilId, async (): Promise<ResultadoEnvio> => {
    const config = await lerConfigAvisos();
    if (!config.ativos) {
      return { enviados: 0, canais: { email: SEM_CANAL, telegram: SEM_CANAL } };
    }
    const novidades = await coletarNovidades(perfilId, hoje());
    if (novidades.length === 0) {
      const semNovidade: ResultadoCanal = { situacao: 'SEM_NOVIDADE', erro: null };
      return { enviados: 0, canais: { email: semNovidade, telegram: semNovidade } };
    }
    const titulo = `Avisos de ${await nomeDoPerfil(perfilId)}`;
    const canais = await enviarPelosCanais(
      config,
      titulo,
      novidades.map((a) => a.linha)
    );
    const algumEnviado = canais.email.situacao === 'ENVIADO' || canais.telegram.situacao === 'ENVIADO';
    if (!algumEnviado) {
      return { enviados: 0, canais };
    }
    for (const aviso of novidades) {
      await prisma.avisoEnviado.create({ data: { chave: aviso.chave } });
    }
    return { enviados: novidades.length, canais };
  });
}

// Envia "Teste de aviso" pelos canais configurados (ignora o liga/desliga) e devolve o resultado de cada um.
export function testarAvisos(perfilId: number): Promise<ResultadoEnvio> {
  return comPerfil(perfilId, async (): Promise<ResultadoEnvio> => {
    const config = await lerConfigAvisos();
    const canais = await enviarPelosCanais(config, 'Teste de aviso', ['Teste de aviso']);
    const enviados = [canais.email, canais.telegram].filter((c) => c.situacao === 'ENVIADO').length;
    return { enviados, canais };
  });
}

export interface EntradaConfigAvisos {
  ativos: boolean;
  email: string | null;
  telegramChatId: string | null;
  telegramToken?: string | null; // vazio ou ausente mantém o token gravado
  apagarToken?: boolean; // true remove o token gravado
}

// Grava a configuração. O token é cifrado (AES-256-GCM) antes de ir para o banco.
export async function salvarConfigAvisos(entrada: EntradaConfigAvisos): Promise<void> {
  await lerConfiguracao(); // garante a linha id 1
  const dados: {
    avisosAtivos: boolean;
    avisosEmail: string | null;
    telegramChatId: string | null;
    telegramTokenCifrado?: string | null;
  } = {
    avisosAtivos: entrada.ativos,
    avisosEmail: entrada.email,
    telegramChatId: entrada.telegramChatId,
  };
  if (entrada.apagarToken) {
    dados.telegramTokenCifrado = null;
  } else if (entrada.telegramToken && entrada.telegramToken.trim() !== '') {
    dados.telegramTokenCifrado = cifrar(entrada.telegramToken.trim());
  }
  await prisma.configuracaoPlataforma.update({ where: { id: 1 }, data: dados });
  limparCacheConfiguracao();
}

// ---------- Agendamento diário ----------

async function rodarAvisosDoDia(): Promise<void> {
  const perfis = await prisma.perfilFinanceiro.findMany({ select: { id: true } });
  for (const perfil of perfis) {
    try {
      await enviarAvisosPendentes(perfil.id);
    } catch (erro) {
      console.error('Falha nos avisos do perfil', perfil.id, erro instanceof Error ? erro.message : erro);
    }
  }
}

function agendarProximo(): void {
  const agora = new Date();
  const proximo = new Date(agora);
  proximo.setHours(HORA_DO_ENVIO, 0, 0, 0);
  if (proximo.getTime() <= agora.getTime()) proximo.setDate(proximo.getDate() + 1);
  setTimeout(() => {
    void rodarAvisosDoDia().finally(agendarProximo);
  }, proximo.getTime() - agora.getTime()).unref();
}

let agendado = false;

// Chamado uma vez ao carregar o módulo de avisos.
export function iniciarAvisosDiarios(): void {
  if (agendado) return;
  agendado = true;
  agendarProximo();
}
