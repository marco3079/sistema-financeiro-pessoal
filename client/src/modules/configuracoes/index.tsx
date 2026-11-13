import type { RotaModulo } from '../../lib/rotas';
import { Configuracoes } from './Configuracoes';
import './configuracoes.css';

export const rotas: RotaModulo[] = [
  {
    caminho: '/app/configuracoes',
    rotulo: 'Configurações',
    icone: 'engrenagem',
    perfis: ['TITULAR'],
    elemento: <Configuracoes />,
    ordem: 97,
    menu: false,
  },
];
