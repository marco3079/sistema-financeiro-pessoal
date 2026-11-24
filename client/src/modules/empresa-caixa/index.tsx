import type { RotaModulo } from '../../lib/rotas';
import { Dre } from './Dre';
import { Fluxo } from './Fluxo';
import './caixa.css';

export const rotas: RotaModulo[] = [
  { caminho: '/app/empresa/fluxo', rotulo: 'Fluxo de caixa', icone: 'grafico', perfis: ['TITULAR'], elemento: <Fluxo />, ordem: 23 },
  { caminho: '/app/empresa/dre', rotulo: 'DRE', icone: 'documento', perfis: ['TITULAR'], elemento: <Dre />, ordem: 24 },
];
