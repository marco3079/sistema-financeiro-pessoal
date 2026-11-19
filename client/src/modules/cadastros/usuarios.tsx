import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useDados } from '../../lib/useDados';
import type { PerfilDTO } from '../../lib/perfilFinanceiro';
import {
  Aviso,
  Avatar,
  Botao,
  Campo,
  Carregando,
  MenuAcoes,
  Modal,
  Pagina,
  Selecao,
  Selo,
  Tabela,
  formatarData,
} from '../../ui';
import type { AcaoMenu } from '../../ui';
import { Icone } from '../../ui/icones';
import type { NomeIcone } from '../../ui/icones';
import { mensagemErro, queryString, rotuloPerfil } from './tipos';
import type { AcessoUsuarioDTO, UsuarioDTO } from './tipos';
import { FichaUsuario, SeloPerfilUsuario } from './FichaUsuario';

// Filtro de perfil da tela (rótulos em português; TI é perfil próprio).
const PERFIS_FILTRO: { valor: string; rotulo: string }[] = [
  { valor: 'TITULAR', rotulo: 'Titular' },
  { valor: 'LEITOR', rotulo: 'Membro' },
];

// Tipos de acesso que se criam por esta tela.
const TIPOS_DE_ACESSO: { valor: string; rotulo: string }[] = [
  { valor: 'TITULAR', rotulo: 'Titular (todos os perfis, administra o sistema)' },
  { valor: 'LEITOR', rotulo: 'Membro (só os perfis liberados)' },
];

// ---------- Acessos do membro aos perfis financeiros ----------

type MapaAcessos = Record<number, '' | 'LEITURA' | 'EDICAO'>;

const OPCOES_NIVEL = [
  { valor: 'LEITURA', rotulo: 'Somente leitura' },
  { valor: 'EDICAO', rotulo: 'Edição' },
];

function mapaDe(acessos: AcessoUsuarioDTO[] | undefined): MapaAcessos {
  const mapa: MapaAcessos = {};
  for (const a of acessos ?? []) mapa[a.perfilFinanceiroId] = a.nivel;
  return mapa;
}

function listaDe(mapa: MapaAcessos): AcessoUsuarioDTO[] {
  return Object.entries(mapa)
    .filter(([, nivel]) => nivel !== '')
    .map(([id, nivel]) => ({ perfilFinanceiroId: Number(id), nivel: nivel as 'LEITURA' | 'EDICAO' }));
}

// Um seletor por perfil financeiro: sem acesso, somente leitura ou edição.
function EditorAcessos({
  perfis,
  valor,
  aoMudar,
}: {
  perfis: PerfilDTO[];
  valor: MapaAcessos;
  aoMudar: (v: MapaAcessos) => void;
}) {
  return (
    <fieldset className="usuarios-acessos">
      <legend>Perfis financeiros que pode acessar</legend>
      {perfis.map((p) => (
        <Selecao
          key={p.id}
          rotulo={p.nome}
          valor={valor[p.id] ?? ''}
          vazio="Sem acesso"
          opcoes={OPCOES_NIVEL}
          aoMudar={(v) => aoMudar({ ...valor, [p.id]: v as MapaAcessos[number] })}
        />
      ))}
      <p className="usuarios-ajuda">
        Edição permite lançar e alterar os dados do perfil e também gerenciar os acessos e a senha dele.
      </p>
    </fieldset>
  );
}

// Resumo dos acessos para a tabela.
function textoAcessos(u: UsuarioDTO, perfis: PerfilDTO[] | null): string {
  if (u.perfil === 'TITULAR') return 'Todos os perfis';
  const lista = u.acessos ?? [];
  if (lista.length === 0) return 'Nenhum perfil';
  return lista
    .map((a) => {
      const nome = perfis?.find((p) => p.id === a.perfilFinanceiroId)?.nome ?? 'Perfil ' + a.perfilFinanceiroId;
      return nome + (a.nivel === 'EDICAO' ? ' (edição)' : ' (leitura)');
    })
    .join(', ');
}

// ---------- Criar usuário ----------

function FormNovoUsuario({ aoConcluir }: { aoConcluir: () => void }) {
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [perfil, setPerfil] = useState('TITULAR');
  const [acessos, setAcessos] = useState<MapaAcessos>({});
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const { dados: perfisFinanceiros } = useDados<PerfilDTO[]>('/perfis');

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (perfil === 'LEITOR' && listaDe(acessos).length === 0) {
      setErro('Escolha pelo menos um perfil financeiro que o membro pode acessar');
      return;
    }
    setOcupado(true);
    try {
      await api.post('/usuarios', {
        nome: nome.trim(),
        email: email.trim(),
        senha,
        perfil,
        acessos: perfil === 'LEITOR' ? listaDe(acessos) : [],
      });
      aoConcluir();
    } catch (err) {
      setErro(mensagemErro(err));
      setOcupado(false);
    }
  }

  return (
    <form onSubmit={salvar}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <Campo rotulo="Nome" valor={nome} aoMudar={setNome} obrigatorio />
      <Campo rotulo="E-mail" tipo="email" valor={email} aoMudar={setEmail} obrigatorio />
      <Campo
        rotulo="Senha inicial (mínimo 6 caracteres)"
        tipo="password"
        valor={senha}
        aoMudar={setSenha}
        obrigatorio
      />
      <Selecao
        rotulo="Tipo de acesso"
        valor={perfil}
        aoMudar={setPerfil}
        opcoes={TIPOS_DE_ACESSO}
        obrigatorio
      />
      {perfil === 'LEITOR' && (
        <EditorAcessos perfis={perfisFinanceiros ?? []} valor={acessos} aoMudar={setAcessos} />
      )}
      <div className="pagina-acoes">
        <Botao tipo="submit" desabilitado={ocupado}>
          Criar usuário
        </Botao>
      </div>
    </form>
  );
}

// ---------- Detalhe: ativar/desativar e redefinir senha (Editar e Redefinir senha) ----------

function DetalheUsuario({
  usuario,
  aoAtualizado,
}: {
  usuario: UsuarioDTO;
  aoAtualizado: (u: UsuarioDTO) => void;
}) {
  const [novaSenha, setNovaSenha] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [papel, setPapel] = useState(usuario.perfil);
  const [acessos, setAcessos] = useState<MapaAcessos>(() => mapaDe(usuario.acessos));
  const { dados: perfisFinanceiros } = useDados<PerfilDTO[]>('/perfis');

  async function salvarAcessos(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setSucesso(null);
    if (papel === 'LEITOR' && listaDe(acessos).length === 0) {
      setErro('Escolha pelo menos um perfil financeiro que o membro pode acessar');
      return;
    }
    setOcupado(true);
    try {
      const atualizado = await api.put<UsuarioDTO>('/usuarios/' + usuario.id, {
        perfil: papel,
        acessos: papel === 'LEITOR' ? listaDe(acessos) : [],
      });
      aoAtualizado(atualizado);
      setSucesso('Acessos salvos.');
    } catch (err) {
      setErro(mensagemErro(err));
    } finally {
      setOcupado(false);
    }
  }

  async function alternarAtivo() {
    const proximo = !usuario.ativo;
    if (!proximo && !window.confirm(`Desativar o usuário ${usuario.nome}?`)) return;
    setErro(null);
    setSucesso(null);
    setOcupado(true);
    try {
      const atualizado = await api.put<UsuarioDTO>(`/usuarios/${usuario.id}`, { ativo: proximo });
      aoAtualizado(atualizado);
    } catch (err) {
      setErro(mensagemErro(err));
    } finally {
      setOcupado(false);
    }
  }

  async function redefinir(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setSucesso(null);
    setOcupado(true);
    try {
      await api.post(`/usuarios/${usuario.id}/redefinir-senha`, { novaSenha });
      setNovaSenha('');
      setSucesso('Senha redefinida.');
    } catch (err) {
      setErro(mensagemErro(err));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {sucesso && <Aviso tipo="sucesso">{sucesso}</Aviso>}
      <p>
        <strong>Perfil:</strong> {rotuloPerfil(usuario.perfil)}
      </p>
      <p>
        <strong>E-mail:</strong> {usuario.email}
      </p>
      <p>
        <strong>Situação:</strong> {usuario.ativo ? 'Ativo' : 'Inativo'}
      </p>
      <p>
        <strong>Verificação em duas etapas:</strong> {usuario.totpAtivo ? 'ativa' : 'desligada'}
      </p>
      <div className="pagina-acoes">
        <Botao
          variante={usuario.ativo ? 'perigo' : 'primario'}
          desabilitado={ocupado}
          aoClicar={alternarAtivo}
        >
          {usuario.ativo ? 'Desativar' : 'Ativar'}
        </Botao>
      </div>

      <form onSubmit={salvarAcessos}>
        <h3 className="cartao-titulo">Papel e acessos</h3>
        <Selecao rotulo="Papel" valor={papel} aoMudar={setPapel} opcoes={TIPOS_DE_ACESSO} obrigatorio />
        {papel === 'LEITOR' && (
          <EditorAcessos perfis={perfisFinanceiros ?? []} valor={acessos} aoMudar={setAcessos} />
        )}
        <div className="pagina-acoes">
          <Botao tipo="submit" desabilitado={ocupado}>
            Salvar acessos
          </Botao>
        </div>
      </form>

      <form onSubmit={redefinir}>
        <h3 className="cartao-titulo">Redefinir senha</h3>
        <Campo
          rotulo="Nova senha (mínimo 6 caracteres)"
          tipo="password"
          valor={novaSenha}
          aoMudar={setNovaSenha}
          obrigatorio
        />
        <div className="pagina-acoes">
          <Botao tipo="submit" desabilitado={ocupado}>
            Redefinir senha
          </Botao>
        </div>
      </form>
    </div>
  );
}

// ---------- Fileira de resumo ----------

function ResumoItem({
  icone,
  cor,
  valor,
  rotulo,
}: {
  icone: NomeIcone;
  cor: 'azul' | 'roxo' | 'verde' | 'vermelho';
  valor: number;
  rotulo: string;
}) {
  return (
    <div className="resumo-item">
      <span className={`resumo-icone resumo-icone-${cor}`} aria-hidden="true">
        <Icone nome={icone} tamanho={24} />
      </span>
      <div>
        <span className="resumo-valor">{valor}</span>
        <span className="resumo-rotulo">{rotulo}</span>
      </div>
    </div>
  );
}

// ---------- Lista (somente TITULAR) ----------

export function Usuarios() {
  const [perfil, setPerfil] = useState('');
  const [busca, setBusca] = useState('');
  const [novo, setNovo] = useState(false);
  const [editando, setEditando] = useState<UsuarioDTO | null>(null);
  const [ficha, setFicha] = useState<number | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const { usuario } = useAuth();
  const { dados: perfisFinanceiros } = useDados<PerfilDTO[]>('/perfis');
  const { dados, carregando, erro, recarregar } = useDados<UsuarioDTO[]>(
    `/usuarios${queryString({ perfil, busca: busca.trim() })}`
  );

  async function alternarAtivoLista(u: UsuarioDTO, ativo: boolean) {
    if (!ativo && !window.confirm(`Desativar o usuário ${u.nome}?`)) return;
    setErroAcao(null);
    try {
      await api.put(`/usuarios/${u.id}`, { ativo });
      recarregar();
    } catch (e) {
      setErroAcao(mensagemErro(e));
    }
  }

  // Ações do menu de três pontos. Não há desativar para o próprio usuário logado.
  function acoesDo(u: UsuarioDTO): AcaoMenu[] {
    const acoes: AcaoMenu[] = [
      { rotulo: 'Ver ficha', icone: 'perfil', aoClicar: () => setFicha(u.id) },
      { rotulo: 'Editar acessos', icone: 'lapis', aoClicar: () => setEditando(u) },
      { rotulo: 'Redefinir senha', icone: 'cadeado', aoClicar: () => setEditando(u) },
    ];
    if (u.id !== usuario?.id) {
      if (u.ativo) {
        acoes.push({
          rotulo: 'Desativar',
          icone: 'fechar',
          perigo: true,
          aoClicar: () => alternarAtivoLista(u, false),
        });
      } else {
        acoes.push({
          rotulo: 'Reativar',
          icone: 'perfil',
          aoClicar: () => alternarAtivoLista(u, true),
        });
      }
    }
    return acoes;
  }

  const lista = dados ?? [];
  const ativos = lista.filter((u) => u.ativo).length;
  const administradores = lista.filter((u) => u.perfil === 'TITULAR').length;

  return (
    <Pagina titulo="Usuários">
      <div className="barra-ferramentas">
        <div className="filtros">
          <Selecao
            rotulo="Perfil"
            valor={perfil}
            aoMudar={setPerfil}
            opcoes={PERFIS_FILTRO}
            vazio="Todos"
          />
          <Campo rotulo="Buscar por nome ou e-mail" valor={busca} aoMudar={setBusca} />
        </div>
        <Botao aoClicar={() => setNovo(true)}>Novo usuário</Botao>
      </div>

      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {erroAcao && <Aviso tipo="erro">{erroAcao}</Aviso>}

      {dados && (
        <div className="resumo">
          <ResumoItem icone="usuarios" cor="azul" valor={lista.length} rotulo="Usuários" />
          <ResumoItem icone="perfil" cor="verde" valor={ativos} rotulo="Ativos" />
          <ResumoItem icone="relogio" cor="vermelho" valor={lista.length - ativos} rotulo="Inativos" />
          <ResumoItem icone="cadeado" cor="roxo" valor={administradores} rotulo="Titulares" />
        </div>
      )}

      {carregando && <Carregando />}
      {dados && (
        <Tabela<UsuarioDTO>
          chave={(u) => u.id}
          dados={dados}
          vazio="Nenhum usuário encontrado."
          aoClicarLinha={(u) => setFicha(u.id)}
          colunas={[
            {
              titulo: 'Usuário',
              celula: (u) => (
                <span className="usuario-celula">
                  <Avatar nome={u.nome} tamanho={36} />
                  <span>
                    <span>{u.nome}</span>
                    <span className="usuario-email">{u.email}</span>
                  </span>
                </span>
              ),
            },
            { titulo: 'Papel', celula: (u) => <SeloPerfilUsuario perfil={u.perfil} /> },
            { titulo: 'Perfis financeiros', celula: (u) => textoAcessos(u, perfisFinanceiros) },
            {
              titulo: 'Duas etapas',
              celula: (u) => (u.totpAtivo ? <Selo cor="verde">ATIVA</Selo> : <Selo cor="cinza">DESLIGADA</Selo>),
            },
            { titulo: 'Telefone', celula: (u) => u.telefone ?? '—' },
            { titulo: 'Cadastro', celula: (u) => formatarData(u.criadoEm) },
            {
              titulo: 'Situação',
              celula: (u) =>
                u.ativo ? <Selo cor="verde">ATIVO</Selo> : <Selo cor="vermelho">INATIVO</Selo>,
            },
            {
              titulo: 'Ações',
              acoes: true,
              celula: (u) => <MenuAcoes rotulo={'Ações de ' + u.nome} acoes={acoesDo(u)} />,
            },
          ]}
        />
      )}

      {ficha !== null && dados?.find((x) => x.id === ficha) && (
        <FichaUsuario
          key={ficha}
          usuario={dados.find((x) => x.id === ficha) as UsuarioDTO}
          aoFechar={() => setFicha(null)}
          aoEditar={() => {
            const u = dados.find((x) => x.id === ficha) ?? null;
            setFicha(null);
            if (u) setEditando(u);
          }}
        />
      )}

      <Modal aberto={novo} titulo="Novo usuário" aoFechar={() => setNovo(false)}>
        {novo && (
          <FormNovoUsuario
            aoConcluir={() => {
              setNovo(false);
              recarregar();
            }}
          />
        )}
      </Modal>

      <Modal
        aberto={editando !== null}
        titulo={editando ? editando.nome : 'Usuário'}
        aoFechar={() => setEditando(null)}
      >
        {editando && (
          <DetalheUsuario
            key={editando.id}
            usuario={editando}
            aoAtualizado={(u) => {
              setEditando(u);
              recarregar();
            }}
          />
        )}
      </Modal>
    </Pagina>
  );
}
