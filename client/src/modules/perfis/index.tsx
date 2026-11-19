import type { RotaModulo } from '../../lib/rotas';
import { Perfis } from './Perfis';

export const rotas: RotaModulo[] = [
  { caminho: '/app/perfis', rotulo: 'Perfis financeiros', icone: 'usuarios', perfis: ['TITULAR', 'LEITOR'], elemento: <Perfis />, ordem: 88, menu: false },
];
