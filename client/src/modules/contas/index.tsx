import type { RotaModulo } from '../../lib/rotas';
import { Contas } from './Contas';

export const rotas: RotaModulo[] = [
  { caminho: '/app/contas', rotulo: 'Contas', icone: 'contas', perfis: ['TITULAR'], elemento: <Contas />, ordem: 10 },
];
