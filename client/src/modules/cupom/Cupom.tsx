import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../../lib/api';
import { mensagemErro } from '../../lib/financas';
import { useDados } from '../../lib/useDados';
import { Aviso, Botao, Campo, Cartao, Carregando, Pagina, Selecao } from '../../ui';
import './cupom.css';

interface EstadoCupom {
  configurada: boolean;
  origem: 'sistema' | 'ambiente' | null;
  modelo: string;
}

const MODELOS = [
  { valor: 'claude-opus-5-5', rotulo: 'Opus 5.5 (mais preciso)' },
  { valor: 'claude-sonnet-5-5', rotulo: 'Sonnet 5.5' },
  { valor: 'claude-haiku-5-5', rotulo: 'Haiku 5.5 (mais barato)' },
];

const TEXTO_ORIGEM: Record<'sistema' | 'ambiente', string> = {
  sistema: 'Chave guardada no sistema.',
  ambiente: 'Chave vinda do servidor (ANTHROPIC_API_KEY).',
};

export function Cupom() {
  const { dados, carregando, erro, recarregar } = useDados<EstadoCupom>('/cupom/estado');
  const [chave, setChave] = useState('');
  const [modelo, setModelo] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [confirmandoApagar, setConfirmandoApagar] = useState(false);
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);

  const modeloEscolhido = modelo ?? dados?.modelo ?? 'claude-opus-5-5';

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErroSalvar(null);
    setSucesso(null);
    const limpa = chave.trim();
    const corpo: { chave?: string; modelo: string } = { modelo: modeloEscolhido };
    if (limpa !== '') corpo.chave = limpa;
    setOcupado(true);
    try {
      await api.put('/cupom/chave', corpo);
      setChave('');
      setModelo(null);
      setSucesso('Configuração salva.');
      recarregar();
    } catch (err) {
      setErroSalvar(mensagemErro(err));
    } finally {
      setOcupado(false);
    }
  }

  async function apagarChave() {
    setErroSalvar(null);
    setSucesso(null);
    setOcupado(true);
    try {
      await api.del('/cupom/chave');
      setConfirmandoApagar(false);
      setSucesso('Chave apagada do sistema.');
      recarregar();
    } catch (err) {
      setErroSalvar(mensagemErro(err));
    } finally {
      setOcupado(false);
    }
  }

  const nomeModelo = MODELOS.find((m) => m.valor === dados?.modelo)?.rotulo ?? dados?.modelo ?? '';

  return (
    <Pagina titulo="Leitura de cupom">
      {carregando && !dados && <Carregando />}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {dados && (
        <>
          <Cartao titulo="Situação">
            <p className="cupom-ajuda">
              {dados.configurada
                ? 'Chave configurada. A leitura de cupom está pronta.'
                : 'Nenhuma chave configurada. Cole a chave abaixo para ativar a leitura.'}
            </p>
            {dados.origem && <p className="cupom-ajuda">{TEXTO_ORIGEM[dados.origem]}</p>}
            <p className="cupom-ajuda">Modelo: {nomeModelo}</p>
          </Cartao>

          <Cartao titulo="Chave da API Anthropic">
            <form className="cupom-form" onSubmit={salvar}>
              {erroSalvar && <Aviso tipo="erro">{erroSalvar}</Aviso>}
              {sucesso && <Aviso tipo="sucesso">{sucesso}</Aviso>}
              <Campo rotulo="Chave da API (deixe em branco para manter)" valor={chave} aoMudar={setChave} tipo="password" />
              <Selecao rotulo="Modelo" valor={modeloEscolhido} aoMudar={setModelo} opcoes={MODELOS} />
              <Aviso tipo="info">
                A foto do cupom é enviada à Anthropic para leitura. O uso é cobrado na sua conta da API.
              </Aviso>
              <div className="pagina-acoes">
                <Botao tipo="submit" desabilitado={ocupado}>
                  Salvar
                </Botao>
                {dados.origem === 'sistema' &&
                  (confirmandoApagar ? (
                    <Botao variante="perigo" desabilitado={ocupado} aoClicar={apagarChave}>
                      Confirmar: apagar chave
                    </Botao>
                  ) : (
                    <Botao variante="secundario" desabilitado={ocupado} aoClicar={() => setConfirmandoApagar(true)}>
                      Apagar chave
                    </Botao>
                  ))}
              </div>
            </form>
          </Cartao>
        </>
      )}
    </Pagina>
  );
}
