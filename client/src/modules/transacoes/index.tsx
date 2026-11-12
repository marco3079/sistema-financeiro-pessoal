import type { RotaModulo } from '../../lib/rotas';
import { Categorias } from './Categorias';
import { Lancamentos } from './Lancamentos';

export const rotas: RotaModulo[] = [
  {
    caminho: '/app/transacoes',
    rotulo: 'Lançamentos',
    icone: 'transacoes',
    perfis: ['TITULAR'],
    elemento: <Lancamentos />,
    ordem: 20,
  },
  {
    caminho: '/app/categorias',
    rotulo: 'Categorias',
    icone: 'categorias',
    perfis: ['TITULAR'],
    elemento: <Categorias />,
    ordem: 54,
  },
];
