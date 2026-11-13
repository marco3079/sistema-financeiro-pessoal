import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import { api } from '../../lib/api';
import { TIPOS_INVESTIMENTO, formatarReais, lerValor, mensagemErro, rotuloDe } from '../../lib/financas';
import type { TipoInvestimento } from '../../lib/financas';
import { Aviso, Botao, Modal, Tabela } from '../../ui';
import './importar-planilha.css';

const LIMITE_LINHAS = 200;
const COLUNAS_MODELO = ['nome', 'tipo', 'instituicao', 'valor_aplicado', 'saldo', 'taxa', 'vencimento', 'codigo'];
const CONTEUDO_MODELO = [
  COLUNAS_MODELO.join(';'),
  'CDB Exemplo;RENDA_FIXA;Banco Exemplo;1000,00;1150,00;110% do CDI;15/03/2030;',
  'Fundo Exemplo;FUNDO;Corretora Exemplo;500,00;;;;',
].join('\r\n');

interface NovoInvestimento {
  nome: string;
  tipo: TipoInvestimento;
  codigo: string | null;
  instituicao: string | null;
  taxa: string | null;
  valorAplicado: number;
  saldo: number;
  vencimento: string | null;
}

interface LinhaPlanilha {
  linha: number;
  nome: string;
  tipoTexto: string;
  dados: NovoInvestimento | null;
  erro: string | null;
}

interface FalhaEnvio {
  linha: number;
  nome: string;
  mensagem: string;
}

interface ResultadoEnvio {
  entraram: number;
  falhas: FalhaEnvio[];
}

type ResultadoAnalise = { ok: true; linhas: LinhaPlanilha[] } | { ok: false; erro: string };

// ---------- Auxiliares de leitura ----------

// Minúsculas, sem acento e sem espaços nas pontas: "Ações" -> "acoes".
function chaveTexto(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

function textoOuNulo(texto: string): string | null {
  const limpo = texto.trim();
  return limpo === '' ? null : limpo;
}

// Aceita o valor do enum (RENDA_FIXA) ou o rótulo em português (Renda fixa).
function acharTipo(texto: string): TipoInvestimento | null {
  const chave = chaveTexto(texto);
  if (chave === '') return null;
  const achado = TIPOS_INVESTIMENTO.find((t) => chaveTexto(t.valor) === chave || chaveTexto(t.rotulo) === chave);
  return achado ? achado.valor : null;
}

// Vazio = sem vencimento. Aceita DD/MM/AAAA ou AAAA-MM-DD e devolve AAAA-MM-DD.
function acharData(texto: string): { ok: true; valor: string | null } | { ok: false } {
  const limpo = texto.trim();
  if (limpo === '') return { ok: true, valor: null };
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(limpo);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(limpo);
  let ano: number;
  let mes: number;
  let dia: number;
  if (br) {
    dia = Number(br[1]);
    mes = Number(br[2]);
    ano = Number(br[3]);
  } else if (iso) {
    ano = Number(iso[1]);
    mes = Number(iso[2]);
    dia = Number(iso[3]);
  } else {
    return { ok: false };
  }
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  if (data.getUTCFullYear() !== ano || data.getUTCMonth() !== mes - 1 || data.getUTCDate() !== dia) {
    return { ok: false };
  }
  const aaaa = String(ano).padStart(4, '0');
  const mm = String(mes).padStart(2, '0');
  const dd = String(dia).padStart(2, '0');
  return { ok: true, valor: `${aaaa}-${mm}-${dd}` };
}

// Dinheiro não negativo; vazio ou inválido = null.
function lerDinheiro(texto: string): number | null {
  const valor = lerValor(texto);
  return valor === null || valor < 0 ? null : valor;
}

// Separa uma linha respeitando campos entre aspas ("" dentro de aspas = aspas literal).
function lerLinhaCsv(linha: string, separador: string): string[] {
  const campos: string[] = [];
  let atual = '';
  let dentroAspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha.charAt(i);
    if (dentroAspas) {
      if (c === '"') {
        if (linha.charAt(i + 1) === '"') {
          atual += '"';
          i++;
        } else {
          dentroAspas = false;
        }
      } else {
        atual += c;
      }
    } else if (c === '"') {
      dentroAspas = true;
    } else if (c === separador) {
      campos.push(atual);
      atual = '';
    } else {
      atual += c;
    }
  }
  campos.push(atual);
  return campos.map((campo) => campo.trim());
}

function validarLinha(linha: number, campos: string[], cabecalho: string[]): LinhaPlanilha {
  const pegar = (coluna: string): string => {
    const posicao = cabecalho.indexOf(coluna);
    return posicao >= 0 ? (campos[posicao] ?? '') : '';
  };

  const nome = pegar('nome').trim();
  const tipoTexto = pegar('tipo').trim();
  const base = { linha, nome, tipoTexto };

  if (nome === '') return { ...base, dados: null, erro: 'Nome obrigatório' };

  const tipo = acharTipo(tipoTexto);
  if (tipo === null) return { ...base, dados: null, erro: 'Tipo desconhecido' };

  const valorAplicado = lerDinheiro(pegar('valor_aplicado'));
  if (valorAplicado === null) return { ...base, dados: null, erro: 'Valor inválido' };

  let saldo = valorAplicado;
  const saldoTexto = pegar('saldo');
  if (saldoTexto.trim() !== '') {
    const lido = lerDinheiro(saldoTexto);
    if (lido === null) return { ...base, dados: null, erro: 'Valor inválido' };
    saldo = lido;
  }

  const vencimento = acharData(pegar('vencimento'));
  if (!vencimento.ok) return { ...base, dados: null, erro: 'Data inválida' };

  return {
    ...base,
    erro: null,
    dados: {
      nome,
      tipo,
      codigo: textoOuNulo(pegar('codigo')),
      instituicao: textoOuNulo(pegar('instituicao')),
      taxa: textoOuNulo(pegar('taxa')),
      valorAplicado,
      saldo,
      vencimento: vencimento.valor,
    },
  };
}

// Lê o texto inteiro do CSV: separador pela primeira linha, cabeçalho com "nome", até 200 linhas.
function analisarPlanilha(conteudo: string): ResultadoAnalise {
  const semBom = conteudo.replace(/^﻿/, '');
  const linhasNaoVazias = semBom
    .split(/\r?\n/)
    .map((texto, i) => ({ texto, numero: i + 1 }))
    .filter((l) => l.texto.trim() !== '');

  if (linhasNaoVazias.length === 0) return { ok: false, erro: 'O arquivo está vazio.' };

  const primeira = linhasNaoVazias[0].texto;
  const separador = primeira.split(';').length > primeira.split(',').length ? ';' : ',';
  const cabecalho = lerLinhaCsv(primeira, separador).map(chaveTexto);
  if (cabecalho.indexOf('nome') < 0) {
    return { ok: false, erro: 'A planilha precisa da coluna "nome" na primeira linha.' };
  }

  const registros = linhasNaoVazias
    .slice(1)
    .map((l) => ({ linha: l.numero, campos: lerLinhaCsv(l.texto, separador) }))
    .filter((r) => r.campos.some((campo) => campo !== ''));

  if (registros.length > LIMITE_LINHAS) {
    return {
      ok: false,
      erro: `A planilha tem ${registros.length} linhas. O limite é ${LIMITE_LINHAS} por vez.`,
    };
  }

  return { ok: true, linhas: registros.map((r) => validarLinha(r.linha, r.campos, cabecalho)) };
}

function baixarModelo() {
  // BOM UTF-8 no início para o Excel reconhecer os acentos.
  const blob = new Blob(['﻿' + CONTEUDO_MODELO], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'modelo-investimentos.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Componente ----------

export function ImportarPlanilha({
  aberto,
  aoFechar,
  aoConcluir,
}: {
  aberto: boolean;
  aoFechar: () => void;
  aoConcluir: () => void;
}) {
  const [arquivoNome, setArquivoNome] = useState('');
  const [linhas, setLinhas] = useState<LinhaPlanilha[]>([]);
  const [erroArquivo, setErroArquivo] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [resultado, setResultado] = useState<ResultadoEnvio | null>(null);

  // Cada vez que o modal abre ou fecha, começa limpo.
  useEffect(() => {
    setArquivoNome('');
    setLinhas([]);
    setErroArquivo(null);
    setEnviando(false);
    setProgresso(0);
    setResultado(null);
  }, [aberto]);

  const validas = linhas.filter((l) => l.dados !== null);
  const podeImportar = validas.length > 0 && !enviando && resultado === null;
  const rotuloBotao = validas.length === 1 ? 'Importar 1 investimento' : `Importar ${validas.length} investimentos`;

  function aoEscolher(e: ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    e.target.value = '';
    if (!arquivo) return;

    setArquivoNome(arquivo.name);
    setLinhas([]);
    setErroArquivo(null);
    setResultado(null);

    const leitor = new FileReader();
    leitor.onload = () => {
      const texto = typeof leitor.result === 'string' ? leitor.result : '';
      const analise = analisarPlanilha(texto);
      if (analise.ok) {
        setLinhas(analise.linhas);
      } else {
        setErroArquivo(analise.erro);
      }
    };
    leitor.onerror = () => setErroArquivo('Não foi possível ler o arquivo.');
    leitor.readAsText(arquivo, 'UTF-8');
  }

  // Só é chamado pelo clique em Importar: nada é enviado antes disso.
  async function importar() {
    const pendentes = validas.map((l) => ({ linha: l.linha, nome: l.nome, dados: l.dados }));
    setEnviando(true);
    setProgresso(0);

    let entraram = 0;
    const falhas: FalhaEnvio[] = [];
    for (let i = 0; i < pendentes.length; i++) {
      const p = pendentes[i];
      try {
        await api.post('/investimentos', p.dados);
        entraram++;
      } catch (e) {
        falhas.push({ linha: p.linha, nome: p.nome, mensagem: mensagemErro(e) });
      }
      setProgresso(i + 1);
    }

    setEnviando(false);
    setResultado({ entraram, falhas });
    aoConcluir();
  }

  return (
    <Modal aberto={aberto} titulo="Importar planilha" aoFechar={aoFechar}>
      <div className="imp">
        <p>
          Use uma planilha CSV com uma linha por investimento. A primeira linha tem o nome das colunas.
        </p>
        <p className="imp-suave">
          Colunas: nome, tipo, instituicao, valor_aplicado, saldo, taxa, vencimento e codigo. Saldo vazio é igual ao
          valor aplicado. Vencimento em DD/MM/AAAA ou AAAA-MM-DD. Até 200 linhas.
        </p>

        <div>
          <Botao variante="secundario" aoClicar={baixarModelo}>
            Baixar modelo
          </Botao>
        </div>

        <label className="imp-arquivo">
          <span>Arquivo de planilha (.csv)</span>
          <input type="file" accept=".csv,text/csv" onChange={aoEscolher} disabled={enviando} />
        </label>

        {arquivoNome && <p className="imp-suave">Arquivo: {arquivoNome}</p>}
        {erroArquivo && <Aviso tipo="erro">{erroArquivo}</Aviso>}

        {linhas.length > 0 && (
          <Tabela<LinhaPlanilha>
            chave={(l) => l.linha}
            dados={linhas}
            vazio="Nenhuma linha de investimento no arquivo."
            colunas={[
              { titulo: 'Linha', celula: (l) => l.linha },
              { titulo: 'Nome', celula: (l) => l.nome || '—' },
              {
                titulo: 'Tipo',
                celula: (l) => (l.dados ? rotuloDe(TIPOS_INVESTIMENTO, l.dados.tipo) : l.tipoTexto || '—'),
              },
              {
                titulo: 'Valor aplicado',
                alinhar: 'direita',
                celula: (l) => (l.dados ? formatarReais(l.dados.valorAplicado) : '—'),
              },
              { titulo: 'Situação', celula: (l) => l.erro ?? 'OK' },
            ]}
          />
        )}

        {enviando && (
          <p className="imp-progresso" role="status">
            Enviando: {progresso} de {validas.length}
          </p>
        )}

        {resultado && (
          <div className="imp-resultado">
            <Aviso tipo={resultado.falhas.length === 0 ? 'sucesso' : 'info'}>
              {resultado.entraram === 1 ? '1 investimento entrou.' : `${resultado.entraram} investimentos entraram.`}
            </Aviso>
            {resultado.falhas.length > 0 && (
              <>
                <Aviso tipo="erro">
                  {resultado.falhas.length === 1 ? '1 linha não entrou:' : `${resultado.falhas.length} linhas não entraram:`}
                </Aviso>
                <ul className="imp-falhas">
                  {resultado.falhas.map((f) => (
                    <li key={f.linha}>
                      Linha {f.linha} ({f.nome}): {f.mensagem}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        <div className="pagina-acoes">
          <Botao desabilitado={!podeImportar} aoClicar={importar}>
            {enviando ? 'Importando...' : rotuloBotao}
          </Botao>
        </div>
      </div>
    </Modal>
  );
}
