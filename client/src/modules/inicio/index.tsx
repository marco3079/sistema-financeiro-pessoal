import { Painel } from '../../layout/Painel';
import type { RotaModulo } from '../../lib/rotas';

export const rotas: RotaModulo[] = [
  {
    caminho: '/app',
    rotulo: 'Início',
    icone: 'inicio',
    perfis: ['TITULAR'],
    elemento: <Painel />,
    ordem: 0,
  },
];
