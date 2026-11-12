# Como instalar o sistema financeiro pessoal

Este guia leva você do zero até o sistema funcionando no seu computador. Não precisa saber programar.

## O que você precisa

- **Docker Desktop**: programa que roda o sistema em "caixas" separadas. O instalador oferece instalar para você (no Windows, pelo winget; no Linux, pelo comando oficial; no macOS, pelo Homebrew, se você tiver). Também dá para baixar em https://www.docker.com/products/docker-desktop/.
- **Git**: programa para baixar o projeto. Baixe em https://git-scm.com/downloads. Se não quiser instalar o Git, use o botão "Code" > "Download ZIP" no repositório, descompacte e pule o comando `git clone`.
- Conexão com a internet na primeira instalação (o Docker baixa as dependências automaticamente).

## Jeito 1: pedir para um assistente de IA instalar

Se você usa um assistente com acesso ao terminal (Claude Code, Cursor, Copilot ou outro), copie o texto abaixo e cole no assistente:

> Instale o sistema financeiro pessoal do repositório https://github.com/marco3079/sistema-financeiro-pessoal neste computador seguindo o arquivo AGENTS.md do repositório. Ao terminar, me diga o endereço para abrir no navegador e o e-mail e a senha do titular.

O assistente baixa o projeto, roda o instalador e avisa o endereço do site. A senha inicial do titular é `demo1234` (e-mail `demo@financas.local`); o assistente informa as duas e avisa para trocar a senha no primeiro acesso.

## Jeito 2: com um comando

Abra o terminal (no Windows, o **PowerShell**; no Linux ou macOS, o **Terminal**) e rode os comandos de acordo com o seu sistema.

**Windows (PowerShell):**

```powershell
git clone https://github.com/marco3079/sistema-financeiro-pessoal.git
cd sistema-financeiro-pessoal
powershell -ExecutionPolicy Bypass -File .\instalar.ps1
```

**Linux e macOS (Terminal):**

```bash
git clone https://github.com/marco3079/sistema-financeiro-pessoal.git
cd sistema-financeiro-pessoal
bash instalar.sh
```

O instalador confere o Docker, oferece instalar o que faltar, cria o arquivo `.env` com segredos aleatórios, baixa tudo e sobe o sistema. No fim ele mostra:

- o endereço do site (por exemplo, `http://localhost:8092`);
- o e-mail do titular (`demo@financas.local`);
- a senha do titular (`demo1234`, a senha padrão; troque em "Meu perfil" no primeiro acesso).

Se o instalador parar com uma mensagem, leia a mensagem: ela diz o que fazer. Os códigos de saída estão em `AGENTS.md`.

## Primeiro acesso

1. Abra o endereço do site no navegador.
2. Entre com o e-mail e a senha mostrados no fim da instalação.
3. Troque a senha em **Meu perfil**, no menu do seu nome.
4. Comece por um destes caminhos:
   - **Importar arquivos**: abra **Importar** e envie a fatura do cartão (CSV, OFX ou PDF) e a planilha de movimentação da B3. O sistema detecta o banco e o mês, mostra uma prévia e grava.
   - **Manual**: cadastre suas contas em **Contas**, seus cartões em **Cartões** e seus investimentos em **Investimentos**, e registre os gastos em **Lançamentos**.
5. Defina limites de gasto em **Orçamento** e objetivos em **Metas**.

O sistema começa só com a conta do titular e as categorias padrão.

## Usar no celular

1. Conecte o celular na mesma rede Wi-Fi do computador onde o sistema está rodando.
2. No navegador do celular, abra `http://<IP-do-computador>:8092`. O IP aparece no fim da instalação. Exemplo: `http://192.168.0.10:8092`.
3. Use "Adicionar à tela inicial" para instalar como app.

Só o site fica acessível pela rede. A API e o banco aceitam conexões somente deste computador.

## Atualizar

Entre na pasta do projeto e rode:

```bash
git pull
```

Depois rode o instalador de novo (`.\instalar.ps1` no Windows ou `bash instalar.sh` no Linux e macOS). Os dados do banco são mantidos.

## Parar o sistema

Na pasta do projeto:

```bash
docker compose down
```

Os dados continuam guardados. Para ligar de novo, rode o instalador outra vez.

## Apagar tudo

Atenção: este comando **apaga o banco de dados** (contas, lançamentos, investimentos, tudo).

```bash
docker compose down -v
```

## Problemas comuns

**O Docker não está aberto.** O instalador diz "o Docker está instalado, mas não está rodando". Abra o Docker Desktop, espere ele iniciar e rode o instalador de novo.

**Porta ocupada.** Na primeira instalação, se a porta 8092 (site) ou 3092 (API) já estiver em uso, o instalador escolhe a próxima livre e avisa qual usou. Confira o endereço no fim da instalação. Se já existe um arquivo `.env`, o instalador usa as portas dele e só avisa que estão ocupadas.

**Esqueci a senha do titular.** Se você não trocou a senha, ela é `demo1234`, com o e-mail `demo@financas.local` (ou o que estiver em `ADMIN_EMAIL` no arquivo `.env`). Se você definiu outra senha em `ADMIN_SENHA` no `.env`, ela está lá. Se já trocou e esqueceu, a saída é apagar o banco (`docker compose down -v`, o que apaga todos os dados) e instalar de novo, ou pedir a outro administrador que redefina o acesso.

**O instalador parou com a mensagem "Ja existe um banco de dados desta instalacao" (código 6).** O banco de uma instalação anterior ainda existe, mas o arquivo `.env` com a senha dele não está na pasta. Duas saídas: (a) se você tem o `.env` antigo, copie-o de volta para a pasta do projeto e rode o instalador de novo; (b) se você não precisa mais dos dados antigos, apague o banco com `docker compose down -v` (isso apaga tudo) e rode o instalador de novo. O instalador não apaga nada sozinho.

**A instalação falhou no meio.** Rode o instalador de novo. Ele não sobrescreve o `.env` que já existe.

**Como faço a plataforma enviar e-mails?** O sistema manda e-mails de recuperação de senha, e de boas-vindas a novos usuários, mas só depois de você informar uma conta de e-mail. Entre como titular, abra **Configurações** (no menu, na seção Sistema) e a aba **E-mail**. Preencha o servidor de envio (SMTP), a porta, o usuário e a senha da conta, o e-mail e o nome do remetente, e o endereço do site (por exemplo, `http://localhost:8092`). Marque **Envio de e-mails ligado** e salve. Para conferir, use **Enviar e-mail de teste** com o seu endereço. Se a conta tiver verificação em duas etapas, o provedor costuma pedir uma senha de aplicativo, que você cria no próprio provedor. Os detalhes estão no README, na seção "Como conectar um e-mail".
