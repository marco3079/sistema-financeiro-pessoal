import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { formatarDia, formatarReais, mensagemErro } from '../../lib/financas';
import { useDados } from '../../lib/useDados';
import { Aviso, Botao, Cartao, Carregando, MenuAcoes, Modal, Selo, Tabela, formatarDataHora } from '../../ui';
import type { AcaoMenu } from '../../ui';
import { DetalheImportacao } from './DetalheImportacao';
import type { ImportacaoDTO, RemocaoDTO } from './tipos';
import './historico.css';

export function Historico({ versao }: { versao: number }) {
  const { dados, carregando, erro, recarregar } = useDados<ImportacaoDTO[]>('/importacao/historico');
  const [detalheId, setDetalheId] = useState<number | null>(null);
  const [removendo, setRemovendo] = useState<ImportacaoDTO | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erroRemover, setErroRemover] = useState<string | null>(null);
  const [resultado, setResultado] = useState<string | null>(null);

  useEffect(() => {
    recarregar();
  }, [versao, recarregar]);

  // Ações do menu de três pontos de cada linha.
  function acoesDo(i: ImportacaoDTO): AcaoMenu[] {
    return [
      { rotulo: 'Ver detalhes', icone: 'lista', aoClicar: () => setDetalheId(i.id) },
      {
        rotulo: 'Remover importação',
        icone: 'lixeira',
        perigo: true,
        aoClicar: () => {
          setErroRemover(null);
          setResultado(null);
          setRemovendo(i);
        },
      },
    ];
  }

  async function remover() {
    if (!removendo) return;
    setErroRemover(null);
    setOcupado(true);
    try {
      const removido = await api.del<RemocaoDTO>(`/importacao/${removendo.id}`);
      setRemovendo(null);
      const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
      const partes =
        removendo.tipo === 'B3'
          ? [`${plural(removido.movimentos, 'movimento', 'movimentos')} e ${plural(removido.investimentos, 'ativo', 'ativos')} apagados.`]
          : [`${plural(removido.lancamentos, 'lançamento apagado', 'lançamentos apagados')}.`];
      if (removido.faturas > 0) partes.push(`${plural(removido.faturas, 'fatura vazia removida', 'faturas vazias removidas')}.`);
      setResultado('Importação removida: ' + partes.join(' '));
      recarregar();
    } catch (e) {
      setErroRemover(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  const textoRemover =
    removendo?.tipo === 'B3'
      ? `Remover "${removendo.arquivo}" apaga os movimentos (compras, vendas e proventos) que essa planilha trouxe. Os ativos que vieram só dela saem junto; os demais continuam com a quantidade e o saldo atuais.`
      : `Remover "${removendo?.arquivo ?? ''}" apaga os ${removendo?.novos ?? 0} lançamentos que esse arquivo trouxe, inclusive os que você editou depois, e acerta o saldo e a fatura. Não dá para desfazer.`;

  return (
    <Cartao titulo="Arquivos importados">
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {resultado && <Aviso tipo="info">{resultado}</Aviso>}
      {!dados && carregando && <Carregando />}
      {dados && (
        <Tabela<ImportacaoDTO>
          chave={(i) => i.id}
          dados={dados}
          vazio="Nenhum arquivo importado ainda."
          aoClicarLinha={(i) => {
            setResultado(null);
            setDetalheId(i.id);
          }}
          colunas={[
            { titulo: 'Quando', celula: (i) => formatarDataHora(i.criadoEm) },
            { titulo: 'Arquivo', celula: (i) => i.arquivo },
            {
              titulo: 'Tipo',
              celula: (i) => (
                <Selo cor={i.tipo === 'FATURA' ? 'azul' : i.tipo === 'EXTRATO' ? 'verde' : 'amarelo'}>
                  {i.tipo === 'FATURA' ? 'Fatura' : i.tipo === 'EXTRATO' ? 'Extrato' : 'B3'}
                </Selo>
              ),
            },
            { titulo: 'Banco', celula: (i) => i.banco ?? '—' },
            {
              titulo: 'Referência',
              celula: (i) =>
                i.tipo === 'FATURA' && i.referencia ? 'Vencimento ' + formatarDia(i.referencia) : (i.referencia ?? '—'),
            },
            { titulo: 'Conta', celula: (i) => i.contaNome ?? '—' },
            { titulo: 'Novos', alinhar: 'direita', celula: (i) => i.novos },
            { titulo: 'Repetidos', alinhar: 'direita', celula: (i) => i.repetidos },
            {
              titulo: 'Total',
              alinhar: 'direita',
              celula: (i) => (i.total === null ? '—' : formatarReais(i.total)),
            },
            {
              titulo: 'Ações',
              acoes: true,
              celula: (i) => <MenuAcoes rotulo={'Ações da importação ' + i.arquivo} acoes={acoesDo(i)} />,
            },
          ]}
        />
      )}

      {detalheId !== null && (
        <DetalheImportacao importacaoId={detalheId} aoFechar={() => setDetalheId(null)} aoMudar={recarregar} />
      )}

      <Modal aberto={removendo !== null} titulo="Remover importação" aoFechar={() => setRemovendo(null)}>
        {removendo && (
          <div className="historico-blocos">
            <p>{textoRemover}</p>
            {erroRemover && <Aviso tipo="erro">{erroRemover}</Aviso>}
            <div className="pagina-acoes">
              <Botao variante="secundario" aoClicar={() => setRemovendo(null)}>
                Cancelar
              </Botao>
              <Botao variante="perigo" desabilitado={ocupado} aoClicar={remover}>
                Remover
              </Botao>
            </div>
          </div>
        )}
      </Modal>
    </Cartao>
  );
}
