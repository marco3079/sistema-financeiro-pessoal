# g17 — Tela Análise (dashboard de gastos e ganhos com sugestões)

## Objetivo

Tela nova `/app/analise`: um painel de gastos e ganhos mês a mês, por categoria e por estabelecimento, com uma lista de sugestões calculadas pelo servidor para três áreas: gastos, receitas e investimentos. A API já existe; você só faz a tela.

Leia antes: `client/src/modules/importar/Historico.tsx`, `client/src/modules/cartoes/Cartoes.tsx`, `client/src/ui/index.tsx` (`Pagina`, `Cartao`, `Tabela`, `Abas`, `Selecao`, `Selo`, `Aviso`, `Carregando`), `client/src/ui/financas.tsx` (`ResumoItem`, `Rosca` e o tipo `Fatia`, `Vazio`, `PontoCor`, `NomeComCor`, `Valor`), `client/src/lib/financas.ts` (`formatarReais`, `rotuloMes`, `rotuloDe`, `TIPOS_INVESTIMENTO`), `client/src/ui/icones.tsx`.

## Arquivos (só estes)

- criar `client/src/modules/analise/index.tsx`
- criar `client/src/modules/analise/Analise.tsx`
- criar `client/src/modules/analise/tipos.ts`
- criar `client/src/modules/analise/analise.css`

## Rota (`index.tsx`)

```tsx
export const rotas: RotaModulo[] = [
  { caminho: '/app/analise', rotulo: 'Análise', icone: 'transacoes', perfis: ['TITULAR'], elemento: <Analise />, ordem: 22 },
];
```

## API: `GET /analise?meses=N` (N = 3, 6, 12 ou 24; padrão 12)

`tipos.ts` (copie exatamente):

```ts
import type { TipoInvestimento } from '../../lib/financas';

export interface MesAnalise { mes: string; receitas: number; despesas: number; saldo: number } // mes = 'AAAA-MM'

export interface CategoriaAnalise {
  id: number | null;         // null = "Sem categoria"
  nome: string;
  cor: string;
  total: number;             // no período
  parte: number;             // % do total do período
  mediaMensal: number;
  noMes: number;             // mês corrente
  naReferencia: number;      // último mês fechado
  mediaAnterior: number | null;
  variacao: number | null;   // % do último mês fechado contra a média dos anteriores
}

export type AreaSugestao = 'GASTOS' | 'RECEITAS' | 'INVESTIMENTOS';

export interface Sugestao {
  area: AreaSugestao;
  tom: 'alerta' | 'dica' | 'bom';
  titulo: string;
  texto: string;
  caminho: string | null;    // rota interna, ex.: '/app/orcamento'
  acao: string | null;       // texto do link
}

export interface AnaliseDTO {
  meses: MesAnalise[];       // em ordem crescente; o último é o mês corrente
  referencia: string | null; // 'AAAA-MM' do último mês fechado com dados
  resumo: {
    receitaMedia: number;
    despesaMedia: number;
    sobraMedia: number;
    taxaDePoupanca: number | null; // %
    receitasNoMes: number;
    despesasNoMes: number;
    parceladoNoMes: number;
    aindaParcelado: number;
    recorrenteMensal: number;
    semCategoria: number;
  };
  despesasPorCategoria: CategoriaAnalise[];
  receitasPorCategoria: CategoriaAnalise[];
  maioresGastos: { descricao: string; total: number; vezes: number }[];
  recorrentes: { descricao: string; valorMensal: number; meses: number }[];
  investimentos: {
    saldo: number;
    emConta: number;
    patrimonio: number;
    classes: { tipo: TipoInvestimento; saldo: number; parte: number }[];
    proventosMensais: number;
    mesesDeReserva: number | null;
  };
  sugestoes: Sugestao[];
}
```

## O que a tela mostra, nesta ordem

`<Pagina titulo="Análise" acoes={<Selecao rotulo="Período" valor={String(meses)} aoMudar={...} opcoes={[{valor:'3',rotulo:'3 meses'},{valor:'6',rotulo:'6 meses'},{valor:'12',rotulo:'12 meses'},{valor:'24',rotulo:'24 meses'}]} />}>`

Estado `meses` (número, inicial 12); `useDados<AnaliseDTO>('/analise?meses=' + meses)`. Confira a assinatura real de `Selecao` em `ui/index.tsx`.

1. `erro` → `<Aviso tipo="erro">`; `!dados && carregando` → `<Carregando />`.
2. `<div className="resumo">` com quatro `ResumoItem`:
   - `icone="seta-cima" cor="verde"` valor `formatarReais(resumo.receitaMedia)` rótulo `Receita média por mês`
   - `icone="seta-baixo" cor="vermelho"` valor `formatarReais(resumo.despesaMedia)` rótulo `Gasto médio por mês`
   - `icone="financeiro" cor="azul"` valor `formatarReais(resumo.sobraMedia)` rótulo `Sobra média por mês`
   - `icone="metas" cor="roxo"` valor `resumo.taxaDePoupanca === null ? '—' : resumo.taxaDePoupanca.toLocaleString('pt-BR') + '%'` rótulo `Do que entra, você guarda`
   Confira em `icones.tsx` e em `ResumoItem` se esses nomes de ícone e de cor existem; troque pelos que existirem.
3. `<Cartao titulo="Sugestões">`: `Abas` (confira a assinatura real em `ui/index.tsx`) com três abas: `Gastos`, `Receitas`, `Investimentos`, cada uma com a contagem entre parênteses (`Gastos (4)`). Dentro, a lista das sugestões daquela área, cada uma num bloco `analise-sugestao analise-sugestao-{tom}`: uma faixa colorida à esquerda (alerta = cor de perigo/laranja do tema, dica = `var(--cor-primaria)`, bom = verde do tema — procure os nomes reais das variáveis em `client/src/ui/estilo.css`), um `Selo` (`Atenção` / `Sugestão` / `Bom sinal`; confira as cores aceitas por `Selo`), o `titulo` em negrito, o `texto`, e, quando `caminho` e `acao` não são null, um `<Link to={caminho}>` (de `react-router-dom`) com o texto de `acao`. Área sem sugestão: texto suave `Nenhuma sugestão por enquanto.`
4. `<Cartao titulo="Receitas e gastos por mês">`: gráfico de barras feito com `div` (sem biblioteca): para cada mês de `dados.meses`, um grupo com duas barras verticais lado a lado (receitas com o verde do tema, despesas com o vermelho do tema), altura proporcional ao maior valor entre todas as receitas e despesas (mínimo 2 px quando o valor > 0), rótulo do mês embaixo (`rotuloMes(m.mes)`; se ficar apertado use só os 3 primeiros caracteres). Contêiner `analise-barras` com `display: flex; align-items: flex-end; gap: 0.5rem; height: 200px; overflow-x: auto`. Cada grupo tem `title` (tooltip nativo) com `Receitas R$ X · Gastos R$ Y · Saldo R$ Z` e um texto equivalente só para leitor de tela. Legenda embaixo (`Receitas`, `Gastos`). Abaixo, `Tabela<MesAnalise>` com colunas `Mês`, `Receitas` (direita), `Gastos` (direita), `Saldo` (direita, com classe `analise-positivo`/`analise-negativo` pelo sinal), em ordem do mês mais recente para o mais antigo.
5. `<div className="fin-duas-colunas">` (classe que já existe) com dois cartões:
   - `<Cartao titulo="Gastos por categoria">`: `Rosca` com as 8 maiores categorias (o resto somado como `Outras`) e, embaixo, `Tabela<CategoriaAnalise>`: `Categoria` (`NomeComCor`), `Total` (direita), `%` (direita, `parte` + `%`), `Média/mês` (direita), `Último mês fechado` (direita, `naReferencia`), `Variação` (direita: `variacao === null ? '—' : (variacao > 0 ? '+' : '') + variacao.toLocaleString('pt-BR') + '%'`, com classe `analise-negativo` quando > 0 — gasto subir é ruim — e `analise-positivo` quando < 0).
   - `<Cartao titulo="Receitas por categoria">`: mesma `Rosca` + tabela (`Categoria`, `Total`, `%`, `Média/mês`). Vazio: texto suave `Nenhuma receita no período. Importe o extrato da conta em Importar.`
6. `<div className="fin-duas-colunas">` com:
   - `<Cartao titulo="Onde você mais gasta">`: `Tabela` de `maioresGastos`: `Estabelecimento`, `Compras` (direita, `vezes`), `Total` (direita).
   - `<Cartao titulo="Gastos que se repetem">`: texto suave `Mesma descrição em 3 meses ou mais, com valor parecido: assinaturas e mensalidades. Somam {formatarReais(resumo.recorrenteMensal)} por mês.` e `Tabela` de `recorrentes`: `Descrição`, `Meses` (direita), `Por mês` (direita). `vazio="Nenhum gasto repetido encontrado."`
7. `<Cartao titulo="Investimentos e reserva">`: `<div className="resumo">` com `Investido` (`investimentos.saldo`), `Em conta` (`emConta`), `Proventos por mês` (`proventosMensais`), `Reserva` (`mesesDeReserva === null ? '—' : mesesDeReserva.toLocaleString('pt-BR') + ' meses de gastos'`); depois `Rosca` das classes (rótulo `rotuloDe(TIPOS_INVESTIMENTO, c.tipo)`, cor de `COR_TIPO_INVESTIMENTO[c.tipo]` de `lib/financas`) e um `<Link to="/app/rendimento">Comparar com Selic, IPCA, Ibovespa e IFIX</Link>`. Sem investimentos (`classes.length === 0`): texto suave `Nenhum investimento cadastrado.`
8. Estado vazio geral: quando todos os meses têm receitas e despesas iguais a 0, mostre no lugar das seções 4 a 6 um `<Vazio icone="transacoes" titulo="Ainda não há lançamentos" texto="Importe a fatura do cartão e o extrato da conta para ver a análise." />` (as seções 3 e 7 continuam).

## CSS (`analise.css`)

- `.analise-positivo` / `.analise-negativo`: cores de sucesso e de perigo do tema (procure os nomes reais em `client/src/ui/estilo.css`).
- `.analise-sugestao`: `display: flex; flex-direction: column; gap: 0.35rem; padding: 0.85rem 1rem; border: 1px solid var(--cor-borda); border-left-width: 4px; border-radius: var(--raio); background: var(--cor-superficie);` e a cor da borda esquerda pelo tom. Lista com `gap: 0.75rem`.
- Barras: largura de cada barra `14px`, `border-radius: 4px 4px 0 0`; grupo com `min-width: 44px`.
- Só variáveis do tema, sem `!important`, sem hexadecimal fixo.

## Critérios de aceite

- `cd client && npx tsc --noEmit` sem erros nos seus arquivos.
- Sem `any`, sem `// @ts-ignore`, sem biblioteca nova.
- Não quebra com listas vazias nem com `null`.
- Tema claro e escuro; sem rolagem horizontal da página em 360 px.
- Nenhum arquivo além dos quatro listados foi alterado.
