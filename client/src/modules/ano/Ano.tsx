import { useState } from 'react';
import { formatarReais } from '../../lib/financas';
import { useDados } from '../../lib/useDados';
import { Aviso, Cartao, Carregando, Pagina, Selecao } from '../../ui';
import { GraficoBarras } from '../../ui/graficos';
import { NomeComCor, ResumoItem, Vazio } from '../../ui/financas';
import './ano.css';

interface Linha {
  categoriaId: number | null;
  nome: string;
  cor: string;
  meses: number[];
  total: number;
  media: number;
  totalAnoAnterior: number;
  variacao: number | null;
}

interface AnoDTO {
  ano: number;
  anos: number[];
  despesas: Linha[];
  receitas: Linha[];
  totais: { receitas: number[]; despesas: number[]; saldo: number[] };
  anterior: { receitas: number[]; despesas: number[] };
}

const ROTULOS_MES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function soma(valores: number[]): number {
  return valores.reduce((s, v) => s + v, 0);
}

function formatarNumero(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function textoVariacao(variacao: number | null): string {
  if (variacao === null) return '—';
  return (variacao > 0 ? '+' : '') + formatarNumero(variacao) + '%';
}

// Variação entre o total do ano e o do ano anterior (null quando o anterior é zero).
function variacaoDe(atual: number, anterior: number): number | null {
  if (anterior === 0) return null;
  return Math.round(((atual - anterior) / Math.abs(anterior)) * 1000) / 10;
}

// Intensidade da célula: 0 a 100 (% de `--cor-primaria` no fundo), proporcional ao maior valor da tabela.
function intensidade(valor: number, maximo: number): number {
  if (valor === 0 || maximo <= 0) return 0;
  return Math.max(4, Math.round((Math.abs(valor) / maximo) * 100));
}

function maiorValor(linhas: Linha[]): number {
  return Math.max(0, ...linhas.flatMap((l) => l.meses.map((v) => Math.abs(v))));
}

function TabelaAno({ titulo, linhas, totais, anterior, ano }: {
  titulo: string;
  linhas: Linha[];
  totais: number[];
  anterior: number[];
  ano: number;
}) {
  const maximo = maiorValor(linhas);
  const totalGeral = soma(totais);
  const totalAnterior = soma(anterior);
  const mesesComValor = totais.filter((v) => v !== 0).length;
  return (
    <Cartao titulo={titulo}>
      {linhas.length === 0 ? (
        <p className="ano-suave">Sem lançamentos de {titulo.toLowerCase()} em {ano}.</p>
      ) : (
        <div className="ano-tabela-area" role="region" aria-label={`${titulo} do ano, com rolagem horizontal`} tabIndex={0}>
          <table className="ano-tabela">
            <thead>
              <tr>
                <th scope="col" className="ano-fixa">Categoria</th>
                {ROTULOS_MES.map((m) => (
                  <th scope="col" key={m}>{m}</th>
                ))}
                <th scope="col">Total</th>
                <th scope="col">Média</th>
                <th scope="col">Ano anterior</th>
                <th scope="col">Variação</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.categoriaId ?? 'sem'}>
                  <th scope="row" className="ano-fixa ano-nome">
                    <NomeComCor cor={l.cor}>{l.nome}</NomeComCor>
                  </th>
                  {l.meses.map((v, i) => (
                    <td
                      key={i}
                      className="ano-celula"
                      style={{ background: `color-mix(in srgb, var(--cor-primaria) ${intensidade(v, maximo)}%, transparent)` }}
                    >
                      {v === 0 ? '—' : formatarNumero(v)}
                    </td>
                  ))}
                  <td className="ano-destaque">{formatarNumero(l.total)}</td>
                  <td>{formatarNumero(l.media)}</td>
                  <td>{formatarNumero(l.totalAnoAnterior)}</td>
                  <td>{textoVariacao(l.variacao)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" className="ano-fixa">Total do mês</th>
                {totais.map((v, i) => (
                  <td key={i}>{v === 0 ? '—' : formatarNumero(v)}</td>
                ))}
                <td className="ano-destaque">{formatarNumero(totalGeral)}</td>
                <td>{formatarNumero(mesesComValor > 0 ? totalGeral / mesesComValor : 0)}</td>
                <td>{formatarNumero(totalAnterior)}</td>
                <td>{textoVariacao(variacaoDe(totalGeral, totalAnterior))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Cartao>
  );
}

export function Ano() {
  const [ano, setAno] = useState(() => new Date().getFullYear());
  const { dados, carregando, erro } = useDados<AnoDTO>(`/ano?ano=${ano}`);

  const seletorAno = (
    <Selecao
      rotulo="Ano"
      valor={String(ano)}
      aoMudar={(valor) => setAno(Number(valor))}
      opcoes={(dados?.anos ?? [ano]).map((a) => ({ valor: String(a), rotulo: String(a) }))}
    />
  );

  if (!dados) {
    return (
      <Pagina titulo="Visão do ano" acoes={seletorAno}>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {carregando && <Carregando />}
      </Pagina>
    );
  }

  const totalReceitas = soma(dados.totais.receitas);
  const totalDespesas = soma(dados.totais.despesas);
  const totalSaldo = soma(dados.totais.saldo);
  const totalReceitasAnterior = soma(dados.anterior.receitas);
  const totalDespesasAnterior = soma(dados.anterior.despesas);
  const semDados = dados.receitas.length === 0 && dados.despesas.length === 0;

  return (
    <Pagina titulo="Visão do ano" acoes={seletorAno}>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {carregando && <Carregando />}

      {semDados ? (
        <Vazio
          icone="calendario"
          titulo={`Sem lançamentos em ${dados.ano}`}
          texto="Escolha outro ano ou importe extratos e faturas para ver o resumo."
        />
      ) : (
        <>
          <div className="resumo">
            <ResumoItem icone="seta-cima" cor="verde" valor={formatarReais(totalReceitas)} rotulo={`Receitas em ${dados.ano}`} />
            <ResumoItem icone="seta-baixo" cor="vermelho" valor={formatarReais(totalDespesas)} rotulo={`Despesas em ${dados.ano}`} />
            <ResumoItem icone="financeiro" cor="azul" valor={formatarReais(totalSaldo)} rotulo="Saldo do ano" />
            <ResumoItem
              icone="calendario"
              cor="roxo"
              valor={textoVariacao(variacaoDe(totalDespesas, totalDespesasAnterior))}
              rotulo={totalDespesasAnterior > 0 ? `Despesas contra ${dados.ano - 1}` : `Sem despesas em ${dados.ano - 1} para comparar`}
            />
          </div>

          <Cartao titulo="Receitas e despesas por mês">
            <GraficoBarras
              rotulos={ROTULOS_MES}
              series={[
                { nome: 'Receitas', cor: 'var(--cor-verde)', valores: dados.totais.receitas },
                { nome: 'Despesas', cor: 'var(--cor-perigo)', valores: dados.totais.despesas },
              ]}
              formato={formatarReais}
              descricao={`Receitas e despesas de cada mês de ${dados.ano}.`}
            />
          </Cartao>

          <TabelaAno
            titulo="Despesas"
            linhas={dados.despesas}
            totais={dados.totais.despesas}
            anterior={dados.anterior.despesas}
            ano={dados.ano}
          />
          <TabelaAno
            titulo="Receitas"
            linhas={dados.receitas}
            totais={dados.totais.receitas}
            anterior={dados.anterior.receitas}
            ano={dados.ano}
          />
        </>
      )}
    </Pagina>
  );
}
