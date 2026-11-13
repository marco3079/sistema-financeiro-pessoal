import type { RotaModulo } from '../../lib/rotas';
import { Avisos } from './Avisos';

export const rotas: RotaModulo[] = [
  { caminho: '/app/avisos', rotulo: 'Avisos', icone: 'sino', perfis: ['TITULAR'], elemento: <Avisos />, ordem: 95, menu: false },
];
