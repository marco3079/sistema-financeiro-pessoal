# g02 — Lançamentos e categorias (servidor)

Leia antes: `docs/plano/CONTRATOS.md` (inteiro), `server/prisma/schema.prisma` (models `Transacao`, `Categoria`, `Conta`, `Fatura`),
`server/src/lib/financas.ts`, `server/src/lib/erros.ts`.

## Arquivos que você pode criar (só estes)

- `server/src/modules/transacoes/routes.ts`

Implemente exatamente as rotas da seção "transacoes e categorias" de CONTRATOS.md, todas neste arquivo.

## Categorias

1. `GET /categorias`: filtro opcional `tipo` (`RECEITA`/`DESPESA`); `orderBy: [{ tipo: 'asc' }, { nome: 'asc' }]`; `map(categoriaDTO)`.
2. `POST /categorias`: `{ nome: textoCurto, tipo: z.enum(['RECEITA','DESPESA']), cor: corSchema.optional() }` → `201`.
   Nome repetido no mesmo tipo já vira 409 sozinho (erro P2002 do Prisma): não trate.
3. `PUT /categorias/:id`: `{ nome?: textoCurto, cor?: corSchema }` → DTO.
4. `DELETE /categorias/:id` → `204`.

## Lançamentos

Constante: `const TIPOS = ['RECEITA', 'DESPESA'] as const;`

### `GET /transacoes`

Monte `where: Prisma.TransacaoWhereInput`:

- período: se `mes` (valide com `mesSchema.safeParse`) → `data: { gte: inicio, lt: fim }` de `intervaloDoMes(mes)`.
  Senão, se `de` e/ou `ate` (valide com `dataSchema.safeParse`) → `data: { gte: paraData(de), lte: paraData(ate) }` (só as partes presentes).
  Valor inválido → `HttpError(400, 'Período inválido')`.
- `contaId`, `faturaId`: `inteiroQuery`. `categoriaId`: `inteiroQuery`; se for `0` → `categoriaId: null`; senão o número.
- `tipo`: só se for `RECEITA` ou `DESPESA`.
- `busca`: `descricao: { contains: busca, mode: 'insensitive' }`.

Paginação: `pagina = inteiroQuery(req.query.pagina) ?? 1` (mínimo 1); `porPagina = Math.min(inteiroQuery(req.query.porPagina) ?? 50, 200)` (mínimo 1).

Em paralelo (`Promise.all`):

- `prisma.transacao.findMany({ where, include: INCLUIR_NA_TRANSACAO, orderBy: [{ data: 'desc' }, { id: 'desc' }], skip: (pagina - 1) * porPagina, take: porPagina })`
- `prisma.transacao.count({ where })`
- `prisma.transacao.groupBy({ by: ['tipo'], where: { ...where, transferencia: false }, _sum: { valor: true } })`

Resposta: `{ itens: lista.map(transacaoDTO), total, receitas, despesas }` (somas com `num(...)`, 0 quando não houver).

### `POST /transacoes`

Schema: `contaId: z.number().int().positive()`, `data: dataSchema`, `descricao: textoCurto`,
`valor: dinheiroSchema.refine((v) => v > 0, 'O valor deve ser maior que zero')`, `tipo: z.enum(TIPOS)`,
`categoriaId: z.number().int().positive().nullable().optional()`, `transferencia: z.boolean().optional()`,
`observacao: textoOpcional`, `totalParcelas: z.number().int().min(2).max(48).optional()`.

Passos:

1. Busque a conta (404 `'Conta não encontrada'`). Se `conta.origem === 'OPEN_FINANCE'` →
   `HttpError(400, 'Esta conta vem do Open Finance: os lançamentos dela chegam sozinhos pela sincronização.')`.
2. Se `categoriaId` vier, confira que a categoria existe (400 `'Categoria não encontrada'`).
3. `totalParcelas` só vale se `conta.tipo === 'CARTAO'` e `tipo === 'DESPESA'`; fora disso, ignore (trate como sem parcelas).
4. Dentro de `prisma.$transaction(async (db) => { ... })`:
   - Sem parcelas: uma transação com o valor cheio. Com parcelas (N): N transações, uma por mês a partir de `data`
     (parcela k tem a data do mesmo dia k−1 meses depois; use `new Date(Date.UTC(ano, mes + k - 1, dia))` limitando o dia ao último
     dia do mês), `valor` de cada uma = `arredondar(valor / N)` e a ÚLTIMA recebe o resto para a soma fechar exatamente em `valor`;
     `parcela: k`, `totalParcelas: N`, descrição igual em todas.
   - Para cada transação criada em conta `CARTAO`: `faturaId = await garantirFatura(db, conta, dataDaParcela)`.
   - Crie com `db.transacao.create({ data: {...}, include: INCLUIR_NA_TRANSACAO })`.
   - Some ao saldo da conta o efeito de TODAS as parcelas: `db.conta.update({ where: { id }, data: { saldo: { increment: efeitoNoSaldo(conta.tipo, tipo, valor) } } })`
     (uma vez, com o valor total).
   - Para cada `faturaId` distinto usado: `await recalcularFatura(db, faturaId)`.
   - Devolva a primeira transação criada.
5. Depois da transação do banco: `await registrarPosicaoPatrimonio()`. Responda `201` com `transacaoDTO(primeira)`.

### `PUT /transacoes/:id`

Schema (tudo opcional): `data: dataSchema`, `descricao: textoCurto`, `valor` (mesma regra > 0), `tipo: z.enum(TIPOS)`,
`categoriaId: z.number().int().positive().nullable()`, `transferencia: z.boolean()`, `observacao: textoOpcional`.

1. Busque a transação com `include: { conta: true }` (404 `'Lançamento não encontrado'`).
2. Se `transacao.origem === 'OPEN_FINANCE'` e o corpo tiver qualquer chave além de `categoriaId`, `observacao`, `transferencia` →
   `HttpError(400, 'Este registro vem do Open Finance e é atualizado automaticamente.')`.
3. Se `categoriaId` vier não nulo, confira que existe (400).
4. Em `$transaction`:
   - Se a origem é `MANUAL` e mudou `valor` ou `tipo`: desfaça o efeito antigo e aplique o novo no saldo da conta:
     `increment: efeitoNoSaldo(conta.tipo, novoTipo, novoValor) - efeitoNoSaldo(conta.tipo, tipoAntigo, valorAntigo)`.
   - Se a origem é `MANUAL`, a conta é `CARTAO` e mudou `data`: `novaFaturaId = await garantirFatura(db, conta, novaData)`.
   - Atualize só as chaves presentes; use `include: INCLUIR_NA_TRANSACAO`.
   - Recalcule as faturas afetadas (a antiga e a nova, se houver): `recalcularFatura`.
5. `await registrarPosicaoPatrimonio()`. Responda `transacaoDTO`.

### `DELETE /transacoes/:id`

1. Busque com `include: { conta: true }` (404). `OPEN_FINANCE` → 400 (mensagem da regra de ouro).
2. Em `$transaction`: apague; `saldo: { increment: -efeitoNoSaldo(conta.tipo, t.tipo, num(t.valor)) }`; se tinha `faturaId`, `recalcularFatura`.
3. `await registrarPosicaoPatrimonio()`. `204`.

## Aceite

- `cd server && npx tsc --noEmit` sem erros no seu arquivo. Nenhum `any`.
- Rotas fixas antes das rotas com `:id`.
