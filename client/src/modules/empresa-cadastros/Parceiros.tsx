import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { formatarReais, mensagemErro, queryString } from '../../lib/financas';
import { useDados } from '../../lib/useDados';
import { Abas, Aviso, AreaTexto, Botao, Campo, Caixa, Cartao, Carregando, Modal, MenuAcoes, Pagina, Selecao, Selo, Tabela } from '../../ui';
import type { ColunaTabela } from '../../ui';
import { Vazio } from '../../ui/financas';

type TipoParceiro = 'CLIENTE' | 'FORNECEDOR' | 'AMBOS';
type Aba = 'TODOS' | 'CLIENTE' | 'FORNECEDOR';

export interface ParceiroDTO {
  id: number;
  nome: string;
  tipo: TipoParceiro;
  documento: string | null;
  email: string | null;
  telefone: string | null;
  observacao: string | null;
  ativo: boolean;
  titulosEmAberto: number;
  saldoEmAberto: number;
}

const ROTULO_TIPO: Record<TipoParceiro, string> = {
  CLIENTE: 'Cliente',
  FORNECEDOR: 'Fornecedor',
  AMBOS: 'Cliente e fornecedor',
};

const COR_TIPO: Record<TipoParceiro, 'azul' | 'amarelo' | 'verde'> = {
  CLIENTE: 'azul',
  FORNECEDOR: 'amarelo',
  AMBOS: 'verde',
};

const ABAS: { id: Aba; rotulo: string }[] = [
  { id: 'TODOS', rotulo: 'Todos' },
  { id: 'CLIENTE', rotulo: 'Clientes' },
  { id: 'FORNECEDOR', rotulo: 'Fornecedores' },
];

// Só dígitos entram no servidor; aqui só para exibir: CPF 000.000.000-00 ou CNPJ 00.000.000/0000-00.
function formatarDocumento(documento: string | null): string {
  if (!documento) return '—';
  if (documento.length === 11) return documento.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  if (documento.length === 14) return documento.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  return documento;
}

function contato(p: ParceiroDTO): string {
  const partes = [p.email, p.telefone].filter((v): v is string => Boolean(v));
  return partes.length > 0 ? partes.join(' · ') : '—';
}

// ---------- Criar / editar ----------

function FormParceiro({
  parceiro,
  aoSalvo,
}: {
  parceiro: ParceiroDTO | null;
  aoSalvo: () => void;
}) {
  const [nome, setNome] = useState(parceiro?.nome ?? '');
  const [tipo, setTipo] = useState<string>(parceiro?.tipo ?? '');
  const [documento, setDocumento] = useState(parceiro?.documento ?? '');
  const [email, setEmail] = useState(parceiro?.email ?? '');
  const [telefone, setTelefone] = useState(parceiro?.telefone ?? '');
  const [observacao, setObservacao] = useState(parceiro?.observacao ?? '');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const nomeLimpo = nome.trim();
    if (nomeLimpo === '') {
      setErro('Informe o nome.');
      return;
    }
    if (nomeLimpo.length > 120) {
      setErro('O nome pode ter no máximo 120 letras.');
      return;
    }
    if (tipo === '') {
      setErro('Escolha se é cliente, fornecedor ou os dois.');
      return;
    }
    const digitos = documento.replace(/\D/g, '');
    if (documento.trim() !== '' && digitos.length !== 11 && digitos.length !== 14) {
      setErro('CPF ou CNPJ: informe 11 ou 14 números.');
      return;
    }
    setOcupado(true);
    try {
      const corpo = {
        nome: nomeLimpo,
        tipo,
        documento: documento.trim() === '' ? null : digitos,
        email: email.trim() === '' ? null : email.trim(),
        telefone: telefone.trim() === '' ? null : telefone.trim(),
        observacao: observacao.trim() === '' ? null : observacao.trim(),
      };
      if (parceiro) await api.put('/parceiros/' + parceiro.id, corpo);
      else await api.post('/parceiros', corpo);
      aoSalvo();
    } catch (err) {
      setErro(mensagemErro(err));
      setOcupado(false);
    }
  }

  return (
    <form onSubmit={salvar}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <Campo rotulo="Nome" valor={nome} aoMudar={setNome} obrigatorio />
      <Selecao
        rotulo="Tipo"
        valor={tipo}
        aoMudar={setTipo}
        vazio="Escolha o tipo"
        obrigatorio
        opcoes={[
          { valor: 'CLIENTE', rotulo: 'Cliente' },
          { valor: 'FORNECEDOR', rotulo: 'Fornecedor' },
          { valor: 'AMBOS', rotulo: 'Cliente e fornecedor' },
        ]}
      />
      <Campo rotulo="CPF ou CNPJ" valor={documento} aoMudar={setDocumento} />
      <Campo rotulo="E-mail" valor={email} aoMudar={setEmail} tipo="email" />
      <Campo rotulo="Telefone" valor={telefone} aoMudar={setTelefone} />
      <AreaTexto rotulo="Observação" valor={observacao} aoMudar={setObservacao} linhas={3} />
      <div className="pagina-acoes">
        <Botao tipo="submit" desabilitado={ocupado}>
          Salvar
        </Botao>
      </div>
    </form>
  );
}

// ---------- Tela ----------

export function Parceiros() {
  const [aba, setAba] = useState<Aba>('TODOS');
  const [mostrarInativos, setMostrarInativos] = useState(false);
  const [busca, setBusca] = useState('');
  const [buscaAtiva, setBuscaAtiva] = useState('');

  // A busca espera um pouco depois da última tecla antes de consultar o servidor.
  useEffect(() => {
    const espera = setTimeout(() => setBuscaAtiva(busca.trim()), 300);
    return () => clearTimeout(espera);
  }, [busca]);

  const caminho =
    '/parceiros' +
    queryString({
      tipo: aba === 'TODOS' ? undefined : aba,
      inativos: mostrarInativos ? 'true' : undefined,
      busca: buscaAtiva,
    });
  const lista = useDados<ParceiroDTO[]>(caminho);

  const [formulario, setFormulario] = useState<{ parceiro: ParceiroDTO | null } | null>(null);
  const [aApagar, setAApagar] = useState<ParceiroDTO | null>(null);
  const [ocupadoApagar, setOcupadoApagar] = useState(false);
  const [erroApagar, setErroApagar] = useState<string | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  async function alternarAtivo(p: ParceiroDTO) {
    setErroAcao(null);
    try {
      await api.put('/parceiros/' + p.id, { ativo: !p.ativo });
      lista.recarregar();
    } catch (err) {
      setErroAcao(mensagemErro(err));
    }
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
      await api.del('/parceiros/' + aApagar.id);
      setAApagar(null);
      lista.recarregar();
    } catch (err) {
      setErroApagar(mensagemErro(err));
    } finally {
      setOcupadoApagar(false);
    }
  }

  function aoSalvo() {
    setFormulario(null);
    lista.recarregar();
  }

  const colunas: ColunaTabela<ParceiroDTO>[] = [
    {
      titulo: 'Nome',
      celula: (p) => (
        <span>
          <strong>{p.nome}</strong>
          {!p.ativo && (
            <>
              {' '}
              <Selo>Desativado</Selo>
            </>
          )}
        </span>
      ),
    },
    { titulo: 'Tipo', celula: (p) => <Selo cor={COR_TIPO[p.tipo]}>{ROTULO_TIPO[p.tipo]}</Selo> },
    { titulo: 'Documento', celula: (p) => formatarDocumento(p.documento) },
    { titulo: 'Contato', celula: (p) => contato(p) },
    {
      titulo: 'Em aberto',
      alinhar: 'direita',
      celula: (p) =>
        p.titulosEmAberto > 0 ? (
          <span>
            {formatarReais(p.saldoEmAberto)}
            <span className="cad-suave">{` (${p.titulosEmAberto} ${p.titulosEmAberto === 1 ? 'conta' : 'contas'})`}</span>
          </span>
        ) : (
          <span className="cad-suave">Nada em aberto</span>
        ),
    },
    {
      titulo: 'Ações',
      acoes: true,
      celula: (p) => (
        <MenuAcoes
          rotulo={`Ações de ${p.nome}`}
          acoes={[
            { rotulo: 'Editar', aoClicar: () => setFormulario({ parceiro: p }) },
            { rotulo: p.ativo ? 'Desativar' : 'Reativar', aoClicar: () => void alternarAtivo(p) },
            {
              rotulo: 'Excluir',
              perigo: true,
              aoClicar: () => {
                setErroApagar(null);
                setAApagar(p);
              },
            },
          ]}
        />
      ),
    },
  ];

  const temFiltro = aba !== 'TODOS' || mostrarInativos || buscaAtiva !== '';

  return (
    <Pagina
      titulo="Clientes e fornecedores"
      acoes={<Botao aoClicar={() => setFormulario({ parceiro: null })}>Novo cadastro</Botao>}
    >
      <p className="cad-ajuda">
        Quem você cobra (cliente) e a quem você paga (fornecedor). Um cadastro com contas ligadas a ele não pode ser excluído:
        desative-o.
      </p>

      <Abas abas={ABAS} ativa={aba} aoMudar={(id) => setAba(id as Aba)} />

      <div className="cad-filtros">
        <Campo rotulo="Buscar pelo nome" valor={busca} aoMudar={setBusca} />
        <Caixa rotulo="Mostrar desativados" marcado={mostrarInativos} aoMudar={setMostrarInativos} />
      </div>

      {erroAcao && <Aviso tipo="erro">{erroAcao}</Aviso>}
      {lista.erro && <Aviso tipo="erro">{lista.erro}</Aviso>}
      {lista.carregando && <Carregando />}

      {lista.dados && (
        <Cartao>
          {lista.dados.length === 0 ? (
            <Vazio
              icone="usuarios"
              titulo={temFiltro ? 'Nenhum cadastro encontrado' : 'Nenhum cadastro ainda'}
              texto={temFiltro ? 'Tente outra busca ou outro filtro.' : 'Cadastre seus clientes e fornecedores para ligar às contas.'}
            />
          ) : (
            <Tabela colunas={colunas} dados={lista.dados} chave={(p) => p.id} />
          )}
        </Cartao>
      )}

      <Modal
        aberto={formulario !== null}
        titulo={formulario?.parceiro ? 'Editar cadastro' : 'Novo cadastro'}
        aoFechar={() => setFormulario(null)}
      >
        {formulario && (
          <FormParceiro key={formulario.parceiro?.id ?? 'novo'} parceiro={formulario.parceiro} aoSalvo={aoSalvo} />
        )}
      </Modal>

      <Modal aberto={aApagar !== null} titulo="Excluir cadastro" aoFechar={fecharApagar}>
        {aApagar && (
          <div>
            {erroApagar && <Aviso tipo="erro">{erroApagar}</Aviso>}
            <p>{`Excluir "${aApagar.nome}"? Esta ação não tem volta.`}</p>
            <div className="pagina-acoes">
              <Botao variante="secundario" aoClicar={fecharApagar} desabilitado={ocupadoApagar}>
                Cancelar
              </Botao>
              <Botao variante="perigo" aoClicar={confirmarApagar} desabilitado={ocupadoApagar}>
                Excluir
              </Botao>
            </div>
          </div>
        )}
      </Modal>
    </Pagina>
  );
}
