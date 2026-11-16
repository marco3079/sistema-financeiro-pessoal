import type { RotaModulo } from '../../lib/rotas';
import { Automacoes } from './Automacoes';

export const rotas: RotaModulo[] = [
  { caminho: '/app/automacoes', rotulo: 'Automações', icone: 'raio', perfis: ['TITULAR'], elemento: <Automacoes />, menu: false, ordem: 96 },
];
