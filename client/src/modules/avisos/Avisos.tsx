import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { mensagemErro } from '../../lib/financas';
import { useDados } from '../../lib/useDados';
import { Aviso, Botao, Campo, Cartao, Caixa, Carregando, Pagina } from '../../ui';
import './avisos.css';

// ---------- Tipos ----------

interface ConfigDTO {
  ativos: boolean;
  email: string | null;
  telegramConfigurado: boolean;
  telegramChatId: string | null;
  emailDisponivel: boolean;
}

type SituacaoCanal = 'ENVIADO' | 'FALHOU' | 'NAO_CONFIGURADO' | 'DESLIGADO' | 'SEM_NOVIDADE';

interface ResultadoCanal {
  situacao: SituacaoCanal;
  erro: string | null;
}

interface ResultadoEnvio {
  enviados: number;
  canais: { email: ResultadoCanal; telegram: ResultadoCanal };
}

const TEXTO_SITUACAO: Record<SituacaoCanal, string> = {
  ENVIADO: 'Enviado',
  FALHOU: 'Não foi possível enviar',
  NAO_CONFIGURADO: 'Não configurado',
  DESLIGADO: 'Desligado',
  SEM_NOVIDADE: 'Sem novidade',
};

const O_QUE_E_AVISADO = [
  'Faturas não pagas que vencem em até 3 dias ou já estão atrasadas.',
  'Contas fixas a pagar que vencem em até 3 dias.',
  'Categorias com orçamento do mês acima de 90%.',
  'Cobranças estranhas de gravidade alta (repetidas, aumentos e parcelas a mais).',
];

// ---------- Resultado dos canais ----------

function LinhaCanal({ rotulo, canal }: { rotulo: string; canal: ResultadoCanal }) {
  return (
    <li>
      <strong>{rotulo}:</strong> {TEXTO_SITUACAO[canal.situacao]}
      {canal.erro && <span className="avisos-erro-canal"> ({canal.erro})</span>}
    </li>
  );
}

function ResultadoDoEnvio({ resultado, titulo }: { resultado: ResultadoEnvio; titulo: string }) {
  return (
    <div className="avisos-resultado" aria-live="polite">
      <p className="avisos-resultado-titulo">
        {titulo}
        {resultado.enviados > 0 ? ` (${resultado.enviados} aviso(s))` : ''}
      </p>
      <ul className="avisos-lista-canais">
        <LinhaCanal rotulo="E-mail" canal={resultado.canais.email} />
        <LinhaCanal rotulo="Telegram" canal={resultado.canais.telegram} />
      </ul>
    </div>
  );
}

// ---------- Formulário de configuração ----------

function FormConfig({ config, aoSalvo }: { config: ConfigDTO; aoSalvo: () => void }) {
  const [ativos, setAtivos] = useState(config.ativos);
  const [email, setEmail] = useState(config.email ?? '');
  const [token, setToken] = useState('');
  const [chatId, setChatId] = useState(config.telegramChatId ?? '');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState(false);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setSucesso(false);
    setOcupado(true);
    try {
      await api.put('/avisos/config', {
        ativos,
        email: email.trim() === '' ? null : email.trim(),
        ...(token.trim() === '' ? {} : { telegramToken: token.trim() }),
        telegramChatId: chatId.trim() === '' ? null : chatId.trim(),
      });
      setToken('');
      setSucesso(true);
      aoSalvo();
    } catch (err) {
      setErro(mensagemErro(err));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <form onSubmit={salvar}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {sucesso && <Aviso tipo="sucesso">Configuração salva.</Aviso>}
      <Caixa rotulo="Ligar os avisos" marcado={ativos} aoMudar={setAtivos} />

      <h3 className="avisos-subtitulo">E-mail</h3>
      {!config.emailDisponivel && (
        <Aviso tipo="info">O envio de e-mail não está disponível: o servidor de e-mail (SMTP) não está configurado.</Aviso>
      )}
      <Campo rotulo="E-mail de destino" valor={email} aoMudar={setEmail} tipo="email" />

      <h3 className="avisos-subtitulo">Telegram</h3>
      <ol className="avisos-passos">
        <li>No Telegram, fale com o @BotFather e crie um bot. Ele entrega um token.</li>
        <li>Mande uma mensagem qualquer para o seu bot novo.</li>
        <li>
          Pegue o chat id: abra no navegador o endereço <code>https://api.telegram.org/bot(seu token)/getUpdates</code> e
          procure o número depois de <code>{'"chat":{"id":'}</code>.
        </li>
      </ol>
      <Campo rotulo="Token do bot" valor={token} aoMudar={setToken} tipo="password" />
      {config.telegramConfigurado && <p className="avisos-dica">Já há um token salvo. Digite de novo só para trocar.</p>}
      <Campo rotulo="Chat id" valor={chatId} aoMudar={setChatId} />

      <div className="pagina-acoes">
        <Botao tipo="submit" desabilitado={ocupado}>
          Salvar
        </Botao>
      </div>
    </form>
  );
}

// ---------- Tela ----------

export function Avisos() {
  const { dados, carregando, erro, recarregar } = useDados<ConfigDTO>('/avisos/config');
  const [ocupadoAcao, setOcupadoAcao] = useState<'testar' | 'enviar' | null>(null);
  const [resultado, setResultado] = useState<{ titulo: string; dados: ResultadoEnvio } | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  async function executar(acao: 'testar' | 'enviar') {
    setErroAcao(null);
    setResultado(null);
    setOcupadoAcao(acao);
    try {
      const caminho = acao === 'testar' ? '/avisos/testar' : '/avisos/enviar';
      const titulo = acao === 'testar' ? 'Resultado do teste' : 'Resultado do envio';
      const dadosEnvio = await api.post<ResultadoEnvio>(caminho);
      setResultado({ titulo, dados: dadosEnvio });
    } catch (err) {
      setErroAcao(mensagemErro(err));
    } finally {
      setOcupadoAcao(null);
    }
  }

  return (
    <Pagina titulo="Avisos">
      {carregando && <Carregando />}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      {dados && (
        <>
          <Cartao titulo="Configuração">
            <FormConfig config={dados} aoSalvo={recarregar} />
          </Cartao>

          <Cartao titulo="Enviar agora">
            <p className="avisos-texto">
              Os avisos saem sozinhos todo dia às 8h. Use os botões abaixo para testar os canais ou mandar o que
              estiver pendente agora.
            </p>
            <div className="pagina-acoes">
              <Botao variante="secundario" desabilitado={ocupadoAcao !== null} aoClicar={() => void executar('testar')}>
                {ocupadoAcao === 'testar' ? 'Testando...' : 'Testar'}
              </Botao>
              <Botao desabilitado={ocupadoAcao !== null} aoClicar={() => void executar('enviar')}>
                {ocupadoAcao === 'enviar' ? 'Enviando...' : 'Enviar agora'}
              </Botao>
            </div>
            {erroAcao && <Aviso tipo="erro">{erroAcao}</Aviso>}
            {resultado && <ResultadoDoEnvio titulo={resultado.titulo} resultado={resultado.dados} />}
          </Cartao>

          <Cartao titulo="O que é avisado">
            <ul className="avisos-lista">
              {O_QUE_E_AVISADO.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <p className="avisos-dica">Cada aviso sai uma vez só. Sem novidade, nada é enviado.</p>
          </Cartao>
        </>
      )}
    </Pagina>
  );
}
