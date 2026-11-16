// Informe mensal dos fundos imobiliários na CVM (dados abertos, sem cadastro):
// https://dados.cvm.gov.br/dados/FII/DOC/INF_MENSAL/DADOS/inf_mensal_fii_<ano>.zip
// Cada ZIP traz, por mês, o cadastro do fundo (geral: CNPJ, ISIN, segmento, gestão, administrador) e o
// complemento (patrimônio líquido, valor patrimonial da cota, número de cotistas, DY do mês...).
// O fundo é achado pelo ISIN da cota (o mesmo que a B3 informa). Os arquivos do ano atual e do anterior ficam em
// memória e são baixados de novo a cada 24 horas. Falha de rede: devolve null, sem erro.

import zlib from 'node:zlib';

const BASE = 'https://dados.cvm.gov.br/dados/FII/DOC/INF_MENSAL/DADOS/inf_mensal_fii_';
const VALIDADE_MS = 24 * 60 * 60 * 1000;
const TEMPO_LIMITE_MS = 60000;

export interface MesCvm {
  mes: string; // 'AAAA-MM'
  valorPatrimonialCota: number | null;
  patrimonioLiquido: number | null;
  cotistas: number | null;
  dividendYieldMes: number | null; // em %, como o fundo informou
  rentabilidadePatrimonialMes: number | null; // em %
}

export interface FundoCvm {
  cnpj: string;
  nome: string;
  segmento: string | null;
  mandato: string | null;
  tipoGestao: string | null;
  administrador: string | null;
  meses: MesCvm[]; // do mais antigo para o mais novo
  achadoPor: 'ISIN' | 'COTAS'; // pelas cotas, a ligação é uma estimativa: quem usa deve conferir se faz sentido
}

interface Cadastro {
  cnpj: string;
  nome: string;
  segmento: string;
  mandato: string;
  tipoGestao: string;
  administrador: string;
  mes: string;
}

interface Ano {
  geral: Map<string, Set<string>>; // ISIN -> CNPJs que informam esse ISIN (às vezes mais de um, por erro de cadastro)
  porCnpj: Map<string, Cadastro>; // CNPJ -> último cadastro
  complemento: Map<string, MesCvm[]>; // CNPJ -> meses
  cotas: Map<string, { mes: string; cotas: number }>; // CNPJ -> cotas emitidas no último mês informado
}

const cache = new Map<number, { em: number; ano: Promise<Ano | null> }>();

// ---------- ZIP (só o necessário: arquivos "stored" ou "deflate") ----------

export function arquivosDoZip(zip: Buffer): Map<string, Buffer> {
  const arquivos = new Map<string, Buffer>();
  // Fim do diretório central: assinatura 0x06054b50, procurada de trás para frente.
  let fim = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      fim = i;
      break;
    }
  }
  if (fim < 0) return arquivos;
  const total = zip.readUInt16LE(fim + 10);
  let p = zip.readUInt32LE(fim + 16);
  for (let n = 0; n < total; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) break;
    const metodo = zip.readUInt16LE(p + 10);
    const tamanhoComprimido = zip.readUInt32LE(p + 20);
    const tamanhoNome = zip.readUInt16LE(p + 28);
    const tamanhoExtra = zip.readUInt16LE(p + 30);
    const tamanhoComentario = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const nome = zip.subarray(p + 46, p + 46 + tamanhoNome).toString('utf8');
    const inicioDados = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const dados = zip.subarray(inicioDados, inicioDados + tamanhoComprimido);
    if (metodo === 0) arquivos.set(nome, Buffer.from(dados));
    else if (metodo === 8) arquivos.set(nome, zlib.inflateRawSync(dados));
    p += 46 + tamanhoNome + tamanhoExtra + tamanhoComentario;
  }
  return arquivos;
}

// ---------- CSV (separado por ";", com aspas opcionais, em latin-1) ----------

export function linhasCsv(texto: string): string[][] {
  const linhas: string[][] = [];
  for (const bruta of texto.split(/\r?\n/)) {
    if (!bruta) continue;
    const campos: string[] = [];
    let atual = '';
    let entreAspas = false;
    for (let i = 0; i < bruta.length; i++) {
      const c = bruta[i];
      if (c === '"') {
        if (entreAspas && bruta[i + 1] === '"') {
          atual += '"';
          i++;
        } else entreAspas = !entreAspas;
      } else if (c === ';' && !entreAspas) {
        campos.push(atual);
        atual = '';
      } else atual += c;
    }
    campos.push(atual);
    linhas.push(campos);
  }
  return linhas;
}

function numero(texto: string | undefined): number | null {
  if (texto === undefined || texto.trim() === '') return null;
  const n = Number(texto.trim());
  return Number.isFinite(n) ? n : null;
}

function porNome(cabecalho: string[]) {
  const indice = new Map(cabecalho.map((c, i) => [c.trim(), i]));
  return (linha: string[], nome: string) => {
    const i = indice.get(nome);
    return i === undefined ? '' : (linha[i] ?? '').trim();
  };
}

async function carregarAno(ano: number): Promise<Ano | null> {
  try {
    const resposta = await fetch(`${BASE}${ano}.zip`, { signal: AbortSignal.timeout(TEMPO_LIMITE_MS) });
    if (!resposta.ok) return null;
    const arquivos = arquivosDoZip(Buffer.from(await resposta.arrayBuffer()));
    const geralCsv = arquivos.get(`inf_mensal_fii_geral_${ano}.csv`);
    const compCsv = arquivos.get(`inf_mensal_fii_complemento_${ano}.csv`);
    if (!geralCsv || !compCsv) return null;

    const geral: Ano['geral'] = new Map();
    const porCnpj: Ano['porCnpj'] = new Map();
    const [cabG, ...linhasG] = linhasCsv(geralCsv.toString('latin1'));
    const g = porNome(cabG);
    for (const l of linhasG) {
      const isin = g(l, 'Codigo_ISIN').toUpperCase();
      const mes = g(l, 'Data_Referencia').slice(0, 7);
      const cadastro: Cadastro = {
        cnpj: g(l, 'CNPJ_Fundo_Classe'),
        nome: g(l, 'Nome_Fundo_Classe'),
        segmento: g(l, 'Segmento_Atuacao'),
        mandato: g(l, 'Mandato'),
        tipoGestao: g(l, 'Tipo_Gestao'),
        administrador: g(l, 'Nome_Administrador'),
        mes,
      };
      const doCnpj = porCnpj.get(cadastro.cnpj);
      if (cadastro.cnpj && (!doCnpj || doCnpj.mes < mes)) porCnpj.set(cadastro.cnpj, cadastro);
      // ISIN vazio ou "0" (comum no informe): o fundo só é achado pelo CNPJ.
      if (!/^BR\w{10}$/.test(isin)) continue;
      if (!cadastro.cnpj) continue;
      const cnpjs = geral.get(isin) ?? new Set<string>();
      cnpjs.add(cadastro.cnpj);
      geral.set(isin, cnpjs);
    }

    const complemento: Ano['complemento'] = new Map();
    const cotas: Ano['cotas'] = new Map();
    const [cabC, ...linhasC] = linhasCsv(compCsv.toString('latin1'));
    const c = porNome(cabC);
    for (const l of linhasC) {
      const cnpj = c(l, 'CNPJ_Fundo_Classe');
      const mes = c(l, 'Data_Referencia').slice(0, 7);
      if (!cnpj || !mes) continue;
      const emitidas = numero(c(l, 'Cotas_Emitidas'));
      const ultimas = cotas.get(cnpj);
      if (emitidas && emitidas > 0 && (!ultimas || ultimas.mes <= mes)) cotas.set(cnpj, { mes, cotas: emitidas });
      const dy = numero(c(l, 'Percentual_Dividend_Yield_Mes'));
      const rent = numero(c(l, 'Percentual_Rentabilidade_Patrimonial_Mes'));
      const lista = complemento.get(cnpj) ?? [];
      // Reenvio do mesmo mês (versão nova): fica a última linha lida.
      const sem = lista.filter((m) => m.mes !== mes);
      sem.push({
        mes,
        valorPatrimonialCota: numero(c(l, 'Valor_Patrimonial_Cotas')),
        patrimonioLiquido: numero(c(l, 'Patrimonio_Liquido')),
        cotistas: numero(c(l, 'Total_Numero_Cotistas')),
        dividendYieldMes: dy === null ? null : dy * 100,
        rentabilidadePatrimonialMes: rent === null ? null : rent * 100,
      });
      complemento.set(cnpj, sem);
    }
    return { geral, porCnpj, complemento, cotas };
  } catch {
    return null;
  }
}

function ano(numeroDoAno: number): Promise<Ano | null> {
  const guardado = cache.get(numeroDoAno);
  if (guardado && Date.now() - guardado.em < VALIDADE_MS) return guardado.ano;
  const promessa = carregarAno(numeroDoAno);
  cache.set(numeroDoAno, { em: Date.now(), ano: promessa });
  // Falhou: não guarda o erro por 24 horas.
  promessa.then((r) => {
    if (r === null) cache.delete(numeroDoAno);
  });
  return promessa;
}

// Fundo cujas cotas emitidas batem com as da B3 (diferença de até 0,02%), quando é o único nessa faixa.
// Serve para fundos que trocaram de código (o informe da CVM guarda o ISIN antigo) ou que não informam o ISIN.
function cnpjPelasCotas(dados: (Ano | null)[], cotasB3: number): string | null {
  const candidatos = new Map<string, number>();
  for (const d of dados) {
    for (const [cnpj, c] of d?.cotas ?? []) {
      const diferenca = Math.abs(c.cotas - cotasB3) / cotasB3;
      if (diferenca <= 0.0002) candidatos.set(cnpj, Math.min(diferenca, candidatos.get(cnpj) ?? 1));
    }
  }
  return candidatos.size === 1 ? [...candidatos.keys()][0] : null;
}

// Dados do fundo, com os meses do ano atual e do anterior. Procura pelo ISIN da cota (ex.: BRTGARCTF009) e, se não
// achar, pelas cotas emitidas que a B3 informa.
export async function fundoNaCvm(isin: string | null, cotasB3?: number | null): Promise<FundoCvm | null> {
  const atual = new Date().getUTCFullYear();
  const [deste, doAnterior] = await Promise.all([ano(atual), ano(atual - 1)]);
  const chave = (isin ?? '').toUpperCase();
  // Mais de um CNPJ com o mesmo ISIN: fica o de cotas emitidas mais perto das da B3 (sem as cotas da B3, o primeiro).
  const peloIsin = chave ? [...new Set([...(deste?.geral.get(chave) ?? []), ...(doAnterior?.geral.get(chave) ?? [])])] : [];
  const distancia = (c: string) => {
    const q = deste?.cotas.get(c)?.cotas ?? doAnterior?.cotas.get(c)?.cotas;
    return q && cotasB3 ? Math.abs(Math.log(q / cotasB3)) : Number.POSITIVE_INFINITY;
  };
  let cnpj: string | null = peloIsin.sort((a, b) => distancia(a) - distancia(b))[0] ?? null;
  const achadoPor: FundoCvm['achadoPor'] = cnpj ? 'ISIN' : 'COTAS';
  if (!cnpj && cotasB3) cnpj = cnpjPelasCotas([deste, doAnterior], cotasB3);
  if (!cnpj) return null;
  const cadastro = deste?.porCnpj.get(cnpj) ?? doAnterior?.porCnpj.get(cnpj) ?? null;
  const meses = [...(doAnterior?.complemento.get(cnpj) ?? []), ...(deste?.complemento.get(cnpj) ?? [])]
    .sort((a, b) => (a.mes < b.mes ? -1 : a.mes > b.mes ? 1 : 0));
  if (meses.length === 0) return null;
  return {
    cnpj,
    nome: cadastro?.nome ?? '',
    segmento: cadastro?.segmento || null,
    mandato: cadastro?.mandato || null,
    tipoGestao: cadastro?.tipoGestao || null,
    administrador: cadastro?.administrador || null,
    meses,
    achadoPor,
  };
}
