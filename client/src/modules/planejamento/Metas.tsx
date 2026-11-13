import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import { formatarDia, formatarReais, lerValor, mensagemErro, valorParaCampo } from '../../lib/financas';
import type { ContaDTO, InvestimentoDTO, MetaDTO as MetaBase } from '../../lib/financas';
import { Aviso, Botao, Campo, Carregando, MenuAcoes, Modal, Pagina, Selecao, Selo } from '../../ui';
import type { AcaoMenu } from '../../ui';
import { BarraProgresso, CampoCor, PontoCor, ResumoItem, Vazio } from '../../ui/financas';
import './planejamento.css';

// Meta como a API devolve: pode estar ligada a uma conta ou a um investimento.
type MetaDTO = MetaBase & {
  contaId: number | null;
  investimentoId: number | null;
  origem: { tipo: 'CONTA' | 'INVESTIMENTO'; id: number; nome: string } | null;
};

// Formulário de nova meta (meta = null) ou edição.
// ligacao: 'nenhum' | 'conta:<id>' | 'investimento:<id>'
interface FormMeta {
  nome: string;
  valorAlvo: string;
  valorAtual: string;
  prazo: string;
  cor: string;
  ligacao: string;
}

function formInicial(meta: MetaDTO | null): FormMeta {
  let ligacao = 'nenhum';
  if (meta?.contaId) ligacao = `conta:${meta.contaId}`;
  else if (meta?.investimentoId) ligacao = `investimento:${meta.investimentoId}`;
  return {
    nome: meta?.nome ?? '',
    valorAlvo: valorParaCampo(meta?.valorAlvo),
    valorAtual: valorParaCampo(meta?.valorAtual),
    prazo: meta?.prazo ?? '',
    cor: meta?.cor ?? '#2563eb',
    ligacao,
  };
}

function ligacaoDe(valor: string): { contaId: number | null; investimentoId: number | null } {
  const [tipo, id] = valor.split(':');
  const numero = Number(id);
  if (tipo === 'conta') return { contaId: numero, investimentoId: null };
  if (tipo === 'investimento') return { contaId: null, investimentoId: numero };
  return { contaId: null, investimentoId: null };
}

export function Metas() {
  const { dados, carregando, erro, recarregar } = useDados<MetaDTO[]>('/metas');
  const contas = (useDados<ContaDTO[]>('/contas').dados ?? []).filter((c) => c.tipo !== 'CARTAO');
  const investimentos = useDados<InvestimentoDTO[]>('/investimentos').dados ?? [];
  const [form, setForm] = useState<{ meta: MetaDTO | null } | null>(null);
  const [valorMeta, setValorMeta] = useState<MetaDTO | null>(null);
  const [valorTexto, setValorTexto] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erroForm, setErroForm] = useState<string | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  const lista = dados ?? [];
  const andamento = lista.filter((m) => !m.concluida);
  const guardado = lista.reduce((soma, m) => soma + m.valorAtual, 0);
  const falta = andamento.reduce((soma, m) => soma + Math.max(0, m.valorAlvo - m.valorAtual), 0);

  async function acao(fn: () => Promise<unknown>) {
    setErroAcao(null);
    try {
      await fn();
      recarregar();
    } catch (err) {
      setErroAcao(mensagemErro(err));
    }
  }

  async function alternarConcluida(m: MetaDTO) {
    await acao(() => api.put(`/metas/${m.id}`, { concluida: !m.concluida }));
  }

  async function excluir(m: MetaDTO) {
    if (!window.confirm(`Excluir a meta "${m.nome}"?`)) return;
    await acao(() => api.del(`/metas/${m.id}`));
  }

  function acoesDo(m: MetaDTO): AcaoMenu[] {
    const ligada = m.contaId !== null || m.investimentoId !== null;
    const acoes: AcaoMenu[] = [];
    // Meta ligada recebe o valor da conta ou do investimento, não é preenchida à mão.
    if (!ligada) {
      acoes.push({
        rotulo: 'Adicionar valor',
        icone: 'somar',
        aoClicar: () => {
          setErroForm(null);
          setValorTexto('');
          setValorMeta(m);
        },
      });
    }
    acoes.push({ rotulo: 'Editar', icone: 'lapis', aoClicar: () => abrirForm(m) });
    acoes.push(
      m.concluida
        ? { rotulo: 'Reabrir', icone: 'visto', aoClicar: () => alternarConcluida(m) }
        : { rotulo: 'Marcar como concluída', icone: 'visto', aoClicar: () => alternarConcluida(m) }
    );
    acoes.push({ rotulo: 'Excluir', icone: 'lixeira', perigo: true, aoClicar: () => excluir(m) });
    return acoes;
  }

  function abrirForm(meta: MetaDTO | null) {
    setErroForm(null);
    setForm({ meta });
  }

  async function salvarForm(e: FormEvent, atual: FormMeta) {
    e.preventDefault();
    const ligacao = ligacaoDe(atual.ligacao);
    const ligada = ligacao.contaId !== null || ligacao.investimentoId !== null;
    const valorAlvo = lerValor(atual.valorAlvo);
    const valorAtual = atual.valorAtual.trim() === '' ? 0 : lerValor(atual.valorAtual);
    if (!atual.nome.trim()) {
      setErroForm('Informe o nome da meta.');
      return;
    }
    if (valorAlvo === null || valorAlvo <= 0) {
      setErroForm('Informe um valor válido.');
      return;
    }
    if (!ligada && valorAtual === null) {
      setErroForm('Informe um valor válido.');
      return;
    }
    const corpo = {
      nome: atual.nome.trim(),
      valorAlvo,
      // Ligada: o valor vem do saldo da conta/investimento, então não é enviado.
      ...(ligada ? {} : { valorAtual: valorAtual ?? 0 }),
      prazo: atual.prazo === '' ? null : atual.prazo,
      cor: atual.cor,
      contaId: ligacao.contaId,
      investimentoId: ligacao.investimentoId,
    };
    setErroForm(null);
    setOcupado(true);
    try {
      if (form?.meta) await api.put(`/metas/${form.meta.id}`, corpo);
      else await api.post('/metas', corpo);
      setForm(null);
      recarregar();
    } catch (err) {
      setErroForm(mensagemErro(err));
    } finally {
      setOcupado(false);
    }
  }

  async function salvarValor(e: FormEvent) {
    e.preventDefault();
    if (!valorMeta) return;
    const valor = lerValor(valorTexto);
    if (valor === null || valor <= 0) {
      setErroForm('Informe um valor válido.');
      return;
    }
    setErroForm(null);
    setOcupado(true);
    try {
      await api.put(`/metas/${valorMeta.id}`, { valorAtual: valorMeta.valorAtual + valor });
      setValorMeta(null);
      recarregar();
    } catch (err) {
      setErroForm(mensagemErro(err));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Pagina titulo="Metas" acoes={<Botao aoClicar={() => abrirForm(null)}>Nova meta</Botao>}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {erroAcao && <Aviso tipo="erro">{erroAcao}</Aviso>}

      {dados && (
        <div className="resumo">
          <ResumoItem icone="metas" cor="azul" valor={andamento.length} rotulo="Metas em andamento" />
          <ResumoItem icone="financeiro" cor="verde" valor={formatarReais(guardado)} rotulo="Guardado" />
          <ResumoItem icone="relogio" cor="laranja" valor={formatarReais(falta)} rotulo="Falta guardar" />
        </div>
      )}

      {carregando && <Carregando />}

      {dados && lista.length === 0 && (
        <Vazio
          icone="metas"
          titulo="Nenhuma meta ainda"
          texto="Crie uma meta (reserva de emergência, viagem, entrada do imóvel) e acompanhe quanto falta."
        >
          <Botao aoClicar={() => abrirForm(null)}>Nova meta</Botao>
        </Vazio>
      )}

      {dados && lista.length > 0 && (
        <div className="fin-cartoes">
          {lista.map((m) => (
            <article key={m.id} className="planejamento-meta cartao">
              <div className="planejamento-item-topo">
                <strong>
                  <PontoCor cor={m.cor} /> {m.nome}
                </strong>
                <MenuAcoes rotulo={'Ações de ' + m.nome} acoes={acoesDo(m)} />
              </div>
              {m.concluida && <Selo cor="verde">Concluída</Selo>}
              <span>
                {formatarReais(m.valorAtual)} de {formatarReais(m.valorAlvo)}
              </span>
              <BarraProgresso percentual={m.percentual} cor={m.cor} />
              <span>{m.percentual}%</span>
              {m.origem && <span>Acompanha o saldo de {m.origem.nome}</span>}
              {!m.origem && (m.contaId !== null || m.investimentoId !== null) && (
                <span>
                  A conta ou investimento ligado não existe mais. Mostrando o último valor guardado.
                </span>
              )}
              <span>{m.prazo ? `Prazo: ${formatarDia(m.prazo)}` : 'Sem prazo'}</span>
            </article>
          ))}
        </div>
      )}

      <Modal aberto={form !== null} titulo={form?.meta ? 'Editar meta' : 'Nova meta'} aoFechar={() => setForm(null)}>
        {form && (
          <FormularioMeta
            key={form.meta?.id ?? 'nova'}
            meta={form.meta}
            contas={contas}
            investimentos={investimentos}
            ocupado={ocupado}
            erro={erroForm}
            aoEnviar={salvarForm}
          />
        )}
      </Modal>

      <Modal aberto={valorMeta !== null} titulo="Adicionar valor" aoFechar={() => setValorMeta(null)}>
        {valorMeta && (
          <form onSubmit={salvarValor}>
            {erroForm && <Aviso tipo="erro">{erroForm}</Aviso>}
            <p>
              <strong>{valorMeta.nome}</strong>: {formatarReais(valorMeta.valorAtual)} de{' '}
              {formatarReais(valorMeta.valorAlvo)}
            </p>
            <Campo rotulo="Valor a adicionar (R$)" valor={valorTexto} aoMudar={setValorTexto} obrigatorio />
            <div className="pagina-acoes">
              <Botao tipo="submit" desabilitado={ocupado}>
                Adicionar
              </Botao>
            </div>
          </form>
        )}
      </Modal>
    </Pagina>
  );
}

function FormularioMeta({
  meta,
  contas,
  investimentos,
  ocupado,
  erro,
  aoEnviar,
}: {
  meta: MetaDTO | null;
  contas: ContaDTO[];
  investimentos: InvestimentoDTO[];
  ocupado: boolean;
  erro: string | null;
  aoEnviar: (e: FormEvent, atual: FormMeta) => void;
}) {
  const [campos, setCampos] = useState<FormMeta>(() => formInicial(meta));

  function mudar(parcial: Partial<FormMeta>) {
    setCampos((c) => ({ ...c, ...parcial }));
  }

  const opcoesLigacao = [
    { valor: 'nenhum', rotulo: 'Nenhum (eu informo o valor)' },
    ...contas.map((c) => ({ valor: `conta:${c.id}`, rotulo: `Conta: ${c.nome}` })),
    ...investimentos.map((i) => ({ valor: `investimento:${i.id}`, rotulo: `Investimento: ${i.nome}` })),
  ];
  const ligada = campos.ligacao !== 'nenhum';

  return (
    <form onSubmit={(e) => aoEnviar(e, campos)}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <Campo rotulo="Nome" valor={campos.nome} aoMudar={(v) => mudar({ nome: v })} obrigatorio />
      <Campo rotulo="Valor alvo (R$)" valor={campos.valorAlvo} aoMudar={(v) => mudar({ valorAlvo: v })} obrigatorio />
      <Selecao
        rotulo="Acompanhar o saldo de"
        valor={campos.ligacao}
        aoMudar={(v) => mudar({ ligacao: v })}
        opcoes={opcoesLigacao}
      />
      {!ligada && (
        <Campo rotulo="Já guardado (R$)" valor={campos.valorAtual} aoMudar={(v) => mudar({ valorAtual: v })} />
      )}
      {ligada && (
        <p className="planejamento-sugestao-ajuda">
          O valor guardado é o saldo atual da conta ou do investimento escolhido.
        </p>
      )}
      <Campo rotulo="Prazo" tipo="date" valor={campos.prazo} aoMudar={(v) => mudar({ prazo: v })} />
      <CampoCor rotulo="Cor" valor={campos.cor} aoMudar={(c) => mudar({ cor: c })} />
      <div className="pagina-acoes">
        <Botao tipo="submit" desabilitado={ocupado}>
          Salvar
        </Botao>
      </div>
    </form>
  );
}
