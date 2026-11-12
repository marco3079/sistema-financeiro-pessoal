import type { RotaModulo } from '../../lib/rotas';
import { ConectarIA } from './ConectarIA';

export const rotas: RotaModulo[] = [
  { caminho: '/app/ia', rotulo: 'Conectar IA', icone: 'conexoes', perfis: ['TITULAR'], elemento: <ConectarIA />, ordem: 60 },
];
