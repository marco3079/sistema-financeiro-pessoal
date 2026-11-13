# Mini-planos do lote 3

Cada gerador faz só a sua seção. As regras comuns estão em `docs/plano/COMUM-lote3.md`.

---

## g25 — Regras de categoria e reprocessar

**Arquivos**: `server/src/modules/regras/routes.ts`; `client/src/modules/regras/index.tsx`, `Regras.tsx`, `regras.css`.
**Rota do cliente**: `/app/regras`, rótulo `Regras de categoria`, ícone `categorias`, ordem 74.
**Tabela**: `RegraCategoria { id, trecho, categoriaId, criadoEm }` (a importação já aplica essas regras; você faz o cadastro e o reprocessamento).

**API**
- `GET /regras` → `[{ id, trecho, categoriaId, categoriaNome, categoriaCor, categoriaTipo, lancamentos }]` (`lancamentos` = quantos lançamentos não-transferência têm a descrição contendo o trecho; regra com categoria apagada é descartada).
- `POST /regras` `{ trecho (2 a 60 caracteres), categoriaId }` → 201; 409 se já existe regra com o mesmo trecho (comparando sem acento e sem maiúsculas); 400 se a categoria não existe.
- `PUT /regras/:id` `{ trecho?, categoriaId? }`; `DELETE /regras/:id` → 204.
- `POST /regras/reprocessar` `{ aplicar: boolean, sobrescrever: boolean }` → `{ categorizar: [{ id, data, descricao, valor, tipo, categoriaAtual, categoriaNova }], transferencias: [{ id, data, descricao, valor, tipo, contaNome }], aplicado: boolean }`.
  - `categorizar`: lançamentos com `transferencia: false` cuja descrição casa com alguma regra (a primeira por id) e cujo `tipo` é igual ao tipo da categoria da regra; só os sem categoria, ou todos os que mudariam quando `sobrescrever` é true.
  - `transferencias` (Pix pago no crédito, em contas que NÃO são cartão): para cada lançamento `RECEITA` cuja descrição sem acento contém `valor adicionado` e `credito`, ele próprio se ainda não é transferência, mais a `DESPESA` da mesma conta, ainda não transferência, cuja descrição contém a palavra `pix`, com o mesmo valor (diferença até 0,005) e data igual ou até 2 dias depois; cada despesa casa com um crédito só (a mais próxima).
  - Com `aplicar: false` só devolve a prévia. Com `aplicar: true` grava (`categoriaId` e `transferencia: true`) em uma transação e devolve o que gravou. Limite de 2000 itens por lista.
- Comparação de texto sempre sem acento e sem maiúsculas (`normalize('NFD')`, remove `[̀-ͯ]`, `toLowerCase`).

**Tela**: lista das regras (trecho, categoria com cor, quantos lançamentos casam, editar, excluir); `Nova regra` (campo `Quando a descrição contiver` + `Selecao` de categoria agrupando despesa e receita); cartão `Aplicar aos lançamentos que já existem` com a caixa `Trocar também a categoria de quem já tem` e o botão `Ver o que mudaria`, que mostra as duas listas da prévia e o botão `Aplicar` (com confirmação). Depois de aplicar, mostra quantos foram alterados.

**Aceite**: criar a regra `uber` → Transporte e reprocessar categoriza só os lançamentos de despesa com "uber" na descrição e sem categoria; a prévia não grava nada.

---

## g26 — Pasta de entrada (importar sozinho pelo Drive)

**Arquivos**: `server/src/lib/entrada.ts`, `server/src/modules/entrada/routes.ts`; `client/src/modules/entrada/index.tsx`, `Entrada.tsx`, `entrada.css`.
**Rota do cliente**: `/app/entrada`, rótulo `Pasta de entrada`, ícone `importar`, ordem 59.

**Como funciona**: a pasta do Drive é montada no servidor em `/drive` (veja `server/src/lib/drive.ts`, só para entender; não edite). A pasta de entrada é `/drive/financas-pessoais/entrada`. Quem põe um arquivo `.csv` ou `.ofx` ali tem o arquivo importado sozinho; depois ele é movido para `entrada/importados/` (sucesso) ou `entrada/com-erro/` (falha). PDF e XLSX não são tratados aqui (são lidos no navegador): ficam onde estão e aparecem na tela como "envie pela tela Importar".

**Servidor (`lib/entrada.ts`)**
- `export function pastaDeEntradaAtiva(): boolean` → `process.env.PASTA_DRIVE` não vazio.
- `export async function processarEntrada(perfilId: number): Promise<ResultadoEntrada>`: cria as pastas se faltarem; para cada arquivo `.csv`/`.ofx` com mais de 20 segundos desde a última modificação (para não pegar arquivo ainda sincronizando) e até 4 MB: lê como texto (UTF-8; se houver o caractere `�`, relê como latin1); chama a própria API com `chamarApiInterna(perfilId, 'POST', '/importacao/analisar', { nome, formato, texto })` (de `server/src/lib/mcp.ts`); se a resposta não tem `contaSugeridaId` → move para `com-erro` com o motivo `Não identifiquei a conta: importe pela tela`; se for fatura sem `vencimento` → idem com `Não identifiquei o vencimento`; senão chama `/importacao/confirmar` com `{ arquivo: nome, documento, banco, contaId: contaSugeridaId, vencimento, itens }` (os itens sem o campo `jaImportado`, e só os que não são `jaImportado`; se todos já foram importados, move para `importados` com `novos: 0`). Grava ao lado do arquivo movido um `.txt` com o resultado ou o erro. Nunca lança: erros vão para o resultado.
- `ResultadoEntrada = { importados: { arquivo, novos, repetidos }[]; comErro: { arquivo, motivo }[]; ignorados: string[] }`.
- Um laço automático (`iniciarEntrada()`, chamado no topo de `routes.ts`): a cada 2 minutos, para cada perfil (`emCadaPerfil` de `server/src/lib/perfil.ts`), só o PRIMEIRO perfil processa a pasta (a pasta é uma só); use `idsDosPerfis()` e pegue `ids[0]`. Duas execuções ao mesmo tempo compartilham a mesma promessa.
- Segurança: use só nomes vindos de `fs.readdir` com `path.basename`; ignore pastas, links simbólicos e nomes que começam com ponto.

**API**: `GET /entrada` → `{ ativa, pasta: 'financas-pessoais/entrada', aguardando: string[], naoSuportados: string[], ultimos: ResultadoEntrada | null }`; `POST /entrada/processar` → roda agora e devolve o mesmo.

**Tela**: se `!ativa`, explica que precisa conectar o Drive (link para `/app/drive`). Se ativa: como usar (3 passos), arquivos aguardando, não suportados, resultado da última rodada (importados com contagens, com erro e o motivo) e o botão `Processar agora`.

**Aceite**: com `PASTA_DRIVE` vazio a tela só explica; nenhum arquivo é apagado (só movido); arquivo que falha não é tentado de novo.

---

## g27 — Contas a pagar e a receber, e fluxo de caixa projetado

**Arquivos**: `server/src/modules/agenda/routes.ts`; `client/src/modules/agenda/index.tsx`, `Agenda.tsx`, `agenda.css`.
**Rota do cliente**: `/app/agenda`, rótulo `Contas a pagar`, ícone `calendario`, ordem 26.
**Tabelas**: `ContaFixa { id, descricao, tipo (DESPESA = a pagar, RECEITA = a receber), valor, diaDoMes, categoriaId?, contaId?, ativa }` e `PagamentoContaFixa { id, contaFixaId, mes, pagoEm }`.

**API**
- CRUD `/contas-fixas` (`GET`, `POST`, `PUT /:id`, `DELETE /:id`): `{ descricao, tipo, valor > 0, diaDoMes 1..31, categoriaId?, contaId?, ativa? }`.
- `GET /agenda?mes=AAAA-MM` → `{ mes, itens: [{ chave, origem: 'FATURA' | 'CONTA_FIXA', id, descricao, tipo, valor, data, situacao: 'PAGA' | 'ABERTA' | 'ATRASADA', contaFixaId? , faturaId? }], aPagar, aReceber, pago, emAberto }`. Entram: faturas do mês pelo vencimento (descrição `Fatura <nome do cartão>`, tipo DESPESA, situação pelo `status`) e cada conta fixa ativa no dia `diaDoMes` (em mês curto, o último dia), paga se houver `PagamentoContaFixa` daquele mês; atrasada se a data já passou e não foi paga.
- `POST /contas-fixas/:id/pagar` `{ mes }` → marca como paga naquele mês (não cria lançamento; só marca). `DELETE /contas-fixas/:id/pagar?mes=AAAA-MM` → desfaz.
- `GET /fluxo?meses=6` (3, 6 ou 12) → `{ saldoInicial, meses: [{ mes, entradas, saidas, faturas, saldoFinal }] }`. `saldoInicial` = soma do saldo das contas ativas que não são cartão. Para o mês corrente e os seguintes: `entradas` = contas fixas `RECEITA` ainda não recebidas; `saidas` = contas fixas `DESPESA` ainda não pagas; `faturas` = faturas não pagas com vencimento no mês MAIS as parcelas futuras previstas — pegue de `chamarApiInterna(perfilAtual() ?? 1, 'GET', '/cartoes/previsao')` (`server/src/lib/mcp.ts` e `perfilAtual` de `lib/prisma`), campo `meses: [{ mes, lancado, previsto, total }]`, e use `total` de cada mês (não some as faturas duas vezes: use só a previsão para a parte de cartão). `saldoFinal` acumula mês a mês.

**Tela**: `Abas` `Calendário` e `Fluxo de caixa`. Calendário: `SeletorMes`, resumo (a pagar, a receber, em aberto), lista por dia com selo da situação e botão `Marcar como paga` / `Desfazer` nas contas fixas; cartão `Contas fixas` com criar, editar e excluir. Fluxo: seletor de meses, `GraficoLinhas` do `saldoFinal`, tabela (mês, entradas, saídas, faturas, saldo final com cor pelo sinal) e o aviso `Projeção com o que já está cadastrado: contas fixas, faturas e parcelas. Gastos do dia a dia não entram.`

**Aceite**: uma conta fixa de dia 31 aparece no dia 28/29/30 nos meses curtos; marcar e desfazer funciona; o fluxo não conta fatura em dobro.

---

## g28 — Detector de cobrança estranha

**Arquivos**: `server/src/modules/alertas/routes.ts`; `client/src/modules/alertas/index.tsx`, `Alertas.tsx`, `alertas.css`.
**Rota do cliente**: `/app/alertas`, rótulo `Cobranças estranhas`, ícone `sino`, ordem 27.
**Sem tabela nova** (só leitura dos lançamentos dos últimos 13 meses, `tipo: 'DESPESA'`, `transferencia: false`).

**API**: `GET /alertas` → `{ alertas: [{ tipo, gravidade: 'alta' | 'media', titulo, texto, lancamentos: [{ id, data, descricao, valor, contaNome }] }], analisados: number }`. Regras (nome do estabelecimento = descrição sem a marca de parcela `Parcela 2/5`, ` - 2/5`, `2 de 5` no fim, sem acento, minúsculas):
1. `DUPLICADA` (alta): mesma conta, mesmo estabelecimento, mesmo valor, mesma data, sem parcela → dois ou mais lançamentos.
2. `AUMENTO` (media): estabelecimento que aparece em 3 meses ou mais, uma vez por mês, com valor estável (variação até 5%) nos meses anteriores, e cujo último valor subiu mais de 10% sobre a média anterior.
3. `PARCELA_A_MAIS` (alta): lançamento com `parcela > totalParcelas`, ou duas cobranças da MESMA parcela (mesmo estabelecimento, mesmo `totalParcelas`, mesmo número de parcela, mesmo valor) em faturas diferentes.
4. `ASSINATURA_NOVA` (media): estabelecimento com cobrança estável nos últimos 2 meses que não existia nos 6 meses anteriores (pode ser assinatura nova ou teste grátis que virou cobrança).
Ordene por gravidade e, dentro dela, pelo maior valor. Cada lançamento entra em no máximo um alerta de cada tipo.

**Tela**: resumo (quantos alertas, quantos lançamentos analisados), um cartão por alerta com selo (`Atenção` para alta, `Confira` para media), título, texto e a lista dos lançamentos (data, descrição, conta, valor) com link `Ver nos lançamentos` (`/app/transacoes`). Sem alertas: `<Vazio>` com `Nada estranho encontrado`. Texto fixo no fim: `São indícios calculados pelos seus lançamentos. Confira na fatura antes de contestar uma cobrança.`

**Aceite**: sem lançamentos devolve lista vazia; compras parceladas normais (1/3, 2/3, 3/3) não geram alerta.

---

## g29 — Relatório mensal para imprimir

**Arquivos**: `client/src/modules/relatorio-mensal/index.tsx`, `RelatorioMensal.tsx`, `relatorio-mensal.css`. **Sem servidor.**
**Rota do cliente**: `/app/relatorio-mensal`, rótulo `Relatório do mês`, ícone `documento`, ordem 28.

**Dados** (rotas que já existem): `GET /transacoes?mes=AAAA-MM&porPagina=200` (`{ itens, total, receitas, despesas }`; busque as páginas seguintes até acabar, no máximo 10), `GET /contas`, `GET /cartoes`, `GET /faturas`, `GET /orcamentos?mes=AAAA-MM`, `GET /carteira/proventos?meses=12` (use `historico` para os proventos do mês). Confira os tipos reais nas telas que já usam essas rotas.

**Tela** (uma página, pensada para papel A4): `SeletorMes` e botão `Imprimir ou salvar em PDF` (`window.print()`); título `Relatório de <mês por extenso>`; resumo (receitas, despesas, saldo do mês, proventos do mês); `Gastos por categoria` (tabela ordenada do maior para o menor, com % e, quando houver orçamento, limite e quanto sobrou ou estourou); `Maiores gastos` (10 maiores lançamentos); `Faturas do mês` (cartão, vencimento, total, situação); `Saldo das contas` (hoje); rodapé `Gerado em <data e hora>`. Transferências não entram em receitas, despesas nem nas tabelas.

**Impressão**: `@media print` no seu CSS escondendo menu, topo, navegação inferior e os controles (use os nomes reais das classes em `client/src/layout/casca.css`; veja como `client/src/modules/carteira/aba-relatorio.css` fez). `!important` é permitido só dentro do `@media print`. Cartões com `break-inside: avoid`.

**Aceite**: mês sem lançamentos mostra `<Vazio>`; os totais batem com `receitas` e `despesas` devolvidos pela API.

---

## g30 — Carteira-alvo

**Arquivos**: `server/src/modules/alvo/routes.ts`; `client/src/modules/alvo/index.tsx`, `Alvo.tsx`, `alvo.css`.
**Rota do cliente**: `/app/alvo`, rótulo `Carteira-alvo`, ícone `investimentos`, ordem 39.
**Tabela**: `AlocacaoAlvo { id, classe, percentual }`, classes `RENDA_VARIAVEL`, `RENDA_FIXA`, `FUNDOS`, `OUTROS`.

**API**
- `GET /alvo` → `{ total, definido: boolean, classes: [{ classe, rotulo, saldo, atual (%), alvo (% ou null), desvio (pontos percentuais, atual − alvo, ou null), diferenca (reais: saldo − total × alvo / 100, ou null) }] }`. Saldo por classe a partir de `prisma.investimento` ativos: `ACAO`, `FII`, `ETF` → `RENDA_VARIAVEL`; `RENDA_FIXA` → `RENDA_FIXA`; `FUNDO`, `PREVIDENCIA` → `FUNDOS`; `CRIPTO`, `OUTRO` → `OUTROS`. Rótulos: `Renda variável`, `Renda fixa`, `Fundos`, `Outros`. Sempre as quatro classes.
- `PUT /alvo` `{ classes: [{ classe, percentual 0..100 }] }` → exige as quatro classes e soma 100 (tolerância 0,01), senão 400 `Os percentuais precisam somar 100%`. Troca tudo em uma transação.
- `DELETE /alvo` → apaga o alvo.

**Tela**: resumo (total investido, maior desvio); quatro linhas com rótulo, barra do percentual atual com um marcador do alvo, `atual`, `alvo`, `desvio` (cor pelo sinal) e `diferença em reais` (`acima do alvo em R$ X` / `abaixo do alvo em R$ X`); formulário `Definir alvo` com os quatro campos de percentual, a soma ao vivo e `Salvar` desabilitado se não der 100; botão `Remover alvo`. Texto fixo: `A tela só mostra a distância entre a carteira e o alvo que você definiu. Não é recomendação de compra ou venda.`

**Aceite**: sem investimentos, `total` 0 e a tela mostra `<Vazio>`; sem alvo, `alvo`, `desvio` e `diferenca` vêm `null`.

---

## g31 — Imposto de renda (apoio à declaração)

**Arquivos**: `server/src/modules/ir/routes.ts`; `client/src/modules/ir/index.tsx`, `IR.tsx`, `ir.css`.
**Rota do cliente**: `/app/ir`, rótulo `Imposto de renda`, ícone `investimentos`, ordem 43.
**Sem tabela nova**: usa `Investimento` (inclusive os inativos, `ativo: false`) e `MovimentoInvestimento` (`tipo` `APLICACAO` = compra, `RESGATE` = venda, `RENDIMENTO` = provento; `valor` total em reais, `quantidade` pode ser null).

**Cálculo** (por ativo com `tipo` `ACAO`, `FII` ou `ETF` e código de bolsa `^[A-Z]{4}\d{1,2}$`; movimentos em ordem de data e, no mesmo dia, compras antes de vendas):
- mantém `quantidade` e `custoTotal`. Compra: soma os dois. Venda com quantidade `q` e valor `v`: `custoMedio = custoTotal / quantidade`; `custoDaVenda = custoMedio × q`; `resultado = v − custoDaVenda`; subtrai `q` e `custoDaVenda`. Movimento sem `quantidade`, ou venda maior que a quantidade em mãos: o ativo é marcado `incompleto: true` e suas vendas não entram nos totais.
- Classe fiscal: `ACAO` → `ACOES`; `FII` → `FII`; `ETF` → `ETF`.

**API**: `GET /ir?ano=AAAA` (padrão: ano atual) →
```
{ ano,
  meses: [{ mes, classes: [{ classe, vendas, resultado }], vendasAcoes, isentoAcoes: boolean }],   // só meses com venda
  posicoes: [{ id, codigo, nome, tipo, quantidade, custoTotal, custoMedio }],   // em 31/12 do ano, quantidade > 0
  proventos: [{ id, codigo, nome, total }],   // RENDIMENTO recebido no ano, por ativo, total > 0
  totais: { vendas, resultado, proventos },
  incompletos: [{ codigo, motivo }],
  anos: number[] }   // anos que têm movimento
```
`isentoAcoes` = `vendasAcoes <= 20000` no mês (regra de isenção de ações no mercado à vista). NÃO calcule o imposto devido nem compense prejuízo: devolva só vendas e resultado.

**Tela**: seletor de ano; aviso fixo no topo (`tipo="info"`): `Apoio à declaração: os valores são calculados pelos movimentos importados e podem ter diferença em relação à nota de corretagem (taxas, desdobramentos, operações no mesmo dia). Confira com os informes da corretora. O sistema não calcula o imposto a pagar.`; resumo (total vendido, resultado, proventos); `Vendas por mês` (mês, classe, vendido, resultado com cor pelo sinal, e o selo `Ações: vendas até R$ 20 mil no mês` quando `isentoAcoes`); `Posição em 31/12` (código, nome, quantidade, custo médio, custo total: é o valor da ficha "Bens e direitos"); `Proventos recebidos no ano`; e, se houver, `Ativos com histórico incompleto` com o motivo. Botão `Imprimir` (`window.print()`).

**Aceite**: ano sem movimentos devolve listas vazias; uma compra de 10 por R$ 100 e uma venda de 4 por R$ 60 dá custo da venda 40 e resultado 20, sobrando 6 com custo 60.

---

## g32 — Importar investimentos de fora da B3 por planilha

**Arquivos**: `client/src/modules/investimentos/ImportarPlanilha.tsx`, `client/src/modules/investimentos/importar-planilha.css`, e editar `client/src/modules/investimentos/Investimentos.tsx` (só para acrescentar o botão `Importar planilha` ao lado de `Novo investimento` e abrir o modal). **Sem servidor** (usa `POST /investimentos`, que já existe: veja o `criarSchema` em `server/src/modules/investimentos/routes.ts`).

**Componente**: `export function ImportarPlanilha({ aberto, aoFechar, aoConcluir }: { aberto: boolean; aoFechar: () => void; aoConcluir: () => void })`, um `Modal` com:
1. Explicação e o botão `Baixar modelo` (gera no navegador um CSV com o cabeçalho e duas linhas de exemplo, separado por `;`, com BOM UTF-8).
2. Colunas do modelo: `nome;tipo;instituicao;valor_aplicado;saldo;taxa;vencimento;codigo`. `tipo`: `RENDA_FIXA`, `FUNDO`, `ACAO`, `FII`, `ETF`, `PREVIDENCIA`, `CRIPTO`, `OUTRO` (aceite também os rótulos em português da lista `TIPOS_INVESTIMENTO` de `lib/financas`, sem diferenciar maiúsculas e acentos). Valores em reais com vírgula ou ponto (`lerValor`). `vencimento` em `DD/MM/AAAA` ou `AAAA-MM-DD`, opcional. `saldo` vazio = igual ao valor aplicado.
3. Campo de arquivo (`.csv`), lido com `FileReader` como texto; detecte o separador (`;` ou `,`) pela primeira linha; aceite campos entre aspas.
4. Prévia em `Tabela` com uma coluna `Situação`: `OK` ou o erro da linha (`Nome obrigatório`, `Tipo desconhecido`, `Valor inválido`, `Data inválida`). Linhas com erro não são enviadas.
5. Botão `Importar N investimentos`: envia um por vez com `api.post('/investimentos', ...)`, mostra o progresso (`3 de 10`) e, no fim, quantos entraram e quais falharam (com a mensagem da API). Depois chama `aoConcluir()`.

**Aceite**: arquivo sem a coluna `nome` é recusado com mensagem clara; até 200 linhas; nada é enviado antes do clique em `Importar`.

---

## g33 — Conciliação dos cartões

**Arquivos**: `server/src/modules/conciliacao/routes.ts`; `client/src/modules/conciliacao/index.tsx`, `Conciliacao.tsx`, `conciliacao.css`.
**Rota do cliente**: `/app/conciliacao`, rótulo `Conciliação`, ícone `cartao`, ordem 31.
**Sem tabela nova.** Regra do produto: a dívida de um cartão (`Conta.saldo`, tipo `CARTAO`) deve ser igual à soma do `total` das faturas não pagas dele; o `total` de uma fatura deve ser igual à soma dos lançamentos dela (`DESPESA` soma, `RECEITA` subtrai; transferências também contam, pois o pagamento da fatura anterior entra como crédito — confira em `recalcularFatura` de `server/src/lib/financas.ts` qual é a conta exata e use a MESMA).

**API**
- `GET /conciliacao` → `{ cartoes: [{ contaId, nome, origem, saldo, faturasNaoPagas, diferenca (saldo − faturasNaoPagas), faturas: [{ id, vencimento, status, total, somaDosLancamentos, diferenca }], semFatura: [{ id, data, descricao, valor, tipo }] }], divergencias: number }`. `semFatura` = lançamentos do cartão com `faturaId` null. Só entram na contagem diferenças com valor absoluto maior que 0,01.
- `POST /conciliacao/:contaId/corrigir` → só para cartão com `origem: 'MANUAL'`: chama `recalcularFatura(db, id)` para cada fatura do cartão e grava `saldo` = soma das faturas não pagas (e `limiteDisponivel` = `limite − saldo`, mínimo 0, quando há limite), tudo em uma transação; devolve o item do cartão recalculado. Não cria nem apaga lançamentos, e não mexe em `semFatura`.

**Tela**: resumo (cartões, divergências); um cartão por conta com `Dívida registrada`, `Soma das faturas não pagas`, `Diferença` (verde `Tudo certo` ou vermelho com o valor), a tabela das faturas (vencimento, situação, total, soma dos lançamentos, diferença) e, se houver, a lista `Lançamentos sem fatura` com a explicação `Estes lançamentos estão no cartão mas não entraram em nenhuma fatura, por isso a dívida não bate.` Botão `Corrigir dívida e totais` (com confirmação explicando o que será recalculado), só quando há diferença e o cartão é manual.

**Aceite**: cartão sem divergência mostra `Tudo certo` e não mostra o botão; `corrigir` em conta que não é cartão devolve 400.

---

## g36 — Lançamento rápido pelo celular

**Arquivos**: `client/src/modules/rapido/index.tsx`, `Rapido.tsx`, `rapido.css`. **Sem servidor** (`POST /transacoes`: veja o `criarTransacaoSchema` em `server/src/modules/transacoes/routes.ts`).
**Rota do cliente**: `/app/rapido`, rótulo `Lançar rápido`, ícone `raio`, ordem 15.

**Tela** (pensada para o polegar, uma coluna, botões grandes de no mínimo 48 px de altura):
1. Alternador grande `Gasto` / `Receita` (padrão `Gasto`).
2. Campo de valor enorme, `inputMode="decimal"`, com foco automático ao abrir.
3. Categorias como botões (chips) do tipo escolhido, as 8 mais usadas primeiro (conte nos últimos 200 lançamentos de `GET /transacoes?porPagina=200`) e `Ver todas`.
4. Contas e cartões como botões; lembra a última usada em `localStorage['financas.rapido.conta']` (em try/catch).
5. `Descrição` opcional (se vazia, usa o nome da categoria; sem categoria, `Lançamento rápido`) e data (padrão hoje, com atalhos `Hoje` e `Ontem`).
6. Botão `Lançar` fixo no rodapé da área de conteúdo, desabilitado sem valor ou sem conta. Depois de gravar: aviso `Lançado: R$ X em <categoria>` com `Desfazer` (apaga o lançamento com `DELETE /transacoes/:id`) por 8 segundos, e o formulário volta ao início mantendo conta e tipo.
7. Abaixo, `Últimos lançados aqui` (os 5 desta sessão, só no estado do componente).

**Aceite**: valor `12,5` vira 12.5; dois toques rápidos em `Lançar` não criam dois lançamentos (o botão desabilita enquanto envia); funciona em 360 px sem rolagem horizontal.

---

## g35 — Verificação em duas etapas no login

**Arquivos**: `server/src/lib/totp.ts`, `server/src/modules/seguranca/routes.ts`, editar `server/src/modules/auth/routes.ts` (só a rota `/auth/login`); `client/src/modules/seguranca/index.tsx`, `Seguranca.tsx`, `seguranca.css`, e editar `client/src/layout/Login.tsx` e `client/src/lib/auth.tsx` (só o necessário para o segundo passo).
**Rota do cliente**: `/app/seguranca`, rótulo `Segurança`, ícone `cadeado`, ordem 99.
**Campos que já existem em `Usuario`**: `totpAtivo Boolean`, `totpSegredoCifrado String?`, `totpRecuperacao String?` (JSON com os hashes sha256 dos códigos de recuperação não usados).

**`lib/totp.ts`** (RFC 6238, só com `crypto` do Node; sem dependência): `gerarSegredo(): string` (20 bytes aleatórios em base32, sem `=`), `codigoEm(segredo: string, instante: number): string` (HMAC-SHA1, passo de 30 s, 6 dígitos), `conferirCodigo(segredo: string, codigo: string): boolean` (aceita o passo atual e um antes ou depois; comparação com `crypto.timingSafeEqual`), `enderecoOtpauth(segredo, email, emissor): string` (`otpauth://totp/<emissor>:<email>?secret=...&issuer=...&algorithm=SHA1&digits=6&period=30`, com `encodeURIComponent`), `gerarCodigosDeRecuperacao(): { codigos: string[]; hashes: string[] }` (8 códigos `xxxx-xxxx` em letras e números sem ambiguidade). Teste de aceite: com o segredo base32 `GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ` e instante 59 000 ms, `codigoEm` devolve `287082` (vetor da RFC 6238).

**API (`modules/seguranca`)**, sempre para `req.usuario.id`:
- `GET /seguranca/2fa` → `{ ativo, codigosDeRecuperacaoRestantes }`.
- `POST /seguranca/2fa/iniciar` → gera o segredo, grava CIFRADO (`cifrar` de `server/src/lib/cripto.ts`) com `totpAtivo` ainda false e devolve `{ segredo, otpauth }`. 409 se já está ativo.
- `POST /seguranca/2fa/ativar` `{ codigo }` → confere com o segredo pendente; se certo, `totpAtivo = true`, gera os códigos de recuperação, grava os hashes e devolve `{ codigosDeRecuperacao: string[] }` (única vez). Código errado → 400.
- `POST /seguranca/2fa/desativar` `{ senha, codigo }` → confere a senha (bcrypt, como no login) e um código do aplicativo OU de recuperação; apaga segredo e códigos.
- Limite: no máximo 5 tentativas erradas por usuário a cada 10 minutos nessas rotas (mapa em memória) → 429.

**Login (`auth/routes.ts`)**: o corpo passa a aceitar `codigo` opcional. Depois de a senha conferir, se o usuário tem `totpAtivo`: sem `codigo` → responda `401` com `{ erro: 'Informe o código de verificação', precisaCodigo: true }` (sem token); com `codigo` → aceite um código do aplicativo ou um de recuperação (o de recuperação é consumido: remova o hash); errado → `401` `{ erro: 'Código incorreto', precisaCodigo: true }` e conte como falha no limitador de tentativas que a rota já tem. Se a variável de ambiente `DESATIVAR_2FA` for `true`, o segundo passo é ignorado (saída de emergência para quem perdeu o aparelho; documente no comentário). Se o segredo não puder ser decifrado (o `JWT_SECRET` mudou), trate como 2FA desligado e registre um `console.warn`. Não mude mais nada no login.

**Cliente**: `Login.tsx` — quando a resposta do login traz `precisaCodigo`, mostra o segundo passo na mesma tela: campo `Código de verificação` (`inputMode="numeric"`, `autoComplete="one-time-code"`), texto `Abra o aplicativo autenticador e digite o código de 6 dígitos, ou use um código de recuperação.` e botões `Entrar` e `Voltar`; reenvia e-mail, senha e código. Veja em `client/src/lib/auth.tsx` e `client/src/lib/api.ts` como o erro chega (o corpo do erro pode não estar disponível: se precisar, faça o `fetch('/api/auth/login')` do segundo passo direto no `auth.tsx`, sem mudar `api.ts`). `Seguranca.tsx` — estado atual; `Ativar` → mostra o QR code (biblioteca `qrcode`, que já está no `package.json`: `QRCode.toDataURL(otpauth)`) e o segredo em texto, pede o primeiro código, e ao ativar mostra os 8 códigos de recuperação com `Copiar` e o aviso `Guarde estes códigos: eles não aparecem de novo.`; `Desativar` pede senha e código.

**Aceite**: usuário sem 2FA entra exatamente como hoje; o segredo nunca volta na API depois de ativado; os códigos de recuperação ficam só como hash; `npx tsc --noEmit` nos dois lados.

---

## g37 — Divisão de gastos

**Arquivos**: `server/src/modules/divisoes/routes.ts`; `client/src/modules/divisoes/index.tsx`, `Divisoes.tsx`, `divisoes.css`.
**Rota do cliente**: `/app/divisoes`, rótulo `Divisão de gastos`, ícone `grupo`, ordem 29.
**Tabela**: `Divisao { id, transacaoId, pessoa, valor, quitadoEm?, criadoEm }` (a parte de um lançamento que outra pessoa deve a você).

**API**
- `GET /divisoes` → `{ pessoas: [{ pessoa, emAberto, quitado, itens: [{ id, transacaoId, data, descricao, valorDoLancamento, valor, quitadoEm }] }], totalEmAberto }` (agrupa por `pessoa` sem diferenciar maiúsculas; descarta divisões cujo lançamento não existe mais; itens do mais recente para o mais antigo).
- `POST /divisoes` `{ transacaoId, partes: [{ pessoa (1 a 40 caracteres), valor > 0 }] }` → o lançamento precisa existir e ser `DESPESA`; a soma das partes (mais as que já existem para o lançamento) não pode passar do valor do lançamento → 400 `As partes passam do valor do lançamento`.
- `POST /divisoes/:id/quitar` → `quitadoEm = agora`; `POST /divisoes/:id/reabrir` → `null`; `DELETE /divisoes/:id` → 204.
- `GET /divisoes/lancamentos?busca=` → até 30 despesas recentes (não transferência) para escolher: `[{ id, data, descricao, valor, contaNome, jaDividido (soma das partes) }]`.

**Tela**: resumo (`A receber`, pessoas); `Nova divisão`: busca e escolha do lançamento, depois as partes — atalhos `Dividir igualmente entre N pessoas` (você conta como uma: com 2 pessoas, a outra deve metade) e partes livres com nome e valor; mostra `Sua parte: R$ X`. Lista por pessoa com o total em aberto e os itens (data, descrição, valor da parte, `Marcar como recebido` / `Reabrir`, excluir). Botão `Copiar resumo` por pessoa, que copia um texto como `Fulano, você me deve R$ 120,00: Mercado 05/11 (R$ 80,00), Uber 07/11 (R$ 40,00).`

**Aceite**: não deixa dividir mais do que o valor do lançamento; apagar o lançamento faz a divisão sumir da lista sem erro.
