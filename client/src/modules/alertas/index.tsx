import type { RotaModulo } from '../../lib/rotas';
import { Alertas } from './Alertas';

export const rotas: RotaModulo[] = [
  { caminho: '/app/alertas', rotulo: 'Cobranças estranhas', icone: 'sino', perfis: ['TITULAR'], elemento: <Alertas />, ordem: 23 },
];
