import { useState } from 'react';
import { Aviso, Botao, Campo } from '../../ui';
import { mensagemErro } from '../cadastros/tipos';
import { CampoLogo } from './CampoLogo';
import type { IdentidadeDados } from './tipos';

export function Identidade({
  valor,
  aoMudar,
  aoSalvar,
}: {
  valor: IdentidadeDados;
  aoMudar: (parcial: Partial<IdentidadeDados>) => void;
  aoSalvar: (dados: IdentidadeDados) => Promise<void>;
}) {
  const [aviso, setAviso] = useState<{ tipo: 'erro' | 'sucesso'; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function salvar() {
    setAviso(null);
    const nome = valor.nome.trim();
    if (nome.length < 2 || nome.length > 40) {
      setAviso({ tipo: 'erro', texto: 'O nome deve ter de 2 a 40 caracteres.' });
      return;
    }
    if (valor.slogan.trim().length > 80) {
      setAviso({ tipo: 'erro', texto: 'O slogan deve ter no máximo 80 caracteres.' });
      return;
    }
    setOcupado(true);
    try {
      await aoSalvar(valor);
      setAviso({ tipo: 'sucesso', texto: 'Identidade salva.' });
    } catch (e) {
      setAviso({ tipo: 'erro', texto: mensagemErro(e) });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="config-duas-colunas">
      <div className="config-formulario">
        <Campo
          rotulo="Nome da plataforma"
          valor={valor.nome}
          aoMudar={(nome) => aoMudar({ nome })}
          obrigatorio
        />
        <Campo
          rotulo="Slogan"
          valor={valor.slogan}
          aoMudar={(slogan) => aoMudar({ slogan })}
        />
        <CampoLogo valor={valor.logo} aoMudar={(logo) => aoMudar({ logo })} />
        {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}
        <div className="pagina-acoes">
          <Botao desabilitado={ocupado} aoClicar={salvar}>
            {ocupado ? 'Salvando...' : 'Salvar'}
          </Botao>
        </div>
      </div>
      <PreviaIdentidade nome={valor.nome} slogan={valor.slogan} logo={valor.logo} />
    </div>
  );
}

// Prévia da barra lateral e do cartão de login com o rascunho (sem salvar).
function PreviaIdentidade({
  nome,
  slogan,
  logo,
}: {
  nome: string;
  slogan: string;
  logo: string | null;
}) {
  const src = logo ?? '/logo-simbolo.png';
  const nomeExibido = nome.trim() || 'Nome da plataforma';

  return (
    <div className="config-previas">
      <div className="config-previa">
        <span className="config-previa-rotulo">Barra lateral</span>
        <div className="config-previa-lateral">
          <div className="config-previa-lateral-topo">
            <img className="config-previa-logo-pequena" src={src} alt="" />
            <strong className="config-previa-nome-lateral">{nomeExibido}</strong>
          </div>
          <span className="config-previa-item config-previa-item-ativo">Início</span>
          <span className="config-previa-item">Contas</span>
          <span className="config-previa-item">Lançamentos</span>
        </div>
      </div>

      <div className="config-previa">
        <span className="config-previa-rotulo">Tela de entrada</span>
        <div className="config-previa-login">
          <img className="config-previa-logo-grande" src={src} alt="" />
          <strong className="config-previa-nome-login">{nomeExibido}</strong>
          {slogan.trim() && <span className="config-previa-slogan">{slogan.trim()}</span>}
          <span className="config-previa-botao">Entrar</span>
        </div>
      </div>
    </div>
  );
}
