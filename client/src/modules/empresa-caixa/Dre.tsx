import { Fragment, useState } from 'react';
import { api } from '../../lib/api';
import { mensagemErro } from '../../lib/financas';
import { useDados } from '../../lib/useDados';
import { Aviso, Botao, Cartao, Carregando, Modal, Pagina, Selecao } from '../../ui';
import { Vazio } from '../../ui/financas';
import { Icone } from '../../ui/icones';

// Contrato de GET /empresa/dre?ano=AAAA e /empresa/dre/categorias (seção e4 do plano lote6).
interface CategoriaDre {
  id: number;
  nome: string;
  meses: number[];
  total: number;
}

interface LinhaDre {
  chave: string;
  rotulo: string;
  tipo: 'grupo' | 'total';
  meses: number[];
  total: number;
  categorias?: CategoriaDre[];
}

interface DreDTO {
  ano: number;
  linhas: LinhaDre[];
}

interface CategoriaClassificacao {
  id: number;
  nome: string;
  tipo: string; // 'RECEITA' ou 'DESPESA'
  grupoDre: string | null; // grupo efetivo
  definido: boolean;
}

// 'AUTO' representa "sem grupo definido" (grava null).
const OPCOES_GRUPO: { valor: string; rotulo: string }[] = [
  { valor: 'AUTO', rotulo: 'Automático (pelo tipo)' },
  { valor: 'RECEITA', rotulo: 'Receita bruta' },
  { valor: 'DEDUCAO', rotulo: 'Deduções e impostos sobre vendas' },
  { valor: 'CUSTO', rotulo: 'Custos' },
  { valor: 'DESPESA', rotulo: 'Despesas operacionais' },
  { valor: 'FINANCEIRO', rotulo: 'Resultado financeiro' },
  { valor: 'IMPOSTO', rotulo: 'Impostos sobre o lucro' },
];

const ROTULOS_MES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function formatarNumero(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Zero vira travessão; negativo fica vermelho.
function textoValor(n: number): string {
  return n === 0 ? '—' : formatarNumero(n);
}

function classeValor(n: number): string | undefined {
  return n < 0 ? 'caixa-negativo' : undefined;
}

export function Dre() {
  const anoHoje = new Date().getFullYear();
  const [ano, setAno] = useState(anoHoje);
  const [abertos, setAbertos] = useState<string[]>([]);
  const [modalAberto, setModalAberto] = useState(false);
  const [salvandoId, setSalvandoId] = useState<number | null>(null);
  const [erroClassificar, setErroClassificar] = useState<string | null>(null);

  const { dados, carregando, erro, recarregar } = useDados<DreDTO>(`/empresa/dre?ano=${ano}`);
  const categorias = useDados<CategoriaClassificacao[]>(modalAberto ? '/empresa/dre/categorias' : null);

  const seletorAno = (
    <Selecao
      rotulo="Ano"
      valor={String(ano)}
      aoMudar={(valor) => setAno(Number(valor))}
      opcoes={Array.from({ length: 6 }, (_, i) => anoHoje - 5 + i).map((a) => ({ valor: String(a), rotulo: String(a) }))}
    />
  );

  function alternarGrupo(chave: string) {
    setAbertos((atual) => (atual.includes(chave) ? atual.filter((c) => c !== chave) : [...atual, chave]));
  }

  async function classificar(id: number, valor: string) {
    setSalvandoId(id);
    setErroClassificar(null);
    try {
      await api.put(`/empresa/dre/categorias/${id}`, { grupoDre: valor === 'AUTO' ? null : valor });
      categorias.recarregar();
      recarregar();
    } catch (e) {
      setErroClassificar(mensagemErro(e));
    } finally {
      setSalvandoId(null);
    }
  }

  const botoesCabecalho = (
    <>
      {seletorAno}
      <Botao variante="secundario" aoClicar={() => setModalAberto(true)}>
        Classificar categorias
      </Botao>
      <Botao variante="secundario" aoClicar={() => window.print()}>
        Imprimir
      </Botao>
    </>
  );

  if (!dados) {
    return (
      <Pagina titulo="DRE" acoes={seletorAno}>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {carregando && <Carregando />}
      </Pagina>
    );
  }

  const semDados = dados.linhas.every((l) => l.total === 0);

  return (
    <Pagina titulo="DRE" acoes={botoesCabecalho}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {carregando && <Carregando />}

      {semDados ? (
        <Vazio
          icone="documento"
          titulo={`Sem lançamentos em ${dados.ano}`}
          texto="Escolha outro ano ou lance receitas e despesas para ver a DRE."
        />
      ) : (
        <Cartao titulo={`Demonstração do resultado de ${dados.ano}`}>
          <p className="caixa-suave">Toque em um grupo para ver as categorias dele.</p>
          <div className="caixa-area" role="region" aria-label="DRE do ano, com rolagem horizontal" tabIndex={0}>
            <table className="caixa-tabela">
              <thead>
                <tr>
                  <th scope="col" className="caixa-fixa">Linha</th>
                  {ROTULOS_MES.map((m) => (
                    <th scope="col" key={m}>{m}</th>
                  ))}
                  <th scope="col">Total</th>
                </tr>
              </thead>
              <tbody>
                {dados.linhas.map((linha) => {
                  const subcategorias = linha.categorias ?? [];
                  const temCategorias = linha.tipo === 'grupo' && subcategorias.length > 0;
                  const aberto = abertos.includes(linha.chave);
                  return (
                    <Fragment key={linha.chave}>
                      <tr className={linha.tipo === 'total' ? 'caixa-total' : undefined}>
                        <th scope="row" className="caixa-fixa">
                          {temCategorias ? (
                            <button
                              type="button"
                              className="caixa-grupo"
                              aria-expanded={aberto}
                              onClick={() => alternarGrupo(linha.chave)}
                            >
                              <Icone nome="chevron-baixo" tamanho={14} className={aberto ? 'caixa-seta caixa-seta-aberta' : 'caixa-seta'} />
                              <span>{linha.rotulo}</span>
                            </button>
                          ) : (
                            linha.rotulo
                          )}
                        </th>
                        {linha.meses.map((v, i) => (
                          <td key={i} className={classeValor(v)}>{textoValor(v)}</td>
                        ))}
                        <td className={`caixa-destaque ${classeValor(linha.total) ?? ''}`.trim()}>{textoValor(linha.total)}</td>
                      </tr>
                      {temCategorias &&
                        aberto &&
                        subcategorias.map((c) => (
                          <tr key={`${linha.chave}-${c.id}`} className="caixa-sub">
                            <th scope="row" className="caixa-fixa caixa-subnome">{c.nome}</th>
                            {c.meses.map((v, i) => (
                              <td key={i} className={classeValor(v)}>{textoValor(v)}</td>
                            ))}
                            <td className={classeValor(c.total)}>{textoValor(c.total)}</td>
                          </tr>
                        ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Cartao>
      )}

      <Modal aberto={modalAberto} titulo="Classificar categorias" aoFechar={() => setModalAberto(false)} largo>
        <p className="caixa-suave">
          Escolha em qual linha da DRE cada categoria entra. Em "Automático", a categoria segue o tipo dela (receita ou despesa).
        </p>
        {erroClassificar && <Aviso tipo="erro">{erroClassificar}</Aviso>}
        {categorias.erro && <Aviso tipo="erro">{categorias.erro}</Aviso>}
        {categorias.carregando && !categorias.dados && <Carregando />}
        {categorias.dados && categorias.dados.length === 0 && (
          <Vazio icone="categorias" titulo="Nenhuma categoria cadastrada" texto="Cadastre categorias para classificá-las aqui." />
        )}
        {categorias.dados?.map((c) => (
          <div key={c.id} className="caixa-classificar">
            <div>
              <strong>{c.nome}</strong>
              <span className="caixa-suave">{c.tipo === 'RECEITA' ? 'Receita' : 'Despesa'}</span>
            </div>
            <Selecao
              rotulo="Linha na DRE"
              valor={c.definido && c.grupoDre ? c.grupoDre : 'AUTO'}
              aoMudar={(valor) => void classificar(c.id, valor)}
              opcoes={OPCOES_GRUPO}
            />
            {salvandoId === c.id && <span className="caixa-suave">Salvando...</span>}
          </div>
        ))}
      </Modal>
    </Pagina>
  );
}
