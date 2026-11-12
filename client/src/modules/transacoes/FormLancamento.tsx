import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import {
  TIPOS_TRANSACAO,
  hojeISO,
  lerValor,
  mensagemErro,
  valorParaCampo,
} from '../../lib/financas';
import type { CategoriaDTO, ContaDTO, TipoTransacao, TransacaoDTO } from '../../lib/financas';
import { AreaTexto, Aviso, Botao, Caixa, Campo, Selecao } from '../../ui';

const OPCOES_PARCELAS: { valor: string; rotulo: string }[] = [
  { valor: '1', rotulo: 'À vista' },
  ...Array.from({ length: 11 }, (_, i) => ({ valor: String(i + 2), rotulo: `${i + 2}x` })),
];

function paraTipo(texto: string): TipoTransacao {
  return texto === 'RECEITA' ? 'RECEITA' : 'DESPESA';
}

// Texto do campo de categoria ('' = sem categoria) -> id ou null.
function idCategoria(texto: string): number | null {
  return texto === '' ? null : Number(texto);
}

// Texto vazio vira null.
function textoOpcional(texto: string): string | null {
  const limpo = texto.trim();
  return limpo === '' ? null : limpo;
}

export function FormLancamento({
  lancamento,
  contas,
  categorias,
  contaInicialId,
  aoConcluir,
}: {
  lancamento: TransacaoDTO | null;
  contas: ContaDTO[];
  categorias: CategoriaDTO[];
  contaInicialId?: number;
  aoConcluir: () => void;
}): JSX.Element {
  const edicao = lancamento !== null;
  const ehOpenFinance = lancamento?.origem === 'OPEN_FINANCE';

  const [tipo, setTipo] = useState<TipoTransacao>(lancamento?.tipo ?? 'DESPESA');
  const [contaId, setContaId] = useState<string>(
    lancamento ? String(lancamento.contaId) : contaInicialId !== undefined ? String(contaInicialId) : ''
  );
  const [data, setData] = useState(lancamento?.data ?? hojeISO());
  const [descricao, setDescricao] = useState(lancamento?.descricao ?? '');
  const [valor, setValor] = useState(lancamento ? valorParaCampo(lancamento.valor) : '');
  const [categoriaId, setCategoriaId] = useState(
    lancamento?.categoriaId != null ? String(lancamento.categoriaId) : ''
  );
  const [parcelas, setParcelas] = useState('1');
  const [transferencia, setTransferencia] = useState(lancamento?.transferencia ?? false);
  const [observacao, setObservacao] = useState(lancamento?.observacao ?? '');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const contaEscolhida = contas.find((c) => String(c.id) === contaId);
  const mostrarParcelas = !edicao && contaEscolhida?.tipo === 'CARTAO' && tipo === 'DESPESA';
  const contasLancamento = contas.filter((c) => c.ativo && c.origem === 'MANUAL');
  const categoriasDoTipo = categorias.filter((c) => c.tipo === tipo);

  // Trocar o tipo limpa a categoria, pois as categorias são de um tipo só.
  function mudarTipo(texto: string) {
    setTipo(paraTipo(texto));
    setCategoriaId('');
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);

    const numeroValor = lerValor(valor);
    if (!ehOpenFinance && (numeroValor === null || numeroValor <= 0)) {
      setErro('Informe um valor válido.');
      return;
    }

    setOcupado(true);
    try {
      if (lancamento && ehOpenFinance) {
        await api.put(`/transacoes/${lancamento.id}`, {
          categoriaId: idCategoria(categoriaId),
          transferencia,
          observacao: textoOpcional(observacao),
        });
      } else if (lancamento) {
        await api.put(`/transacoes/${lancamento.id}`, {
          data,
          descricao: descricao.trim(),
          valor: numeroValor,
          tipo,
          categoriaId: idCategoria(categoriaId),
          transferencia,
          observacao: textoOpcional(observacao),
        });
      } else {
        const totalParcelas = mostrarParcelas ? Number(parcelas) : 1;
        await api.post('/transacoes', {
          contaId: Number(contaId),
          data,
          descricao: descricao.trim(),
          valor: numeroValor,
          tipo,
          categoriaId: idCategoria(categoriaId),
          transferencia,
          observacao: textoOpcional(observacao),
          ...(totalParcelas > 1 ? { totalParcelas } : {}),
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
      {ehOpenFinance && (
        <Aviso tipo="info">
          Este lançamento vem do Open Finance. Você pode mudar só a categoria, a observação e a marcação de transferência.
        </Aviso>
      )}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      {!ehOpenFinance && (
        <>
          <div className="fin-linha">
            <Selecao
              rotulo="Tipo"
              obrigatorio
              valor={tipo}
              aoMudar={mudarTipo}
              opcoes={TIPOS_TRANSACAO}
            />
            {lancamento ? (
              <Campo rotulo="Conta" valor={lancamento.contaNome} aoMudar={() => undefined} />
            ) : (
              <Selecao
                rotulo="Conta"
                obrigatorio
                valor={contaId}
                aoMudar={setContaId}
                vazio="Selecione a conta"
                opcoes={contasLancamento.map((c) => ({
                  valor: String(c.id),
                  rotulo: c.tipo === 'CARTAO' ? `${c.nome} (cartão)` : c.nome,
                }))}
              />
            )}
          </div>

          <div className="fin-linha">
            <Campo rotulo="Data" tipo="date" obrigatorio valor={data} aoMudar={setData} />
            <Campo rotulo="Valor (R$)" obrigatorio valor={valor} aoMudar={setValor} />
          </div>

          <Campo rotulo="Descrição" obrigatorio valor={descricao} aoMudar={setDescricao} />
        </>
      )}

      <Selecao
        rotulo="Categoria"
        valor={categoriaId}
        aoMudar={setCategoriaId}
        vazio="Sem categoria"
        opcoes={categoriasDoTipo.map((c) => ({ valor: String(c.id), rotulo: c.nome }))}
      />

      {mostrarParcelas && (
        <Selecao rotulo="Parcelas" valor={parcelas} aoMudar={setParcelas} opcoes={OPCOES_PARCELAS} />
      )}

      <Caixa
        rotulo="Transferência entre contas ou pagamento de fatura (não conta como receita/despesa)"
        marcado={transferencia}
        aoMudar={setTransferencia}
      />

      <AreaTexto rotulo="Observação" valor={observacao} aoMudar={setObservacao} />

      <div className="pagina-acoes">
        <Botao tipo="submit" desabilitado={ocupado}>
          Salvar
        </Botao>
      </div>
    </form>
  );
}
