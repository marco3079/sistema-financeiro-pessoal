import type { RotaModulo } from '../../lib/rotas';
import { Atividades } from './Atividades';
import { LogSistema } from './LogSistema';
import './logs.css';

export const rotas: RotaModulo[] = [
  {
    caminho: '/app/atividades',
    rotulo: 'Atividades',
    icone: 'atividade',
    perfis: ['TITULAR'],
    elemento: <Atividades />,
    ordem: 95,
    menu: false,
  },
  {
    caminho: '/app/logs',
    rotulo: 'Log do sistema',
    icone: 'log',
    perfis: ['TITULAR'],
    elemento: <LogSistema />,
    ordem: 96,
    menu: false,
  },
];
