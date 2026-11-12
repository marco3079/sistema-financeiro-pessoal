import type { RotaModulo } from '../../lib/rotas';
import { Importar } from './Importar';

export const rotas: RotaModulo[] = [
  { caminho: '/app/importar', rotulo: 'Importar', icone: 'importar', perfis: ['TITULAR'], elemento: <Importar />, ordem: 58 },
];
