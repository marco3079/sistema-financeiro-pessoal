import type { RotaModulo } from '../../lib/rotas';
import { Impostos } from './Impostos';

export const rotas: RotaModulo[] = [
  {
    caminho: '/app/impostos',
    rotulo: 'Impostos',
    icone: 'financeiro',
    perfis: ['TITULAR'],
    elemento: <Impostos />,
    ordem: 43.5,
  },
];
