import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { api } from '../lib/api';
import { Aviso, Botao, Campo, Modal } from '../ui';
import './botao-celular.css';

interface RedeDTO {
  porta: number;
  enderecos: { rotulo: string; url: string }[];
}

const CHAVE_ENDERECO = 'financas.enderecoRede';
const HOSTS_LOCAIS = ['localhost', '127.0.0.1', '[::1]'];

function lerSalvo(): string | null {
  try {
    const valor = window.localStorage.getItem(CHAVE_ENDERECO);
    return valor && valor.trim() ? valor : null;
  } catch {
    return null;
  }
}

// Ordem: endereço salvo pela pessoa, origem atual (se não for localhost), primeiro da API, ou nenhum.
export function escolherEndereco(
  salvo: string | null,
  origem: string,
  hostname: string,
  daApi: string[],
): string | null {
  if (salvo && salvo.trim()) return salvo;
  if (!HOSTS_LOCAIS.includes(hostname)) return origem;
  return daApi[0] ?? null;
}

// Aceita o que a pessoa digitar e devolve "http(s)://host[:porta]", ou null se for inválido.
export function normalizar(texto: string, porta: number): string | null {
  let s = texto.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;

  const casa = /^(https?):\/\/([^/?#]*)/i.exec(s);
  if (!casa) return null;
  const protocolo = casa[1].toLowerCase();

  const partes = /^([^:]*)(?::(\d+))?$/.exec(casa[2]);
  if (!partes) return null;
  const host = partes[1];
  const portaInformada = partes[2];

  if (!/^[A-Za-z0-9.-]+$/.test(host)) return null;
  if (host.toLowerCase() === 'localhost' || host === '127.0.0.1') return null;

  const sufixo = portaInformada ? `:${portaInformada}` : porta !== 80 ? `:${porta}` : '';
  return `${protocolo}://${host}${sufixo}`;
}

export function BotaoCelular() {
  const [aberto, setAberto] = useState(false);
  const [rede, setRede] = useState<RedeDTO | null>(null);
  const [salvo, setSalvo] = useState<string | null>(lerSalvo);
  const [escolhidoLista, setEscolhidoLista] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [erroQr, setErroQr] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [digitado, setDigitado] = useState('');
  const [erroDigitado, setErroDigitado] = useState(false);

  const podeCopiar = typeof navigator !== 'undefined' && Boolean(navigator.clipboard);
  const porta = rede?.porta ?? (Number(window.location.port) || 80);
  const urlsApi = rede?.enderecos.map((e) => e.url) ?? [];
  const endereco =
    escolhidoLista ??
    escolherEndereco(salvo, window.location.origin, window.location.hostname, urlsApi);
  const semEndereco = endereco === null && rede !== null;

  // Busca os endereços da rede só quando o popup abre.
  useEffect(() => {
    if (!aberto) return;
    let cancelado = false;
    api
      .get<RedeDTO>('/rede')
      .then((r) => {
        if (!cancelado) setRede(r);
      })
      .catch(() => {
        if (!cancelado) setRede({ porta: Number(window.location.port) || 80, enderecos: [] });
      });
    return () => {
      cancelado = true;
    };
  }, [aberto]);

  // Gera o QR code do endereço atual.
  useEffect(() => {
    if (!endereco) {
      setQr(null);
      setErroQr(false);
      return;
    }
    let cancelado = false;
    QRCode.toDataURL(endereco, { width: 440, margin: 1, errorCorrectionLevel: 'M' })
      .then((url) => {
        if (!cancelado) {
          setQr(url);
          setErroQr(false);
        }
      })
      .catch(() => {
        if (!cancelado) {
          setQr(null);
          setErroQr(true);
        }
      });
    return () => {
      cancelado = true;
    };
  }, [endereco]);

  // "Copiado" volta a "Copiar endereço" depois de 2 s.
  useEffect(() => {
    if (!copiado) return;
    const t = window.setTimeout(() => setCopiado(false), 2000);
    return () => window.clearTimeout(t);
  }, [copiado]);

  async function copiar() {
    if (!endereco || !podeCopiar) return;
    try {
      await navigator.clipboard.writeText(endereco);
      setCopiado(true);
    } catch {
      // Sem permissão de área de transferência: nada a mostrar.
    }
  }

  function usarDigitado() {
    const url = normalizar(digitado, porta);
    if (!url) {
      setErroDigitado(true);
      return;
    }
    try {
      window.localStorage.setItem(CHAVE_ENDERECO, url);
    } catch {
      // Sem armazenamento: o endereço vale só nesta tela.
    }
    setSalvo(url);
    setEscolhidoLista(null);
    setErroDigitado(false);
  }

  function voltarAutomatico() {
    try {
      window.localStorage.removeItem(CHAVE_ENDERECO);
    } catch {
      // Sem armazenamento: nada a apagar.
    }
    setSalvo(null);
    setEscolhidoLista(null);
    setErroDigitado(false);
  }

  return (
    <>
      <button
        type="button"
        className="casca-botao-redondo"
        aria-label="Abrir no celular"
        title="Abrir no celular"
        onClick={() => setAberto(true)}
      >
        <svg
          width={22}
          height={22}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <rect x="7" y="2" width="10" height="20" rx="2" />
          <path d="M11 18h2" />
        </svg>
      </button>

      <Modal aberto={aberto} titulo="Abrir no celular" aoFechar={() => setAberto(false)}>
        <div className="botao-celular">
          <p className="botao-celular-texto">
            Aponte a câmera do celular para o código. O celular precisa estar na mesma rede Wi-Fi deste
            computador.
          </p>

          {endereco && (
            <>
              {qr ? (
                <div className="botao-celular-qr">
                  <img src={qr} width={220} height={220} alt={'QR code para ' + endereco} />
                </div>
              ) : (
                erroQr && <Aviso tipo="erro">Não consegui gerar o código.</Aviso>
              )}

              <p className="botao-celular-endereco">{endereco}</p>

              {podeCopiar && (
                <div className="botao-celular-acoes">
                  <Botao variante="texto" aoClicar={copiar}>
                    {copiado ? 'Copiado' : 'Copiar endereço'}
                  </Botao>
                </div>
              )}
            </>
          )}

          {semEndereco && (
            <Aviso tipo="info">
              Não consegui descobrir o endereço deste computador na rede. Digite abaixo o IP dele.
            </Aviso>
          )}

          {rede && rede.enderecos.length > 1 && (
            <div className="botao-celular-acoes">
              {rede.enderecos.map((e) => (
                <Botao key={e.url} variante="texto" aoClicar={() => setEscolhidoLista(e.url)}>
                  {e.rotulo}
                </Botao>
              ))}
            </div>
          )}

          <details className="botao-celular-detalhes" open={semEndereco}>
            <summary>Não abriu? Usar outro endereço</summary>
            <div className="botao-celular">
              <p className="botao-celular-texto">
                Digite o IP deste computador na rede (no Windows: Configurações &gt; Rede e Internet &gt;
                propriedades do Wi-Fi &gt; Endereço IPv4) ou um nome como financas-pessoais.local.
              </p>
              <Campo
                rotulo="Endereço deste computador"
                valor={digitado}
                aoMudar={(v) => {
                  setDigitado(v);
                  setErroDigitado(false);
                }}
              />
              {erroDigitado && <Aviso tipo="erro">Endereço inválido. Exemplo: 192.168.0.15</Aviso>}
              <div className="botao-celular-acoes">
                <Botao variante="secundario" aoClicar={usarDigitado}>
                  Usar este endereço
                </Botao>
                {salvo && (
                  <Botao variante="texto" aoClicar={voltarAutomatico}>
                    Voltar ao automático
                  </Botao>
                )}
              </div>
            </div>
          </details>

          <p className="botao-celular-rodape">
            Se o celular não abrir, confira se o firewall do computador permite a porta {porta}.
          </p>
        </div>
      </Modal>
    </>
  );
}
