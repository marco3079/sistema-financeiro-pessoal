import crypto from 'crypto';
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, HttpError, validar } from '../../lib/erros';
import { dataSchema } from '../../lib/financas';
import { perfilAtual } from '../../lib/prisma';

// Automação da B3: traz a planilha de movimentação da Área do Investidor com o login da própria pessoa.
//
// 1. A tela (Carteira > Proventos) cria uma tarefa com o período escolhido e recebe um link financas-b3://.
// 2. O link abre o script ferramentas/b3 no computador (registrado no Windows pelo registrar-b3.ps1). O script
//    abre uma janela limpa do Chrome na B3, e a pessoa faz o login nela. A senha nunca passa pelo sistema.
// 3. O script filtra o período em Movimentação, exporta o XLSX e manda o arquivo para cá. O andamento chega
//    pelas rotas públicas abaixo, autenticadas com a senha de uso único desta tarefa (não serve para mais nada).
// 4. A tela lê o arquivo e mostra a mesma prévia da Importação (PreviaB3). Quem grava é /importacao/b3/confirmar,
//    no perfil financeiro da tarefa, e o que já foi importado não se repete.
//
// A tarefa fica só na memória: uma por vez, e some quando a API reinicia.

type Etapa =
  | 'AGUARDANDO_SCRIPT' // link criado, o script ainda não deu sinal
  | 'ABRINDO' // o script abriu o Chrome
  | 'LOGIN' // esperando a pessoa entrar na conta da B3
  | 'BAIXANDO' // filtrando o período e exportando
  | 'AGUARDANDO_VOCE' // a automação não achou um botão: a pessoa termina na janela
  | 'PRONTA' // o arquivo chegou
  | 'IMPORTADA'
  | 'ERRO'
  | 'CANCELADA';

const EM_ANDAMENTO: Etapa[] = ['AGUARDANDO_SCRIPT', 'ABRINDO', 'LOGIN', 'BAIXANDO', 'AGUARDANDO_VOCE'];
const ETAPAS_DO_SCRIPT = ['ABRINDO', 'LOGIN', 'BAIXANDO', 'AGUARDANDO_VOCE', 'ERRO'] as const;

const ESPERA_SCRIPT_MS = 5 * 60 * 1000; // o link não abriu o script
const SEM_SINAL_MS = 3 * 60 * 1000; // o script parou de mandar notícias
const VALIDADE_ARQUIVO_MS = 60 * 60 * 1000;
const TAMANHO_MAXIMO = 8 * 1024 * 1024;

interface Tarefa {
  id: string;
  token: string;
  perfilId: number;
  de: string;
  ate: string;
  etapa: Etapa;
  mensagem: string;
  log: string[];
  criadaEm: number;
  ultimoSinal: number;
  arquivo: { nome: string; conteudo: Buffer; recebidoEm: number } | null;
}

let tarefa: Tarefa | null = null;

function registrar(t: Tarefa, texto: string) {
  t.log.push(texto);
  if (t.log.length > 60) t.log.shift();
}

function mudar(t: Tarefa, etapa: Etapa, mensagem: string) {
  t.etapa = etapa;
  t.mensagem = mensagem;
  registrar(t, mensagem);
}

// Tarefa sem sinal do script vira erro; arquivo velho sai da memória.
function conferirPrazos() {
  if (!tarefa) return;
  const agora = Date.now();
  if (tarefa.etapa === 'AGUARDANDO_SCRIPT' && agora - tarefa.criadaEm > ESPERA_SCRIPT_MS) {
    mudar(tarefa, 'ERRO', 'O Chrome não abriu. Confira se o link financas-b3 foi registrado neste computador (registrar-b3.ps1).');
  } else if (EM_ANDAMENTO.includes(tarefa.etapa) && tarefa.etapa !== 'AGUARDANDO_SCRIPT' && agora - tarefa.ultimoSinal > SEM_SINAL_MS) {
    mudar(tarefa, 'ERRO', 'O script da B3 parou de responder (a janela do PowerShell foi fechada?).');
  }
  if (tarefa.arquivo && agora - tarefa.arquivo.recebidoEm > VALIDADE_ARQUIVO_MS) tarefa.arquivo = null;
}

function paraTela(t: Tarefa | null) {
  if (!t) return { etapa: 'NENHUMA' as const };
  return {
    id: t.id,
    etapa: t.etapa,
    mensagem: t.mensagem,
    log: t.log,
    de: t.de,
    ate: t.ate,
    arquivo: t.arquivo ? { nome: t.arquivo.nome, tamanho: t.arquivo.conteudo.length } : null,
  };
}

// Tarefa do perfil financeiro da requisição (a de outro perfil não aparece).
function tarefaDoPerfil(): Tarefa | null {
  conferirPrazos();
  return tarefa && tarefa.perfilId === perfilAtual() ? tarefa : null;
}

// ---------- Rotas públicas: o script no computador (a senha de uso único da tarefa é a credencial) ----------

export const publico = Router();

function tarefaDoScript(id: string, cabecalho: string | undefined): Tarefa {
  const recebido = Buffer.from(String(cabecalho ?? '').replace(/^Bearer\s+/i, ''));
  if (!tarefa || tarefa.id !== id) throw new HttpError(404, 'Esta atualização da B3 não existe mais. Comece de novo pela tela.');
  const esperado = Buffer.from(tarefa.token);
  if (recebido.length !== esperado.length || !crypto.timingSafeEqual(recebido, esperado)) {
    throw new HttpError(401, 'Senha da tarefa inválida.');
  }
  return tarefa;
}

const andamentoSchema = z.object({
  etapa: z.enum(ETAPAS_DO_SCRIPT),
  mensagem: z.string().trim().max(400).default(''),
});

publico.post(
  '/b3/automacao/:id/andamento',
  asyncHandler(async (req, res) => {
    const t = tarefaDoScript(String(req.params.id), req.headers.authorization);
    const dados = validar(andamentoSchema, req.body);
    // Cancelada pela tela ou já encerrada: o script fecha o Chrome.
    if (!EM_ANDAMENTO.includes(t.etapa)) {
      res.json({ continuar: false, etapa: t.etapa });
      return;
    }
    t.ultimoSinal = Date.now();
    if (dados.etapa !== t.etapa || (dados.mensagem && dados.mensagem !== t.mensagem)) {
      mudar(t, dados.etapa, dados.mensagem || t.mensagem);
    }
    res.json({ continuar: t.etapa !== 'ERRO', etapa: t.etapa, de: t.de, ate: t.ate });
  })
);

const arquivoSchema = z.object({
  nome: z.string().trim().min(1).max(200),
  conteudo: z.string().min(10).max(Math.ceil((TAMANHO_MAXIMO * 4) / 3) + 8),
});

publico.post(
  '/b3/automacao/:id/arquivo',
  asyncHandler(async (req, res) => {
    const t = tarefaDoScript(String(req.params.id), req.headers.authorization);
    if (!EM_ANDAMENTO.includes(t.etapa)) throw new HttpError(409, 'Esta atualização da B3 já foi encerrada.');
    const dados = validar(arquivoSchema, req.body);
    const conteudo = Buffer.from(dados.conteudo, 'base64');
    // XLSX é um ZIP: começa com "PK".
    if (conteudo.length < 100 || conteudo[0] !== 0x50 || conteudo[1] !== 0x4b) {
      throw new HttpError(400, 'O arquivo recebido não é uma planilha XLSX.');
    }
    const nome = dados.nome.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'movimentacao-b3.xlsx';
    t.arquivo = { nome: /\.xlsx$/i.test(nome) ? nome : `${nome}.xlsx`, conteudo, recebidoEm: Date.now() };
    t.ultimoSinal = Date.now();
    mudar(t, 'PRONTA', 'Planilha de movimentação recebida. Confira a prévia e importe.');
    res.status(201).json({ ok: true });
  })
);

// ---------- Rotas autenticadas: a tela ----------

const router = Router();

const novaSchema = z
  .object({ de: dataSchema, ate: dataSchema })
  .refine((d) => d.de <= d.ate, { message: 'A data inicial passa da final.' });

router.post(
  '/b3/automacao',
  asyncHandler(async (req, res) => {
    const { de, ate } = validar(novaSchema, req.body);
    conferirPrazos();
    if (tarefa && EM_ANDAMENTO.includes(tarefa.etapa) && tarefa.etapa !== 'AGUARDANDO_SCRIPT') {
      throw new HttpError(409, 'Já há uma atualização da B3 em andamento. Cancele-a antes de começar outra.');
    }
    const perfilId = perfilAtual();
    if (perfilId === null) throw new HttpError(400, 'Perfil financeiro não identificado.');
    const agora = Date.now();
    tarefa = {
      id: crypto.randomUUID(),
      token: crypto.randomBytes(32).toString('base64url'),
      perfilId,
      de,
      ate,
      etapa: 'AGUARDANDO_SCRIPT',
      mensagem: '',
      log: [],
      criadaEm: agora,
      ultimoSinal: agora,
      arquivo: null,
    };
    mudar(tarefa, 'AGUARDANDO_SCRIPT', 'Abrindo o script da B3 no computador...');
    const parametros = new URLSearchParams({ id: tarefa.id, token: tarefa.token, de, ate });
    res.status(201).json({ ...paraTela(tarefa), link: `financas-b3://iniciar/?${parametros.toString()}` });
  })
);

router.get(
  '/b3/automacao',
  asyncHandler(async (_req, res) => {
    res.json(paraTela(tarefaDoPerfil()));
  })
);

// O XLSX recebido, em base64: a tela lê as abas com o mesmo leitor da Importação.
router.get(
  '/b3/automacao/arquivo',
  asyncHandler(async (_req, res) => {
    const t = tarefaDoPerfil();
    if (!t?.arquivo) throw new HttpError(404, 'A planilha da B3 ainda não chegou.');
    res.json({ nome: t.arquivo.nome, conteudo: t.arquivo.conteudo.toString('base64') });
  })
);

router.post(
  '/b3/automacao/cancelar',
  asyncHandler(async (_req, res) => {
    const t = tarefaDoPerfil();
    if (t && EM_ANDAMENTO.includes(t.etapa)) mudar(t, 'CANCELADA', 'Atualização cancelada. O Chrome fecha em instantes.');
    res.json(paraTela(t));
  })
);

// Fim: a importação foi feita (ou descartada) na tela; o arquivo sai da memória.
router.post(
  '/b3/automacao/concluir',
  asyncHandler(async (req, res) => {
    const { importada } = validar(z.object({ importada: z.boolean() }), req.body);
    const t = tarefaDoPerfil();
    if (t) {
      t.arquivo = null;
      if (t.etapa === 'PRONTA') mudar(t, importada ? 'IMPORTADA' : 'CANCELADA', importada ? 'Movimentação importada.' : 'Planilha descartada.');
    }
    res.json(paraTela(t));
  })
);

export default router;
