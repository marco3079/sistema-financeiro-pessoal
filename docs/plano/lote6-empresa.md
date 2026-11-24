# Lote 6: perfil Empresa

Regras comuns: `docs/plano/COMUM-lote3.md` (use a sala `lote6`). Sete geradores: `e1` a `e7`.

## O que é

Um perfil financeiro pode ser do tipo **Empresa** (`PerfilFinanceiro.tipo = 'EMPRESA'`). Nele o menu troca: somem as telas de pessoa física e entram as de controle financeiro de empresa. Tudo o que é de empresa fica em rotas de API próprias e em telas com caminho `/app/empresa/...` (o `App.tsx` já esconde esses caminhos em perfil Pessoal, e o menu já tem os grupos Financeiro, Resultado e Cadastros).

O filtro por perfil financeiro é automático (`import { prisma } from '../../lib/prisma'`): **nunca** escreva `perfilId`.

## Base já pronta (feita pelo main; NÃO edite)

`server/prisma/schema.prisma` (o `prisma generate` já rodou):

```prisma
model Parceiro      { id, perfilId, nome String, tipo String @default("AMBOS") /* CLIENTE|FORNECEDOR|AMBOS */, documento String?, email String?, telefone String?, observacao String?, ativo Boolean @default(true), criadoEm }
model CentroDeCusto { id, perfilId, nome String, cor String @default("#64748b"), ativo Boolean @default(true), criadoEm }
model Titulo        { id, perfilId, natureza String /* PAGAR|RECEBER */, descricao String, parceiroId Int?, categoriaId Int?, centroDeCustoId Int?, contaId Int?,
                      valor Decimal, emissao Date, vencimento Date, documento String?, parcela Int?, totalParcelas Int?, grupo String?, recorrente Boolean @default(false),
                      observacao String?, cancelado Boolean @default(false), criadoEm }
model BaixaTitulo   { id, perfilId, tituloId Int, data Date, valor Decimal, juros Decimal @default(0), multa Decimal @default(0), desconto Decimal @default(0), contaId Int, transacaoId Int?, observacao String?, criadoEm }
model AnexoTitulo   { id, perfilId, tituloId Int, nome String, tipo String, tamanho Int, dados Bytes, criadoEm }
// Em Transacao: centroDeCustoId Int?      Em Categoria: grupoDre String? (RECEITA|DEDUCAO|CUSTO|DESPESA|FINANCEIRO|IMPOSTO)
```

Nenhuma dessas tabelas tem chave estrangeira: ao ler, trate registro pai que sumiu (parceiro, categoria, conta, centro) como `null`.

Helpers em `server/src/lib/financas.ts`: `num`, `arredondar`, `dataISO`, `paraData`, `hoje`, `mesAtual`, `somarMeses`, `intervaloDoMes`, `dinheiroSchema`, `dataSchema`, `mesSchema`, `textoCurto`, `textoOpcional`, `corSchema`, `efeitoNoSaldo(tipoConta, tipoTransacao, valor)`, `registrarPosicaoPatrimonio()`. Erros: `asyncHandler`, `HttpError`, `idParam`, `validar` de `lib/erros`.

## Definições comuns (valem para todos)

- **Situação de um título** (campo `situacao`, calculado): `CANCELADO` se `cancelado`; senão, com `pago` = soma de `BaixaTitulo.valor` e `saldo = valor - pago`: `QUITADO` se `saldo <= 0.005`; `VENCIDO` se `saldo > 0` e `vencimento < hoje`; `PARCIAL` se `pago > 0`; senão `ABERTO`.
- **TituloDTO**:
```ts
interface TituloDTO {
  id: number; natureza: 'PAGAR' | 'RECEBER'; descricao: string;
  parceiroId: number | null; parceiroNome: string | null;
  categoriaId: number | null; categoriaNome: string | null; categoriaCor: string | null;
  centroDeCustoId: number | null; centroDeCustoNome: string | null;
  contaId: number | null; contaNome: string | null;
  valor: number; pago: number; saldo: number;
  emissao: string; vencimento: string;           // 'AAAA-MM-DD'
  documento: string | null; parcela: number | null; totalParcelas: number | null; grupo: string | null;
  recorrente: boolean; observacao: string | null;
  situacao: 'ABERTO' | 'PARCIAL' | 'QUITADO' | 'VENCIDO' | 'CANCELADO';
  diasDeAtraso: number;                          // 0 se não vencido
  anexos: number;                                // quantidade de anexos
}
```
- Dinheiro: `number` com 2 casas (`arredondar`). Datas: `'AAAA-MM-DD'`. Meses: `'AAAA-MM'`.
- Todas as rotas de empresa exigem o perfil em uso do tipo Empresa? **Não**: funcionam em qualquer perfil (quem esconde é o menu).

---

## e1 — Clientes, fornecedores e centros de custo (servidor + telas)

**Arquivos**: criar `server/src/modules/empresa-cadastros/routes.ts`; criar `client/src/modules/empresa-cadastros/index.tsx`, `Parceiros.tsx`, `Centros.tsx`, `cadastros.css`. Nada mais.

**API**
| Método | Rota | Corpo → resposta |
|---|---|---|
| GET | `/parceiros?tipo=CLIENTE\|FORNECEDOR&inativos=true&busca=` | `ParceiroDTO[]` por nome. Sem `inativos`, só ativos. `tipo=CLIENTE` traz CLIENTE e AMBOS (idem FORNECEDOR). |
| POST | `/parceiros` | `{ nome (1..120), tipo, documento?, email?, telefone?, observacao? }` → 201 DTO. `documento`: guarda só dígitos; aceita vazio, 11 ou 14 dígitos (senão 400). Nome repetido (sem diferenciar maiúsculas) → 409. |
| PUT | `/parceiros/:id` | mesmos campos opcionais + `ativo?` → DTO |
| DELETE | `/parceiros/:id` | 409 "Há contas ligadas a este cadastro; desative em vez de excluir" se houver `Titulo` com esse `parceiroId`; senão 204 |
| GET | `/centros-de-custo?inativos=true` | `CentroDTO[]` |
| POST / PUT / DELETE | `/centros-de-custo`, `/centros-de-custo/:id` | `{ nome (1..60), cor?, ativo? }`; DELETE põe `centroDeCustoId: null` nos títulos e lançamentos do centro e apaga → 204 |
| GET | `/centros-de-custo/resultado?de=AAAA-MM-DD&ate=AAAA-MM-DD` | `{ centros: [{ id, nome, cor, receitas, despesas, resultado, lancamentos }], semCentro: { receitas, despesas, resultado, lancamentos } }` somando `Transacao` com `transferencia: false, provento: false, oculto: false` no período, por `centroDeCustoId` (id de centro que não existe mais conta em `semCentro`). Padrão: mês atual. |
| PUT | `/centros-de-custo/lancamentos` | `{ ids: number[] (1..500), centroDeCustoId: number \| null }` → `{ alterados }` (põe o centro em vários lançamentos) |

`ParceiroDTO = { id, nome, tipo, documento, email, telefone, observacao, ativo, titulosEmAberto: number, saldoEmAberto: number }` (em aberto = títulos não cancelados com saldo > 0; uma consulta para todos, sem laço de consultas). `CentroDTO = { id, nome, cor, ativo }`.

**Telas** (rotas com `perfis: ['TITULAR']`):
- `/app/empresa/parceiros`, rótulo "Clientes e fornecedores", ícone `usuarios`, ordem 30. Abas "Todos / Clientes / Fornecedores", busca, tabela (nome, tipo, documento formatado como CPF/CNPJ, contato, em aberto), modal criar/editar, desativar/reativar, excluir com confirmação.
- `/app/empresa/centros`, rótulo "Centros de custo", ícone `categorias`, ordem 27. Cadastro (nome, cor) + resultado do período (seletor de mês com `SeletorMes`): uma linha por centro com receitas, despesas e resultado, e a linha "Sem centro".

---

## e2 — Contas a pagar e a receber (servidor)

**Arquivos**: criar `server/src/lib/titulos.ts` e `server/src/modules/titulos/routes.ts`. Nada mais.

`lib/titulos.ts` exporta (para e4 reusar): `situacaoDoTitulo(t, pago, hojeData)`, `async function listarTitulosDTO(where: Prisma.TituloWhereInput): Promise<TituloDTO[]>` (carrega títulos, soma das baixas por título, nomes de parceiro/categoria/centro/conta e contagem de anexos **com consultas em lote**, nunca uma por título) e o tipo `TituloDTO`.

**API**
| Método | Rota | Corpo → resposta |
|---|---|---|
| GET | `/titulos?natureza=PAGAR\|RECEBER&situacao=&de=&ate=&parceiroId=&busca=&grupo=` | `{ itens: TituloDTO[], resumo: { emAberto, vencido, aVencer7dias, quitadoNoPeriodo, quantidade } }`. `natureza` obrigatória. `de`/`ate` filtram **vencimento** (padrão: sem filtro de data). `situacao` aceita lista separada por vírgula e é aplicada depois de calcular. `busca` procura em descrição e documento. Ordem: vencimento, id. No máximo 1000 itens. `resumo` considera os itens do filtro (sem cancelados). |
| GET | `/titulos/:id` | `TituloDTO & { baixas: BaixaDTO[], anexosLista: { id, nome, tipo, tamanho }[] }` |
| POST | `/titulos` | `{ natureza, descricao (1..200), valor (> 0), emissao?, vencimento, parceiroId?, categoriaId?, centroDeCustoId?, contaId?, documento? (..60), observacao? (..500), parcelas? (1..60, padrão 1), recorrenciaMeses? (0..36, padrão 0) }` → 201 `{ criados: TituloDTO[] }`. Com `parcelas > 1`: cria N títulos, valor dividido (o último leva o resto do arredondamento), vencimentos mês a mês (dia 31 em mês curto vira o último dia), `parcela`/`totalParcelas` preenchidos e o mesmo `grupo` (uuid de `crypto.randomUUID()`). Com `recorrenciaMeses > 0`: cria 1 + N títulos de **mesmo valor**, um por mês, `recorrente: true`, mesmo `grupo`. `parcelas > 1` e `recorrenciaMeses > 0` juntos → 400. Confere que parceiro, categoria (tipo DESPESA para PAGAR, RECEITA para RECEBER), centro e conta existem (404/400). |
| PUT | `/titulos/:id` | campos de edição opcionais (`descricao, valor, emissao, vencimento, parceiroId, categoriaId, centroDeCustoId, contaId, documento, observacao`) → DTO. `valor` não pode ficar menor que o já pago (400). Título cancelado não se edita (400). |
| POST | `/titulos/:id/cancelar` e `/titulos/:id/reabrir` | cancelar só sem baixas (400 "Estorne as baixas antes de cancelar") → DTO |
| DELETE | `/titulos/:id?grupo=true` | só sem baixas; com `grupo=true` apaga também os outros títulos do mesmo `grupo` que não têm baixa → `{ apagados }`. Apaga os anexos junto. |
| POST | `/titulos/:id/baixas` | `{ data, valor (> 0, <= saldo + 0.005), juros? (>= 0), multa? (>= 0), desconto? (>= 0, <= valor), contaId, observacao? }` → 201 `TituloDTO`. Em **uma transação**: cria `Transacao` na conta (`tipo`: DESPESA para PAGAR, RECEITA para RECEBER; `valor = valor + juros + multa - desconto` (> 0); `descricao`: descrição do título + " (parcela k/N)" quando houver + " · " + nome do parceiro quando houver, cortada em 200; `data`; `categoriaId` e `centroDeCustoId` do título; `origem: 'MANUAL'`), atualiza `Conta.saldo` com `increment: efeitoNoSaldo(conta.tipo, tipo, valorDoLancamento)`, e cria a `BaixaTitulo` com `transacaoId`. Conta `tipo: 'CARTAO'` ou de `origem: 'OPEN_FINANCE'` → 400 ("Escolha uma conta comum cadastrada à mão"). Depois da transação: `registrarPosicaoPatrimonio()`. |
| DELETE | `/titulos/:id/baixas/:baixaId` | estorna: em uma transação apaga o lançamento (se ainda existir), devolve o saldo (`increment: -efeitoNoSaldo(...)` com o valor do lançamento) e apaga a baixa → `TituloDTO` |
| POST | `/titulos/:id/anexos` | `{ nome (1..120), tipo: 'application/pdf'\|'image/png'\|'image/jpeg', dados: string base64 }` → 201 `{ id, nome, tipo, tamanho }`. Tamanho decodificado até 2 MB (400 acima); no máximo 5 anexos por título. **Atenção**: o servidor aceita corpo JSON de até quanto? Leia `server/src/app.ts`; se o limite global for menor que 3 MB, use neste router `express.json({ limit: '3mb' })` só nesta rota. |
| GET | `/titulos/:id/anexos/:anexoId` | devolve o arquivo (`Content-Type` do anexo, `Content-Disposition: inline; filename="..."` com o nome saneado, `X-Content-Type-Options: nosniff`) |
| DELETE | `/titulos/:id/anexos/:anexoId` | 204 |

`BaixaDTO = { id, data, valor, juros, multa, desconto, total, contaId, contaNome, observacao }`.

---

## e3 — Telas Contas a pagar e Contas a receber

**Arquivos**: criar `client/src/modules/empresa-titulos/index.tsx`, `Titulos.tsx`, `tipos.ts`, `titulos.css`. Nada mais. Usa a API do **e2** (acima) e `GET /parceiros`, `GET /centros-de-custo`, `GET /categorias`, `GET /contas`.

- Rotas: `/app/empresa/pagar` ("Contas a pagar", ícone `seta-baixo`, ordem 21) e `/app/empresa/receber` ("Contas a receber", ícone `seta-cima`, ordem 22), ambas renderizando `<Titulos natureza="PAGAR" />` / `"RECEBER"`. `perfis: ['TITULAR']`.
- Topo: `ResumoItem` com Em aberto, Vencido (vermelho), Vence em 7 dias, Quitado no período.
- Filtros: situação (Todas / Em aberto e vencidas (padrão) / Vencidas / Quitadas / Canceladas), período de vencimento (mês com `SeletorMes`, com opção "Todos"), parceiro, busca.
- Tabela (cartões no celular): vencimento, descrição (com parcela k/N, documento e selo "Recorrente"), cliente ou fornecedor, categoria, valor, saldo, situação (`Selo`), ações (`MenuAcoes`): Dar baixa, Ver detalhes, Editar, Cancelar/Reabrir, Excluir.
- **Nova conta** (modal): descrição, valor, vencimento, emissão (padrão hoje), cliente/fornecedor (lista filtrada por tipo; PAGAR mostra fornecedores, RECEBER clientes), categoria (tipo certo), centro de custo, conta prevista, documento, observação, e "Repetir": Não / Parcelar em N vezes / Todo mês por N meses.
- **Dar baixa** (modal): data (hoje), valor (padrão: saldo), juros, multa, desconto, conta (só contas que não são cartão), observação; mostra "Total do lançamento". Depois de salvar, recarrega.
- **Detalhes** (modal): dados do título, lista das baixas com botão Estornar (confirmação), e anexos: enviar arquivo (PDF, PNG, JPG até 2 MB: leia com `FileReader` em base64 e mande em `dados` sem o prefixo `data:...;base64,`), abrir (busca com `fetch` usando o token como `client/src/lib/api.ts` faz, vira `Blob` e abre com `URL.createObjectURL` em nova aba) e remover.
- Excluir de um título com `grupo`: pergunta "Só esta" ou "Esta e as outras em aberto do grupo".
- Textos: PAGAR usa "fornecedor", "pagar", "paga"; RECEBER usa "cliente", "receber", "recebida".

---

## e4 — Relatórios da empresa (servidor)

**Arquivos**: criar `server/src/modules/empresa-relatorios/routes.ts`. Nada mais. Pode importar `listarTitulosDTO` e `TituloDTO` de `server/src/lib/titulos.ts` (o e2 está criando esse arquivo com a assinatura da seção e2; se ainda não existir quando você rodar o `tsc`, o erro some quando o e2 entregar: avise no resumo).

"Realizado" = `Transacao` com `transferencia: false, provento: false, oculto: false` (regime de caixa). "Previsto" = títulos não cancelados com saldo > 0, pelo **vencimento**.

| Rota (GET) | Resposta |
|---|---|
| `/empresa/painel` | `{ saldoEmContas, aReceber, aPagar, vencidoAReceber, vencidoAPagar, receitasDoMes, despesasDoMes, resultadoDoMes, proximos: TituloDTO[] (10 próximos vencimentos em aberto, das duas naturezas), vencidos: TituloDTO[] (10 mais atrasados), meses: [{ mes, receitas, despesas, resultado }] (últimos 6 meses, realizado) }`. `saldoEmContas` = soma de `Conta.saldo` das contas ativas que não são cartão. |
| `/empresa/fluxo?dias=30\|60\|90` (padrão 30) | `{ saldoInicial, dias: [{ data, entradas, saidas, saldo }], meses: [{ mes, entradas, saidas, saldo }] (6 meses à frente), menorSaldo: { data, valor }, vencidosNaoConsiderados: { aReceber, aPagar } }`. `saldoInicial` = saldo em contas hoje. Cada dia soma os títulos em aberto que vencem nele (saldo do título); o `saldo` é acumulado. Títulos já vencidos não entram nos dias (vão em `vencidosNaoConsiderados`). |
| `/empresa/dre?ano=AAAA` (padrão ano atual) | `{ ano, linhas: [{ chave, rotulo, tipo: 'grupo'\|'total', meses: number[12], total, categorias?: [{ id, nome, meses: number[12], total }] }] }` na ordem: `RECEITA` "Receita bruta"; `DEDUCAO` "(-) Deduções e impostos sobre vendas"; total `RECEITA_LIQUIDA`; `CUSTO` "(-) Custos"; total `LUCRO_BRUTO`; `DESPESA` "(-) Despesas operacionais"; total `RESULTADO_OPERACIONAL`; `FINANCEIRO` "Resultado financeiro" (receitas financeiras menos despesas financeiras); total `RESULTADO_ANTES_IMPOSTOS`; `IMPOSTO` "(-) Impostos sobre o lucro"; total `LUCRO_LIQUIDO`. Grupo da categoria = `grupoDre`, ou, se nulo, `RECEITA` para categoria de receita e `DESPESA` para categoria de despesa. Lançamento sem categoria entra em RECEITA ou DESPESA numa categoria "Sem categoria" (id 0). Valores de grupos de despesa saem positivos; os totais fazem a conta. |
| `/empresa/dre/categorias` | `[{ id, nome, tipo, grupoDre (efetivo), definido: boolean }]` |
| `PUT /empresa/dre/categorias/:id` | `{ grupoDre: 'RECEITA'\|'DEDUCAO'\|'CUSTO'\|'DESPESA'\|'FINANCEIRO'\|'IMPOSTO'\|null }` → item |
| `/empresa/vencidos?natureza=PAGAR\|RECEBER` (obrigatória) | `{ total, faixas: [{ chave: 'ate30'\|'de31a60'\|'de61a90'\|'acima90', rotulo, quantidade, valor }], porParceiro: [{ parceiroId, parceiroNome ("Sem cadastro" se nulo), quantidade, valor, maiorAtraso }] (ordem: valor desc), titulos: TituloDTO[] (ordem: atraso desc, até 500) }`, só situação `VENCIDO`, valores pelo saldo. |
| `/empresa/indicadores?meses=3\|6\|12` (padrão 6) | `{ periodo: { de, ate }, receita, custos, despesas, lucro, margemBruta (% ou null), margemLiquida (% ou null), ticketMedio (receita / nº de lançamentos de receita, ou null), prazoMedioRecebimento (dias, média de (data da baixa - emissão) das baixas de títulos RECEBER no período, ou null), prazoMedioPagamento (idem PAGAR), inadimplencia (% = vencido a receber / (vencido + a vencer a receber), ou null), pontoDeEquilibrio (despesas fixas mensais médias / margem de contribuição %, onde margem de contribuição = (receita líquida - custos) / receita líquida; null se a margem <= 0), despesaMensalMedia, mesesDeCaixa (saldo em contas / despesaMensalMedia, ou null) }`. Use os mesmos grupos da DRE. |
| `/empresa/orcado?mes=AAAA-MM` (padrão mês atual) | `{ mes, linhas: [{ categoriaId, categoriaNome, categoriaCor, tipo, orcado, realizado, diferenca, percentual (realizado/orcado*100 ou null) }], totais: { orcado, realizado, diferenca } }` usando o modelo `Orcamento` que já existe (leia `server/src/modules/planejamento/routes.ts` para ver como ele guarda o limite por categoria) e o realizado do mês. Categorias com orçamento ou com realizado no mês. |

Sem consulta dentro de laço: carregue os lançamentos do período uma vez e agregue em memória.

---

## e5 — Telas Fluxo de caixa e DRE

**Arquivos**: criar `client/src/modules/empresa-caixa/index.tsx`, `Fluxo.tsx`, `Dre.tsx`, `caixa.css`. Nada mais. Usa as rotas do **e4**.

- `/app/empresa/fluxo` ("Fluxo de caixa", ícone `grafico`, ordem 23): seletor 30/60/90 dias; `ResumoItem` (saldo hoje, entradas previstas, saídas previstas, saldo no fim, menor saldo e em que dia: vermelho se negativo); gráfico de linha do saldo dia a dia (`GraficoLinhas` de `ui/graficos.tsx`; confira as props); tabela dos dias que têm movimento; tabela dos 6 meses; aviso se `vencidosNaoConsiderados` tiver valor ("Há R$ X a receber e R$ Y a pagar vencidos, fora desta projeção").
- `/app/empresa/dre` ("DRE", ícone `documento`, ordem 24): seletor de ano; tabela com as linhas na ordem recebida, 12 meses + total (rolagem horizontal só dentro da tabela; primeira coluna fixa), totais em negrito, valores negativos em vermelho; clicar num grupo abre as categorias dele. Botão "Classificar categorias" abre um modal com a lista de `/empresa/dre/categorias` e uma `Selecao` por categoria (grava com o PUT). Botão Imprimir (`window.print()`).

---

## e6 — Telas Vencidos, Indicadores e Orçado x realizado

**Arquivos**: criar `client/src/modules/empresa-analise/index.tsx`, `Vencidos.tsx`, `Indicadores.tsx`, `Orcado.tsx`, `analise.css`. Nada mais. Usa as rotas do **e4**.

- `/app/empresa/vencidos` ("Inadimplência e vencidos", ícone `sino`, ordem 25): abas "A receber (inadimplência)" e "A pagar"; `ResumoItem` total e as 4 faixas de atraso; tabela por cliente/fornecedor; tabela dos títulos (vencimento, dias de atraso, descrição, parceiro, saldo) com link para `/app/empresa/receber` ou `/pagar`.
- `/app/empresa/indicadores` ("Indicadores", ícone `investimentos`, ordem 26): seletor 3/6/12 meses; um cartão por indicador com o valor, a unidade e uma frase curta explicando o que é e como é calculado; `null` vira "—" com "Sem dados suficientes".
- `/app/empresa/orcado` ("Orçado x realizado", ícone `orcamento` se existir, senão o ícone de `client/src/modules/planejamento/index.tsx`, ordem 25.5): `SeletorMes`; tabela por categoria (orçado, realizado, diferença, % com `BarraProgresso`), despesas e receitas separadas, totais; link "Definir orçamento" para `/app/orcamento`.

---

## e7 — Painel da empresa

**Arquivos**: criar `client/src/modules/empresa-painel/PainelEmpresa.tsx` e `painel-empresa.css` (sem `index.tsx`: o main liga o componente à rota `/app`). Exporta `export function PainelEmpresa()`. Usa `GET /empresa/painel` (e4).

Saudação com o nome do perfil (de `useAcessoPerfil().atual`), `ResumoItem`: Saldo em contas, A receber, A pagar, Resultado do mês; faixa de alerta quando houver vencidos (a receber e a pagar, com link para `/app/empresa/vencidos`); gráfico de barras dos 6 meses (receitas x despesas, `GraficoBarras`); listas "Próximos vencimentos" e "Mais atrasados" (cada item: descrição, parceiro, vencimento, saldo, cor por natureza) com links para `/app/empresa/pagar` e `/receber`; atalhos: Nova conta a pagar, Nova conta a receber, Fluxo de caixa, DRE.

---

## Aceite (todos)

- `npx tsc --noEmit` no lado que você tocou, sem erros nos **seus** arquivos (erro em arquivo de outro gerador que ainda não entregou: ignore e avise).
- Sem `any`, sem `@ts-ignore`, sem dependência nova. CSS só com variáveis do tema; cabe em 360 px.
- O banco local tem dados reais: não rode nada que leia ou grave nele; não rode servidor, docker, npm install nem git. Não abra `backups/`, `drive/`, `atualizacao/` nem `.env`.
- O main não está disponível para dúvidas: siga a opção mais conservadora e registre no resumo. Publique `done` na sala `lote6` e devolva: arquivos, desvios e o que não foi verificado.
