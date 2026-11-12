import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import {
  TIPOS_CONTA,
  CORES_PALETA,
  formatarReais,
  lerValor,
  mensagemErro,
  queryString,
  rotuloDe,
  valorParaCampo,
} from '../../lib/financas';
import type { ContaDTO } from '../../lib/financas';
import {
  Aviso,
  Botao,
  Campo,
  Caixa,
  Carregando,
  MenuAcoes,
  Modal,
  Pagina,
  Selecao,
  Selo,
  Tabela,
} from '../../ui';
import type { AcaoMenu } from '../../ui';
import { CampoCor, NomeComCor, ResumoItem, SeloOrigem, Valor } from '../../ui/financas';

// Cartão tem tela própria: aqui ficam só as demais contas.
const TIPOS_SEM_CARTAO: { valor: string; rotulo: string }[] = TIPOS_CONTA.filter((t) => t.valor !== 'CARTAO');

interface ResumoContas {
  contas: number;
  investimentos: number;
  cartoes: number;
  patrimonio: number;
}

// ---------- Criar / editar conta ----------

function FormConta({ conta, aoConcluir }: { conta: ContaDTO | null; aoConcluir: () => void }) {
  const ehEdicao = conta !== null;
  const ehOpenFinance = conta?.origem === 'OPEN_FINANCE';
  const [nome, setNome] = useState(conta?.nome ?? '');
  const [tipo, setTipo] = useState<string>(conta?.tipo ?? '');
  const [instituicao, setInstituicao] = useState(conta?.instituicao ?? '');
  const [numero, setNumero] = useState(conta?.numero ?? '');
  const [saldoTexto, setSaldoTexto] = useState('');
  const [cor, setCor] = useState(conta?.cor ?? CORES_PALETA[0]);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);

    if (ehOpenFinance && conta) {
      setOcupado(true);
      try {
        await api.put(`/contas/${conta.id}`, { nome: nome.trim(), cor });
        aoConcluir();
      } catch (err) {
        setErro(mensagemErro(err));
        setOcupado(false);
      }
      return;
    }

    let saldo: number | undefined;
    if (!ehEdicao && saldoTexto.trim() !== '') {
      const valor = lerValor(saldoTexto);
      if (valor === null) {
        setErro('Informe um valor válido.');
        return;
      }
      saldo = valor;
    }

    setOcupado(true);
    try {
      if (ehEdicao && conta) {
        await api.put(`/contas/${conta.id}`, {
          nome: nome.trim(),
          instituicao: instituicao.trim() || null,
          numero: numero.trim() || null,
          cor,
        });
      } else {
        await api.post('/contas', {
          nome: nome.trim(),
          tipo,
          instituicao: instituicao.trim() || null,
          numero: numero.trim() || null,
          saldo,
          cor,
        });
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
      {ehOpenFinance && (
        <Aviso tipo="info">Os demais dados desta conta vêm do banco e são atualizados automaticamente.</Aviso>
      )}
      <Campo rotulo="Nome" valor={nome} aoMudar={setNome} obrigatorio />
      {!ehOpenFinance && (
        <>
          {!ehEdicao && (
            <Selecao rotulo="Tipo" valor={tipo} aoMudar={setTipo} opcoes={TIPOS_SEM_CARTAO} obrigatorio />
          )}
          <Campo rotulo="Instituição" valor={instituicao} aoMudar={setInstituicao} />
          <Campo rotulo="Número" valor={numero} aoMudar={setNumero} />
          {!ehEdicao && (
            <Campo rotulo="Saldo inicial (R$)" valor={saldoTexto} aoMudar={setSaldoTexto} />
          )}
        </>
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

// ---------- Ajustar saldo (conta MANUAL) ----------

function FormSaldo({ conta, aoConcluir }: { conta: ContaDTO; aoConcluir: () => void }) {
  const [texto, setTexto] = useState(valorParaCampo(conta.saldo));
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const valor = lerValor(texto);
    if (valor === null) {
      setErro('Informe um valor válido.');
      return;
    }
    setOcupado(true);
    try {
      await api.put(`/contas/${conta.id}/saldo`, { saldo: valor });
      aoConcluir();
    } catch (err) {
      setErro(mensagemErro(err));
      setOcupado(false);
    }
  }

  return (
    <form onSubmit={salvar}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <Campo rotulo="Novo saldo (R$)" valor={texto} aoMudar={setTexto} obrigatorio />
      <div className="pagina-acoes">
        <Botao tipo="submit" desabilitado={ocupado}>
          Ajustar saldo
        </Botao>
      </div>
    </form>
  );
}

// ---------- Lista ----------

export function Contas() {
  const [mostrarInativas, setMostrarInativas] = useState(false);
  const [filtroTipo, setFiltroTipo] = useState('');
  const [formAberto, setFormAberto] = useState(false);
  const [editando, setEditando] = useState<ContaDTO | null>(null);
  const [ajustando, setAjustando] = useState<ContaDTO | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  const contasQuery = useDados<ContaDTO[]>(
    '/contas' + queryString({ inativas: mostrarInativas ? 'true' : '' })
  );
  const resumoQuery = useDados<ResumoContas>('/contas/resumo');
  const dados = contasQuery.dados;
  const resumo = resumoQuery.dados;

  function recarregar() {
    contasQuery.recarregar();
    resumoQuery.recarregar();
  }

  function fecharFormularios() {
    setFormAberto(false);
    setEditando(null);
    setAjustando(null);
  }

  async function alternarAtiva(c: ContaDTO) {
    setErroAcao(null);
    try {
      await api.put(`/contas/${c.id}`, { ativo: !c.ativo });
      recarregar();
    } catch (e) {
      setErroAcao(mensagemErro(e));
    }
  }

  async function excluir(c: ContaDTO) {
    if (!window.confirm(`Excluir a conta ${c.nome}? Os lançamentos dela também serão apagados.`)) return;
    setErroAcao(null);
    try {
      await api.del(`/contas/${c.id}`);
      recarregar();
    } catch (e) {
      setErroAcao(mensagemErro(e));
    }
  }

  // Ações do menu de três pontos. Open Finance só pode ser ativada/desativada e ter nome e cor alterados.
  function acoesDe(c: ContaDTO): AcaoMenu[] {
    const manual = c.origem === 'MANUAL';
    const acoes: AcaoMenu[] = [{ rotulo: 'Editar', icone: 'lapis', aoClicar: () => setEditando(c) }];
    if (manual) {
      acoes.push({ rotulo: 'Ajustar saldo', icone: 'financeiro', aoClicar: () => setAjustando(c) });
    }
    acoes.push(
      c.ativo
        ? { rotulo: 'Desativar', icone: 'fechar', aoClicar: () => alternarAtiva(c) }
        : { rotulo: 'Reativar', icone: 'visto', aoClicar: () => alternarAtiva(c) }
    );
    if (manual) {
      acoes.push({ rotulo: 'Excluir', icone: 'lixeira', perigo: true, aoClicar: () => excluir(c) });
    }
    return acoes;
  }

  const lista = (dados ?? []).filter((c) => c.tipo !== 'CARTAO');
  const listaFiltrada = filtroTipo ? lista.filter((c) => c.tipo === filtroTipo) : lista;

  return (
    <Pagina titulo="Contas">
      <div className="barra-ferramentas">
        <div className="filtros">
          <Selecao
            rotulo="Tipo"
            valor={filtroTipo}
            aoMudar={setFiltroTipo}
            opcoes={TIPOS_SEM_CARTAO}
            vazio="Todos"
          />
          <Caixa rotulo="Mostrar inativas" marcado={mostrarInativas} aoMudar={setMostrarInativas} />
        </div>
        <Botao
          aoClicar={() => {
            setEditando(null);
            setFormAberto(true);
          }}
        >
          Nova conta
        </Botao>
      </div>

      {contasQuery.erro && <Aviso tipo="erro">{contasQuery.erro}</Aviso>}
      {resumoQuery.erro && <Aviso tipo="erro">{resumoQuery.erro}</Aviso>}
      {erroAcao && <Aviso tipo="erro">{erroAcao}</Aviso>}

      {resumo && (
        <div className="resumo">
          <ResumoItem icone="financeiro" cor="azul" valor={formatarReais(resumo.patrimonio)} rotulo="Patrimônio" />
          <ResumoItem icone="contas" cor="verde" valor={formatarReais(resumo.contas)} rotulo="Saldo em contas" />
          <ResumoItem icone="investimentos" cor="roxo" valor={formatarReais(resumo.investimentos)} rotulo="Investimentos" />
          <ResumoItem icone="cartao" cor="laranja" valor={formatarReais(resumo.cartoes)} rotulo="Faturas em aberto" />
        </div>
      )}

      {contasQuery.carregando && <Carregando />}
      {dados && (
        <Tabela<ContaDTO>
          chave={(c) => c.id}
          dados={listaFiltrada}
          vazio="Nenhuma conta cadastrada."
          colunas={[
            {
              titulo: 'Conta',
              celula: (c) => (
                <>
                  <NomeComCor cor={c.cor}>{c.nome}</NomeComCor> <SeloOrigem origem={c.origem} />
                </>
              ),
            },
            { titulo: 'Tipo', celula: (c) => rotuloDe(TIPOS_CONTA, c.tipo) },
            { titulo: 'Instituição', celula: (c) => c.instituicao ?? '—' },
            { titulo: 'Número', celula: (c) => c.numero ?? '—' },
            {
              titulo: 'Saldo',
              alinhar: 'direita',
              celula: (c) => <Valor valor={c.saldo} sentido={c.saldo < 0 ? 'saida' : 'neutro'} />,
            },
            {
              titulo: 'Situação',
              celula: (c) => (c.ativo ? <Selo cor="verde">ATIVA</Selo> : <Selo cor="vermelho">INATIVA</Selo>),
            },
            {
              titulo: 'Ações',
              acoes: true,
              celula: (c) => <MenuAcoes rotulo={'Ações de ' + c.nome} acoes={acoesDe(c)} />,
            },
          ]}
        />
      )}

      <Modal
        aberto={formAberto || editando !== null}
        titulo={editando ? 'Editar conta' : 'Nova conta'}
        aoFechar={fecharFormularios}
      >
        {(formAberto || editando !== null) && (
          <FormConta
            key={editando?.id ?? 'nova'}
            conta={editando}
            aoConcluir={() => {
              fecharFormularios();
              recarregar();
            }}
          />
        )}
      </Modal>

      <Modal aberto={ajustando !== null} titulo="Ajustar saldo" aoFechar={fecharFormularios}>
        {ajustando && (
          <FormSaldo
            key={ajustando.id}
            conta={ajustando}
            aoConcluir={() => {
              fecharFormularios();
              recarregar();
            }}
          />
        )}
      </Modal>
    </Pagina>
  );
}
