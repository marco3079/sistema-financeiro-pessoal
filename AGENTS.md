# Instruções para assistentes de IA: instalar o sistema financeiro pessoal

Você recebeu o pedido de instalar este sistema para uma pessoa. Siga estas instruções passo a passo, no terminal do computador dela.

## O que é

Sistema financeiro pessoal (contas, cartões, investimentos e Open Finance) com site (React), API (Node.js) e banco PostgreSQL, tudo rodando em contêineres Docker.

## Instalar

1. Se o repositório ainda não estiver na máquina, clone e entre na pasta:
   ```
   git clone https://github.com/marco3079/sistema-financeiro-pessoal.git
   cd sistema-financeiro-pessoal
   ```
2. Rode o instalador:
   - Windows (PowerShell): `powershell -ExecutionPolicy Bypass -File .\instalar.ps1`
   - Linux e macOS: `bash instalar.sh`
3. O script faz tudo sozinho: confere o Docker, cria o arquivo `.env` com segredos aleatórios, baixa as dependências (o Docker baixa as imagens e instala os pacotes) e sobe os contêineres. Na primeira vez pode levar vários minutos.

Opções úteis: `-Demo` no Windows ou `--demo` no Linux/macOS carrega dados de demonstração fictícios (só para teste). Portas: `-PortaWeb N` e `-PortaApi N` (ou `--porta-web N` e `--porta-api N`). `-SemPerguntas` ou `--sem-perguntas` faz o script não pedir confirmação.

## Códigos de saída do instalador

- **0**: instalado. Vá para "Como confirmar".
- **2**: Docker não está instalado. Oriente a pessoa a instalar o Docker Desktop (https://www.docker.com/products/docker-desktop/), abri-lo e esperar iniciar. Depois rode o instalador de novo. No Windows, o script pode oferecer instalar pelo winget; aceite só se a pessoa concordar.
- **3**: Docker instalado, mas não está rodando (ou falta o Compose). Peça para abrir o Docker Desktop e esperar o ícone ficar estável; depois rode de novo.
- **4**: falha ao subir os contêineres. O script mostra as últimas linhas do log. Leia o erro, corrija o que for possível (por exemplo, espaço em disco ou Docker reiniciado) e rode de novo. Se persistir, mostre o erro à pessoa.
- **5**: a API não respondeu a tempo. Veja os logs com `docker compose logs --tail 100 api`. Se o erro for de banco, confira `docker compose logs --tail 100 db`. Não apague nada para tentar de novo sem perguntar.
- **6**: já existe o banco de uma instalação anterior (volume `<projeto>_dados_db`, por exemplo `sistema_financeiro_pessoal_dados_db`), mas não há arquivo `.env` com a senha dele. O script não cria o `.env` e não apaga nada. Explique à pessoa: "Já existe um banco de dados desta instalação, mas não há arquivo .env com a senha dele." As saídas são: (a) recolocar o `.env` antigo na pasta e rodar o instalador de novo; ou (b) se o banco antigo puder ser apagado, rodar `docker compose down -v` e depois o instalador. **NÃO apague o volume (nem rode `docker compose down -v`) sem pedido explícito e claro do usuário.**

## Como confirmar que funcionou

- `docker compose ps` mostra `db`, `api` e `web` no ar.
- `GET http://localhost:<API_PORT>/api/saude` devolve `{"ok":true}`. A porta da API está no `.env` (variável `API_PORT`, padrão 3092). A API só é publicada em `127.0.0.1`: só responde a este computador. O site é o único acesso pela rede.
- O site abre em `http://localhost:<WEB_PORT>` (variável `WEB_PORT`, padrão 8092).

## O que dizer à pessoa no fim

- O endereço do site (`http://localhost:<WEB_PORT>`).
- O e-mail do titular (`admin@financas.local`, ou o valor de `ADMIN_EMAIL` do `.env`).
- A senha do titular: `admin1234` (padrão, ou o valor de `ADMIN_SENHA` do `.env` se a pessoa tiver definido outra).
- Que ela deve trocar a senha em "Meu perfil" logo no primeiro acesso.

## Regras para o assistente

- Não imprima nem copie o conteúdo do `.env` na resposta, além dos dados de acesso acima.
- Não rode `docker compose down -v` (apaga o banco inteiro) sem pedido explícito e claro da pessoa. Não apague volumes de banco nem crie `.env` novo por cima de um banco antigo para "destravar" a instalação (código 6).
- Não altere nem pare contêineres que não sejam deste projeto, nem mude portas de outros programas.
- Se uma porta estiver ocupada, deixe o instalador escolher outra. Não force portas.
- Não faça commit do arquivo `.env` nem o inclua em nada que vá para o Git.
- Não instale nada além do Docker (e do Git, se for preciso para clonar) sem a pessoa confirmar.

## Opções do dia a dia

- **Atualizar**: entre na pasta do projeto, rode `git pull` e depois o instalador de novo (`.\instalar.ps1` ou `bash instalar.sh`). Os dados do banco são mantidos.
- **Parar**: `docker compose down` (os dados ficam guardados).
- **Apagar tudo**: `docker compose down -v`. Isso apaga o banco. Só faça com pedido explícito da pessoa.
- **Dados de demonstração**: `-Demo` ou `--demo`, só em instalação nova.

## Desenvolvimento

- Servidor: pasta `server/` (Node.js 20, TypeScript, Express, Prisma).
- Cliente: pasta `client/` (React, TypeScript, Vite).
- Verificações antes de entregar uma mudança:
  - `cd server && npx tsc --noEmit`
  - `cd client && npx tsc --noEmit`
  - `cd client && npx vite build`
- Mais detalhes: `README.md` e `docs/ARQUITETURA.md`.
