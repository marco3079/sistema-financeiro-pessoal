import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { formatarDia, formatarReais, lerValor, mensagemErro } from '../../lib/financas';
import { Aviso, Botao, Campo, Carregando, Selecao, Selo, Tabela } from '../../ui';
import { ResumoItem, Valor } from '../../ui/financas';
import type { AnaliseArquivo, ConfirmarArquivo, FormatoArquivo, ItemLido, ResultadoArquivo, TipoDocumento } from './tipos';

// Prévia de um arquivo de texto (fatura ou extrato): o usuário confere os lançamentos e confirma a importação.

type LinhaItem = ItemLido & { jaImportado: boolean; indice: number };

// Soma os lançamentos de um tipo, deixando de fora pagamentos e transferências.
function somar(lista: LinhaItem[], tipo: ItemLido['tipo']): number {
  return lista.filter((l) => l.tipo === tipo && !l.transferencia).reduce((soma, l) => soma + l.valor, 0);
}

export function PreviaLancamentos({
  arquivo,
  aoConcluir,
  aoDescartar,
}: {
  arquivo: { nome: string; formato: FormatoArquivo; texto: string };
  aoConcluir: (mensagem: string) => void;
  aoDescartar: () => void;
}) {
  const [analise, setAnalise] = useState<AnaliseArquivo | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [documento, setDocumento] = useState<TipoDocumento | null>(null);
  const [contaId, setContaId] = useState('');
  const [nomeNovaConta, setNomeNovaConta] = useState('');
  const [vencimento, setVencimento] = useState('');
  const [saldoFinal, setSaldoFinal] = useState('');
  const [marcados, setMarcados] = useState<boolean[]>([]);
  const [enviando, setEnviando] = useState(false);
  const montado = useRef(false);
  const pedido = useRef(0);

  // Analisa o arquivo. `contaPedida` null = primeira análise (ou troca de tipo): preenche conta e nome sugeridos.
  // Só a resposta do pedido mais recente (e com o componente montado) altera a tela.
  async function analisar(documentoPedido: TipoDocumento | null, contaPedida: number | null) {
    const meu = ++pedido.current;
    setCarregando(true);
    setErro(null);
    try {
      const a = await api.post<AnaliseArquivo>('/importacao/analisar', {
        nome: arquivo.nome,
        formato: arquivo.formato,
        texto: arquivo.texto,
        documento: documentoPedido,
        contaId: contaPedida,
      });
      if (!montado.current || meu !== pedido.current) return;
      setAnalise(a);
      if (contaPedida === null) setVencimento(a.vencimento ?? '');
      setMarcados((atual) =>
        a.itens.map((i, k) => !i.jaImportado && (contaPedida === null ? true : (atual[k] ?? true)))
      );
      if (contaPedida === null) {
        setContaId(a.contaSugeridaId !== null ? String(a.contaSugeridaId) : a.contas.length === 0 ? 'nova' : '');
        setNomeNovaConta(a.banco ? (a.documento === 'FATURA' ? 'Cartão ' + a.banco : 'Conta ' + a.banco) : '');
      }
    } catch (e) {
      if (montado.current && meu === pedido.current) setErro(mensagemErro(e));
    } finally {
      if (montado.current && meu === pedido.current) setCarregando(false);
    }
  }

  useEffect(() => {
    montado.current = true;
    analisar(null, null);
    return () => {
      montado.current = false;
    };
  }, []);

  function trocarDocumento(novo: TipoDocumento) {
    setDocumento(novo);
    analisar(novo, null);
  }

  function trocarConta(valor: string) {
    setContaId(valor);
    if (analise && valor !== '' && valor !== 'nova') {
      analisar(documento ?? analise.documento, Number(valor));
    }
  }

  function marcarItem(indice: number, marcado: boolean) {
    setMarcados((atual) => atual.map((v, i) => (i === indice ? marcado : v)));
  }

  async function confirmar() {
    if (!analise) return;
    setErro(null);
    if (contaId === '') {
      setErro('Escolha o cartão (ou a conta) de destino.');
      return;
    }
    if (contaId === 'nova' && nomeNovaConta.trim() === '') {
      setErro('Informe o nome.');
      return;
    }
    if (FATURA && vencimento === '') {
      setErro('Informe o vencimento da fatura.');
      return;
    }
    if (!FATURA && saldoFinal.trim() !== '' && lerValor(saldoFinal) === null) {
      setErro('Informe um saldo válido.');
      return;
    }
    const corpo: ConfirmarArquivo = {
      arquivo: arquivo.nome,
      documento: analise.documento,
      banco: analise.banco,
      contaId: contaId === 'nova' ? null : Number(contaId),
      novaConta: contaId === 'nova' ? { nome: nomeNovaConta.trim() } : null,
      vencimento: FATURA ? vencimento : null,
      saldoFinal: !FATURA && saldoFinal.trim() !== '' ? lerValor(saldoFinal) : null,
      itens: marcadas.map(({ data, descricao, valor, tipo, transferencia, parcela, totalParcelas }) => ({
        data,
        descricao,
        valor,
        tipo,
        transferencia,
        parcela,
        totalParcelas,
      })),
    };
    setEnviando(true);
    try {
      const r = await api.post<ResultadoArquivo>('/importacao/confirmar', corpo);
      aoConcluir(
        `${arquivo.nome}: ${r.novos} ${r.novos === 1 ? 'lançamento importado' : 'lançamentos importados'} em ${r.contaNome}` +
          (r.repetidos > 0 ? ` (${r.repetidos} já existiam)` : '') +
          '.'
      );
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setEnviando(false);
    }
  }

  if (!analise) {
    return (
      <div>
        {carregando && <Carregando />}
        {erro && (
          <>
            <Aviso tipo="erro">{erro}</Aviso>
            <div className="pagina-acoes">
              <Botao variante="texto" aoClicar={aoDescartar}>
                Descartar
              </Botao>
            </div>
          </>
        )}
      </div>
    );
  }

  const FATURA = analise.documento === 'FATURA';
  const linhas: LinhaItem[] = analise.itens.map((item, indice) => ({ ...item, indice }));
  const marcadas = linhas.filter((l) => marcados[l.indice] === true);
  const nenhumMarcado = marcadas.length === 0;
  const totalFatura = marcadas.reduce(
    (soma, l) => (l.transferencia ? soma : l.tipo === 'DESPESA' ? soma + l.valor : soma - l.valor),
    0
  );
  const jaImportadosMarcados = marcadas.filter((l) => l.jaImportado).length;

  return (
    <div className="importar-previa">
      <div className="fin-cabecalho">
        <div>
          <strong>{arquivo.nome}</strong>
          <div className="fin-suave">Banco: {analise.banco ?? 'não identificado'}</div>
        </div>
        <Botao variante="texto" aoClicar={aoDescartar}>
          Descartar
        </Botao>
      </div>

      {analise.avisos.map((aviso, i) => (
        <Aviso key={i} tipo="info">
          {aviso}
        </Aviso>
      ))}

      {analise.itens.length > 0 && (
        <>
          <div className="filtros">
            <Selecao
              rotulo="Tipo de arquivo"
              valor={analise.documento}
              aoMudar={(v) => {
                if (v === 'FATURA' || v === 'EXTRATO') trocarDocumento(v);
              }}
              opcoes={[
                { valor: 'FATURA', rotulo: 'Fatura do cartão' },
                { valor: 'EXTRATO', rotulo: 'Extrato da conta' },
              ]}
            />
            <Selecao
              rotulo={FATURA ? 'Cartão' : 'Conta'}
              valor={contaId}
              aoMudar={trocarConta}
              opcoes={[
                ...analise.contas.map((c) => ({ valor: String(c.id), rotulo: c.nome })),
                { valor: 'nova', rotulo: FATURA ? 'Criar um cartão novo' : 'Criar uma conta nova' },
              ]}
              vazio="Escolha"
            />
            {contaId === 'nova' && (
              <Campo
                rotulo={FATURA ? 'Nome do cartão' : 'Nome da conta'}
                valor={nomeNovaConta}
                aoMudar={setNomeNovaConta}
              />
            )}
            {FATURA && <Campo rotulo="Vencimento da fatura" tipo="date" valor={vencimento} aoMudar={setVencimento} />}
            {!FATURA && (
              <Campo
                rotulo="Saldo da conta depois deste extrato (R$, opcional)"
                valor={saldoFinal}
                aoMudar={setSaldoFinal}
              />
            )}
          </div>

          <div className="resumo">
            {FATURA ? (
              <>
                <ResumoItem icone="cartao" cor="laranja" valor={formatarReais(totalFatura)} rotulo="Total da fatura" />
                <ResumoItem icone="transacoes" cor="azul" valor={marcadas.length} rotulo="Lançamentos a importar" />
                <ResumoItem icone="visto" cor="verde" valor={jaImportadosMarcados} rotulo="Já importados" />
              </>
            ) : (
              <>
                <ResumoItem
                  icone="seta-cima"
                  cor="verde"
                  valor={formatarReais(somar(marcadas, 'RECEITA'))}
                  rotulo="Entradas"
                />
                <ResumoItem
                  icone="seta-baixo"
                  cor="vermelho"
                  valor={formatarReais(somar(marcadas, 'DESPESA'))}
                  rotulo="Saídas"
                />
                <ResumoItem icone="transacoes" cor="azul" valor={marcadas.length} rotulo="Lançamentos a importar" />
              </>
            )}
          </div>

          <div className="pagina-acoes">
            <Botao variante="texto" aoClicar={() => setMarcados(analise.itens.map(() => true))}>
              Marcar todos
            </Botao>
            <Botao variante="texto" aoClicar={() => setMarcados(analise.itens.map(() => false))}>
              Desmarcar todos
            </Botao>
          </div>

          <Tabela<LinhaItem>
            chave={(l) => l.indice}
            dados={linhas}
            vazio="Nenhum lançamento."
            colunas={[
              {
                titulo: 'Importar',
                celula: (l) => (
                  <input
                    type="checkbox"
                    checked={marcados[l.indice] === true}
                    onChange={(e) => marcarItem(l.indice, e.target.checked)}
                    aria-label={'Importar ' + l.descricao}
                  />
                ),
              },
              { titulo: 'Data', celula: (l) => formatarDia(l.data) },
              {
                titulo: 'Descrição',
                celula: (l) => (
                  <div>
                    <div>{l.descricao}</div>
                    {(l.parcela !== null || l.jaImportado || l.transferencia) && (
                      <div className="fin-suave">
                        {l.parcela !== null && l.totalParcelas !== null && `Parcela ${l.parcela} de ${l.totalParcelas} `}
                        {l.jaImportado && <Selo cor="cinza">Já importado</Selo>}
                        {l.transferencia && <Selo cor="azul">Pagamento/transferência</Selo>}
                      </div>
                    )}
                  </div>
                ),
              },
              {
                titulo: 'Valor',
                alinhar: 'direita',
                celula: (l) => <Valor valor={l.valor} sentido={l.tipo === 'DESPESA' ? 'saida' : 'entrada'} />,
              },
            ]}
          />
        </>
      )}

      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {analise.itens.length > 0 && (
        <div className="pagina-acoes">
          <Botao desabilitado={enviando || carregando || nenhumMarcado} aoClicar={confirmar}>
            Importar {marcadas.length} {marcadas.length === 1 ? 'lançamento' : 'lançamentos'}
          </Botao>
        </div>
      )}
    </div>
  );
}
