import type { CSSProperties } from 'react';
import type { ContaDTO } from '../../lib/financas';
import { formatarDia, formatarReais } from '../../lib/financas';
import './cartao-visual.css';

export interface TemaCartao {
  chave: string; // 'nubank', 'xp', ...
  fundo: string; // valor de CSS para `background`
  texto: string; // cor do texto
  detalhe: string; // cor de destaque (linha, brilho)
}

// Regras de reconhecimento: `trechos` casam como substring; `palavras` só casam como palavra inteira.
interface RegraTema {
  tema: TemaCartao;
  trechos: string[];
  palavras: string[];
}

// Ordem importa: a primeira regra que casar vence.
const TEMAS: RegraTema[] = [
  {
    tema: {
      chave: 'nubank',
      fundo: 'linear-gradient(135deg, #8a05be 0%, #5b0a8c 100%)',
      texto: '#ffffff',
      detalhe: '#d9a8f5',
    },
    trechos: ['nubank', 'nu pagamentos'],
    palavras: ['nu'],
  },
  {
    tema: {
      chave: 'xp',
      fundo: 'linear-gradient(135deg, #1c1c1e 0%, #000000 100%)',
      texto: '#f5f5f5',
      detalhe: '#f5c518',
    },
    trechos: [],
    palavras: ['xp'],
  },
  {
    tema: {
      chave: 'inter',
      fundo: 'linear-gradient(135deg, #ff7a00 0%, #e35d00 100%)',
      texto: '#ffffff',
      detalhe: '#ffd9b3',
    },
    trechos: [],
    palavras: ['inter'],
  },
  {
    tema: {
      chave: 'itau',
      fundo: 'linear-gradient(135deg, #ec7000 0%, #003b7a 130%)',
      texto: '#ffffff',
      detalhe: '#ffd166',
    },
    trechos: ['itau'],
    palavras: [],
  },
  {
    tema: {
      chave: 'bradesco',
      fundo: 'linear-gradient(135deg, #cc092f 0%, #7d0520 100%)',
      texto: '#ffffff',
      detalhe: '#ffc2cf',
    },
    trechos: ['bradesco'],
    palavras: [],
  },
  {
    tema: {
      chave: 'santander',
      fundo: 'linear-gradient(135deg, #ec0000 0%, #990000 100%)',
      texto: '#ffffff',
      detalhe: '#ffc7c7',
    },
    trechos: ['santander'],
    palavras: [],
  },
  {
    tema: {
      chave: 'bb',
      fundo: 'linear-gradient(135deg, #003da5 0%, #002a73 100%)',
      texto: '#ffffff',
      detalhe: '#fae128',
    },
    trechos: ['banco do brasil', 'ourocard'],
    palavras: ['bb'],
  },
  {
    tema: {
      chave: 'caixa',
      fundo: 'linear-gradient(135deg, #005ca9 0%, #00407a 100%)',
      texto: '#ffffff',
      detalhe: '#f39200',
    },
    trechos: ['caixa'],
    palavras: [],
  },
  {
    tema: {
      chave: 'c6',
      fundo: 'linear-gradient(135deg, #2b2b2b 0%, #0d0d0d 100%)',
      texto: '#f2f2f2',
      detalhe: '#c9c9c9',
    },
    trechos: [],
    palavras: ['c6'],
  },
  {
    tema: {
      chave: 'btg',
      fundo: 'linear-gradient(135deg, #0b2a5b 0%, #05132b 100%)',
      texto: '#ffffff',
      detalhe: '#9ec1ff',
    },
    trechos: ['btg'],
    palavras: [],
  },
];

function casaPalavra(texto: string, palavra: string): boolean {
  return new RegExp('(^|[^a-z])' + palavra + '([^a-z]|$)').test(texto);
}

// Tema pela instituição ou pelo nome do cartão; null quando não reconhece.
export function temaDoBanco(conta: Pick<ContaDTO, 'nome' | 'instituicao'>): TemaCartao | null {
  const texto = (conta.nome + ' ' + (conta.instituicao ?? ''))
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  for (const regra of TEMAS) {
    const casou =
      regra.trechos.some((t) => texto.includes(t)) || regra.palavras.some((p) => casaPalavra(texto, p));
    if (casou) return regra.tema;
  }
  return null;
}

function temaPadrao(cor: string): TemaCartao {
  return {
    chave: 'padrao',
    fundo: `linear-gradient(135deg, ${cor}, color-mix(in srgb, ${cor} 55%, #000))`,
    texto: '#ffffff',
    detalhe: 'rgba(255,255,255,0.7)',
  };
}

function IconeAproximacao() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M8.5 9.5a4 4 0 0 1 0 5" stroke="currentColor" fill="none" strokeWidth={2} strokeLinecap="round" />
      <path d="M5.5 7a8 8 0 0 1 0 10" stroke="currentColor" fill="none" strokeWidth={2} strokeLinecap="round" />
      <path d="M2.5 4.5a12 12 0 0 1 0 15" stroke="currentColor" fill="none" strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}

export function CartaoVisual({
  conta,
  vencimento,
  percentualUsado,
  ativo,
  aoClicar,
}: {
  conta: ContaDTO;
  vencimento: string | null; // 'AAAA-MM-DD' da fatura em aberto, se houver
  percentualUsado: number | null; // 0 a 100+
  ativo: boolean;
  aoClicar: () => void;
}) {
  const tema = temaDoBanco(conta) ?? temaPadrao(conta.cor);
  const nomeBanco = conta.instituicao ?? conta.nome;
  const digitos = (conta.numero ?? '').replace(/\D/g, '');
  const finais = digitos.slice(-4) || '••••';
  const percentual = Math.min(100, Math.max(0, percentualUsado ?? 0));

  const estilo = {
    '--cv-fundo': tema.fundo,
    '--cv-texto': tema.texto,
    '--cv-detalhe': tema.detalhe,
  } as CSSProperties;

  return (
    <button
      type="button"
      className={ativo ? 'cv-cartao cv-cartao-ativo' : 'cv-cartao'}
      style={estilo}
      aria-pressed={ativo}
      onClick={aoClicar}
    >
      <span className="cv-topo">
        <span className="cv-banco">{nomeBanco}</span>
        <span className="cv-topo-direita">
          {conta.origem === 'OPEN_FINANCE' && <span className="cv-selo">Open Finance</span>}
          <span className="cv-aproximacao">
            <IconeAproximacao />
          </span>
        </span>
      </span>

      <span className="cv-chip" aria-hidden="true" />

      <span className="cv-numero-bloco">
        <span className="cv-numero">{'•••• •••• •••• ' + finais}</span>
        {conta.nome !== nomeBanco && <span className="cv-apelido">{conta.nome}</span>}
      </span>

      <span className="cv-base">
        <span className="cv-base-esquerda">
          <span className="cv-fatura">
            <span className="cv-rotulo">Fatura atual</span>
            <strong className="cv-valor">{formatarReais(conta.saldo)}</strong>
          </span>
          {vencimento !== null && (
            <span className="cv-fatura">
              <span className="cv-rotulo">Vence em</span>
              <strong className="cv-valor">{formatarDia(vencimento)}</strong>
            </span>
          )}
        </span>
        {conta.bandeira && <span className="cv-bandeira">{conta.bandeira}</span>}
      </span>

      {conta.limite !== null && (
        <span className="cv-limite">
          <span className="cv-limite-trilho" aria-hidden="true">
            <span className="cv-limite-barra" style={{ width: `${percentual}%` }} />
          </span>
          <span className="cv-limite-texto">Limite {formatarReais(conta.limite)}</span>
        </span>
      )}
    </button>
  );
}
