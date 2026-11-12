import nodemailer from 'nodemailer';
import type { ConfiguracaoPlataforma, StatusEmail } from '@prisma/client';
import { prisma } from './prisma';
import { decifrar } from './cripto';

// Envio de e-mails da plataforma (SMTP pelo nodemailer). Contrato em docs/plano/quarta-leva.md, "Contrato A".

export type TipoEmail = 'TESTE' | 'RECUPERACAO' | 'BOAS_VINDAS';

export interface MensagemEmail {
  para: string;
  assunto: string;
  titulo: string; // título dentro do e-mail
  paragrafos: string[]; // texto puro; o módulo escapa o HTML
  botao?: { rotulo: string; endereco: string };
  tipo: TipoEmail;
}

const CACHE_MS = 30_000;
const TEMPO_LIMITE_MS = 15_000;
const INTERVALO_FILA_MS = 300;
const LIMITE_FILA = 500;
const TAMANHO_MAX_ERRO = 300;

// ---------- Configuração (com cache curto) ----------

let cache: { valor: ConfiguracaoPlataforma; ate: number } | null = null;
// Muda a cada limpeza: uma leitura que começou antes de uma gravação não preenche o cache com dados velhos.
let geracaoCache = 0;

export async function lerConfiguracao(): Promise<ConfiguracaoPlataforma> {
  if (cache !== null && cache.ate > Date.now()) {
    return cache.valor;
  }
  const geracao = geracaoCache;
  const valor = await prisma.configuracaoPlataforma.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: {},
  });
  if (geracao === geracaoCache) {
    cache = { valor, ate: Date.now() + CACHE_MS };
  }
  return valor;
}

export function limparCacheConfiguracao(): void {
  cache = null;
  geracaoCache += 1;
}

export async function emailHabilitado(tipo: TipoEmail): Promise<boolean> {
  const configuracao = await lerConfiguracao();
  if (tipo === 'TESTE') {
    return Boolean(configuracao.smtpServidor);
  }
  if (!configuracao.emailAtivo) {
    return false;
  }
  switch (tipo) {
    case 'RECUPERACAO':
      return configuracao.emailRecuperacao;
    case 'BOAS_VINDAS':
      return configuracao.emailBoasVindas;
  }
}

export async function enderecoDoSite(): Promise<string | null> {
  const configuracao = await lerConfiguracao();
  return configuracao.enderecoSite ?? null;
}

// ---------- Montagem do e-mail ----------

function escapar(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function montarHtml(configuracao: ConfiguracaoPlataforma, mensagem: MensagemEmail): string {
  const cor = escapar(configuracao.corPrimaria);
  const nome = escapar(configuracao.nome);
  const paragrafos = mensagem.paragrafos
    .map(
      (paragrafo) =>
        `<p style="margin:0 0 14px;line-height:1.5;color:#334155;font-size:15px">${escapar(paragrafo).replace(/\n/g, '<br>')}</p>`
    )
    .join('');
  const botao = mensagem.botao
    ? `<p style="margin:24px 0 8px"><a href="${escapar(mensagem.botao.endereco)}" style="display:inline-block;background:${cor};color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:8px;font-size:15px">${escapar(mensagem.botao.rotulo)}</a></p>`
    : '';
  return (
    '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
    '<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif">' +
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:24px 12px">' +
    '<tr><td align="center">' +
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden">' +
    `<tr><td style="background:${cor};color:#ffffff;padding:18px 24px;font-size:18px;font-weight:bold">${nome}</td></tr>` +
    '<tr><td style="padding:24px">' +
    `<h1 style="margin:0 0 16px;font-size:20px;color:#0f172a">${escapar(mensagem.titulo)}</h1>` +
    paragrafos +
    botao +
    '</td></tr>' +
    `<tr><td style="padding:14px 24px;background:#f8fafc;color:#64748b;font-size:12px">Mensagem automática de ${nome}</td></tr>` +
    '</table></td></tr></table></body></html>'
  );
}

function montarTexto(configuracao: ConfiguracaoPlataforma, mensagem: MensagemEmail): string {
  const partes = [mensagem.titulo, ...mensagem.paragrafos];
  if (mensagem.botao) {
    partes.push(`${mensagem.botao.rotulo}: ${mensagem.botao.endereco}`);
  }
  partes.push(`Mensagem automática de ${configuracao.nome}`);
  return partes.join('\n\n');
}

// ---------- Envio ----------

// Remove os segredos da mensagem de erro e corta em 300 caracteres.
function limparErro(erro: unknown, segredos: string[]): string {
  let texto = erro instanceof Error ? erro.message : String(erro);
  for (const segredo of segredos) {
    if (segredo) {
      texto = texto.split(segredo).join('***');
    }
  }
  texto = texto.trim() || 'Falha ao enviar o e-mail';
  return texto.slice(0, TAMANHO_MAX_ERRO);
}

async function registrarEnvio(
  mensagem: MensagemEmail,
  status: StatusEmail,
  erro: string | null
): Promise<void> {
  try {
    await prisma.emailEnviado.create({
      data: { para: mensagem.para, assunto: mensagem.assunto, tipo: mensagem.tipo, status, erro },
    });
  } catch (falha) {
    console.error('Falha ao registrar e-mail enviado:', falha instanceof Error ? falha.message : falha);
  }
}

// Os segredos usados (senha do SMTP) entram em `segredos` para serem removidos de eventuais erros.
async function enviarComConfiguracao(
  configuracao: ConfiguracaoPlataforma,
  mensagem: MensagemEmail,
  segredos: string[]
): Promise<void> {
  if (!configuracao.smtpServidor) {
    throw new Error('Servidor de e-mail não configurado');
  }
  if (!configuracao.emailRemetente) {
    throw new Error('E-mail do remetente não configurado');
  }
  let senha: string | null = null;
  if (configuracao.smtpSenhaCifrada) {
    senha = decifrar(configuracao.smtpSenhaCifrada);
    if (senha === null) {
      throw new Error('Senha do e-mail precisa ser digitada de novo nas configurações');
    }
    segredos.push(senha);
  }

  const transporte = nodemailer.createTransport({
    host: configuracao.smtpServidor,
    port: configuracao.smtpPorta,
    secure: configuracao.smtpSeguro,
    auth: configuracao.smtpUsuario ? { user: configuracao.smtpUsuario, pass: senha ?? '' } : undefined,
    connectionTimeout: TEMPO_LIMITE_MS,
    greetingTimeout: TEMPO_LIMITE_MS,
    socketTimeout: TEMPO_LIMITE_MS,
  });

  const nomeRemetente = (configuracao.emailNomeRemetente || configuracao.nome).replace(/["\\\r\n]/g, '');
  await transporte.sendMail({
    from: `"${nomeRemetente}" <${configuracao.emailRemetente}>`,
    to: mensagem.para,
    subject: mensagem.assunto,
    text: montarTexto(configuracao, mensagem),
    html: montarHtml(configuracao, mensagem),
  });
}

// Envia e espera. Lança Error com mensagem legível em caso de falha. Registra em EmailEnviado.
export async function enviarEmailAgora(mensagem: MensagemEmail): Promise<void> {
  const segredos: string[] = [];
  try {
    const configuracao = await lerConfiguracao();
    await enviarComConfiguracao(configuracao, mensagem, segredos);
  } catch (erro) {
    const texto = limparErro(erro, segredos);
    await registrarEnvio(mensagem, 'FALHOU', texto);
    throw new Error(texto);
  }
  await registrarEnvio(mensagem, 'ENVIADO', null);
}

// ---------- Fila ----------

const fila: MensagemEmail[] = [];
let processandoFila = false;

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processarFila(): Promise<void> {
  processandoFila = true;
  try {
    while (fila.length > 0) {
      const proximo = fila.shift();
      if (proximo) {
        try {
          await enviarEmailAgora(proximo);
        } catch {
          // Já registrado como FALHOU em enviarEmailAgora.
        }
      }
      await esperar(INTERVALO_FILA_MS);
    }
  } finally {
    processandoFila = false;
  }
}

// Põe na fila e volta na hora (nunca lança). Não faz nada se emailHabilitado(tipo) for falso.
export function enfileirarEmail(mensagem: MensagemEmail): void {
  void (async () => {
    try {
      if (!(await emailHabilitado(mensagem.tipo))) {
        return;
      }
      if (fila.length >= LIMITE_FILA) {
        await registrarEnvio(mensagem, 'FALHOU', 'Fila cheia');
        return;
      }
      fila.push(mensagem);
      if (!processandoFila) {
        void processarFila();
      }
    } catch (erro) {
      console.error('Falha ao enfileirar e-mail:', erro instanceof Error ? erro.message : erro);
    }
  })();
}
