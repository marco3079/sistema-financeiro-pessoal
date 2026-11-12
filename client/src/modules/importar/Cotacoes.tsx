import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { mensagemErro } from '../../lib/financas';
import { Aviso, Botao, Campo, Carregando, Cartao, formatarDataHora } from '../../ui';
import type { EstadoCotacoes, ResultadoCotacoes } from './tipos';

export function Cotacoes({ versao }: { versao: number }) {
  const [estado, setEstado] = useState<EstadoCotacoes | null>(null);
  const [token, setToken] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    let ativo = true;
    api
      .get<EstadoCotacoes>('/cotacoes/estado')
      .then((e) => {
        if (ativo) setEstado(e);
      })
      .catch((e: unknown) => {
        if (ativo) setErro(mensagemErro(e));
      });
    return () => {
      ativo = false;
    };
  }, [versao]);

  // Roda uma ação com o estado de ocupado, limpando avisos antes e tratando erros.
  async function executar(acao: () => Promise<void>) {
    setOcupado(true);
    setErro(null);
    setSucesso(null);
    try {
      await acao();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  function salvar(e: FormEvent) {
    e.preventDefault();
    void executar(async () => {
      setEstado(await api.put<EstadoCotacoes>('/cotacoes/token', { token: token.trim() }));
      setToken('');
      setSucesso('Token salvo.');
    });
  }

  function apagar() {
    if (!window.confirm('Apagar o token das cotações?')) return;
    void executar(async () => {
      await api.del('/cotacoes/token');
      setEstado(await api.get<EstadoCotacoes>('/cotacoes/estado'));
    });
  }

  function atualizar() {
    void executar(async () => {
      const r = await api.post<ResultadoCotacoes>('/cotacoes/atualizar');
      setEstado(r.estado);
      if (r.erro) {
        setErro(r.erro);
        return;
      }
      setSucesso(
        `${r.atualizados} ${r.atualizados === 1 ? 'ativo atualizado' : 'ativos atualizados'}.` +
          (r.semCotacao.length > 0 ? ` Sem cotação: ${r.semCotacao.join(', ')}.` : ''),
      );
    });
  }

  if (!estado) {
    return (
      <Cartao titulo="Cotações automáticas">
        {erro ? <Aviso tipo="erro">{erro}</Aviso> : <Carregando />}
      </Cartao>
    );
  }

  return (
    <Cartao titulo="Cotações automáticas">
      <p className="fin-suave">
        O preço das ações, dos fundos imobiliários e dos ETFs é atualizado sozinho a cada 8 horas pela brapi.dev. É
        preciso um token gratuito.
      </p>

      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {sucesso && <Aviso tipo="sucesso">{sucesso}</Aviso>}

      {estado.configurado ? (
        <>
          <p className="fin-suave">
            {`Token configurado${estado.origemToken === 'ENV' ? ' no arquivo .env' : ''} · ${estado.ativosComCodigo} ativos com código` +
              (estado.ultimaAtualizacao
                ? ` · atualizado em ${formatarDataHora(estado.ultimaAtualizacao)}`
                : ' · ainda não atualizado')}
          </p>
          <div className="pagina-acoes">
            <Botao desabilitado={ocupado} aoClicar={atualizar}>
              Atualizar cotações agora
            </Botao>
            {estado.origemToken === 'BANCO' && (
              <Botao variante="perigo" desabilitado={ocupado} aoClicar={apagar}>
                Apagar token
              </Botao>
            )}
          </div>
        </>
      ) : (
        <>
          <ol>
            <li>
              Crie uma conta gratuita em{' '}
              <a href="https://brapi.dev" target="_blank" rel="noreferrer">
                brapi.dev
              </a>
            </li>
            <li>Copie o seu token no painel da brapi</li>
            <li>Cole aqui e salve</li>
          </ol>
          <form onSubmit={salvar}>
            <Campo rotulo="Token da brapi" tipo="password" valor={token} aoMudar={setToken} />
            <div className="pagina-acoes">
              <Botao tipo="submit" desabilitado={ocupado || token.trim() === ''}>
                Salvar token
              </Botao>
            </div>
          </form>
        </>
      )}
    </Cartao>
  );
}
