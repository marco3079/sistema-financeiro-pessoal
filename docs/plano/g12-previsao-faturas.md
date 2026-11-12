# g12 — Próximas faturas (previsão com as parcelas que faltam)

## Objetivo

Componente React que mostra, na tela Cartões, quanto vai cair nas faturas dos próximos meses somando a fatura já lançada e as parcelas que ainda não foram cobradas. A API já existe e está pronta; você só faz a tela.

Projeto: `client/` é React 18 + TypeScript + Vite. Leia antes, para copiar o estilo: `client/src/modules/importar/Historico.tsx` (uso de `useDados`, `Cartao`, `Tabela`), `client/src/ui/index.tsx`, `client/src/ui/financas.tsx`, `client/src/lib/financas.ts`.

## Arquivos (só estes)

- criar `client/src/modules/cartoes/Previsao.tsx`
- criar `client/src/modules/cartoes/previsao.css`

Não edite nenhum outro arquivo. Outro gerador (g14) vai importar seu componente em `Cartoes.tsx`.

## Contrato do componente

```tsx
export function Previsao({ versao }: { versao: number }): JSX.Element | null
```

- `versao` muda quando a tela pai recarrega os dados: use `useEffect(() => { recarregar(); }, [versao, recarregar])`, igual ao `Historico.tsx`.
- Exportação nomeada `Previsao` (sem default).
- Quando a resposta não tem nenhum mês (`meses.length === 0`), devolve `null` (não mostra nada).

## API: `GET /cartoes/previsao` (use `useDados<PrevisaoDTO>('/cartoes/previsao')`)

Declare estes tipos dentro de `Previsao.tsx`:

```ts
interface ItemPrevisto { descricao: string; parcela: number; totalParcelas: number; valor: number }
interface MesCartao {
  mes: string;        // 'AAAA-MM' do vencimento
  vencimento: string; // 'AAAA-MM-DD'
  lancado: number;    // fatura que já existe e ainda não foi paga
  previsto: number;   // parcelas que ainda vão entrar
  total: number;      // lancado + previsto
  itens: ItemPrevisto[]; // só as parcelas previstas
}
interface CartaoPrevisao {
  contaId: number; nome: string; cor: string;
  meses: MesCartao[];
  parcelasRestantes: number; previsto: number; total: number;
}
interface MesGeral { mes: string; lancado: number; previsto: number; total: number }
interface PrevisaoDTO {
  cartoes: CartaoPrevisao[];
  meses: MesGeral[];          // soma de todos os cartões, em ordem crescente de mês
  parcelasRestantes: number;
  previsto: number;
  total: number;
}
```

## O que a tela mostra

Tudo dentro de `<Cartao titulo="Próximas faturas">` (de `../../ui`).

1. Uma linha de texto suave (`className="fin-suave"`): `Previsão com a fatura já lançada e as {parcelasRestantes} parcelas que ainda vão ser cobradas. Compras novas não entram.` Se `parcelasRestantes === 1`, escreva "a 1 parcela que ainda vai ser cobrada".
2. `<div className="resumo">` com três `ResumoItem` (de `../../ui/financas`):
   - `icone="cartao" cor="laranja"` valor `formatarReais(dados.total)` rótulo `Total a pagar`
   - `icone="transacoes" cor="azul"` valor `formatarReais(dados.previsto)` rótulo `Em parcelas futuras`
   - `icone="visto" cor="verde"` valor = rótulo do último mês (`rotuloMes(ultimo.mes)`) rótulo `Última parcela`
3. Gráfico de barras horizontais feito com `div` (sem biblioteca), um por mês de `dados.meses`:
   - classe do contêiner `previsao-barras`; cada linha `previsao-linha` com três partes: rótulo do mês (`rotuloMes(m.mes)`), a barra e o valor (`formatarReais(m.total)`).
   - a barra (`previsao-barra`) tem largura proporcional a `m.total / maiorTotal` (mínimo 2%) e é dividida em dois trechos: `previsao-barra-lancado` (largura `m.lancado / m.total`) e `previsao-barra-previsto` (o resto). Se `m.total` for 0, barra vazia.
   - legenda abaixo: dois quadradinhos com os textos `Já lançado na fatura` e `Parcelas previstas`.
4. Se houver mais de um cartão com meses, um `Selecao` (de `../../ui`) com rótulo `Cartão`, opções `{ valor: String(contaId), rotulo: nome }` de cada cartão que tenha `meses.length > 0`, valor inicial = primeiro deles. Com um cartão só, não mostra o seletor.
5. `Tabela<MesCartao>` (de `../../ui`) do cartão escolhido, `chave={(m) => m.mes}`, `vazio="Nenhuma parcela futura neste cartão."`, colunas:
   - `Vencimento` → `formatarDia(m.vencimento)`
   - `Já lançado` (alinhar direita) → `formatarReais(m.lancado)`
   - `Parcelas previstas` (alinhar direita) → `formatarReais(m.previsto)`
   - `Total` (alinhar direita) → `<strong>{formatarReais(m.total)}</strong>`
   - `Parcelas` → `m.itens.length`
   - `aoClicarLinha={(m) => setMesAberto(m.mes === mesAberto ? null : m.mes)}`
6. Quando há um mês aberto e ele tem `itens.length > 0`, abaixo da tabela um bloco `previsao-itens` com o título `Parcelas previstas para {rotuloMes(mes)}` e uma lista: cada item em uma linha com `descricao`, `Parcela {parcela} de {totalParcelas}` em texto suave e o valor (`formatarReais`) alinhado à direita.
7. Estados: `erro` → `<Aviso tipo="erro">{erro}</Aviso>`; `!dados && carregando` → `<Carregando />`.

Helpers que já existem em `client/src/lib/financas.ts`: `formatarReais`, `formatarDia`, `rotuloMes`.

## CSS (`previsao.css`, importado no topo de `Previsao.tsx`)

- Use só variáveis do tema: `var(--cor-texto)`, `var(--cor-texto-suave)`, `var(--cor-borda)`, `var(--cor-superficie)`, `var(--cor-primaria)`, `var(--raio)`. A cor do trecho "previsto" é `color-mix(in srgb, var(--cor-primaria) 45%, transparent)`; a do "lançado" é `var(--cor-primaria)`.
- `.previsao-linha`: grid de 3 colunas `minmax(70px, 110px) 1fr auto`, `gap: 0.75rem`, alinhado ao centro. Abaixo de 520 px o valor vai para baixo do rótulo (2 colunas).
- A barra tem `height: 14px`, `border-radius: 999px`, `overflow: hidden`, fundo `var(--cor-borda)` no trilho.
- Nada de cor fixa em hexadecimal, nada de `!important`.
- Espaço entre os blocos do cartão: envolva o conteúdo em `<div className="previsao">` com `display: flex; flex-direction: column; gap: 1rem`.

## Critérios de aceite

- `cd client && npx tsc --noEmit` sem erros.
- Sem `any`, sem `// @ts-ignore`, sem biblioteca nova.
- Funciona no tema claro e no escuro (só variáveis do tema) e em tela de 360 px sem rolagem horizontal.
- Nenhum arquivo além dos dois listados foi alterado.
