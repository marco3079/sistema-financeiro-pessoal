import { useEffect } from 'react';
import { formatarDia, formatarReais } from '../../lib/financas';
import { useDados } from '../../lib/useDados';
import { Aviso, Cartao, Carregando, Selo, Tabela, formatarDataHora } from '../../ui';
import type { ImportacaoDTO } from './tipos';

export function Historico({ versao }: { versao: number }) {
  const { dados, carregando, erro, recarregar } = useDados<ImportacaoDTO[]>('/importacao/historico');

  useEffect(() => {
    recarregar();
  }, [versao, recarregar]);

  return (
    <Cartao titulo="Arquivos importados">
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {!dados && carregando && <Carregando />}
      {dados && (
        <Tabela<ImportacaoDTO>
          chave={(i) => i.id}
          dados={dados}
          vazio="Nenhum arquivo importado ainda."
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
          ]}
        />
      )}
    </Cartao>
  );
}
