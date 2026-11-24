// Aviso entre módulos sem import circular: a sincronização (Open Finance, bancos diretos) avisa que gravou dados
// novos, e o verificador de notificações roda na hora, em vez de esperar a próxima rodada de 5 minutos.

type Ouvinte = () => void;

const ouvintes = new Set<Ouvinte>();

export function aoChegarNovidade(ouvinte: Ouvinte): void {
  ouvintes.add(ouvinte);
}

export function avisarNovidade(): void {
  for (const ouvinte of ouvintes) {
    try {
      ouvinte();
    } catch (erro) {
      console.error('Falha ao avisar novidade', erro instanceof Error ? erro.message : erro);
    }
  }
}
