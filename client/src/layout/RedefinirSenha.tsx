import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { Aviso, Botao, Campo } from '../ui';
import { TelaSenha } from './EsqueciSenha';
import './senha.css';

type TipoToken = 'RECUPERACAO' | 'BOAS_VINDAS';

interface RespostaConsulta {
  valido: boolean;
  nome?: string;
  tipo?: TipoToken;
}

type Consulta =
  | { situacao: 'carregando' }
  | { situacao: 'erro' }
  | { situacao: 'invalido' }
  | { situacao: 'valido'; nome: string; tipo: TipoToken };

const MINIMO_SENHA = 6;

export function RedefinirSenha() {
  const { token = '' } = useParams<{ token: string }>();
  const navegar = useNavigate();
  const [consulta, setConsulta] = useState<Consulta>({ situacao: 'carregando' });
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // Confere o link assim que a tela abre.
  useEffect(() => {
    let cancelado = false;
    setConsulta({ situacao: 'carregando' });
    api
      .get<RespostaConsulta>(`/auth/redefinir-senha/${encodeURIComponent(token)}`)
      .then((r) => {
        if (cancelado) return;
        if (r.valido && r.nome && r.tipo) {
          setConsulta({ situacao: 'valido', nome: r.nome, tipo: r.tipo });
        } else {
          setConsulta({ situacao: 'invalido' });
        }
      })
      .catch(() => {
        if (!cancelado) setConsulta({ situacao: 'erro' });
      });
    return () => {
      cancelado = true;
    };
  }, [token]);

  const linkNovo = (
    <Link to="/esqueci-senha" className="senha-link">
      Pedir um novo link
    </Link>
  );
  const voltar = (
    <Link to="/login" className="senha-link">
      Voltar para o login
    </Link>
  );

  if (consulta.situacao === 'carregando') {
    return (
      <TelaSenha titulo="Verificando o link">
        <p className="entrada-apoio" role="status" aria-live="polite">
          Aguarde um instante...
        </p>
      </TelaSenha>
    );
  }

  if (consulta.situacao === 'invalido') {
    return (
      <TelaSenha
        titulo="Link inválido"
        rodape={linkNovo}
      >
        <Aviso tipo="erro">Link inválido ou vencido. Peça um novo.</Aviso>
      </TelaSenha>
    );
  }

  if (consulta.situacao === 'erro') {
    return (
      <TelaSenha
        titulo="Não foi possível verificar"
        rodape={voltar}
      >
        <Aviso tipo="erro">Não foi possível verificar o link agora. Tente de novo em instantes.</Aviso>
      </TelaSenha>
    );
  }

  const titulo = consulta.tipo === 'BOAS_VINDAS' ? 'Criar senha' : 'Redefinir senha';

  async function salvar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setErro(null);
    if (novaSenha.length < MINIMO_SENHA) {
      setErro(`A senha precisa ter pelo menos ${MINIMO_SENHA} caracteres.`);
      return;
    }
    if (novaSenha !== confirmacao) {
      setErro('As senhas não conferem.');
      return;
    }
    setEnviando(true);
    try {
      await api.post('/auth/redefinir-senha', { token, novaSenha });
      navegar('/login', {
        replace: true,
        state: { aviso: 'Senha salva. Entre com a nova senha.' },
      });
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro inesperado');
      setEnviando(false);
    }
  }

  return (
    <TelaSenha
      titulo={titulo}
      apoio={`Olá, ${consulta.nome}`}
      aoEnviar={salvar}
      rodape={voltar}
    >
      <Campo rotulo="Nova senha" tipo="password" valor={novaSenha} aoMudar={setNovaSenha} obrigatorio />
      <Campo
        rotulo="Confirmar nova senha"
        tipo="password"
        valor={confirmacao}
        aoMudar={setConfirmacao}
        obrigatorio
      />
      <p className="senha-dica">Use pelo menos {MINIMO_SENHA} caracteres.</p>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <div className="entrada-botao">
        <Botao tipo="submit" desabilitado={enviando}>
          {enviando ? 'Salvando...' : 'Salvar senha'}
        </Botao>
      </div>
    </TelaSenha>
  );
}
