import { useAcessoPerfil } from '../lib/acessoPerfil';
import { PontoCor } from '../ui/financas';
import { Icone } from '../ui/icones';
import { abrirEscolhaDePerfil } from '../lib/escolhaDePerfil';
import './seletor-perfil.css';

// Seletor de perfil financeiro no topo: mostra o perfil atual; tocar nele abre a tela cheia "Quem está usando?"
// (EscolherPerfil), onde a pessoa troca de perfil ou vai para Gerenciar perfis.
export function SeletorPerfil() {
  const { perfis: dados } = useAcessoPerfil();
  if (!dados) return null;
  const atual = dados.find((p) => p.atual) ?? dados[0];
  if (!atual) return null;
  const varios = dados.length > 1;

  return (
    <div className="seletor-perfil">
      <button
        type="button"
        className="seletor-perfil-botao"
        aria-label={varios ? `Perfil ${atual.nome}. Trocar de perfil` : `Perfil ${atual.nome}. Gerenciar perfis`}
        onClick={() => (varios ? abrirEscolhaDePerfil() : window.location.assign('/app/perfis'))}
      >
        <PontoCor cor={atual.cor} />
        <span className="seletor-perfil-nome">{atual.nome}</span>
        <span className="seletor-perfil-seta" aria-hidden="true">
          <Icone nome="chevron-baixo" tamanho={16} />
        </span>
      </button>
    </div>
  );
}
