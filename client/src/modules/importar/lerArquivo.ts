// Abre no navegador o arquivo escolhido e devolve o conteúdo pronto para a API:
// texto (CSV, OFX, PDF e XLSX de banco, que vira CSV) ou as abas da planilha (XLSX da B3). O arquivo não é enviado.
// As bibliotecas de PDF e de planilha são grandes: só são baixadas quando um arquivo desses é aberto.
import type { Celula, FormatoArquivo, Planilha } from './tipos';

export type ArquivoLido =
  | { tipo: 'texto'; nome: string; formato: FormatoArquivo; texto: string }
  | { tipo: 'planilha'; nome: string; planilhas: Planilha[] };

const TAMANHO_MAXIMO = 15 * 1024 * 1024;

function extensao(nome: string): string {
  const ponto = nome.lastIndexOf('.');
  return ponto >= 0 ? nome.slice(ponto + 1).toLowerCase() : '';
}

// CSV e OFX de banco vêm em UTF-8 ou em Latin-1 (Windows-1252). Se o UTF-8 der caractere inválido, lê de novo.
async function lerTexto(arquivo: File): Promise<string> {
  const bytes = await arquivo.arrayBuffer();
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  return utf8.includes('�') ? new TextDecoder('windows-1252').decode(bytes) : utf8;
}

// PDF -> texto, uma linha de texto por linha da página (os pedaços são agrupados pela altura).
async function lerPdf(arquivo: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const documento = await pdfjs.getDocument({ data: new Uint8Array(await arquivo.arrayBuffer()) }).promise;
  const linhas: string[] = [];
  for (let numero = 1; numero <= documento.numPages; numero++) {
    const pagina = await documento.getPage(numero);
    const conteudo = await pagina.getTextContent();
    const pedacos: { x: number; y: number; texto: string }[] = [];
    for (const item of conteudo.items) {
      if (!('str' in item) || item.str.trim() === '') continue;
      pedacos.push({ x: item.transform[4], y: item.transform[5], texto: item.str });
    }
    // De cima para baixo; na mesma altura (tolerância de 3 pontos), da esquerda para a direita.
    pedacos.sort((a, b) => (Math.abs(a.y - b.y) > 3 ? b.y - a.y : a.x - b.x));
    let atual: { y: number; partes: { x: number; texto: string }[] } | null = null;
    const fechar = () => {
      if (atual) linhas.push(atual.partes.sort((a, b) => a.x - b.x).map((p) => p.texto).join(' '));
    };
    for (const p of pedacos) {
      if (atual && Math.abs(atual.y - p.y) <= 3) {
        atual.partes.push({ x: p.x, texto: p.texto });
      } else {
        fechar();
        atual = { y: p.y, partes: [{ x: p.x, texto: p.texto }] };
      }
    }
    fechar();
  }
  return linhas.join('\n');
}

function doisDigitos(n: number): string {
  return String(n).padStart(2, '0');
}

function celula(valor: unknown): Celula {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === 'string') return valor.length > 500 ? valor.slice(0, 500) : valor;
  if (typeof valor === 'number' || typeof valor === 'boolean') return valor;
  if (valor instanceof Date) {
    return `${doisDigitos(valor.getUTCDate())}/${doisDigitos(valor.getUTCMonth() + 1)}/${valor.getUTCFullYear()}`;
  }
  return String(valor).slice(0, 500);
}

async function lerPlanilha(arquivo: File): Promise<Planilha[]> {
  const modulo = await import('read-excel-file/browser');
  const abas = await modulo.default(arquivo);
  return abas.map((aba) => ({
    nome: aba.sheet,
    linhas: aba.data.map((linha) => linha.slice(0, 60).map(celula)),
  }));
}

function semAcento(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

// Planilha da Área do Investidor da B3: cabeçalho com "Produto" e movimentação ou quantidade.
function ehPlanilhaDaB3(planilhas: Planilha[]): boolean {
  return planilhas.some((p) =>
    p.linhas.slice(0, 20).some((linha) => {
      const t = linha.map((c) => semAcento(String(c ?? '')));
      return t.includes('produto') && (t.includes('entrada/saida') || t.includes('movimentacao') || t.includes('quantidade'));
    })
  );
}

function celulaCsv(c: Celula): string {
  if (typeof c === 'number') return String(c).replace('.', ','); // -5916.95 -> -5916,95 (o leitor usa vírgula decimal)
  const texto = String(c ?? '').replace(/\s+/g, ' ').trim();
  return /[;"]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

// Fatura ou extrato de banco em planilha (a fatura do Itaú, por exemplo): a tabela de lançamentos vira CSV e segue
// o mesmo caminho dos CSVs. A primeira linha com "Data" e "Valor" é o cabeçalho; a tabela termina na primeira linha
// vazia depois dela. Antes da tabela, o banco (se a planilha citar) e o vencimento (célula "Vencimento" e a data ao
// lado ou logo abaixo) vão em linhas próprias, que o leitor usa.
function planilhaParaCsv(planilhas: Planilha[]): string | null {
  for (const p of planilhas) {
    const iCabecalho = p.linhas.findIndex((linha) => {
      const t = linha.map((c) => semAcento(String(c ?? '')));
      return t.some((x) => x === 'data' || x.startsWith('data ')) && t.some((x) => x.startsWith('valor'));
    });
    if (iCabecalho < 0) continue;
    const tudo = p.linhas.flat().map((c) => String(c ?? '')).join(' ');
    const banco = /ita[uú]|personnalit/i.test(tudo) ? 'Itaú' : null;
    let vencimento: string | null = null;
    for (let i = 0; i < iCabecalho && !vencimento; i++) {
      p.linhas[i].forEach((c, j) => {
        if (vencimento || !semAcento(String(c ?? '')).startsWith('vencimento')) return;
        const perto = [p.linhas[i][j + 1], p.linhas[i + 1]?.[j], p.linhas[i][j + 2]].map((x) => String(x ?? '').trim());
        vencimento = perto.find((x) => /^\d{2}\/\d{2}\/\d{4}$/.test(x)) ?? null;
      });
    }
    const saida: string[] = [];
    if (banco) saida.push(`Banco: ${banco}`);
    if (vencimento) saida.push(`Vencimento: ${vencimento}`);
    let linhasDeDados = 0;
    for (const linha of p.linhas.slice(iCabecalho)) {
      const vazia = linha.every((c) => c === null || String(c).trim() === '');
      if (vazia) {
        if (linhasDeDados > 0) break;
        continue;
      }
      saida.push(linha.map(celulaCsv).join(';'));
      linhasDeDados++;
    }
    if (linhasDeDados > 1) return saida.join('\n');
  }
  return null;
}

// Lança Error com mensagem em português quando o arquivo não pode ser lido.
export async function lerArquivo(arquivo: File): Promise<ArquivoLido> {
  if (arquivo.size > TAMANHO_MAXIMO) {
    throw new Error('O arquivo é grande demais (máximo de 15 MB).');
  }
  const ext = extensao(arquivo.name);
  if (ext === 'xlsx') {
    let planilhas: Planilha[];
    try {
      planilhas = await lerPlanilha(arquivo);
    } catch {
      throw new Error('Não consegui abrir esta planilha. Envie o .xlsx baixado do banco ou da Área do Investidor da B3.');
    }
    // Planilha da B3 vai para a prévia da carteira; fatura ou extrato de banco, para a de lançamentos.
    if (!ehPlanilhaDaB3(planilhas)) {
      const csv = planilhaParaCsv(planilhas);
      if (csv) return { tipo: 'texto', nome: arquivo.name, formato: 'csv', texto: csv };
    }
    return { tipo: 'planilha', nome: arquivo.name, planilhas };
  }
  if (ext === 'pdf') {
    let texto: string;
    try {
      texto = await lerPdf(arquivo);
    } catch {
      throw new Error('Não consegui abrir este PDF. Se ele tiver senha, salve uma cópia sem senha e tente de novo.');
    }
    if (texto.trim() === '') {
      throw new Error('Este PDF não tem texto (parece uma imagem digitalizada). Use o CSV ou o OFX do banco.');
    }
    return { tipo: 'texto', nome: arquivo.name, formato: 'pdf', texto };
  }
  if (ext === 'ofx' || ext === 'qfx') {
    return { tipo: 'texto', nome: arquivo.name, formato: 'ofx', texto: await lerTexto(arquivo) };
  }
  if (ext === 'csv' || ext === 'txt') {
    return { tipo: 'texto', nome: arquivo.name, formato: 'csv', texto: await lerTexto(arquivo) };
  }
  if (ext === 'xls') {
    throw new Error('Planilha no formato antigo (.xls). Abra e salve como .xlsx, ou exporte em CSV.');
  }
  throw new Error('Formato não aceito. Envie CSV, OFX, PDF ou XLSX (fatura e extrato do banco, ou a planilha da B3).');
}
