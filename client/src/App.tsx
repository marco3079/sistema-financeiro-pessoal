import { useEffect, useState } from 'react';
import { Link, matchPath, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { api } from './lib/api';
import { useAuth } from './lib/auth';
import { caminhoDoPerfil, Layout } from './layout/Layout';
import { Login } from './layout/Login';
import { EsqueciSenha } from './layout/EsqueciSenha';
import { RedefinirSenha } from './layout/RedefinirSenha';
import { DesbloquearPerfil, SemPerfil } from './layout/DesbloquearPerfil';
import { EscolherPerfil } from './layout/EscolherPerfil';
import { aoPedirEscolhaDePerfil, perfilJaEscolhido } from './lib/escolhaDePerfil';
import { Carregando, Pagina } from './ui';
import { AcessoPerfilProvider, useAcessoPerfil } from './lib/acessoPerfil';
import type { NivelPerfil } from './lib/perfilFinanceiro';
import type { RotaModulo } from './lib/rotas';
import type { Perfil } from './lib/tipos';

// Junta as rotas de todos os módulos em src/modules/<modulo>/index.tsx
const modulos = import.meta.glob<{ rotas: RotaModulo[] }>('./modules/*/index.tsx', {
  eager: true,
});

const ROTAS: RotaModulo[] = Object.values(modulos)
  .flatMap((m) => m.rotas)
  .sort((a, b) => (a.ordem ?? 100) - (b.ordem ?? 100));

// Telas que o membro (LEITOR) não abre nem vê no menu, qualquer que seja o nível. O servidor também recusa as consultas delas.
const CAMINHOS_SO_TITULAR = [
  "/app/usuarios",
  "/app/configuracoes",
  "/app/logs",
  "/app/atividades",
  "/app/ia",
  "/app/drive",
  "/app/atualizacao",
  "/app/entrada",
  "/app/automacoes",
  "/app/acesso-seguro",
  "/app/status-servidor",
  "/app/cupom",
  "/app/avisos",
  "/app/conexoes",
  "/app/central/configuracoes",
];

// Telas de lançar dados: o membro só abre com nível Edição no perfil em uso.
const CAMINHOS_DE_EDICAO = ["/app/importar", "/app/rapido", "/app/regras"];

function casa(caminho: string, lista: string[]): boolean {
  return lista.some((c) => caminho === c || caminho.startsWith(c + '/'));
}

// Uma rota vale para o usuário se o módulo a libera para TITULAR e, no caso do membro, ela não está nas listas acima
// (as de edição valem com nível Edição).
function rotaLiberada(rota: RotaModulo, perfil: Perfil, nivel: NivelPerfil | null): boolean {
  if (!rota.perfis.includes('TITULAR')) return rota.perfis.includes(perfil);
  if (perfil === 'TITULAR') return true;
  if (casa(rota.caminho, CAMINHOS_SO_TITULAR)) return false;
  return nivel === 'EDICAO' || !casa(rota.caminho, CAMINHOS_DE_EDICAO);
}

function CascaDoPerfil() {
  const { usuario } = useAuth();
  const { perfis, atual, nivel, erro, recarregar } = useAcessoPerfil();
  // Tela "Quem está usando?": depois do login (com mais de um perfil) e quando o seletor do topo pede.
  const [escolhendo, setEscolhendo] = useState(() => !perfilJaEscolhido());
  useEffect(() => aoPedirEscolhaDePerfil(() => setEscolhendo(true)), []);
  if (!usuario) return <Navigate to="/login" replace />;
  // Primeira carga da lista de perfis: nada na tela por um instante (evita mostrar dados de um perfil bloqueado).
  if (!perfis && !erro) return <Carregando />;
  if (perfis && perfis.length === 0) return <SemPerfil />;
  if (escolhendo && perfis && perfis.length > 1) {
    return <EscolherPerfil perfis={perfis} podeGerenciar={usuario.perfil === 'TITULAR'} aoFechar={() => setEscolhendo(false)} />;
  }
  if (atual?.bloqueado) {
    return <DesbloquearPerfil perfil={atual} outros={(perfis ?? []).filter((p) => p.id !== atual.id)} aoDesbloquear={recarregar} />;
  }
  const liberadas = ROTAS.filter((r) => rotaLiberada(r, usuario.perfil, nivel));
  const menu = liberadas.filter((r) => r.menu !== false);
  // A busca do topo também acha as telas que saíram do menu (menos as que dependem de um item, como a ficha do ativo).
  const telas = liberadas.filter((r) => !r.caminho.includes(':'));
  return <Layout menu={menu} telas={telas} />;
}

function LayoutDoPerfil() {
  const { usuario } = useAuth();
  if (!usuario) return <Navigate to="/login" replace />;
  return (
    <AcessoPerfilProvider key={usuario.id}>
      <CascaDoPerfil />
    </AcessoPerfilProvider>
  );
}

function RotaProtegida({ rota, children }: { rota: RotaModulo; children: ReactNode }) {
  const { usuario } = useAuth();
  const { nivel } = useAcessoPerfil();
  if (!usuario) return <Navigate to="/login" replace />;
  if (!rotaLiberada(rota, usuario.perfil, nivel)) {
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
