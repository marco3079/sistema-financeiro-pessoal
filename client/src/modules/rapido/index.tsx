import type { RotaModulo } from '../../lib/rotas';
import { Rapido } from './Rapido';

export const rotas: RotaModulo[] = [
  { caminho: '/app/rapido', rotulo: 'Lançar rápido', icone: 'raio', perfis: ['TITULAR'], elemento: <Rapido />, ordem: 15 },
];
