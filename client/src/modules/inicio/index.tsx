import { Painel } from '../../layout/Painel';
import { useAcessoPerfil } from '../../lib/acessoPerfil';
import type { RotaModulo } from '../../lib/rotas';
import { PainelEmpresa } from '../empresa-painel/PainelEmpresa';

// Tela inicial: o perfil do tipo Empresa tem o painel próprio (a receber, a pagar, vencidos e resultado).
function Inicio() {
  const { atual } = useAcessoPerfil();
  return atual?.tipo === 'EMPRESA' ? <PainelEmpresa /> : <Painel />;
}

export const rotas: RotaModulo[] = [
  {
    caminho: '/app',
    rotulo: 'Início',
    icone: 'inicio',
    perfis: ['TITULAR'],
    elemento: <Inicio />,
    ordem: 0,
  },
];
