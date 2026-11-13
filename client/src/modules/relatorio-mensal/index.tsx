import type { RotaModulo } from '../../lib/rotas';
import { RelatorioMensal } from './RelatorioMensal';

export const rotas: RotaModulo[] = [
  { caminho: '/app/relatorio-mensal', rotulo: 'Relatório do mês', icone: 'documento', perfis: ['TITULAR'], elemento: <RelatorioMensal />, ordem: 22 },
];
