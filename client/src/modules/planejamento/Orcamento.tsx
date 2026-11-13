import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import {
  formatarReais,
  lerValor,
  mensagemErro,
  mesAtual,
  valorParaCampo,
} from '../../lib/financas';
import type { CategoriaDTO, OrcamentoDTO } from '../../lib/financas';
import { Aviso, Botao, Campo, Caixa, Carregando, Cartao, MenuAcoes, Modal, Pagina, Selecao, Tabela } from '../../ui';
import type { AcaoMenu } from '../../ui';
import { BarraProgresso, NomeComCor, ResumoItem, SeletorMes, Vazio } from '../../ui/financas';
import './planejamento.css';

interface SemOrcamento {
  categoriaId: number;
  categoriaNome: string;
  categoriaCor: string;
  gasto: number;
}

interface RespostaOrcamento {
  mes: string;
  itens: OrcamentoDTO[];
  totalLimite: number;
  totalGasto: number;
  semOrcamento: SemOrcamento[];
}

interface SugestaoOrcamento {
  categoriaId: number;
  nome: string;
  cor: string;
  media: number;
  sugerido: number;
  limiteAtual: number | null;
}

interface FormLimite {
  categoriaId: string;
  limite: string;
}

export function Orcamento() {
  const [mes, setMes] = useState(mesAtual());
  const [form, setForm] = useState<FormLimite | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erroForm, setErroForm] = useState<string | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const [sugerindo, setSugerindo] = useState(false);
  const { dados, carregando, erro, recarregar } = useDados<RespostaOrcamento>('/orcamentos?mes=' + mes);
  const categorias = useDados<CategoriaDTO[]>('/categorias?tipo=DESPESA').dados ?? [];

  function abrirLimite(categoriaId?: number, limite?: number) {
    setErroForm(null);
    setForm({
      categoriaId: categoriaId !== undefined ? String(categoriaId) : '',
      limite: valorParaCampo(limite),
    });
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    if (!form.categoriaId) {
      setErroForm('Escolha uma categoria.');
      return;
    }
    const limite = lerValor(form.limite);
    if (limite === null) {
      setErroForm('Informe um valor válido.');
      return;
    }
    setErroForm(null);
    setOcupado(true);
    try {
      await api.put(`/orcamentos/${form.categoriaId}`, { limite });
      setForm(null);
      recarregar();
    } catch (err) {
      setErroForm(mensagemErro(err));
    } finally {
      setOcupado(false);
    }
  }

  async function removerLimite(o: OrcamentoDTO) {
    if (!window.confirm(`Remover o limite de ${o.categoriaNome}?`)) return;
    setErroAcao(null);
    try {
      await api.del(`/orcamentos/${o.categoriaId}`);
      recarregar();
    } catch (err) {
      setErroAcao(mensagemErro(err));
    }
  }

  function acoesDo(o: OrcamentoDTO): AcaoMenu[] {
    return [
      { rotulo: 'Alterar limite', icone: 'lapis', aoClicar: () => abrirLimite(o.categoriaId, o.limite) },
      { rotulo: 'Remover limite', icone: 'lixeira', perigo: true, aoClicar: () => removerLimite(o) },
    ];
  }

  const disponivel = dados ? dados.totalLimite - dados.totalGasto : 0;

  return (
    <Pagina titulo="Orçamento" acoes={<SeletorMes mes={mes} aoMudar={setMes} />}>
      <div className="barra-ferramentas">
        <div className="filtros" />
        <div className="planejamento-acoes-topo">
          <Botao variante="secundario" aoClicar={() => setSugerindo(true)}>
            Sugerir limites
          </Botao>
          <Botao aoClicar={() => abrirLimite()}>Definir limite</Botao>
        </div>
      </div>

      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {erroAcao && <Aviso tipo="erro">{erroAcao}</Aviso>}

      {dados && (
        <div className="resumo">
          <ResumoItem icone="orcamento" cor="azul" valor={formatarReais(dados.totalLimite)} rotulo="Limite do mês" />
          <ResumoItem icone="seta-baixo" cor="laranja" valor={formatarReais(dados.totalGasto)} rotulo="Gasto" />
          <ResumoItem
            icone={disponivel >= 0 ? 'visto' : 'fechar'}
            cor={disponivel >= 0 ? 'verde' : 'vermelho'}
            valor={formatarReais(disponivel)}
            rotulo="Disponível"
          />
        </div>
      )}

      {carregando && <Carregando />}

      {dados && (
        <Cartao titulo="Limites por categoria">
          {dados.itens.length === 0 ? (
            <Vazio
              icone="orcamento"
              titulo="Nenhum limite definido"
              texto="Defina quanto você quer gastar por mês em cada categoria e acompanhe aqui."
            />
          ) : (
            <ul className="planejamento-lista">
              {dados.itens.map((o) => (
                <li key={o.id} className="planejamento-item">
                  <div className="planejamento-item-topo">
                    <NomeComCor cor={o.categoriaCor}>{o.categoriaNome}</NomeComCor>
                    <MenuAcoes rotulo={'Ações de ' + o.categoriaNome} acoes={acoesDo(o)} />
                  </div>
                  <span>
                    {formatarReais(o.gasto)} de {formatarReais(o.limite)} ·{' '}
                    <span style={{ color: o.percentual > 100 ? 'var(--cor-perigo)' : undefined }}>
                      {o.percentual}%
                    </span>
                  </span>
                  <BarraProgresso percentual={o.percentual} cor={o.categoriaCor} />
                </li>
              ))}
            </ul>
          )}
        </Cartao>
      )}

      {dados && dados.semOrcamento.length > 0 && (
        <Cartao titulo="Gastos sem limite definido">
          <Tabela<SemOrcamento>
            chave={(c) => c.categoriaId}
            dados={dados.semOrcamento}
            colunas={[
              { titulo: 'Categoria', celula: (c) => <NomeComCor cor={c.categoriaCor}>{c.categoriaNome}</NomeComCor> },
              { titulo: 'Gasto no mês', alinhar: 'direita', celula: (c) => formatarReais(c.gasto) },
              {
                titulo: 'Ações',
                acoes: true,
                celula: (c) => (
                  <Botao variante="texto" aoClicar={() => abrirLimite(c.categoriaId)}>
                    Definir limite
                  </Botao>
                ),
              },
            ]}
          />
        </Cartao>
      )}

      <Modal aberto={form !== null} titulo="Definir limite" aoFechar={() => setForm(null)}>
        {form && (
          <form onSubmit={salvar}>
            {erroForm && <Aviso tipo="erro">{erroForm}</Aviso>}
            {categorias.length === 0 && (
              <Aviso tipo="info">Cadastre categorias de despesa em Categorias.</Aviso>
            )}
            <Selecao
              rotulo="Categoria"
              valor={form.categoriaId}
              aoMudar={(v) => setForm((f) => (f ? { ...f, categoriaId: v } : f))}
              opcoes={categorias.map((c) => ({ valor: String(c.id), rotulo: c.nome }))}
              obrigatorio
            />
            <Campo
              rotulo="Limite mensal (R$)"
              valor={form.limite}
              aoMudar={(v) => setForm((f) => (f ? { ...f, limite: v } : f))}
              obrigatorio
            />
            <div className="pagina-acoes">
              <Botao tipo="submit" desabilitado={ocupado || categorias.length === 0}>
                Salvar limite
              </Botao>
            </div>
          </form>
        )}
      </Modal>

      {sugerindo && (
        <SugerirLimites
          aoFechar={() => setSugerindo(false)}
          aoAplicar={() => {
            setSugerindo(false);
            recarregar();
          }}
        />
      )}
    </Pagina>
  );
}

// Sugestão a partir da média dos meses fechados. Nada é gravado sem "Aplicar".
// Remonta a cada abertura (o pai só renderiza quando aberto), então o estado começa limpo.
function SugerirLimites({ aoFechar, aoAplicar }: { aoFechar: () => void; aoAplicar: () => void }) {
  const [meses, setMeses] = useState<'3' | '6'>('3');
  const [marcados, setMarcados] = useState<Record<number, boolean>>({});
  const [valores, setValores] = useState<Record<number, string>>({});
  const [ocupado, setOcupado] = useState(false);
  const [erroAplicar, setErroAplicar] = useState<string | null>(null);
  const { dados, carregando, erro } = useDados<SugestaoOrcamento[]>('/orcamentos/sugestao?meses=' + meses);

  // Marcado por padrão só quem ainda não tem limite (não sobrescreve limite existente).
  function estaMarcado(s: SugestaoOrcamento): boolean {
    return marcados[s.categoriaId] ?? s.limiteAtual === null;
  }

  function valorDe(s: SugestaoOrcamento): string {
    return valores[s.categoriaId] ?? valorParaCampo(s.sugerido);
  }

  async function aplicar(e: FormEvent) {
    e.preventDefault();
    if (!dados) return;
    const escolhidos = dados.filter((s) => estaMarcado(s));
    const limites: { categoriaId: number; limite: number }[] = [];
    for (const s of escolhidos) {
      const limite = lerValor(valorDe(s));
      if (limite === null || limite <= 0) {
        setErroAplicar(`Informe um valor válido para ${s.nome}.`);
        return;
      }
      limites.push({ categoriaId: s.categoriaId, limite });
    }
    if (limites.length === 0) {
      setErroAplicar('Marque pelo menos uma categoria.');
      return;
    }
    setErroAplicar(null);
    setOcupado(true);
    try {
      await Promise.all(limites.map((l) => api.put(`/orcamentos/${l.categoriaId}`, { limite: l.limite })));
      aoAplicar();
    } catch (err) {
      setErroAplicar(mensagemErro(err));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Modal aberto titulo="Sugerir limites" aoFechar={aoFechar}>
      <form onSubmit={aplicar}>
        {erroAplicar && <Aviso tipo="erro">{erroAplicar}</Aviso>}
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Selecao
          rotulo="Média dos últimos"
          valor={meses}
          aoMudar={(v) => {
            setMeses(v === '6' ? '6' : '3');
            setMarcados({});
            setValores({});
          }}
          opcoes={[
            { valor: '3', rotulo: '3 meses fechados' },
            { valor: '6', rotulo: '6 meses fechados' },
          ]}
        />
        <p className="planejamento-sugestao-ajuda">
          Média mensal do gasto em cada categoria, sem transferências. O valor sugerido é arredondado para cima de 10 em 10 reais.
        </p>

        {carregando && <Carregando />}

        {dados && dados.length === 0 && (
          <Vazio
            icone="orcamento"
            titulo="Sem gastos para sugerir"
            texto="Não há despesas nos meses fechados para calcular a média."
          />
        )}

        {dados && dados.length > 0 && (
          <ul className="planejamento-lista">
            {dados.map((s) => (
              <li key={s.categoriaId} className="planejamento-sugestao">
                <Caixa
                  rotulo={s.nome}
                  marcado={estaMarcado(s)}
                  aoMudar={(v) => setMarcados((m) => ({ ...m, [s.categoriaId]: v }))}
                />
                <span>
                  Média {formatarReais(s.media)} · Limite atual{' '}
                  {s.limiteAtual === null ? 'nenhum' : formatarReais(s.limiteAtual)}
                </span>
                <Campo
                  rotulo="Limite sugerido (R$)"
                  valor={valorDe(s)}
                  aoMudar={(v) => setValores((c) => ({ ...c, [s.categoriaId]: v }))}
                />
              </li>
            ))}
          </ul>
        )}

        <div className="pagina-acoes">
          <Botao variante="secundario" aoClicar={aoFechar}>
            Cancelar
          </Botao>
          <Botao tipo="submit" desabilitado={ocupado || !dados || dados.length === 0}>
            Aplicar
          </Botao>
        </div>
      </form>
    </Modal>
  );
}
