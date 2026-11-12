import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from './api';

// Identidade da plataforma (nome, slogan, logo e cores), vinda de GET /plataforma.
// Guardada em localStorage para a primeira pintura já sair com a identidade certa.

export interface Plataforma {
  nome: string;
  slogan: string;
  logo: string | null;
  corPrimaria: string;
  corSecundaria: string;
  emailAtivo: boolean;
  recuperacaoSenha: boolean;
}

export const PLATAFORMA_PADRAO: Plataforma = {
  nome: 'Finanças Pessoais',
  slogan: 'Contas, faturas e investimentos em um só lugar.',
  logo: null,
  corPrimaria: '#2563eb',
  corSecundaria: '#1d4ed8',
  emailAtivo: false,
  recuperacaoSenha: false,
};

const CHAVE_ARMAZENAMENTO = 'financas.plataforma';
const REGEX_COR = /^#[0-9a-fA-F]{6}$/;

// Variáveis CSS que a identidade define. Com as cores padrão, nenhuma é aplicada (valem as do tema).
const VARIAVEIS_COR = [
  '--cor-primaria',
  '--cor-primaria-escura',
  '--cor-primaria-suave',
  '--cor-azul-suave',
  '--gradiente-primario',
  '--sombra-primaria',
];

function normalizar(dados: Partial<Plataforma>): Plataforma {
  const cor = (valor: unknown, padrao: string): string =>
    typeof valor === 'string' && REGEX_COR.test(valor) ? valor.toLowerCase() : padrao;

  return {
    nome: typeof dados.nome === 'string' && dados.nome ? dados.nome : PLATAFORMA_PADRAO.nome,
    slogan: typeof dados.slogan === 'string' ? dados.slogan : PLATAFORMA_PADRAO.slogan,
    logo: typeof dados.logo === 'string' && dados.logo ? dados.logo : null,
    corPrimaria: cor(dados.corPrimaria, PLATAFORMA_PADRAO.corPrimaria),
    corSecundaria: cor(dados.corSecundaria, PLATAFORMA_PADRAO.corSecundaria),
    emailAtivo: dados.emailAtivo === true,
    recuperacaoSenha: dados.recuperacaoSenha === true,
  };
}

function lerGuardada(): Plataforma | null {
  try {
    const bruto = window.localStorage.getItem(CHAVE_ARMAZENAMENTO);
    if (!bruto) return null;
    return normalizar(JSON.parse(bruto) as Partial<Plataforma>);
  } catch {
    return null;
  }
}

function gravarNoNavegador(plataforma: Plataforma): void {
  try {
    window.localStorage.setItem(CHAVE_ARMAZENAMENTO, JSON.stringify(plataforma));
  } catch {
    // Sem armazenamento a identidade só vale até recarregar a página.
  }
}

function aplicarCores(plataforma: Plataforma): void {
  const estilo = document.documentElement.style;
  const padrao =
    plataforma.corPrimaria === PLATAFORMA_PADRAO.corPrimaria &&
    plataforma.corSecundaria === PLATAFORMA_PADRAO.corSecundaria;

  if (padrao) {
    VARIAVEIS_COR.forEach((variavel) => estilo.removeProperty(variavel));
    return;
  }

  const primaria = plataforma.corPrimaria;
  const secundaria = plataforma.corSecundaria;
  estilo.setProperty('--cor-primaria', primaria);
  estilo.setProperty('--cor-primaria-escura', `color-mix(in srgb, ${primaria} 82%, black)`);
  estilo.setProperty('--cor-primaria-suave', `color-mix(in srgb, ${primaria} 14%, var(--cor-superficie))`);
  estilo.setProperty('--cor-azul-suave', `color-mix(in srgb, ${primaria} 14%, var(--cor-superficie))`);
  estilo.setProperty('--gradiente-primario', `linear-gradient(135deg, ${primaria}, ${secundaria})`);
  estilo.setProperty('--sombra-primaria', `0 6px 16px color-mix(in srgb, ${primaria} 30%, transparent)`);
}

// Com logo própria, ela vira o ícone da aba. Sem logo própria, valem os ícones padrão do index.html
// (ICO, PNG e SVG), que funcionam também nos navegadores que não aceitam ícone em SVG.
function aplicarTituloEIcones(plataforma: Plataforma): void {
  document.title = plataforma.nome;
  document
    .querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="apple-touch-icon"]')
    .forEach((link) => {
      // Guarda o ícone padrão na primeira vez, para poder voltar a ele.
      if (link.dataset.padrao === undefined) {
        link.dataset.padrao = link.getAttribute('href') ?? '';
        link.dataset.tipoPadrao = link.getAttribute('type') ?? '';
      }
      if (plataforma.logo) {
        link.removeAttribute('type');
        link.href = plataforma.logo;
      } else {
        if (link.dataset.tipoPadrao) link.setAttribute('type', link.dataset.tipoPadrao);
        link.href = link.dataset.padrao;
      }
    });
}

export interface ValorPlataforma {
  plataforma: Plataforma;
  logoSrc: string;
  recarregar: () => Promise<void>;
  aplicarPrevia: (parcial: Partial<Plataforma> | null) => void;
}

const PlataformaContexto = createContext<ValorPlataforma>({
  plataforma: PLATAFORMA_PADRAO,
  logoSrc: '/logo-simbolo.svg',
  recarregar: async () => undefined,
  aplicarPrevia: () => undefined,
});

export function PlataformaProvider({ children }: { children: ReactNode }) {
  const [gravada, setGravada] = useState<Plataforma>(() => lerGuardada() ?? PLATAFORMA_PADRAO);
  const [previa, setPrevia] = useState<Partial<Plataforma> | null>(null);

  const recarregar = useCallback(async () => {
    try {
      const dados = await api.get<Partial<Plataforma>>('/plataforma');
      const nova = normalizar(dados);
      setGravada(nova);
      gravarNoNavegador(nova);
    } catch {
      // Sem resposta do servidor, segue com o que já está guardado.
    }
  }, []);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  const plataforma = useMemo<Plataforma>(() => {
    if (!previa) return gravada;
    const definidos = Object.fromEntries(
      Object.entries(previa).filter(([, valor]) => valor !== undefined),
    ) as Partial<Plataforma>;
    return normalizar({ ...gravada, ...definidos });
  }, [gravada, previa]);

  const logoSrc = plataforma.logo ?? '/logo-simbolo.svg';

  useEffect(() => {
    aplicarCores(plataforma);
    aplicarTituloEIcones(plataforma);
  }, [plataforma, logoSrc]);

  const aplicarPrevia = useCallback((parcial: Partial<Plataforma> | null) => {
    setPrevia(parcial);
  }, []);

  const valor = useMemo<ValorPlataforma>(
    () => ({ plataforma, logoSrc, recarregar, aplicarPrevia }),
    [plataforma, logoSrc, recarregar, aplicarPrevia],
  );

  return <PlataformaContexto.Provider value={valor}>{children}</PlataformaContexto.Provider>;
}

export function usePlataforma(): ValorPlataforma {
  return useContext(PlataformaContexto);
}
