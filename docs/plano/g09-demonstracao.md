# g09 — Dados de demonstração e categorias padrão

Leia antes: `docs/plano/CONTRATOS.md` (seções "O projeto", "Regras gerais", "Modelo de dados"), `server/prisma/schema.prisma` (inteiro),
`server/prisma/seed.ts`, `server/src/lib/financas.ts` (só para entender as regras; NÃO importe dele aqui — este arquivo roda fora do servidor).

## Arquivos que você pode editar (só estes)

- `server/prisma/seed-demo.ts` (hoje é um esqueleto: reescreva)
- `server/prisma/seed.ts` (só o que está descrito no passo 1)

## 1. `seed.ts`: categorias padrão sempre

O `seed.ts` hoje cria o titular e, se `SEED_DEMO=true`, chama `carregarDemonstracao(prisma)`. Mude só isto: logo depois de criar o titular
(e antes do `if (demo)`), chame `await criarCategoriasPadrao(prisma);`, importada de `./seed-demo`. Não mude mais nada.

## 2. `seed-demo.ts`

Exporta duas funções:

```ts
import type { PrismaClient } from '@prisma/client';
export async function criarCategoriasPadrao(prisma: PrismaClient): Promise<void>
export async function carregarDemonstracao(prisma: PrismaClient): Promise<void>
```

### `criarCategoriasPadrao`

`prisma.categoria.createMany({ data: [...], skipDuplicates: true })` com:

Despesas (tipo `DESPESA`): Moradia `#2563eb`, Mercado `#10b981`, Restaurantes `#f59e0b`, Transporte `#06b6d4`, Saúde `#dc2626`,
Educação `#7c3aed`, Lazer `#ec4899`, Assinaturas `#f97316`, Compras `#84cc16`, Contas da casa `#64748b`, Impostos e taxas `#475569`, Outros `#94a3b8`.

Receitas (tipo `RECEITA`): Salário `#10b981`, Rendimentos `#2563eb`, Freelance `#7c3aed`, Reembolsos `#06b6d4`, Outras receitas `#64748b`.

### `carregarDemonstracao`

Dados fictícios e coerentes, todos com `origem: 'MANUAL'`, datas relativas a hoje. Regras de consistência (obrigatórias):

- `Transacao.valor` sempre positivo. `data` sempre meia-noite UTC: use um auxiliar `dia(mesesAtras: number, diaDoMes: number): Date` que devolve
  `new Date(Date.UTC(anoAtual, mesAtual - mesesAtras, Math.min(diaDoMes, ultimoDiaDaqueleMes)))`. Nunca gere data depois de hoje: para o mês
  atual, só crie lançamentos cujo dia seja ≤ o dia de hoje.
- O `saldo` final de cada conta que não é cartão tem de ser igual a `saldoInicial + receitas − despesas` dos lançamentos criados para ela.
  Faça assim: guarde os lançamentos em um array em memória, some por conta, e só então crie a conta com o saldo calculado... ou crie a conta
  com um saldo inicial e, no fim, dê `prisma.conta.update` com o saldo calculado. O saldo final tem de ficar positivo.
- Cartão: toda compra pertence a uma `Fatura` (`faturaId`). Use `diaFechamento: 3` e `diaVencimento: 10`. Regra do ciclo: compra feita até o
  dia 3 entra na fatura que vence no dia 10 do MESMO mês; compra do dia 4 em diante entra na fatura que vence no dia 10 do mês SEGUINTE.
  `Fatura.fechamento` = dia 3 do mês do vencimento. `Fatura.total` = soma das compras dela. Status: vencimento antes de hoje → `PAGA` com
  `pagaEm` = vencimento; fechamento antes de hoje e vencimento de hoje em diante → `FECHADA`; fechamento de hoje em diante → `ABERTA`.
  `Conta.saldo` do cartão = soma dos `total` das faturas que NÃO estão pagas. `limiteDisponivel = limite − saldo`.
  Para cada fatura `PAGA`, crie na conta corrente uma transação `DESPESA` com `transferencia: true`, descrição `Pagamento da fatura <nome do cartão>`,
  valor = total da fatura, data = vencimento (ela entra na conta do saldo da conta corrente).

Conteúdo:

1. Categorias: chame `criarCategoriasPadrao(prisma)` e leia todas (`findMany`) para ter os ids por nome.
2. Contas: `Conta Corrente` (CORRENTE, instituição `Banco Azul`, número `12345-6`, cor `#2563eb`), `Poupança` (POUPANCA, `Banco Azul`, cor `#10b981`),
   `Carteira` (CARTEIRA, cor `#f59e0b`), `Corretora` (INVESTIMENTO, instituição `Corretora Horizonte`, cor `#7c3aed`, saldo 350, sem lançamentos),
   `Cartão Azul` (CARTAO, instituição `Banco Azul`, bandeira `Mastercard`, número `4821`, limite 8000, cor `#1d4ed8`).
3. Lançamentos dos últimos 6 meses (mês atual incluído) na Conta Corrente, em cada mês: salário (RECEITA, Salário, dia 5, 7800), aluguel
   (DESPESA, Moradia, dia 6, 2100), condomínio (Moradia, dia 10, 480), energia (Contas da casa, dia 12, entre 150 e 230), internet
   (Contas da casa, dia 15, 119.9), plano de saúde (Saúde, dia 8, 412), transferência para a poupança (dia 7, 500, `transferencia: true`,
   DESPESA na corrente + RECEITA na poupança no mesmo dia), saque para a carteira (dia 9, 200, `transferencia: true`, DESPESA na corrente +
   RECEITA na carteira). Em 2 dos 6 meses, um freelance (RECEITA, Freelance, dia 20, 1200 a 1800). Na Carteira: 2 a 3 gastos pequenos por mês
   (Restaurantes/Transporte, 15 a 60). Varie os valores com uma função pseudoaleatória DETERMINÍSTICA (semente fixa; não use `Math.random`).
4. Cartão: 10 a 14 compras por mês nos últimos 6 meses — mercado (Mercado, 3 por mês, 180 a 420), restaurantes (4 por mês, 35 a 160), combustível/app de
   transporte (Transporte, 2 a 3, 25 a 220), streaming e música (Assinaturas, dias fixos, 39.9 e 21.9), farmácia (Saúde), uma compra em Compras
   por mês (120 a 600), cinema/show (Lazer). Inclua UMA compra parcelada em 6x de 2400 (Compras, "Notebook") iniciada há 3 meses: 6 transações de
   400, `parcela` 1 a 6, `totalParcelas` 6, uma por mês — só crie as parcelas cuja data não é futura... EXCEÇÃO: parcelas futuras de uma compra
   parcelada PODEM ter data futura (elas pertencem a faturas futuras `ABERTA`); crie as 6.
5. Investimentos (com `MovimentoInvestimento` de `APLICACAO` na data da compra, e `dataPosicao: new Date()`):
   `Tesouro Selic 2029` (RENDA_FIXA, subtipo `Tesouro Direto`, instituição `Corretora Horizonte`, aplicado 12000, saldo 13480.55, taxa `Selic + 0,05%`, vencimento 2029-03-01),
   `CDB Banco Azul` (RENDA_FIXA, subtipo `CDB`, emissor `Banco Azul`, aplicado 8000, saldo 8642.3, taxa `110% do CDI`, vencimento daqui a 2 anos),
   `Fundo Multimercado Horizonte` (FUNDO, aplicado 5000, saldo 5311.72),
   `IVVB11` (ETF, código `IVVB11`, quantidade 20, aplicado 5600, saldo 6384),
   `ITSA4` (ACAO, código `ITSA4`, quantidade 400, aplicado 3960, saldo 4212),
   `HGLG11` (FII, código `HGLG11`, quantidade 15, aplicado 2475, saldo 2389.5),
   `Previdência PGBL` (PREVIDENCIA, aplicado 9000, saldo 9870.4),
   `Bitcoin` (CRIPTO, código `BTC`, quantidade 0.012, aplicado 3000, saldo 3712.9).
   Em 3 deles, acrescente 2 a 3 movimentos `RENDIMENTO` em meses anteriores (valores pequenos) — sem alterar os saldos acima.
6. Orçamentos: Mercado 1200, Restaurantes 600, Transporte 450, Lazer 300, Assinaturas 80, Compras 700.
7. Metas: `Reserva de emergência` (alvo 30000, atual 18500, cor `#10b981`), `Viagem de férias` (alvo 9000, atual 3200, prazo daqui a 8 meses, cor `#f59e0b`),
   `Entrada do apartamento` (alvo 80000, atual 21000, prazo daqui a 3 anos, cor `#2563eb`).
8. `PosicaoPatrimonio`: uma por mês nos últimos 11 meses (dia 28 de cada mês anterior) + uma hoje. A de hoje usa os valores reais calculados
   (`contas` = soma dos saldos das contas que não são cartão; `investimentos` = soma dos saldos dos investimentos; `cartoes` = saldo do cartão).
   As anteriores decrescem para trás de forma suave: mês −k tem `contas` = atual − k·350, `investimentos` = atual·(1 − 0,028·k), `cartoes` variando
   entre 1800 e 3200 (determinístico). Nunca negativo.
9. No fim, `console.log('Dados de demonstração carregados.')`.

Use `createMany` onde der. Não crie `ConexaoBancaria` (demonstração não tem conexão real).

## Aceite

- `cd server && npx tsc --noEmit` sem erros nos seus arquivos. Nenhum `any`.
- Releia as regras de consistência e confira o código contra cada uma antes de entregar.
