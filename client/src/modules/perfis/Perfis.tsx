import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { formatarReais, mensagemErro } from '../../lib/financas';
import { CHAVE_PERFIL, trocarDePerfil } from '../../lib/perfilFinanceiro';
import type { PerfilDTO } from '../../lib/perfilFinanceiro';
import { useDados } from '../../lib/useDados';
import { Aviso, Botao, Campo, Cartao, Carregando, Modal, Pagina, Selo } from '../../ui';
import { CampoCor, PontoCor } from '../../ui/financas';
import './perfis.css';

const NOME_MAXIMO = 60;

function normalizarNome(texto: string): string {
  return texto.trim().toLowerCase();
}

// ---------- Criar / editar perfil ----------

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

// ---------- Tela ----------

export function Perfis() {
  const { dados, carregando, erro, recarregar } = useDados<PerfilDTO[]>('/perfis');
  const [formulario, setFormulario] = useState<{ perfil: PerfilDTO | null } | null>(null);

  const [aApagar, setAApagar] = useState<PerfilDTO | null>(null);
  const [digitado, setDigitado] = useState('');
  const [ocupadoApagar, setOcupadoApagar] = useState(false);
  const [erroApagar, setErroApagar] = useState<string | null>(null);

  function aoSalvo(era: PerfilDTO | null) {
    // Editar o perfil atual: o seletor do topo mostra o nome antigo, então recarrega a página.
    if (era?.atual) {
      window.location.reload();
      return;
    }
    setFormulario(null);
    recarregar();
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
      recarregar();
    } catch (err) {
      setErroApagar(mensagemErro(err));
      setOcupadoApagar(false);
    }
  }

  const confere = aApagar !== null && normalizarNome(digitado) === normalizarNome(aApagar.nome);

  return (
    <Pagina
      titulo="Perfis financeiros"
      acoes={<Botao aoClicar={() => setFormulario({ perfil: null })}>Novo perfil</Botao>}
    >
      <p className="perfis-texto-suave">
        Cada perfil tem as próprias contas, cartões, faturas, investimentos, categorias, orçamento e metas. O login é o
        mesmo: troque de perfil pelo seletor no topo.
      </p>

      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {carregando && <Carregando />}

      {dados && (
        <div className="perfis-grade">
          {dados.map((p) => (
            <Cartao key={p.id}>
              <div className="perfis-cabecalho">
                <PontoCor cor={p.cor} />
                <strong className="perfis-nome">{p.nome}</strong>
                {p.atual && <Selo cor="azul">Em uso</Selo>}
              </div>
              <ul className="perfis-dados">
                <li>Patrimônio: {formatarReais(p.patrimonio)}</li>
                <li>Contas e cartões: {p.contas}</li>
                <li>Investimentos: {p.investimentos}</li>
              </ul>
              <div className="perfis-acoes">
                {!p.atual && <Botao aoClicar={() => trocarDePerfil(p.id)}>Usar este perfil</Botao>}
                <Botao variante="texto" aoClicar={() => setFormulario({ perfil: p })}>
                  Editar
                </Botao>
                {dados.length > 1 && (
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
