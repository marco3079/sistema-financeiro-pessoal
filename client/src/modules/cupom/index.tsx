import type { RotaModulo } from '../../lib/rotas';
import { Cupom } from './Cupom';

export const rotas: RotaModulo[] = [
  { caminho: '/app/cupom', rotulo: 'Leitura de cupom', icone: 'engrenagem', perfis: ['TITULAR'], elemento: <Cupom />, ordem: 96, menu: false },
];
