import type { RotaModulo } from '../../lib/rotas';
import { Indicadores } from './Indicadores';
import { Orcado } from './Orcado';
import { Vencidos } from './Vencidos';
import './analise.css';

export const rotas: RotaModulo[] = [
  { caminho: '/app/empresa/vencidos', rotulo: 'Inadimplência e vencidos', icone: 'sino', perfis: ['TITULAR'], elemento: <Vencidos />, ordem: 25 },
  { caminho: '/app/empresa/indicadores', rotulo: 'Indicadores', icone: 'investimentos', perfis: ['TITULAR'], elemento: <Indicadores />, ordem: 26 },
  { caminho: '/app/empresa/orcado', rotulo: 'Orçado x realizado', icone: 'orcamento', perfis: ['TITULAR'], elemento: <Orcado />, ordem: 25.5 },
];
