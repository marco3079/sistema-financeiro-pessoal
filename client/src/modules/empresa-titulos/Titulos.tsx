import { useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { api } from '../../lib/api';
import { CHAVE_PERFIL, cabecalhoDesbloqueios } from '../../lib/perfilFinanceiro';
import {
  formatarDia,
  formatarReais,
  hojeISO,
  lerValor,
  mesAtual,
  mensagemErro,
  queryString,
  valorParaCampo,
} from '../../lib/financas';
import type { CategoriaDTO, ContaDTO } from '../../lib/financas';
import { useDados } from '../../lib/useDados';
import {
  Aviso,
  AreaTexto,
  Botao,
  Campo,
  Carregando,
  FiltrosRecolhiveis,
  MenuAcoes,
  Modal,
  Pagina,
  Selecao,
  Selo,
  Tabela,
} from '../../ui';
import type { AcaoMenu } from '../../ui';
import { NomeComCor, ResumoItem, SeletorMes } from '../../ui/financas';
import type {
  BaixaDTO,
  CentroLista,
  Natureza,
  ParceiroLista,
  RespostaTitulos,
  SituacaoTitulo,
  TituloDetalhe,
  TituloDTO,
} from './tipos';
import { LIMITE_ANEXO_BYTES, LIMITE_LISTA, MAX_ANEXOS, TIPOS_ANEXO } from './tipos';
import './titulos.css';

// Filtro de situação que vem preenchido: contas que ainda devem algo (em aberto, parcial ou vencida).
const SITUACOES_ABERTAS = 'ABERTO,PARCIAL,VENCIDO';

type Repeticao = 'NAO' | 'PARCELAS' | 'RECORRENTE';
type Periodo = 'MES' | 'TODOS';

const TEXTOS: Record<
  Natureza,
  {
    titulo: string;
    nova: string;
    entidade: string; // rótulo: "Cliente" / "Fornecedor"
    parceiroTipo: 'CLIENTE' | 'FORNECEDOR';
    categoriaTipo: 'RECEITA' | 'DESPESA';
    situacaoQuitada: string; // "Recebida" / "Paga"
    dataBaixa: string;
    vazio: string;
  }
> = {
  PAGAR: {
    titulo: 'Contas a pagar',
    nova: 'Nova conta a pagar',
    entidade: 'Fornecedor',
    parceiroTipo: 'FORNECEDOR',
    categoriaTipo: 'DESPESA',
    situacaoQuitada: 'Paga',
    dataBaixa: 'Data do pagamento',
    vazio: 'Nenhuma conta a pagar neste filtro.',
  },
  RECEBER: {
    titulo: 'Contas a receber',
    nova: 'Nova conta a receber',
    entidade: 'Cliente',
    parceiroTipo: 'CLIENTE',
    categoriaTipo: 'RECEITA',
    situacaoQuitada: 'Recebida',
    dataBaixa: 'Data do recebimento',
    vazio: 'Nenhuma conta a receber neste filtro.',
  },
};

const ROTULO_SITUACAO: Record<
  SituacaoTitulo,
  { rotulo: string; cor: 'verde' | 'amarelo' | 'vermelho' | 'azul' | 'cinza' }
> = {
  ABERTO: { rotulo: 'Em aberto', cor: 'azul' },
  PARCIAL: { rotulo: 'Parcial', cor: 'amarelo' },
  QUITADO: { rotulo: 'Quitada', cor: 'verde' },
  VENCIDO: { rotulo: 'Vencida', cor: 'vermelho' },
  CANCELADO: { rotulo: 'Cancelada', cor: 'cinza' },
};

function rotuloSituacao(situacao: SituacaoTitulo, natureza: Natureza): string {
  if (situacao === 'QUITADO') return TEXTOS[natureza].situacaoQuitada;
  return ROTULO_SITUACAO[situacao].rotulo;
}

// ---------- Datas e valores ----------

function primeiroDiaDoMes(mes: string): string {
  return `${mes}-01`;
}

function ultimoDiaDoMes(mes: string): string {
  const [ano, m] = mes.split('-').map(Number);
  const dias = new Date(ano, m, 0).getDate();
  return `${mes}-${String(dias).padStart(2, '0')}`;
}

// Arredonda para 2 casas (dinheiro).
function centavos(n: number): number {
  return Math.round(n * 100) / 100;
}

// Campo opcional de valor: vazio vale 0; texto inválido ou negativo vira null.
function valorOpcional(texto: string): number | null {
  if (texto.trim() === '') return 0;
  const n = lerValor(texto);
  if (n === null || n < 0) return null;
  return centavos(n);
}

function formatarTamanho(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

// ---------- Anexos ----------

// Baixa o anexo com o mesmo cabeçalho de lib/api.ts (token, perfil e desbloqueios) e abre numa nova aba.
// A aba é aberta antes da busca para o navegador não bloqueá-la como pop-up.
async function abrirAnexo(tituloId: number, anexoId: number): Promise<void> {
  const janela = window.open('', '_blank');
  if (!janela) throw new Error('O navegador bloqueou a nova aba. Permita pop-ups para abrir o anexo.');

  const cabecalho: Record<string, string> = {};
  const token = localStorage.getItem('financas.token');
  if (token) cabecalho['Authorization'] = `Bearer ${token}`;
  const perfil = localStorage.getItem(CHAVE_PERFIL);
  if (perfil) cabecalho['X-Perfil'] = perfil;
  const desbloqueios = cabecalhoDesbloqueios();
  if (desbloqueios) cabecalho['X-Perfil-Desbloqueio'] = desbloqueios;

  try {
    const resposta = await fetch(`/api/titulos/${tituloId}/anexos/${anexoId}`, { headers: cabecalho });
    if (!resposta.ok) throw new Error('Não foi possível abrir o anexo.');
    const arquivo = await resposta.blob();
    const url = URL.createObjectURL(arquivo);
    janela.location.href = url;
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) {
    janela.close();
    throw e;
  }
}

// Lê o arquivo e devolve só o base64 (sem o prefixo "data:...;base64,").
function lerComoBase64(arquivo: File): Promise<string> {
  return new Promise((resolver, rejeitar) => {
    const leitor = new FileReader();
    leitor.onload = () => {
      const texto = String(leitor.result);
      const virgula = texto.indexOf(',');
      resolver(virgula >= 0 ? texto.slice(virgula + 1) : texto);
    };
    leitor.onerror = () => rejeitar(new Error('Não foi possível ler o arquivo.'));
    leitor.readAsDataURL(arquivo);
  });
}

// ---------- Nova / editar conta ----------

function FormTitulo({
  natureza,
  titulo,
  parceiros,
  categorias,
  centros,
  contas,
  aoSalvo,
}: {
  natureza: Natureza;
  titulo: TituloDTO | null;
  parceiros: ParceiroLista[];
  categorias: CategoriaDTO[];
  centros: CentroLista[];
  contas: ContaDTO[];
  aoSalvo: () => void;
}) {
  const t = TEXTOS[natureza];
  const editando = titulo !== null;

  const [descricao, setDescricao] = useState(titulo?.descricao ?? '');
  const [valor, setValor] = useState(valorParaCampo(titulo?.valor ?? null));
  const [emissao, setEmissao] = useState(titulo?.emissao ?? hojeISO());
  const [vencimento, setVencimento] = useState(titulo?.vencimento ?? hojeISO());
  const [parceiroId, setParceiroId] = useState(titulo?.parceiroId ? String(titulo.parceiroId) : '');
  const [categoriaId, setCategoriaId] = useState(titulo?.categoriaId ? String(titulo.categoriaId) : '');
  const [centroId, setCentroId] = useState(titulo?.centroDeCustoId ? String(titulo.centroDeCustoId) : '');
  const [contaId, setContaId] = useState(titulo?.contaId ? String(titulo.contaId) : '');
  const [documento, setDocumento] = useState(titulo?.documento ?? '');
  const [observacao, setObservacao] = useState(titulo?.observacao ?? '');
  const [repetir, setRepetir] = useState<Repeticao>('NAO');
  const [quantidade, setQuantidade] = useState('2');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const opcoesParceiros = parceiros
    .filter((p) => p.ativo || p.id === titulo?.parceiroId)
    .map((p) => ({ valor: String(p.id), rotulo: p.ativo ? p.nome : `${p.nome} (inativo)` }));
  const opcoesCategorias = categorias
    .filter((c) => c.tipo === t.categoriaTipo)
    .map((c) => ({ valor: String(c.id), rotulo: c.nome }));
  const opcoesCentros = centros
    .filter((c) => c.ativo || c.id === titulo?.centroDeCustoId)
    .map((c) => ({ valor: String(c.id), rotulo: c.nome }));
  const opcoesContas = contas
    .filter((c) => c.ativo || c.id === titulo?.contaId)
    .map((c) => ({ valor: String(c.id), rotulo: c.nome }));

  const quantidadeNumero = Number(quantidade);
  let ajudaRepeticao = '';
  if (repetir === 'PARCELAS' && Number.isInteger(quantidadeNumero) && quantidadeNumero >= 2) {
    ajudaRepeticao = `O valor informado é o total. Serão ${quantidadeNumero} contas, uma por mês, com o valor dividido.`;
  }
  if (repetir === 'RECORRENTE' && Number.isInteger(quantidadeNumero) && quantidadeNumero >= 1) {
    ajudaRepeticao = `Serão criadas ${quantidadeNumero + 1} contas de mesmo valor, uma por mês, a partir do vencimento.`;
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);

    const desc = descricao.trim();
    if (desc.length < 1 || desc.length > 200) {
      setErro('A descrição precisa ter de 1 a 200 letras.');
      return;
    }
    const valorNumero = lerValor(valor);
    if (valorNumero === null || valorNumero <= 0) {
      setErro('Digite um valor maior que zero.');
      return;
    }
    if (!vencimento) {
      setErro('Escolha o vencimento.');
      return;
    }

    let parcelas: number | undefined;
    let recorrenciaMeses: number | undefined;
    if (!editando && repetir !== 'NAO') {
      const min = repetir === 'PARCELAS' ? 2 : 1;
      const max = repetir === 'PARCELAS' ? 60 : 36;
      const n = Number(quantidade);
      if (!Number.isInteger(n) || n < min || n > max) {
        setErro(`Use um número de ${min} a ${max}.`);
        return;
      }
      if (repetir === 'PARCELAS') parcelas = n;
      else recorrenciaMeses = n;
    }

    setOcupado(true);
    try {
      if (titulo) {
        // Na edição, campo vazio vai como null para limpar o valor no servidor.
        const corpo = {
          descricao: desc,
          valor: centavos(valorNumero),
          emissao: emissao || undefined,
          vencimento,
          parceiroId: parceiroId ? Number(parceiroId) : null,
          categoriaId: categoriaId ? Number(categoriaId) : null,
          centroDeCustoId: centroId ? Number(centroId) : null,
          contaId: contaId ? Number(contaId) : null,
          documento: documento.trim() || null,
          observacao: observacao.trim() || null,
        };
        await api.put(`/titulos/${titulo.id}`, corpo);

      } else {
        // Na criação, campo vazio não é enviado.
        const corpo = {
          natureza,
          descricao: desc,
          valor: centavos(valorNumero),
          emissao: emissao || undefined,
          vencimento,
          parceiroId: parceiroId ? Number(parceiroId) : undefined,
          categoriaId: categoriaId ? Number(categoriaId) : undefined,
          centroDeCustoId: centroId ? Number(centroId) : undefined,
          contaId: contaId ? Number(contaId) : undefined,
          documento: documento.trim() || undefined,
          observacao: observacao.trim() || undefined,
          parcelas,
          recorrenciaMeses,
        };
        await api.post('/titulos', corpo);
      }
      aoSalvo();
    } catch (err) {
      setErro(mensagemErro(err));
      setOcupado(false);
    }
  }

  return (
    <form onSubmit={salvar} className="tit-form">
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <Campo rotulo="Descrição" valor={descricao} aoMudar={setDescricao} obrigatorio />
      <div className="tit-grade">
        <Campo rotulo="Valor" valor={valor} aoMudar={setValor} obrigatorio />
        <Campo rotulo="Vencimento" tipo="date" valor={vencimento} aoMudar={setVencimento} obrigatorio />
        <Campo rotulo="Emissão" tipo="date" valor={emissao} aoMudar={setEmissao} />
        <Campo rotulo="Documento" valor={documento} aoMudar={setDocumento} />
      </div>
      <Selecao
        rotulo={t.entidade}
        valor={parceiroId}
        aoMudar={setParceiroId}
        opcoes={opcoesParceiros}
        vazio="Nenhum"
      />
      <div className="tit-grade">
        <Selecao
          rotulo="Categoria"
          valor={categoriaId}
          aoMudar={setCategoriaId}
          opcoes={opcoesCategorias}
          vazio="Nenhuma"
        />
        <Selecao
          rotulo="Centro de custo"
          valor={centroId}
          aoMudar={setCentroId}
          opcoes={opcoesCentros}
          vazio="Nenhum"
        />
      </div>
      <Selecao
        rotulo="Conta prevista"
        valor={contaId}
        aoMudar={setContaId}
        opcoes={opcoesContas}
        vazio="Nenhuma"
      />
      <AreaTexto rotulo="Observação" valor={observacao} aoMudar={setObservacao} linhas={2} />

      {!editando && (
        <>
          <Selecao
            rotulo="Repetir"
            valor={repetir}
            aoMudar={(v) => setRepetir(v as Repeticao)}
            opcoes={[
              { valor: 'NAO', rotulo: 'Não repetir' },
              { valor: 'PARCELAS', rotulo: 'Parcelar em N vezes' },
              { valor: 'RECORRENTE', rotulo: 'Todo mês por N meses' },
            ]}
          />
          {repetir !== 'NAO' && (
            <Campo
              rotulo={repetir === 'PARCELAS' ? 'Número de parcelas' : 'Quantos meses'}
              tipo="number"
              valor={quantidade}
              aoMudar={setQuantidade}
              obrigatorio
            />
          )}
          {ajudaRepeticao && <p className="fin-suave tit-ajuda">{ajudaRepeticao}</p>}
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

// ---------- Dar baixa ----------

function FormBaixa({
  natureza,
  titulo,
  contas,
  aoConcluir,
}: {
  natureza: Natureza;
  titulo: TituloDTO;
  contas: ContaDTO[];
  aoConcluir: () => void;
}) {
  const t = TEXTOS[natureza];
  // Cartão de crédito e contas trazidas pelo Open Finance não recebem baixa manual.
  const elegiveis = contas.filter((c) => c.ativo && c.tipo !== 'CARTAO' && c.origem !== 'OPEN_FINANCE');

  const [data, setData] = useState(hojeISO());
  const [valor, setValor] = useState(valorParaCampo(titulo.saldo));
  const [juros, setJuros] = useState('');
  const [multa, setMulta] = useState('');
  const [desconto, setDesconto] = useState('');
  const [contaId, setContaId] = useState(() =>
    titulo.contaId !== null && elegiveis.some((c) => c.id === titulo.contaId) ? String(titulo.contaId) : '',
  );
  const [observacao, setObservacao] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const total = centavos(
    (lerValor(valor) ?? 0) + (valorOpcional(juros) ?? 0) + (valorOpcional(multa) ?? 0) - (valorOpcional(desconto) ?? 0),
  );

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);

    const valorNumero = lerValor(valor);
    if (!data) {
      setErro('Escolha a data.');
      return;
    }
    if (valorNumero === null || valorNumero <= 0) {
      setErro('Digite um valor maior que zero.');
      return;
    }
    if (valorNumero > titulo.saldo + 0.005) {
      setErro(`O valor não pode passar do saldo (${formatarReais(titulo.saldo)}).`);
      return;
    }
    const jurosNumero = valorOpcional(juros);
    const multaNumero = valorOpcional(multa);
    const descontoNumero = valorOpcional(desconto);
    if (jurosNumero === null || multaNumero === null || descontoNumero === null) {
      setErro('Confira os valores de juros, multa e desconto.');
      return;
    }
    if (descontoNumero > valorNumero) {
      setErro('O desconto não pode ser maior que o valor pago.');
      return;
    }
    if (total <= 0) {
      setErro('O total do lançamento precisa ser maior que zero.');
      return;
    }
    if (!contaId) {
      setErro('Escolha a conta.');
      return;
    }

    setOcupado(true);
    try {
      await api.post<TituloDTO>(`/titulos/${titulo.id}/baixas`, {
        data,
        valor: centavos(valorNumero),
        juros: jurosNumero,
        multa: multaNumero,
        desconto: descontoNumero,
        contaId: Number(contaId),
        observacao: observacao.trim() || undefined,
      });
      aoConcluir();
    } catch (err) {
      setErro(mensagemErro(err));
      setOcupado(false);
    }
  }

  return (
    <form onSubmit={salvar} className="tit-form">
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <p className="fin-suave tit-ajuda">
        {titulo.descricao} · saldo em aberto {formatarReais(titulo.saldo)}
      </p>
      <div className="tit-grade">
        <Campo rotulo={t.dataBaixa} tipo="date" valor={data} aoMudar={setData} obrigatorio />
        <Campo rotulo="Valor" valor={valor} aoMudar={setValor} obrigatorio />
      </div>
      <div className="tit-grade-3">
        <Campo rotulo="Juros" valor={juros} aoMudar={setJuros} />
        <Campo rotulo="Multa" valor={multa} aoMudar={setMulta} />
        <Campo rotulo="Desconto" valor={desconto} aoMudar={setDesconto} />
      </div>
      <Selecao
        rotulo="Conta"
        valor={contaId}
        aoMudar={setContaId}
        opcoes={elegiveis.map((c) => ({ valor: String(c.id), rotulo: c.nome }))}
        vazio="Escolha a conta"
        obrigatorio
      />
      <AreaTexto rotulo="Observação" valor={observacao} aoMudar={setObservacao} linhas={2} />
      <p className="tit-total">
        Total do lançamento: <strong>{formatarReais(total)}</strong>
      </p>
      <div className="pagina-acoes">
        <Botao tipo="submit" desabilitado={ocupado}>
          Confirmar baixa
        </Botao>
      </div>
    </form>
  );
}

// ---------- Detalhes: dados, baixas e anexos ----------

function DetalheTitulo({
  id,
  natureza,
  aoAlterado,
}: {
  id: number;
  natureza: Natureza;
  aoAlterado: () => void;
}) {
  const { dados, carregando, erro: erroCarga, recarregar } = useDados<TituloDetalhe>(`/titulos/${id}`);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const inputArquivo = useRef<HTMLInputElement>(null);

  async function estornar(b: BaixaDTO) {
    if (!dados) return;
    if (!window.confirm(`Estornar a baixa de ${formatarReais(b.total)}? O valor volta para o saldo da conta.`)) return;
    setErro(null);
    try {
      await api.del<TituloDTO>(`/titulos/${dados.id}/baixas/${b.id}`);
      recarregar();
      aoAlterado();
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }

  async function enviarAnexo(e: ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    e.target.value = '';
    if (!arquivo || !dados) return;
    setErro(null);

    const tipo = arquivo.type === 'image/jpg' ? 'image/jpeg' : arquivo.type;
    if (!TIPOS_ANEXO.includes(tipo)) {
      setErro('Envie um arquivo PDF, PNG ou JPG.');
      return;
    }
    if (arquivo.size > LIMITE_ANEXO_BYTES) {
      setErro('O arquivo passa de 2 MB.');
      return;
    }

    setEnviando(true);
    try {
      const base64 = await lerComoBase64(arquivo);
      await api.post(`/titulos/${dados.id}/anexos`, {
        nome: arquivo.name.slice(0, 120),
        tipo,
        dados: base64,
      });
      recarregar();
    } catch (err) {
      setErro(mensagemErro(err));
    } finally {
      setEnviando(false);
    }
  }

  async function abrir(anexoId: number, nome: string) {
    if (!dados) return;
    setErro(null);
    try {
      await abrirAnexo(dados.id, anexoId);
    } catch (e) {
      setErro(`${mensagemErro(e)} (${nome})`);
    }
  }

  async function remover(anexoId: number, nome: string) {
    if (!dados) return;
    if (!window.confirm(`Remover o anexo "${nome}"?`)) return;
    setErro(null);
    try {
      await api.del(`/titulos/${dados.id}/anexos/${anexoId}`);
      recarregar();
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }

  if (carregando) return <Carregando />;
  if (erroCarga) return <Aviso tipo="erro">{erroCarga}</Aviso>;
  if (!dados) return null;

  const t = TEXTOS[natureza];
  const cheio = dados.anexosLista.length >= MAX_ANEXOS;

  return (
    <div>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      <dl className="tit-dados">
        <div>
          <dt>{t.entidade}</dt>
          <dd>{dados.parceiroNome ?? '—'}</dd>
        </div>
        <div>
          <dt>Situação</dt>
          <dd>
            <Selo cor={ROTULO_SITUACAO[dados.situacao].cor}>{rotuloSituacao(dados.situacao, natureza)}</Selo>
          </dd>
        </div>
        <div>
          <dt>Valor</dt>
          <dd>{formatarReais(dados.valor)}</dd>
        </div>
        <div>
          <dt>Pago</dt>
          <dd>{formatarReais(dados.pago)}</dd>
        </div>
        <div>
          <dt>Saldo</dt>
          <dd>{formatarReais(dados.saldo)}</dd>
        </div>
        <div>
          <dt>Emissão</dt>
          <dd>{formatarDia(dados.emissao)}</dd>
        </div>
        <div>
          <dt>Vencimento</dt>
          <dd>{formatarDia(dados.vencimento)}</dd>
        </div>
        <div>
          <dt>Categoria</dt>
          <dd>{dados.categoriaNome ?? '—'}</dd>
        </div>
        <div>
          <dt>Centro de custo</dt>
          <dd>{dados.centroDeCustoNome ?? '—'}</dd>
        </div>
        <div>
          <dt>Conta prevista</dt>
          <dd>{dados.contaNome ?? '—'}</dd>
        </div>
        <div>
          <dt>Documento</dt>
          <dd>{dados.documento ?? '—'}</dd>
        </div>
        <div>
          <dt>Parcela</dt>
          <dd>
            {dados.parcela !== null && dados.totalParcelas !== null
              ? `${dados.parcela} de ${dados.totalParcelas}`
              : '—'}
          </dd>
        </div>
        {dados.observacao && (
          <div>
            <dt>Observação</dt>
            <dd>{dados.observacao}</dd>
          </div>
        )}
      </dl>

      <section className="tit-secao">
        <h3>Baixas</h3>
        {dados.baixas.length === 0 && <p className="fin-suave">Nenhuma baixa ainda.</p>}
        <ul className="tit-lista">
          {dados.baixas.map((b) => (
            <li key={b.id} className="tit-item">
              <span className="tit-item-texto">
                <span>
                  {formatarDia(b.data)} · {formatarReais(b.total)}
                </span>
                <span className="fin-suave">
                  {b.contaNome ?? 'Conta'}
                  {b.juros > 0 && ` · juros ${formatarReais(b.juros)}`}
                  {b.multa > 0 && ` · multa ${formatarReais(b.multa)}`}
                  {b.desconto > 0 && ` · desconto ${formatarReais(b.desconto)}`}
                </span>
              </span>
              <span className="tit-item-acoes">
                <Botao variante="perigo" aoClicar={() => estornar(b)}>
                  Estornar
                </Botao>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="tit-secao">
        <h3>Anexos</h3>
        {dados.anexosLista.length === 0 && <p className="fin-suave">Nenhum anexo.</p>}
        <ul className="tit-lista">
          {dados.anexosLista.map((a) => (
            <li key={a.id} className="tit-item">
              <span className="tit-item-texto">
                <span>{a.nome}</span>
                <span className="fin-suave">{formatarTamanho(a.tamanho)}</span>
              </span>
              <span className="tit-item-acoes">
                <Botao variante="secundario" aoClicar={() => abrir(a.id, a.nome)}>
                  Abrir
                </Botao>
                <Botao variante="perigo" aoClicar={() => remover(a.id, a.nome)}>
                  Remover
                </Botao>
              </span>
            </li>
          ))}
        </ul>
        {cheio && <Aviso tipo="info">Este título já tem o máximo de {MAX_ANEXOS} anexos.</Aviso>}
        <input
          ref={inputArquivo}
          type="file"
          accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg"
          hidden
          onChange={enviarAnexo}
        />
        <Botao
          variante="secundario"
          desabilitado={enviando || cheio}
          aoClicar={() => inputArquivo.current?.click()}
        >
          {enviando ? 'Enviando...' : 'Enviar arquivo'}
        </Botao>
        <p className="fin-suave tit-ajuda">PDF, PNG ou JPG até 2 MB. Até {MAX_ANEXOS} arquivos por conta.</p>
      </section>
    </div>
  );
}

// ---------- Tela ----------

export function Titulos({ natureza }: { natureza: Natureza }) {
  const t = TEXTOS[natureza];

  const [situacao, setSituacao] = useState(SITUACOES_ABERTAS);
  const [periodo, setPeriodo] = useState<Periodo>('TODOS');
  const [mes, setMes] = useState(mesAtual());
  const [parceiroId, setParceiroId] = useState('');
  const [busca, setBusca] = useState('');

  const [novo, setNovo] = useState(false);
  const [editando, setEditando] = useState<TituloDTO | null>(null);
  const [baixando, setBaixando] = useState<TituloDTO | null>(null);
  const [detalheId, setDetalheId] = useState<number | null>(null);
  const [excluindo, setExcluindo] = useState<TituloDTO | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  const caminho =
    '/titulos' +
    queryString({
      natureza,
      situacao,
      de: periodo === 'MES' ? primeiroDiaDoMes(mes) : '',
      ate: periodo === 'MES' ? ultimoDiaDoMes(mes) : '',
      parceiroId,
      busca: busca.trim(),
    });
  const { dados, carregando, erro, recarregar } = useDados<RespostaTitulos>(caminho);
  const { dados: parceiros } = useDados<ParceiroLista[]>(`/parceiros?tipo=${t.parceiroTipo}&inativos=true`);
  const { dados: categorias } = useDados<CategoriaDTO[]>('/categorias');
  const { dados: centros } = useDados<CentroLista[]>('/centros-de-custo');
  const { dados: contas } = useDados<ContaDTO[]>('/contas');

  function fecharNovo() {
    setNovo(false);
    setEditando(null);
  }

  async function mudarCancelamento(titulo: TituloDTO) {
    const cancelar = titulo.situacao !== 'CANCELADO';
    if (cancelar && !window.confirm(`Cancelar "${titulo.descricao}"? Ela deixa de contar nos totais em aberto.`)) {
      return;
    }
    setErroAcao(null);
    try {
      await api.post(`/titulos/${titulo.id}/${cancelar ? 'cancelar' : 'reabrir'}`);
      recarregar();
    } catch (e) {
      setErroAcao(mensagemErro(e));
    }
  }

  async function confirmarExclusao(titulo: TituloDTO, grupo: boolean) {
    setExcluindo(null);
    setErroAcao(null);
    try {
      if (grupo) await api.del(`/titulos/${titulo.id}?grupo=true`);
      else await api.del(`/titulos/${titulo.id}`);
      recarregar();
    } catch (e) {
      setErroAcao(mensagemErro(e));
    }
  }

  // Ações do menu de três pontos.
  function acoesDo(titulo: TituloDTO): AcaoMenu[] {
    const cancelado = titulo.situacao === 'CANCELADO';
    const quitado = titulo.situacao === 'QUITADO';
    const acoes: AcaoMenu[] = [];
    if (!cancelado && !quitado) {
      acoes.push({ rotulo: 'Dar baixa', icone: 'visto', aoClicar: () => setBaixando(titulo) });
    }
    acoes.push({ rotulo: 'Ver detalhes', icone: 'documento', aoClicar: () => setDetalheId(titulo.id) });
    if (!cancelado) {
      acoes.push({ rotulo: 'Editar', icone: 'lapis', aoClicar: () => setEditando(titulo) });
    }
    acoes.push(
      cancelado
        ? { rotulo: 'Reabrir', icone: 'sincronizar', aoClicar: () => mudarCancelamento(titulo) }
        : { rotulo: 'Cancelar', icone: 'fechar', aoClicar: () => mudarCancelamento(titulo) },
    );
    acoes.push({ rotulo: 'Excluir', icone: 'lixeira', perigo: true, aoClicar: () => setExcluindo(titulo) });
    return acoes;
  }

  const opcoesParceiros = (parceiros ?? []).map((p) => ({
    valor: String(p.id),
    rotulo: p.ativo ? p.nome : `${p.nome} (inativo)`,
  }));
  const contasLista = contas ?? [];

  const ativos = [situacao !== SITUACOES_ABERTAS, periodo === 'MES', parceiroId !== '', busca.trim() !== ''].filter(
    Boolean,
  ).length;

  return (
    <Pagina
      titulo={t.titulo}
      acoes={
        <>
          {periodo === 'MES' && <SeletorMes mes={mes} aoMudar={setMes} />}
          <Botao aoClicar={() => setNovo(true)}>{t.nova}</Botao>
        </>
      }
    >
      <div className="barra-ferramentas">
        <FiltrosRecolhiveis ativos={ativos}>
          <Selecao
            rotulo="Situação"
            valor={situacao}
            aoMudar={setSituacao}
            vazio="Todas"
            opcoes={[
              { valor: SITUACOES_ABERTAS, rotulo: 'Em aberto e vencidas' },
              { valor: 'VENCIDO', rotulo: 'Vencidas' },
              { valor: 'QUITADO', rotulo: 'Quitadas' },
              { valor: 'CANCELADO', rotulo: 'Canceladas' },
            ]}
          />
          <Selecao
            rotulo="Vencimento"
            valor={periodo}
            aoMudar={(v) => setPeriodo(v as Periodo)}
            opcoes={[
              { valor: 'MES', rotulo: 'Mês escolhido' },
              { valor: 'TODOS', rotulo: 'Todos os meses' },
            ]}
          />
          <Selecao
            rotulo={t.entidade}
            valor={parceiroId}
            aoMudar={setParceiroId}
            vazio="Todos"
            opcoes={opcoesParceiros}
          />
          <Campo rotulo="Buscar por descrição ou documento" valor={busca} aoMudar={setBusca} />
        </FiltrosRecolhiveis>
      </div>

      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {erroAcao && <Aviso tipo="erro">{erroAcao}</Aviso>}

      {dados && (
        <div className="resumo">
          <ResumoItem icone="financeiro" cor="azul" valor={formatarReais(dados.resumo.emAberto)} rotulo="Em aberto" />
          <ResumoItem icone="sino" cor="vermelho" valor={formatarReais(dados.resumo.vencido)} rotulo="Vencido" />
          <ResumoItem
            icone="relogio"
            cor="laranja"
            valor={formatarReais(dados.resumo.aVencer7dias)}
            rotulo="Vence em 7 dias"
          />
          <ResumoItem
            icone="visto"
            cor="verde"
            valor={formatarReais(dados.resumo.quitadoNoPeriodo)}
            rotulo="Quitado no período"
          />
        </div>
      )}

      {dados && dados.itens.length >= LIMITE_LISTA && (
        <Aviso tipo="info">Mostrando os primeiros {LIMITE_LISTA} títulos. Use os filtros para ver o resto.</Aviso>
      )}
      {carregando && <Carregando />}
      {dados && (
        <Tabela<TituloDTO>
          chave={(titulo) => titulo.id}
          dados={dados.itens}
          vazio={t.vazio}
          aoClicarLinha={(titulo) => setDetalheId(titulo.id)}
          colunas={[
            { titulo: 'Vencimento', celula: (titulo) => (
              <>
                {formatarDia(titulo.vencimento)}
                {titulo.diasDeAtraso > 0 && (
                  <span className="tit-atraso">
                    {' '}
                    · {titulo.diasDeAtraso} {titulo.diasDeAtraso === 1 ? 'dia' : 'dias'} de atraso
                  </span>
                )}
              </>
            ) },
            {
              titulo: 'Descrição',
              celula: (titulo) => (
                <span className="tit-descricao">
                  <span>{titulo.descricao}</span>
                  <span className="tit-detalhe fin-suave">
                    {titulo.parcela !== null && titulo.totalParcelas !== null && (
                      <span>
                        Parcela {titulo.parcela} de {titulo.totalParcelas}
                      </span>
                    )}
                    {titulo.documento && <span>Doc. {titulo.documento}</span>}
                    {titulo.recorrente && <Selo cor="azul">Recorrente</Selo>}
                  </span>
                </span>
              ),
            },
            { titulo: t.entidade, celula: (titulo) => titulo.parceiroNome ?? '—' },
            {
              titulo: 'Categoria',
              celula: (titulo) =>
                titulo.categoriaNome ? <NomeComCor cor={titulo.categoriaCor}>{titulo.categoriaNome}</NomeComCor> : '—',
            },
            { titulo: 'Valor', alinhar: 'direita', celula: (titulo) => formatarReais(titulo.valor) },
            { titulo: 'Saldo', alinhar: 'direita', celula: (titulo) => formatarReais(titulo.saldo) },
            {
              titulo: 'Situação',
              celula: (titulo) => (
                <Selo cor={ROTULO_SITUACAO[titulo.situacao].cor}>{rotuloSituacao(titulo.situacao, natureza)}</Selo>
              ),
            },
            {
              titulo: 'Ações',
              acoes: true,
              celula: (titulo) => (
                <MenuAcoes rotulo={'Ações da conta ' + titulo.descricao} acoes={acoesDo(titulo)} />
              ),
            },
          ]}
        />
      )}

      <Modal aberto={novo || editando !== null} titulo={editando ? 'Editar conta' : t.nova} aoFechar={fecharNovo}>
        {(novo || editando !== null) && (
          <FormTitulo
            key={editando?.id ?? 'novo'}
            natureza={natureza}
            titulo={editando}
            parceiros={parceiros ?? []}
            categorias={categorias ?? []}
            centros={centros ?? []}
            contas={contasLista}
            aoSalvo={() => {
              fecharNovo();
              recarregar();
            }}
          />
        )}
      </Modal>

      <Modal aberto={baixando !== null} titulo="Dar baixa" aoFechar={() => setBaixando(null)}>
        {baixando && (
          <FormBaixa
            key={baixando.id}
            natureza={natureza}
            titulo={baixando}
            contas={contasLista}
            aoConcluir={() => {
              setBaixando(null);
              recarregar();
            }}
          />
        )}
      </Modal>

      <Modal aberto={detalheId !== null} titulo="Detalhes" largo aoFechar={() => setDetalheId(null)}>
        {detalheId !== null && (
          <DetalheTitulo key={detalheId} id={detalheId} natureza={natureza} aoAlterado={recarregar} />
        )}
      </Modal>

      <Modal aberto={excluindo !== null} titulo="Excluir conta" aoFechar={() => setExcluindo(null)}>
        {excluindo && (
          <div>
            <p>
              Excluir "{excluindo.descricao}"? Os anexos também são apagados.
              {excluindo.grupo && ' Ela faz parte de um grupo de parcelas ou repetições.'}
            </p>
            <div className="pagina-acoes">
              <Botao variante="secundario" aoClicar={() => setExcluindo(null)}>
                Não excluir
              </Botao>
              <Botao variante="perigo" aoClicar={() => confirmarExclusao(excluindo, false)}>
                {excluindo.grupo ? 'Só esta' : 'Excluir'}
              </Botao>
              {excluindo.grupo && (
                <Botao variante="perigo" aoClicar={() => confirmarExclusao(excluindo, true)}>
                  Esta e as outras em aberto do grupo
                </Botao>
              )}
            </div>
          </div>
        )}
      </Modal>
    </Pagina>
  );
}
