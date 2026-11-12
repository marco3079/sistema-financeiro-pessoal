import { useState } from 'react';
import type { ChangeEvent } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Aviso, Avatar, Botao, Campo, Modal } from '../../ui';
import { mensagemErro } from './tipos';
import './perfil.css';

const TAMANHO_FOTO = 256;
const LIMITE_DATA_URL = 190_000;
// Qualidades testadas em ordem, da melhor para a menor, até caber no limite.
const QUALIDADES = [0.85, 0.7, 0.55, 0.4];

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

// Recorte quadrado centralizado, reduzido para 256 x 256 px, em JPEG.
function recortarQuadrado(img: HTMLImageElement, qualidade: number): string {
  const lado = Math.min(img.naturalWidth, img.naturalHeight);
  const origemX = (img.naturalWidth - lado) / 2;
  const origemY = (img.naturalHeight - lado) / 2;
  const canvas = document.createElement('canvas');
  canvas.width = TAMANHO_FOTO;
  canvas.height = TAMANHO_FOTO;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Não foi possível processar a imagem.');
  }
  // Fundo branco: imagens com transparência continuam legíveis em JPEG.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, TAMANHO_FOTO, TAMANHO_FOTO);
  ctx.drawImage(img, origemX, origemY, lado, lado, 0, 0, TAMANHO_FOTO, TAMANHO_FOTO);
  return canvas.toDataURL('image/jpeg', qualidade);
}

async function reduzirArquivo(arquivo: File): Promise<string | null> {
  const img = await carregarImagem(arquivo);
  for (const qualidade of QUALIDADES) {
    const dataUrl = recortarQuadrado(img, qualidade);
    if (dataUrl.length <= LIMITE_DATA_URL) return dataUrl;
  }
  return null;
}

export function PerfilFoto({
  aberto,
  aoFechar,
  nome,
  fotoAtual,
  aoSalvo,
}: {
  aberto: boolean;
  aoFechar: () => void;
  nome: string;
  fotoAtual: string | null;
  aoSalvo: () => void;
}) {
  const { atualizarFoto } = useAuth();
  // Estado do rascunho: começa com a foto atual sempre que o popup abre (o pai remonta o componente).
  const [foto, setFoto] = useState<string | null>(fotoAtual);
  const [endereco, setEndereco] = useState(
    fotoAtual && !fotoAtual.startsWith('data:') ? fotoAtual : '',
  );
  const [processando, setProcessando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
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
      const dataUrl = await reduzirArquivo(arquivo);
      if (dataUrl === null) {
        setErro('Imagem grande demais.');
      } else {
        setEndereco('');
        setFoto(dataUrl);
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
      setFoto(null);
    } else if (limpo.startsWith('http://') || limpo.startsWith('https://')) {
      setFoto(limpo);
    }
  }

  function remover() {
    setEndereco('');
    setErro(null);
    setFoto(null);
  }

  async function salvar() {
    setErro(null);
    setOcupado(true);
    try {
      const resposta = await api.put<{ foto: string | null }>('/perfil/foto', { foto });
      atualizarFoto(resposta.foto);
      aoSalvo();
      aoFechar();
    } catch (err) {
      setErro(mensagemErro(err));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Modal aberto={aberto} titulo="Trocar foto" aoFechar={aoFechar}>
      <div className="perfil-foto-modal">
        <Avatar nome={nome} foto={foto} tamanho={120} className="perfil-foto-previa" />

        <label
          className={`botao botao-secundario perfil-arquivo-botao${
            processando ? ' perfil-arquivo-desabilitado' : ''
          }`}
        >
          {processando ? 'Preparando imagem...' : 'Enviar imagem'}
          <input
            className="perfil-arquivo-entrada"
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

        <div className="pagina-acoes perfil-foto-acoes">
          <Botao variante="texto" desabilitado={!foto || ocupado} aoClicar={remover}>
            Remover foto
          </Botao>
          <Botao desabilitado={ocupado || processando || enderecoInvalido} aoClicar={salvar}>
            {ocupado ? 'Salvando...' : 'Salvar'}
          </Botao>
        </div>
      </div>
    </Modal>
  );
}
