import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { mensagemErro } from '../lib/financas';
import { guardarDesbloqueio, trocarDePerfil } from '../lib/perfilFinanceiro';
import type { PerfilDTO } from '../lib/perfilFinanceiro';
import { usePlataforma } from '../lib/plataforma';
import { Aviso, Botao, Campo } from '../ui';
import { PontoCor } from '../ui/financas';
import { Icone } from '../ui/icones';
import { BotaoTema } from './Layout';
import './desbloqueio.css';

// Tela no lugar do sistema quando o perfil em uso tem senha e ainda não foi desbloqueado neste login.
export function DesbloquearPerfil({
  perfil,
  outros,
  aoDesbloquear,
}: {
  perfil: PerfilDTO;
  outros: PerfilDTO[];
  aoDesbloquear: () => void;
}) {
  const { sair, usuario } = useAuth();
  const { plataforma, logoSrc } = usePlataforma();
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      const resposta = await api.post<{ token: string | null }>(`/perfis/${perfil.id}/desbloquear`, { senha });
      guardarDesbloqueio(perfil.id, resposta.token);
      aoDesbloquear();
    } catch (err) {
      setErro(mensagemErro(err));
      setEnviando(false);
    }
  }

  return (
    <main className="desbloqueio">
      <div className="desbloqueio-tema">
        <BotaoTema />
      </div>
      <form className="desbloqueio-cartao" onSubmit={enviar}>
        <div className="desbloqueio-marca">
          <img src={logoSrc} alt="" width={40} height={40} />
          <span>{plataforma.nome}</span>
        </div>
        <div className="desbloqueio-icone" aria-hidden="true">
          <Icone nome="cadeado" tamanho={28} />
        </div>
        <h1 className="desbloqueio-titulo">
          <PontoCor cor={perfil.cor} /> {perfil.nome}
        </h1>
        <p className="desbloqueio-apoio">
          Este perfil financeiro é protegido por senha. Ela é pedida uma vez a cada login.
        </p>
        <Campo rotulo="Senha do perfil" tipo="password" valor={senha} aoMudar={setSenha} obrigatorio />
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <div className="desbloqueio-botoes">
          <Botao tipo="submit" desabilitado={enviando || senha === ''}>
            {enviando ? 'Conferindo...' : 'Abrir perfil'}
          </Botao>
          <Botao variante="secundario" aoClicar={sair}>
            Sair
          </Botao>
        </div>

        {outros.length > 0 && (
          <div className="desbloqueio-outros">
            <p className="desbloqueio-outros-titulo">Ou abra outro perfil</p>
            {outros.map((p) => (
              <button key={p.id} type="button" className="desbloqueio-outro" onClick={() => trocarDePerfil(p.id)}>
                <PontoCor cor={p.cor} />
                <span>{p.nome}</span>
                {p.bloqueado && <Icone nome="cadeado" tamanho={16} />}
              </button>
            ))}
          </div>
        )}
        {usuario && <p className="desbloqueio-conta">Conectado como {usuario.email}</p>}
      </form>
    </main>
  );
}

// Membro sem nenhum perfil liberado.
export function SemPerfil() {
  const { sair, usuario } = useAuth();
  return (
    <main className="desbloqueio">
      <div className="desbloqueio-cartao">
        <div className="desbloqueio-icone" aria-hidden="true">
          <Icone nome="cadeado" tamanho={28} />
        </div>
        <h1 className="desbloqueio-titulo">Nenhum perfil liberado</h1>
        <p className="desbloqueio-apoio">
          Sua conta ainda não tem acesso a nenhum perfil financeiro. Peça ao titular para liberar o acesso.
        </p>
        <div className="desbloqueio-botoes">
          <Botao variante="secundario" aoClicar={sair}>
            Sair
          </Botao>
        </div>
        {usuario && <p className="desbloqueio-conta">Conectado como {usuario.email}</p>}
      </div>
    </main>
  );
}
