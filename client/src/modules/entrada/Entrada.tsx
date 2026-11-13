import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { mensagemErro } from '../../lib/financas';
import { useDados } from '../../lib/useDados';
import { Aviso, Botao, Cartao, Carregando, Pagina } from '../../ui';
import { Vazio } from '../../ui/financas';
import './entrada.css';

interface ResultadoEntrada {
  importados: { arquivo: string; novos: number; repetidos: number }[];
  comErro: { arquivo: string; motivo: string }[];
  ignorados: string[];
}

interface SituacaoEntrada {
  ativa: boolean;
  pasta: string;
  aguardando: string[];
  naoSuportados: string[];
  ultimos: ResultadoEntrada | null;
}

function Passos() {
  return (
    <ol className="entrada-passos">
      <li>Coloque o arquivo .csv ou .ofx do seu banco na pasta financas-pessoais/entrada do seu Drive.</li>
      <li>Espere cerca de 2 minutos. O sistema importa o arquivo sozinho.</li>
      <li>Confira o resultado abaixo. Arquivos com erro ficam em com-erro, com o motivo.</li>
    </ol>
  );
}

function Lista({ itens }: { itens: string[] }) {
  return (
    <ul className="entrada-lista">
      {itens.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

export function Entrada() {
  const { dados, carregando, erro, recarregar } = useDados<SituacaoEntrada>('/entrada');
  const [processando, setProcessando] = useState(false);
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  function processarAgora() {
    setProcessando(true);
    setErroAcao(null);
    api
      .post<SituacaoEntrada>('/entrada/processar', {})
      .then(() => recarregar())
      .catch((e: unknown) => setErroAcao(mensagemErro(e)))
      .finally(() => setProcessando(false));
  }

  if (carregando && !dados) {
    return (
      <Pagina titulo="Pasta de entrada">
        <Carregando />
      </Pagina>
    );
  }

  if (!dados) {
    return (
      <Pagina titulo="Pasta de entrada">
        <Aviso tipo="erro">{erro ?? 'Não consegui carregar a pasta de entrada.'}</Aviso>
      </Pagina>
    );
  }

  if (!dados.ativa) {
    return (
      <Pagina titulo="Pasta de entrada">
        <Cartao titulo="Conecte o Drive para usar">
          <p>
            Com o Drive conectado, você põe o arquivo do banco numa pasta e o sistema importa sozinho. Para isso, primeiro
            conecte uma pasta do seu Drive.
          </p>
          <p>
            <Link to="/app/drive">Ir para o Drive</Link>
          </p>
        </Cartao>
      </Pagina>
    );
  }

  const ultimos = dados.ultimos;

  return (
    <Pagina titulo="Pasta de entrada">
      <div className="entrada-blocos">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {erroAcao && <Aviso tipo="erro">{erroAcao}</Aviso>}

        <Cartao titulo="Como usar">
          <Passos />
        </Cartao>

        <Cartao titulo="Aguardando">
          {dados.aguardando.length === 0 ? (
            <Vazio icone="importar" titulo="Nenhum arquivo esperando" texto="A pasta está vazia por enquanto." />
          ) : (
            <Lista itens={dados.aguardando} />
          )}
        </Cartao>

        {dados.naoSuportados.length > 0 && (
          <Cartao titulo="Não suportados aqui">
            <p className="entrada-suave">Estes arquivos não são lidos pela pasta. Envie pela tela Importar.</p>
            <Lista itens={dados.naoSuportados} />
          </Cartao>
        )}

        <Cartao titulo="Última rodada">
          {ultimos === null ? (
            <p className="entrada-suave">Ainda não houve nenhuma rodada desde que o servidor iniciou.</p>
          ) : (
            <div className="entrada-resultado">
              <h3>Importados</h3>
              {ultimos.importados.length === 0 ? (
                <p className="entrada-suave">Nenhum arquivo importado.</p>
              ) : (
                <ul className="entrada-lista">
                  {ultimos.importados.map((item) => (
                    <li key={item.arquivo}>
                      {item.arquivo}: {item.novos} novos, {item.repetidos} repetidos
                    </li>
                  ))}
                </ul>
              )}

              <h3>Com erro</h3>
              {ultimos.comErro.length === 0 ? (
                <p className="entrada-suave">Nenhum erro.</p>
              ) : (
                <ul className="entrada-lista">
                  {ultimos.comErro.map((item) => (
                    <li key={item.arquivo}>
                      {item.arquivo}: {item.motivo}
                    </li>
                  ))}
                </ul>
              )}

              {ultimos.ignorados.length > 0 && (
                <>
                  <h3>Ignorados agora</h3>
                  <p className="entrada-suave">Chegaram há pouco ou são maiores que 4 MB. Tentamos de novo depois.</p>
                  <Lista itens={ultimos.ignorados} />
                </>
              )}
            </div>
          )}
        </Cartao>

        <div className="entrada-acao">
          <Botao desabilitado={processando} aoClicar={processarAgora}>
            {processando ? 'Processando...' : 'Processar agora'}
          </Botao>
        </div>
      </div>
    </Pagina>
  );
}
