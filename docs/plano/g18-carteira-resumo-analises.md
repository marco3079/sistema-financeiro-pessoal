# g18 — Carteira: abas Resumo e Análises

## Objetivo

Duas abas da tela nova `/app/carteira`. A página (`Carteira.tsx`), os tipos (`tipos.ts`), os estilos comuns (`carteira.css`) e os gráficos (`client/src/ui/graficos.tsx`) JÁ existem e foram feitos pelo main: você só cria os dois componentes de aba. Os dados chegam prontos por `props`; você não chama a API.

Leia antes, inteiros: `client/src/modules/carteira/tipos.ts`, `client/src/modules/carteira/Carteira.tsx`, `client/src/modules/carteira/carteira.css`, `client/src/ui/graficos.tsx`. Leia também `client/src/ui/index.tsx` (`Cartao`, `Tabela`, `Abas`), `client/src/ui/financas.tsx` (`ResumoItem`, `Rosca`, `Fatia`, `PontoCor`), `client/src/lib/financas.ts` (`formatarReais`, `formatarDia`, `rotuloMes`).

## Arquivos (só estes)

- criar `client/src/modules/carteira/AbaResumo.tsx`
- criar `client/src/modules/carteira/AbaAnalises.tsx`
- criar `client/src/modules/carteira/abas-resumo-analises.css` (importado pelos dois)

Não edite nenhum outro arquivo.

## Ferramentas que já existem

- `GraficoLinhas` e `GraficoBarras` de `../../ui/graficos` — props: `rotulos: string[]`, `series: { nome, cor, valores: (number|null)[] }[]`, `formato: (v: number) => string`, `altura?: number`, `descricao: string` (texto para leitor de tela); `GraficoLinhas` aceita ainda `area` (boolean).
- `CORES_SERIE` de `../../ui/graficos`: `carteira`, `cdi`, `ibov`, `ipca`, `ifix`.
- De `./tipos`: `pct(v)` ("+1,23%" / "—"), `classeDoSinal(v)` (`cart-positivo` / `cart-negativo` / ''), `mesCurto('2026-11')` ("Nov/26"), `diaCurto('2026-11-12')` ("12/11/26").
- Classes de `carteira.css`: `cart-dupla`, `cart-tripla`, `cart-destaque` (+ `cart-destaque-bom` / `cart-destaque-ruim`), `cart-destaque-rotulo`, `cart-destaque-valor`, `cart-suave`, `cart-positivo`, `cart-negativo`.
- Formato de percentual para o eixo dos gráficos: `const eixoPct = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';`
- Formato de dinheiro curto para o eixo: `const eixoReais = (v: number) => Math.abs(v) >= 1000 ? 'R$ ' + (v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil' : formatarReais(v);`

## `AbaResumo.tsx`

`export function AbaResumo({ dados }: { dados: CarteiraDTO }): JSX.Element`

De cima para baixo:

1. `<div className="resumo">` com quatro `ResumoItem`: `Patrimônio` (`formatarReais(resumo.saldo)`, ícone `investimentos`, cor `azul`); `Rentabilidade no mês` (`pct(resumo.rentabilidadeNoMes)`, ícone `financeiro`, cor `roxo`); `Ganho de capital no mês` (sinal + `formatarReais(Math.abs(v))`, ícone `seta-cima` se >= 0 senão `seta-baixo`, cor `verde` ou `vermelho`); `Proventos recebidos` (`formatarReais(resumo.proventos)`, ícone `transacoes`, cor `laranja`). Confira em `icones.tsx` e em `ResumoItem` se os nomes existem; troque pelos que existirem.
2. `<div className="cart-dupla">` com dois cartões:
   - `<Cartao titulo="Desempenho no mês">`: três linhas grandes lado a lado (`resumo-desempenho`): `Carteira` → `pct(resumo.rentabilidadeNoMes)`, `CDI` → `pct(resumo.cdiNoMes)`, `Ibovespa` → `pct(resumo.ibovNoMes)`, cada valor com `classeDoSinal`. Abaixo, três barras horizontais comparando os três valores (largura proporcional ao maior valor absoluto, mínimo 2%; barra com a cor de `CORES_SERIE.carteira/cdi/ibov`; valores negativos crescem para a esquerda a partir de um eixo central — use um trilho com `display: grid; grid-template-columns: 1fr 1fr` e ponha a barra na metade esquerda ou direita). Por fim, texto suave: quando `percentualDoCdiNoMes !== null`, `A carteira rendeu {percentualDoCdiNoMes}% do CDI no mês.`; e sempre `Ganho de capital desde a compra: {sinal}{formatarReais(|resumo.ganhoDeCapital|)}` com `classeDoSinal`.
   - `<Cartao titulo="Distribuição">`: `Abas` com `Mercado` e `Instituições` (estado local). `Mercado`: um mapa de blocos (`resumo-blocos`: `display: flex; height: 220px; gap: 4px`) com um bloco por item de `dados.classes`, `flex-grow` igual a `parte` (mínimo 4), `min-width: 60px`, fundo `var(--cor-primaria)` com opacidade decrescente por posição (1, 0.75, 0.55, 0.4) aplicada com `color-mix(in srgb, var(--cor-primaria) X%, transparent)`, texto com `rotulo`, `parte` + `%` e `formatarReais(saldo)`. `Instituições`: o mesmo com `dados.instituicoes` (`nome`, `parte`, `saldo`). Texto branco só dentro do bloco de cor cheia; nos mais claros use `var(--cor-texto)`.
3. `<Cartao titulo="Histórico">`: `Abas` `Patrimônio` / `Rentabilidade`. `Patrimônio`: `GraficoLinhas` com `area`, `rotulos = dados.mensal.map((m) => mesCurto(m.mes))`, uma série `Patrimônio` (`CORES_SERIE.carteira`, valores `m.patrimonio`), `formato={eixoReais}`. `Rentabilidade`: `GraficoLinhas` com `rotulos = dados.diario.datas.map(diaCurto)` e cinco séries (`Carteira`, `CDI`, `Ibovespa`, `IPCA`, `IFIX`) de `dados.diario`, `formato={eixoPct}`. Abaixo do gráfico, texto suave: `Rentabilidade acumulada desde {formatarDia(dados.periodo.inicio)}, com proventos.`
4. `<Cartao titulo="Por instituição">`: `Tabela` de `dados.instituicoes`, `chave={(i) => i.nome}`, colunas `Instituição`, `Patrimônio` (direita), `Peso na carteira` (direita, `parte` com 2 casas + `%`), `Mês` / `Ano` / `Acumulada` (direita, `pct` com `classeDoSinal`).
5. `<Cartao titulo="Ganho de capital por mês">`: `GraficoBarras` com `rotulos` dos meses e uma série `Ganho de capital` (`CORES_SERIE.carteira`, valores `m.ganhoDeCapital`), `formato={eixoReais}`. Texto suave: `Variação do valor dos ativos em cada mês, sem contar aplicações, resgates e proventos.`

## `AbaAnalises.tsx`

```tsx
export function AbaAnalises(props: {
  dados: CarteiraDTO;
  classe: 'TODAS' | ClasseCarteira;
  aoMudarClasse: (classe: 'TODAS' | ClasseCarteira) => void;
}): JSX.Element
```

1. `Abas` com `Rentabilidade geral` (TODAS), `Renda variável` (RENDA_VARIAVEL), `Fundos` (FUNDOS), `Renda fixa` (RENDA_FIXA); `ativa={classe}`; `aoMudar` converte o id de volta para o tipo e chama `aoMudarClasse`.
2. Se `dados.resumo.ativos === 0`: `<p className="cart-suave">Nenhum ativo desta classe na carteira.</p>` e nada mais.
3. Um aviso recolhível (`<details className="analises-como">`) com `<summary>Como a rentabilidade é calculada</summary>` e o texto: `A rentabilidade mede só o desempenho dos ativos: valorização mais proventos recebidos. Aplicar ou resgatar dinheiro não muda o percentual. O preço de cada dia vem do fechamento da bolsa; ativos sem preço histórico (renda fixa, fundos) crescem de forma uniforme do valor aplicado até o saldo de hoje.`
4. `<div className="cart-tripla">` com três cartões pequenos, um para cada período `MES`, `SEIS_MESES` e `ANO` de `dados.periodos` (procure pelo campo `chave`): título = `rotulo`; dentro, três colunas `Carteira`, `CDI`, `Ibovespa` com `pct` e `classeDoSinal`.
5. `<div className="cart-dupla">`: dois blocos `cart-destaque`: `Pior dia` (`cart-destaque-ruim`; valor `formatarDia(extremos.piorDia.data)`; percentual `pct` com `classeDoSinal`) e `Melhor dia` (`cart-destaque-bom`). Quando o extremo é `null`, mostre `—`.
6. `<Cartao titulo="% por dia">`: `GraficoLinhas` com as cinco séries de `dados.diario` (igual ao da aba Resumo), `altura={320}`.
7. `<div className="cart-dupla">`: `Pior mês` / `Melhor mês` (valor `rotuloMes(extremos.piorMes.mes)`).
8. `<Cartao titulo="% por mês">`: `GraficoBarras` com `rotulos = mensal.map((m) => mesCurto(m.mes))` e cinco séries (`carteira`, `cdi`, `ibov`, `ipca`, `ifix` de cada mês), `formato={eixoPct}`.
9. `<div className="cart-dupla">`: `Pior ano` / `Melhor ano` (valor = o ano).
10. `<Cartao titulo="% por ano">`: `GraficoBarras` com `rotulos = anual.map((a) => String(a.ano))` e as cinco séries.

Crie uma função local `seriesComparadas(lista: Comparado[])` que devolve as cinco `SerieGrafico` com os nomes `Carteira`, `CDI`, `Ibovespa`, `IPCA`, `IFIX` e as cores de `CORES_SERIE`, para não repetir código.

## CSS

Só variáveis do tema; sem `!important`; sem hexadecimal (as cores das séries vêm de `CORES_SERIE` por `style`). Tudo tem de caber em 360 px sem rolagem horizontal da página.

## Critérios de aceite

- `cd client && npx tsc --noEmit` sem erros nos seus arquivos (erros por `AbaRelatorio` ou `AbaProventos` ainda não existirem são de outros geradores: ignore e diga que ignorou).
- Sem `any`, sem `// @ts-ignore`, sem biblioteca nova.
- Não quebra com listas vazias nem com `null` (`mensal` vazio, `extremos` nulos, `periodos` vazio).
- Nenhum arquivo além dos três listados foi alterado.
