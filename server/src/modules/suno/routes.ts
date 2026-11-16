import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, HttpError, validar } from '../../lib/erros';
import { arredondar, dataISO, num } from '../../lib/financas';
import { buscarChave } from '../../lib/mcp';
import { comPerfil, prisma } from '../../lib/prisma';

// Carteiras recomendadas da Suno Research. A Suno não tem API: o script ferramentas/suno (no computador da pessoa)
// abre o navegador, a pessoa entra na conta dela e o script lê as tabelas das páginas de carteira e manda para cá.
// O envio usa uma chave de acesso (a mesma de "Conectar IA") com permissão "consulta e lança": a senha da Suno
// nunca passa pelo sistema. Aqui as carteiras ficam guardadas e são comparadas com a carteira da pessoa.
// Não é recomendação: o sistema só cruza o que a Suno publica com o que a pessoa tem.

// ---------- Formato do envio ----------

const tabelaSchema = z.object({
  colunas: z.array(z.string().max(120)).max(40),
  linhas: z.array(z.array(z.string().max(400)).max(40)).max(500),
});

const carteiraSchema = z.object({
  slug: z.string().trim().regex(/^[a-z0-9-]{1,60}$/),
  nome: z.string().trim().min(1).max(120),
  url: z.string().trim().url().max(300),
  // Cada tabela da página, classificada pelo script: a recomendada, as encerradas e as demais (cobertura, radar...).
  recomendada: tabelaSchema.nullable(),
  encerradas: tabelaSchema.nullable(),
  outras: z.array(tabelaSchema.extend({ titulo: z.string().max(120).nullable() })).max(10),
});

const dataSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();

const envioSchema = z.object({
  carteiras: z.array(carteiraSchema).min(1).max(30),
  // Plano da pessoa na Suno, lido em "Meu plano" (null quando o script não achou).
  assinatura: z
    .object({ plano: z.string().trim().min(1).max(80), inicio: dataSchema, fim: dataSchema })
    .nullable()
    .optional(),
});

function paraData(iso: string | null): Date | null {
  return iso ? new Date(`${iso}T00:00:00Z`) : null;
}

// ---------- Leitura das tabelas ----------

function semAcento(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// "98,60 -1,39%" -> 98.6; "12,2%" -> 12.2; "Abaixo de 15,00" -> 15
function numeroBr(texto: string | undefined): number | null {
  const m = /-?\d{1,3}(?:\.\d{3})*(?:,\d+)?|-?\d+(?:,\d+)?/.exec(String(texto ?? '').trim());
  if (!m) return null;
  const n = Number(m[0].replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

// "28.02.2018" -> "2018-02-28"
function dataBr(texto: string | undefined): string | null {
  const m = /(\d{2})[./](\d{2})[./](\d{4})/.exec(String(texto ?? ''));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

// Código de negociação: começa com letra, 4 caracteres (letras ou dígitos, como em B3SA3 e B5P211) e 1 ou 2 dígitos.
const TICKER = /\b([A-Z][A-Z0-9]{3}\d{1,2})\b/;

function tickerDaLinha(colunas: string[], linha: string[]): string | null {
  const i = colunas.findIndex((c) => semAcento(c).includes('ticker'));
  const candidatos = i >= 0 ? [linha[i], ...linha] : linha;
  for (const c of candidatos) {
    const m = TICKER.exec(String(c ?? '').replace(/\s+/g, ' '));
    if (m) return m[1];
  }
  return null;
}

// Coluna pelo começo do nome, sem acento ("p. teto" e "preço-teto" -> teto).
function coluna(colunas: string[], ...trechos: string[]): number {
  return colunas.findIndex((c) => {
    const n = semAcento(c);
    return trechos.some((t) => n.includes(t));
  });
}

interface AtivoSuno {
  ticker: string;
  setor: string | null;
  vies: string | null; // "Comprar", "Aguardar"...
  precoTeto: number | null;
  precoAtual: number | null;
  precoEntrada: number | null;
  dataEntrada: string | null;
  alocacao: number | null; // % da carteira
  dyEsperado: number | null;
  rentabilidade: number | null;
}

interface EncerradaSuno {
  ticker: string;
  inicio: string | null;
  encerramento: string | null;
  precoEntrada: number | null;
  precoSaida: number | null;
  retorno: number | null;
}

type Tabela = z.infer<typeof tabelaSchema>;

// Linhas da recomendada sem ativo de bolsa, só com alocação: "renda_fixa", "tesouro_selic"...
function lerOutrasAlocacoes(t: Tabela | null): { nome: string; alocacao: number }[] {
  if (!t) return [];
  const c = t.colunas;
  const iAloc = coluna(c, 'alocacao');
  if (iAloc < 0) return [];
  const lista: { nome: string; alocacao: number }[] = [];
  for (const l of t.linhas) {
    if (tickerDaLinha(c, l)) continue;
    const alocacao = numeroBr(l[iAloc]);
    const nome = l.find((v, i) => i !== iAloc && /[a-z]/i.test(v ?? '') && !/%/.test(v ?? ''));
    if (alocacao === null || alocacao <= 0 || !nome) continue;
    const legivel = nome.replace(/_/g, ' ').trim();
    lista.push({ nome: legivel.charAt(0).toUpperCase() + legivel.slice(1), alocacao });
  }
  return lista;
}

function lerRecomendada(t: Tabela | null): AtivoSuno[] {
  if (!t) return [];
  const c = t.colunas;
  const iVies = coluna(c, 'vies');
  const iTeto = coluna(c, 'teto');
  const iAtual = coluna(c, 'atual');
  const iEntrada = c.findIndex((x) => semAcento(x).includes('entrada') && !semAcento(x).includes('possivel'));
  const iAloc = coluna(c, 'alocacao');
  const iDy = coluna(c, 'dy');
  const iRent = coluna(c, 'rentabilidade', 'retorno');
  const iSetor = coluna(c, 'setor');
  const ativos: AtivoSuno[] = [];
  for (const l of t.linhas) {
    const ticker = tickerDaLinha(c, l);
    if (!ticker) continue;
    ativos.push({
      ticker,
      setor: iSetor >= 0 ? l[iSetor]?.trim() || null : null,
      vies: iVies >= 0 ? l[iVies]?.trim() || null : null,
      precoTeto: iTeto >= 0 ? numeroBr(l[iTeto]) : null,
      precoAtual: iAtual >= 0 ? numeroBr(l[iAtual]) : null,
      precoEntrada: iEntrada >= 0 ? numeroBr(l[iEntrada]) : null,
      dataEntrada: iEntrada >= 0 ? dataBr(l[iEntrada]) : null,
      alocacao: iAloc >= 0 ? numeroBr(l[iAloc]) : null,
      dyEsperado: iDy >= 0 ? numeroBr(l[iDy]) : null,
      rentabilidade: iRent >= 0 ? numeroBr(l[iRent]) : null,
    });
  }
  return ativos;
}

function lerEncerradas(t: Tabela | null): EncerradaSuno[] {
  if (!t) return [];
  const c = t.colunas;
  const iInicio = coluna(c, 'inicio');
  const iFim = coluna(c, 'encerramento');
  const iEntrada = coluna(c, 'entrada');
  const iSaida = coluna(c, 'saida');
  const iRet = coluna(c, 'retorno');
  const lista: EncerradaSuno[] = [];
  for (const l of t.linhas) {
    const ticker = tickerDaLinha(c, l);
    if (!ticker) continue;
    lista.push({
      ticker,
      inicio: iInicio >= 0 ? dataBr(l[iInicio]) : null,
      encerramento: iFim >= 0 ? dataBr(l[iFim]) : null,
      precoEntrada: iEntrada >= 0 ? numeroBr(l[iEntrada]) : null,
      precoSaida: iSaida >= 0 ? numeroBr(l[iSaida]) : null,
      retorno: iRet >= 0 ? numeroBr(l[iRet]) : null,
    });
  }
  // A mesma ação pode ter entrado e saído mais de uma vez: fica o encerramento mais recente.
  const porTicker = new Map<string, EncerradaSuno>();
  for (const e of lista) {
    const atual = porTicker.get(e.ticker);
    if (!atual || (e.encerramento ?? '') > (atual.encerramento ?? '')) porTicker.set(e.ticker, e);
  }
  return [...porTicker.values()];
}

// Tipo dos ativos de cada carteira, para saber com que parte da carteira da pessoa comparar.
function tiposDaCarteira(slug: string): string[] {
  if (slug.includes('fii')) return ['FII'];
  if (slug.includes('etf')) return ['ETF'];
  if (slug.includes('internacional')) return [];
  return ['ACAO'];
}

// Grava as carteiras e o plano no perfil em uso. O envio traz todas as carteiras assinadas: as que não vieram
// (deixaram de ser assinadas) saem. Devolve os nomes das carteiras gravadas.
async function gravarEnvio(dados: z.infer<typeof envioSchema>): Promise<string[]> {
  const nomes: string[] = [];
  for (const c of dados.carteiras) {
    const conteudo = { recomendada: c.recomendada, encerradas: c.encerradas, outras: c.outras };
    const existente = await prisma.carteiraSuno.findFirst({ where: { slug: c.slug } });
    if (existente) {
      await prisma.carteiraSuno.update({
        where: { id: existente.id },
        data: { nome: c.nome, url: c.url, dados: conteudo, atualizadoEm: new Date() },
      });
    } else {
      await prisma.carteiraSuno.create({ data: { slug: c.slug, nome: c.nome, url: c.url, dados: conteudo } });
    }
    nomes.push(c.nome);
  }
  await prisma.carteiraSuno.deleteMany({ where: { slug: { notIn: dados.carteiras.map((c) => c.slug) } } });
  if (dados.assinatura) {
    const a = dados.assinatura;
    const campos = { plano: a.plano, inicio: paraData(a.inicio), fim: paraData(a.fim), atualizadoEm: new Date() };
    const existente = await prisma.assinaturaSuno.findFirst({});
    if (existente) await prisma.assinaturaSuno.update({ where: { id: existente.id }, data: campos });
    else await prisma.assinaturaSuno.create({ data: campos });
  }
  return nomes;
}

// ---------- Rotas públicas: envio pelo script (a chave é a credencial) ----------

export const publico = Router();

publico.post(
  '/suno/importar',
  asyncHandler(async (req, res) => {
    const cabecalho = String(req.headers.authorization ?? '');
    const chave = cabecalho.startsWith('Bearer ') ? await buscarChave(cabecalho.slice(7).trim()) : null;
    if (!chave) throw new HttpError(401, 'Chave de acesso inválida. Crie uma em "Conectar IA", com permissão "consulta e lança".');
    if (chave.permissao !== 'ESCRITA') {
      throw new HttpError(403, 'Esta chave é só de consulta. Crie uma com permissão "consulta e lança" para enviar as carteiras.');
    }
    const dados = validar(envioSchema, req.body);
    const gravadas = await comPerfil(chave.perfilId, () => gravarEnvio(dados));
    res.status(201).json({ carteiras: gravadas.length, nomes: gravadas });
  })
);

// ---------- Rotas autenticadas: consulta e comparação ----------

const router = Router();

type Situacao =
  | 'COMPRAR' // a Suno recomenda (viés comprar) e a pessoa não tem
  | 'AGUARDAR' // na carteira da Suno, viés aguardar, e a pessoa não tem
  | 'TEM' // a pessoa tem e está na carteira da Suno
  | 'ENCERRADA' // a Suno encerrou a recomendação e a pessoa ainda tem
  | 'FORA'; // a pessoa tem um ativo do mesmo tipo que não está na carteira da Suno

router.get(
  '/suno',
  asyncHandler(async (_req, res) => {
    const carteiras = await prisma.carteiraSuno.findMany({ orderBy: { nome: 'asc' } });
    const investimentos = await prisma.investimento.findMany({
      where: { ativo: true, codigo: { not: null }, quantidade: { gt: 0 } },
      select: { id: true, codigo: true, nome: true, tipo: true, quantidade: true, saldo: true, valorAplicado: true },
    });
    const minhas = new Map(investimentos.map((i) => [(i.codigo ?? '').toUpperCase(), i]));
    // Proventos recebidos de cada ativo (todo o histórico), para o retorno com proventos.
    const proventos = new Map<number, number>();
    if (investimentos.length > 0) {
      const somas = await prisma.movimentoInvestimento.groupBy({
        by: ['investimentoId'],
        where: { investimentoId: { in: investimentos.map((i) => i.id) }, tipo: 'RENDIMENTO' },
        _sum: { valor: true },
      });
      for (const s of somas) proventos.set(s.investimentoId, num(s._sum.valor));
    }

    // A posição da pessoa num ativo: preço médio, preço de hoje, retorno com e sem proventos.
    function posicao(i: (typeof investimentos)[number]) {
      const quantidade = num(i.quantidade);
      const aplicado = num(i.valorAplicado);
      const saldo = num(i.saldo);
      const recebidos = proventos.get(i.id) ?? 0;
      return {
        quantidade,
        saldo: arredondar(saldo),
        valorAplicado: arredondar(aplicado),
        precoMedio: quantidade > 0 && aplicado > 0 ? Math.round((aplicado / quantidade) * 100) / 100 : null,
        precoAtual: quantidade > 0 && saldo > 0 ? Math.round((saldo / quantidade) * 100) / 100 : null,
        retorno: aplicado > 0 ? arredondar(saldo - aplicado) : null,
        retornoPct: aplicado > 0 ? arredondar(((saldo - aplicado) / aplicado) * 100) : null,
        proventos: arredondar(recebidos),
        retornoComProventosPct: aplicado > 0 ? arredondar(((saldo + recebidos - aplicado) / aplicado) * 100) : null,
        investimentoId: i.id,
      };
    }

    const resultado = carteiras.map((c) => {
      const dados = c.dados as unknown as { recomendada: Tabela | null; encerradas: Tabela | null; outras: (Tabela & { titulo: string | null })[] };
      const recomendada = lerRecomendada(dados.recomendada);
      const outrasAlocacoes = lerOutrasAlocacoes(dados.recomendada);
      const encerradas = lerEncerradas(dados.encerradas);
      const tipos = tiposDaCarteira(c.slug);
      const naCarteira = new Set(recomendada.map((a) => a.ticker));
      // Base da comparação: tudo o que a pessoa tem do mesmo tipo (FIIs para a carteira de FIIs, ações para as de ações).
      const doTipo = investimentos.filter((i) => tipos.includes(i.tipo));
      const base = doTipo.reduce((s, i) => s + num(i.saldo), 0);

      const linhas = recomendada.map((a) => {
        const meu = minhas.get(a.ticker);
        const saldo = meu ? num(meu.saldo) : 0;
        const alvo = a.alocacao !== null && base > 0 ? (a.alocacao / 100) * base : null;
        const comprar = /compra/i.test(a.vies ?? '');
        const situacao: Situacao = meu ? 'TEM' : comprar ? 'COMPRAR' : 'AGUARDAR';
        return {
          ...a,
          situacao,
          acimaDoTeto: a.precoAtual !== null && a.precoTeto !== null && a.precoAtual > a.precoTeto,
          quantidade: meu ? num(meu.quantidade) : 0,
          saldo: arredondar(saldo),
          investimentoId: meu?.id ?? null,
          minhaAlocacao: base > 0 ? arredondar((saldo / base) * 100) : null,
          // Quanto falta (positivo) ou sobra (negativo) para chegar à alocação da Suno, sobre o que você tem do tipo.
          diferenca: alvo !== null ? arredondar(alvo - saldo) : null,
        };
      });

      const encerradasQueTenho = encerradas
        .filter((e) => minhas.has(e.ticker) && !naCarteira.has(e.ticker))
        .map((e) => {
          const minha = posicao(minhas.get(e.ticker)!);
          const { retorno: retornoSuno, ...daSuno } = e;
          return {
            ...daSuno,
            retornoSuno, // retorno da recomendação na Suno, em %
            situacao: 'ENCERRADA' as Situacao,
            ...minha,
            // Quanto o preço andou desde a saída da Suno (positivo: subiu depois que ela saiu).
            // Diferença de mais de 4 vezes: quase sempre desdobramento ou grupamento depois da saída (os preços não
            // são comparáveis), então fica sem o número.
            desdeASaidaPct:
              minha.precoAtual !== null && e.precoSaida !== null && e.precoSaida > 0 &&
              minha.precoAtual / e.precoSaida > 0.25 && minha.precoAtual / e.precoSaida < 4
                ? arredondar((minha.precoAtual / e.precoSaida - 1) * 100)
                : null,
          };
        })
        .sort((a, b) => b.saldo - a.saldo);
      const encerrou = new Set(encerradas.map((e) => e.ticker));
      const fora = doTipo
        .filter((i) => !naCarteira.has((i.codigo ?? '').toUpperCase()) && !encerrou.has((i.codigo ?? '').toUpperCase()))
        .map((i) => ({
          ticker: (i.codigo ?? '').toUpperCase(),
          nome: i.nome,
          situacao: 'FORA' as Situacao,
          ...posicao(i),
        }))
        .sort((a, b) => b.saldo - a.saldo);

      return {
        id: c.id,
        slug: c.slug,
        nome: c.nome,
        url: c.url,
        atualizadoEm: c.atualizadoEm.toISOString(),
        atualizadoNoDia: dataISO(c.atualizadoEm),
        tiposComparados: tipos,
        base: arredondar(base),
        linhas,
        outrasAlocacoes,
        encerradasQueTenho,
        fora,
        resumo: {
          ativos: linhas.length,
          comprarQueNaoTenho: linhas.filter((l) => l.situacao === 'COMPRAR').length,
          tenho: linhas.filter((l) => l.situacao === 'TEM').length,
          encerradasQueTenho: encerradasQueTenho.length,
          fora: fora.length,
        },
        // As tabelas como vieram, para carteiras sem colunas reconhecidas (renda fixa, reserva...).
        tabelas: [
          ...(dados.recomendada ? [{ titulo: 'Recomendada', ...dados.recomendada }] : []),
          ...dados.outras,
          ...(dados.encerradas ? [{ titulo: 'Encerradas', ...dados.encerradas }] : []),
        ],
      };
    });
    const assinatura = await prisma.assinaturaSuno.findFirst({});
    const ultima = carteiras.reduce<Date | null>((m, c) => (m === null || c.atualizadoEm > m ? c.atualizadoEm : m), null);
    const hojeIso = new Date().toISOString().slice(0, 10);
    const fim = assinatura?.fim ? dataISO(assinatura.fim) : null;
    res.json({
      carteiras: resultado,
      ultimaAtualizacao: ultima ? ultima.toISOString() : null,
      assinatura: assinatura
        ? {
            plano: assinatura.plano,
            inicio: assinatura.inicio ? dataISO(assinatura.inicio) : null,
            fim,
            // Dias até o fim da vigência (negativo: já venceu).
            diasParaVencer: fim ? Math.round((Date.parse(`${fim}T00:00:00Z`) - Date.parse(`${hojeIso}T00:00:00Z`)) / 86400000) : null,
            atualizadoEm: assinatura.atualizadoEm.toISOString(),
          }
        : null,
    });
  })
);

// ---------- Atualizar pela tela (serviço da Suno, com o login da pessoa) ----------
// A tela manda o e-mail e a senha da Suno; o serviço (contêiner suno) entra na conta sem janela e lê as carteiras.
// A senha só passa por aqui a caminho do serviço: não é gravada nem registrada em log (o log guarda só a rota).
// A tela acompanha a tarefa por GET; quando fica PRONTA, as carteiras são gravadas uma vez, no perfil em uso.

interface EstadoServico {
  id?: string;
  etapa: 'NENHUMA' | 'ENTRANDO' | 'PEDE_CODIGO' | 'LENDO' | 'PRONTA' | 'ERRO' | 'CANCELADA';
  mensagem?: string;
  log?: { em: string; texto: string }[];
  iniciadaEm?: string;
  terminadaEm?: string | null;
  resultado?: unknown;
  erro?: string;
}

const tarefasGravadas = new Map<string, { carteiras: number; erro: string | null }>();

async function servico(metodo: 'GET' | 'POST', caminho: string, corpo?: unknown): Promise<{ status: number; dados: EstadoServico }> {
  const base = process.env.SUNO_URL || 'http://suno:4100';
  let resposta: Response;
  try {
    resposta = await fetch(base + caminho, {
      method: metodo,
      headers: {
        'x-suno-segredo': process.env.SUNO_SEGREDO || '',
        ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new HttpError(503, 'O serviço da Suno não está rodando. Rode o instalador de novo (ele cria o contêiner suno).');
  }
  const dados = (await resposta.json().catch(() => ({ etapa: 'ERRO', erro: 'Resposta inválida do serviço da Suno.' }))) as EstadoServico;
  return { status: resposta.status, dados };
}

// O que a tela vê: a etapa, a mensagem e o andamento (nunca o resultado bruto).
function paraTela(e: EstadoServico, gravacao?: { carteiras: number; erro: string | null }) {
  return {
    etapa: gravacao?.erro ? 'ERRO' : e.etapa,
    mensagem: gravacao?.erro ?? e.mensagem ?? '',
    log: (e.log ?? []).map((l) => l.texto),
    iniciadaEm: e.iniciadaEm ?? null,
    terminadaEm: e.terminadaEm ?? null,
    carteirasGravadas: gravacao && !gravacao.erro ? gravacao.carteiras : null,
  };
}

const loginSuno = z.object({ email: z.string().trim().email().max(200), senha: z.string().min(1).max(200) });
const codigoSuno = z.object({ codigo: z.string().trim().regex(/^[A-Za-z0-9 ]{4,12}$/) });

router.post(
  '/suno/atualizar',
  asyncHandler(async (req, res) => {
    const { email, senha } = validar(loginSuno, req.body);
    const { status, dados } = await servico('POST', '/tarefa', { email, senha });
    if (status >= 400) throw new HttpError(status, dados.erro ?? 'Não foi possível começar a atualização.');
    res.status(202).json(paraTela(dados));
  })
);

router.get(
  '/suno/atualizar',
  asyncHandler(async (_req, res) => {
    const { status, dados } = await servico('GET', '/tarefa');
    if (status >= 400) throw new HttpError(status, dados.erro ?? 'Não foi possível consultar a atualização.');
    let gravacao = dados.id ? tarefasGravadas.get(dados.id) : undefined;
    if (dados.etapa === 'PRONTA' && dados.id && !gravacao) {
      try {
        const envio = validar(envioSchema, dados.resultado);
        const nomes = await gravarEnvio(envio);
        gravacao = { carteiras: nomes.length, erro: null };
      } catch (erro) {
        gravacao = { carteiras: 0, erro: `As carteiras foram lidas, mas não puderam ser gravadas: ${erro instanceof Error ? erro.message : erro}` };
      }
      tarefasGravadas.set(dados.id, gravacao);
    }
    res.json(paraTela(dados, gravacao));
  })
);

router.post(
  '/suno/atualizar/codigo',
  asyncHandler(async (req, res) => {
    const { codigo } = validar(codigoSuno, req.body);
    const { status, dados } = await servico('POST', '/tarefa/codigo', { codigo: codigo.replace(/\s+/g, '') });
    if (status >= 400) throw new HttpError(status, dados.erro ?? 'Não foi possível enviar o código.');
    res.json(paraTela(dados));
  })
);

router.post(
  '/suno/atualizar/cancelar',
  asyncHandler(async (_req, res) => {
    const { dados } = await servico('POST', '/tarefa/cancelar');
    res.json(paraTela(dados));
  })
);

router.delete(
  '/suno',
  asyncHandler(async (_req, res) => {
    const { count } = await prisma.carteiraSuno.deleteMany({});
    await prisma.assinaturaSuno.deleteMany({});
    res.json({ removidas: count });
  })
);

export default router;
