import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { mensagemErro, mesAtual, queryString } from '../../lib/financas';
import { useDados } from '../../lib/useDados';
import { Aviso, Botao, Campo, Caixa, Cartao, Carregando, Modal, MenuAcoes, Pagina, Selo, Tabela } from '../../ui';
import type { ColunaTabela } from '../../ui';
import { CampoCor, NomeComCor, SeletorMes, Valor, Vazio } from '../../ui/financas';

interface CentroDTO {
  id: number;
  nome: string;
  cor: string;
  ativo: boolean;
}

interface ResultadoCentro {
  id: number;
  nome: string;
  cor: string;
  receitas: number;
  despesas: number;
  resultado: number;
  lancamentos: number;
}

interface ResultadoSemCentro {
  receitas: number;
  despesas: number;
  resultado: number;
  lancamentos: number;
}

interface ResultadoDTO {
  centros: ResultadoCentro[];
  semCentro: ResultadoSemCentro;
}

interface LinhaResultado {
  chave: string;
  nome: string;
  cor: string | null;
  receitas: number;
  despesas: number;
  resultado: number;
  lancamentos: number;
}

const COR_PADRAO = '#64748b';
const NOME_MAXIMO = 60;

// Primeiro e último dia do mês ('AAAA-MM' -> 'AAAA-MM-DD'), para o período do resultado.
function periodoDoMes(mes: string): { de: string; ate: string } {
  const [ano, m] = mes.split('-').map(Number);
  const ultimoDia = new Date(ano, m, 0).getDate();
  return { de: `${mes}-01`, ate: `${mes}-${String(ultimoDia).padStart(2, '0')}` };
}

// ---------- Criar / editar ----------

function FormCentro({
  centro,
  aoSalvo,
}: {
  centro: CentroDTO | null;
  aoSalvo: () => void;
}) {
  const [nome, setNome] = useState(centro?.nome ?? '');
  const [cor, setCor] = useState(centro?.cor ?? COR_PADRAO);
  const [ativo, setAtivo] = useState(centro?.ativo ?? true);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const nomeLimpo = nome.trim();
    if (nomeLimpo === '') {
      setErro('Informe o nome do centro.');
      return;
    }
    if (nomeLimpo.length > NOME_MAXIMO) {
      setErro(`O nome pode ter no máximo ${NOME_MAXIMO} letras.`);
      return;
    }
    setOcupado(true);
    try {
      const corpo = { nome: nomeLimpo, cor, ativo };
      if (centro) await api.put('/centros-de-custo/' + centro.id, corpo);
      else await api.post('/centros-de-custo', corpo);
      aoSalvo();
    } catch (err) {
      setErro(mensagemErro(err));
      setOcupado(false);
    }
  }

  return (
    <form onSubmit={salvar}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <Campo rotulo="Nome" valor={nome} aoMudar={setNome} obrigatorio />
      <CampoCor rotulo="Cor" valor={cor} aoMudar={setCor} />
      <Caixa rotulo="Centro ativo (aparece nas escolhas)" marcado={ativo} aoMudar={setAtivo} />
      <div className="pagina-acoes">
        <Botao tipo="submit" desabilitado={ocupado}>
          Salvar
        </Botao>
      </div>
    </form>
  );
}

// ---------- Tela ----------

export function Centros() {
  const [mes, setMes] = useState(mesAtual());
  const cadastro = useDados<CentroDTO[]>('/centros-de-custo?inativos=true');
  const resultado = useDados<ResultadoDTO>('/centros-de-custo/resultado' + queryString(periodoDoMes(mes)));

  const [formulario, setFormulario] = useState<{ centro: CentroDTO | null } | null>(null);
  const [aApagar, setAApagar] = useState<CentroDTO | null>(null);
  const [ocupadoApagar, setOcupadoApagar] = useState(false);
  const [erroApagar, setErroApagar] = useState<string | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  async function alternarAtivo(c: CentroDTO) {
    setErroAcao(null);
    try {
      await api.put('/centros-de-custo/' + c.id, { ativo: !c.ativo });
      cadastro.recarregar();
    } catch (err) {
      setErroAcao(mensagemErro(err));
    }
  }

  function fecharApagar() {
    if (ocupadoApagar) return;
    setAApagar(null);
  }

  async function confirmarApagar() {
    if (!aApagar) return;
    setOcupadoApagar(true);
    setErroApagar(null);
    try {
      await api.del('/centros-de-custo/' + aApagar.id);
      setAApagar(null);
      cadastro.recarregar();
      resultado.recarregar();
    } catch (err) {
      setErroApagar(mensagemErro(err));
    } finally {
      setOcupadoApagar(false);
    }
  }

  function aoSalvo() {
    setFormulario(null);
    cadastro.recarregar();
    resultado.recarregar();
  }

  const colunasCadastro: ColunaTabela<CentroDTO>[] = [
    {
      titulo: 'Centro',
      celula: (c) => (
        <span>
          <NomeComCor cor={c.cor}>
            <strong>{c.nome}</strong>
          </NomeComCor>
          {!c.ativo && (
            <>
              {' '}
              <Selo>Desativado</Selo>
            </>
          )}
        </span>
      ),
    },
    {
      titulo: 'Ações',
      acoes: true,
      celula: (c) => (
        <MenuAcoes
          rotulo={`Ações do centro ${c.nome}`}
          acoes={[
            { rotulo: 'Editar', aoClicar: () => setFormulario({ centro: c }) },
            { rotulo: c.ativo ? 'Desativar' : 'Reativar', aoClicar: () => void alternarAtivo(c) },
            {
              rotulo: 'Excluir',
              perigo: true,
              aoClicar: () => {
                setErroApagar(null);
                setAApagar(c);
              },
            },
          ]}
        />
      ),
    },
  ];

  const linhas: LinhaResultado[] = resultado.dados
    ? [
        ...resultado.dados.centros.map((c) => ({
          chave: String(c.id),
          nome: c.nome,
          cor: c.cor,
          receitas: c.receitas,
          despesas: c.despesas,
          resultado: c.resultado,
          lancamentos: c.lancamentos,
        })),
        {
          chave: 'sem-centro',
          nome: 'Sem centro',
          cor: null,
          receitas: resultado.dados.semCentro.receitas,
          despesas: resultado.dados.semCentro.despesas,
          resultado: resultado.dados.semCentro.resultado,
          lancamentos: resultado.dados.semCentro.lancamentos,
        },
      ]
    : [];

  const colunasResultado: ColunaTabela<LinhaResultado>[] = [
    { titulo: 'Centro', celula: (l) => <NomeComCor cor={l.cor}>{l.nome}</NomeComCor> },
    { titulo: 'Receitas', alinhar: 'direita', celula: (l) => <Valor valor={l.receitas} sentido="entrada" /> },
    { titulo: 'Despesas', alinhar: 'direita', celula: (l) => <Valor valor={l.despesas} sentido="saida" /> },
    { titulo: 'Resultado', alinhar: 'direita', celula: (l) => <Valor valor={l.resultado} sentido="auto" /> },
    { titulo: 'Lançamentos', alinhar: 'direita', celula: (l) => l.lancamentos },
  ];

  return (
    <Pagina
      titulo="Centros de custo"
      acoes={<Botao aoClicar={() => setFormulario({ centro: null })}>Novo centro</Botao>}
    >
      <p className="cad-ajuda">
        Áreas ou projetos da empresa (ex.: Vendas, Administrativo, Projeto X). Use para ver quanto cada um recebe e gasta.
      </p>

      {erroAcao && <Aviso tipo="erro">{erroAcao}</Aviso>}
      {cadastro.erro && <Aviso tipo="erro">{cadastro.erro}</Aviso>}
      {cadastro.carregando && <Carregando />}

      {cadastro.dados && (
        <Cartao titulo="Centros cadastrados">
          {cadastro.dados.length === 0 ? (
            <Vazio
              icone="categorias"
              titulo="Nenhum centro ainda"
              texto="Crie um centro para separar receitas e despesas por área ou projeto."
            />
          ) : (
            <Tabela colunas={colunasCadastro} dados={cadastro.dados} chave={(c) => c.id} />
          )}
        </Cartao>
      )}

      <Cartao titulo="Resultado por centro">
        <div className="cad-mes">
          <SeletorMes mes={mes} aoMudar={setMes} />
        </div>
        <p className="cad-ajuda">Considera só lançamentos reais: sem transferências, proventos e lançamentos ocultos.</p>

        {resultado.erro && <Aviso tipo="erro">{resultado.erro}</Aviso>}
        {resultado.carregando && <Carregando />}

        {resultado.dados && <Tabela colunas={colunasResultado} dados={linhas} chave={(l) => l.chave} />}
      </Cartao>

      <Modal
        aberto={formulario !== null}
        titulo={formulario?.centro ? 'Editar centro' : 'Novo centro'}
        aoFechar={() => setFormulario(null)}
      >
        {formulario && (
          <FormCentro key={formulario.centro?.id ?? 'novo'} centro={formulario.centro} aoSalvo={aoSalvo} />
        )}
      </Modal>

      <Modal aberto={aApagar !== null} titulo="Excluir centro" aoFechar={fecharApagar}>
        {aApagar && (
          <div>
            {erroApagar && <Aviso tipo="erro">{erroApagar}</Aviso>}
            <p>
              {`Excluir o centro "${aApagar.nome}"? Os títulos e lançamentos dele ficam sem centro de custo.`}
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
