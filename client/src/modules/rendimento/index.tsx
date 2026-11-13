import type { RotaModulo } from '../../lib/rotas';
import { Rendimento } from './Rendimento';

export const rotas: RotaModulo[] = [
  { caminho: '/app/rendimento', rotulo: 'Rendimento', icone: 'investimentos', perfis: ['TITULAR'], elemento: <Rendimento />, ordem: 42, menu: false },
];
