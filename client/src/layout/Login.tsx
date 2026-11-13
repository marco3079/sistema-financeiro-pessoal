import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { ErroCodigo, useAuth } from '../lib/auth';
import { usePlataforma } from '../lib/plataforma';
import { Aviso, Botao, Campo } from '../ui';
import { Icone } from '../ui/icones';
import { BotaoTema, caminhoDoPerfil } from './Layout';
import './login.css';

export function Login() {
  const { usuario, entrar } = useAuth();
  const { plataforma, logoSrc } = usePlataforma();
  const local = useLocation();
  const estado = local.state as { aviso?: unknown } | null;
  const avisoRecebido = typeof estado?.aviso === 'string' ? estado.aviso : null;
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  // Segundo passo (verificação em duas etapas) na mesma tela.
  const [etapa, setEtapa] = useState<'senha' | 'codigo'>('senha');
  const [codigo, setCodigo] = useState('');

  if (usuario) return <Navigate to={caminhoDoPerfil(usuario.perfil)} replace />;

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await entrar(email, senha, etapa === 'codigo' ? codigo : undefined);
    } catch (e) {
      if (e instanceof ErroCodigo) {
        setEtapa('codigo');
      }
      setErro(e instanceof Error ? e.message : 'Erro inesperado');
      setEnviando(false);
    }
  }

  function voltar() {
    setEtapa('senha');
    setCodigo('');
    setErro(null);
  }

  return (
    <main className="entrada">
      <div className="entrada-tema">
        <BotaoTema />
      </div>
      <aside className="entrada-marca">
        <div className="entrada-marca-topo">
          <img src={logoSrc} alt="" className="entrada-logo" width={56} height={56} />
          <span className="entrada-marca-nome">{plataforma.nome}</span>
        </div>

        <div className="entrada-marca-meio">
          <h2 className="entrada-frase">{plataforma.slogan}</h2>
          <p className="entrada-marca-apoio">
            Do extrato do banco à carteira de investimentos, tudo no mesmo painel.
          </p>
          <ul className="entrada-destaques">
            <li>
              <Icone nome="importar" tamanho={20} />
              <span>Fatura e extrato importados do arquivo do banco</span>
            </li>
            <li>
              <Icone nome="cartao" tamanho={20} />
              <span>Faturas do cartão com cada compra e parcela</span>
            </li>
            <li>
              <Icone nome="investimentos" tamanho={20} />
              <span>Carteira da B3 com cotações atualizadas</span>
            </li>
          </ul>
        </div>
      </aside>

      <section className="entrada-formulario">
        <form className="entrada-cartao" onSubmit={enviar}>
          <div className="entrada-cartao-marca">
            <img src={logoSrc} alt="" className="entrada-logo" width={56} height={56} />
            <span>{plataforma.nome}</span>
          </div>
          <h1 className="entrada-titulo">Entrar</h1>
          {avisoRecebido && <Aviso tipo="sucesso">{avisoRecebido}</Aviso>}
          <p className="entrada-apoio">
            {etapa === 'codigo'
              ? 'Abra o aplicativo autenticador e digite o código de 6 dígitos, ou use um código de recuperação.'
              : 'Use seu e-mail e sua senha.'}
          </p>
          <Campo rotulo="E-mail" tipo="email" valor={email} aoMudar={setEmail} obrigatorio />
          <Campo rotulo="Senha" tipo="password" valor={senha} aoMudar={setSenha} obrigatorio />
          {etapa === 'codigo' && (
            // Campo da ui não aceita inputMode/autoComplete: usa a mesma marcação com os atributos do celular.
            <label className="campo">
              <span className="campo-rotulo">Código de verificação</span>
              <input
                className="campo-controle"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={codigo}
                required
                onChange={(e) => setCodigo(e.target.value)}
              />
            </label>
          )}
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          <div className="entrada-botao">
            <Botao tipo="submit" desabilitado={enviando}>
              {enviando ? 'Entrando...' : 'Entrar'}
            </Botao>
            {etapa === 'codigo' && (
              <Botao variante="secundario" aoClicar={voltar} desabilitado={enviando}>
                Voltar
              </Botao>
            )}
          </div>
          {plataforma.recuperacaoSenha && (
            <Link to="/esqueci-senha" className="entrada-esqueci">
              Esqueci minha senha
            </Link>
          )}
        </form>
      </section>
    </main>
  );
}
