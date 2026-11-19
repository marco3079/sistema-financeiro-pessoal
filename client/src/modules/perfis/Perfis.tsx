import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { useAcessoPerfil } from '../../lib/acessoPerfil';
import { useAuth } from '../../lib/auth';
import { formatarReais, mensagemErro } from '../../lib/financas';
import { CHAVE_PERFIL, guardarDesbloqueio, NOME_DO_NIVEL, trocarDePerfil } from '../../lib/perfilFinanceiro';
import type { NivelPerfil, PerfilDTO } from '../../lib/perfilFinanceiro';
import { useDados } from '../../lib/useDados';
import { Aviso, Botao, Campo, Cartao, Carregando, Modal, Pagina, Selecao, Selo } from '../../ui';
import { CampoCor, PontoCor } from '../../ui/financas';
import './perfis.css';

const NOME_MAXIMO = 60;

function normalizarNome(texto: string): string {
  return texto.trim().toLowerCase();
}

// ---------- Criar / editar perfil (titular) ----------

function FormPerfil({
  perfil,
  aoSalvo,
}: {
  perfil: PerfilDTO | null;
  aoSalvo: (era: PerfilDTO | null) => void;
}) {
  const [nome, setNome] = useState(perfil?.nome ?? '');
  const [cor, setCor] = useState(perfil?.cor ?? '#2563eb');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const limpo = nome.trim();
    if (limpo === '') {
      setErro('Informe o nome do perfil.');
      return;
    }
    if (limpo.length > NOME_MAXIMO) {
      setErro(`O nome pode ter até ${NOME_MAXIMO} caracteres.`);
      return;
    }
    setOcupado(true);
    try {
      if (perfil) await api.put('/perfis/' + perfil.id, { nome: limpo, cor });
      else await api.post('/perfis', { nome: limpo, cor });
      aoSalvo(perfil);
    } catch (err) {
      setErro(mensagemErro(err));
      setOcupado(false);
    }
  }

  return (
    <form onSubmit={salvar}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <Campo rotulo="Nome" valor={nome} aoMudar={setNome} obrigatorio />
      <CampoCor rotulo="Cor" valor={cor} aoMudar={setCor} />
      <div className="pagina-acoes">
        <Botao tipo="submit" desabilitado={ocupado}>
          Salvar
        </Botao>
      </div>
    </form>
  );
}

// ---------- Senha do perfil ----------

function FormSenhaPerfil({ perfil, aoSalvo }: { perfil: PerfilDTO; aoSalvo: () => void }) {
  const [nova, setNova] = useState('');
  const [repetida, setRepetida] = useState('');
  const [senhaConta, setSenhaConta] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(novaSenha: string | null) {
    setErro(null);
    if (novaSenha !== null) {
      if (novaSenha.length < 4) {
        setErro('A senha do perfil deve ter pelo menos 4 caracteres.');
        return;
      }
      if (novaSenha !== repetida) {
        setErro('As duas senhas não são iguais.');
        return;
      }
    }
    if (senhaConta === '') {
      setErro('Digite a senha da sua conta para confirmar.');
      return;
    }
    setOcupado(true);
    try {
      const resposta = await api.put<{ protegido: boolean; token: string | null }>(`/perfis/${perfil.id}/senha`, {
        senhaConta,
        novaSenha,
      });
      // Quem trocou a senha continua com o perfil aberto; os outros logins precisam da senha nova.
      guardarDesbloqueio(perfil.id, resposta.token);
      aoSalvo();
    } catch (err) {
      setErro(mensagemErro(err));
      setOcupado(false);
    }
  }

  function salvar(e: FormEvent) {
    e.preventDefault();
    void enviar(nova);
  }

  return (
    <form onSubmit={salvar}>
      <p className="perfis-texto-suave">
        {perfil.protegido
          ? 'Este perfil já tem senha. Defina uma nova ou remova a proteção.'
          : 'Com senha, todos os usuários, inclusive os titulares, precisam digitá-la para abrir o perfil, uma vez a cada login.'}{' '}
        As chaves de &quot;Conectar IA&quot; deste perfil continuam funcionando.
      </p>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <Campo rotulo={perfil.protegido ? 'Nova senha do perfil' : 'Senha do perfil'} tipo="password" valor={nova} aoMudar={setNova} />
      <Campo rotulo="Repita a senha do perfil" tipo="password" valor={repetida} aoMudar={setRepetida} />
      <Campo rotulo="Senha da sua conta (para confirmar)" tipo="password" valor={senhaConta} aoMudar={setSenhaConta} obrigatorio />
      <div className="pagina-acoes">
        {perfil.protegido && (
          <Botao variante="perigo" desabilitado={ocupado} aoClicar={() => void enviar(null)}>
            Remover senha
          </Botao>
        )}
        <Botao tipo="submit" desabilitado={ocupado || nova === ''}>
          {perfil.protegido ? 'Trocar senha' : 'Definir senha'}
        </Botao>
      </div>
    </form>
  );
}

// ---------- Acessos ao perfil ----------

interface AcessoUsuario {
  id: number;
  nome: string;
  email: string;
  papel: 'TITULAR' | 'LEITOR';
  ativo: boolean;
  totpAtivo: boolean;
  nivel: NivelPerfil | null;
  voce: boolean;
}

const OPCOES_NIVEL = [
  { valor: 'LEITURA', rotulo: 'Somente leitura' },
  { valor: 'EDICAO', rotulo: 'Edição' },
];

function AcessosPerfil({ perfil }: { perfil: PerfilDTO }) {
  const { dados, carregando, erro, recarregar } = useDados<AcessoUsuario[]>(`/perfis/${perfil.id}/acessos`);
  const [salvando, setSalvando] = useState<number | null>(null);
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);

  async function mudar(u: AcessoUsuario, valor: string) {
    setErroSalvar(null);
    setSalvando(u.id);
    try {
      await api.put(`/perfis/${perfil.id}/acessos/${u.id}`, { nivel: valor === '' ? null : valor });
      recarregar();
    } catch (err) {
      setErroSalvar(mensagemErro(err));
    } finally {
      setSalvando(null);
    }
  }

  const titulares = dados?.filter((u) => u.papel === 'TITULAR') ?? [];
  const membros = dados?.filter((u) => u.papel === 'LEITOR') ?? [];

  return (
    <div>
      <p className="perfis-texto-suave">
        Titulares acessam todos os perfis. Para cada membro, escolha se ele não vê este perfil, se só consulta ou se
        também edita. Quem tem Edição também gerencia os acessos e a senha deste perfil.
      </p>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {erroSalvar && <Aviso tipo="erro">{erroSalvar}</Aviso>}
      {carregando && !dados && <Carregando />}
      {dados && (
        <ul className="perfis-acessos">
          {membros.map((u) => (
            <li key={u.id} className="perfis-acesso">
              <div className="perfis-acesso-quem">
                <strong>{u.nome}</strong>
                <span>{u.email}</span>
                <div className="perfis-acesso-selos">
                  {!u.ativo && <Selo cor="cinza">Inativo</Selo>}
                  {u.totpAtivo && <Selo cor="verde">Duas etapas</Selo>}
                </div>
              </div>
              <div className="perfis-acesso-nivel">
                {u.voce ? (
                  <Selo cor="azul">Você: {u.nivel ? NOME_DO_NIVEL[u.nivel] : 'sem acesso'}</Selo>
                ) : (
                  <Selecao
                    rotulo={`Acesso de ${u.nome}`}
                    valor={u.nivel ?? ''}
                    vazio="Sem acesso"
                    opcoes={OPCOES_NIVEL}
                    aoMudar={(v) => void mudar(u, v)}
                  />
                )}
                {salvando === u.id && <span className="perfis-texto-suave">Salvando...</span>}
              </div>
            </li>
          ))}
          {membros.length === 0 && (
            <li className="perfis-texto-suave">
              Nenhum membro cadastrado. Cadastre usuários com o papel &quot;Membro&quot; na tela Usuários.
            </li>
          )}
          {titulares.map((u) => (
            <li key={u.id} className="perfis-acesso">
              <div className="perfis-acesso-quem">
                <strong>{u.nome}</strong>
                <span>{u.email}</span>
                <div className="perfis-acesso-selos">
                  {!u.ativo && <Selo cor="cinza">Inativo</Selo>}
                  {u.totpAtivo && <Selo cor="verde">Duas etapas</Selo>}
                </div>
              </div>
              <div className="perfis-acesso-nivel">
                <Selo cor="azul">{u.voce ? 'Você · titular' : 'Titular'} (todos os perfis)</Selo>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------- Tela ----------

export function Perfis() {
  const { usuario } = useAuth();
  const titular = usuario?.perfil === 'TITULAR';
  const acesso = useAcessoPerfil();
  const { dados, carregando, erro, recarregar } = useDados<PerfilDTO[]>('/perfis');
  const [formulario, setFormulario] = useState<{ perfil: PerfilDTO | null } | null>(null);
  const [senhaDe, setSenhaDe] = useState<PerfilDTO | null>(null);
  const [acessosDe, setAcessosDe] = useState<PerfilDTO | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const [aApagar, setAApagar] = useState<PerfilDTO | null>(null);
  const [digitado, setDigitado] = useState('');
  const [ocupadoApagar, setOcupadoApagar] = useState(false);
  const [erroApagar, setErroApagar] = useState<string | null>(null);

  function recarregarTudo() {
    recarregar();
    acesso.recarregar();
  }

  function aoSalvo(era: PerfilDTO | null) {
    // Editar o perfil atual: o seletor do topo mostra o nome antigo, então recarrega a página.
    if (era?.atual) {
      window.location.reload();
      return;
    }
    setFormulario(null);
    recarregarTudo();
  }

  function aoSalvarSenha() {
    const nome = senhaDe?.nome ?? '';
    setSenhaDe(null);
    setAviso(`Senha do perfil "${nome}" atualizada.`);
    recarregarTudo();
  }

  function abrirApagar(perfil: PerfilDTO) {
    setDigitado('');
    setErroApagar(null);
    setAApagar(perfil);
  }

  function fecharApagar() {
    if (ocupadoApagar) return;
    setAApagar(null);
  }

  async function confirmarApagar() {
    if (!aApagar) return;
    setOcupadoApagar(true);
    setErroApagar(null);
    try {
      await api.del('/perfis/' + aApagar.id);
      if (aApagar.atual) {
        localStorage.removeItem(CHAVE_PERFIL);
        window.location.assign('/app');
        return;
      }
      setAApagar(null);
      setOcupadoApagar(false);
      recarregarTudo();
    } catch (err) {
      setErroApagar(mensagemErro(err));
      setOcupadoApagar(false);
    }
  }

  const confere = aApagar !== null && normalizarNome(digitado) === normalizarNome(aApagar.nome);

  return (
    <Pagina
      titulo="Perfis financeiros"
      acoes={titular ? <Botao aoClicar={() => setFormulario({ perfil: null })}>Novo perfil</Botao> : undefined}
    >
      <p className="perfis-texto-suave">
        Cada perfil tem as próprias contas, cartões, faturas, investimentos, categorias, orçamento e metas. O login é o
        mesmo: troque de perfil pelo seletor no topo.
      </p>

      {aviso && <Aviso tipo="sucesso">{aviso}</Aviso>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {carregando && !dados && <Carregando />}

      {dados && (
        <div className="perfis-grade">
          {dados.map((p) => (
            <Cartao key={p.id}>
              <div className="perfis-cabecalho">
                <PontoCor cor={p.cor} />
                <strong className="perfis-nome">{p.nome}</strong>
                {p.atual && <Selo cor="azul">Em uso</Selo>}
              </div>
              <div className="perfis-selos">
                {p.protegido && <Selo cor="amarelo">Com senha</Selo>}
                {!titular && <Selo cor="cinza">{NOME_DO_NIVEL[p.nivel]}</Selo>}
              </div>
              {p.bloqueado ? (
                <p className="perfis-dados">Os números aparecem depois de abrir o perfil com a senha.</p>
              ) : (
                <ul className="perfis-dados">
                  <li>Patrimônio: {formatarReais(p.patrimonio ?? 0)}</li>
                  <li>Contas e cartões: {p.contas}</li>
                  <li>Investimentos: {p.investimentos}</li>
                </ul>
              )}
              <div className="perfis-acoes">
                {!p.atual && <Botao aoClicar={() => trocarDePerfil(p.id)}>Usar este perfil</Botao>}
                {titular && (
                  <Botao variante="texto" aoClicar={() => setFormulario({ perfil: p })}>
                    Editar
                  </Botao>
                )}
                {p.podeGerenciar && (
                  <>
                    <Botao variante="texto" aoClicar={() => setAcessosDe(p)}>
                      Acessos
                    </Botao>
                    <Botao
                      variante="texto"
                      aoClicar={() => {
                        setAviso(null);
                        setSenhaDe(p);
                      }}
                    >
                      Senha
                    </Botao>
                  </>
                )}
                {titular && dados.length > 1 && (
                  <Botao variante="perigo" aoClicar={() => abrirApagar(p)}>
                    Apagar
                  </Botao>
                )}
              </div>
            </Cartao>
          ))}
        </div>
      )}

      <Modal
        aberto={formulario !== null}
        titulo={formulario?.perfil ? 'Editar perfil' : 'Novo perfil'}
        aoFechar={() => setFormulario(null)}
      >
        {formulario && (
          <FormPerfil key={formulario.perfil?.id ?? 'novo'} perfil={formulario.perfil} aoSalvo={aoSalvo} />
        )}
      </Modal>

      <Modal aberto={senhaDe !== null} titulo={`Senha do perfil ${senhaDe?.nome ?? ''}`} aoFechar={() => setSenhaDe(null)}>
        {senhaDe && <FormSenhaPerfil key={senhaDe.id} perfil={senhaDe} aoSalvo={aoSalvarSenha} />}
      </Modal>

      <Modal
        aberto={acessosDe !== null}
        titulo={`Acessos ao perfil ${acessosDe?.nome ?? ''}`}
        aoFechar={() => setAcessosDe(null)}
        largo
      >
        {acessosDe && <AcessosPerfil key={acessosDe.id} perfil={acessosDe} />}
      </Modal>

      <Modal aberto={aApagar !== null} titulo="Apagar perfil" aoFechar={fecharApagar}>
        {aApagar && (
          <div>
            {erroApagar && <Aviso tipo="erro">{erroApagar}</Aviso>}
            <p>
              {`Apagar o perfil "${aApagar.nome}" apaga todas as contas, cartões, faturas, lançamentos, investimentos, categorias, orçamentos e metas dele. Não dá para desfazer.`}
            </p>
            <Campo rotulo="Digite o nome do perfil para confirmar" valor={digitado} aoMudar={setDigitado} />
            <div className="pagina-acoes">
              <Botao variante="secundario" aoClicar={fecharApagar} desabilitado={ocupadoApagar}>
                Cancelar
              </Botao>
              <Botao variante="perigo" aoClicar={confirmarApagar} desabilitado={!confere || ocupadoApagar}>
                Apagar perfil
              </Botao>
            </div>
          </div>
        )}
      </Modal>
    </Pagina>
  );
}
