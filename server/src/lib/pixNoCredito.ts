// Pix pago com o cartão de crédito, visto pela conta: o banco credita o valor ("Valor adicionado na conta por
// cartão de crédito") e o dinheiro sai em seguida, no mesmo valor ("Pix enviado", "Transferência enviada").
// O gasto de verdade está na fatura do cartão. Para não contar duas vezes, as duas pernas viram transferência.

import { prisma } from './prisma';

const DIA_MS = 86_400_000;

function semAcento(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Pagamento da fatura do cartão visto pela conta ("Pagamento de fatura"): o gasto já está nas compras da fatura,
// então a saída da conta é só dinheiro indo para o cartão.
const TRECHOS_PAGAMENTO_DE_FATURA = ['pagamento de fatura', 'pagamento da fatura', 'pagamento fatura', 'pagto fatura', 'pgto fatura', 'pag fatura'];

export function ehPagamentoDeFaturaNaConta(descricao: string): boolean {
  const d = semAcento(descricao);
  return TRECHOS_PAGAMENTO_DE_FATURA.some((t) => d.includes(t));
}

// O crédito que o cartão põe na conta.
export function ehCreditoDoCartaoNaConta(descricao: string): boolean {
  const d = semAcento(descricao);
  return d.includes('valor adicionado') && d.includes('credito');
}

// Marca como transferência os pares "crédito do cartão na conta" + saída de mesmo valor, na mesma conta, no mesmo
// dia ou até dois dias depois. Só olha créditos que ainda não são transferência: depois de marcado, o par não é
// mais revisto, e o que a pessoa desmarcar à mão na saída fica como ela deixou.
// Precisa rodar dentro do perfil financeiro (comPerfil). Devolve quantos pares marcou.
export async function marcarPixNoCreditoNasContas(contaIds: number[], desde: Date): Promise<number> {
  if (contaIds.length === 0) return 0;
  const lancamentos = await prisma.transacao.findMany({
    where: {
      contaId: { in: contaIds },
      transferencia: false,
      data: { gte: new Date(desde.getTime() - 3 * DIA_MS) },
      conta: { tipo: { not: 'CARTAO' } },
    },
    orderBy: [{ data: 'asc' }, { id: 'asc' }],
    select: { id: true, contaId: true, data: true, descricao: true, valor: true, tipo: true },
  });
  const creditos = lancamentos.filter((l) => l.tipo === 'RECEITA' && ehCreditoDoCartaoNaConta(l.descricao));
  if (creditos.length === 0) return 0;
  const saidas = lancamentos.filter((l) => l.tipo === 'DESPESA');
  const usadas = new Set<number>();
  const ids: number[] = [];
  let pares = 0;
  for (const credito of creditos) {
    let melhor: (typeof saidas)[number] | null = null;
    let melhorNota = Infinity;
    for (const saida of saidas) {
      if (usadas.has(saida.id) || saida.contaId !== credito.contaId) continue;
      if (Math.abs(Number(saida.valor) - Number(credito.valor)) > 0.005) continue;
      const dias = Math.round((saida.data.getTime() - credito.data.getTime()) / DIA_MS);
      if (dias < 0 || dias > 2) continue;
      // Prefere o dia mais próximo e, no empate, a saída que fala em Pix.
      const nota = dias + (/\bpix\b/.test(semAcento(saida.descricao)) ? 0 : 0.5);
      if (nota < melhorNota) {
        melhor = saida;
        melhorNota = nota;
      }
    }
    if (melhor) {
      usadas.add(melhor.id);
      ids.push(credito.id, melhor.id);
      pares++;
    } else if (Date.now() - credito.data.getTime() > 3 * DIA_MS) {
      // Sem saída de mesmo valor (o Pix saiu com outro valor ou por outra conta): o crédito sozinho continua
      // não sendo receita, é dinheiro do cartão. Espera 3 dias para dar tempo de a saída chegar e casar.
      ids.push(credito.id);
    }
  }
  if (ids.length > 0) {
    await prisma.transacao.updateMany({ where: { id: { in: ids } }, data: { transferencia: true } });
  }
  return pares;
}
