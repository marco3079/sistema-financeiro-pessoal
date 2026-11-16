import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { formatarDia, mensagemErro, rotuloDe, TIPOS_TRANSACAO } from '../../lib/financas';
import type { CategoriaDTO, ContaDTO } from '../../lib/financas';
import { useDados } from '../../lib/useDados';
import { Aviso, Botao, Campo, Caixa, Cartao, Carregando, Modal, MenuAcoes, Pagina, Selecao, Selo } from '../../ui';
import { Valor, Vazio } from '../../ui/financas';
import type { AcaoMenu } from '../../ui';
import {
  ACOES_AUTOMACAO,
  acoesDoTipo,
  DIAS_PADRAO,
  INFO_TIPO,
  montarConfig,
  montarDados,
  plural,
  ROTULO_ACAO,
  TIPOS_AUTOMACAO,
  rascunhoDe,
  resumoCondicoes,
  rotuloAcao,
} from './tipos';
import type { AcaoAutomacao, AutomacaoDTO, PreviaDTO, Rascunho, ResultadoAplicarDTO, TipoAutomacao } from './tipos';
import './automacoes.css';

// ---------- Criar / editar automação ----------

function tipoDe(valor: string): TipoAutomacao {
  return TIPOS_AUTOMACAO.find((t) => t === valor) ?? 'PAR_CONTAS';
}

function acaoDe(valor: string): AcaoAutomacao {
  return ACOES_AUTOMACAO.find((a) => a === valor) ?? 'TRANSFERENCIA';
}

// Contas que podem ser escolhidas para o tipo: nos pares entre contas, sem cartões.
function contasDoTipo(tipo: TipoAutomacao, contas: ContaDTO[]): ContaDTO[] {
  const campos = INFO_TIPO[tipo].campos;
  if (campos.contas === null) return [];
  if (campos.contas === 'comuns') return contas.filter((c) => c.tipo !== 'CARTAO');
  return contas;
}

function FormAutomacao({
  automacao,
  categorias,
  contas,
  aoSalvo,
}: {
  automacao: AutomacaoDTO | null;
  categorias: CategoriaDTO[];
  contas: ContaDTO[];
  aoSalvo: () => void;
}) {
  const [r, setR] = useState<Rascunho>(() => rascunhoDe(automacao));
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const info = INFO_TIPO[r.tipo];
  const campos = info.campos;
  const listaContas = contasDoTipo(r.tipo, contas);
  const padraoDias = DIAS_PADRAO[r.tipo];

  function mudar<K extends keyof Rascunho>(campo: K, valor: Rascunho[K]) {
    setR((anterior) => ({ ...anterior, [campo]: valor }));
  }

  // Se o tipo novo não aceita a ação de categoria, volta para "Marcar como transferência".
  function mudarTipo(novo: TipoAutomacao) {
    setR((anterior) => ({
      ...anterior,
      tipo: novo,
      acao: acoesDoTipo(novo).includes(anterior.acao) ? anterior.acao : 'TRANSFERENCIA',
    }));
  }

  function alternarConta(id: number, marcado: boolean) {
    setR((anterior) => ({
      ...anterior,
      contaIds: marcado ? [...anterior.contaIds, id] : anterior.contaIds.filter((c) => c !== id),
    }));
  }

  const rotuloTextos =
    r.tipo === 'TEXTO' || r.tipo === 'COMBINADA'
      ? 'Descrição contém (separe por vírgula)'
      : 'Descrição contém (opcional; separe por vírgula)';

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const nome = r.nome.trim();
    if (nome.length < 1 || nome.length > 80) {
      setErro('O nome precisa ter de 1 a 80 letras.');
      return;
    }
    if (!acoesDoTipo(r.tipo).includes(r.acao)) {
      setErro('Este tipo não aceita a ação escolhida. Escolha outra ação.');
      return;
    }
    if (r.acao === 'CATEGORIA' && r.categoriaId === '') {
      setErro('Escolha a categoria.');
      return;
    }
    // Descarta contas que não valem mais para o tipo escolhido (ex.: cartão em um par).
    const idsValidos = listaContas.map((c) => c.id);
    const rComContas: Rascunho = { ...r, nome, contaIds: r.contaIds.filter((id) => idsValidos.includes(id)) };
    const montado = montarConfig(rComContas);
    if ('erro' in montado) {
      setErro(montado.erro);
      return;
    }
    const corpo = montarDados(rComContas, montado.config);
    setOcupado(true);
    try {
      if (automacao) await api.put('/automacoes/' + automacao.id, corpo);
      else await api.post('/automacoes', corpo);
      aoSalvo();
    } catch (err) {
      setErro(mensagemErro(err));
      setOcupado(false);
    }
  }

  return (
    <form onSubmit={salvar}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      <Campo rotulo="Nome" valor={r.nome} aoMudar={(v) => mudar('nome', v)} obrigatorio />

      <Selecao
        rotulo="Tipo"
        valor={r.tipo}
        aoMudar={(v) => mudarTipo(tipoDe(v))}
        obrigatorio
        opcoes={TIPOS_AUTOMACAO.map((t) => ({ valor: t, rotulo: INFO_TIPO[t].rotulo }))}
      />
      <p className="automacoes-ajuda">{info.explicacao}</p>

      <Selecao
        rotulo="Ação"
        valor={r.acao}
        aoMudar={(v) => mudar('acao', acaoDe(v))}
        obrigatorio
        opcoes={acoesDoTipo(r.tipo).map((a) => ({ valor: a, rotulo: ROTULO_ACAO[a] }))}
      />
      {r.acao === 'CATEGORIA' && (
        <Selecao
          rotulo="Categoria"
          valor={r.categoriaId}
          aoMudar={(v) => mudar('categoriaId', v)}
          vazio="Escolha a categoria"
          obrigatorio
          opcoes={categorias.map((c) => ({
            valor: String(c.id),
            rotulo: `${rotuloDe(TIPOS_TRANSACAO, c.tipo)}: ${c.nome}`,
          }))}
        />
      )}

      <p className="automacoes-ajuda">Condições: preencha só o que importa. Os campos vazios não valem.</p>

      {campos.diasMax && (
        <>
          <Campo rotulo="Em até quantos dias" tipo="number" valor={r.diasMax} aoMudar={(v) => mudar('diasMax', v)} />
          <p className="automacoes-ajuda">
            {padraoDias !== undefined
              ? `Em branco usa ${plural(padraoDias, 'dia', 'dias')}.`
              : 'Use um número de 0 a 60.'}
          </p>
        </>
      )}

      {campos.tolerancia && (
        <Campo
          rotulo="Diferença de valor aceita (R$)"
          valor={r.tolerancia}
          aoMudar={(v) => mudar('tolerancia', v)}
        />
      )}

      {campos.entradaSaida && (
        <>
          <Campo
            rotulo="Entrada contém (separe por vírgula)"
            valor={r.textosEntrada}
            aoMudar={(v) => mudar('textosEntrada', v)}
          />
          <Campo
            rotulo="Saída contém (separe por vírgula)"
            valor={r.textosSaida}
            aoMudar={(v) => mudar('textosSaida', v)}
          />
        </>
      )}

      {campos.valor && (
        <>
          <Campo rotulo="Valor mínimo (R$)" valor={r.valorMin} aoMudar={(v) => mudar('valorMin', v)} />
          <Campo rotulo="Valor máximo (R$)" valor={r.valorMax} aoMudar={(v) => mudar('valorMax', v)} />
        </>
      )}

      {campos.textos && (
        <Campo
          rotulo={rotuloTextos}
          valor={r.textos}
          aoMudar={(v) => mudar('textos', v)}
          obrigatorio={campos.textosObrigatorio}
        />
      )}

      {campos.tipoLancamento && (
        <Selecao
          rotulo="Tipo de lançamento"
          valor={r.tipoLancamento}
          aoMudar={(v) => mudar('tipoLancamento', v === 'RECEITA' ? 'RECEITA' : v === 'DESPESA' ? 'DESPESA' : '')}
          vazio="Todos"
          opcoes={[
            { valor: 'RECEITA', rotulo: 'Entradas' },
            { valor: 'DESPESA', rotulo: 'Saídas' },
          ]}
        />
      )}

      {listaContas.length > 0 && (
        <div className="automacoes-contas">
          <span className="campo-rotulo">Contas (sem marcar nenhuma, vale para todas)</span>
          {listaContas.map((c) => (
            <Caixa
              key={c.id}
              rotulo={c.nome}
              marcado={r.contaIds.includes(c.id)}
              aoMudar={(marcado) => alternarConta(c.id, marcado)}
            />
          ))}
        </div>
      )}

      <Caixa rotulo="Ativa" marcado={r.ativa} aoMudar={(v) => mudar('ativa', v)} />

      <div className="pagina-acoes">
        <Botao tipo="submit" desabilitado={ocupado}>
          Salvar
        </Botao>
      </div>
    </form>
  );
}

// ---------- Prévia ----------

function PreviaCorpo({ dados, mostrarNomes }: { dados: PreviaDTO; mostrarNomes: boolean }) {
  return (
    <div className="automacoes-previa">
      <p className="automacoes-resumo">
        {`${plural(dados.lancamentos, 'lançamento', 'lançamentos')} em ${plural(dados.total, 'grupo', 'grupos')}.`}
      </p>
      {dados.lancamentos === 0 && <Aviso tipo="info">Nenhum lançamento mudaria.</Aviso>}
      {dados.total > dados.propostas.length && (
        <Aviso tipo="info">{`Mostrando os primeiros ${dados.propostas.length}.`}</Aviso>
      )}

      {dados.propostas.map((p) => (
        <div className="automacoes-grupo" key={`${p.automacaoId}-${p.lancamentos[0]?.id ?? 0}`}>
          {mostrarNomes && <strong className="automacoes-grupo-nome">{p.automacaoNome}</strong>}
          {p.lancamentos.map((l) => (
            <div className="automacoes-linha" key={`${p.automacaoId}-${l.id}`}>
              <span className="automacoes-linha-data">{formatarDia(l.data)}</span>
              <span className="automacoes-linha-descricao">{l.descricao}</span>
              <span className="automacoes-linha-conta">{l.contaNome}</span>
              <Valor valor={l.valor} sentido={l.tipo === 'RECEITA' ? 'entrada' : 'saida'} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ---------- Tela ----------

type AcaoConfirmada = 'aplicar' | 'desfazer' | 'excluir';

interface PreviaAberta {
  automacao: AutomacaoDTO | null; // null = todas
  dados: PreviaDTO | null;
  erro: string | null;
  carregando: boolean;
}

interface Confirmacao {
  acao: AcaoConfirmada;
  automacao: AutomacaoDTO | null; // em 'aplicar' null = todas
}

export function Automacoes() {
  const automacoes = useDados<AutomacaoDTO[]>('/automacoes');
  const categorias = useDados<CategoriaDTO[]>('/categorias');
  const contas = useDados<ContaDTO[]>('/contas?inativas=true');

  const [aviso, setAviso] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);
  const [ocupadoPadrao, setOcupadoPadrao] = useState(false);

  const [formulario, setFormulario] = useState<{ automacao: AutomacaoDTO | null } | null>(null);
  const [previa, setPrevia] = useState<PreviaAberta | null>(null);
  const previaRequisicao = useRef(0);

  const [confirmacao, setConfirmacao] = useState<Confirmacao | null>(null);
  const [ocupadoConfirmacao, setOcupadoConfirmacao] = useState(false);
  const [erroConfirmacao, setErroConfirmacao] = useState<string | null>(null);

  async function criarPadrao() {
    setAviso(null);
    setOcupadoPadrao(true);
    try {
      const r = await api.post<{ criadas: number }>('/automacoes/padrao');
      setAviso({
        tipo: 'sucesso',
        texto: r.criadas > 0 ? plural(r.criadas, 'automação criada', 'automações criadas') : 'As automações padrão já existem',
      });
      automacoes.recarregar();
    } catch (err) {
      setAviso({ tipo: 'erro', texto: mensagemErro(err) });
    } finally {
      setOcupadoPadrao(false);
    }
  }

  async function abrirPrevia(automacao: AutomacaoDTO | null) {
    const requisicao = ++previaRequisicao.current;
    setPrevia({ automacao, dados: null, erro: null, carregando: true });
    try {
      const dados = await api.post<PreviaDTO>('/automacoes/previa', automacao ? { automacaoId: automacao.id } : {});
      if (requisicao !== previaRequisicao.current) return; // resposta de uma prévia antiga
      setPrevia((p) => (p ? { ...p, dados, carregando: false } : p));
    } catch (err) {
      if (requisicao !== previaRequisicao.current) return;
      setPrevia((p) => (p ? { ...p, erro: mensagemErro(err), carregando: false } : p));
    }
  }

  function abrirConfirmacao(acao: AcaoConfirmada, automacao: AutomacaoDTO | null) {
    setErroConfirmacao(null);
    setConfirmacao({ acao, automacao });
  }

  function fecharConfirmacao() {
    if (ocupadoConfirmacao) return;
    setConfirmacao(null);
  }

  async function alternarAtiva(a: AutomacaoDTO) {
    setAviso(null);
    try {
      await api.put('/automacoes/' + a.id, { ativa: !a.ativa });
      setAviso({ tipo: 'sucesso', texto: a.ativa ? `"${a.nome}" desligada.` : `"${a.nome}" ativada.` });
      automacoes.recarregar();
    } catch (err) {
      setAviso({ tipo: 'erro', texto: mensagemErro(err) });
    }
  }

  async function confirmar() {
    if (!confirmacao) return;
    const { acao, automacao } = confirmacao;
    setOcupadoConfirmacao(true);
    setErroConfirmacao(null);
    try {
      if (acao === 'excluir') {
        if (!automacao) return;
        await api.del('/automacoes/' + automacao.id);
        setAviso({ tipo: 'sucesso', texto: `"${automacao.nome}" excluída.` });
      } else if (acao === 'desfazer') {
        if (!automacao) return;
        const r = await api.post<{ desfeitos: number }>(`/automacoes/${automacao.id}/desfazer`);
        setAviso({ tipo: 'sucesso', texto: `${plural(r.desfeitos, 'lançamento voltou', 'lançamentos voltaram')} ao normal.` });
      } else {
        const r = await api.post<ResultadoAplicarDTO>('/automacoes/aplicar', automacao ? { automacaoId: automacao.id } : {});
        setAviso({ tipo: 'sucesso', texto: `Pronto: ${plural(r.aplicados, 'lançamento alterado', 'lançamentos alterados')}.` });
      }
      setConfirmacao(null);
      automacoes.recarregar();
    } catch (err) {
      setErroConfirmacao(mensagemErro(err));
    } finally {
      setOcupadoConfirmacao(false);
    }
  }

  function textoConfirmacao(c: Confirmacao): string {
    if (c.acao === 'excluir') {
      return `Excluir a automação "${c.automacao?.nome ?? ''}"? O que ela já fez continua como está; para voltar atrás, use Desfazer antes. Se ela tirava lançamentos da lista, eles voltam a aparecer.`;
    }
    if (c.acao === 'desfazer') {
      return `Desfazer o que "${c.automacao?.nome ?? ''}" fez? Os lançamentos que ela alterou voltam ao normal.`;
    }
    if (c.automacao) {
      return `Aplicar "${c.automacao.nome}" aos lançamentos que já existem? Os que ela encontrar vão mudar.`;
    }
    return 'Aplicar todas as automações ligadas aos lançamentos que já existem? Os que elas encontrarem vão mudar.';
  }

  function acoesDaAutomacao(a: AutomacaoDTO): AcaoMenu[] {
    return [
      { rotulo: 'Ver o que mudaria', aoClicar: () => void abrirPrevia(a) },
      { rotulo: 'Aplicar aos antigos', aoClicar: () => abrirConfirmacao('aplicar', a) },
      { rotulo: a.ativa ? 'Desligar' : 'Ativar', aoClicar: () => void alternarAtiva(a) },
      { rotulo: 'Editar', aoClicar: () => setFormulario({ automacao: a }) },
      { rotulo: 'Desfazer o que ela fez', aoClicar: () => abrirConfirmacao('desfazer', a) },
      { rotulo: 'Excluir', perigo: true, aoClicar: () => abrirConfirmacao('excluir', a) },
    ];
  }

  const carregouTudo = automacoes.dados !== null && categorias.dados !== null && contas.dados !== null;

  return (
    <Pagina
      titulo="Automações"
      acoes={
        <>
          <Botao
            variante="secundario"
            aoClicar={() => void criarPadrao()}
            desabilitado={ocupadoPadrao || !automacoes.dados}
          >
            {ocupadoPadrao ? 'Criando...' : 'Criar automações padrão'}
          </Botao>
          <Botao aoClicar={() => setFormulario({ automacao: null })} desabilitado={!carregouTudo}>
            Nova automação
          </Botao>
        </>
      }
    >
      <p className="automacoes-ajuda">
        Cada automação tem condições e uma ação. Elas rodam sozinhas nos lançamentos novos; para os antigos, veja a prévia e
        aplique.
      </p>

      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}
      {automacoes.erro && <Aviso tipo="erro">{automacoes.erro}</Aviso>}
      {automacoes.carregando && <Carregando />}

      {automacoes.dados &&
        (automacoes.dados.length === 0 ? (
          <Cartao>
            <Vazio
              icone="raio"
              titulo="Nenhuma automação ainda"
              texto='Use "Criar automações padrão" para começar com as mais comuns, ou crie a sua em "Nova automação".'
            />
          </Cartao>
        ) : (
          <div className="automacoes-itens">
            {automacoes.dados.map((a) => (
              <Cartao key={a.id}>
                <div className="automacoes-cabecalho">
                  <div className="automacoes-titulo">
                    <h3 className="automacoes-nome">{a.nome}</h3>
                    <span className="automacoes-tipo">{INFO_TIPO[a.tipo].rotulo}</span>
                  </div>
                  <div className="automacoes-cabecalho-acoes">
                    <Selo cor={a.ativa ? 'verde' : 'cinza'}>{a.ativa ? 'Ativa' : 'Desligada'}</Selo>
                    <MenuAcoes rotulo={`Ações da automação ${a.nome}`} acoes={acoesDaAutomacao(a)} />
                  </div>
                </div>
                <p className="automacoes-condicoes">{resumoCondicoes(a)}</p>
                <p className="automacoes-acao">{rotuloAcao(a)}</p>
                <p className="automacoes-contagem">
                  {plural(a.aplicados, 'lançamento alterado', 'lançamentos alterados')}
                </p>
              </Cartao>
            ))}
          </div>
        ))}

      {automacoes.dados && (
        <Cartao titulo="Lançamentos que já existem">
          <p className="automacoes-ajuda">
            Veja o que todas as automações ligadas mudariam antes de aplicar.
          </p>
          <div className="pagina-acoes">
            <Botao variante="secundario" aoClicar={() => void abrirPrevia(null)}>
              Ver o que todas mudariam
            </Botao>
            <Botao
              aoClicar={() => abrirConfirmacao('aplicar', null)}
              desabilitado={automacoes.dados.length === 0}
            >
              Aplicar todas
            </Botao>
          </div>
        </Cartao>
      )}

      {categorias.erro && <Aviso tipo="erro">{categorias.erro}</Aviso>}
      {contas.erro && <Aviso tipo="erro">{contas.erro}</Aviso>}

      <Modal
        aberto={formulario !== null}
        titulo={formulario?.automacao ? 'Editar automação' : 'Nova automação'}
        aoFechar={() => setFormulario(null)}
      >
        {formulario && categorias.dados && contas.dados && (
          <FormAutomacao
            key={formulario.automacao?.id ?? 'nova'}
            automacao={formulario.automacao}
            categorias={categorias.dados}
            contas={contas.dados}
            aoSalvo={() => {
              setFormulario(null);
              setAviso({ tipo: 'sucesso', texto: 'Automação salva.' });
              automacoes.recarregar();
            }}
          />
        )}
      </Modal>

      <Modal
        aberto={previa !== null}
        titulo={previa?.automacao ? `Prévia: ${previa.automacao.nome}` : 'Prévia de todas as automações'}
        aoFechar={() => setPrevia(null)}
      >
        {previa && (
          <div>
            {previa.carregando && <Carregando />}
            {previa.erro && <Aviso tipo="erro">{previa.erro}</Aviso>}
            {previa.dados && <PreviaCorpo dados={previa.dados} mostrarNomes={previa.automacao === null} />}
            {previa.automacao && !previa.automacao.ativa && (
              <Aviso tipo="info">Ative a automação para aplicar.</Aviso>
            )}
            <div className="pagina-acoes">
              <Botao variante="secundario" aoClicar={() => setPrevia(null)}>
                Fechar
              </Botao>
              {previa.dados && previa.dados.lancamentos > 0 && (
                <Botao
                  aoClicar={() => {
                    const alvo = previa.automacao;
                    setPrevia(null);
                    abrirConfirmacao('aplicar', alvo);
                  }}
                  desabilitado={previa.automacao !== null && !previa.automacao.ativa}
                >
                  Aplicar
                </Botao>
              )}
            </div>
          </div>
        )}
      </Modal>

      <Modal
        aberto={confirmacao !== null}
        titulo={
          confirmacao?.acao === 'excluir'
            ? 'Excluir automação'
            : confirmacao?.acao === 'desfazer'
              ? 'Desfazer automação'
              : 'Aplicar automação'
        }
        aoFechar={fecharConfirmacao}
      >
        {confirmacao && (
          <div>
            {erroConfirmacao && <Aviso tipo="erro">{erroConfirmacao}</Aviso>}
            <p>{textoConfirmacao(confirmacao)}</p>
            {confirmacao.acao === 'aplicar' && confirmacao.automacao && !confirmacao.automacao.ativa && (
              <Aviso tipo="info">Ative a automação para aplicar.</Aviso>
            )}
            <div className="pagina-acoes">
              <Botao variante="secundario" aoClicar={fecharConfirmacao} desabilitado={ocupadoConfirmacao}>
                Cancelar
              </Botao>
              <Botao
                variante={confirmacao.acao === 'excluir' ? 'perigo' : 'primario'}
                aoClicar={() => void confirmar()}
                desabilitado={
                  ocupadoConfirmacao ||
                  (confirmacao.acao === 'aplicar' && confirmacao.automacao !== null && !confirmacao.automacao.ativa)
                }
              >
                {confirmacao.acao === 'excluir' ? 'Excluir' : confirmacao.acao === 'desfazer' ? 'Desfazer' : 'Aplicar'}
              </Botao>
            </div>
          </div>
        )}
      </Modal>
    </Pagina>
  );
}
