import type { RotaModulo } from '../../lib/rotas';
import { Entrada } from './Entrada';

export const rotas: RotaModulo[] = [
  { caminho: '/app/entrada', rotulo: 'Pasta de entrada', icone: 'importar', perfis: ['TITULAR'], elemento: <Entrada />, ordem: 59 },
];
