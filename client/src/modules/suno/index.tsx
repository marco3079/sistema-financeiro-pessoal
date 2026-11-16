import type { RotaModulo } from '../../lib/rotas';
import { Suno } from './Suno';

export const rotas: RotaModulo[] = [
  { caminho: '/app/suno', rotulo: 'Carteiras Suno', icone: 'investimentos', perfis: ['TITULAR'], elemento: <Suno />, ordem: 40, menu: false },
];
