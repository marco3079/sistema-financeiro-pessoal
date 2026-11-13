import type { RotaModulo } from '../../lib/rotas';
import { Carteira } from './Carteira';

export const rotas: RotaModulo[] = [
  { caminho: '/app/carteira', rotulo: 'Carteira', icone: 'investimentos', perfis: ['TITULAR'], elemento: <Carteira />, ordem: 30 },
];
