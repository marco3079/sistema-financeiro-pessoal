// Proventos pelo Open Finance. A Pluggy quase nunca devolve dividendos e rendimentos como movimento do
// investimento: eles chegam como crédito na conta da corretora ("RENDIMENTOS DE CLIENTES MXRF11 S/ 30",
// "DIVIDENDOS DE CLIENTES ITSA4 S/ 100", "JUROS S/ CAPITAL ..."). Aqui esses créditos viram movimento de
// rendimento do ativo citado na descrição, para aparecerem em Carteira > Proventos e no rendimento.

import { prisma } from './prisma';

const DIA_MS = 86_400_000;
const PALAVRAS = /(rendimento|dividendo|provento|juros\s*s(obre|\/)?\s*(o\s*)?capital|\bjcp\b|\bjscp\b|amortizac)/;
const CODIGO = /\b([A-Z]{4}\d{1,2})\b/;

function semAcento(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Código de bolsa citado em um crédito de provento, ou null se a descrição não for de provento.
export function codigoDoProvento(descricao: string): string | null {
  if (!PALAVRAS.test(semAcento(descricao))) return null;
  const casa = CODIGO.exec(descricao.toUpperCase());
  return casa ? casa[1] : null;
}

// Cria os movimentos de rendimento que faltam a partir dos créditos nas contas dadas. Idempotente: cada crédito
// gera no máximo um movimento (chave "conta:<id do lançamento>"), e não repete um provento que já existe no ativo
// com o mesmo valor em até 3 dias (por exemplo, vindo da planilha da B3).
// Precisa rodar dentro do perfil financeiro (comPerfil). Devolve quantos movimentos criou.
export async function gravarProventosDasContas(contaIds: number[], conexaoId: number, desde: Date): Promise<number> {
  if (contaIds.length === 0) return 0;
  const creditos = await prisma.transacao.findMany({
    where: {
      contaId: { in: contaIds },
      tipo: 'RECEITA',
      origem: 'OPEN_FINANCE',
      data: { gte: desde },
      conta: { tipo: { not: 'CARTAO' } },
    },
    orderBy: [{ data: 'asc' }, { id: 'asc' }],
    select: { id: true, data: true, descricao: true, valor: true },
  });
  // Investback (cashback da corretora aplicado em investimento): não cita ativo, então não vira provento, mas
  // também sai da lista de lançamentos e das receitas.
  const idsInvestback = creditos.filter((c) => /\binvestback\b/.test(semAcento(c.descricao))).map((c) => c.id);
  if (idsInvestback.length > 0) {
    await prisma.transacao.updateMany({
      where: { id: { in: idsInvestback }, provento: false },
      data: { provento: true, transferencia: true },
    });
  }

  const comCodigo = creditos.flatMap((c) => {
    const codigo = codigoDoProvento(c.descricao);
    return codigo ? [{ ...c, codigo }] : [];
  });
  if (comCodigo.length === 0) return 0;

  const codigos = [...new Set(comCodigo.map((c) => c.codigo))];
  const ativos = await prisma.investimento.findMany({
    where: { codigo: { in: codigos, mode: 'insensitive' } },
    orderBy: { id: 'asc' },
    select: { id: true, codigo: true, ativo: true, conexaoId: true },
  });
  // Para cada código: primeiro o ativo desta conexão, depois um em carteira, depois qualquer um.
  const ativoPorCodigo = new Map<string, number>();
  for (const codigo of codigos) {
    const candidatos = ativos.filter((a) => (a.codigo ?? '').toUpperCase() === codigo);
    const escolhido =
      candidatos.find((a) => a.conexaoId === conexaoId && a.ativo) ??
      candidatos.find((a) => a.ativo) ??
      candidatos.find((a) => a.conexaoId === conexaoId) ??
      candidatos[0];
    if (escolhido) ativoPorCodigo.set(codigo, escolhido.id);
  }
  if (ativoPorCodigo.size === 0) return 0;

  // O crédito que tem ativo correspondente sai da lista de lançamentos e das receitas: ele passa a contar como
  // provento do ativo, e não duas vezes.
  const idsDosCreditos = comCodigo.filter((c) => ativoPorCodigo.has(c.codigo)).map((c) => c.id);
  for (let i = 0; i < idsDosCreditos.length; i += 1000) {
    await prisma.transacao.updateMany({
      where: { id: { in: idsDosCreditos.slice(i, i + 1000) }, provento: false },
      data: { provento: true, transferencia: true },
    });
  }

  const idsDosAtivos = [...new Set(ativoPorCodigo.values())];
  const [jaLigados, existentes] = await Promise.all([
    prisma.movimentoInvestimento.findMany({
      where: { pluggyId: { in: comCodigo.map((c) => `conta:${c.id}`) } },
      select: { pluggyId: true },
    }),
    prisma.movimentoInvestimento.findMany({
      where: { investimentoId: { in: idsDosAtivos }, tipo: 'RENDIMENTO' },
      select: { investimentoId: true, data: true, valor: true },
    }),
  ]);
  const ligados = new Set(jaLigados.map((m) => m.pluggyId));
  const porAtivo = new Map<number, { dia: number; valor: number; usado: boolean }[]>();
  for (const m of existentes) {
    const lista = porAtivo.get(m.investimentoId) ?? [];
    lista.push({ dia: Math.round(m.data.getTime() / DIA_MS), valor: Number(m.valor), usado: false });
    porAtivo.set(m.investimentoId, lista);
  }

  const novos: { investimentoId: number; data: Date; tipo: 'RENDIMENTO'; valor: number; descricao: string; pluggyId: string }[] = [];
  for (const c of comCodigo) {
    const investimentoId = ativoPorCodigo.get(c.codigo);
    const chave = `conta:${c.id}`;
    if (investimentoId === undefined || ligados.has(chave)) continue;
    const valor = Number(c.valor);
    if (!(valor > 0)) continue;
    const dia = Math.round(c.data.getTime() / DIA_MS);
    const igual = (porAtivo.get(investimentoId) ?? []).find(
      (m) => !m.usado && Math.abs(m.valor - valor) <= 0.005 && Math.abs(m.dia - dia) <= 3
    );
    if (igual) {
      igual.usado = true; // o mesmo provento já está registrado por outra via
      continue;
    }
    novos.push({ investimentoId, data: c.data, tipo: 'RENDIMENTO', valor, descricao: c.descricao.slice(0, 200), pluggyId: chave });
  }
  for (let i = 0; i < novos.length; i += 500) {
    await prisma.movimentoInvestimento.createMany({ data: novos.slice(i, i + 500), skipDuplicates: true });
  }
  return novos.length;
}
