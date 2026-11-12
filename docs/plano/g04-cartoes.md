# g04 — Cartões e faturas (servidor e tela)

Leia antes: `docs/plano/CONTRATOS.md` (inteiro; seções "cartoes e faturas" e "contas"), `server/prisma/schema.prisma`
(models `Conta`, `Fatura`, `Transacao`), `server/src/lib/financas.ts`, `client/src/lib/financas.ts`, `client/src/ui/financas.tsx`,
`client/src/modules/cadastros/usuarios.tsx` (modelo de tela).

As rotas `/contas` (g01) e `/transacoes` (g02) estão sendo feitas ao mesmo tempo: programe contra o contrato.

## Arquivos que você pode criar (só estes)

- `server/src/modules/cartoes/routes.ts`
- `client/src/modules/cartoes/index.tsx`
- `client/src/modules/cartoes/Cartoes.tsx`
- `client/src/modules/cartoes/DetalheFatura.tsx`
- `client/src/modules/cartoes/cartoes.css`

## Servidor: `server/src/modules/cartoes/routes.ts`

`const INCLUIR_CONTA = { conta: { select: { nome: true } } } as const;`

1. `GET /cartoes`: `await atualizarStatusDasFaturas()`; busque contas `{ tipo: 'CARTAO', ativo: true }` por `nome`.
   Para cada cartão, `faturaAtual` = a fatura NÃO paga (`status: { not: 'PAGA' }`) de menor `vencimento`
   (`findFirst` com `orderBy: { vencimento: 'asc' }`, `include: INCLUIR_CONTA`), ou `null`.
   `percentualUsado` = `limite` nulo ou zero → `null`; senão `Math.round((saldo / limite) * 100)`.
   Resposta: `[{ conta: contaDTO(c), faturaAtual: f ? faturaDTO(f) : null, percentualUsado }]`.
2. `GET /faturas`: `await atualizarStatusDasFaturas()`; filtro opcional `contaId` (`inteiroQuery`); `orderBy: { vencimento: 'desc' }`;
   `include: INCLUIR_CONTA`; `take: 60`; `map(faturaDTO)`.
3. `GET /faturas/:id`: fatura com `INCLUIR_CONTA` (404 `'Fatura não encontrada'`); transações
   `prisma.transacao.findMany({ where: { faturaId: id }, include: INCLUIR_NA_TRANSACAO, orderBy: [{ data: 'desc' }, { id: 'desc' }] })`.
   `porCategoria`: some `valor` das transações `DESPESA` com `transferencia === false`, agrupando por `categoriaId`
   (nome `categoria?.nome ?? 'Sem categoria'`, cor `categoria?.cor ?? '#64748b'`), ordenado por `total` desc, valores com `arredondar`.
   Resposta: `{ fatura: faturaDTO(f), transacoes: lista.map(transacaoDTO), porCategoria }`.
4. `POST /faturas/:id/pagar`: corpo `{ pagaEm: dataSchema.optional(), contaPagamentoId: z.number().int().positive().optional() }`.
   - Busque a fatura com `include: { conta: true }` (404). Se `fatura.origem === 'OPEN_FINANCE'` →
     `HttpError(400, 'Este registro vem do Open Finance e é atualizado automaticamente.')`. Se já `PAGA` → `HttpError(400, 'Esta fatura já está paga')`.
   - `dataPagamento = dados.pagaEm ? paraData(dados.pagaEm) : hoje()`; `total = num(fatura.total)`.
   - Se `contaPagamentoId` vier: busque a conta (400 `'Conta de pagamento não encontrada'`); ela tem de ser `MANUAL` e de tipo diferente de
     `CARTAO` (senão 400 `'Escolha uma conta manual que não seja cartão'`).
   - Em `prisma.$transaction(async (db) => { ... })`:
     a. `db.fatura.update({ where: { id }, data: { status: 'PAGA', pagaEm: dataPagamento }, include: INCLUIR_CONTA })`;
     b. diminua a dívida do cartão sem deixar negativa: `novoSaldo = Math.max(0, arredondar(num(fatura.conta.saldo) - total))` e
        `db.conta.update({ where: { id: fatura.contaId }, data: { saldo: novoSaldo } })`;
     c. se houver conta de pagamento e `total > 0`: crie nela uma transação `{ contaId, data: dataPagamento,
        descricao: 'Pagamento da fatura ' + fatura.conta.nome, valor: total, tipo: 'DESPESA', transferencia: true }` e
        `db.conta.update({ where: { id: contaPagamentoId }, data: { saldo: { decrement: total } } })`.
   - Depois: `await registrarPosicaoPatrimonio()`. Responda `faturaDTO` da fatura atualizada.

## Cliente

`index.tsx`: uma rota — `/app/cartoes`, rótulo `Cartões`, ícone `cartao`, ordem `30`, elemento `<Cartoes />`.

Tipo local: `interface CartaoResumoDTO { conta: ContaDTO; faturaAtual: FaturaDTO | null; percentualUsado: number | null }`.

### `Cartoes.tsx` (export `Cartoes`)

1. Dados: `useDados<CartaoResumoDTO[]>('/cartoes')`; estado `cartaoId: number | null` (cartão selecionado; ao carregar, selecione o primeiro);
   `useDados<FaturaDTO[]>(cartaoId ? '/faturas?contaId=' + cartaoId : null)`; estado `faturaId: number | null` (fatura aberta no detalhe).
2. `<Pagina titulo="Cartões" acoes={<Botao>Novo cartão</Botao>}>`.
3. `resumo` com 3 `ResumoItem`: `Faturas em aberto` (soma de `conta.saldo`, ícone `cartao`, laranja), `Limite total` (soma de `limite ?? 0`,
   `financeiro`, azul), `Limite disponível` (soma de `limiteDisponivel ?? (limite - saldo)` quando houver limite, `visto`, verde).
4. Grade `<div className="fin-cartoes">`: um cartão visual por item (botão; classe `cartoes-cartao`, e `cartoes-cartao-ativo` no selecionado).
   Desenho de cartão de crédito: fundo `linear-gradient(135deg, <conta.cor>, color-mix(in srgb, <conta.cor> 55%, #000))` via `style`
   (cor vinda de dado), texto branco fixo `#fff` permitido SÓ dentro deste cartão colorido; mostra `conta.nome`, `conta.bandeira ?? ''`,
   `•••• ` + (`conta.numero ?? '••••'`), `Fatura atual` + `formatarReais(conta.saldo)`, `Vence em ` + `formatarDia(faturaAtual.vencimento)`
   quando houver, `<BarraProgresso percentual={percentualUsado ?? 0} />` e `Limite: formatarReais(limite)` quando houver limite,
   e `<SeloOrigem origem={conta.origem} />`. Raio `var(--raio)`, sombra `var(--sombra)`, proporção aproximada 1.6:1 (min-height 170px).
5. Abaixo, `<Cartao>` com cabeçalho `fin-cabecalho`: título `Faturas de <nome do cartão>` e um `MenuAcoes` do cartão selecionado com:
   `Editar` (`lapis`), `Ver lançamentos` (`transacoes`; navega com `useNavigate` para `/app/transacoes?conta=<id>`),
   `Excluir` (`lixeira`, `perigo`, só `MANUAL`, `window.confirm`, `api.del('/contas/' + id)`).
   Depois uma `Tabela<FaturaDTO>`: `Vencimento` (`formatarDia`), `Fechamento` (`formatarDia`), `Total` (`alinhar: 'direita'`, `formatarReais`),
   `Situação` (`<Selo cor={STATUS_FATURA[f.status].cor}>{STATUS_FATURA[f.status].rotulo}</Selo>`), `Pagamento` (`formatarDia(f.pagaEm)`).
   `aoClicarLinha={(f) => setFaturaId(f.id)}`. `vazio="Nenhuma fatura ainda. As faturas aparecem quando você lança compras no cartão ou conecta o banco em Conexões."`
6. Sem nenhum cartão: `<Vazio icone="cartao" titulo="Nenhum cartão cadastrado" texto="Cadastre um cartão aqui ou conecte seu banco em Conexões para trazer cartões e faturas automaticamente."><Botao>Novo cartão</Botao></Vazio>`.
7. Modal "Novo cartão" / "Editar cartão" (formulário `FormCartao` no mesmo arquivo): `Nome*`, `Instituição`, `Bandeira` (Selecao:
   Visa, Mastercard, Elo, American Express, Hipercard, Outra; `vazio="Não informar"`), `Final do cartão` (4 dígitos), `Limite (R$)`,
   `Dia do fechamento` e `Dia do vencimento` (Campo `number`, 1 a 31), `Fatura em aberto hoje (R$)` (só ao criar), `<CampoCor />`.
   Criar: `api.post('/contas', { nome, tipo: 'CARTAO', instituicao, numero, bandeira, limite, diaFechamento, diaVencimento, saldo, cor })`
   (campos vazios viram `null`; dias como número). Editar: `api.put('/contas/' + id, { ... })` sem `tipo` e sem `saldo`.
   Cartão `OPEN_FINANCE`: mostre só `Nome` e `Cor` + `<Aviso tipo="info">`.
8. `{faturaId !== null && <DetalheFatura faturaId={faturaId} aoFechar={...} aoMudar={recarregarTudo} />}`.

### `DetalheFatura.tsx`

```ts
export function DetalheFatura(props: { faturaId: number; aoFechar: () => void; aoMudar: () => void }): JSX.Element
```

Um `<Modal aberto titulo={'Fatura de ' + formatarDia(vencimento)} aoFechar={aoFechar}>` com:

1. `useDados<{ fatura: FaturaDTO; transacoes: TransacaoDTO[]; porCategoria: { nome: string; cor: string; total: number }[] }>('/faturas/' + faturaId)`
   e `useDados<ContaDTO[]>('/contas')` (para a conta de pagamento).
2. Topo: total em destaque (`formatarReais`), selo da situação, `Vencimento`, `Fechamento`, `Mínimo` (quando houver), `<SeloOrigem />`.
3. `<Rosca fatias={porCategoria.map((c) => ({ rotulo: c.nome, valor: c.total, cor: c.cor }))} centro={formatarReais(fatura.total)} />` quando houver despesas.
4. `Tabela<TransacaoDTO>`: `Data`, `Descrição` (+ `Parcela X de Y` em `fin-suave`), `Categoria` (`NomeComCor` ou `—`),
   `Valor` (direita; `<Valor sentido={t.tipo === 'RECEITA' ? 'entrada' : 'saida'} />`). `vazio="Nenhuma compra nesta fatura."`
5. Pagar (só se `origem === 'MANUAL'` e `status !== 'PAGA'`): `Selecao` `Pagar com a conta` (contas MANUAIS, ativas, que não são cartão;
   `vazio="Não debitar de nenhuma conta"`), `Campo` data `Pago em` (padrão `hojeISO()`), `<Botao>Marcar como paga</Botao>` →
   `api.post('/faturas/' + id + '/pagar', { pagaEm, contaPagamentoId })` (omita `contaPagamentoId` quando vazio); depois `recarregar()` e `aoMudar()`.
   Fatura `OPEN_FINANCE`: `<Aviso tipo="info">A situação desta fatura vem do banco pelo Open Finance.</Aviso>`.

### `cartoes.css`

Só as classes do cartão visual (`cartoes-cartao`, `cartoes-cartao-ativo` com contorno `box-shadow: 0 0 0 3px var(--cor-primaria)`,
linhas internas) e do topo do detalhe (`cartoes-fatura-topo`). Variáveis de cor de `estilo.css`, com a exceção do texto branco dentro do cartão colorido.

## Aceite

- `cd server && npx tsc --noEmit` e `cd client && npx tsc --noEmit` sem erros nos seus arquivos. Nenhum `any`.
