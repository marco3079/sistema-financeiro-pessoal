# Lote 5: Automações

Regras comuns: `docs/plano/COMUM-lote3.md` (use a sala `lote5`). Dois geradores: `a1` (servidor) e `a2` (tela).

## O que é

Uma automação = **condições** + **ação**, aplicada aos lançamentos (`Transacao`) do perfil financeiro.

- Ações (`acao`): `TRANSFERENCIA` (põe `transferencia: true`), `CATEGORIA` (põe `categoriaId`, só em lançamento sem categoria e do mesmo tipo da categoria), `ESCONDER` (põe `oculto: true` e `transferencia: true`).
- Todo lançamento alterado recebe `automacaoId = <id da automação>`. **As automações nunca mexem em lançamento que já tem `automacaoId`**, nem em lançamento com `provento: true` ou `oculto: true`. Para `TRANSFERENCIA` e `ESCONDER`, também pulam quem já tem `transferencia: true`.
- Rodam em ordem (`ordem` crescente, depois `id`). Um lançamento usado por uma automação não é usado por outra na mesma rodada.

## Base já pronta (feita pelo main; não edite)

`server/prisma/schema.prisma`:

```prisma
model Automacao {
  id, perfilId, nome String, tipo String, acao String @default("TRANSFERENCIA"), categoriaId Int?,
  config Json @default("{}"), ativa Boolean @default(true), ordem Int @default(0), padrao String?,
  criadoEm, atualizadoEm
}
// Em Transacao: oculto Boolean @default(false), automacaoId Int?
```

`Automacao` já está no filtro por perfil, no Drive e em `apagarPerfil`. `GET /transacoes` já esconde `oculto: true`. `/api/automacoes` já está fechado ao usuário somente leitura. O atalho "Automações" já está em `client/src/modules/centrais/atalhos.ts` apontando para `/app/automacoes`.

## Tipos e condições (`tipo` e `config`)

`config` é um objeto JSON; todos os campos são opcionais:

```ts
interface ConfigAutomacao {
  contaIds?: number[];          // limita a estas contas (vazio ou ausente = todas)
  tipoLancamento?: 'RECEITA' | 'DESPESA'; // só TEXTO e COMBINADA
  textos?: string[];            // a descrição contém QUALQUER um (sem acento, sem maiúsculas); cada um com 2 a 60 caracteres, no máximo 20
  textosEntrada?: string[];     // nos pares: exigido da perna de entrada (RECEITA)
  textosSaida?: string[];       // nos pares: exigido da perna de saída (DESPESA)
  valorMin?: number;            // >= 0
  valorMax?: number;            // >= valorMin
  diasMax?: number;             // inteiro 0..60; padrão por tipo abaixo
  tolerancia?: number;          // diferença de valor aceita, em reais, 0..5; padrão 0
}
```

"Conta comum" = `Conta.tipo !== 'CARTAO'`. Comparação de valor: `Math.abs(a - b) <= tolerancia + 0.005`. Dias = diferença entre as datas (campo `data`, tipo date) em dias inteiros.

| `tipo` | Casa quando | Lançamentos que recebem a ação | `diasMax` padrão |
|---|---|---|---|
| `PAR_CONTAS` | uma DESPESA numa conta comum A e uma RECEITA numa conta comum B (B ≠ A), mesmo valor, `|dias| <= diasMax`. `textosSaida`/`textosEntrada`, se houver, precisam casar. `valorMin`/`valorMax` valem para o valor. `contaIds`, se houver: as duas contas precisam estar na lista. | os dois | 1 |
| `PAR_MESMA_CONTA` | uma RECEITA e uma DESPESA na **mesma** conta comum, mesmo valor, a saída de 0 a `diasMax` dias depois da entrada. Mesmos filtros opcionais. | os dois | 2 |
| `FATURA` | uma DESPESA numa conta comum que (a) tem a descrição contendo algum de `textos`, **ou** (b) tem o mesmo valor do `total` de uma `Fatura` de um cartão cujo `vencimento` está a no máximo `diasMax` dias da data do lançamento, **ou** (c) tem o mesmo valor de uma RECEITA numa conta `CARTAO` a no máximo `diasMax` dias. | a DESPESA e, no caso (c), também a RECEITA do cartão | 5 |
| `INVESTIMENTO` | um lançamento numa conta comum com o mesmo valor de um `MovimentoInvestimento` a no máximo `diasMax` dias: DESPESA ↔ movimento `APLICACAO`, RECEITA ↔ movimento `RESGATE`. Se `textos` existir, a descrição também precisa conter um deles. Cada movimento casa com um lançamento só. | o lançamento | 3 |
| `ESTORNO` | uma DESPESA e uma RECEITA na **mesma** conta (comum ou cartão), mesmo valor, a RECEITA de 0 a `diasMax` dias depois, e as descrições "parecidas": a primeira palavra com 4+ letras de uma (sem acento, maiúsculas, só letras e números) aparece na outra. | os dois | 30 |
| `TEXTO` | a descrição contém algum de `textos` (obrigatório ter pelo menos 1). Filtros opcionais: `tipoLancamento`, `contaIds`. | o lançamento | — |
| `COMBINADA` | todas as condições informadas valem ao mesmo tempo: `contaIds`, `tipoLancamento`, `valorMin`, `valorMax`, `textos`. Precisa de pelo menos uma condição. | o lançamento | — |

Em todo par, cada lançamento entra em no máximo um par; entre vários candidatos, vale o de data mais próxima e, no empate, o de menor `id`.

## Conjunto padrão (`padrao` = chave)

| chave | nome | tipo | acao | config | ativa |
|---|---|---|---|---|---|
| `pix-no-credito` | Pix pago no crédito | `PAR_MESMA_CONTA` | `TRANSFERENCIA` | `{ textosEntrada: ['valor adicionado'], diasMax: 2 }` | true |
| `pagamento-de-fatura` | Pagamento de fatura | `FATURA` | `TRANSFERENCIA` | `{ textos: ['pagamento de fatura', 'pagamento da fatura', 'pgto fatura', 'pagto fatura'], diasMax: 5 }` | true |
| `entre-contas` | Transferência entre minhas contas | `PAR_CONTAS` | `TRANSFERENCIA` | `{ diasMax: 1 }` | true |
| `investimentos` | Aplicação e resgate de investimento | `INVESTIMENTO` | `TRANSFERENCIA` | `{ diasMax: 3 }` | false |
| `estorno` | Compra e estorno | `ESTORNO` | `TRANSFERENCIA` | `{ diasMax: 30 }` | false |

`ordem` = posição na tabela (1 a 5).

---

## a1 — Servidor (motor e rotas)

### Arquivos

- Criar `server/src/lib/automacoes.ts` e `server/src/modules/automacoes/routes.ts`.
- Editar **só estas linhas** em arquivos existentes:
  - `server/src/lib/sincronizacao.ts`: logo depois da linha `await marcarPixNoCreditoNasContas(idsDasContas, ...)`, acrescentar `await aplicarAutomacoes({ desde: new Date(hoje().getTime() - 120 * MS_DIA) }).catch(() => undefined);` e o import.
  - `server/src/modules/importacao/routes.ts`: no fim da confirmação do extrato/fatura (rota que grava os lançamentos importados, depois de gravar e fora da transação), a mesma chamada com `.catch(() => undefined)`. Leia a rota para achar o ponto; se não tiver certeza do ponto, **não edite** e avise no resumo.
- Não edite mais nada.

### `server/src/lib/automacoes.ts` (precisa rodar dentro do perfil financeiro)

```ts
export const TIPOS_AUTOMACAO = ['PAR_CONTAS','PAR_MESMA_CONTA','FATURA','INVESTIMENTO','ESTORNO','TEXTO','COMBINADA'] as const;
export const ACOES_AUTOMACAO = ['TRANSFERENCIA','CATEGORIA','ESCONDER'] as const;
export const configSchema: z.ZodType<ConfigAutomacao>;      // valida o formato acima (strict: campo desconhecido é erro)
export interface LancamentoProposto { id: number; data: string; descricao: string; valor: number; tipo: 'RECEITA'|'DESPESA'; contaNome: string }
export interface Proposta { automacaoId: number; automacaoNome: string; acao: string; lancamentos: LancamentoProposto[] } // 1 ou 2 lançamentos
export async function avaliarAutomacoes(opcoes?: { desde?: Date; automacaoId?: number; incluirInativas?: boolean }): Promise<Proposta[]>;
export async function aplicarAutomacoes(opcoes?: { desde?: Date; automacaoId?: number }): Promise<{ aplicados: number; porAutomacao: { id: number; nome: string; lancamentos: number }[] }>;
export async function criarAutomacoesPadrao(): Promise<number>; // cria as do conjunto padrão cuja `padrao` ainda não existe; devolve quantas criou
```

Passos:

1. `avaliarAutomacoes`: lê as automações (`ativa: true`, a não ser que `automacaoId` venha com `incluirInativas`), em ordem. Lê **uma vez** os lançamentos candidatos: `automacaoId: null, provento: false, oculto: false`, `data >= desde` se informado, com `conta: { select: { id, nome, tipo } }`, ordenados por `data` e `id`. Lê também, só se alguma automação precisar, as `Fatura` de cartão (`total`, `vencimento`) e os `MovimentoInvestimento` (`tipo`, `valor`, `data`).
2. Para cada automação, na ordem, aplica a regra do tipo sobre os lançamentos ainda não usados nesta rodada. `config` inválido (não passa no `configSchema`) = automação ignorada. Para `TRANSFERENCIA`/`ESCONDER` descarta lançamento com `transferencia: true`. Para `CATEGORIA` descarta lançamento com `categoriaId !== null`, e descarta tudo se `categoriaId` da automação for nulo, não existir ou tiver `tipo` diferente do lançamento.
3. Texto: compare sempre com `semAcento(texto)` = `normalize('NFD')`, sem diacríticos, minúsculas.
4. `aplicarAutomacoes`: chama `avaliarAutomacoes` e grava em uma transação, por automação, com `updateMany({ where: { id: { in }, automacaoId: null }, data })`: `TRANSFERENCIA` → `{ transferencia: true, automacaoId }`; `ESCONDER` → `{ transferencia: true, oculto: true, automacaoId }`; `CATEGORIA` → `{ categoriaId, automacaoId }`.
5. Nada de consulta dentro de laço por lançamento: carregue tudo antes e trabalhe em memória.

### `server/src/modules/automacoes/routes.ts`

| Método | Rota | Corpo → resposta |
|---|---|---|
| GET | `/automacoes` | lista `AutomacaoDTO[]` em ordem: `{ id, nome, tipo, acao, categoriaId, categoriaNome, config, ativa, ordem, padrao, aplicados }` (`aplicados` = quantos lançamentos têm `automacaoId` = id; uma consulta `groupBy`) |
| POST | `/automacoes` | `{ nome (1..80), tipo, acao, categoriaId?, config, ativa? }` → 201 DTO. `ordem` = maior ordem + 1. Limite de 50 por perfil (400). |
| PUT | `/automacoes/:id` | mesmos campos, todos opcionais, mais `ordem?` → DTO |
| DELETE | `/automacoes/:id` | apaga a automação e põe `automacaoId: null` nos lançamentos dela (não desfaz o que ela fez) → 204 |
| POST | `/automacoes/padrao` | → 201 `{ criadas }` |
| POST | `/automacoes/previa` | `{ automacaoId?: number }` → `{ propostas: Proposta[] (no máximo 300), total: number, lancamentos: number }`. Com `automacaoId`, avalia só ela, mesmo inativa. Sem `desde` (todo o histórico). Não grava. |
| POST | `/automacoes/aplicar` | `{ automacaoId?: number }` → resultado de `aplicarAutomacoes` (todo o histórico; com `automacaoId` só ela, e precisa estar ativa: se não, 400 "Ative a automação antes de aplicar") |
| POST | `/automacoes/:id/desfazer` | desfaz o que a automação fez: nos lançamentos com `automacaoId` = id, `TRANSFERENCIA` → `transferencia: false`; `ESCONDER` → `transferencia: false, oculto: false`; `CATEGORIA` → `categoriaId: null`; e sempre `automacaoId: null`. → `{ desfeitos }` |

Validações: `tipo` e `acao` dentro das listas; `config` pelo `configSchema`; `acao === 'CATEGORIA'` exige `categoriaId` de categoria existente; `TEXTO` exige `textos` com 1+ item; `COMBINADA` exige pelo menos uma condição; `valorMax >= valorMin`. Mensagens em português.

### Aceite e verificação

- `cd server && npx tsc --noEmit` sem erros.
- Não rode nada que grave no banco (os dados são reais). Não rode docker.
- No resumo: arquivos, pontos editados em `sincronizacao.ts` e `importacao/routes.ts` (ou por que não editou), desvios.

---

## a2 — Tela Automações

### Arquivos

- Criar `client/src/modules/automacoes/index.tsx`, `Automacoes.tsx`, `tipos.ts`, `automacoes.css`. Não edite mais nada.

### Rota

`{ caminho: '/app/automacoes', rotulo: 'Automações', icone: 'raio', perfis: ['TITULAR'], elemento: <Automacoes />, menu: false, ordem: 96 }` (confira em `client/src/ui/Icone.tsx` ou onde `NomeIcone` é definido que `'raio'` existe; se não existir, use o mesmo ícone de `client/src/modules/regras/index.tsx`).

### API (feita pelo a1; use exatamente isto)

As rotas e formatos estão na seção **a1** acima (`GET/POST/PUT/DELETE /automacoes`, `/automacoes/padrao`, `/automacoes/previa`, `/automacoes/aplicar`, `/automacoes/:id/desfazer`) e o formato de `config` em **Tipos e condições**. Categorias: `GET /categorias` (`CategoriaDTO`). Contas: `GET /contas?inativas=true` (`ContaDTO`, com `id`, `nome`, `tipo`).

### Tela

1. Cabeçalho `Pagina` com título "Automações" e ações: **Criar automações padrão** (secundário; `POST /automacoes/padrao`, mostra "N automações criadas" ou "As automações padrão já existem") e **Nova automação**.
2. Texto de ajuda curto: "Cada automação tem condições e uma ação. Elas rodam sozinhas nos lançamentos novos; para os antigos, veja a prévia e aplique."
3. Lista (um `Cartao` por automação, ou `Tabela`): nome, rótulo do tipo, resumo das condições em uma frase (ex.: "Entrada e saída de mesmo valor na mesma conta, em até 2 dias · entrada contém: valor adicionado"), ação (com o nome da categoria quando for o caso), `Selo` Ativa/Desligada, "N lançamentos alterados" (`aplicados`). Ações por item (`MenuAcoes`): Ver o que mudaria, Aplicar aos antigos, Ativar/Desligar (`PUT { ativa }`), Editar, Desfazer o que ela fez (confirmação), Excluir (confirmação).
4. Vazio: `Vazio` com "Nenhuma automação ainda" e a dica de usar Criar automações padrão.
5. Modal Nova/Editar: Nome; Tipo (`Selecao` com os 7 tipos e uma linha explicando o tipo escolhido); Ação (`Selecao`; se Categoria, `Selecao` de categoria); e **só os campos que o tipo usa**:
   - pares (`PAR_CONTAS`, `PAR_MESMA_CONTA`, `ESTORNO`): "Em até quantos dias" (`diasMax`), "Diferença de valor aceita (R$)" (`tolerancia`), "Entrada contém" (`textosEntrada`), "Saída contém" (`textosSaida`) (os dois últimos não aparecem em `ESTORNO`), valor mínimo/máximo, contas.
   - `FATURA`: "Descrição contém" (`textos`), dias, diferença de valor.
   - `INVESTIMENTO`: dias, diferença de valor, "Descrição contém" (opcional).
   - `TEXTO`: "Descrição contém" (obrigatório), tipo de lançamento (Todos/Entrada/Saída), contas.
   - `COMBINADA`: contas, tipo de lançamento, valor mínimo, valor máximo, "Descrição contém".
   Campos de texto múltiplo: um `Campo` em que a pessoa separa os trechos por vírgula (explique no rótulo: "separe por vírgula"). Contas: lista de caixas de seleção com as contas (sem cartões nos tipos de par entre contas; com cartões em `ESTORNO`, `TEXTO`, `COMBINADA`). Ao salvar, monte `config` só com os campos preenchidos do tipo escolhido.
6. Prévia ("Ver o que mudaria"): `POST /automacoes/previa { automacaoId }`; mostra em um `Modal` ou `Cartao` a contagem ("N lançamentos em M grupos") e a lista dos grupos (cada grupo: 1 ou 2 linhas com data, descrição, conta e valor, entradas em verde e saídas em vermelho usando o componente `Valor` ou as classes do tema). Se `total > propostas.length`, avise "Mostrando os primeiros 300". Botão **Aplicar** no fim (desabilitado se a automação estiver desligada, com a dica "Ative a automação para aplicar").
7. Botão geral "Ver o que todas mudariam" (prévia sem `automacaoId`) e "Aplicar todas".
8. Depois de aplicar/desfazer/salvar/excluir: recarregar a lista e mostrar `Aviso` de sucesso com os números devolvidos.

### Aceite e verificação

- `cd client && npx tsc --noEmit` sem erros. Sem `any`.
- Cabe em 360 px sem rolagem horizontal. Toda exclusão e o "Desfazer" pedem confirmação.
- No resumo: arquivos, desvios e o que não foi verificado.
