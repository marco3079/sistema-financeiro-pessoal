import type { RotaModulo } from '../../lib/rotas';
import { Central } from './Central';
import { ATALHOS_CONFIGURACOES, ATALHOS_DADOS, ATALHOS_INVESTIMENTOS } from './atalhos';

export const rotas: RotaModulo[] = [
  {
    caminho: '/app/central/investimentos',
    rotulo: 'Mais de investimentos',
    icone: 'investimentos',
    perfis: ['TITULAR'],
    elemento: (
      <Central
        titulo="Mais de investimentos"
        texto="Ferramentas de investimento além da carteira."
        atalhos={ATALHOS_INVESTIMENTOS}
      />
    ),
    ordem: 32,
  },
  {
    caminho: '/app/central/dados',
    rotulo: 'Mais de dados',
    icone: 'importar',
    perfis: ['TITULAR'],
    elemento: <Central titulo="Mais de dados" texto="Organize, conecte e guarde os seus dados." atalhos={ATALHOS_DADOS} />,
    ordem: 51,
  },
  {
    caminho: '/app/central/configuracoes',
    rotulo: 'Configurações',
    icone: 'engrenagem',
    perfis: ['TITULAR'],
    elemento: (
      <Central titulo="Configurações" texto="Ajustes do sistema, acessos e registros." atalhos={ATALHOS_CONFIGURACOES} />
    ),
    ordem: 60,
  },
];
