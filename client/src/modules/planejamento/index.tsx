import type { RotaModulo } from '../../lib/rotas';
import { Metas } from './Metas';
import { Orcamento } from './Orcamento';
import './planejamento.css';

export const rotas: RotaModulo[] = [
  { caminho: '/app/orcamento', rotulo: 'Orçamento', icone: 'orcamento', perfis: ['TITULAR'], elemento: <Orcamento />, ordem: 40 },
  { caminho: '/app/metas', rotulo: 'Metas', icone: 'metas', perfis: ['TITULAR'], elemento: <Metas />, ordem: 41 },
];
