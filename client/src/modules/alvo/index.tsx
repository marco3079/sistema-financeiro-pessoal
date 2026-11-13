import type { RotaModulo } from '../../lib/rotas';
import { Alvo } from './Alvo';

export const rotas: RotaModulo[] = [
  { caminho: '/app/alvo', rotulo: 'Carteira-alvo', icone: 'investimentos', perfis: ['TITULAR'], elemento: <Alvo />, ordem: 39, menu: false },
];
