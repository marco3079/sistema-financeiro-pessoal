import { useState } from 'react';
import type { ChangeEvent } from 'react';
import { Aviso, Botao, Campo } from '../../ui';
import { mensagemErro } from '../cadastros/tipos';

// Limite do validarImagem do servidor é 200.000 caracteres; deixa-se uma folga.
const LIMITE_DATA_URL = 190_000;

// Tentativas de reduzir a logo, da melhor para a menor. PNG mantém a transparência;
// onde o navegador não codifica WebP, o toDataURL devolve PNG, o que também é aceito.
const TENTATIVAS: { lado: number; tipo: 'image/webp' | 'image/png'; qualidade?: number }[] = [
  { lado: 256, tipo: 'image/webp', qualidade: 0.9 },
  { lado: 256, tipo: 'image/png' },
  { lado: 256, tipo: 'image/webp', qualidade: 0.7 },
  { lado: 192, tipo: 'image/png' },
  { lado: 128, tipo: 'image/png' },
];

function carregarImagem(arquivo: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Não foi possível ler a imagem.'));
    };
    img.src = url;
  });
}

// Reduz para caber no lado máximo, sem ampliar.
function desenhar(
  img: HTMLImageElement,
  lado: number,
  tipo: 'image/webp' | 'image/png',
  qualidade?: number,
): string {
  const escala = Math.min(1, lado / Math.max(img.naturalWidth, img.naturalHeight));
  const largura = Math.max(1, Math.round(img.naturalWidth * escala));
  const altura = Math.max(1, Math.round(img.naturalHeight * escala));
  const canvas = document.createElement('canvas');
  canvas.width = largura;
  canvas.height = altura;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Não foi possível processar a imagem.');
  }
  ctx.drawImage(img, 0, 0, largura, altura);
  return canvas.toDataURL(tipo, qualidade);
}

async function reduzirLogo(arquivo: File): Promise<string | null> {
  const img = await carregarImagem(arquivo);
  for (const t of TENTATIVAS) {
    const dataUrl = desenhar(img, t.lado, t.tipo, t.qualidade);
    if (dataUrl.length <= LIMITE_DATA_URL) return dataUrl;
  }
  return null;
}

export function CampoLogo({
  valor,
  aoMudar,
}: {
  valor: string | null;
  aoMudar: (valor: string | null) => void;
}) {
  const [endereco, setEndereco] = useState(
    valor && !valor.startsWith('data:') ? valor : '',
  );
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const enderecoInvalido =
    endereco.trim() !== '' &&
    !endereco.trim().startsWith('http://') &&
    !endereco.trim().startsWith('https://');

  async function aoEscolherArquivo(e: ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    e.target.value = '';
    if (!arquivo) return;
    setErro(null);
    if (!arquivo.type.startsWith('image/')) {
      setErro('Escolha um arquivo de imagem (PNG, JPEG ou WebP).');
      return;
    }
    setProcessando(true);
    try {
      const dataUrl = await reduzirLogo(arquivo);
      if (dataUrl === null) {
        setErro('Imagem grande demais, mesmo reduzida. Tente uma imagem mais simples.');
      } else {
        setEndereco('');
        aoMudar(dataUrl);
      }
    } catch (err) {
      setErro(mensagemErro(err));
    } finally {
      setProcessando(false);
    }
  }

  function aoMudarEndereco(texto: string) {
    setEndereco(texto);
    setErro(null);
    const limpo = texto.trim();
    if (limpo === '') {
      aoMudar(null);
    } else if (limpo.startsWith('http://') || limpo.startsWith('https://')) {
      aoMudar(limpo);
    }
  }

  function voltarPadrao() {
    setEndereco('');
    setErro(null);
    aoMudar(null);
  }

  return (
    <div className="config-logo-campo">
      <span className="campo-rotulo">Logo</span>
      <div className="config-logo">
        <div className="config-logo-atual">
          <img src={valor ?? '/logo-simbolo.png'} alt="Logo atual da plataforma" />
        </div>
        <div className="config-logo-acoes">
          <label
            className={`botao botao-secundario config-arquivo-botao${
              processando ? ' config-arquivo-desabilitado' : ''
            }`}
          >
            {processando ? 'Preparando imagem...' : 'Enviar do computador'}
            <input
              className="config-arquivo-entrada"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={processando}
              onChange={aoEscolherArquivo}
            />
          </label>
          <Campo rotulo="Ou cole um endereço" valor={endereco} aoMudar={aoMudarEndereco} />
          {enderecoInvalido && (
            <Aviso tipo="info">O endereço deve começar com http:// ou https://.</Aviso>
          )}
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          <div>
            <Botao variante="texto" desabilitado={!valor} aoClicar={voltarPadrao}>
              Voltar à logo padrão
            </Botao>
          </div>
        </div>
      </div>
    </div>
  );
}
