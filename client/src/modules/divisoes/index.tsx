import type { RotaModulo } from '../../lib/rotas';
import { Divisoes } from './Divisoes';

export const rotas: RotaModulo[] = [
  { caminho: '/app/divisoes', rotulo: 'Divisão de gastos', icone: 'grupo', perfis: ['TITULAR'], elemento: <Divisoes />, ordem: 42 },
];
