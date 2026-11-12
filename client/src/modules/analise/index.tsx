import type { RotaModulo } from '../../lib/rotas';
import { Analise } from './Analise';

export const rotas: RotaModulo[] = [
  { caminho: '/app/analise', rotulo: 'Análise', icone: 'transacoes', perfis: ['TITULAR'], elemento: <Analise />, ordem: 22 },
];
