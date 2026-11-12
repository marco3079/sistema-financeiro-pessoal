# g07 — Painel inicial, avisos e busca (servidor)

Leia antes: `docs/plano/CONTRATOS.md` (inteiro), `server/prisma/schema.prisma`, `server/src/lib/financas.ts`.
A tela do painel (`client/src/layout/Painel.tsx`) é feita pelo main: você só faz o servidor.

## Arquivos que você pode criar (só estes)

- `server/src/modules/painel/routes.ts`

Um `Router` (export default) com três rotas. Funções auxiliares ficam no mesmo arquivo.

## `GET /painel/resumo`

Resposta (formato exato; a tela já espera isto):

```ts
interface Cartao { chave: string; rotulo: string; valor: string; icone: string; cor: 'azul' | 'roxo' | 'verde' | 'laranja'; variacao: number | null }
interface Ponto { mes: string; rotulo: string; valor: number | null } // mes 'AAAA-MM', rotulo 'Nov'
interface Destaque { etiqueta: string; titulo: string; subtitulo: string; caminho: string }
interface Recente { id: number; titulo: string; corpo: string; valor: string; criadoEm: string }
interface Resposta { primeiroNome: string; cartoes: Cartao[]; desempenho: Ponto[]; destaque: Destaque | null; recentes: Recente[] }
```

Função local: `function variacao(atual: number, anterior: number): number | null { if (anterior <= 0) return null; return Math.round(((atual - anterior) / anterior) * 1000) / 10; }`

Passos:

1. `await atualizarStatusDasFaturas()`.
2. `primeiroNome`: `prisma.usuario.findUnique({ where: { id: req.usuario.id }, select: { nome: true } })` → primeira palavra do nome (ou `''`).
3. `t = await totaisPatrimonio()`.
4. Meses: `mes = mesAtual()`; lista dos 12 meses terminando no atual: `somarMeses(mes, -11)` até `mes`.
5. Posições: `prisma.posicaoPatrimonio.findMany({ where: { data: { gte: intervaloDoMes(somarMeses(mes, -11)).inicio } }, orderBy: { data: 'asc' } })`.
   Para cada mês, o valor é o patrimônio (`num(contas) + num(investimentos) - num(cartoes)`, com `arredondar`) da ÚLTIMA posição daquele mês
   (compare `mesDe(p.data)`), ou `null` se não houver. No mês atual, use sempre `t.patrimonio`.
   `desempenho = meses.map((m) => ({ mes: m, rotulo: rotuloMesCurto(m), valor }))`.
6. Despesas e receitas do mês atual e do anterior: dois `prisma.transacao.groupBy({ by: ['tipo'], where: { transferencia: false, data: { gte: inicio, lt: fim } }, _sum: { valor: true } })`.
7. `cartoes` (nesta ordem):
   - `{ chave: 'patrimonio', rotulo: 'Patrimônio', valor: moeda(t.patrimonio), icone: 'financeiro', cor: 'azul', variacao: variacao(t.patrimonio, <valor do mês anterior em desempenho, ou 0 se null>) }`
   - `{ chave: 'contas', rotulo: 'Saldo em contas', valor: moeda(t.contas), icone: 'contas', cor: 'verde', variacao: null }`
   - `{ chave: 'investimentos', rotulo: 'Investimentos', valor: moeda(t.investimentos), icone: 'investimentos', cor: 'roxo', variacao: null }`
   - `{ chave: 'despesas', rotulo: 'Despesas do mês', valor: moeda(despesasMes), icone: 'cartao', cor: 'laranja', variacao: variacao(despesasMes, despesasMesAnterior) }`
8. `destaque`:
   - Próxima fatura a pagar: `prisma.fatura.findFirst({ where: { status: { not: 'PAGA' }, total: { gt: 0 } }, orderBy: { vencimento: 'asc' }, include: { conta: { select: { nome: true } } } })`.
     Se existir: `{ etiqueta: f.status === 'ATRASADA' ? 'Fatura atrasada' : 'Próxima fatura', titulo: f.conta.nome + ' · ' + moeda(num(f.total)), subtitulo: 'Vencimento em DD/MM/AAAA', caminho: '/app/cartoes' }`
     (monte `DD/MM/AAAA` a partir de `dataISO(f.vencimento)`).
   - Senão, se `(await prisma.conexaoBancaria.count()) === 0`:
     `{ etiqueta: 'Open Finance', titulo: 'Conecte seu banco', subtitulo: 'Traga contas, faturas e investimentos automaticamente.', caminho: '/app/conexoes' }`.
   - Senão `null`.
9. `recentes`: as 6 últimas transações (`orderBy: [{ data: 'desc' }, { id: 'desc' }]`, `include: INCLUIR_NA_TRANSACAO`) →
   `{ id, titulo: descricao, corpo: conta.nome + ' · ' + (categoria?.nome ?? 'Sem categoria'), valor: (tipo === 'RECEITA' ? '+ ' : '- ') + moeda(num(valor)), criadoEm: t.criadoEm.toISOString() }`.

## `GET /notificacoes`

Resposta: `{ chave: string; titulo: string; meta: string; quando: string; caminho: string }[]` (no máximo 20), nesta ordem:

1. Conexões com problema: `prisma.conexaoBancaria.findMany({ where: { status: { in: ['ERRO_LOGIN', 'ERRO'] } } })` →
   `{ chave: 'conexao-' + id, titulo: 'Reconecte ' + instituicao, meta: erro ?? 'A conexão precisa de atenção', quando: (ultimaSincronizacao ?? criadoEm).toISOString(), caminho: '/app/conexoes' }`.
2. Faturas não pagas com `total > 0` e `vencimento` até 5 dias à frente (inclui atrasadas): `vencimento: { lte: new Date(hoje().getTime() + 5 * 86400000) }`,
   `orderBy: { vencimento: 'asc' }`, com a conta →
   `{ chave: 'fatura-' + id, titulo: vencimento < hoje() ? 'Fatura ' + conta.nome + ' atrasada' : 'Fatura ' + conta.nome + ' vence em DD/MM', meta: moeda(num(total)), quando: criadoEm.toISOString(), caminho: '/app/cartoes' }`.
3. Orçamentos estourados no mês atual: categorias com `orcamento` cujo gasto do mês (mesma conta do g06: `DESPESA`, `transferencia: false`, no mês) é maior que o limite →
   `{ chave: 'orcamento-' + categoriaId, titulo: 'Orçamento de ' + nome + ' estourado', meta: moeda(gasto) + ' de ' + moeda(limite), quando: hoje().toISOString(), caminho: '/app/orcamento' }`.

## `GET /busca?q=`

Resposta: `{ tipo: string; titulo: string; subtitulo: string; caminho: string }[]`.
`q = textoQuery(req.query.q)`; se ausente ou com menos de 2 caracteres → `[]`. Buscas `contains` com `mode: 'insensitive'`, em paralelo:

- Contas por `nome` ou `instituicao` (`take: 5`) → `{ tipo: tipo === 'CARTAO' ? 'Cartão' : 'Conta', titulo: nome, subtitulo: (instituicao ?? 'Conta') + ' · ' + moeda(num(saldo)), caminho: tipo === 'CARTAO' ? '/app/cartoes' : '/app/contas' }`.
- Investimentos por `nome` ou `codigo` (`take: 5`) → `{ tipo: 'Investimento', titulo: nome, subtitulo: moeda(num(saldo)), caminho: '/app/investimentos' }`.
- Lançamentos por `descricao` (`take: 6`, mais recentes primeiro) → `{ tipo: 'Lançamento', titulo: descricao, subtitulo: 'DD/MM/AAAA · ' + moeda(num(valor)), caminho: '/app/transacoes' }`.
- Categorias por `nome` (`take: 3`) → `{ tipo: 'Categoria', titulo: nome, subtitulo: tipo === 'RECEITA' ? 'Receita' : 'Despesa', caminho: '/app/categorias' }`.

Junte nessa ordem.

## Aceite

- `cd server && npx tsc --noEmit` sem erros no seu arquivo. Nenhum `any`.
