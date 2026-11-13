import type { RotaModulo } from '../../lib/rotas';
import { Simulador } from './Simulador';

export const rotas: RotaModulo[] = [
  {
    caminho: '/app/simulador',
    rotulo: 'Simulador',
    icone: 'investimentos',
    perfis: ['TITULAR'],
    elemento: <Simulador />,
    ordem: 44,
    menu: false,
  },
];
