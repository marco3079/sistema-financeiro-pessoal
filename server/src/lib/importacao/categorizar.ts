import { prisma } from '../prisma';
import type { ItemLido } from './extrato';

// Categoria automática de lançamentos que chegam de fora (arquivo importado ou API do banco).

function semAcento(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Categoria pelo que o próprio usuário já fez (mesma descrição) e, na falta disso, por palavras conhecidas.
const PALAVRAS: { nome: string; trechos: string[] }[] = [
  { nome: 'Transporte', trechos: ['uber', '99app', '99 app', '99pop', 'posto', 'combustivel', 'estacionamento', 'pedagio', 'sem parar', 'patinete', 'metro', 'pneus', 'shell', 'ipiranga'] },
  { nome: 'Restaurantes', trechos: ['ifood', 'restaurante', 'pizza', 'lanchonete', 'burger', 'padaria', 'panificadora', 'cafeteria', 'bar ', 'churrascaria', 'rappi', 'sushi'] },
  { nome: 'Mercado', trechos: ['supermercado', 'mercado ', 'atacadao', 'assai', 'carrefour', 'pao de acucar', 'hortifruti', 'conveniencia', 'mercadinho'] },
  { nome: 'Assinaturas', trechos: ['netflix', 'spotify', 'apple.com/bill', 'amazon prime', 'amazonprime', 'amazon music', 'globoplay', 'disney', 'hbo', 'youtube', 'microsoft', 'google', 'canva', 'melimais', 'chatgpt', 'openai', 'icloud', 'deezer'] },
  { nome: 'Saúde', trechos: ['farmacia', 'drogaria', 'drogasil', 'pague menos', 'hospital', 'clinica', 'laboratorio', 'otica', 'dentista', 'unimed', 'hapvida'] },
  { nome: 'Contas da casa', trechos: ['neoenergia', 'energia', 'enel', 'cemig', 'copel', 'celpe', 'telefonica', 'vivo', 'claro', 'tim ', 'oi fibra', 'saneamento', 'compesa', 'sabesp', 'condominio', 'gas '] },
  { nome: 'Educação', trechos: ['escola', 'faculdade', 'universidade', 'curso', 'udemy', 'alura', 'hotmart', 'livraria'] },
  { nome: 'Lazer', trechos: ['cinema', 'ingresso', 'show', 'steam', 'playstation', 'xbox', 'xsolla', 'gamers club', 'hotel', 'airbnb', 'booking'] },
  { nome: 'Compras', trechos: ['mercadolivre', 'mercado livre', 'amazon', 'shopee', 'tiktok shop', 'magazine', 'magalu', 'renner', 'riachuelo', 'c&a', 'aliexpress', 'shein', 'americanas', 'casas bahia'] },
  { nome: 'Impostos e taxas', trechos: ['iof', 'anuidade', 'juros', 'multa', 'tarifa', 'encargo'] },
];

export async function montarClassificador(): Promise<(item: ItemLido) => number | null> {
  const categorias = await prisma.categoria.findMany({ select: { id: true, nome: true, tipo: true } });
  const idDespesa = new Map(categorias.filter((c) => c.tipo === 'DESPESA').map((c) => [c.nome, c.id]));
  const cache = new Map<string, number | null>();
  return (item) => {
    if (item.transferencia || item.tipo !== 'DESPESA') return null;
    const d = semAcento(item.descricao);
    if (cache.has(d)) return cache.get(d) ?? null;
    const achada = PALAVRAS.find((p) => p.trechos.some((t) => d.includes(t)));
    const id = achada ? (idDespesa.get(achada.nome) ?? null) : null;
    cache.set(d, id);
    return id;
  };
}

// Categorias que o usuário já deu a lançamentos com a mesma descrição (a mais recente vence).
export async function categoriasPorHistorico(descricoes: string[]): Promise<Map<string, number>> {
  const mapa = new Map<string, number>();
  const unicas = [...new Set(descricoes)];
  for (let i = 0; i < unicas.length; i += 300) {
    const lote = await prisma.transacao.findMany({
      where: { descricao: { in: unicas.slice(i, i + 300) }, categoriaId: { not: null } },
      select: { descricao: true, categoriaId: true },
      orderBy: { id: 'asc' },
    });
    for (const t of lote) if (t.categoriaId !== null) mapa.set(t.descricao, t.categoriaId);
  }
  return mapa;
}

// Tudo junto, na ordem da importação: regra do usuário, depois o que ele já deu à mesma descrição, depois palavras
// conhecidas (só despesa). Transferência fica sem categoria.
export async function montarCategorizador(descricoes: string[]): Promise<(item: ItemLido) => number | null> {
  const classificar = await montarClassificador();
  const regras = (await prisma.regraCategoria.findMany({ orderBy: { id: 'asc' } })).map((r) => ({ trecho: semAcento(r.trecho).trim(), categoriaId: r.categoriaId }));
  const tipoDaCategoria = new Map((await prisma.categoria.findMany({ select: { id: true, tipo: true } })).map((c) => [c.id, c.tipo]));
  const historico = await categoriasPorHistorico(descricoes);
  return (item) => {
    if (item.transferencia) return null;
    const d = semAcento(item.descricao);
    const pelaRegra = regras.find((r) => r.trecho !== '' && d.includes(r.trecho) && tipoDaCategoria.get(r.categoriaId) === item.tipo)?.categoriaId;
    return pelaRegra ?? historico.get(item.descricao) ?? (item.tipo === 'DESPESA' ? classificar(item) : null);
  };
}
