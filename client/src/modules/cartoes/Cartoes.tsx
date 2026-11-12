import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { formatarDia, formatarReais, lerValor, mensagemErro, STATUS_FATURA, valorParaCampo } from '../../lib/financas';
import type { ContaDTO, FaturaDTO } from '../../lib/financas';
import { useDados } from '../../lib/useDados';
import { Aviso, Botao, Campo, Cartao, Carregando, MenuAcoes, Modal, Pagina, Selecao, Selo, Tabela } from '../../ui';
import type { AcaoMenu } from '../../ui';
import { BarraProgresso, CampoCor, ResumoItem, SeloOrigem, Vazio } from '../../ui/financas';
import { DetalheFatura } from './DetalheFatura';
import './cartoes.css';

interface CartaoResumoDTO {
  conta: ContaDTO;
  faturaAtual: FaturaDTO | null;
  percentualUsado: number | null;
}

const BANDEIRAS: { valor: string; rotulo: string }[] = [
  { valor: 'Visa', rotulo: 'Visa' },
  { valor: 'Mastercard', rotulo: 'Mastercard' },
  { valor: 'Elo', rotulo: 'Elo' },
  { valor: 'American Express', rotulo: 'American Express' },
  { valor: 'Hipercard', rotulo: 'Hipercard' },
  { valor: 'Outra', rotulo: 'Outra' },
];

// Campo de dinheiro opcional: vazio vira null; texto inválido vira 'invalido'.
function valorOpcional(texto: string): number | null | 'invalido' {
  if (texto.trim() === '') return null;
  return lerValor(texto) ?? 'invalido';
}

// Dia do mês (1 a 31) opcional: vazio vira null; fora da faixa vira 'invalido'.
function diaOpcional(texto: string): number | null | 'invalido' {
  if (texto.trim() === '') return null;
  const n = Number(texto);
  return Number.isInteger(n) && n >= 1 && n <= 31 ? n : 'invalido';
}

function textoOuNulo(texto: string): string | null {
  const limpo = texto.trim();
  return limpo === '' ? null : limpo;
}

// ---------- Criar / editar cartão ----------

function FormCartao({ conta, aoConcluir }: { conta: ContaDTO | null; aoConcluir: (novoId?: number) => void }) {
  const edicao = conta !== null;
  const somenteNomeCor = conta?.origem === 'OPEN_FINANCE';
  const [nome, setNome] = useState(conta?.nome ?? '');
  const [instituicao, setInstituicao] = useState(conta?.instituicao ?? '');
  const [numero, setNumero] = useState(conta?.numero ?? '');
  const [bandeira, setBandeira] = useState(conta?.bandeira ?? '');
  const [limite, setLimite] = useState(valorParaCampo(conta?.limite));
  const [diaFechamento, setDiaFechamento] = useState(conta?.diaFechamento?.toString() ?? '');
  const [diaVencimento, setDiaVencimento] = useState(conta?.diaVencimento?.toString() ?? '');
  const [saldoAtual, setSaldoAtual] = useState('');
  const [cor, setCor] = useState(conta?.cor ?? '#2563eb');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const limiteNumero = valorOpcional(limite);
    const saldoNumero = valorOpcional(saldoAtual);
    const fechamento = diaOpcional(diaFechamento);
    const vencimento = diaOpcional(diaVencimento);
    if (limiteNumero === 'invalido' || saldoNumero === 'invalido') {
      setErro('Informe um valor válido.');
      return;
    }
    if (fechamento === 'invalido' || vencimento === 'invalido') {
      setErro('Os dias devem estar entre 1 e 31.');
      return;
    }
    setOcupado(true);
    try {
      if (conta && somenteNomeCor) {
        await api.put('/contas/' + conta.id, { nome: nome.trim(), cor });
        aoConcluir();
      } else if (conta) {
        await api.put('/contas/' + conta.id, {
          nome: nome.trim(),
          instituicao: textoOuNulo(instituicao),
          numero: textoOuNulo(numero),
          cor,
          bandeira: textoOuNulo(bandeira),
          limite: limiteNumero,
          diaFechamento: fechamento,
          diaVencimento: vencimento,
        });
        aoConcluir();
      } else {
        const criado = await api.post<ContaDTO>('/contas', {
          nome: nome.trim(),
          tipo: 'CARTAO',
          instituicao: textoOuNulo(instituicao),
          numero: textoOuNulo(numero),
          bandeira: textoOuNulo(bandeira),
          limite: limiteNumero,
          diaFechamento: fechamento,
          diaVencimento: vencimento,
          ...(saldoNumero !== null ? { saldo: saldoNumero } : {}),
          cor,
        });
        aoConcluir(criado.id);
      }
    } catch (err) {
      setErro(mensagemErro(err));
      setOcupado(false);
    }
  }

  return (
    <form onSubmit={salvar}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {somenteNomeCor && (
        <Aviso tipo="info">Este cartão vem do Open Finance. Aqui você pode alterar só o nome e a cor.</Aviso>
      )}
      <Campo rotulo="Nome" valor={nome} aoMudar={setNome} obrigatorio />
      {!somenteNomeCor && (
        <>
          <Campo rotulo="Instituição" valor={instituicao} aoMudar={setInstituicao} />
          <Selecao
            rotulo="Bandeira"
            valor={bandeira}
            aoMudar={setBandeira}
            opcoes={BANDEIRAS}
            vazio="Não informar"
          />
          <Campo rotulo="Final do cartão" valor={numero} aoMudar={setNumero} />
          <Campo rotulo="Limite (R$)" valor={limite} aoMudar={setLimite} />
          <Campo rotulo="Dia do fechamento" tipo="number" valor={diaFechamento} aoMudar={setDiaFechamento} />
          <Campo rotulo="Dia do vencimento" tipo="number" valor={diaVencimento} aoMudar={setDiaVencimento} />
          {!edicao && (
            <Campo rotulo="Fatura em aberto hoje (R$)" valor={saldoAtual} aoMudar={setSaldoAtual} />
          )}
        </>
      )}
      <CampoCor rotulo="Cor" valor={cor} aoMudar={setCor} />
      <div className="pagina-acoes">
        <Botao tipo="submit" desabilitado={ocupado}>
          {edicao ? 'Salvar cartão' : 'Criar cartão'}
        </Botao>
      </div>
    </form>
  );
}

// ---------- Tela ----------

export function Cartoes() {
  const navigate = useNavigate();
  const cartoesDados = useDados<CartaoResumoDTO[]>('/cartoes');
  const [cartaoId, setCartaoId] = useState<number | null>(null);
  const [faturaId, setFaturaId] = useState<number | null>(null);
  const [formulario, setFormulario] = useState<{ conta: ContaDTO | null } | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const faturas = useDados<FaturaDTO[]>(cartaoId ? '/faturas?contaId=' + cartaoId : null);

  // Ao carregar a lista, mantém o cartão escolhido ou seleciona o primeiro.
  useEffect(() => {
    const lista = cartoesDados.dados;
    if (!lista) return;
    setCartaoId((atual) => (lista.some((c) => c.conta.id === atual) ? atual : lista[0]?.conta.id ?? null));
  }, [cartoesDados.dados]);

  const cartoes = cartoesDados.dados ?? [];
  const selecionado = cartoes.find((c) => c.conta.id === cartaoId) ?? null;

  const emAberto = cartoes.reduce((soma, c) => soma + c.conta.saldo, 0);
  const limiteTotal = cartoes.reduce((soma, c) => soma + (c.conta.limite ?? 0), 0);
  const limiteDisponivel = cartoes.reduce((soma, c) => {
    const { limite, limiteDisponivel: disponivel, saldo } = c.conta;
    if (disponivel !== null) return soma + disponivel;
    if (limite !== null) return soma + (limite - saldo);
    return soma;
  }, 0);

  function recarregarTudo() {
    cartoesDados.recarregar();
    faturas.recarregar();
  }

  async function excluirCartao(conta: ContaDTO) {
    if (!window.confirm(`Excluir o cartão ${conta.nome}? As faturas e os lançamentos dele também serão apagados.`)) {
      return;
    }
    setErroAcao(null);
    try {
      await api.del('/contas/' + conta.id);
      recarregarTudo();
    } catch (e) {
      setErroAcao(mensagemErro(e));
    }
  }

  function acoesDo(conta: ContaDTO): AcaoMenu[] {
    const acoes: AcaoMenu[] = [
      { rotulo: 'Editar', icone: 'lapis', aoClicar: () => setFormulario({ conta }) },
      {
        rotulo: 'Ver lançamentos',
        icone: 'transacoes',
        aoClicar: () => navigate('/app/transacoes?conta=' + conta.id),
      },
    ];
    if (conta.origem === 'MANUAL') {
      acoes.push({ rotulo: 'Excluir', icone: 'lixeira', perigo: true, aoClicar: () => excluirCartao(conta) });
    }
    return acoes;
  }

  return (
    <Pagina titulo="Cartões" acoes={<Botao aoClicar={() => setFormulario({ conta: null })}>Novo cartão</Botao>}>
      {cartoesDados.erro && <Aviso tipo="erro">{cartoesDados.erro}</Aviso>}
      {erroAcao && <Aviso tipo="erro">{erroAcao}</Aviso>}
      {cartoesDados.carregando && <Carregando />}

      {cartoesDados.dados && cartoes.length > 0 && (
        <>
          <div className="resumo">
            <ResumoItem icone="cartao" cor="laranja" valor={formatarReais(emAberto)} rotulo="Faturas em aberto" />
            <ResumoItem icone="financeiro" cor="azul" valor={formatarReais(limiteTotal)} rotulo="Limite total" />
            <ResumoItem icone="visto" cor="verde" valor={formatarReais(limiteDisponivel)} rotulo="Limite disponível" />
          </div>

          <div className="fin-cartoes">
            {cartoes.map(({ conta, faturaAtual, percentualUsado }) => {
              const ativo = conta.id === cartaoId;
              return (
                <button
                  key={conta.id}
                  type="button"
                  className={ativo ? 'cartoes-cartao cartoes-cartao-ativo' : 'cartoes-cartao'}
                  style={{
                    background: `linear-gradient(135deg, ${conta.cor}, color-mix(in srgb, ${conta.cor} 55%, #000))`,
                  }}
                  aria-pressed={ativo}
                  onClick={() => setCartaoId(conta.id)}
                >
                  <span className="cartoes-cartao-linha">
                    <strong>{conta.nome}</strong>
                    <span>{conta.bandeira ?? ''}</span>
                  </span>
                  <span className="cartoes-cartao-numero">•••• {conta.numero ?? '••••'}</span>
                  <span className="cartoes-cartao-linha">
                    <span>Fatura atual</span>
                    <strong>{formatarReais(conta.saldo)}</strong>
                  </span>
                  {faturaAtual && <span>Vence em {formatarDia(faturaAtual.vencimento)}</span>}
                  <BarraProgresso percentual={percentualUsado ?? 0} />
                  {conta.limite !== null && <span>Limite: {formatarReais(conta.limite)}</span>}
                  <SeloOrigem origem={conta.origem} />
                </button>
              );
            })}
          </div>

          {selecionado && (
            <Cartao>
              <div className="fin-cabecalho">
                <h2 className="cartao-titulo">Faturas de {selecionado.conta.nome}</h2>
                <MenuAcoes rotulo={'Ações de ' + selecionado.conta.nome} acoes={acoesDo(selecionado.conta)} />
              </div>
              {faturas.erro && <Aviso tipo="erro">{faturas.erro}</Aviso>}
              {faturas.carregando && <Carregando />}
              {faturas.dados && (
                <Tabela<FaturaDTO>
                  chave={(f) => f.id}
                  dados={faturas.dados}
                  vazio="Nenhuma fatura ainda. As faturas aparecem quando você lança compras no cartão ou conecta o banco em Conexões."
                  aoClicarLinha={(f) => setFaturaId(f.id)}
                  colunas={[
                    { titulo: 'Vencimento', celula: (f) => formatarDia(f.vencimento) },
                    { titulo: 'Fechamento', celula: (f) => formatarDia(f.fechamento) },
                    { titulo: 'Total', alinhar: 'direita', celula: (f) => formatarReais(f.total) },
                    {
                      titulo: 'Situação',
                      celula: (f) => <Selo cor={STATUS_FATURA[f.status].cor}>{STATUS_FATURA[f.status].rotulo}</Selo>,
                    },
                    { titulo: 'Pagamento', celula: (f) => formatarDia(f.pagaEm) },
                  ]}
                />
              )}
            </Cartao>
          )}
        </>
      )}

      {cartoesDados.dados && cartoes.length === 0 && (
        <Vazio
          icone="cartao"
          titulo="Nenhum cartão cadastrado"
          texto="Cadastre um cartão aqui ou conecte seu banco em Conexões para trazer cartões e faturas automaticamente."
        >
          <Botao aoClicar={() => setFormulario({ conta: null })}>Novo cartão</Botao>
        </Vazio>
      )}

      <Modal
        aberto={formulario !== null}
        titulo={formulario?.conta ? 'Editar cartão' : 'Novo cartão'}
        aoFechar={() => setFormulario(null)}
      >
        {formulario && (
          <FormCartao
            key={formulario.conta?.id ?? 'novo'}
            conta={formulario.conta}
            aoConcluir={(novoId) => {
              setFormulario(null);
              if (novoId !== undefined) setCartaoId(novoId);
              recarregarTudo();
            }}
          />
        )}
      </Modal>

      {faturaId !== null && (
        <DetalheFatura faturaId={faturaId} aoFechar={() => setFaturaId(null)} aoMudar={recarregarTudo} />
      )}
    </Pagina>
  );
}
