import { useEffect } from 'react';
import { useAuth } from '../lib/auth';
import { CHAVE_PERFIL, trocarDePerfil } from '../lib/perfilFinanceiro';
import type { PerfilDTO } from '../lib/perfilFinanceiro';
import { usePlataforma } from '../lib/plataforma';
import { Icone } from '../ui/icones';
import { BotaoTema } from './Layout';
import { marcarEscolhido } from '../lib/escolhaDePerfil';
import './escolher-perfil.css';

// Tela cheia "Quem está usando?": um cartão grande por perfil financeiro, com a inicial e a cor do perfil.
// Aparece depois do login (quando há mais de um perfil) e ao tocar no seletor de perfil do topo.

function inicial(nome: string): string {
  const letra = nome.trim().charAt(0);
  return letra ? letra.toUpperCase() : '?';
}

export function EscolherPerfil({
  perfis,
  podeGerenciar,
  aoFechar,
}: {
  perfis: PerfilDTO[];
  podeGerenciar: boolean;
  aoFechar: () => void; // segue no perfil atual, sem recarregar
}) {
  const { sair, usuario } = useAuth();
  const { plataforma, logoSrc } = usePlataforma();

  // Esc fecha (fica no perfil atual).
  useEffect(() => {
    function tecla(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        marcarEscolhido();
        aoFechar();
      }
    }
    document.addEventListener('keydown', tecla);
    return () => document.removeEventListener('keydown', tecla);
  }, [aoFechar]);

  function escolher(p: PerfilDTO) {
    marcarEscolhido();
    if (p.atual) {
      aoFechar();
      return;
    }
    trocarDePerfil(p.id); // grava o perfil e recarrega o app nele
  }

  function gerenciar() {
    marcarEscolhido();
    try {
      // Garante um perfil gravado antes de ir para a tela de perfis.
      const atual = perfis.find((p) => p.atual);
      if (atual && !localStorage.getItem(CHAVE_PERFIL)) localStorage.setItem(CHAVE_PERFIL, String(atual.id));
    } catch {
      // segue sem gravar
    }
    window.location.assign('/app/perfis');
  }

  return (
    <main className="escolha-perfil">
      <header className="escolha-perfil-topo">
        <span className="escolha-perfil-marca">
          <img src={logoSrc} alt="" width={32} height={32} />
          {plataforma.nome}
        </span>
        <BotaoTema />
      </header>

      <div className="escolha-perfil-centro">
        <h1 className="escolha-perfil-titulo">Quem está usando?</h1>
        <ul className="escolha-perfil-lista">
          {perfis.map((p) => (
            <li key={p.id}>
              <button type="button" className="escolha-perfil-item" onClick={() => escolher(p)} aria-label={`Abrir o perfil ${p.nome}`}>
                <span className="escolha-perfil-avatar" style={{ background: p.cor }} aria-hidden="true">
                  {inicial(p.nome)}
                  {p.protegido && (
                    <span className="escolha-perfil-cadeado">
                      <Icone nome="cadeado" tamanho={16} />
                    </span>
                  )}
                </span>
                <span className="escolha-perfil-nome">{p.nome}</span>
              </button>
            </li>
          ))}
          {podeGerenciar && (
            <li>
              <button type="button" className="escolha-perfil-item" onClick={gerenciar} aria-label="Criar um perfil novo">
                <span className="escolha-perfil-avatar escolha-perfil-avatar-novo" aria-hidden="true">
                  <Icone nome="somar" tamanho={40} />
                </span>
                <span className="escolha-perfil-nome">Novo perfil</span>
              </button>
            </li>
          )}
        </ul>

        <div className="escolha-perfil-acoes">
          {podeGerenciar && (
            <button type="button" className="escolha-perfil-botao" onClick={gerenciar}>
              Gerenciar perfis
            </button>
          )}
          <button type="button" className="escolha-perfil-botao" onClick={sair}>
            Sair
          </button>
        </div>
        {usuario && <p className="escolha-perfil-conta">Conectado como {usuario.email}</p>}
      </div>
    </main>
  );
}
