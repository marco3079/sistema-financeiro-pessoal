import type { RotaModulo } from '../../lib/rotas';
import { StatusServidor } from './StatusServidor';
import './servidor.css';

export const rotas: RotaModulo[] = [
  {
    caminho: '/app/status-servidor',
    rotulo: 'Status do servidor',
    icone: 'grafico',
    perfis: ['TITULAR'],
    elemento: <StatusServidor />,
    menu: false,
    ordem: 98,
  },
];
