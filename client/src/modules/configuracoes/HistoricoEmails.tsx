import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Aviso, Carregando, Selo, Tabela, formatarDataHora } from '../../ui';
import type { ColunaTabela } from '../../ui';
import { mensagemErro } from '../cadastros/tipos';
import { rotuloTipoEmail } from './tipos';
import type { EmailEnviadoDTO } from './tipos';

const COLUNAS: ColunaTabela<EmailEnviadoDTO>[] = [
  { titulo: 'Data', celula: (i) => formatarDataHora(i.criadoEm) },
  { titulo: 'Destinatário', celula: (i) => i.para },
  { titulo: 'Assunto', celula: (i) => i.assunto },
  { titulo: 'Tipo', celula: (i) => rotuloTipoEmail(i.tipo) },
  {
    titulo: 'Situação',
    celula: (i) => (
      <>
        <Selo cor={i.status === 'ENVIADO' ? 'verde' : 'vermelho'}>
          {i.status === 'ENVIADO' ? 'Enviado' : 'Falhou'}
        </Selo>
        {i.erro && <span className="config-erro-suave">{i.erro}</span>}
      </>
    ),
  },
];

// Últimos 30 registros de GET /configuracoes/email/historico. Recarrega quando `versao` muda.
export function HistoricoEmails({ versao }: { versao: number }) {
  const [itens, setItens] = useState<EmailEnviadoDTO[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    api
      .get<EmailEnviadoDTO[]>('/configuracoes/email/historico')
      .then((dados) => {
        if (!ativo) return;
        setItens(dados);
        setErro(null);
      })
      .catch((e) => {
        if (ativo) setErro(mensagemErro(e));
      });
    return () => {
      ativo = false;
    };
  }, [versao]);

  if (erro) return <Aviso tipo="erro">{erro}</Aviso>;
  if (!itens) return <Carregando />;

  return (
    <Tabela
      colunas={COLUNAS}
      dados={itens}
      chave={(i) => i.id}
      vazio="Nenhum e-mail enviado ainda."
    />
  );
}
