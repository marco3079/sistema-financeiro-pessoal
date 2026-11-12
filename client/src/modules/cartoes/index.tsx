import type { RotaModulo } from '../../lib/rotas';
import { Cartoes } from './Cartoes';

export const rotas: RotaModulo[] = [
  { caminho: '/app/cartoes', rotulo: 'Cartões', icone: 'cartao', perfis: ['TITULAR'], elemento: <Cartoes />, ordem: 30 },
];
