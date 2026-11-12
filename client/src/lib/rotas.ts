import type { ReactNode } from 'react';
import type { Perfil } from './tipos';
import type { NomeIcone } from '../ui/icones';

export interface RotaModulo {
  caminho: string; // ex.: '/admin/alunos' ou '/professor/diario/:turmaId'
  rotulo: string; // texto do menu
  icone: NomeIcone; // nome de um ícone de ui/icones
  perfis: Perfil[];
  elemento: ReactNode;
  menu?: boolean; // padrão true; false para telas de detalhe
  ordem?: number; // posição no menu (menor primeiro); padrão 100
}
