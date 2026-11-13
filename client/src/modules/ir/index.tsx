import type { RotaModulo } from '../../lib/rotas';
import { ImpostoRenda } from './IR';

export const rotas: RotaModulo[] = [
  {
    caminho: '/app/ir',
    rotulo: 'Imposto de renda',
    icone: 'investimentos',
    perfis: ['TITULAR'],
    elemento: <ImpostoRenda />,
    ordem: 43,
    menu: false,
  },
];
