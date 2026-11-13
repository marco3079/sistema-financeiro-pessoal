import { useEffect } from 'react';
import { Link, matchPath, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { api } from './lib/api';
import { useAuth } from './lib/auth';
import { caminhoDoPerfil, Layout } from './layout/Layout';
import { Login } from './layout/Login';
import { EsqueciSenha } from './layout/EsqueciSenha';
import { RedefinirSenha } from './layout/RedefinirSenha';
import { Pagina } from './ui';
import type { RotaModulo } from './lib/rotas';
import type { Perfil } from './lib/tipos';

// Junta as rotas de todos os módulos em src/modules/<modulo>/index.tsx
const modulos = import.meta.glob<{ rotas: RotaModulo[] }>('./modules/*/index.tsx', {
  eager: true,
});

const ROTAS: RotaModulo[] = Object.values(modulos)
  .flatMap((m) => m.rotas)
  .sort((a, b) => (a.ordem ?? 100) - (b.ordem ?? 100));

// Telas que o LEITOR (somente leitura) não abre nem vê no menu. O servidor também recusa as consultas delas.
const CAMINHOS_SO_TITULAR = [
  "/app/usuarios",
  "/app/configuracoes",
  "/app/logs",
  "/app/atividades",
  "/app/perfis",
  "/app/ia",
  "/app/drive",
  "/app/atualizacao",
  "/app/seguranca",
  "/app/entrada",
  "/app/importar",
  "/app/rapido",
  "/app/regras",
  "/app/cupom",
  "/app/avisos",
  "/app/conexoes",
  "/app/central/configuracoes",
];

// Uma rota vale para o perfil se o módulo a libera para TITULAR e, no caso do LEITOR, ela não está na lista acima.
function rotaLiberada(rota: RotaModulo, perfil: Perfil): boolean {
  if (!rota.perfis.includes('TITULAR')) return rota.perfis.includes(perfil);
  if (perfil === 'TITULAR') return true;
  return !CAMINHOS_SO_TITULAR.some((c) => rota.caminho === c || rota.caminho.startsWith(c + '/'));
}

function LayoutDoPerfil() {
  const { usuario } = useAuth();
  if (!usuario) return <Navigate to="/login" replace />;
  const liberadas = ROTAS.filter((r) => rotaLiberada(r, usuario.perfil));
  const menu = liberadas.filter((r) => r.menu !== false);
  // A busca do topo também acha as telas que saíram do menu (menos as que dependem de um item, como a ficha do ativo).
  const telas = liberadas.filter((r) => !r.caminho.includes(':'));
  return <Layout menu={menu} telas={telas} />;
}

function RotaProtegida({ rota, children }: { rota: RotaModulo; children: ReactNode }) {
  const { usuario } = useAuth();
  if (!usuario) return <Navigate to="/login" replace />;
  if (!rotaLiberada(rota, usuario.perfil)) {
    return <Navigate to={caminhoDoPerfil(usuario.perfil)} replace />;
  }
  return <>{children}</>;
}

function Raiz() {
  const { usuario } = useAuth();
  return <Navigate to={usuario ? caminhoDoPerfil(usuario.perfil) : '/login'} replace />;
}

function NaoEncontrada() {
  const { usuario } = useAuth();
  const inicio = usuario ? caminhoDoPerfil(usuario.perfil) : '/login';
  return (
    <Pagina titulo="Página não encontrada">
      <p>O endereço que você abriu não existe.</p>
      <Link className="botao botao-primario" to={inicio}>
        Ir para o início
      </Link>
    </Pagina>
  );
}

// Avisa o servidor a cada troca de tela (para o log de atividades). Falha silenciosa.
function RegistroDeTelas() {
  const { usuario } = useAuth();
  const { pathname } = useLocation();
  const logado = usuario !== null;

  useEffect(() => {
    if (!logado) return;
    const rota = ROTAS.find((r) => matchPath(r.caminho, pathname) !== null);
    if (!rota) return;
    api.post('/logs/tela', { caminho: pathname, titulo: rota.rotulo }).catch(() => undefined);
  }, [pathname, logado]);

  return null;
}

export default function App() {
  return (
    <>
      <RegistroDeTelas />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/esqueci-senha" element={<EsqueciSenha />} />
        <Route path="/redefinir-senha/:token" element={<RedefinirSenha />} />
        <Route path="/" element={<Raiz />} />
        <Route element={<LayoutDoPerfil />}>
          {ROTAS.map((r) => (
            <Route
              key={r.caminho}
              path={r.caminho}
              element={<RotaProtegida rota={r}>{r.elemento}</RotaProtegida>}
            />
          ))}
          <Route path="*" element={<NaoEncontrada />} />
        </Route>
      </Routes>
    </>
  );
}
