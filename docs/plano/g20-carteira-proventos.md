# g20 — Carteira: aba Proventos (Resumo e Agenda)

## Objetivo

Aba "Proventos" da tela `/app/carteira`, com duas visões: **Resumo** (o que já foi recebido) e **Agenda** (calendário do mês com o que foi recebido e o que é esperado). A página (`Carteira.tsx`), os tipos (`tipos.ts`), os estilos comuns (`carteira.css`) e os gráficos (`client/src/ui/graficos.tsx`) JÁ existem. Esta aba busca os próprios dados.

Leia antes, inteiros: `client/src/modules/carteira/tipos.ts` (tipos `ProventosDTO` e `ItemAgenda`), `client/src/modules/carteira/Carteira.tsx`, `client/src/modules/carteira/carteira.css`, `client/src/ui/graficos.tsx`. Leia também `client/src/modules/importar/Historico.tsx` (uso de `useDados`), `client/src/ui/index.tsx` (`Cartao`, `Tabela`, `Abas`, `Selecao`, `Campo`, `Aviso`, `Carregando`, `Selo`), `client/src/ui/financas.tsx` (`ResumoItem`, `Rosca`, `Fatia`, `Vazio`), `client/src/lib/financas.ts` (`formatarReais`, `formatarDia`, `rotuloMes`, `hojeISO`, `CORES_PALETA`).

## Arquivos (só estes)

- criar `client/src/modules/carteira/AbaProventos.tsx`
- criar `client/src/modules/carteira/aba-proventos.css`

## API

`GET /carteira/proventos?meses=N` (N = 12, 24, 60 ou 0 para tudo) → `ProventosDTO`. Use `useDados<ProventosDTO>('/carteira/proventos?meses=' + meses)`.

## Componente

`export function AbaProventos(): JSX.Element` (sem props)

Estado: `visao: 'resumo' | 'agenda'` (inicial `resumo`), `meses: string` (inicial `'24'`).

Topo: uma linha (`proventos-topo`, flex com quebra) com `Abas` (`Resumo`, `Agenda`) à esquerda e, só na visão Resumo, `Selecao` rótulo `Período` com `12 meses`, `24 meses`, `5 anos` (valor `60`), `Desde o início` (valor `0`) à direita.

Estados: `erro` → `<Aviso tipo="erro">`; `!dados && carregando` → `<Carregando />`. Quando `dados.porAtivo.length === 0 && dados.agenda.itens.length === 0`: `<Vazio icone="investimentos" titulo="Nenhum provento registrado" texto="Os dividendos e rendimentos aparecem aqui depois que você importa a planilha de movimentação da B3." />` e nada mais.

### Visão Resumo

1. `<div className="resumo">` com quatro `ResumoItem`: `Recebido no período` (`formatarReais(dados.total)`), `Média por mês` (`formatarReais(dados.mediaMensal)`), `Últimos 12 meses` (`formatarReais(dados.ultimosDozeMeses)`), `Rendimento sobre o custo (12 meses)` (`dados.rendimentoSobreOCusto === null ? '—' : dados.rendimentoSobreOCusto.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%'`). Escolha ícones e cores que existam em `icones.tsx` / `ResumoItem`.
2. `<Cartao titulo="Histórico de proventos">`: `GraficoBarras` com `rotulos = historico.map((h) => mesCurto(h.mes))`, uma série `Proventos` (`CORES_SERIE.carteira`), `formato` de dinheiro curto (`R$ 1,2 mil` acima de mil, senão `formatarReais`).
3. `<Cartao titulo="Mapa de calor mensal">`: texto suave `Quanto cada ativo pagou em cada um dos últimos 12 meses.` Uma `<table className="proventos-mapa">` dentro de `<div className="proventos-rolagem">` (`overflow-x: auto`): cabeçalho `Ativo` + um `th` por mês (`mesCurto`) + `Total`; uma linha por item de `mapa.linhas` (mostre as 15 primeiras e um botão de texto `Mostrar todos ({n})` / `Mostrar menos` quando houver mais); cada célula mostra o valor (sem `R$`, com 2 casas; vazio quando 0) e tem fundo `color-mix(in srgb, var(--cor-primaria) X%, transparent)`, com `X = Math.round((valor / maiorValorDaTabela) * 70)` (0 quando o valor é 0). Cada célula tem `title` com `{rotulo} · {mês por extenso}: {formatarReais(valor)}`. Última linha `Total` com a soma de cada coluna.
4. `<div className="cart-dupla">`:
   - `<Cartao titulo="Distribuição de proventos">`: `Rosca` com os 8 maiores de `porAtivo` (o resto somado em `Outros`), cores de `CORES_PALETA`.
   - `<Cartao titulo="Quem mais pagou">`: lista dos 5 primeiros de `porAtivo`: rótulo em negrito, `formatarReais(total)` e `parte` + `%` em texto suave.
5. `<Cartao titulo="Ativos">`: `Tabela` de `porAtivo`, `chave={(a) => a.id}`: `Ativo` (rótulo em negrito + nome em texto suave), `Recebido` (direita), `% do total` (direita), `Pagamentos` (direita), `Último pagamento` (`formatarDia(ultimaData)` e o valor em texto suave), `Rendimento sobre o custo` (direita, percentual com 2 casas ou `—`).

### Visão Agenda

1. `<Aviso tipo="info">Os valores marcados como previstos são estimativas: repetem o que cada ativo pagou nos últimos 12 meses. As datas e os valores reais só são conhecidos quando o fundo ou a empresa anuncia.</Aviso>`
2. `<div className="cart-tripla">` com três blocos `cart-destaque`: `Proventos este mês` (valor = `formatarReais(esteMes.recebido + esteMes.previsto)`; embaixo, texto suave `Recebido {R$} · Previsto {R$}`), `Próximos 3 meses` (`formatarReais(proximosTresMeses)`, texto suave `previsto`), `Próximos 12 meses` (`formatarReais(proximosDozeMeses)`).
3. `<Cartao titulo="Agenda mensal de proventos">` com duas colunas (`proventos-agenda`: grid `minmax(260px, 320px) 1fr`, uma coluna abaixo de 800 px):
   - Esquerda: navegação do mês (botões `‹` e `›` com `aria-label="Mês anterior"` / `"Próximo mês"`, e o nome do mês com `rotuloMes(mes)` entre eles; estado `mes` no formato `'AAAA-MM'`, inicial = mês de `hojeISO()`). Calendário: grade de 7 colunas com cabeçalho `Dom Seg Ter Qua Qui Sex Sáb`; os dias do mês nas posições certas (células vazias antes do dia 1). Cada dia é um `<button type="button">` com o número; dias com item recebido ganham a classe `proventos-dia-recebido`, com item previsto `proventos-dia-previsto`; hoje ganha `proventos-dia-hoje` (contorno); o dia selecionado ganha `aria-pressed="true"`. Clicar num dia filtra a lista da direita por aquele dia; clicar de novo desfaz. Cada botão tem `aria-label` como `12 de novembro: 3 pagamentos` (ou só a data quando não há). Abaixo do calendário, um bloco `Total do mês` com `formatarReais` da soma dos itens do mês e a legenda das duas marcações (`Recebido`, `Previsto`).
   - Direita: `Campo` rótulo `Buscar ativo` e a lista dos itens do mês exibido (filtrados pelo dia selecionado e pela busca), em ordem de data: cada linha com o dia (`DD/MM`), o `rotulo` em negrito, um `Selo` (`Recebido` cor `verde`, `Previsto` cor `amarelo` — confira as cores aceitas por `Selo`) e o valor à direita. Lista vazia: texto suave `Nenhum pagamento neste mês.` (ou `neste dia.` quando há dia selecionado).
   - Trocar de mês limpa o dia selecionado.

## CSS (`aba-proventos.css`)

Só variáveis do tema; sem `!important`; sem hexadecimal. Marcações do calendário: recebido = fundo `color-mix(in srgb, var(--cor-verde) 30%, transparent)`; previsto = borda tracejada `1px dashed var(--cor-aviso)`; hoje = `outline: 2px solid var(--cor-primaria)`. Botões do calendário quadrados (`aspect-ratio: 1`), `border-radius: 8px`, foco visível. Tabela do mapa: células com `white-space: nowrap`, `text-align: right`, primeira coluna à esquerda e fixa (`position: sticky; left: 0; background: var(--cor-superficie)`). Tudo cabe em 360 px sem rolagem horizontal da página.

## Critérios de aceite

- `cd client && npx tsc --noEmit` sem erros nos seus arquivos (erros por `AbaResumo`, `AbaAnalises` ou `AbaRelatorio` ainda não existirem são de outros geradores: ignore e diga que ignorou).
- Sem `any`, sem `// @ts-ignore`, sem biblioteca nova.
- O calendário põe o dia 1 no dia da semana certo (use `new Date(ano, mes - 1, 1).getDay()`) e tem o número certo de dias (`new Date(ano, mes, 0).getDate()`).
- Não quebra com listas vazias nem com `null`.
- Nenhum arquivo além dos dois listados foi alterado.
