import type { RotaModulo } from '../../lib/rotas';
import { AcessoSeguro } from './AcessoSeguro';

export const rotas: RotaModulo[] = [
  { caminho: '/app/acesso-seguro', rotulo: 'Acesso seguro (HTTPS)', icone: 'cadeado', perfis: ['TITULAR'], elemento: <AcessoSeguro />, menu: false, ordem: 97 },
];
