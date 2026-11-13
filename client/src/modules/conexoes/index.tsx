import type { RotaModulo } from '../../lib/rotas';
import { Conexoes } from './Conexoes';

export const rotas: RotaModulo[] = [
  { caminho: '/app/conexoes', rotulo: 'Conexões', icone: 'conexoes', perfis: ['TITULAR'], elemento: <Conexoes />, ordem: 60, menu: false },
];
