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

## Importação e cotações

| Método | Rota | O que faz |
|---|---|---|
| POST | `/importacao/analisar` | `{ nome, formato, texto, documento?, contaId? }` (`formato`: `csv`, `ofx` ou `pdf`) → prévia com banco, vencimento, total, itens e conta sugerida |
| POST | `/importacao/confirmar` | `{ arquivo, documento, banco, contaId ou novaConta, vencimento?, saldoFinal?, itens }` → `{ novos, repetidos, contaId, faturaId }` |
| GET | `/importacao/historico` | últimos 50 arquivos importados |
| GET | `/importacao/:id` | o registro do histórico e os lançamentos (ou movimentos da B3) que o arquivo trouxe e ainda existem |
| DELETE | `/importacao/:id` | apaga o que o arquivo trouxe, acerta saldos e faturas e tira a linha do histórico; devolve `{ lancamentos, movimentos, investimentos, faturas }` |
| POST | `/importacao/b3/analisar` | `{ nome, planilhas: [{ nome, linhas }] }` → posições, movimentos e avisos |
| POST | `/importacao/b3/confirmar` | `{ arquivo, tipo, periodo, posicoes, movimentos, encerradas }` → quantos criados, atualizados e movimentos novos |
| GET | `/cotacoes/estado` | `{ configurado, origemToken, ativosComCodigo, ultimaAtualizacao }` |
| PUT | `/cotacoes/token` | `{ token }`; testa na brapi antes de gravar |
| DELETE | `/cotacoes/token` | apaga o token gravado no banco |
| POST | `/cotacoes/atualizar` | atualiza o saldo dos ativos com código de bolsa |

O corpo das rotas de importação pode ter até 12 MB. O token das cotações nunca é devolvido pela API.

## Perfis financeiros

Todas as rotas autenticadas respondem dentro de um perfil financeiro. O cliente escolhe o perfil pelo cabeçalho `X-Perfil: <id>`; sem o cabeçalho (ou com um id que não existe), vale o perfil mais antigo.

| Método | Rota | O que faz |
|---|---|---|
| GET | `/perfis` | lista os perfis com `atual`, quantidade de contas e de investimentos e o patrimônio |
| POST | `/perfis` | `{ nome, cor? }`; cria o perfil com as categorias padrão |
| PUT | `/perfis/:id` | `{ nome?, cor? }` |
| DELETE | `/perfis/:id` | apaga o perfil e todos os dados dele; recusa apagar o último |

## Análise, rendimento e rede

| Método | Rota | O que faz |
|---|---|---|
| GET | `/analise?meses=3\|6\|12\|24` | receitas e gastos por mês, por categoria e por estabelecimento, gastos recorrentes, resumo dos investimentos e `sugestoes` (`area`: `GASTOS`, `RECEITAS` ou `INVESTIMENTOS`) |
| GET | `/rendimento` | carteira, classes e ativos comparados com Selic, IPCA, Ibovespa e IFIX; renda fixa estimada pela taxa; projeção de 12 meses |
| POST | `/rendimento/atualizar` | busca os índices de novo e devolve o relatório recalculado |
| GET | `/cartoes/previsao` | parcelas ainda não cobradas, por cartão e por mês, somadas às faturas em aberto |
| GET | `/rede` | `{ porta, enderecos: [{ rotulo, url }] }` para o QR code de acesso pelo celular |

## Carteira e Drive

| Método | Rota | O que faz |
|---|---|---|
| GET | `/carteira?meses=6\|12\|24\|60\|0&classe=RENDA_VARIAVEL\|RENDA_FIXA\|FUNDOS\|OUTROS` | resumo, períodos, série diária, meses, anos, extremos, estatísticas, classes, instituições e ativos (`meses=0` = desde o início) |
| GET | `/carteira/proventos?meses=...` | histórico, mapa de calor, proventos por ativo e agenda (recebidos e previstos) |
| GET | `/drive/estado` | pasta, situação, última sincronização, pendência e conflito |
| POST | `/drive/sincronizar` | roda um ciclo de sincronização agora |
| POST | `/drive/escolher` | `{ origem: "PASTA" \| "COMPUTADOR" }`: qual lado vale na primeira conexão de um computador que já tinha dados |

## MCP (assistentes de IA)

| Método | Rota | O que faz |
|---|---|---|
| POST | `/mcp` | mensagem JSON-RPC do Model Context Protocol; credencial em `Authorization: Bearer fin_...` (não usa o login) |
| POST | `/mcp/fin_...` | o mesmo, com a chave no caminho, para aplicativos que só aceitam um endereço |
| GET | `/mcp/chaves` | chaves do perfil em uso (sem o texto da chave) e as ferramentas oferecidas |
| POST | `/mcp/chaves` | `{ nome, permissao: "LEITURA" \| "ESCRITA" }`; a resposta traz `chave` uma única vez |
| DELETE | `/mcp/chaves/:id` | apaga a chave |

Métodos atendidos em `/mcp`: `initialize`, `ping`, `tools/list` e `tools/call`; notificações recebem 202. `GET` e `DELETE` devolvem 405 (não há fluxo de eventos nem sessão).

## Atualização

| Método | Rota | O que faz |
|---|---|---|
| GET | `/atualizacao` | versão instalada, último commit do GitHub, commits que faltam, se o atualizador está ligado e a situação da última atualização (`?conferir=1` consulta o GitHub na hora) |
| POST | `/atualizacao/pedir` | grava o pedido para o atualizador do computador; 400 se ele não está ligado, 409 se já há uma atualização em andamento |

## Lote 3: rotinas do dia a dia, investimentos e segurança

| Método | Rota | O que faz |
|---|---|---|
| GET, POST, PUT, DELETE | `/regras`, `/regras/:id` | regras de categoria (`{ trecho, categoriaId }`) |
| POST | `/regras/reprocessar` | `{ aplicar, sobrescrever }` → prévia ou aplicação das regras e do Pix no crédito aos lançamentos existentes |
| GET, POST | `/entrada`, `/entrada/processar` | situação da pasta de entrada e processamento imediato |
| GET, POST, PUT, DELETE | `/contas-fixas`, `/contas-fixas/:id` | contas fixas a pagar e a receber |
| POST, DELETE | `/contas-fixas/:id/pagar` | marca ou desmarca como paga em um mês |
| GET | `/agenda?mes=AAAA-MM` | faturas e contas fixas do mês, com a situação |
| GET | `/fluxo?meses=3\|6\|12` | saldo projetado mês a mês |
| GET | `/alertas` | indícios de cobrança estranha |
| GET, PUT, DELETE | `/alvo` | carteira-alvo por classe e o desvio |
| GET | `/ir?ano=AAAA` | vendas por mês, posição em 31/12 e proventos do ano |
| GET | `/conciliacao` | dívida de cada cartão contra as faturas e os lançamentos |
| POST | `/conciliacao/:contaId/corrigir` | recalcula os totais das faturas e a dívida do cartão |
| GET, POST, DELETE | `/divisoes`, `/divisoes/:id` | partes de um lançamento que outra pessoa deve |
| POST | `/divisoes/:id/quitar`, `/divisoes/:id/reabrir` | marca como recebido ou reabre |
| GET | `/seguranca/2fa` | estado da verificação em duas etapas |
| POST | `/seguranca/2fa/iniciar`, `/ativar`, `/desativar` | configura, ativa (devolve os códigos de recuperação uma vez) e desativa |
| GET | `/atualizacao/copias` | cópias do banco na pasta `backups` |
| POST | `/atualizacao/restaurar` | `{ arquivo }` → pede a restauração ao atualizador |

`POST /auth/login` aceita `codigo` opcional; com a verificação em duas etapas ativa e sem código (ou com código errado) responde 401 com `precisaCodigo: true`.

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
