import { useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { mensagemErro } from '../../lib/financas';
import { Aviso, Cartao, Carregando, Pagina } from '../../ui';
import { Icone } from '../../ui/icones';
import { Cotacoes } from './Cotacoes';
import { Historico } from './Historico';
import { PreviaB3 } from './PreviaB3';
import { PreviaLancamentos } from './PreviaLancamentos';
import { lerArquivo } from './lerArquivo';
import type { ArquivoLido } from './lerArquivo';
import './importar.css';

interface NaFila {
  id: number;
  lido: ArquivoLido;
}

export function Importar() {
  const [fila, setFila] = useState<NaFila[]>([]);
  const [lendo, setLendo] = useState(false);
  const [erros, setErros] = useState<string[]>([]);
  const [sucessos, setSucessos] = useState<string[]>([]);
  const [versao, setVersao] = useState(0);
  const [arrastando, setArrastando] = useState(false);
  const proximoId = useRef(1);

  // Lê os arquivos escolhidos e põe cada um na fila de prévia. Falha de leitura vira mensagem de erro.
  async function receber(arquivos: File[]) {
    setErros([]);
    setLendo(true);
    for (const arquivo of arquivos) {
      try {
        const lido = await lerArquivo(arquivo);
        const id = proximoId.current++;
        setFila((atual) => [...atual, { id, lido }]);
      } catch (e) {
        setErros((atual) => [...atual, `${arquivo.name}: ${mensagemErro(e)}`]);
      }
    }
    setLendo(false);
  }

  function concluir(id: number, mensagem: string) {
    setFila((atual) => atual.filter((item) => item.id !== id));
    setSucessos((atual) => [...atual, mensagem]);
    setVersao((v) => v + 1);
  }

  function descartar(id: number) {
    setFila((atual) => atual.filter((item) => item.id !== id));
  }

  return (
    <Pagina titulo="Importar">
      <label
        className={arrastando ? 'importar-area importar-area-ativa' : 'importar-area'}
        onDragOver={(e: DragEvent<HTMLLabelElement>) => {
          e.preventDefault();
          setArrastando(true);
        }}
        onDragLeave={(e: DragEvent<HTMLLabelElement>) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setArrastando(false);
        }}
        onDrop={(e: DragEvent<HTMLLabelElement>) => {
          e.preventDefault();
          setArrastando(false);
          receber(Array.from(e.dataTransfer.files));
        }}
      >
        <input
          type="file"
          multiple
          accept=".csv,.txt,.ofx,.qfx,.pdf,.xlsx"
          className="importar-input"
          onChange={(e) => {
            const arquivos = Array.from(e.target.files ?? []);
            e.target.value = '';
            receber(arquivos);
          }}
        />
        <Icone nome="importar" tamanho={32} />
        <strong>Arraste os arquivos para cá ou clique para escolher</strong>
        <span className="fin-suave">
          Fatura do cartão ou extrato da conta em CSV, OFX ou PDF. Planilha de movimentação ou de posição da B3 em XLSX.
        </span>
      </label>

      {lendo && <Carregando />}
      {erros.map((erro, i) => (
        <Aviso key={i} tipo="erro">
          {erro}
        </Aviso>
      ))}
      {sucessos.map((sucesso, i) => (
        <Aviso key={i} tipo="sucesso">
          {sucesso}
        </Aviso>
      ))}

      {fila.map((item) => (
        <Cartao key={item.id}>
          {item.lido.tipo === 'texto' ? (
            <PreviaLancamentos
              arquivo={item.lido}
              aoConcluir={(msg) => concluir(item.id, msg)}
              aoDescartar={() => descartar(item.id)}
            />
          ) : (
            <PreviaB3
              nome={item.lido.nome}
              planilhas={item.lido.planilhas}
              aoConcluir={(msg) => concluir(item.id, msg)}
              aoDescartar={() => descartar(item.id)}
            />
          )}
        </Cartao>
      ))}

      <div className="fin-duas-colunas">
        <Cotacoes versao={versao} />
        <Cartao titulo="Como baixar os arquivos">
          <ul>
            <li>
              Fatura do cartão: no aplicativo ou no site do banco, abra a fatura e escolha exportar em CSV (ou OFX). Se só
              houver PDF, envie o PDF.
            </li>
            <li>Extrato da conta: exporte o período desejado em CSV ou OFX.</li>
            <li>
              Investimentos: na Área do Investidor da B3 (investidor.b3.com.br), abra Extratos &gt; Movimentação, filtre o
              período mais longo possível e baixe em Excel.
            </li>
            <li>Pode enviar o mesmo arquivo de novo: o que já foi importado não é duplicado.</li>
          </ul>
        </Cartao>
      </div>

      <Historico versao={versao} />
    </Pagina>
  );
}
