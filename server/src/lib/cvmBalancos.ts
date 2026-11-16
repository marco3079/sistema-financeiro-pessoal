// Balanços anuais das companhias abertas na CVM (DFP, dados abertos, sem cadastro):
// https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/DFP/DADOS/dfp_cia_aberta_<ano>.zip
// Cada ZIP traz o balanço patrimonial (BPA/BPP), o resultado (DRE) e o fluxo de caixa (DFC) de todas as
// companhias, consolidado (con) e individual (ind), com o exercício do ano (ÚLTIMO) e o anterior (PENÚLTIMO).
// Aqui fica só o necessário para os indicadores, por companhia (código CVM). Bancos e seguradoras usam outro plano
// de contas: as contas são achadas pelo nome, e o que não existir (EBIT, dívida...) fica sem valor.
// Cada ano fica em memória por 24 horas. Falha de rede: devolve null, sem erro.

import { arquivosDoZip, linhasCsv } from './cvmFii';

const BASE = 'https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/DFP/DADOS/dfp_cia_aberta_';
const VALIDADE_MS = 24 * 60 * 60 * 1000;
const TEMPO_LIMITE_MS = 120000;

interface Conta {
  codigo: string;
  nome: string;
  valor: number; // em reais
}

interface Exercicio {
  fim: string; // 'AAAA-MM-DD'
  contas: Conta[]; // DRE, BPA, BPP (até o 3º nível) e as de depreciação do fluxo de caixa
}

interface Companhia {
  nome: string;
  consolidado: boolean;
  ultimo: Exercicio | null;
  penultimo: Exercicio | null;
}

type Ano = Map<number, Companhia>; // código CVM -> dados

const cache = new Map<number, { em: number; ano: Promise<Ano | null> }>();

function semAcento(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Lê um CSV do ZIP e guarda as contas que interessam em `destino` (por código CVM).
function lerDemonstracao(csv: Buffer, destino: Ano, consolidado: boolean, filtro: (codigo: string, nome: string) => boolean): void {
  const [cab, ...linhas] = linhasCsv(csv.toString('latin1'));
  const idx = (n: string) => cab.indexOf(n);
  const iCvm = idx('CD_CVM');
  const iNome = idx('DENOM_CIA');
  const iOrdem = idx('ORDEM_EXERC');
  const iFim = idx('DT_FIM_EXERC');
  const iCodigo = idx('CD_CONTA');
  const iDescricao = idx('DS_CONTA');
  const iValor = idx('VL_CONTA');
  const iEscala = idx('ESCALA_MOEDA');
  for (const l of linhas) {
    const codigo = l[iCodigo] ?? '';
    const nome = l[iDescricao] ?? '';
    if (!filtro(codigo, nome)) continue;
    const cvm = Number(l[iCvm]);
    if (!Number.isFinite(cvm)) continue;
    let cia = destino.get(cvm);
    // O consolidado vale mais que o individual; o individual só entra para quem não publica consolidado.
    if (cia && cia.consolidado && !consolidado) continue;
    if (!cia || (consolidado && !cia.consolidado)) {
      cia = { nome: l[iNome] ?? '', consolidado, ultimo: null, penultimo: null };
      destino.set(cvm, cia);
    }
    const ultimo = semAcento(l[iOrdem] ?? '').startsWith('ultimo');
    const chave = ultimo ? 'ultimo' : 'penultimo';
    const fim = l[iFim] ?? '';
    if (!cia[chave]) cia[chave] = { fim, contas: [] };
    const exercicio = cia[chave] as Exercicio;
    const escala = /mil/i.test(l[iEscala] ?? '') ? 1000 : 1;
    const valor = Number(l[iValor]) * escala;
    if (Number.isFinite(valor)) exercicio.contas.push({ codigo, nome, valor });
  }
}

async function carregarAno(ano: number): Promise<Ano | null> {
  try {
    const resposta = await fetch(`${BASE}${ano}.zip`, { signal: AbortSignal.timeout(TEMPO_LIMITE_MS) });
    if (!resposta.ok) return null;
    const arquivos = arquivosDoZip(Buffer.from(await resposta.arrayBuffer()));
    const dados: Ano = new Map();
    const nivel = (codigo: string, maximo: number) => codigo.split('.').length <= maximo;
    const depreciacao = (_: string, nome: string) => /deprecia|amortiza|exaust/i.test(nome);
    for (const consolidado of [true, false]) {
      const tipo = consolidado ? 'con' : 'ind';
      const pegar = (prefixo: string) => arquivos.get(`dfp_cia_aberta_${prefixo}_${tipo}_${ano}.csv`);
      const dre = pegar('DRE');
      const bpa = pegar('BPA');
      const bpp = pegar('BPP');
      const dfc = pegar('DFC_MI');
      if (dre) lerDemonstracao(dre, dados, consolidado, (c) => nivel(c, 3));
      if (bpa) lerDemonstracao(bpa, dados, consolidado, (c) => nivel(c, 3));
      if (bpp) lerDemonstracao(bpp, dados, consolidado, (c) => nivel(c, 3));
      if (dfc) lerDemonstracao(dfc, dados, consolidado, (c, n) => c.startsWith('6.01') && depreciacao(c, n));
    }
    return dados.size > 0 ? dados : null;
  } catch {
    return null;
  }
}

function ano(numero: number): Promise<Ano | null> {
  const guardado = cache.get(numero);
  if (guardado && Date.now() - guardado.em < VALIDADE_MS) return guardado.ano;
  const promessa = carregarAno(numero);
  cache.set(numero, { em: Date.now(), ano: promessa });
  promessa.then((r) => {
    if (r === null) cache.delete(numero);
  });
  return promessa;
}

// ---------- Contas pelo nome ----------

function conta(e: Exercicio | null, teste: (c: Conta) => boolean): number | null {
  const achada = e?.contas.find(teste);
  return achada ? achada.valor : null;
}

const porCodigo = (codigo: string) => (c: Conta) => c.codigo === codigo;
const porNome = (padrao: RegExp, prefixo?: string) => (c: Conta) => padrao.test(semAcento(c.nome)) && (!prefixo || c.codigo.startsWith(prefixo));

export interface Balanco {
  companhia: string;
  consolidado: boolean;
  exercicio: string; // fim do exercício ('2025-12-31')
  receita: number | null;
  ebit: number | null;
  depreciacao: number | null;
  lucro: number | null; // atribuído aos controladores (ou o lucro do período)
  lucroAnterior: number | null; // do exercício anterior
  patrimonioLiquido: number | null; // dos controladores
  ativoTotal: number | null;
  ativoCirculante: number | null;
  passivoCirculante: number | null;
  dividaBruta: number | null; // empréstimos e financiamentos de curto e longo prazo
  caixa: number | null; // caixa e equivalentes + aplicações financeiras de curto prazo
}

function montarBalanco(cia: Companhia): Balanco | null {
  const e = cia.ultimo;
  if (!e) return null;
  const lucroDe = (x: Exercicio | null) =>
    conta(x, porNome(/atribuido a socios da empresa controladora/, '3.')) ??
    conta(x, porNome(/^lucro\/prejuizo (consolidado )?do periodo/, '3.')) ??
    conta(x, porNome(/^lucro ou prejuizo liquido/, '3.'));
  // Patrimônio líquido: a conta "Patrimônio Líquido..." do passivo, menos a parte dos não controladores.
  const plTotal = conta(e, (c) => /^2\.0\d$/.test(c.codigo) && /^patrimonio liquido/.test(semAcento(c.nome)));
  const naoControladores = conta(e, porNome(/nao controladores/, '2.0'));
  const curto = conta(e, (c) => c.codigo.startsWith('2.01.') && /emprestimos e financiamentos/.test(semAcento(c.nome)));
  const longo = conta(e, (c) => c.codigo.startsWith('2.02.') && /emprestimos e financiamentos/.test(semAcento(c.nome)));
  const caixa = conta(e, porCodigo('1.01.01'));
  const aplicacoes = conta(e, (c) => c.codigo === '1.01.02' && /aplicac/.test(semAcento(c.nome)));
  // Depreciação no fluxo de caixa: soma das linhas (algumas empresas separam depreciação e amortização).
  const linhasDep = e.contas.filter((c) => c.codigo.startsWith('6.01') && /deprecia|amortiza|exaust/.test(semAcento(c.nome)));
  return {
    companhia: cia.nome,
    consolidado: cia.consolidado,
    exercicio: e.fim,
    receita: conta(e, porCodigo('3.01')),
    ebit: conta(e, porNome(/resultado antes do resultado financeiro e dos tributos/, '3.')),
    depreciacao: linhasDep.length ? Math.abs(linhasDep.reduce((s, c) => s + c.valor, 0)) : null,
    lucro: lucroDe(e),
    lucroAnterior: lucroDe(cia.penultimo),
    patrimonioLiquido: plTotal === null ? null : plTotal - (naoControladores ?? 0),
    ativoTotal: conta(e, porCodigo('1')),
    ativoCirculante: conta(e, (c) => c.codigo === '1.01' && /circulante/.test(semAcento(c.nome))),
    passivoCirculante: conta(e, (c) => c.codigo === '2.01' && /circulante/.test(semAcento(c.nome))),
    dividaBruta: curto === null && longo === null ? null : (curto ?? 0) + (longo ?? 0),
    caixa: caixa === null && aplicacoes === null ? null : (caixa ?? 0) + (aplicacoes ?? 0),
  };
}

// Balanço mais recente (DFP do ano passado; se ainda não saiu, o de dois anos atrás) e o lucro de 5 anos antes.
export async function balancoDaCompanhia(codigoCvm: number): Promise<{ atual: Balanco; lucro5AnosAntes: number | null } | null> {
  const esteAno = new Date().getUTCFullYear();
  for (const anoBalanco of [esteAno - 1, esteAno - 2]) {
    const dados = await ano(anoBalanco);
    const cia = dados?.get(codigoCvm);
    if (!cia) continue;
    const atual = montarBalanco(cia);
    if (!atual) continue;
    // O DFP de (ano - 4) traz, como exercício anterior, o lucro de 5 anos antes.
    const antigo = await ano(anoBalanco - 4);
    const ciaAntiga = antigo?.get(codigoCvm);
    const lucro5AnosAntes = ciaAntiga ? montarBalanco({ ...ciaAntiga, ultimo: ciaAntiga.penultimo, penultimo: null })?.lucro ?? null : null;
    return { atual, lucro5AnosAntes };
  }
  return null;
}
