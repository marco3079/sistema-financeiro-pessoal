import { useState } from 'react';
import type { FormEvent } from 'react';
import QRCode from 'qrcode';
import { api } from '../../lib/api';
import { mensagemErro } from '../../lib/financas';
import { useDados } from '../../lib/useDados';
import { Aviso, Botao, Campo, Cartao, Carregando, Modal, Pagina, Selo } from '../../ui';
import './seguranca.css';

interface EstadoDoisPassos {
  ativo: boolean;
  codigosDeRecuperacaoRestantes: number;
}

interface RespostaIniciar {
  segredo: string;
  otpauth: string;
}

interface RespostaAtivar {
  codigosDeRecuperacao: string[];
}

type EtapaAtivar = 'preparando' | 'confirmar' | 'codigos';

interface EstadoAtivar {
  etapa: EtapaAtivar;
  segredo: string;
  qr: string;
  codigos: string[];
}

// ---------- Ativar: QR code, primeiro código e códigos de recuperação ----------

function Ativar({
  estado,
  erro,
  ocupado,
  aoConfirmar,
  aoCopiar,
  copiado,
  aoConcluir,
}: {
  estado: EstadoAtivar;
  erro: string | null;
  ocupado: boolean;
  aoConfirmar: (codigo: string) => void;
  aoCopiar: () => void;
  copiado: boolean;
  aoConcluir: () => void;
}) {
  const [codigo, setCodigo] = useState('');

  if (estado.etapa === 'preparando') {
    return (
      <div>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Carregando />
      </div>
    );
  }

  if (estado.etapa === 'codigos') {
    return (
      <div>
        <Aviso tipo="info">Guarde estes códigos: eles não aparecem de novo.</Aviso>
        <p className="seguranca-texto">Cada código serve uma vez, se você perder o aparelho com o aplicativo.</p>
        <ul className="seguranca-codigos">
          {estado.codigos.map((codigoRecuperacao) => (
            <li key={codigoRecuperacao}>
              <code>{codigoRecuperacao}</code>
            </li>
          ))}
        </ul>
        <div className="pagina-acoes">
          <Botao variante="secundario" aoClicar={aoCopiar}>
            {copiado ? 'Copiado' : 'Copiar'}
          </Botao>
          <Botao aoClicar={aoConcluir}>Concluir</Botao>
        </div>
      </div>
    );
  }

  function enviar(evento: FormEvent) {
    evento.preventDefault();
    aoConfirmar(codigo);
  }

  return (
    <form onSubmit={enviar}>
      <p className="seguranca-texto">
        Escaneie o QR code com o aplicativo autenticador, ou digite o segredo abaixo.
      </p>
      <img className="seguranca-qr" src={estado.qr} alt="QR code para o aplicativo autenticador" width={220} height={220} />
      <p className="seguranca-segredo">
        Segredo: <code>{estado.segredo}</code>
      </p>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <Campo rotulo="Código de 6 dígitos do aplicativo" valor={codigo} aoMudar={setCodigo} obrigatorio />
      <div className="pagina-acoes">
        <Botao tipo="submit" desabilitado={ocupado}>
          Ativar
        </Botao>
      </div>
    </form>
  );
}

// ---------- Desativar: senha e um código ----------

function Desativar({ aoConcluido }: { aoConcluido: () => void }) {
  const [senha, setSenha] = useState('');
  const [codigo, setCodigo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    setErro(null);
    setOcupado(true);
    try {
      await api.post('/seguranca/2fa/desativar', { senha, codigo });
      aoConcluido();
    } catch (err) {
      setErro(mensagemErro(err));
      setOcupado(false);
    }
  }

  return (
    <form onSubmit={enviar}>
      <p className="seguranca-texto">Para desativar, informe sua senha e um código do aplicativo ou de recuperação.</p>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <Campo rotulo="Senha" tipo="password" valor={senha} aoMudar={setSenha} obrigatorio />
      <Campo rotulo="Código do aplicativo ou de recuperação" valor={codigo} aoMudar={setCodigo} obrigatorio />
      <div className="pagina-acoes">
        <Botao tipo="submit" variante="perigo" desabilitado={ocupado}>
          Desativar
        </Botao>
      </div>
    </form>
  );
}

// ---------- Tela ----------

export function Seguranca() {
  const { dados, carregando, erro, recarregar } = useDados<EstadoDoisPassos>('/seguranca/2fa');
  const [ativar, setAtivar] = useState<EstadoAtivar | null>(null);
  const [erroAtivar, setErroAtivar] = useState<string | null>(null);
  const [ocupadoAtivar, setOcupadoAtivar] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [desativando, setDesativando] = useState(false);

  // O segredo é gerado no servidor quando a pessoa clica em Ativar; o QR code é montado aqui.
  async function abrirAtivar() {
    setErroAtivar(null);
    setCopiado(false);
    setAtivar({ etapa: 'preparando', segredo: '', qr: '', codigos: [] });
    try {
      const resposta = await api.post<RespostaIniciar>('/seguranca/2fa/iniciar');
      const qr = await QRCode.toDataURL(resposta.otpauth, { margin: 1, width: 220 });
      setAtivar({ etapa: 'confirmar', segredo: resposta.segredo, qr, codigos: [] });
    } catch (err) {
      setErroAtivar(mensagemErro(err));
      setAtivar(null);
    }
  }

  function fecharAtivar() {
    if (ocupadoAtivar) return;
    setAtivar(null);
  }

  async function confirmarAtivar(codigo: string) {
    setErroAtivar(null);
    setOcupadoAtivar(true);
    try {
      const resposta = await api.post<RespostaAtivar>('/seguranca/2fa/ativar', { codigo });
      setAtivar((atual) =>
        atual ? { ...atual, etapa: 'codigos', codigos: resposta.codigosDeRecuperacao } : atual,
      );
    } catch (err) {
      setErroAtivar(mensagemErro(err));
    } finally {
      setOcupadoAtivar(false);
    }
  }

  async function copiarCodigos() {
    if (!ativar) return;
    try {
      await navigator.clipboard.writeText(ativar.codigos.join('\n'));
      setCopiado(true);
    } catch {
      setCopiado(false);
    }
  }

  function concluirAtivar() {
    setAtivar(null);
    recarregar();
  }

  function concluirDesativar() {
    setDesativando(false);
    recarregar();
  }

  return (
    <Pagina titulo="Segurança">
      <Cartao titulo="Verificação em duas etapas">
        <p className="seguranca-texto">
          Além da senha, o login pede um código de 6 dígitos do aplicativo autenticador.
        </p>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {erroAtivar && !ativar && <Aviso tipo="erro">{erroAtivar}</Aviso>}
        {carregando && <Carregando />}

        {dados && dados.ativo && (
          <div>
            <Selo cor="verde">Ativada</Selo>
            <p className="seguranca-texto">Códigos de recuperação restantes: {dados.codigosDeRecuperacaoRestantes}</p>
            <div className="seguranca-linha">
              <Botao variante="perigo" aoClicar={() => setDesativando(true)}>
                Desativar
              </Botao>
            </div>
          </div>
        )}

        {dados && !dados.ativo && (
          <div>
            <Selo>Desativada</Selo>
            <div className="seguranca-linha">
              <Botao aoClicar={abrirAtivar}>Ativar</Botao>
            </div>
          </div>
        )}
      </Cartao>

      <Modal
        aberto={ativar !== null}
        titulo={ativar?.etapa === 'codigos' ? 'Códigos de recuperação' : 'Ativar verificação em duas etapas'}
        aoFechar={ativar?.etapa === 'codigos' ? concluirAtivar : fecharAtivar}
      >
        {ativar && (
          <Ativar
            estado={ativar}
            erro={erroAtivar}
            ocupado={ocupadoAtivar}
            aoConfirmar={confirmarAtivar}
            aoCopiar={copiarCodigos}
            copiado={copiado}
            aoConcluir={concluirAtivar}
          />
        )}
      </Modal>

      <Modal aberto={desativando} titulo="Desativar verificação em duas etapas" aoFechar={() => setDesativando(false)}>
        {desativando && <Desativar aoConcluido={concluirDesativar} />}
      </Modal>
    </Pagina>
  );
}
