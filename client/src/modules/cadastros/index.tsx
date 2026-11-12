import type { RotaModulo } from '../../lib/rotas';
import { Usuarios } from './usuarios';
import { MeuPerfil } from './perfil';

export const rotas: RotaModulo[] = [
  {
    caminho: '/app/usuarios',
    rotulo: 'Usuários',
    icone: 'usuarios',
    perfis: ['TITULAR'],
    elemento: <Usuarios />,
    ordem: 70,
  },
  {
    caminho: '/app/perfil',
    rotulo: 'Meu perfil',
    icone: 'perfil',
    perfis: ['TITULAR'],
    elemento: <MeuPerfil />,
    ordem: 90,
  },
];
