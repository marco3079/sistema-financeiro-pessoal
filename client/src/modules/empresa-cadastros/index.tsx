import type { RotaModulo } from '../../lib/rotas';
import { Centros } from './Centros';
import { Parceiros } from './Parceiros';
import './cadastros.css';

export const rotas: RotaModulo[] = [
  {
    caminho: '/app/empresa/parceiros',
    rotulo: 'Clientes e fornecedores',
    icone: 'usuarios',
    perfis: ['TITULAR'],
    elemento: <Parceiros />,
    ordem: 30,
  },
  {
    caminho: '/app/empresa/centros',
    rotulo: 'Centros de custo',
    icone: 'categorias',
    perfis: ['TITULAR'],
    elemento: <Centros />,
    ordem: 27,
  },
];
