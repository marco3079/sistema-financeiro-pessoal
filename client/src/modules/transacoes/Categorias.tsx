import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import { TIPOS_TRANSACAO, mensagemErro } from '../../lib/financas';
import type { CategoriaDTO, TipoTransacao } from '../../lib/financas';
import { Aviso, Botao, Campo, Carregando, Cartao, MenuAcoes, Modal, Pagina, Selecao, Tabela } from '../../ui';
import type { AcaoMenu } from '../../ui';
import { CampoCor, NomeComCor } from '../../ui/financas';

const COR_PADRAO = '#2563eb';

function paraTipo(texto: string): TipoTransacao {
  return texto === 'RECEITA' ? 'RECEITA' : 'DESPESA';
}

// ---------- Criar e editar categoria ----------

function FormCategoria({
  categoria,
  aoConcluir,
}: {
  categoria: CategoriaDTO | null;
  aoConcluir: () => void;
}) {
  const [nome, setNome] = useState(categoria?.nome ?? '');
  const [tipo, setTipo] = useState<TipoTransacao>(categoria?.tipo ?? 'DESPESA');
  const [cor, setCor] = useState(categoria?.cor ?? COR_PADRAO);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setOcupado(true);
    try {
      if (categoria) {
        await api.put(`/categorias/${categoria.id}`, { nome: nome.trim(), cor });
      } else {
        await api.post('/categorias', { nome: nome.trim(), tipo, cor });
      }
      aoConcluir();
    } catch (err) {
      setErro(mensagemErro(err));
      setOcupado(false);
    }
  }

  return (
    <form onSubmit={salvar}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <Campo rotulo="Nome" obrigatorio valor={nome} aoMudar={setNome} />
      {!categoria && (
        <Selecao
          rotulo="Tipo"
          obrigatorio
          valor={tipo}
          aoMudar={(v) => setTipo(paraTipo(v))}
          opcoes={TIPOS_TRANSACAO}
        />
      )}
      <CampoCor rotulo="Cor" valor={cor} aoMudar={setCor} />
      <div className="pagina-acoes">
        <Botao tipo="submit" desabilitado={ocupado}>
          Salvar
        </Botao>
      </div>
    </form>
  );
}

// ---------- Lista (despesas e receitas) ----------

export function Categorias() {
  const { dados, carregando, erro, recarregar } = useDados<CategoriaDTO[]>('/categorias');
  const [novo, setNovo] = useState(false);
  const [editando, setEditando] = useState<CategoriaDTO | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  function fecharModal() {
    setNovo(false);
    setEditando(null);
  }

  async function excluir(c: CategoriaDTO) {
    if (!window.confirm(`Excluir a categoria ${c.nome}? Os lançamentos dela ficam sem categoria.`)) return;
    setErroAcao(null);
    try {
      await api.del(`/categorias/${c.id}`);
      recarregar();
    } catch (e) {
      setErroAcao(mensagemErro(e));
    }
  }

  function acoesDo(c: CategoriaDTO): AcaoMenu[] {
    return [
      { rotulo: 'Editar', icone: 'lapis', aoClicar: () => setEditando(c) },
      { rotulo: 'Excluir', icone: 'lixeira', perigo: true, aoClicar: () => excluir(c) },
    ];
  }

  function tabelaDo(tipo: TipoTransacao) {
    const itens = (dados ?? []).filter((c) => c.tipo === tipo);
    return (
      <Tabela<CategoriaDTO>
        chave={(c) => c.id}
        dados={itens}
        vazio="Nenhuma categoria."
        colunas={[
          { titulo: 'Categoria', celula: (c) => <NomeComCor cor={c.cor}>{c.nome}</NomeComCor> },
          {
            titulo: 'Ações',
            acoes: true,
            celula: (c) => <MenuAcoes rotulo={'Ações da categoria ' + c.nome} acoes={acoesDo(c)} />,
          },
        ]}
      />
    );
  }

  return (
    <Pagina titulo="Categorias">
      <div className="barra-ferramentas">
        <div className="filtros" />
        <Botao aoClicar={() => setNovo(true)}>Nova categoria</Botao>
      </div>

      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {erroAcao && <Aviso tipo="erro">{erroAcao}</Aviso>}

      {carregando && <Carregando />}
      {dados && (
        <div className="fin-duas-colunas">
          <Cartao titulo="Despesas">{tabelaDo('DESPESA')}</Cartao>
          <Cartao titulo="Receitas">{tabelaDo('RECEITA')}</Cartao>
        </div>
      )}

      <Modal
        aberto={novo || editando !== null}
        titulo={editando ? 'Editar categoria' : 'Nova categoria'}
        aoFechar={fecharModal}
      >
        <FormCategoria
          key={editando?.id ?? 'nova'}
          categoria={editando}
          aoConcluir={() => {
            fecharModal();
            recarregar();
          }}
        />
      </Modal>
    </Pagina>
  );
}
