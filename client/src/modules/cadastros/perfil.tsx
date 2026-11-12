import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import { Abas, Aviso, Avatar, Botao, Campo, Carregando, Cartao, Pagina, formatarData } from '../../ui';
import { Icone } from '../../ui/icones';
import type { NomeIcone } from '../../ui/icones';
import { useTema } from '../../lib/tema';
import type { PreferenciaTema } from '../../lib/tema';
import { mensagemErro, nulo } from './tipos';
import type { PerfilMeu } from './tipos';
import { PerfilFoto } from './PerfilFoto';
import { NOMES_ICONES } from '../../ui/icones';
import './perfil.css';

function iconeSeguro(nome: string): NomeIcone {
  return (NOMES_ICONES as string[]).includes(nome) ? (nome as NomeIcone) : 'atividade';
}

// Formato de GET /perfil/completo.
interface IndicadorResumo {
  rotulo: string;
  valor: string;
  icone: string;
  cor: string;
}

interface PerfilCompletoDTO {
  usuario: {
    id: number;
    nome: string;
    email: string;
    perfil: string;
    telefone: string | null;
    foto: string | null;
    criadoEm: string;
  };
  resumo: IndicadorResumo[];
  atividadeRecente: { id: number; criadoEm: string; tipo: string; descricao: string; modulo: string }[];
}

const PAPEIS: Record<string, string> = {
  TITULAR: 'Titular',
};

const ICONE_ATIVIDADE: Record<string, NomeIcone> = {
  CRIACAO: 'mais',
  ALTERACAO: 'lapis',
  EXCLUSAO: 'fechar',
};

function tempoRelativo(iso: string): string {
  const momento = new Date(iso).getTime();
  if (Number.isNaN(momento)) return '';
  const minutos = Math.round((Date.now() - momento) / 60000);
  if (minutos < 1) return 'agora';
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `há ${horas} h`;
  const dias = Math.round(horas / 24);
  if (dias < 30) return `há ${dias} ${dias === 1 ? 'dia' : 'dias'}`;
  return formatarData(iso);
}

// ---------- Editar telefone ----------

function FormDadosPerfil({
  perfil,
  aoSalvo,
}: {
  perfil: PerfilMeu;
  aoSalvo: () => void;
}) {
  const [telefone, setTelefone] = useState(perfil.telefone ?? '');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setSucesso(null);
    setOcupado(true);
    try {
      await api.put('/perfil/meu', { telefone: nulo(telefone) });
      setSucesso('Dados atualizados.');
      aoSalvo();
    } catch (err) {
      setErro(mensagemErro(err));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <form onSubmit={salvar}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {sucesso && <Aviso tipo="sucesso">{sucesso}</Aviso>}
      <Campo rotulo="Telefone" tipo="text" valor={telefone} aoMudar={setTelefone} />
      <div className="perfil-acoes">
        <Botao tipo="submit" desabilitado={ocupado}>
          Salvar dados
        </Botao>
      </div>
    </form>
  );
}

// ---------- Trocar senha ----------

function FormTrocarSenha() {
  const [senhaAtual, setSenhaAtual] = useState('');
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmarSenha, setConfirmarSenha] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);

  async function trocar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setSucesso(null);
    // Conferência só no cliente: se as senhas novas não baterem, nem envia.
    if (confirmarSenha !== novaSenha) {
      setErro('As senhas novas não coincidem.');
      return;
    }
    setOcupado(true);
    try {
      await api.post('/auth/trocar-senha', { senhaAtual, novaSenha });
      setSenhaAtual('');
      setNovaSenha('');
      setConfirmarSenha('');
      setSucesso('Senha alterada.');
    } catch (err) {
      setErro(mensagemErro(err));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <form onSubmit={trocar}>
      <h3 className="cartao-titulo perfil-titulo-com-icone">
        <Icone nome="cadeado" tamanho={18} />
        Trocar senha
      </h3>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {sucesso && <Aviso tipo="sucesso">{sucesso}</Aviso>}
      <Campo
        rotulo="Senha atual"
        tipo="password"
        valor={senhaAtual}
        aoMudar={setSenhaAtual}
        obrigatorio
      />
      <Campo
        rotulo="Nova senha (mínimo 6 caracteres)"
        tipo="password"
        valor={novaSenha}
        aoMudar={setNovaSenha}
        obrigatorio
      />
      <Campo
        rotulo="Confirmar nova senha"
        tipo="password"
        valor={confirmarSenha}
        aoMudar={setConfirmarSenha}
        obrigatorio
      />
      <div className="perfil-acoes">
        <Botao tipo="submit" desabilitado={ocupado}>
          Trocar senha
        </Botao>
      </div>
    </form>
  );
}

// ---------- Aparência (tema) ----------

const OPCOES_TEMA: { valor: PreferenciaTema; rotulo: string; icone: NomeIcone; legenda?: string }[] = [
  { valor: 'sistema', rotulo: 'Sistema', icone: 'monitor', legenda: 'Segue o aparelho' },
  { valor: 'claro', rotulo: 'Claro', icone: 'sol' },
  { valor: 'escuro', rotulo: 'Escuro', icone: 'lua' },
];

function CartaoAparencia() {
  const { preferencia, definir } = useTema();
  return (
    <section className="cartao">
      <h3 className="cartao-titulo perfil-titulo-com-icone">
        <Icone nome="sol" tamanho={18} />
        Aparência
      </h3>
      <p className="perfil-nota">Escolha o tema do sistema neste navegador.</p>
      <div className="perfil-temas" role="radiogroup" aria-label="Tema do sistema">
        {OPCOES_TEMA.map((opcao) => {
          const ativa = preferencia === opcao.valor;
          return (
            <button
              key={opcao.valor}
              type="button"
              role="radio"
              aria-checked={ativa}
              className={ativa ? 'perfil-tema perfil-tema-ativo' : 'perfil-tema'}
              onClick={() => definir(opcao.valor)}
            >
              <span className="perfil-tema-icone">
                <Icone nome={opcao.icone} tamanho={22} />
              </span>
              <span className="perfil-tema-rotulo">{opcao.rotulo}</span>
              {opcao.legenda && <span className="perfil-tema-legenda">{opcao.legenda}</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ---------- Blocos da visão geral ----------

function CabecalhoPerfil({
  dados,
  aoTrocarFoto,
}: {
  dados: PerfilCompletoDTO;
  aoTrocarFoto: () => void;
}) {
  const u = dados.usuario;
  const desde = new Date(u.criadoEm).toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
  });

  return (
    <section className="cartao perfil-cabecalho">
      <div className="perfil-capa" aria-hidden="true" />
      <div className="perfil-cabecalho-corpo">
        <Avatar nome={u.nome} foto={u.foto} tamanho={96} className="perfil-foto-grande" />
        <div className="perfil-identidade">
          <div className="perfil-nome-linha">
            <h2 className="perfil-nome">{u.nome}</h2>
            <div className="perfil-acao-foto">
              <Botao variante="secundario" aoClicar={aoTrocarFoto}>
                Trocar foto
              </Botao>
            </div>
          </div>
          <span className="perfil-papel">{PAPEIS[u.perfil] ?? u.perfil}</span>
          <p className="perfil-desde">No sistema desde {desde}</p>
        </div>
      </div>
    </section>
  );
}

function IndicadoresResumo({ indicadores }: { indicadores: IndicadorResumo[] }) {
  return (
    <div className="perfil-indicadores">
      {indicadores.map((i) => (
        <div className="perfil-indicador" key={i.rotulo}>
          <span className={`perfil-indicador-icone perfil-cor-${i.cor}`}>
            <Icone nome={iconeSeguro(i.icone)} tamanho={22} />
          </span>
          <div className="perfil-indicador-texto">
            <span className="perfil-indicador-valor">{i.valor}</span>
            <span className="perfil-indicador-rotulo">{i.rotulo}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function AtividadeRecente({ itens }: { itens: PerfilCompletoDTO['atividadeRecente'] }) {
  return (
    <section className="cartao">
      <h2 className="cartao-titulo">Atividade recente</h2>
      {itens.length === 0 ? (
        <p className="perfil-vazio">Sem atividade recente.</p>
      ) : (
        <ul className="perfil-atividade">
          {itens.map((a) => (
            <li className="perfil-atividade-item" key={a.id}>
              <span className="perfil-atividade-icone perfil-cor-azul">
                <Icone nome={ICONE_ATIVIDADE[a.tipo] ?? 'atividade'} tamanho={18} />
              </span>
              <div className="perfil-atividade-texto">
                <span className="perfil-atividade-descricao">{a.descricao}</span>
                <span className="perfil-atividade-meta">
                  {a.modulo} · {tempoRelativo(a.criadoEm)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------- Dados e segurança ----------

function DadosESeguranca({
  dados,
  aoSalvo,
}: {
  dados: PerfilMeu;
  aoSalvo: () => void;
}) {
  // Linhas da lista "Meus dados": rótulo à esquerda, valor à direita.
  const linhas: { rotulo: string; valor: string }[] = [
    { rotulo: 'Nome', valor: dados.nome },
    { rotulo: 'E-mail', valor: dados.email },
    { rotulo: 'Perfil', valor: PAPEIS[dados.perfil] ?? dados.perfil },
  ];
  if (dados.cpf) linhas.push({ rotulo: 'CPF', valor: dados.cpf });

  return (
    <div className="perfil-dados-grade">
      <div className="perfil-dados-coluna">
        <Cartao titulo="Meus dados">
          <dl className="perfil-lista">
            {linhas.map((l) => (
              <div className="perfil-lista-linha" key={l.rotulo}>
                <dt>{l.rotulo}</dt>
                <dd>{l.valor}</dd>
              </div>
            ))}
          </dl>
          <p className="perfil-nota">Nome e e-mail são alterados na tela Usuários.</p>
        </Cartao>

        <Cartao titulo="Contato">
          <FormDadosPerfil perfil={dados} aoSalvo={aoSalvo} />
        </Cartao>
      </div>

      <div className="perfil-dados-coluna">
        <Cartao>
          <FormTrocarSenha />
        </Cartao>

        <CartaoAparencia />
      </div>
    </div>
  );
}

// ---------- Tela "Meu perfil" (todos os perfis) ----------

export function MeuPerfil() {
  const completo = useDados<PerfilCompletoDTO>('/perfil/completo');
  const meu = useDados<PerfilMeu>('/perfil/meu');
  const [aba, setAba] = useState<'visao' | 'dados'>('visao');
  const [fotoAberta, setFotoAberta] = useState(false);

  function recarregarTudo() {
    completo.recarregar();
    meu.recarregar();
  }

  // Dados e senha não dependem do /perfil/completo: continuam na tela se ele falhar.
  const parteDados = meu.dados && (
    <DadosESeguranca dados={meu.dados} aoSalvo={recarregarTudo} />
  );

  if (completo.erro) {
    return (
      <Pagina titulo="Meu perfil">
        <Aviso tipo="erro">{completo.erro}</Aviso>
        {meu.erro && <Aviso tipo="erro">{meu.erro}</Aviso>}
        {meu.carregando && !meu.dados && <Carregando />}
        {parteDados}
      </Pagina>
    );
  }

  if (completo.carregando && !completo.dados) {
    return (
      <Pagina titulo="Meu perfil">
        <Carregando />
      </Pagina>
    );
  }

  const dados = completo.dados;
  if (!dados) {
    return <Pagina titulo="Meu perfil">{meu.erro && <Aviso tipo="erro">{meu.erro}</Aviso>}</Pagina>;
  }

  return (
    <Pagina titulo="Meu perfil">
      <CabecalhoPerfil dados={dados} aoTrocarFoto={() => setFotoAberta(true)} />

      {fotoAberta && (
        <PerfilFoto
          aberto
          aoFechar={() => setFotoAberta(false)}
          nome={dados.usuario.nome}
          fotoAtual={dados.usuario.foto}
          aoSalvo={recarregarTudo}
        />
      )}

      <Abas
        abas={[
          { id: 'visao', rotulo: 'Visão geral' },
          { id: 'dados', rotulo: 'Dados e segurança' },
        ]}
        ativa={aba}
        aoMudar={(id) => setAba(id as 'visao' | 'dados')}
      />

      {aba === 'visao' ? (
        <div className="perfil-visao">
          <IndicadoresResumo indicadores={dados.resumo} />
          <AtividadeRecente itens={dados.atividadeRecente} />
        </div>
      ) : (
        <div className="perfil-dados">
          {meu.erro && <Aviso tipo="erro">{meu.erro}</Aviso>}
          {meu.carregando && !meu.dados && <Carregando />}
          {parteDados}
        </div>
      )}
    </Pagina>
  );
}
