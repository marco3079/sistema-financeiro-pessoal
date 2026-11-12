# API

Todas as rotas ficam sob `/api`. Corpo e resposta em JSON.

## Convenções

- **Autenticação**: `Authorization: Bearer <token>`, com o token devolvido pelo login (validade de 12 horas). Rotas marcadas como públicas não pedem token.
- **Erros**: `{ "erro": "mensagem", "detalhes": ... }` com o código HTTP adequado (400 dados inválidos, 401 sem login, 403 sem permissão, 404 não encontrado, 409 duplicado, 429 muitas tentativas).
- **Valores em reais**: números com duas casas (`24.9`). O valor de um lançamento é sempre positivo; o campo `tipo` (`RECEITA` ou `DESPESA`) dá o sentido.
- **Datas**: dia como `AAAA-MM-DD`, mês como `AAAA-MM`, carimbo de hora em ISO 8601.

## Sessão

| Método | Rota | Acesso | O que faz |
|---|---|---|---|
| GET | `/saude` | público | `{ "ok": true }` |
| POST | `/auth/login` | público | `{ email, senha }` → `{ token, usuario }` |
| POST | `/auth/esqueci-senha` | público | envia o link de recuperação, se o e-mail estiver ligado |
| GET | `/auth/redefinir-senha/:token` | público | confere se o link vale |
| POST | `/auth/redefinir-senha` | público | `{ token, novaSenha }` |
| POST | `/auth/sair` | logado | registra a saída |
| GET | `/auth/me` | logado | dados do usuário |
| POST | `/auth/trocar-senha` | logado | `{ senhaAtual, novaSenha }` |

## Usuários e perfil

| Método | Rota | O que faz |
|---|---|---|
| GET | `/usuarios?busca=` | lista os usuários |
| POST | `/usuarios` | `{ nome, email, senha, perfil: "TITULAR" }` |
| PUT | `/usuarios/:id` | `{ nome?, email?, telefone?, ativo? }` |
| POST | `/usuarios/:id/redefinir-senha` | `{ novaSenha }` |
| GET | `/perfil/meu` | dados da própria conta |
| PUT | `/perfil/meu` | `{ telefone }` |
| GET | `/perfil/completo` | conta, números e atividade recente |
| PUT | `/perfil/foto` | `{ foto }` (data URL, endereço http(s) ou `null`) |

As rotas abaixo valem para qualquer usuário logado. Registros com `origem: "OPEN_FINANCE"` são atualizados pela sincronização: neles só se alteram nome, cor e ativo (conta), categoria, observação e transferência (lançamento), nome e ativo (investimento).

## Contas

| Método | Rota | O que faz |
|---|---|---|
| GET | `/contas?tipo=&inativas=true` | lista as contas e os cartões |
| GET | `/contas/resumo` | `{ contas, investimentos, cartoes, patrimonio }` |
| POST | `/contas` | `{ nome, tipo, instituicao?, numero?, saldo?, cor?, bandeira?, limite?, diaFechamento?, diaVencimento? }`; `tipo`: `CORRENTE`, `POUPANCA`, `CARTEIRA`, `INVESTIMENTO` ou `CARTAO` |
| PUT | `/contas/:id` | altera os dados (não o saldo) |
| PUT | `/contas/:id/saldo` | `{ saldo }` ajusta o saldo de uma conta manual |
| DELETE | `/contas/:id` | apaga a conta manual com seus lançamentos e faturas |

## Lançamentos e categorias

| Método | Rota | O que faz |
|---|---|---|
| GET | `/transacoes?mes=&de=&ate=&contaId=&categoriaId=&tipo=&faturaId=&busca=&pagina=&porPagina=` | `{ itens, total, receitas, despesas }`; `categoriaId=0` filtra os sem categoria |
| POST | `/transacoes` | `{ contaId, data, descricao, valor, tipo, categoriaId?, transferencia?, observacao?, totalParcelas? }`; `totalParcelas` (2 a 48) só em despesa de cartão |
| PUT | `/transacoes/:id` | altera o lançamento e refaz saldo e fatura |
| DELETE | `/transacoes/:id` | apaga e desfaz o efeito no saldo |
| GET | `/categorias?tipo=` | lista as categorias |
| POST | `/categorias` | `{ nome, tipo, cor? }` |
| PUT | `/categorias/:id` | `{ nome?, cor? }` |
| DELETE | `/categorias/:id` | apaga; os lançamentos ficam sem categoria |

## Cartões e faturas

| Método | Rota | O que faz |
|---|---|---|
| GET | `/cartoes` | `[{ conta, faturaAtual, percentualUsado }]` |
| GET | `/faturas?contaId=` | faturas, da mais nova para a mais antiga |
| GET | `/faturas/:id` | `{ fatura, transacoes, porCategoria }` |
| POST | `/faturas/:id/pagar` | `{ pagaEm?, contaPagamentoId? }` marca como paga e, com conta, lança a saída |

O cartão é uma conta de tipo `CARTAO`: criar, alterar e excluir é pelas rotas de contas.

## Investimentos

| Método | Rota | O que faz |
|---|---|---|
| GET | `/investimentos?tipo=&inativos=true` | `{ itens, total, aplicado, rendimento, porTipo }` |
| GET | `/investimentos/:id` | `{ investimento, movimentos }` |
| POST | `/investimentos` | `{ nome, tipo, valorAplicado, saldo?, codigo?, subtipo?, instituicao?, emissor?, quantidade?, taxa?, vencimento? }` |
| PUT | `/investimentos/:id` | altera os dados |
| DELETE | `/investimentos/:id` | apaga um investimento manual |
| POST | `/investimentos/:id/movimentos` | `{ data, tipo, valor, quantidade?, descricao? }`; `tipo`: `APLICACAO`, `RESGATE`, `RENDIMENTO` ou `IMPOSTO` |
| DELETE | `/investimentos/:id/movimentos/:movimentoId` | apaga e desfaz o efeito |

## Orçamento e metas

| Método | Rota | O que faz |
|---|---|---|
| GET | `/orcamentos?mes=` | `{ mes, itens, totalLimite, totalGasto, semOrcamento }` |
| PUT | `/orcamentos/:categoriaId` | `{ limite }` cria ou altera o limite mensal |
| DELETE | `/orcamentos/:categoriaId` | remove o limite |
| GET | `/metas` | lista as metas |
| POST | `/metas` | `{ nome, valorAlvo, valorAtual?, prazo?, cor? }` |
| PUT | `/metas/:id` | `{ nome?, valorAlvo?, valorAtual?, prazo?, cor?, concluida? }` |
| DELETE | `/metas/:id` | apaga a meta |

## Open Finance

| Método | Rota | O que faz |
|---|---|---|
| GET | `/openfinance/estado` | `{ configurado, origemCredenciais, clientId, sandbox, conexoes }` |
| PUT | `/openfinance/credenciais` | `{ clientId, clientSecret?, sandbox }`; testa na Pluggy antes de gravar |
| DELETE | `/openfinance/credenciais` | apaga as credenciais gravadas no banco |
| POST | `/openfinance/token` | `{ conexaoId? }` → `{ accessToken, sandbox, itemId }` para abrir o widget |
| POST | `/openfinance/conexoes` | `{ itemId }` registra a conexão e sincroniza |
| POST | `/openfinance/conexoes/:id/sincronizar` | pede nova coleta e importa |
| POST | `/openfinance/sincronizar` | sincroniza todas as conexões |
| DELETE | `/openfinance/conexoes/:id?manterDados=true` | remove a conexão; sem `manterDados`, apaga os dados importados |

O Client Secret nunca é devolvido pela API.

## Painel, busca e avisos

| Método | Rota | O que faz |
|---|---|---|
| GET | `/painel/resumo` | indicadores, patrimônio dos últimos 12 meses, destaque e lançamentos recentes |
| GET | `/busca?q=` | contas, investimentos, lançamentos e categorias |
| GET | `/notificacoes` | fatura vencendo ou atrasada, orçamento estourado, conexão com erro |

## Plataforma e logs

| Método | Rota | Acesso | O que faz |
|---|---|---|---|
| GET | `/plataforma` | público | nome, slogan, logo e cores |
| GET | `/configuracoes` | titular | configurações completas (sem a senha do e-mail) |
| PUT | `/configuracoes/identidade` | titular | nome, slogan, logo e cores |
| PUT | `/configuracoes/email` | titular | servidor de e-mail |
| POST | `/configuracoes/email/teste` | titular | envia um e-mail de teste |
| GET | `/configuracoes/email/historico` | titular | histórico de envios |
| POST | `/logs/tela` | logado | registra a tela aberta |
| GET | `/logs` | titular | log do sistema, com filtros |
| GET | `/logs/resumo` | titular | resumo das atividades |
| GET | `/logs/usuarios/:id/resumo` | titular | atividade de um usuário |
