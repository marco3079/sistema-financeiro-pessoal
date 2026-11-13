import type { RotaModulo } from '../../lib/rotas';
import { FichaAtivo } from './Ativo';

export const rotas: RotaModulo[] = [
  {
    caminho: '/app/ativo',
    rotulo: 'Ficha do ativo',
    icone: 'investimentos',
    perfis: ['TITULAR'],
    elemento: <FichaAtivo />,
    ordem: 41,
    menu: false,
  },
];
