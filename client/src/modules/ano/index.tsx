import type { RotaModulo } from '../../lib/rotas';
import { Ano } from './Ano';

export const rotas: RotaModulo[] = [
  { caminho: '/app/ano', rotulo: 'Visão do ano', icone: 'calendario', perfis: ['TITULAR'], elemento: <Ano />, ordem: 21 },
];
