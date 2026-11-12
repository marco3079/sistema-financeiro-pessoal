import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { usePlataforma } from '../../lib/plataforma';
import { Abas, Aviso, Carregando, Pagina } from '../../ui';
import { mensagemErro } from '../cadastros/tipos';
import { Cores } from './Cores';
import { Email } from './Email';
import { Identidade } from './Identidade';
import { identidadeDe } from './tipos';
import type { ConfiguracoesDTO, IdentidadeDados } from './tipos';

const ABAS = [
  { id: 'identidade', rotulo: 'Identidade' },
  { id: 'cores', rotulo: 'Cores' },
  { id: 'email', rotulo: 'E-mail' },
];

export function Configuracoes() {
  const { recarregar, aplicarPrevia } = usePlataforma();
  const [config, setConfig] = useState<ConfiguracoesDTO | null>(null);
  const [rascunho, setRascunho] = useState<IdentidadeDados | null>(null);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [aba, setAba] = useState('identidade');

  useEffect(() => {
    let ativo = true;
    api
      .get<ConfiguracoesDTO>('/configuracoes')
      .then((dados) => {
        if (!ativo) return;
        setConfig(dados);
        setRascunho(identidadeDe(dados));
      })
      .catch((e) => {
        if (ativo) setErroCarga(mensagemErro(e));
      });
    return () => {
      ativo = false;
    };
  }, []);

  // Prévia ao vivo das cores só na aba Cores. Fora dela (e ao sair da tela) volta ao gravado.
  // A função vem por ref para o efeito não rodar a cada render.
  const aplicarRef = useRef(aplicarPrevia);
  aplicarRef.current = aplicarPrevia;
  const corPrimaria = rascunho?.corPrimaria;
  const corSecundaria = rascunho?.corSecundaria;
  useEffect(() => {
    if (aba === 'cores' && corPrimaria && corSecundaria) {
      aplicarRef.current({ corPrimaria, corSecundaria });
    } else {
      aplicarRef.current(null);
    }
  }, [aba, corPrimaria, corSecundaria]);

  useEffect(() => {
    return () => aplicarRef.current(null);
  }, []);

  function mudarIdentidade(parcial: Partial<IdentidadeDados>) {
    setRascunho((atual) => (atual ? { ...atual, ...parcial } : atual));
  }

  // Identidade e Cores salvam os cinco campos juntos.
  async function salvarIdentidade(dados: IdentidadeDados) {
    const novo = await api.put<ConfiguracoesDTO>('/configuracoes/identidade', {
      nome: dados.nome.trim(),
      slogan: dados.slogan.trim(),
      logo: dados.logo,
      corPrimaria: dados.corPrimaria,
      corSecundaria: dados.corSecundaria,
    });
    setConfig(novo);
    setRascunho(identidadeDe(novo));
    await recarregar();
  }

  async function aoSalvarEmail(novo: ConfiguracoesDTO) {
    setConfig(novo);
    await recarregar();
  }

  const carregado = config !== null && rascunho !== null;

  return (
    <Pagina titulo="Configurações">
      {erroCarga && <Aviso tipo="erro">{erroCarga}</Aviso>}
      {!carregado && !erroCarga && <Carregando />}
      {carregado && config && rascunho && (
        <>
          <Abas abas={ABAS} ativa={aba} aoMudar={setAba} />
          {/* As abas ficam montadas para não perder o que foi digitado ao trocar de aba. */}
          <div hidden={aba !== 'identidade'}>
            <Identidade valor={rascunho} aoMudar={mudarIdentidade} aoSalvar={salvarIdentidade} />
          </div>
          <div hidden={aba !== 'cores'}>
            <Cores valor={rascunho} aoMudar={mudarIdentidade} aoSalvar={salvarIdentidade} />
          </div>
          <div hidden={aba !== 'email'}>
            <Email config={config} aoSalvo={aoSalvarEmail} />
          </div>
        </>
      )}
    </Pagina>
  );
}
