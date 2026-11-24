import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatarDia, formatarReais } from '../../lib/financas';
import { useDados } from '../../lib/useDados';
import { Abas, Aviso, Cartao, Carregando, Pagina, Tabela } from '../../ui';
import { ResumoItem, Vazio } from '../../ui/financas';
import './analise.css';

// Título como a API da empresa devolve (TituloDTO do servidor).
export interface TituloDTO {
  id: number;
  natureza: 'PAGAR' | 'RECEBER';
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

type Natureza = 'PAGAR' | 'RECEBER';

interface FaixaVencido {
  chave: 'ate30' | 'de31a60' | 'de61a90' | 'acima90';
  rotulo: string;
  quantidade: number;
  valor: number;
}

interface ParceiroVencido {
  parceiroId: number | null;
  parceiroNome: string;
  quantidade: number;
  valor: number;
  maiorAtraso: number;
}

interface RespostaVencidos {
  total: number;
  faixas: FaixaVencido[];
  porParceiro: ParceiroVencido[];
  titulos: TituloDTO[];
}

export function Vencidos() {
  const [natureza, setNatureza] = useState<Natureza>('RECEBER');
  const { dados, carregando, erro } = useDados<RespostaVencidos>('/empresa/vencidos?natureza=' + natureza);
  const pagar = natureza === 'PAGAR';
  const rotaLista = pagar ? '/app/empresa/pagar' : '/app/empresa/receber';

  return (
    <Pagina titulo="Inadimplência e vencidos">
      <Abas
        abas={[
          { id: 'RECEBER', rotulo: 'A receber (inadimplência)' },
          { id: 'PAGAR', rotulo: 'A pagar' },
        ]}
        ativa={natureza}
        aoMudar={(id) => setNatureza(id === 'PAGAR' ? 'PAGAR' : 'RECEBER')}
      />

      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {carregando && <Carregando />}

      {dados && (
        <>
          <div className="analise-resumo">
            <ResumoItem
              icone="financeiro"
              cor="vermelho"
              valor={formatarReais(dados.total)}
              rotulo={pagar ? 'Total vencido a pagar' : 'Total vencido a receber'}
            />
            {dados.faixas.map((f) => (
              <ResumoItem
                key={f.chave}
                icone="relogio"
                cor={f.chave === 'ate30' ? 'laranja' : 'vermelho'}
                valor={formatarReais(f.valor)}
                rotulo={`${f.rotulo} · ${f.quantidade} ${f.quantidade === 1 ? 'conta' : 'contas'}`}
              />
            ))}
          </div>

          {dados.titulos.length === 0 ? (
            <Cartao>
              <Vazio
                icone="visto"
                titulo={pagar ? 'Nenhuma conta a pagar vencida' : 'Nenhuma conta a receber vencida'}
                texto={pagar ? 'Tudo que você deve está em dia.' : 'Todos os seus clientes estão em dia.'}
              />
            </Cartao>
          ) : (
            <>
              <Cartao titulo={pagar ? 'Fornecedores com contas vencidas' : 'Clientes com contas vencidas'}>
                <Tabela<ParceiroVencido>
                  chave={(p) => p.parceiroId ?? 'sem-cadastro'}
                  dados={dados.porParceiro}
                  vazio="Nenhum registro encontrado."
                  colunas={[
                    { titulo: pagar ? 'Fornecedor' : 'Cliente', celula: (p) => p.parceiroNome },
                    { titulo: 'Títulos', alinhar: 'direita', celula: (p) => p.quantidade },
                    { titulo: 'Valor', alinhar: 'direita', celula: (p) => formatarReais(p.valor) },
                    { titulo: 'Maior atraso', alinhar: 'direita', celula: (p) => `${p.maiorAtraso} dias` },
                  ]}
                />
              </Cartao>

              <Cartao titulo="Contas vencidas">
                <Tabela<TituloDTO>
                  chave={(t) => t.id}
                  dados={dados.titulos}
                  vazio="Nenhum registro encontrado."
                  colunas={[
                    { titulo: 'Vencimento', celula: (t) => formatarDia(t.vencimento) },
                    { titulo: 'Atraso', celula: (t) => `${t.diasDeAtraso} dias` },
                    {
                      titulo: 'Descrição',
                      celula: (t) =>
                        t.parcela && t.totalParcelas ? `${t.descricao} (${t.parcela}/${t.totalParcelas})` : t.descricao,
                    },
                    { titulo: pagar ? 'Fornecedor' : 'Cliente', celula: (t) => t.parceiroNome ?? '—' },
                    { titulo: 'Saldo', alinhar: 'direita', celula: (t) => formatarReais(t.saldo) },
                  ]}
                />
                <Link className="analise-ver" to={rotaLista}>
                  {pagar ? 'Ver contas a pagar' : 'Ver contas a receber'}
                </Link>
              </Cartao>
            </>
          )}
        </>
      )}
    </Pagina>
  );
}
