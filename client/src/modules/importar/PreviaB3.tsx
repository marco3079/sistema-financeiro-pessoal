import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { formatarDia, formatarReais, mensagemErro, rotuloDe, TIPOS_INVESTIMENTO } from '../../lib/financas';
import { Aviso, Botao, Carregando, Selo, Tabela } from '../../ui';
import type { ColunaTabela } from '../../ui';
import { ResumoItem } from '../../ui/financas';
import type { AnaliseB3, ConfirmarB3, Planilha, PosicaoB3, ResultadoB3 } from './tipos';
import './importar-b3.css';

export function PreviaB3(props: {
  nome: string;
  planilhas: Planilha[];
  aoConcluir: (mensagem: string) => void;
  aoDescartar: () => void;
}) {
  const { nome, planilhas, aoConcluir, aoDescartar } = props;
  const [analise, setAnalise] = useState<AnaliseB3 | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [marcadas, setMarcadas] = useState<Record<string, boolean>>({});
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    let ativo = true;
    api
      .post<AnaliseB3>('/importacao/b3/analisar', { nome, planilhas })
      .then((a) => {
        if (!ativo) return;
        setAnalise(a);
        setMarcadas(Object.fromEntries(a.posicoes.map((p) => [p.chave, !p.suspeita])));
      })
      .catch((e: unknown) => {
        if (ativo) setErro(mensagemErro(e));
      })
      .finally(() => {
        if (ativo) setCarregando(false);
      });
    return () => {
      ativo = false;
    };
  }, []);

  if (!analise) {
    if (!carregando && erro) {
      return (
        <div>
          <Aviso tipo="erro">{erro}</Aviso>
          <div className="pagina-acoes">
            <Botao variante="texto" aoClicar={aoDescartar}>
              Descartar
            </Botao>
          </div>
        </div>
      );
    }
    return <Carregando />;
  }

  const posicoesMarcadas = analise.posicoes.filter((p) => marcadas[p.chave]);
  const quantidadeMarcada = posicoesMarcadas.length;
  const nenhumaMarcada = quantidadeMarcada === 0;
  const somaAplicado = posicoesMarcadas.reduce((soma, p) => soma + (p.valorAplicado ?? 0), 0);

  const rotuloTipo =
    analise.tipo === 'MOVIMENTACAO'
      ? 'Movimentação da B3' +
        (analise.periodo ? ` de ${formatarDia(analise.periodo.de)} a ${formatarDia(analise.periodo.ate)}` : '')
      : analise.tipo === 'POSICAO'
        ? 'Posição da B3'
        : 'Planilha não reconhecida';

  function confirmar() {
    const tipo = analise?.tipo;
    if (!analise || (tipo !== 'MOVIMENTACAO' && tipo !== 'POSICAO')) return;
    const corpo: ConfirmarB3 = {
      arquivo: nome,
      tipo,
      periodo: analise.periodo,
      posicoes: posicoesMarcadas.map((p) => ({
        chave: p.chave,
        codigo: p.codigo,
        nome: p.nome,
        tipo: p.tipo,
        subtipo: p.subtipo,
        instituicao: p.instituicao,
        quantidade: p.quantidade,
        valorAplicado: p.valorAplicado,
        saldo: p.saldo,
        vencimento: p.vencimento,
      })),
      movimentos: analise.movimentos.filter((m) => marcadas[m.chave]),
      encerradas: analise.encerradas,
    };
    setErro(null);
    setEnviando(true);
    api
      .post<ResultadoB3>('/importacao/b3/confirmar', corpo)
      .then((r) => {
        aoConcluir(
          `${nome}: ${r.criados} ${r.criados === 1 ? 'ativo novo' : 'ativos novos'}, ${r.atualizados} atualizados e ${r.movimentosNovos} movimentos importados` +
            (r.movimentosRepetidos > 0 ? ` (${r.movimentosRepetidos} já existiam)` : '') +
            '.',
        );
      })
      .catch((e: unknown) => {
        setErro(mensagemErro(e));
      })
      .finally(() => {
        setEnviando(false);
      });
  }

  const todasAsPosicoes = analise.posicoes;

  function definirTodas(valor: boolean) {
    setMarcadas(Object.fromEntries(todasAsPosicoes.map((p) => [p.chave, valor])));
  }

  const colunas: ColunaTabela<PosicaoB3>[] = [
    {
      titulo: 'Importar',
      celula: (p) => (
        <input
          type="checkbox"
          checked={marcadas[p.chave] ?? false}
          onChange={(e) => {
            const valor = e.target.checked;
            setMarcadas((atual) => ({ ...atual, [p.chave]: valor }));
          }}
          aria-label={'Importar ' + p.chave}
        />
      ),
    },
    {
      titulo: 'Ativo',
      celula: (p) => (
        <span className="b3-celula">
          <strong>{p.codigo ?? p.nome}</strong>
          {(p.codigo || p.instituicao) && (
            <span className="fin-suave">
              {p.codigo && <span>{p.nome}</span>}
              {p.instituicao && <span>{p.instituicao}</span>}
            </span>
          )}
          <span>
            {p.investimentoId !== null ? <Selo cor="azul">Atualiza</Selo> : <Selo cor="verde">Novo</Selo>}
            {p.suspeita && (
              <>
                {' '}
                <Selo cor="amarelo">Conferir</Selo>
              </>
            )}
          </span>
        </span>
      ),
    },
    { titulo: 'Tipo', celula: (p) => rotuloDe(TIPOS_INVESTIMENTO, p.tipo) },
    {
      titulo: 'Quantidade',
      alinhar: 'direita',
      celula: (p) => p.quantidade.toLocaleString('pt-BR', { maximumFractionDigits: 6 }),
    },
    {
      titulo: 'Aplicado',
      alinhar: 'direita',
      celula: (p) => (p.valorAplicado === null ? '—' : formatarReais(p.valorAplicado)),
    },
    ...(analise.tipo === 'POSICAO'
      ? [
          {
            titulo: 'Saldo',
            alinhar: 'direita' as const,
            celula: (p: PosicaoB3) => (p.saldo === null ? '—' : formatarReais(p.saldo)),
          },
        ]
      : []),
    {
      titulo: 'Proventos',
      alinhar: 'direita',
      celula: (p) => (p.proventos > 0 ? formatarReais(p.proventos) : '—'),
    },
    { titulo: 'Último movimento', celula: (p) => formatarDia(p.ultimoMovimento) },
  ];

  return (
    <div>
      <div className="fin-cabecalho">
        <div>
          <strong>{nome}</strong>
          <div className="fin-suave">{rotuloTipo}</div>
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

      {analise.posicoes.length === 0 ? null : (
        <>
          <div className="resumo">
            <ResumoItem icone="investimentos" cor="azul" valor={quantidadeMarcada} rotulo="Ativos a importar" />
            <ResumoItem icone="financeiro" cor="roxo" valor={formatarReais(somaAplicado)} rotulo="Valor aplicado" />
            <ResumoItem
              icone="seta-cima"
              cor="verde"
              valor={formatarReais(analise.totalProventos)}
              rotulo="Proventos recebidos"
            />
            <ResumoItem
              icone="transacoes"
              cor="laranja"
              valor={analise.movimentos.length}
              rotulo="Movimentos no arquivo"
            />
          </div>

          {analise.posicoes.some((p) => p.suspeita) && (
            <Aviso tipo="info">
              Os ativos desmarcados não têm movimento há mais de um ano ou a quantidade não bate com o último provento:
              provavelmente saíram da carteira ou mudaram de código. Marque só os que você ainda tem.
            </Aviso>
          )}

          <div className="pagina-acoes">
            <Botao variante="texto" aoClicar={() => definirTodas(true)}>
              Marcar todos
            </Botao>
            <Botao variante="texto" aoClicar={() => definirTodas(false)}>
              Desmarcar todos
            </Botao>
          </div>

          <Tabela<PosicaoB3>
            chave={(p) => p.chave}
            dados={analise.posicoes}
            vazio="Nenhum ativo."
            colunas={colunas}
          />

          {erro && <Aviso tipo="erro">{erro}</Aviso>}

          {analise.tipo !== 'DESCONHECIDA' && (
            <div className="pagina-acoes">
              <Botao desabilitado={enviando || nenhumaMarcada} aoClicar={confirmar}>
                Importar {quantidadeMarcada} ativos
              </Botao>
            </div>
          )}
        </>
      )}
    </div>
  );
}
