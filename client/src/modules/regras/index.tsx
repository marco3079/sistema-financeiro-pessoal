import type { RotaModulo } from '../../lib/rotas';
import { Regras } from './Regras';

export const rotas: RotaModulo[] = [
  { caminho: '/app/regras', rotulo: 'Regras de categoria', icone: 'categorias', perfis: ['TITULAR'], elemento: <Regras />, ordem: 74, menu: false },
];
