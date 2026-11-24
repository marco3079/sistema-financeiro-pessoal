import type { RotaModulo } from '../../lib/rotas';
import { Titulos } from './Titulos';

export const rotas: RotaModulo[] = [
  {
    caminho: '/app/empresa/pagar',
    rotulo: 'Contas a pagar',
    icone: 'seta-baixo',
    perfis: ['TITULAR'],
    elemento: <Titulos natureza="PAGAR" />,
    ordem: 21,
  },
  {
    caminho: '/app/empresa/receber',
    rotulo: 'Contas a receber',
    icone: 'seta-cima',
    perfis: ['TITULAR'],
    elemento: <Titulos natureza="RECEBER" />,
    ordem: 22,
  },
];
