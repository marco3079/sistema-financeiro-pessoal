# g19 — Carteira: aba Relatório

## Objetivo

Aba "Relatório" da tela `/app/carteira`: um resumo completo da carteira, pronto para imprimir ou salvar em PDF. A página (`Carteira.tsx`), os tipos (`tipos.ts`), os estilos comuns (`carteira.css`) e os gráficos (`client/src/ui/graficos.tsx`) JÁ existem. Os dados chegam por `props`; você não chama a API.

Leia antes, inteiros: `client/src/modules/carteira/tipos.ts`, `client/src/modules/carteira/Carteira.tsx`, `client/src/modules/carteira/carteira.css`, `client/src/ui/graficos.tsx`. Leia também `client/src/ui/index.tsx` (`Cartao`, `Tabela`, `Botao`, `Campo`), `client/src/ui/financas.tsx` (`Rosca`, tipo `Fatia`), `client/src/lib/financas.ts` (`formatarReais`, `formatarDia`, `CORES_PALETA`).

## Arquivos (só estes)

- criar `client/src/modules/carteira/AbaRelatorio.tsx`
- criar `client/src/modules/carteira/aba-relatorio.css`

## Ferramentas que já existem

- `GraficoLinhas` de `../../ui/graficos` (props `rotulos`, `series: { nome, cor, valores }[]`, `formato`, `altura?`, `descricao`) e `CORES_SERIE` (`carteira`, `cdi`, `ibov`, `ipca`, `ifix`).
- De `./tipos`: `pct`, `classeDoSinal`, `mesCurto`.
- Classes de `carteira.css`: `cart-dupla`, `cart-suave`, `cart-positivo`, `cart-negativo`.

## Componente

`export function AbaRelatorio({ dados }: { dados: CarteiraDTO }): JSX.Element`

Envolva tudo em `<div className="relatorio">`. De cima para baixo:

1. Barra de ações (`relatorio-acoes`, alinhada à direita): `<Botao variante="secundario" aoClicar={() => window.print()}>Imprimir ou salvar em PDF</Botao>`.
2. Faixa de números (`relatorio-faixa`: grid de 4 colunas que vira 2 abaixo de 700 px): `Saldo bruto` (`formatarReais(resumo.saldo)`), `Ganho de capital` (sinal + reais, com `classeDoSinal`), `Rentabilidade do início` (`pct(resumo.rentabilidadeDoInicio)` com `classeDoSinal`), `Ativos` (`resumo.ativos`). Cada item: rótulo pequeno suave em cima, valor em negrito embaixo.
3. `<Cartao titulo="Rentabilidade geral">`: `GraficoLinhas` com `rotulos = dados.mensal.map((m) => mesCurto(m.mes))` e cinco séries ACUMULADAS mês a mês. A da carteira é `m.acumulado`. As dos índices você acumula no cliente: comece em 1 e multiplique por `(1 + valorDoMes / 100)` a cada mês (valor `null` conta como 0); o ponto é `(acumulado - 1) * 100`. `formato` = percentual com 1 casa. Texto suave abaixo: `Acumulado desde {formatarDia(dados.periodo.inicio)}.`
4. `<div className="cart-dupla">`:
   - `<Cartao titulo="Rentabilidade por período">`: lista (`relatorio-lista`) com uma linha para cada item de `dados.periodos`, e dentro de cada linha o rótulo do período à esquerda e, à direita, quatro valores pequenos em colunas: `Carteira`, `CDI`, `IPCA`, `Ibovespa` (`pct` com `classeDoSinal`). Em telas estreitas as quatro colunas quebram para baixo do rótulo.
   - `<Cartao titulo="Retornos e estatísticas">`: lista de pares rótulo/valor com linha divisória: `Meses positivos`, `Meses negativos`, `Meses acima do CDI`, `Meses abaixo do CDI`, `Maior rentabilidade no mês` (`pct`), `Menor rentabilidade no mês` (`pct`), `Rentabilidade média por mês` (`pct`).
5. `<div className="cart-dupla">`:
   - `<Cartao titulo="Divisão por mercado">`: `Rosca` com `dados.classes` (rótulo, valor = saldo, cor de `CORES_PALETA[i % CORES_PALETA.length]`). Confira a assinatura real de `Rosca`/`Fatia` em `ui/financas.tsx`.
   - `<Cartao titulo="Divisão por instituição">`: `Rosca` com `dados.instituicoes`.
6. `<Cartao titulo="Rentabilidade por instituição">`: `Tabela` de `dados.instituicoes`: `Instituição`, `Patrimônio` (direita), `Peso na carteira` (direita), `Mês`, `Ano`, `Acumulada` (direita, `pct` + `classeDoSinal`).
7. `<Cartao titulo="Rentabilidade bruta">`: uma `<table className="relatorio-meses">` (tabela HTML simples, com `<caption className="tabela-oculto-visual">`): uma linha de cabeçalho `Período, Jan, Fev, ..., Dez, No ano`; para cada ano presente em `dados.mensal` (do mais recente para o mais antigo) DUAS linhas: a do ano (rentabilidade da carteira em cada mês, `pct` sem o sinal de mais e com `classeDoSinal`; `—` nos meses sem dado; `No ano` vem de `dados.anual` para aquele ano) e a linha `CDI` (os mesmos meses com `m.cdi`, texto suave). Envolva em `<div className="relatorio-rolagem">` com `overflow-x: auto`; células com `white-space: nowrap` e `text-align: right` (a primeira à esquerda).
8. `<Cartao titulo="Meus ativos">`: um `Campo` de busca (rótulo `Buscar ativo`) que filtra por `codigo` ou `nome` (sem diferenciar maiúsculas); `Tabela` com colunas `Ativo` (`codigo ?? nome` em negrito e o nome em texto suave quando há código), `Classe`, `Saldo` (direita), `Peso` (direita, `parte` + `%`), `Rent. acumulada` (direita, `pct` + `classeDoSinal`), `% do CDI` (direita; `percentualDoCdi === null ? '—' : percentualDoCdi.toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + '%'`), `Preço médio` (direita, `formatarReais` ou `—`), `Preço atual` (direita). Paginação de 10 em 10: abaixo da tabela, `relatorio-paginas` com `{inicio}–{fim} de {total}` e botões `Anterior` / `Próxima` (`Botao variante="texto"`, desabilitados nas pontas). Mudar a busca volta para a página 1. `vazio="Nenhum ativo encontrado."`

## Impressão (`aba-relatorio.css`)

```css
@media print {
  .casca-lateral, .casca-topo, .casca-topo-celular, .casca-navegacao-inferior, .abas, .pagina-acoes, .relatorio-acoes, .relatorio-paginas { display: none !important; }
  .casca-principal, .casca-area { margin: 0 !important; padding: 0 !important; }
  .cartao { break-inside: avoid; box-shadow: none; }
}
```

Antes de escrever, abra `client/src/layout/casca.css` e `client/src/layout/Layout.tsx` e use os nomes REAIS das classes da barra lateral, do topo e da navegação inferior do celular (os da lista acima são palpites). O `!important` é permitido só dentro deste `@media print`. Na impressão, a tabela "Meus ativos" mostra só a página atual (aceitável).

Fora da impressão: só variáveis do tema, sem `!important`, sem hexadecimal. Tudo cabe em 360 px sem rolagem horizontal da página.

## Critérios de aceite

- `cd client && npx tsc --noEmit` sem erros nos seus arquivos (erros por `AbaResumo`, `AbaAnalises` ou `AbaProventos` ainda não existirem são de outros geradores: ignore e diga que ignorou).
- Sem `any`, sem `// @ts-ignore`, sem biblioteca nova.
- Não quebra com listas vazias nem com `null`.
- Nenhum arquivo além dos dois listados foi alterado.
