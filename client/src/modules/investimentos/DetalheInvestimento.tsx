import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import {
  TIPOS_MOVIMENTO,
  TIPOS_INVESTIMENTO,
  formatarDia,
  formatarReais,
  hojeISO,
  lerValor,
  mensagemErro,
  rotuloDe,
} from '../../lib/financas';
import type { InvestimentoDTO, MovimentoInvestimentoDTO } from '../../lib/financas';
import { Aviso, Botao, Campo, Carregando, MenuAcoes, Modal, Selecao, Tabela, formatarDataHora } from '../../ui';
import type { AcaoMenu, ColunaTabela } from '../../ui';
import { ResumoItem, SeloOrigem, Valor } from '../../ui/financas';

interface RespostaDetalhe {
  investimento: InvestimentoDTO;
  movimentos: MovimentoInvestimentoDTO[];
}

// Formulário "Novo movimento" (só para registros MANUAL).
function FormMovimento({ investimentoId, aoLancar }: { investimentoId: number; aoLancar: () => void }) {
  const [tipo, setTipo] = useState<string>('APLICACAO');
  const [data, setData] = useState(hojeISO());
  const [valor, setValor] = useState('');
  const [descricao, setDescricao] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function lancar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const tipoEscolhido = TIPOS_MOVIMENTO.find((t) => t.valor === tipo)?.valor;
    if (!tipoEscolhido) {
      setErro('Escolha o tipo do movimento.');
      return;
    }
    const numero = lerValor(valor);
    if (numero === null) {
      setErro('Informe um valor válido.');
      return;
    }
    setOcupado(true);
    try {
      await api.post(`/investimentos/${investimentoId}/movimentos`, {
        data,
        tipo: tipoEscolhido,
        valor: numero,
        descricao: descricao.trim() === '' ? null : descricao.trim(),
      });
      setValor('');
      setDescricao('');
      aoLancar();
    } catch (err) {
      setErro(mensagemErro(err));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <form onSubmit={lancar} className="inv-movimento">
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <div className="inv-movimento-campos">
        <Selecao rotulo="Tipo" valor={tipo} aoMudar={setTipo} opcoes={TIPOS_MOVIMENTO} obrigatorio />
        <Campo rotulo="Data" tipo="date" valor={data} aoMudar={setData} obrigatorio />
        <Campo rotulo="Valor (R$)" valor={valor} aoMudar={setValor} obrigatorio />
        <Campo rotulo="Descrição" valor={descricao} aoMudar={setDescricao} />
      </div>
      <div className="pagina-acoes">
        <Botao tipo="submit" desabilitado={ocupado}>
          Lançar
        </Botao>
      </div>
    </form>
  );
}

export function DetalheInvestimento(props: {
  investimentoId: number;
  aoFechar: () => void;
  aoMudar: () => void;
}): JSX.Element {
  const { investimentoId, aoFechar, aoMudar } = props;
  const { dados, carregando, erro, recarregar } = useDados<RespostaDetalhe>('/investimentos/' + investimentoId);
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  const investimento = dados?.investimento;
  const movimentos = dados?.movimentos ?? [];
  const manual = investimento?.origem === 'MANUAL';

  function depoisDeMudar() {
    recarregar();
    aoMudar();
  }

  async function excluirMovimento(m: MovimentoInvestimentoDTO) {
    if (!window.confirm('Excluir este movimento? O saldo e o valor aplicado serão recalculados.')) return;
    setErroAcao(null);
    try {
      await api.del(`/investimentos/${investimentoId}/movimentos/${m.id}`);
      depoisDeMudar();
    } catch (e) {
      setErroAcao(mensagemErro(e));
    }
  }

  const colunas: ColunaTabela<MovimentoInvestimentoDTO>[] = [
    { titulo: 'Data', celula: (m) => formatarDia(m.data) },
    { titulo: 'Tipo', celula: (m) => rotuloDe(TIPOS_MOVIMENTO, m.tipo) },
    { titulo: 'Descrição', celula: (m) => m.descricao ?? '—' },
    {
      titulo: 'Valor',
      alinhar: 'direita',
      celula: (m) => (
        <Valor valor={m.valor} sentido={m.tipo === 'APLICACAO' || m.tipo === 'RENDIMENTO' ? 'entrada' : 'saida'} />
      ),
    },
  ];

  if (manual) {
    colunas.push({
      titulo: 'Ações',
      acoes: true,
      celula: (m) => {
        const acoes: AcaoMenu[] = [
          { rotulo: 'Excluir', icone: 'lixeira', perigo: true, aoClicar: () => excluirMovimento(m) },
        ];
        return <MenuAcoes rotulo={'Ações do movimento de ' + formatarDia(m.data)} acoes={acoes} />;
      },
    });
  }

  return (
    <Modal aberto titulo={investimento?.nome ?? 'Investimento'} aoFechar={aoFechar}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {erroAcao && <Aviso tipo="erro">{erroAcao}</Aviso>}
      {carregando && <Carregando />}

      {investimento && (
        <>
          <div className="resumo">
            <ResumoItem icone="financeiro" cor="azul" valor={formatarReais(investimento.saldo)} rotulo="Saldo" />
            <ResumoItem icone="investimentos" cor="roxo" valor={formatarReais(investimento.valorAplicado)} rotulo="Aplicado" />
            <ResumoItem
              icone={investimento.rendimento >= 0 ? 'seta-cima' : 'seta-baixo'}
              cor={investimento.rendimento >= 0 ? 'verde' : 'vermelho'}
              valor={formatarReais(investimento.rendimento)}
              rotulo="Rendimento"
            />
          </div>

          <p className="fin-suave">
            {[
              rotuloDe(TIPOS_INVESTIMENTO, investimento.tipo),
              investimento.taxa,
              investimento.vencimento ? `Vencimento ${formatarDia(investimento.vencimento)}` : null,
              `Posição de ${formatarDataHora(investimento.dataPosicao)}`,
            ]
              .filter(Boolean)
              .join(' · ')}{' '}
            <SeloOrigem origem={investimento.origem} />
          </p>

          {manual && <FormMovimento investimentoId={investimentoId} aoLancar={depoisDeMudar} />}

          <Tabela<MovimentoInvestimentoDTO>
            chave={(m) => m.id}
            dados={movimentos}
            vazio="Nenhum movimento registrado."
            colunas={colunas}
          />
        </>
      )}
    </Modal>
  );
}
