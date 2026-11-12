import { Router } from 'express';
import { z } from 'zod';
import { Prisma, type ConfiguracaoPlataforma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, validar } from '../../lib/erros';
import { permitir } from '../../lib/auth';
import { cifrar } from '../../lib/cripto';
import { enviarEmailAgora, limparCacheConfiguracao, lerConfiguracao } from '../../lib/email';
import { validarImagem } from '../../lib/imagem';

// Configurações da plataforma (identidade, cores e e-mail). Contrato em docs/plano/quarta-leva.md, "Contrato A".

// Rota pública (sem login): nome, logo e cores para a tela de entrada.
export const publico = Router();

// Rotas autenticadas; só o perfil efetivo TITULAR acessa.
const router = Router();

const COR_HEX = /^#[0-9a-fA-F]{6}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface PlataformaPublica {
  nome: string;
  slogan: string;
  logo: string | null;
  corPrimaria: string;
  corSecundaria: string;
  emailAtivo: boolean;
  recuperacaoSenha: boolean;
}

interface ConfiguracoesDTO extends PlataformaPublica {
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

// ---------- Funções auxiliares ----------

function textoOuNulo(valor: string | null | undefined): string | null {
  if (valor === null || valor === undefined) return null;
  const limpo = valor.trim();
  return limpo === '' ? null : limpo;
}

// Aceita vazio (vira null); senão precisa começar com http:// ou https://; tira as barras do fim.
function normalizarEnderecoSite(valor: string | null | undefined): string | null {
  const limpo = textoOuNulo(valor);
  if (limpo === null) return null;
  if (!/^https?:\/\/\S+$/i.test(limpo)) {
    throw new HttpError(400, 'O endereço do site precisa começar com http:// ou https://');
  }
  const semBarra = limpo.replace(/\/+$/, '');
  if (semBarra.length > 200) {
    throw new HttpError(400, 'O endereço do site pode ter até 200 caracteres');
  }
  return semBarra;
}

function plataformaPublica(configuracao: ConfiguracaoPlataforma): PlataformaPublica {
  const emailAtivo = configuracao.emailAtivo && Boolean(configuracao.smtpServidor);
  return {
    nome: configuracao.nome,
    slogan: configuracao.slogan,
    logo: configuracao.logo ?? null,
    corPrimaria: configuracao.corPrimaria,
    corSecundaria: configuracao.corSecundaria,
    emailAtivo,
    recuperacaoSenha: emailAtivo && configuracao.emailRecuperacao,
  };
}

function configuracoesDTO(configuracao: ConfiguracaoPlataforma): ConfiguracoesDTO {
  return {
    ...plataformaPublica(configuracao),
    enderecoSite: configuracao.enderecoSite ?? null,
    smtpServidor: configuracao.smtpServidor ?? null,
    smtpPorta: configuracao.smtpPorta,
    smtpSeguro: configuracao.smtpSeguro,
    smtpUsuario: configuracao.smtpUsuario ?? null,
    smtpSenhaDefinida: Boolean(configuracao.smtpSenhaCifrada),
    emailRemetente: configuracao.emailRemetente ?? null,
    emailNomeRemetente: configuracao.emailNomeRemetente ?? null,
    emailRecuperacao: configuracao.emailRecuperacao,
    emailBoasVindas: configuracao.emailBoasVindas,
    atualizadoEm: configuracao.atualizadoEm.toISOString(),
  };
}

// ---------- Público ----------

publico.get(
  '/plataforma',
  asyncHandler(async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    const configuracao = await lerConfiguracao();
    res.json(plataformaPublica(configuracao));
  })
);

// ---------- Leitura (TITULAR) ----------

router.get(
  '/configuracoes',
  permitir('TITULAR'),
  asyncHandler(async (_req, res) => {
    const configuracao = await lerConfiguracao();
    res.json(configuracoesDTO(configuracao));
  })
);

// ---------- Identidade ----------

const identidadeSchema = z.object({
  nome: z
    .string()
    .trim()
    .min(2, 'O nome precisa ter de 2 a 40 caracteres')
    .max(40, 'O nome precisa ter de 2 a 40 caracteres'),
  slogan: z.string().trim().max(80, 'O slogan pode ter até 80 caracteres'),
  logo: z.string().nullable().optional(),
  corPrimaria: z.string().regex(COR_HEX, 'Cor primária inválida'),
  corSecundaria: z.string().regex(COR_HEX, 'Cor secundária inválida'),
});

router.put(
  '/configuracoes/identidade',
  permitir('TITULAR'),
  asyncHandler(async (req, res) => {
    const dados = validar(identidadeSchema, req.body);
    const logo = validarImagem(dados.logo ?? null, { aceitaEndereco: true });
    await lerConfiguracao();
    const configuracao = await prisma.configuracaoPlataforma.update({
      where: { id: 1 },
      data: {
        nome: dados.nome,
        slogan: dados.slogan,
        logo,
        corPrimaria: dados.corPrimaria.toLowerCase(),
        corSecundaria: dados.corSecundaria.toLowerCase(),
      },
    });
    limparCacheConfiguracao();
    res.json(configuracoesDTO(configuracao));
  })
);

// ---------- E-mail ----------

const emailSchema = z.object({
  enderecoSite: z.string().trim().max(200, 'O endereço do site pode ter até 200 caracteres').nullable().optional(),
  smtpServidor: z.string().trim().max(200, 'Servidor muito longo').nullable().optional(),
  smtpPorta: z
    .number()
    .int('Porta inválida')
    .min(1, 'A porta vai de 1 a 65535')
    .max(65535, 'A porta vai de 1 a 65535'),
  smtpSeguro: z.boolean(),
  smtpUsuario: z.string().trim().max(200, 'Usuário muito longo').nullable().optional(),
  // Ausente, undefined ou null: mantém a senha gravada. String vazia: apaga. Outro texto: grava cifrada.
  smtpSenha: z.string().max(500, 'Senha muito longa').nullable().optional(),
  emailRemetente: z.string().trim().max(200, 'E-mail muito longo').nullable().optional(),
  emailNomeRemetente: z.string().trim().max(100, 'Nome do remetente muito longo').nullable().optional(),
  emailAtivo: z.boolean(),
  emailRecuperacao: z.boolean(),
  emailBoasVindas: z.boolean(),
});

router.put(
  '/configuracoes/email',
  permitir('TITULAR'),
  asyncHandler(async (req, res) => {
    const dados = validar(emailSchema, req.body);
    const enderecoSite = normalizarEnderecoSite(dados.enderecoSite);
    const smtpServidor = textoOuNulo(dados.smtpServidor);
    const smtpUsuario = textoOuNulo(dados.smtpUsuario);
    const emailRemetente = textoOuNulo(dados.emailRemetente);
    const emailNomeRemetente = textoOuNulo(dados.emailNomeRemetente);

    if (emailRemetente !== null && !EMAIL.test(emailRemetente)) {
      throw new HttpError(400, 'E-mail do remetente inválido');
    }

    if (dados.emailAtivo) {
      const faltam: string[] = [];
      if (smtpServidor === null) faltam.push('servidor SMTP');
      if (emailRemetente === null) faltam.push('e-mail do remetente');
      if (enderecoSite === null) faltam.push('endereço do site');
      if (faltam.length > 0) {
        throw new HttpError(400, `Para ligar o envio de e-mails, preencha: ${faltam.join(', ')}.`);
      }
    }

    const data: Prisma.ConfiguracaoPlataformaUpdateInput = {
      enderecoSite,
      smtpServidor,
      smtpPorta: dados.smtpPorta,
      smtpSeguro: dados.smtpSeguro,
      smtpUsuario,
      emailRemetente,
      emailNomeRemetente,
      emailAtivo: dados.emailAtivo,
      emailRecuperacao: dados.emailRecuperacao,
      emailBoasVindas: dados.emailBoasVindas,
    };
    if (dados.smtpSenha !== undefined && dados.smtpSenha !== null) {
      data.smtpSenhaCifrada = dados.smtpSenha === '' ? null : cifrar(dados.smtpSenha);
    }

    await lerConfiguracao();
    const configuracao = await prisma.configuracaoPlataforma.update({ where: { id: 1 }, data });
    limparCacheConfiguracao();
    res.json(configuracoesDTO(configuracao));
  })
);

const testeSchema = z.object({
  para: z.string().trim().max(200, 'E-mail muito longo').refine((valor) => EMAIL.test(valor), 'E-mail inválido'),
});

// Envia mesmo com o envio de e-mails desligado; espera o resultado do servidor.
router.post(
  '/configuracoes/email/teste',
  permitir('TITULAR'),
  asyncHandler(async (req, res) => {
    const dados = validar(testeSchema, req.body);
    try {
      await enviarEmailAgora({
        para: dados.para,
        assunto: 'Teste de e-mail',
        titulo: 'E-mail de teste',
        paragrafos: [
          'Se você recebeu esta mensagem, o envio de e-mails da plataforma está funcionando.',
        ],
        tipo: 'TESTE',
      });
    } catch (erro) {
      const motivo = erro instanceof Error ? erro.message : 'Falha desconhecida';
      throw new HttpError(400, `Não foi possível enviar: ${motivo}`.slice(0, 300));
    }
    res.json({ ok: true });
  })
);

router.get(
  '/configuracoes/email/historico',
  permitir('TITULAR'),
  asyncHandler(async (_req, res) => {
    const registros = await prisma.emailEnviado.findMany({
      orderBy: [{ criadoEm: 'desc' }, { id: 'desc' }],
      take: 30,
      select: { id: true, para: true, assunto: true, tipo: true, status: true, erro: true, criadoEm: true },
    });
    res.json(registros.map((registro) => ({ ...registro, criadoEm: registro.criadoEm.toISOString() })));
  })
);

export default router;
