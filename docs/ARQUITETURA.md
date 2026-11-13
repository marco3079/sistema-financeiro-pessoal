# Arquitetura

Como o Sistema Financeiro Pessoal é montado: contêineres, módulos, autenticação, modelo de dados, regras de saldo e fatura, e a integração com o Open Finance.

## Contêineres

| Contêiner | Imagem ou build | Função | Porta |
|---|---|---|---|
| `db` | `postgres:16-alpine` | Banco PostgreSQL | `127.0.0.1:DB_PORT` (padrão 5434) |
| `api` | build de `server/` | API HTTP (Node 20, Express 4, Prisma 5) | `127.0.0.1:API_PORT` (padrão 3092) |
| `web` | build de `client/` | Site estático no nginx, que encaminha `/api/` para a API | `WEB_PORT` (padrão 8092) |

Na subida, a API aplica o modelo de dados (`prisma db push`), e, se o banco estiver vazio, cria a conta do titular e as categorias padrão (`prisma/seed.ts`). Nenhum dado financeiro é criado.

## Módulos do servidor

`server/src/app.ts` carrega toda pasta de `server/src/modules/` que tenha um `routes.ts`. O `export default` de cada um é um roteador montado em `/api` com autenticação; `export const publico` é um roteador sem autenticação (login, saúde, identidade da tela de entrada).

| Módulo | Rotas |
|---|---|
| `auth` | login, saída, senha por e-mail |
| `cadastros` | usuários e Meu perfil |
| `contas` | contas e resumo do patrimônio |
| `transacoes` | lançamentos e categorias |
| `cartoes` | cartões, faturas e pagamento de fatura |
| `investimentos` | investimentos e movimentos |
| `planejamento` | orçamento e metas |
| `importacao` | leitura e gravação de fatura, extrato e planilha da B3; cotações |
| `perfis` | perfis financeiros |
| `carteira` | resumo, análises, relatório e proventos da carteira |
| `drive` | sincronização dos dados por pasta do Drive |
| `mcp` | ponto de acesso MCP e cadastro das chaves |
| `atualizacao` | versão instalada, novidades do GitHub e pedido de atualização |
| `analise` | dashboard de gastos e ganhos com sugestões |
| `rendimento` | comparação com os índices, renda fixa pela taxa e projeção |
| `rede` | endereço para abrir no celular |
| `openfinance` | credenciais da Pluggy, token do widget, conexões e sincronização |
| `painel` | resumo do painel, avisos do sino e busca |
| `plataforma` | identidade visual e e-mail |
| `logs` | log de atividades |

Código compartilhado em `server/src/lib/`: `erros.ts` (`HttpError`, `asyncHandler`, `validar` com zod), `auth.ts` (JWT), `cripto.ts` (AES-256-GCM para segredos no banco), `financas.ts` (datas, dinheiro, formatos de resposta e regras), `pluggy.ts` e `sincronizacao.ts`.

## Autenticação

Login por e-mail e senha (bcrypt) devolve um JWT de 12 horas, enviado em `Authorization: Bearer`. Há limite de tentativas de login. Só existe o perfil `TITULAR`: todos os usuários veem e alteram os mesmos dados, porque as finanças são da casa, não de cada usuário.

## Modelo de dados

Fonte da verdade: `server/prisma/schema.prisma`.

| Tabela | O que guarda |
|---|---|
| `Conta` | Contas (corrente, poupança, carteira, investimento) e cartões de crédito (`tipo = CARTAO`) |
| `Transacao` | Lançamentos. `valor` é sempre positivo; `tipo` diz se é `RECEITA` ou `DESPESA` |
| `Categoria` | Categorias de receita e de despesa |
| `Fatura` | Faturas de cartão, uma por vencimento |
| `Investimento`, `MovimentoInvestimento` | Posições e seus movimentos |
| `PosicaoPatrimonio` | Fotografia diária do patrimônio, para o gráfico do painel |
| `Orcamento`, `Meta` | Limite mensal por categoria e metas |
| `ConexaoBancaria` | Uma conexão do Open Finance (um "item" da Pluggy) |
| `Usuario`, `LogAtividade`, `ConfiguracaoPlataforma`, `TokenSenha`, `EmailEnviado` | Sistema |

Convenções:

- Dinheiro é `Decimal(14,2)` no banco e `number` na API.
- Datas "só dia" trafegam como `AAAA-MM-DD`; mês como `AAAA-MM`.
- `Conta.saldo` de um cartão é a dívida em aberto (positiva).
- Patrimônio = contas que não são cartão + investimentos − dívida dos cartões.
- `Transacao.transferencia = true` marca movimento entre contas próprias ou pagamento de fatura: fica fora de receitas, despesas e orçamento.
- `origem` é `MANUAL` ou `OPEN_FINANCE`.

## Regras de saldo e de fatura (registros manuais)

- Criar, alterar ou excluir um lançamento manual ajusta o saldo da conta na mesma transação do banco (`efeitoNoSaldo`): em conta comum, receita soma e despesa subtrai; em cartão, despesa aumenta a dívida.
- Compra no cartão entra na fatura do ciclo (`cicloDaFatura`): fecha neste mês se a compra foi até o dia de fechamento, senão no mês seguinte; vence no primeiro dia de vencimento depois do fechamento. A fatura é criada quando recebe a primeira compra e o total é refeito a cada mudança.
- Compra parcelada gera uma transação por mês; a última parcela absorve o resto do arredondamento.
- Pagar uma fatura a marca como paga, reduz a dívida do cartão e, se uma conta for indicada, lança nela a saída como transferência.
- As faturas mudam de situação sozinhas: aberta, fechada depois do fechamento, atrasada depois do vencimento.

## Perfis financeiros

Um login pode ter vários perfis (`PerfilFinanceiro`). Os modelos de dados financeiros (`Conta`, `Categoria`, `Transacao`, `Fatura`, `Investimento`, `MovimentoInvestimento`, `PosicaoPatrimonio`, `Orcamento`, `Meta`, `Importacao`, `ConexaoBancaria`) têm a coluna `perfilId` (padrão 1, sem chave estrangeira, para um banco antigo ganhar a coluna sem migração manual).

O filtro fica em um lugar só, `server/src/lib/prisma.ts`: o middleware `escolherPerfil` (`lib/perfil.ts`) lê o cabeçalho `X-Perfil` e guarda o perfil da requisição em um `AsyncLocalStorage`; uma extensão do Prisma acrescenta `perfilId` ao `where` de toda leitura, alteração e exclusão e ao `data` de toda criação nesses modelos. As rotas não repetem o filtro.

- Consulta em SQL puro (`$queryRaw`) não passa pela extensão: se for criada uma, ela precisa filtrar por `perfilAtual()`.
- Tarefas de fundo (cotações, índices) rodam uma vez por perfil com `emCadaPerfil`; a sincronização do Open Finance roda dentro do perfil dono da conexão.
- O nome da categoria pode repetir entre perfis: a conferência de duplicado é feita na rota, não por índice único.

## Rendimento e índices

`lib/indices.ts` grava em `IndicePonto` o nível acumulado de cada índice por dia (Selic e IPCA do Banco Central, Ibovespa e IFIX da B3), de modo que o retorno entre duas datas é a razão entre dois níveis. `lib/rendimento.ts` monta os fluxos de caixa de cada investimento a partir dos movimentos (aplicação entra, resgate e provento saem) e calcula: o valor que esses fluxos teriam hoje seguindo cada índice; a taxa interna de retorno da carteira e de cada índice; o saldo da renda fixa pela taxa escrita no cadastro; e a projeção de 12 meses.

## Patrimônio dos meses passados

A fotografia diária do patrimônio (`PosicaoPatrimonio`) só existe a partir da instalação. Para o gráfico do painel, os meses anteriores são reconstruídos em `patrimonioEstimado` (`lib/carteira.ts`): investimentos pela quantidade e pelo preço da época, saldo das contas voltando os lançamentos posteriores e dívida do cartão pelas faturas fechadas e ainda não pagas naquele dia.

## Carteira

`lib/carteira.ts` monta, sobre os dias úteis (os mesmos da série da Selic), o valor da carteira em cada dia: quantidade reconstruída pelos movimentos × fechamento do ativo (`PrecoAtivo`, buscado do Yahoo Finance por código, uma vez a cada 6 horas). O retorno do dia é `(valor de hoje − aplicações + resgates + proventos) / valor de ontem − 1`; variações acima de 40% em um dia são tratadas como falha de dado. Meses, anos, extremos e estatísticas saem do encadeamento desses retornos. Ativo sem preço histórico cresce de forma uniforme do valor aplicado até o saldo. A agenda de proventos é uma estimativa: quem pagou em nove ou mais dos últimos doze meses repete a média dos três últimos pagamentos; os demais repetem o calendário do último ano.

## Drive

`lib/drive.ts` sincroniza o banco inteiro com uma pasta montada em `/drive` (`PASTA_DRIVE`). A pasta guarda `dados.json.gz` (todas as tabelas de dados, menos log, tokens de senha, e-mails, índices e preços) e `estado.json` (versão, data, computador e sha256). `EstadoDrive` é local: última versão vista e se há alteração a enviar (marcada em `app.ts` depois de cada requisição que altera dados). A cada 20 segundos: versão igual e alteração local → grava; versão nova na pasta sem alteração local → carrega (troca o conteúdo das tabelas em uma transação e acerta as sequências); os dois mudaram → vale a mais recente e a outra é copiada como `conflito-...`. Na primeira conexão de um computador que já tem dados, nada é trocado até a pessoa escolher o lado. O arquivo só é carregado quando o sha256 confere, para não ler um arquivo ainda chegando.

## MCP

`lib/mcp.ts` implementa o lado servidor do Model Context Protocol sobre HTTP, sem biblioteca: cada POST em `/api/mcp` traz uma mensagem JSON-RPC e recebe a resposta em JSON. A credencial é uma chave (`ChaveMcp`: só o sha256 fica gravado) ligada a um perfil financeiro e a uma permissão. Cada ferramenta valida os argumentos com zod e chama a própria API REST do sistema em `127.0.0.1`, com um token interno de dois minutos e o cabeçalho `X-Perfil` da chave: a IA passa pelas mesmas regras de validação, de saldo e de perfil que a tela. As ferramentas de escrita só aparecem em `tools/list` e só são aceitas em `tools/call` para chaves `ESCRITA`. As chaves não viajam pelo Drive: cada computador tem as suas.

## Atualização

O servidor não executa comandos no computador. `atualizar.ps1` (no computador) e o módulo `atualizacao` (no contêiner) conversam por três arquivos na pasta `atualizacao/`: `versao.json` (commit instalado, ramo e repositório, gravado pelo script), `estado.json` (situação e o batimento do vigia) e `pedido.json` (gravado pela API quando a pessoa clica em Atualizar). O vigia, uma tarefa do Windows, apaga o pedido e roda sempre a mesma sequência: cópia do banco, `git pull --ff-only` do repositório de origem e `docker compose up -d --build`. A API compara a versão instalada com o GitHub (`/repos/.../compare`), valida o conteúdo de `versao.json` antes de montar a URL e guarda a resposta por 5 minutos.

## Lote 4

- **Usuário somente leitura**: `enum Perfil { TITULAR LEITOR }` e `Usuario.perfilFinanceiroId`. `autenticar` (`lib/auth.ts`) normaliza o caminho (minúsculas, barras repetidas) e recusa escrita e áreas de administração; `escolherPerfil` usa o perfil do cadastro. No cliente, `App.tsx` tira as telas do leitor do menu, da busca e das rotas.
- **Eventos do ativo** (`EventoAtivo`): desdobramento, grupamento e bonificação com data e fator. `lib/carteira.ts` multiplica a quantidade de cada movimento pelos fatores dos eventos posteriores a ele; sem eventos, vale o ajuste por aproximação antigo.
- **Imposto estimado** (`modules/ir`): mês a mês, por classe, com prejuízo acumulado e a isenção das vendas de ações até R$ 20 mil.
- **Cupom** (`modules/cupom`): SDK oficial `@anthropic-ai/sdk`, saída estruturada validada com zod; a rota só devolve a sugestão.
- **Avisos** (`lib/avisos.ts`): agendador diário (8h) por perfil; `AvisoEnviado` guarda a chave de cada aviso para não repetir e fica fora do arquivo do Drive (cada computador controla os próprios envios).
- **Menu** (`client/src/layout/grupos.ts`): grupos definidos por caminho; rotas com `menu: false` saem do menu e aparecem nas centrais (`modules/centrais`) e na busca.
- **Aplicativo instalável**: `manifest.webmanifest` e `sw.js` em `client/public`; `URL_PUBLICA` entra em `GET /rede`.

## Importação de arquivos

O navegador abre o arquivo (`client/src/modules/importar/lerArquivo.ts`): CSV e OFX viram texto; o PDF vira texto com uma linha por linha da página (pdf.js); o XLSX vira uma matriz por aba. Só esse conteúdo vai para a API, em dois passos:

1. **Analisar** (`POST /importacao/analisar` ou `/importacao/b3/analisar`): interpreta e devolve uma prévia. Nada é gravado.
2. **Confirmar** (`POST /importacao/confirmar` ou `/importacao/b3/confirmar`): grava os itens que o usuário deixou marcados.

Fatura e extrato (`server/src/lib/importacao/extrato.ts`):

- O banco sai do nome do arquivo ou do texto; o vencimento sai do nome do arquivo, do texto do PDF ou, na falta, é estimado.
- CSV: o cabeçalho é a primeira linha com coluna de data e de valor; há leitura de parcela ("Parcela 2/5", "5 de 6").
- Em fatura, valor positivo é compra e negativo é pagamento ou estorno; o pagamento da fatura anterior entra como transferência.
- Compra parcelada que vem com a data original avança mês a mês até cair no ciclo da fatura.
- Além da chave, um item é tratado como já registrado quando a conta tem um lançamento com a mesma data, valor, tipo e descrição que não veio deste arquivo (digitado à mão, de outro arquivo ou do Open Finance).
- Cada lançamento recebe uma chave (`Transacao.chaveImportacao`, um hash de conta, data, descrição, valor e ordem): o que já existe é ignorado.
- Todos os lançamentos do arquivo vão para a fatura daquele vencimento; a dívida do cartão passa a ser a soma das faturas não pagas.
- O registro gravado é `MANUAL`: pode ser editado e recategorizado.
- Cada lançamento, movimento e ativo criado guarda o `importacaoId` do arquivo de origem. Remover uma importação apaga só esses registros: desfaz o efeito no saldo da conta, recalcula as faturas (apaga a que ficar vazia) e recoloca a dívida do cartão como a soma das faturas não pagas. Na B3, sai só o ativo que a planilha criou; quantidade e saldo dos ativos que ela apenas atualizou não são desfeitos. Importações anteriores a esse campo são ligadas pelo instante da gravação.
- No extrato, o Pix pago no crédito vira transferência nos dois lados: o crédito "Valor adicionado na conta por cartão de crédito" e a saída por Pix de mesmo valor em até dois dias.

Planilha da B3 (`server/src/lib/importacao/b3.ts`):

- Movimentação: processa as linhas em ordem de data. "Transferência - Liquidação" é compra ou venda (custo médio); desdobro, bonificação, atualização, cisão e incorporação mudam a quantidade; rendimento, dividendo e JCP viram movimentos de rendimento. Direitos e recibos de subscrição ficam de fora.
- A quantidade de cada provento informa quantas cotas havia naquele dia: quando ela não bate com a conta, ou o ativo não tem evento há mais de um ano, a posição é marcada como suspeita.
- Posição: lê cada aba pelo nome das colunas.
- Os investimentos gravados são `MANUAL`, reconhecidos pelo código de negociação; os movimentos têm chave própria (`MovimentoInvestimento.chaveImportacao`).

Cotações (`server/src/lib/cotacoes.ts`): para cada investimento manual com código de bolsa e quantidade, busca o preço na brapi.dev e grava saldo = quantidade × preço. Roda ao importar a planilha, pelo botão e a cada 8 horas.

O histórico fica em `Importacao` (arquivo, tipo, banco, referência, quantos novos e repetidos).

## Open Finance (Pluggy)

```mermaid
sequenceDiagram
  participant N as Navegador
  participant A as API
  participant P as Pluggy
  N->>A: POST /openfinance/token
  A->>P: POST /auth e POST /connect_token
  A-->>N: accessToken
  N->>P: widget Pluggy Connect (login no banco)
  P-->>N: item.id
  N->>A: POST /openfinance/conexoes { itemId }
  A->>P: GET /items, /accounts, /bills, /v2/transactions, /investments
  A-->>N: conexão sincronizada
```

- **Credenciais**: Client ID e Client Secret ficam em `ConfiguracaoPlataforma` (segredo cifrado) ou no `.env`. A chave de API da Pluggy vale 2 horas e fica em memória.
- **Widget**: o navegador abre o Pluggy Connect (`pluggy-connect-sdk`) com um token de 30 minutos criado no servidor. A senha do banco é digitada no widget; o sistema recebe só o id do item.
- **Importação** (`lib/sincronizacao.ts`): cada registro é reconhecido pelo id da Pluggy (`pluggyAccountId`, `pluggyBillId`, `pluggyTransactionId`, `pluggyInvestmentId`), então sincronizar de novo atualiza em vez de duplicar. A primeira carga busca 365 dias de lançamentos; as seguintes, 90.
- **Contas**: `BANK` vira corrente ou poupança; `CREDIT` vira cartão, com limite, bandeira e dias de fechamento e vencimento.
- **Faturas**: as fechadas vêm de `/bills`. A em aberto é montada com o saldo do cartão e a data de vencimento informada. Como a Pluggy não diz se a fatura foi paga, vale o pagamento registrado ou o vencimento já ter passado.
- **Lançamentos**: `DEBIT` vira despesa e `CREDIT` vira receita. A categoria da Pluggy é traduzida para uma categoria padrão quando há correspondência. Pagamento de fatura e movimento entre contas próprias entram como transferência.
- **Investimentos**: tipo e subtipo da Pluggy viram o tipo do sistema; o valor aplicado usa o valor original informado ou o saldo menos o lucro. Posição que deixa de vir é marcada como inativa.
- **O que é do usuário não é sobrescrito**: nome e cor da conta, nome do investimento, categoria, observação e marcação de transferência.
- **Quando sincroniza**: ao conectar, pelo botão, um minuto depois de o servidor subir e a cada 6 horas. Antes de ler, o servidor pede à Pluggy uma nova coleta e espera até 90 segundos.
- **Remover conexão**: apaga o item na Pluggy (revoga o consentimento) e apaga os dados importados, ou os mantém como manuais.

## Cliente

- Cada módulo é `client/src/modules/<modulo>/index.tsx` e exporta `rotas`; `App.tsx` junta tudo com `import.meta.glob`. O ícone da rota define o grupo do menu (`layout/grupos.ts`).
- Chamadas à API passam por `lib/api.ts` (prefixo `/api`, token, mensagem de erro). `useDados` busca e recarrega.
- Componentes em `ui/index.tsx` (página, tabela que vira cartões no celular, campos, modal, abas) e `ui/financas.tsx` (indicador, seletor de mês, valor colorido, barra de progresso, rosca).
- Cores, raios e sombras vêm de variáveis em `ui/estilo.css`, com valores para os temas claro e escuro. As cores primárias podem ser trocadas em Configurações.

## Log de atividades

Toda requisição autenticada é registrada (usuário, ação, módulo, caminho, status, IP), sem corpo, senha nem token. Registros com mais de 90 dias são apagados.
