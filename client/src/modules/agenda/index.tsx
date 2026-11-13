import type { RotaModulo } from '../../lib/rotas';
import { Agenda } from './Agenda';

export const rotas: RotaModulo[] = [
  { caminho: '/app/agenda', rotulo: 'Contas a pagar', icone: 'calendario', perfis: ['TITULAR'], elemento: <Agenda />, ordem: 26 },
];
