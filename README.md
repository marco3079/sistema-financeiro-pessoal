<p align="center"><img src="client/public/logo-simbolo.svg" alt="Finanças Pessoais" width="120"></p>

<h1 align="center">Sistema Financeiro Pessoal</h1>

<p align="center">Contas, faturas do cartão e investimentos em um único app web. Você envia o arquivo do banco e a planilha da B3, e o sistema organiza.</p>

<p align="center">
  <img src="https://img.shields.io/badge/licen%C3%A7a-MIT-blue" alt="Licença MIT">
  <img src="https://img.shields.io/badge/docker-compose-2496ED?logo=docker&logoColor=white" alt="Docker Compose">
  <img src="https://img.shields.io/badge/Node-20-339933?logo=node.js&logoColor=white" alt="Node 20">
  <img src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black" alt="React 18">
  <img src="https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white" alt="PostgreSQL 16">
</p>

<p align="center"><img src="docs/imagens/painel-claro.png" alt="Painel inicial" width="900"></p>

## Sumário

- [Visão geral](#visão-geral)
- [Funcionalidades](#funcionalidades)
- [Telas](#telas)
- [Instalação rápida](#instalação-rápida)
- [Primeiro acesso](#primeiro-acesso)
- [Importar arquivos](#importar-arquivos)
- [Open Finance (opcional)](#open-finance-opcional)
- [Configuração](#configuração)
- [Arquitetura](#arquitetura)
- [Desenvolvimento](#desenvolvimento)
- [Origem](#origem)
- [Segurança](#segurança)
- [Licença](#licença)

## Visão geral

O Sistema Financeiro Pessoal reúne, num painel só, o saldo das contas, as faturas do cartão de crédito, a carteira de investimentos, o orçamento do mês e as metas. Os dados entram de três jeitos: **importando o arquivo** que o banco exporta (fatura e extrato em CSV, OFX ou PDF) e a planilha da Área do Investidor da B3; digitando à mão; ou, para quem tiver acesso, pelo Open Finance da [Pluggy](https://pluggy.ai). Funciona no computador e no celular, com tema claro e escuro.

Você instala no seu computador (ou num servidor seu) com Docker. Os dados ficam no seu banco PostgreSQL.

## Funcionalidades

**Importação de arquivos**

- Fatura do cartão e extrato da conta em **CSV, OFX ou PDF**: o sistema detecta o banco, o mês da fatura, as parcelas e o pagamento da fatura anterior, e mostra uma prévia antes de gravar.
- Formatos conferidos com arquivos reais: CSV de fatura do Nubank e da XP. Os demais bancos passam pelo leitor genérico (colunas de data, descrição e valor; OFX; PDF por aproximação).
- Reenviar o mesmo arquivo não duplica lançamentos.
- Categoria automática pela descrição e pelo que você já classificou antes.
- **Planilha da B3** (movimentação ou posição, em XLSX): monta a carteira com quantidade e custo médio, importa compras, vendas e proventos, e traz desmarcados os ativos que parecem ter saído da carteira.
- **Cotações automáticas** de ações, fundos imobiliários e ETFs pela brapi.dev, a cada 8 horas.
- O arquivo é lido no navegador; o servidor recebe só o conteúdo e não guarda o arquivo.

**Open Finance (opcional)**

- Conexão com bancos, cartões e corretoras pelo widget da Pluggy. A senha do banco é digitada na janela da Pluggy e nunca passa pelo sistema.
- Traz contas e saldos, cartões com limite e datas, **faturas do cartão** com cada compra e parcela, lançamentos dos últimos 12 meses e a **carteira de investimentos** com posição e movimentos.
- Sincronização ao conectar, por botão e automática a cada 6 horas. Sincronizar de novo atualiza os registros, sem duplicar.
- O que você ajusta num registro do banco é preservado: nome e cor da conta, categoria, observação e marcação de transferência do lançamento.
- Acesso somente leitura: o sistema não faz pagamentos nem transferências.

**Contas e lançamentos**

- Contas corrente, poupança, carteira e conta de investimento, com patrimônio calculado.
- Lançamentos por mês, com filtros por conta, categoria e tipo, busca na descrição e totais de receitas, despesas e saldo.
- Transferências entre contas próprias e pagamento de fatura não contam como receita nem despesa.
- Categorias com cor, criadas e editadas por você. Uma lista padrão vem pronta.

**Cartões e faturas**

- Cartões com limite, dia de fechamento e de vencimento.
- Cada compra entra na fatura certa pelo ciclo do cartão. Compras parceladas geram uma parcela por fatura.
- Detalhe da fatura com as compras, o total por categoria e o pagamento debitando de uma conta.
- Situação da fatura: aberta, fechada, paga ou atrasada.

**Investimentos**

- Renda fixa, fundos, ações, fundos imobiliários, ETFs, previdência e criptomoedas.
- Valor aplicado, saldo, rendimento e rentabilidade de cada posição e da carteira.
- Gráfico de alocação por tipo e as maiores posições.
- Movimentos de aplicação, resgate, rendimento e imposto.

**Planejamento**

- Orçamento: limite mensal por categoria, com barra de progresso e os gastos sem limite definido.
- Metas com valor alvo, valor guardado e prazo.

**Painel e sistema**

- Painel com patrimônio, saldo em contas, investimentos e despesas do mês, evolução do patrimônio em 12 meses, lançamentos recentes e a próxima fatura.
- Sino de avisos: fatura vencendo ou atrasada, orçamento estourado e conexão que precisa ser refeita.
- Busca no topo por contas, lançamentos, investimentos e telas.
- Usuários, log de atividades, identidade visual (nome, logo e cores) e envio de e-mails de recuperação de senha.

## Telas

| | |
|---|---|
| ![Lançamentos](docs/imagens/lancamentos.png) | ![Cartões e faturas](docs/imagens/cartoes.png) |
| ![Investimentos](docs/imagens/investimentos.png) | ![Orçamento](docs/imagens/orcamento.png) |
| ![Importar arquivos](docs/imagens/importar.png) | ![Painel no tema escuro](docs/imagens/painel-escuro.png) |

Os dados dos prints são fictícios. O sistema é instalado vazio, só com a conta demo e as categorias padrão.

## Instalação rápida

Você precisa do [Docker Desktop](https://www.docker.com/products/docker-desktop/) instalado e aberto.

```
git clone https://github.com/marco3079/sistema-financeiro-pessoal.git
cd sistema-financeiro-pessoal
```

- Windows (PowerShell): `powershell -ExecutionPolicy Bypass -File .\instalar.ps1`
- Linux e macOS: `bash instalar.sh`

O instalador confere o Docker, cria o arquivo `.env` com segredos aleatórios e sobe os contêineres. No fim, mostra o endereço do site (padrão `http://localhost:8092`).

O passo a passo completo, com perguntas frequentes, está em [INSTALAR.md](INSTALAR.md). Para instalar com a ajuda de um assistente de IA, veja [AGENTS.md](AGENTS.md).

## Primeiro acesso

- E-mail: `demo@financas.local`
- Senha: `demo1234`

Troque a senha em **Meu perfil** logo no primeiro acesso. Depois, envie a fatura do cartão e a planilha da B3 em **Importar**, ou cadastre suas contas à mão em **Contas**.

## Importar arquivos

Abra **Importar** e arraste os arquivos (pode enviar vários de uma vez).

**Fatura do cartão e extrato da conta**

1. No aplicativo ou no site do banco, exporte a fatura (ou o extrato) em CSV ou OFX. Se só houver PDF, envie o PDF.
2. O sistema mostra o banco detectado, o vencimento, o total e cada lançamento. Confira, escolha o cartão (ou deixe criar um) e confirme.
3. Fatura com vencimento já passado entra como paga; as demais ficam em aberto e somam na dívida do cartão.

O nome do arquivo ajuda: `Nubank_2026-11-08.csv` já diz o banco e o vencimento. PDF é lido por aproximação e não funciona com PDF protegido por senha nem com imagem digitalizada.

**Investimentos (B3)**

A B3 não oferece API para pessoa física (a API da Área do Investidor é vendida só a empresas), mas deixa baixar planilhas:

1. Entre em [investidor.b3.com.br](https://www.investidor.b3.com.br), abra **Extratos > Movimentação**, filtre o período mais longo possível e baixe em Excel.
2. Envie o XLSX em **Importar**. O sistema calcula a posição de cada ativo somando compras, vendas, desdobramentos e bonificações, e importa os proventos.
3. Confira a lista: ativos sem movimento há mais de um ano, ou cuja quantidade não bate com o último provento, vêm desmarcados.

A planilha de **Posição** também é aceita (carteira do dia, com o valor atualizado). O leitor dela foi escrito pelo formato conhecido e ainda não foi conferido com um arquivo real.

**Cotações**

Crie um token gratuito em [brapi.dev](https://brapi.dev) e cole no cartão **Cotações automáticas** da tela Importar (ou em `BRAPI_TOKEN` no `.env`). O saldo de cada ação, fundo imobiliário e ETF passa a ser quantidade × preço, atualizado a cada 8 horas. Renda fixa e Tesouro não têm cotação: o saldo fica o que você informar.

## Open Finance (opcional)

Para puxar dados reais, a Pluggy exige uma conta com acesso de produção (contas de teste só conectam o banco fictício). Se você tiver esse acesso, a tela **Conexões** continua disponível.

A conexão com os bancos é feita pela Pluggy, uma empresa de agregação de dados financeiros. Você precisa de um par de credenciais dela (Client ID e Client Secret):

1. Crie uma conta em [dashboard.pluggy.ai](https://dashboard.pluggy.ai) e crie uma aplicação.
2. Copie o **Client ID** e o **Client Secret** da aplicação.
3. No sistema, abra **Conexões**, clique em **Configurar credenciais** e cole os dois valores. O sistema testa as credenciais na hora e guarda o segredo cifrado.
4. Clique em **Conectar instituição**, escolha seu banco, cartão ou corretora e siga os passos na janela da Pluggy.

Ao terminar, o sistema busca contas, cartões, faturas, lançamentos e investimentos. Isso pode levar até um minuto.

**Para uso pessoal, sem custo:** a Pluggy oferece o [Meu Pluggy](https://meu.pluggy.ai), em que você conecta os seus próprios bancos pelo Open Finance e libera a leitura para a sua aplicação pelo conector "MeuPluggy". O guia está em [meu.pluggy.ai/api-guide](https://meu.pluggy.ai/api-guide). Os conectores diretos de Open Finance para aplicações comerciais são um plano pago da Pluggy.

**Para testar sem banco real:** em **Conexões**, marque **Mostrar bancos de teste** nas credenciais e conecte o **Pluggy Bank** com usuário `user-ok` e senha `password-ok`.

As credenciais também podem vir do arquivo `.env` (`PLUGGY_CLIENT_ID` e `PLUGGY_CLIENT_SECRET`).

Limites conhecidos:

- A Pluggy não informa se uma fatura foi paga. O sistema considera paga a fatura que tem pagamento registrado ou cujo vencimento já passou.
- A fatura em aberto é montada a partir do saldo do cartão e das compras ainda sem fatura fechada.
- A sincronização foi escrita a partir da documentação da Pluggy e ainda não foi validada com todos os bancos. Depois da primeira sincronização, confira saldos e faturas com o aplicativo do banco.

## Configuração

O arquivo `.env` (criado pelo instalador a partir de [.env.example](.env.example)) guarda:

| Variável | Para que serve | Padrão |
|---|---|---|
| `POSTGRES_PASSWORD` | Senha do banco | aleatória |
| `JWT_SECRET` | Segredo dos logins e da cifra dos segredos guardados no banco | aleatório |
| `ADMIN_NOME`, `ADMIN_EMAIL`, `ADMIN_SENHA` | Conta do titular criada na primeira subida | `Demo`, `demo@financas.local`, `demo1234` |
| `WEB_PORT` | Porta do site | `8092` |
| `API_PORT` | Porta da API (só neste computador) | `3092` |
| `DB_PORT` | Porta do banco (só neste computador) | `5434` |
| `BRAPI_TOKEN` | Token das cotações (opcional; também dá para informar na tela) | vazio |
| `PLUGGY_CLIENT_ID`, `PLUGGY_CLIENT_SECRET` | Credenciais do Open Finance (opcional; também dá para informar na tela) | vazias |
| `PLUGGY_SANDBOX` | `true` mostra os bancos de teste da Pluggy | `false` |

Se você trocar o `JWT_SECRET`, os segredos cifrados no banco (senha do e-mail e Client Secret da Pluggy) deixam de abrir e precisam ser digitados de novo.

Nome, logo, cores e conta de e-mail ficam em **Configurações**, dentro do sistema.

## Arquitetura

Três contêineres: `db` (PostgreSQL 16), `api` (Node 20, Express, Prisma) e `web` (site React servido pelo nginx, que também encaminha `/api`).

```
server/
  prisma/schema.prisma            modelo de dados
  src/lib/financas.ts             regras de saldo, fatura e patrimônio
  src/lib/importacao/             leitura de fatura, extrato e planilha da B3
  src/lib/cotacoes.ts             cotações (brapi.dev)
  src/lib/pluggy.ts               cliente HTTP da Pluggy
  src/lib/sincronizacao.ts        importação do Open Finance
  src/modules/<modulo>/routes.ts  rotas de cada módulo
client/
  src/layout/                     casca (menu, topo), painel e login
  src/ui/                         componentes e estilos
  src/modules/<modulo>/           telas de cada módulo
```

Detalhes em [docs/ARQUITETURA.md](docs/ARQUITETURA.md) e a lista de rotas em [docs/API.md](docs/API.md).

## Desenvolvimento

```
cd server && npm install && npx tsc --noEmit
cd client && npm install && npx tsc --noEmit && npx vite build
```

Para rodar fora do Docker: suba só o banco (`docker compose up -d db`), copie `server/.env.example` para `server/.env`, rode `npx prisma db push` e `npm run dev` em `server/`, e `npm run dev` em `client/`.

Como contribuir: [CONTRIBUTING.md](CONTRIBUTING.md).

## Origem

Este projeto usa a mesma estrutura e a mesma interface do [Sistema Escolar](https://github.com/marco3079/sistema-escolar) e do [Sistema de Restaurante](https://github.com/marco3079/sistema-restaurante): a casca (menu lateral, topo, painel, login), os componentes, o log de atividades, os usuários e as configurações vêm de lá. Os módulos financeiros, a importação de arquivos e a integração com o Open Finance são novos.

## Segurança

Veja [SECURITY.md](SECURITY.md). Em resumo: troque a senha padrão, não exponha o sistema à internet sem HTTPS e lembre que ele guarda dados financeiros seus.

## Licença

[MIT](LICENSE).
