import type { RotaModulo } from '../../lib/rotas';
import { ReformaTributaria } from './ReformaTributaria';

export const rotas: RotaModulo[] = [
  {
    caminho: '/app/reforma-tributaria',
    rotulo: 'Reforma tributária',
    icone: 'documento',
    perfis: ['TITULAR'],
    elemento: <ReformaTributaria />,
    ordem: 44,
  },
];
