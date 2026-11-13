import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import {
  COR_TIPO_INVESTIMENTO,
  TIPOS_INVESTIMENTO,
  formatarDia,
  formatarPercentual,
  formatarReais,
  lerValor,
  mensagemErro,
  queryString,
  rotuloDe,
  valorParaCampo,
} from '../../lib/financas';
import type { InvestimentoDTO, TipoInvestimento } from '../../lib/financas';
import { Aviso, Botao, Caixa, Campo, Cartao, Carregando, Modal, MenuAcoes, Pagina, Selecao, Tabela } from '../../ui';
import type { AcaoMenu } from '../../ui';
import { BarraProgresso, NomeComCor, ResumoItem, Rosca, SeloOrigem, Valor } from '../../ui/financas';
import { DetalheInvestimento } from './DetalheInvestimento';
import { ImportarPlanilha } from './ImportarPlanilha';
import './investimentos.css';

interface RespostaInvestimentos {
  itens: InvestimentoDTO[];
  total: number;
  aplicado: number;
  rendimento: number;
  porTipo: { tipo: TipoInvestimento; total: number; percentual: number }[];
}

const AVISO_OPEN_FINANCE =
  'Este registro vem do Open Finance e é atualizado automaticamente. Só o nome pode ser alterado.';

function textoOuNulo(texto: string): string | null {
  const limpo = texto.trim();
  return limpo === '' ? null : limpo;
}

// ---------- Criar / editar investimento ----------

function FormInvestimento({
  editando,
  aoConcluir,
}: {
  editando: InvestimentoDTO | null;
  aoConcluir: () => void;
}) {
  const ofEditando = editando?.origem === 'OPEN_FINANCE';
  const [nome, setNome] = useState(editando?.nome ?? '');
  const [tipo, setTipo] = useState<string>(editando?.tipo ?? '');
  const [codigo, setCodigo] = useState(editando?.codigo ?? '');
  const [subtipo, setSubtipo] = useState(editando?.subtipo ?? '');
  const [instituicao, setInstituicao] = useState(editando?.instituicao ?? '');
  const [emissor, setEmissor] = useState(editando?.emissor ?? '');
  const [valorAplicado, setValorAplicado] = useState(editando ? valorParaCampo(editando.valorAplicado) : '');
  const [saldo, setSaldo] = useState(editando ? valorParaCampo(editando.saldo) : '');
  const [quantidade, setQuantidade] = useState(
    editando?.quantidade !== null && editando?.quantidade !== undefined ? String(editando.quantidade).replace('.', ',') : ''
  );
  const [taxa, setTaxa] = useState(editando?.taxa ?? '');
  const [vencimento, setVencimento] = useState(editando?.vencimento ?? '');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);

    let corpo: Record<string, unknown>;
    if (ofEditando) {
      corpo = { nome: nome.trim() };
    } else {
      const tipoEscolhido = TIPOS_INVESTIMENTO.find((t) => t.valor === tipo)?.valor;
      if (!tipoEscolhido) {
        setErro('Escolha o tipo do investimento.');
        return;
      }
      const aplicado = lerValor(valorAplicado);
      if (aplicado === null) {
        setErro('Informe um valor válido.');
        return;
      }
      let saldoFinal = aplicado;
      if (saldo.trim() !== '') {
        const lido = lerValor(saldo);
        if (lido === null) {
          setErro('Informe um saldo válido.');
          return;
        }
        saldoFinal = lido;
      }
      let quantidadeFinal: number | null = null;
      if (quantidade.trim() !== '') {
        const lida = lerValor(quantidade);
        if (lida === null) {
          setErro('Informe uma quantidade válida.');
          return;
        }
        quantidadeFinal = lida;
      }
      corpo = {
        nome: nome.trim(),
        tipo: tipoEscolhido,
        codigo: textoOuNulo(codigo),
        subtipo: textoOuNulo(subtipo),
        instituicao: textoOuNulo(instituicao),
        emissor: textoOuNulo(emissor),
        taxa: textoOuNulo(taxa),
        valorAplicado: aplicado,
        saldo: saldoFinal,
        quantidade: quantidadeFinal,
        vencimento: vencimento === '' ? null : vencimento,
      };
    }

    setOcupado(true);
    try {
      if (editando) {
        await api.put(`/investimentos/${editando.id}`, corpo);
      } else {
        await api.post('/investimentos', corpo);
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
      {ofEditando && <Aviso tipo="info">{AVISO_OPEN_FINANCE}</Aviso>}

      <Campo rotulo="Nome" valor={nome} aoMudar={setNome} obrigatorio />

      {!ofEditando && (
        <>
          <Selecao
            rotulo="Tipo"
            valor={tipo}
            aoMudar={setTipo}
            opcoes={TIPOS_INVESTIMENTO}
            vazio="Selecione"
            obrigatorio
          />
          <div className="fin-linha">
            <Campo rotulo="Código/ticker" valor={codigo} aoMudar={setCodigo} />
            <Campo rotulo="Subtipo (ex.: CDB, Tesouro Selic)" valor={subtipo} aoMudar={setSubtipo} />
          </div>
          <div className="fin-linha">
            <Campo rotulo="Instituição" valor={instituicao} aoMudar={setInstituicao} />
            <Campo rotulo="Emissor" valor={emissor} aoMudar={setEmissor} />
          </div>
          <div className="fin-linha">
            <Campo rotulo="Valor aplicado (R$)" valor={valorAplicado} aoMudar={setValorAplicado} obrigatorio />
            <Campo rotulo="Saldo atual (R$)" valor={saldo} aoMudar={setSaldo} />
          </div>
          <div className="fin-linha">
            <Campo rotulo="Quantidade" valor={quantidade} aoMudar={setQuantidade} />
            <Campo rotulo="Taxa (ex.: 110% do CDI)" valor={taxa} aoMudar={setTaxa} />
          </div>
          <Campo rotulo="Vencimento" tipo="date" valor={vencimento} aoMudar={setVencimento} />
        </>
      )}

      <div className="pagina-acoes">
        <Botao tipo="submit" desabilitado={ocupado}>
          Salvar
        </Botao>
      </div>
    </form>
  );
}

// ---------- Lista ----------

export function Investimentos() {
  const [tipo, setTipo] = useState('');
  const [mostrarInativos, setMostrarInativos] = useState(false);
  const [novo, setNovo] = useState(false);
  const [importando, setImportando] = useState(false);
  const [editando, setEditando] = useState<InvestimentoDTO | null>(null);
  const [detalheId, setDetalheId] = useState<number | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const { dados, carregando, erro, recarregar } = useDados<RespostaInvestimentos>(
    '/investimentos' + queryString({ tipo, inativos: mostrarInativos ? 'true' : '' })
  );

  async function alternarAtivo(i: InvestimentoDTO, ativo: boolean) {
    setErroAcao(null);
    try {
      await api.put(`/investimentos/${i.id}`, { ativo });
      recarregar();
    } catch (e) {
      setErroAcao(mensagemErro(e));
    }
  }

  async function excluir(i: InvestimentoDTO) {
    if (!window.confirm(`Excluir o investimento ${i.nome}? Os movimentos dele também serão apagados.`)) return;
    setErroAcao(null);
    try {
      await api.del(`/investimentos/${i.id}`);
      recarregar();
    } catch (e) {
      setErroAcao(mensagemErro(e));
    }
  }

  // Ações do menu de três pontos. Excluir só para registros MANUAL.
  function acoesDo(i: InvestimentoDTO): AcaoMenu[] {
    const acoes: AcaoMenu[] = [
      { rotulo: 'Ver detalhes', icone: 'documento', aoClicar: () => setDetalheId(i.id) },
      { rotulo: 'Editar', icone: 'lapis', aoClicar: () => setEditando(i) },
    ];
    if (i.ativo) {
      acoes.push({ rotulo: 'Desativar', icone: 'fechar', aoClicar: () => alternarAtivo(i, false) });
    } else {
      acoes.push({ rotulo: 'Reativar', icone: 'visto', aoClicar: () => alternarAtivo(i, true) });
    }
    if (i.origem === 'MANUAL') {
      acoes.push({ rotulo: 'Excluir', icone: 'lixeira', perigo: true, aoClicar: () => excluir(i) });
    }
    return acoes;
  }

  const itens = dados?.itens ?? [];
  const total = dados?.total ?? 0;
  const aplicado = dados?.aplicado ?? 0;
  const rendimento = dados?.rendimento ?? 0;
  const porTipo = dados?.porTipo ?? [];
  const maiores = [...itens].sort((a, b) => b.saldo - a.saldo).slice(0, 5);

  return (
    <Pagina titulo="Investimentos">
      <div className="barra-ferramentas">
        <div className="filtros">
          <Selecao rotulo="Tipo" valor={tipo} aoMudar={setTipo} opcoes={TIPOS_INVESTIMENTO} vazio="Todos" />
          <Caixa
            rotulo="Mostrar resgatados/inativos"
            marcado={mostrarInativos}
            aoMudar={setMostrarInativos}
          />
        </div>
        <Botao variante="secundario" aoClicar={() => setImportando(true)}>
          Importar planilha
        </Botao>
        <Botao aoClicar={() => setNovo(true)}>Novo investimento</Botao>
      </div>

      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {erroAcao && <Aviso tipo="erro">{erroAcao}</Aviso>}

      {dados && (
        <div className="resumo">
          <ResumoItem icone="investimentos" cor="azul" valor={formatarReais(total)} rotulo="Total investido hoje" />
          <ResumoItem icone="financeiro" cor="roxo" valor={formatarReais(aplicado)} rotulo="Valor aplicado" />
          <ResumoItem
            icone={rendimento >= 0 ? 'seta-cima' : 'seta-baixo'}
            cor={rendimento >= 0 ? 'verde' : 'vermelho'}
            valor={formatarReais(rendimento)}
            rotulo="Rendimento"
          />
          <ResumoItem
            icone="grafico"
            cor="laranja"
            valor={aplicado > 0 ? formatarPercentual((rendimento / aplicado) * 100) : '—'}
            rotulo="Rentabilidade"
          />
        </div>
      )}

      {carregando && <Carregando />}

      {dados && (
        <div className="fin-duas-colunas">
          <Cartao titulo="Alocação por tipo">
            {porTipo.length > 0 ? (
              <Rosca
                fatias={porTipo.map((p) => ({
                  rotulo: rotuloDe(TIPOS_INVESTIMENTO, p.tipo),
                  valor: p.total,
                  cor: COR_TIPO_INVESTIMENTO[p.tipo],
                }))}
                centro={formatarReais(total)}
              />
            ) : (
              <p className="fin-suave">Sem investimentos ainda.</p>
            )}
          </Cartao>

          <Cartao titulo="Maiores posições">
            {maiores.length > 0 ? (
              <ul className="inv-maiores">
                {maiores.map((i) => (
                  <li key={i.id} className="inv-maior">
                    <div className="inv-maior-topo">
                      <NomeComCor cor={COR_TIPO_INVESTIMENTO[i.tipo]}>{i.nome}</NomeComCor>
                      <span>{formatarReais(i.saldo)}</span>
                    </div>
                    <BarraProgresso
                      percentual={total > 0 ? (i.saldo / total) * 100 : 0}
                      cor={COR_TIPO_INVESTIMENTO[i.tipo]}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="fin-suave">Sem posições ainda.</p>
            )}
          </Cartao>
        </div>
      )}

      {dados && (
        <Tabela<InvestimentoDTO>
          chave={(i) => i.id}
          dados={itens}
          vazio="Nenhum investimento. Cadastre um aqui ou conecte sua corretora em Conexões."
          aoClicarLinha={(i) => setDetalheId(i.id)}
          colunas={[
            {
              titulo: 'Investimento',
              celula: (i) => {
                const detalhes = [i.codigo, i.subtipo, i.instituicao].filter(Boolean).join(' · ');
                return (
                  <span className="inv-celula-nome">
                    <span className="inv-nome">
                      {i.nome} <SeloOrigem origem={i.origem} />
                    </span>
                    {detalhes && <span className="fin-suave inv-apoio">{detalhes}</span>}
                  </span>
                );
              },
            },
            { titulo: 'Tipo', celula: (i) => rotuloDe(TIPOS_INVESTIMENTO, i.tipo) },
            { titulo: 'Taxa', celula: (i) => i.taxa ?? '—' },
            { titulo: 'Vencimento', celula: (i) => formatarDia(i.vencimento) },
            { titulo: 'Aplicado', alinhar: 'direita', celula: (i) => formatarReais(i.valorAplicado) },
            { titulo: 'Saldo', alinhar: 'direita', celula: (i) => formatarReais(i.saldo) },
            {
              titulo: 'Rendimento',
              alinhar: 'direita',
              celula: (i) => (
                <span className="inv-celula-valor">
                  <Valor valor={i.rendimento} sentido="auto" />
                  {i.rentabilidade !== null && (
                    <span className="fin-suave inv-apoio">{formatarPercentual(i.rentabilidade)}</span>
                  )}
                </span>
              ),
            },
            {
              titulo: 'Ações',
              acoes: true,
              celula: (i) => <MenuAcoes rotulo={'Ações de ' + i.nome} acoes={acoesDo(i)} />,
            },
          ]}
        />
      )}

      <Modal
        aberto={novo || editando !== null}
        titulo={editando ? 'Editar investimento' : 'Novo investimento'}
        aoFechar={() => {
          setNovo(false);
          setEditando(null);
        }}
      >
        {(novo || editando !== null) && (
          <FormInvestimento
            key={editando?.id ?? 'novo'}
            editando={editando}
            aoConcluir={() => {
              setNovo(false);
              setEditando(null);
              recarregar();
            }}
          />
        )}
      </Modal>

      <ImportarPlanilha
        aberto={importando}
        aoFechar={() => setImportando(false)}
        aoConcluir={recarregar}
      />

      {detalheId !== null && (
        <DetalheInvestimento
          investimentoId={detalheId}
          aoFechar={() => setDetalheId(null)}
          aoMudar={recarregar}
        />
      )}
    </Pagina>
  );
}
