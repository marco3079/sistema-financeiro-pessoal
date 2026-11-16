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

const envioSchema = z.object({
  carteiras: z.array(carteiraSchema).min(1).max(30),
});

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

const TICKER = /\b([A-Z]{4}\d{1,2})\b/;

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
    const gravadas = await comPerfil(chave.perfilId, async () => {
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
      return nomes;
    });
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

    const resultado = carteiras.map((c) => {
      const dados = c.dados as unknown as { recomendada: Tabela | null; encerradas: Tabela | null; outras: (Tabela & { titulo: string | null })[] };
      const recomendada = lerRecomendada(dados.recomendada);
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
          const meu = minhas.get(e.ticker);
          return { ...e, situacao: 'ENCERRADA' as Situacao, quantidade: num(meu?.quantidade), saldo: arredondar(num(meu?.saldo)), investimentoId: meu?.id ?? null };
        });
      const encerrou = new Set(encerradas.map((e) => e.ticker));
      const fora = doTipo
        .filter((i) => !naCarteira.has((i.codigo ?? '').toUpperCase()) && !encerrou.has((i.codigo ?? '').toUpperCase()))
        .map((i) => ({
          ticker: (i.codigo ?? '').toUpperCase(),
          nome: i.nome,
          situacao: 'FORA' as Situacao,
          quantidade: num(i.quantidade),
          saldo: arredondar(num(i.saldo)),
          investimentoId: i.id,
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
    res.json({ carteiras: resultado });
  })
);

router.delete(
  '/suno',
  asyncHandler(async (_req, res) => {
    const { count } = await prisma.carteiraSuno.deleteMany({});
    res.json({ removidas: count });
  })
);

export default router;
