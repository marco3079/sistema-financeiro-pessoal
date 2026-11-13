import type { RotaModulo } from '../../lib/rotas';
import { Seguranca } from './Seguranca';

export const rotas: RotaModulo[] = [
  { caminho: '/app/seguranca', rotulo: 'Segurança', icone: 'cadeado', perfis: ['TITULAR'], elemento: <Seguranca />, ordem: 99 },
];
