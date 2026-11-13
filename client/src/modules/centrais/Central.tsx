import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { Pagina } from '../../ui';
import { Vazio } from '../../ui/financas';
import { atalhoLiberado } from './atalhos';
import type { Atalho } from './atalhos';
import './centrais.css';

// Página de atalhos. Mostra só as telas que o perfil do usuário pode abrir.
export function Central({ titulo, texto, atalhos }: { titulo: string; texto: string; atalhos: Atalho[] }) {
  const { usuario } = useAuth();
  const visiveis = usuario ? atalhos.filter((a) => atalhoLiberado(a.caminho, usuario.perfil)) : [];

  return (
    <Pagina titulo={titulo}>
      <p className="central-texto">{texto}</p>
      {visiveis.length === 0 ? (
        <Vazio icone="cadeado" titulo="Nenhuma tela disponível" texto="Seu perfil não tem acesso às telas desta página." />
      ) : (
        <div className="central-grade">
          {visiveis.map((a) => (
            <Link key={a.caminho} to={a.caminho} className="central-atalho">
              <strong className="central-atalho-titulo">{a.titulo}</strong>
              <span className="central-atalho-texto">{a.texto}</span>
            </Link>
          ))}
        </div>
      )}
    </Pagina>
  );
}
