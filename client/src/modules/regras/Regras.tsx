import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import {
  formatarDia,
  formatarReais,
  mensagemErro,
  rotuloDe,
  TIPOS_TRANSACAO,
} from '../../lib/financas';
import type { CategoriaDTO, TipoTransacao } from '../../lib/financas';
import { useDados } from '../../lib/useDados';
import { Aviso, Botao, Campo, Caixa, Cartao, Carregando, Modal, MenuAcoes, Pagina, Selecao, Tabela } from '../../ui';
import type { ColunaTabela } from '../../ui';
import { NomeComCor, Vazio } from '../../ui/financas';
import './regras.css';

const TRECHO_MINIMO = 2;
const TRECHO_MAXIMO = 60;

interface RegraDTO {
  id: number;
  trecho: string;
  categoriaId: number;
  categoriaNome: string;
  categoriaCor: string;
  categoriaTipo: TipoTransacao;
  lancamentos: number;
}

interface LancamentoPrevia {
  id: number;
  data: string;
  descricao: string;
  valor: number;
  tipo: TipoTransacao;
}

interface ItemCategorizar extends LancamentoPrevia {
  categoriaAtual: string | null;
  categoriaNova: string;
}

interface ItemTransferencia extends LancamentoPrevia {
  contaNome: string;
}

interface PrevisaoDTO {
  categorizar: ItemCategorizar[];
  transferencias: ItemTransferencia[];
  aplicado: boolean;
}

// ---------- Criar / editar regra ----------

function FormRegra({
  regra,
  categorias,
  aoSalvo,
}: {
  regra: RegraDTO | null;
  categorias: CategoriaDTO[];
  aoSalvo: () => void;
}) {
  const [trecho, setTrecho] = useState(regra?.trecho ?? '');
  const [categoriaId, setCategoriaId] = useState(regra ? String(regra.categoriaId) : '');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const limpo = trecho.trim();
    if (limpo.length < TRECHO_MINIMO || limpo.length > TRECHO_MAXIMO) {
      setErro(`O trecho precisa ter de ${TRECHO_MINIMO} a ${TRECHO_MAXIMO} letras.`);
      return;
    }
    if (categoriaId === '') {
      setErro('Escolha a categoria.');
      return;
    }
    setOcupado(true);
    try {
      const corpo = { trecho: limpo, categoriaId: Number(categoriaId) };
      if (regra) await api.put('/regras/' + regra.id, corpo);
      else await api.post('/regras', corpo);
      aoSalvo();
    } catch (err) {
      setErro(mensagemErro(err));
      setOcupado(false);
    }
  }

  return (
    <form onSubmit={salvar}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <Campo rotulo="Quando a descrição contiver" valor={trecho} aoMudar={setTrecho} obrigatorio />
      <p className="regras-ajuda">Ex.: "uber" pega UBER *VIAGEM e Uber Eats. Não diferencia maiúsculas nem acentos.</p>
      <Selecao
        rotulo="Categoria"
        valor={categoriaId}
        aoMudar={setCategoriaId}
        vazio="Escolha a categoria"
        obrigatorio
        opcoes={categorias.map((c) => ({
          valor: String(c.id),
          rotulo: `${rotuloDe(TIPOS_TRANSACAO, c.tipo)}: ${c.nome}`,
        }))}
      />
      <div className="pagina-acoes">
        <Botao tipo="submit" desabilitado={ocupado}>
          Salvar
        </Botao>
      </div>
    </form>
  );
}

// ---------- Aplicar nos lançamentos que já existem ----------

function AplicarExistentes({ aoAplicado }: { aoAplicado: () => void }) {
  const [sobrescrever, setSobrescrever] = useState(false);
  const [previa, setPrevia] = useState<PrevisaoDTO | null>(null);
  const [ocupadoPrevia, setOcupadoPrevia] = useState(false);
  const [erroPrevia, setErroPrevia] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [ocupadoAplicar, setOcupadoAplicar] = useState(false);
  const [erroAplicar, setErroAplicar] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ categorizados: number; transferencias: number } | null>(null);

  function mudarSobrescrever(valor: boolean) {
    setSobrescrever(valor);
    setPrevia(null);
    setResultado(null);
  }

  async function verMudancas() {
    setErroPrevia(null);
    setResultado(null);
    setOcupadoPrevia(true);
    try {
      const dados = await api.post<PrevisaoDTO>('/regras/reprocessar', { aplicar: false, sobrescrever });
      setPrevia(dados);
    } catch (err) {
      setErroPrevia(mensagemErro(err));
      setPrevia(null);
    } finally {
      setOcupadoPrevia(false);
    }
  }

  async function aplicar() {
    setErroAplicar(null);
    setOcupadoAplicar(true);
    try {
      const dados = await api.post<PrevisaoDTO>('/regras/reprocessar', { aplicar: true, sobrescrever });
      setResultado({ categorizados: dados.categorizar.length, transferencias: dados.transferencias.length });
      setPrevia(null);
      setConfirmando(false);
      aoAplicado();
    } catch (err) {
      setErroAplicar(mensagemErro(err));
    } finally {
      setOcupadoAplicar(false);
    }
  }

  const colunasCategorias: ColunaTabela<ItemCategorizar>[] = [
    { titulo: 'Data', celula: (i) => formatarDia(i.data) },
    { titulo: 'Descrição', celula: (i) => i.descricao },
    { titulo: 'Valor', alinhar: 'direita', celula: (i) => formatarReais(i.valor) },
    { titulo: 'Categoria atual', celula: (i) => i.categoriaAtual ?? 'Sem categoria' },
    { titulo: 'Passa a ser', celula: (i) => i.categoriaNova },
  ];

  const colunasTransferencias: ColunaTabela<ItemTransferencia>[] = [
    { titulo: 'Data', celula: (i) => formatarDia(i.data) },
    { titulo: 'Descrição', celula: (i) => i.descricao },
    { titulo: 'Conta', celula: (i) => i.contaNome },
    { titulo: 'Valor', alinhar: 'direita', celula: (i) => formatarReais(i.valor) },
  ];

  const semMudancas = previa !== null && previa.categorizar.length === 0 && previa.transferencias.length === 0;

  return (
    <>
      <p className="regras-ajuda">
        Aplica as regras nos lançamentos que já existem. Por padrão, só mexe nos que estão sem categoria. Transferências
        são os Pix pagos no crédito: saem das receitas e despesas dos relatórios.
      </p>
      <Caixa
        rotulo="Trocar também a categoria de quem já tem"
        marcado={sobrescrever}
        aoMudar={mudarSobrescrever}
      />

      <div className="pagina-acoes">
        <Botao variante="secundario" aoClicar={verMudancas} desabilitado={ocupadoPrevia}>
          Ver o que mudaria
        </Botao>
      </div>

      {erroPrevia && <Aviso tipo="erro">{erroPrevia}</Aviso>}
      {ocupadoPrevia && <Carregando />}

      {resultado && (
        <Aviso tipo="sucesso">
          {`Pronto: ${resultado.categorizados} lançamento(s) alterado(s) na categoria e ${resultado.transferencias} marcado(s) como transferência.`}
        </Aviso>
      )}

      {previa && (
        <div className="regras-previa">
          <p className="regras-resumo">
            {`Ainda não gravei nada. Categorizar: ${previa.categorizar.length}. Transferências: ${previa.transferencias.length}.`}
          </p>

          {semMudancas && <Aviso tipo="info">Nenhum lançamento mudaria com as regras atuais.</Aviso>}

          {previa.categorizar.length > 0 && (
            <>
              <h3 className="regras-subtitulo">Categorias</h3>
              <Tabela colunas={colunasCategorias} dados={previa.categorizar} chave={(i) => i.id} />
            </>
          )}

          {previa.transferencias.length > 0 && (
            <>
              <h3 className="regras-subtitulo">Transferências (Pix pago no crédito)</h3>
              <Tabela colunas={colunasTransferencias} dados={previa.transferencias} chave={(i) => i.id} />
            </>
          )}

          {!semMudancas && (
            <div className="pagina-acoes">
              <Botao aoClicar={() => setConfirmando(true)} desabilitado={ocupadoAplicar}>
                Aplicar
              </Botao>
            </div>
          )}
        </div>
      )}

      <Modal aberto={confirmando} titulo="Aplicar regras" aoFechar={() => !ocupadoAplicar && setConfirmando(false)}>
        {previa && (
          <div>
            {erroAplicar && <Aviso tipo="erro">{erroAplicar}</Aviso>}
            <p>
              {`Vou alterar a categoria de ${previa.categorizar.length} lançamento(s) e marcar ${previa.transferencias.length} como transferência.`}
            </p>
            <div className="pagina-acoes">
              <Botao variante="secundario" aoClicar={() => setConfirmando(false)} desabilitado={ocupadoAplicar}>
                Cancelar
              </Botao>
              <Botao aoClicar={aplicar} desabilitado={ocupadoAplicar}>
                Aplicar
              </Botao>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

// ---------- Tela ----------

export function Regras() {
  const regras = useDados<RegraDTO[]>('/regras');
  const categorias = useDados<CategoriaDTO[]>('/categorias');
  const [formulario, setFormulario] = useState<{ regra: RegraDTO | null } | null>(null);

  const [aApagar, setAApagar] = useState<RegraDTO | null>(null);
  const [ocupadoApagar, setOcupadoApagar] = useState(false);
  const [erroApagar, setErroApagar] = useState<string | null>(null);

  function fecharApagar() {
    if (ocupadoApagar) return;
    setAApagar(null);
  }

  async function confirmarApagar() {
    if (!aApagar) return;
    setOcupadoApagar(true);
    setErroApagar(null);
    try {
      await api.del('/regras/' + aApagar.id);
      setAApagar(null);
      regras.recarregar();
    } catch (err) {
      setErroApagar(mensagemErro(err));
    } finally {
      setOcupadoApagar(false);
    }
  }

  const colunas: ColunaTabela<RegraDTO>[] = [
    { titulo: 'Quando a descrição contiver', celula: (r) => <strong>{r.trecho}</strong> },
    {
      titulo: 'Categoria',
      celula: (r) => <NomeComCor cor={r.categoriaCor}>{r.categoriaNome}</NomeComCor>,
    },
    { titulo: 'Lançamentos', alinhar: 'direita', celula: (r) => r.lancamentos },
    {
      titulo: 'Ações',
      acoes: true,
      celula: (r) => (
        <MenuAcoes
          rotulo={`Ações da regra ${r.trecho}`}
          acoes={[
            { rotulo: 'Editar', aoClicar: () => setFormulario({ regra: r }) },
            { rotulo: 'Excluir', perigo: true, aoClicar: () => { setErroApagar(null); setAApagar(r); } },
          ]}
        />
      ),
    },
  ];

  function aoSalvo() {
    setFormulario(null);
    regras.recarregar();
  }

  return (
    <Pagina
      titulo="Regras de categoria"
      acoes={
        <Botao aoClicar={() => setFormulario({ regra: null })} desabilitado={!categorias.dados}>
          Nova regra
        </Botao>
      }
    >
      <p className="regras-ajuda">
        Quando a descrição de um lançamento contiver o trecho, ele recebe a categoria da regra. A importação já usa estas
        regras.
      </p>

      {regras.erro && <Aviso tipo="erro">{regras.erro}</Aviso>}
      {regras.carregando && <Carregando />}

      {regras.dados && (
        <Cartao titulo="Regras">
          {regras.dados.length === 0 ? (
            <Vazio
              icone="categorias"
              titulo="Nenhuma regra ainda"
              texto="Crie uma regra para o sistema categorizar sozinho os próximos lançamentos."
            />
          ) : (
            <Tabela colunas={colunas} dados={regras.dados} chave={(r) => r.id} />
          )}
        </Cartao>
      )}

      <Cartao titulo="Aplicar aos lançamentos que já existem">
        {categorias.dados && <AplicarExistentes aoAplicado={() => regras.recarregar()} />}
        {categorias.erro && <Aviso tipo="erro">{categorias.erro}</Aviso>}
      </Cartao>

      <Modal
        aberto={formulario !== null}
        titulo={formulario?.regra ? 'Editar regra' : 'Nova regra'}
        aoFechar={() => setFormulario(null)}
      >
        {formulario && categorias.dados && (
          <FormRegra
            key={formulario.regra?.id ?? 'nova'}
            regra={formulario.regra}
            categorias={categorias.dados}
            aoSalvo={aoSalvo}
          />
        )}
      </Modal>

      <Modal aberto={aApagar !== null} titulo="Excluir regra" aoFechar={fecharApagar}>
        {aApagar && (
          <div>
            {erroApagar && <Aviso tipo="erro">{erroApagar}</Aviso>}
            <p>
              {`Excluir a regra "${aApagar.trecho}"? Os lançamentos que já receberam a categoria não mudam.`}
            </p>
            <div className="pagina-acoes">
              <Botao variante="secundario" aoClicar={fecharApagar} desabilitado={ocupadoApagar}>
                Cancelar
              </Botao>
              <Botao variante="perigo" aoClicar={confirmarApagar} desabilitado={ocupadoApagar}>
                Excluir
              </Botao>
            </div>
          </div>
        )}
      </Modal>
    </Pagina>
  );
}
