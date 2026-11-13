import type { RotaModulo } from '../../lib/rotas';
import { Conciliacao } from './Conciliacao';

export const rotas: RotaModulo[] = [
  { caminho: '/app/conciliacao', rotulo: 'Conciliação', icone: 'cartao', perfis: ['TITULAR'], elemento: <Conciliacao />, ordem: 31 },
];
