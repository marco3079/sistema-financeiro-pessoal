import type { RotaModulo } from '../../lib/rotas';
import { Investimentos } from './Investimentos';

export const rotas: RotaModulo[] = [
  {
    caminho: '/app/investimentos',
    rotulo: 'Investimentos',
    icone: 'investimentos',
    perfis: ['TITULAR'],
    elemento: <Investimentos />,
    ordem: 40,
  },
];
