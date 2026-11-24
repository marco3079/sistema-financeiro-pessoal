import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAcessoPerfil } from '../../lib/acessoPerfil';
import { formatarDia, formatarReais, hojeISO } from '../../lib/financas';
import { useDados } from '../../lib/useDados';
import { Aviso, Carregando } from '../../ui';
import { ResumoItem, Vazio } from '../../ui/financas';
import { GraficoBarras } from '../../ui/graficos';
import { Icone } from '../../ui/icones';
import type { NomeIcone } from '../../ui/icones';
import './painel-empresa.css';

// ---------- Contrato de GET /empresa/painel (e4) ----------

type Natureza = 'PAGAR' | 'RECEBER';

// Mesmo formato de TituloDTO da API (definição comum do lote 6).
interface TituloDTO {
  id: number;
  natureza: Natureza;
  descricao: string;
  parceiroId: number | null;
  parceiroNome: string | null;
  categoriaId: number | null;
  categoriaNome: string | null;
  categoriaCor: string | null;
  centroDeCustoId: number | null;
  centroDeCustoNome: string | null;
  contaId: number | null;
  contaNome: string | null;
  valor: number;
  pago: number;
  saldo: number;
  emissao: string;
  vencimento: string;
  documento: string | null;
  parcela: number | null;
  totalParcelas: number | null;
  grupo: string | null;
  recorrente: boolean;
  observacao: string | null;
  situacao: 'ABERTO' | 'PARCIAL' | 'QUITADO' | 'VENCIDO' | 'CANCELADO';
  diasDeAtraso: number;
  anexos: number;
}

interface MesPainelEmpresa {
  mes: string; // 'AAAA-MM'
  receitas: number;
  despesas: number;
  resultado: number;
}

interface RespostaPainelEmpresa {
  saldoEmContas: number;
  aReceber: number;
  aPagar: number;
  vencidoAReceber: number;
  vencidoAPagar: number;
  receitasDoMes: number;
  despesasDoMes: number;
  resultadoDoMes: number;
  proximos: TituloDTO[];
  vencidos: TituloDTO[];
  meses: MesPainelEmpresa[];
}

// ---------- Atalhos ----------

interface Atalho {
  rotulo: string;
  icone: NomeIcone;
  caminho: string;
}

const ATALHOS: Atalho[] = [
  { rotulo: 'Nova conta a pagar', icone: 'seta-baixo', caminho: '/app/empresa/pagar' },
  { rotulo: 'Nova conta a receber', icone: 'seta-cima', caminho: '/app/empresa/receber' },
  { rotulo: 'Fluxo de caixa', icone: 'grafico', caminho: '/app/empresa/fluxo' },
  { rotulo: 'DRE', icone: 'documento', caminho: '/app/empresa/dre' },
];

// ---------- Formatação ----------

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

// 'AAAA-MM' -> 'Jun/26'.
function rotuloCurtoMes(mes: string): string {
  return `${MESES[Number(mes.slice(5, 7)) - 1] ?? mes}/${mes.slice(2, 4)}`;
}

// Eixo do gráfico: valores grandes em "mil" para caber na margem.
function formatarCompacto(valor: number): string {
  if (Math.abs(valor) >= 1000) {
    const mil = (valor / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
    return `R$ ${mil} mil`;
  }
  return formatarReais(valor);
}

// Dias de calendário entre duas datas AAAA-MM-DD (negativo se a data já passou).
function diasEntre(data: string, hoje: string): number {
  const [a1, m1, d1] = data.slice(0, 10).split('-').map(Number);
  const [a2, m2, d2] = hoje.slice(0, 10).split('-').map(Number);
  return Math.round((Date.UTC(a1, m1 - 1, d1) - Date.UTC(a2, m2 - 1, d2)) / 86400000);
}

type TomTexto = 'perigo' | 'aviso' | 'verde' | 'suave';

function textoPrazo(dias: number): { texto: string; tom: TomTexto } {
  if (dias < 0) {
    const atraso = -dias;
    return { texto: `Atrasada há ${atraso} ${atraso === 1 ? 'dia' : 'dias'}`, tom: 'perigo' };
  }
  if (dias === 0) return { texto: 'Vence hoje', tom: 'aviso' };
  return { texto: dias === 1 ? 'Falta 1 dia' : `Faltam ${dias} dias`, tom: 'suave' };
}

// ---------- Blocos ----------

function CartaoEmpresa({
  titulo,
  icone,
  verTodos,
  children,
}: {
  titulo: string;
  icone: NomeIcone;
  verTodos?: { rotulo: string; caminho: string };
  children?: ReactNode;
}) {
  return (
    <section className="empresa-cartao">
      <header className="empresa-cartao-cabecalho">
        <Icone nome={icone} tamanho={20} className="empresa-cartao-icone" />
        <h2 className="empresa-cartao-titulo">{titulo}</h2>
        {verTodos && (
          <Link className="empresa-ver-todos" to={verTodos.caminho}>
            {verTodos.rotulo}
            <Icone nome="seta-direita" tamanho={14} />
          </Link>
        )}
      </header>
      {children}
    </section>
  );
}

function ItemTitulo({ titulo, hoje, atrasado }: { titulo: TituloDTO; hoje: string; atrasado: boolean }) {
  const prazo = atrasado ? textoPrazo(-titulo.diasDeAtraso) : textoPrazo(diasEntre(titulo.vencimento, hoje));
  // Cor pela natureza: a pagar em laranja, a receber em verde.
  const cor = titulo.natureza === 'PAGAR' ? 'var(--cor-laranja)' : 'var(--cor-verde)';
  const caminho = titulo.natureza === 'PAGAR' ? '/app/empresa/pagar' : '/app/empresa/receber';
  return (
    <li>
      <Link className="empresa-item" to={caminho}>
        <span className="empresa-marca" style={{ background: cor }} aria-hidden="true" />
        <span className="empresa-item-texto">
          <span className="empresa-item-titulo">{titulo.descricao}</span>
          <span className="empresa-item-corpo">
            {titulo.parceiroNome ?? 'Sem cadastro'} · {formatarDia(titulo.vencimento)}
          </span>
        </span>
        <span className="empresa-item-direita">
          <span className="empresa-item-valor">{formatarReais(titulo.saldo)}</span>
          <span className={`empresa-prazo empresa-tom-${prazo.tom}`}>{prazo.texto}</span>
        </span>
      </Link>
    </li>
  );
}

// ---------- Painel da empresa (rota /app) ----------

export function PainelEmpresa() {
  const { atual } = useAcessoPerfil();
  const { dados, carregando, erro } = useDados<RespostaPainelEmpresa>('/empresa/painel');
  const nome = atual?.nome?.trim() ?? '';
  const saudacao = nome ? `Olá, ${nome}!` : 'Olá!';
  const hoje = hojeISO();

  const vencidoReceber = dados ? dados.vencidoAReceber : 0;
  const vencidoPagar = dados ? dados.vencidoAPagar : 0;
  const partesVencidos: string[] = [];
  if (vencidoReceber > 0) partesVencidos.push(`${formatarReais(vencidoReceber)} a receber`);
  if (vencidoPagar > 0) partesVencidos.push(`${formatarReais(vencidoPagar)} a pagar`);

  const dadosGrafico = dados?.meses ?? [];

  return (
    <section className="empresa-painel">
      <header className="empresa-cabecalho">
        <h1 className="empresa-saudacao">{saudacao}</h1>
        <p className="empresa-subtitulo">Aqui está um resumo das finanças da empresa.</p>
        <span className="empresa-traco" aria-hidden="true" />
      </header>

      {carregando && !dados && <Carregando />}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      {dados && (
        <>
          <div className="resumo">
            <ResumoItem icone="contas" cor="azul" valor={formatarReais(dados.saldoEmContas)} rotulo="Saldo em contas" />
            <ResumoItem icone="seta-cima" cor="verde" valor={formatarReais(dados.aReceber)} rotulo="A receber" />
            <ResumoItem icone="seta-baixo" cor="laranja" valor={formatarReais(dados.aPagar)} rotulo="A pagar" />
            <ResumoItem
              icone="grafico"
              cor={dados.resultadoDoMes >= 0 ? 'verde' : 'vermelho'}
              valor={formatarReais(dados.resultadoDoMes)}
              rotulo="Resultado do mês"
            />
          </div>

          {partesVencidos.length > 0 && (
            <div className="empresa-alerta" role="status">
              <Icone nome="sino" tamanho={20} />
              <span className="empresa-alerta-texto">Há contas vencidas: {partesVencidos.join(' e ')}.</span>
              <Link className="empresa-pilula" to="/app/empresa/vencidos">
                Ver vencidos
                <Icone nome="seta-direita" tamanho={14} />
              </Link>
            </div>
          )}

          <CartaoEmpresa titulo="Receitas e despesas" icone="grafico">
            <p className="empresa-nota">Últimos 6 meses, pelo que foi pago ou recebido.</p>
            {dadosGrafico.length === 0 ? (
              <p className="empresa-vazio-texto">Sem movimento para mostrar.</p>
            ) : (
              <GraficoBarras
                rotulos={dadosGrafico.map((m) => rotuloCurtoMes(m.mes))}
                series={[
                  { nome: 'Receitas', cor: 'var(--cor-verde)', valores: dadosGrafico.map((m) => m.receitas) },
                  { nome: 'Despesas', cor: 'var(--cor-perigo)', valores: dadosGrafico.map((m) => m.despesas) },
                ]}
                formato={formatarCompacto}
                altura={240}
                descricao="Receitas e despesas dos últimos 6 meses"
              />
            )}
          </CartaoEmpresa>

          <div className="empresa-colunas">
            <CartaoEmpresa titulo="Próximos vencimentos" icone="calendario">
              {dados.proximos.length === 0 ? (
                <Vazio icone="calendario" titulo="Nada em aberto" texto="Não há contas a pagar ou a receber em aberto." />
              ) : (
                <ul className="empresa-lista">
                  {dados.proximos.map((t) => (
                    <ItemTitulo key={t.id} titulo={t} hoje={hoje} atrasado={false} />
                  ))}
                </ul>
              )}
            </CartaoEmpresa>

            <CartaoEmpresa
              titulo="Mais atrasados"
              icone="sino"
              verTodos={{ rotulo: 'Ver vencidos', caminho: '/app/empresa/vencidos' }}
            >
              {dados.vencidos.length === 0 ? (
                <Vazio icone="sino" titulo="Nenhuma conta vencida" texto="Tudo em dia por enquanto." />
              ) : (
                <ul className="empresa-lista">
                  {dados.vencidos.map((t) => (
                    <ItemTitulo key={t.id} titulo={t} hoje={hoje} atrasado />
                  ))}
                </ul>
              )}
            </CartaoEmpresa>
          </div>

          <CartaoEmpresa titulo="Atalhos" icone="raio">
            <div className="empresa-atalhos">
              {ATALHOS.map((a) => (
                <Link key={a.rotulo} to={a.caminho} className="empresa-atalho">
                  <Icone nome={a.icone} tamanho={22} />
                  <span>{a.rotulo}</span>
                </Link>
              ))}
            </div>
          </CartaoEmpresa>
        </>
      )}
    </section>
  );
}
