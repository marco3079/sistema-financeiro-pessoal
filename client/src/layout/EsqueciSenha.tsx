import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { usePlataforma } from '../lib/plataforma';
import { Aviso, Botao, Campo } from '../ui';
import { BotaoTema } from './Layout';
import './login.css';
import './senha.css';

// Moldura das telas de senha por e-mail: o mesmo visual do login (classes entrada-),
// com nome, slogan e logo vindos da plataforma. Usada também por RedefinirSenha.
export function TelaSenha({
  titulo,
  apoio,
  children,
  rodape,
  aoEnviar,
}: {
  titulo: string;
  apoio?: string;
  children?: ReactNode;
  rodape?: ReactNode;
  aoEnviar?: (evento: FormEvent<HTMLFormElement>) => void;
}) {
  const { plataforma, logoSrc } = usePlataforma();

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
        </div>
      </aside>

      <section className="entrada-formulario">
        <form className="entrada-cartao" onSubmit={aoEnviar}>
          <div className="entrada-cartao-marca">
            <img src={logoSrc} alt="" className="entrada-logo" width={56} height={56} />
            <span>{plataforma.nome}</span>
          </div>
          <h1 className="entrada-titulo">{titulo}</h1>
          {apoio && <p className="entrada-apoio">{apoio}</p>}
          {children}
          {rodape && <div className="senha-rodape">{rodape}</div>}
        </form>
      </section>
    </main>
  );
}

export function EsqueciSenha() {
  const [email, setEmail] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      const resposta = await api.post<{ mensagem: string }>('/auth/esqueci-senha', { email });
      setMensagem(resposta.mensagem);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro inesperado');
    } finally {
      setEnviando(false);
    }
  }

  const voltar = (
    <Link to="/login" className="senha-link">
      Voltar para o login
    </Link>
  );

  if (mensagem !== null) {
    return (
      <TelaSenha
        titulo="Verifique seu e-mail"
        rodape={voltar}
      >
        <Aviso tipo="sucesso">{mensagem}</Aviso>
      </TelaSenha>
    );
  }

  return (
    <TelaSenha
      titulo="Esqueci minha senha"
      apoio="Informe o e-mail da sua conta. Enviaremos o link para criar uma nova senha."
      aoEnviar={enviar}
      rodape={voltar}
    >
      <Campo rotulo="E-mail" tipo="email" valor={email} aoMudar={setEmail} obrigatorio />
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <div className="entrada-botao">
        <Botao tipo="submit" desabilitado={enviando}>
          {enviando ? 'Enviando...' : 'Enviar instruções'}
        </Botao>
      </div>
    </TelaSenha>
  );
}
