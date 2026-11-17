import { useState } from 'react';
import { api } from '../../lib/api';
import { formatarReais, mensagemErro } from '../../lib/financas';
import { Aviso, Botao } from '../../ui';

// Itens lidos do cupom e, a pedido, a CBS/IBS de cada um pela calculadora oficial da Reforma Tributária.
// O NCM vem do cupom quando está impresso; senão é o mais provável para o produto (palpite da leitura).

export interface ItemCupom {
  descricao: string;
  quantidade: number;
  valor: number | null;
  ncm: string | null;
}

interface ResultadoCupom {
  ano: number;
  itens: { descricao: string | null; cClassTrib: string; aliquotaEfetiva: number; embutido: number; calculado: boolean; erros: string[] }[];
  total: { embutido: number };
}

const ANOS = [2027, 2033];

export function ItensDoCupom({ itens }: { itens: ItemCupom[] }) {
  const [ano, setAno] = useState(2033);
  const [resultado, setResultado] = useState<ResultadoCupom | null>(null);
  const [calculando, setCalculando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function calcular(anoEscolhido: number) {
    setAno(anoEscolhido);
    setErro(null);
    setCalculando(true);
    try {
      setResultado(await api.post<ResultadoCupom>('/tributos/cupom', { ano: anoEscolhido, itens }));
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setCalculando(false);
    }
  }

  // Resultado de cada item na mesma ordem dos itens que têm NCM e valor (os outros não vão para o cálculo).
  const calculaveis = itens.filter((i) => i.ncm && i.valor !== null);
  const porItem = new Map(calculaveis.map((i, n) => [i, resultado?.itens[n]]));

  return (
    <details className="rapido-itens-cupom">
      <summary>
        {itens.length} {itens.length === 1 ? 'item lido' : 'itens lidos'} do cupom
        {resultado && ` · CBS/IBS em ${resultado.ano}: ${formatarReais(resultado.total.embutido)}`}
      </summary>
      <table>
        <thead>
          <tr>
            <th>Produto</th>
            <th>NCM</th>
            <th className="rapido-direita">Valor</th>
            {resultado && <th className="rapido-direita">CBS/IBS</th>}
          </tr>
        </thead>
        <tbody>
          {itens.map((i, n) => {
            const r = porItem.get(i);
            return (
              <tr key={n}>
                <td>
                  {i.quantidade !== 1 && `${i.quantidade.toLocaleString('pt-BR')} × `}
                  {i.descricao}
                </td>
                <td>{i.ncm ?? '—'}</td>
                <td className="rapido-direita">{i.valor !== null ? formatarReais(i.valor) : '—'}</td>
                {resultado && (
                  <td className="rapido-direita" title={r?.erros.join('; ')}>
                    {r?.calculado ? `${formatarReais(r.embutido)} (${r.aliquotaEfetiva.toLocaleString('pt-BR')}%)` : '—'}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <div className="rapido-itens-acoes">
        {ANOS.map((a) => (
          <Botao key={a} variante={resultado && ano === a ? 'primario' : 'secundario'} desabilitado={calculando || calculaveis.length === 0} aoClicar={() => void calcular(a)}>
            {calculando && ano === a ? 'Calculando...' : `CBS/IBS em ${a}`}
          </Botao>
        ))}
      </div>
      <p className="rapido-ajuda">
        Parte do preço que seria CBS/IBS (e Imposto Seletivo) pela calculadora oficial. O NCM, quando não está impresso,
        é um palpite da leitura; 2027 em diante usa alíquotas estimadas.
      </p>
    </details>
  );
}
