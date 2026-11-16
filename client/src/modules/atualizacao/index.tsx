import type { RotaModulo } from '../../lib/rotas';
import { Atualizacao } from './Atualizacao';

export const rotas: RotaModulo[] = [
  { caminho: '/app/atualizacao', rotulo: 'Atualização', icone: 'engrenagem', perfis: ['TITULAR'], elemento: <Atualizacao />, ordem: 97, menu: false },
];
