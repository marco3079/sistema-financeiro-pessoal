# g06 — Orçamento e metas (servidor e telas)

Leia antes: `docs/plano/CONTRATOS.md` (inteiro; seção "planejamento"), `server/prisma/schema.prisma` (models `Orcamento`, `Meta`,
`Categoria`, `Transacao`), `server/src/lib/financas.ts`, `client/src/lib/financas.ts`, `client/src/ui/financas.tsx`,
`client/src/modules/cadastros/usuarios.tsx` (modelo de tela).

## Arquivos que você pode criar (só estes)

- `server/src/modules/planejamento/routes.ts`
- `client/src/modules/planejamento/index.tsx`
- `client/src/modules/planejamento/Orcamento.tsx`
- `client/src/modules/planejamento/Metas.tsx`
- `client/src/modules/planejamento/planejamento.css`

## Servidor: `server/src/modules/planejamento/routes.ts`

### Orçamento

1. `GET /orcamentos`: `mes` = query `mes` validada com `mesSchema.safeParse` (inválida → `HttpError(400, 'Mês inválido')`), padrão `mesAtual()`.
   `{ inicio, fim } = intervaloDoMes(mes)`.
   - Gasto por categoria no mês: `prisma.transacao.groupBy({ by: ['categoriaId'], where: { tipo: 'DESPESA', transferencia: false, data: { gte: inicio, lt: fim } }, _sum: { valor: true } })`.
   - Categorias de despesa: `prisma.categoria.findMany({ where: { tipo: 'DESPESA' }, include: { orcamento: true }, orderBy: { nome: 'asc' } })`.
   - `itens`: categorias COM orçamento → `{ id: orcamento.id, categoriaId, categoriaNome, categoriaCor, limite, gasto, percentual: limite > 0 ? Math.round((gasto / limite) * 100) : 0 }`,
     ordenados por `percentual` desc.
   - `semOrcamento`: categorias SEM orçamento e com `gasto > 0` → `{ categoriaId, categoriaNome, categoriaCor, gasto }`, por `gasto` desc.
   - `totalLimite` = soma dos limites; `totalGasto` = soma dos gastos dos `itens`. Use `num` e `arredondar`.
   - Resposta: `{ mes, itens, totalLimite, totalGasto, semOrcamento }`.
2. `PUT /orcamentos/:categoriaId` (`idParam(req, 'categoriaId')`): corpo `{ limite: dinheiroSchema.refine((v) => v > 0, 'O limite deve ser maior que zero') }`.
   A categoria tem de existir e ser de `DESPESA` (404 `'Categoria não encontrada'` / 400 `'Só categorias de despesa têm orçamento'`).
   `prisma.orcamento.upsert({ where: { categoriaId }, create: { categoriaId, limite }, update: { limite } })`.
   Resposta `{ categoriaId, limite: num(o.limite) }`.
3. `DELETE /orcamentos/:categoriaId`: `prisma.orcamento.deleteMany({ where: { categoriaId } })`; `204`.

### Metas

Função local `metaDTO(m: Meta)`: `{ id, nome, valorAlvo: num, valorAtual: num, prazo: dataISOOuNula(m.prazo), cor, concluida,
percentual: valorAlvo > 0 ? Math.min(100, Math.round((valorAtual / valorAlvo) * 100)) : 0 }`.

1. `GET /metas`: `findMany()` e ordene em JS: não concluídas primeiro; depois por `prazo` crescente com `null` no fim; depois por `nome`.
2. `POST /metas`: `nome: textoCurto`, `valorAlvo: dinheiroSchema.refine((v) => v > 0, ...)`, `valorAtual: dinheiroSchema.optional()`,
   `prazo: dataSchema.nullable().optional()`, `cor: corSchema.optional()`. `201`.
3. `PUT /metas/:id`: os mesmos campos opcionais + `concluida: z.boolean()`. 404 `'Meta não encontrada'`. Só as chaves presentes.
   `prazo: null` limpa o prazo. Responda `metaDTO`.
4. `DELETE /metas/:id`: `204`.

## Cliente

`index.tsx`: duas rotas —
`/app/orcamento`, rótulo `Orçamento`, ícone `orcamento`, ordem `50`, elemento `<Orcamento />`;
`/app/metas`, rótulo `Metas`, ícone `metas`, ordem `52`, elemento `<Metas />`.

### `Orcamento.tsx` (export `Orcamento`)

Tipo local `RespostaOrcamento` igual ao contrato.

1. Estado `mes` (padrão `mesAtual()`). `useDados<RespostaOrcamento>('/orcamentos?mes=' + mes)` e `useDados<CategoriaDTO[]>('/categorias?tipo=DESPESA')`.
2. `<Pagina titulo="Orçamento" acoes={<SeletorMes mes={mes} aoMudar={setMes} />}>`; `barra-ferramentas` com `<div className="filtros" />` vazio e
   `<Botao>Definir limite</Botao>`.
3. `resumo` com 3 `ResumoItem`: `Limite do mês` (`orcamento`, azul, `formatarReais(totalLimite)`), `Gasto` (`seta-baixo`, laranja),
   `Disponível` (`visto` verde se ≥ 0; `fechar` vermelho se < 0; `formatarReais(totalLimite - totalGasto)`).
4. `<Cartao titulo="Limites por categoria">`: lista (`ul.planejamento-lista`); cada item: `<NomeComCor cor={categoriaCor}>{categoriaNome}</NomeComCor>`,
   texto `formatarReais(gasto) de formatarReais(limite)` + ` · ` + `percentual%` (em vermelho `var(--cor-perigo)` quando > 100),
   `<BarraProgresso percentual={percentual} cor={categoriaCor} />` e um `MenuAcoes` (`Alterar limite` `lapis`; `Remover limite` `lixeira` `perigo`).
   Sem itens: `<Vazio icone="orcamento" titulo="Nenhum limite definido" texto="Defina quanto você quer gastar por mês em cada categoria e acompanhe aqui." />`.
5. `<Cartao titulo="Gastos sem limite definido">` (só se `semOrcamento.length > 0`): `Tabela` com `Categoria` (`NomeComCor`), `Gasto no mês`
   (direita, `formatarReais`), `Ações` (`acoes: true`; `Botao variante="texto"` `Definir limite`, que abre o modal com a categoria escolhida).
6. Modal "Definir limite": `Selecao` `Categoria*` (categorias de despesa) e `Limite mensal (R$)*`; `api.put('/orcamentos/' + categoriaId, { limite })`.
   Se não houver categoria de despesa: `<Aviso tipo="info">Cadastre categorias de despesa em Categorias.</Aviso>`.

### `Metas.tsx` (export `Metas`)

1. `useDados<MetaDTO[]>('/metas')`.
2. `<Pagina titulo="Metas" acoes={<Botao>Nova meta</Botao>}>`.
3. `resumo` com 3 `ResumoItem`: `Metas em andamento` (`metas`, azul, quantidade não concluída), `Guardado` (`financeiro`, verde, soma de `valorAtual`),
   `Falta guardar` (`relogio`, laranja, soma de `Math.max(0, valorAlvo - valorAtual)` das não concluídas).
4. `<div className="fin-cartoes">`: um `<article className="planejamento-meta cartao">` por meta: nome (com `PontoCor`), selo verde `Concluída`
   quando `concluida`, `formatarReais(valorAtual) de formatarReais(valorAlvo)`, `<BarraProgresso percentual={percentual} cor={cor} />`, `percentual%`,
   prazo (`Prazo: ` + `formatarDia(prazo)` ou `Sem prazo`), e `MenuAcoes`: `Adicionar valor` (`somar`), `Editar` (`lapis`),
   `Marcar como concluída` / `Reabrir` (`visto`), `Excluir` (`lixeira`, `perigo`, `window.confirm`).
   Sem metas: `<Vazio icone="metas" titulo="Nenhuma meta ainda" texto="Crie uma meta (reserva de emergência, viagem, entrada do imóvel) e acompanhe quanto falta."><Botao>Nova meta</Botao></Vazio>`.
5. Modal "Nova meta"/"Editar meta": `Nome*`, `Valor alvo (R$)*`, `Já guardado (R$)`, `Prazo` (date, opcional; vazio → `null`), `<CampoCor />`.
6. Modal "Adicionar valor": `Valor a adicionar (R$)*` → `api.put('/metas/' + id, { valorAtual: meta.valorAtual + valor })`.

### `planejamento.css`

Só o necessário para a lista de limites (`planejamento-lista`, item em coluna com espaçamento) e o cartão de meta (`planejamento-meta`: coluna, `gap`).
Só variáveis de cor de `estilo.css`.

## Aceite

- `cd server && npx tsc --noEmit` e `cd client && npx tsc --noEmit` sem erros nos seus arquivos. Nenhum `any`. Nenhuma cor fixa em CSS.
