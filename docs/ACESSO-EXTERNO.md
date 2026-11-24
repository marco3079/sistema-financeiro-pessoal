# Acesso de fora de casa e instalação no celular

Este guia mostra como abrir o sistema no celular quando ele não está na mesma rede Wi-Fi do computador (por exemplo, na rua), e como instalar o sistema como aplicativo no celular.

## Jeito automático (recomendado): pela tela

O sistema já traz um contêiner (`https`) com o Tailscale. Ele entra na sua rede como um aparelho próprio e publica o site com HTTPS, sem instalar nem rodar nada no computador.

1. No painel do Tailscale, em **DNS**, deixe ligados **MagicDNS** e **HTTPS Certificates** (uma vez por rede).
2. No sistema, abra **Configurações > Acesso seguro (HTTPS)** e clique em **Entrar no Tailscale**. Entre com a sua conta e aprove o aparelho.
3. A tela mostra o endereço `https://financas.<sua-rede>.ts.net`. Ele também passa a ser o primeiro do QR code de "Abrir no celular".
4. No celular, com o Tailscale ligado, abra esse endereço. No iPhone: Compartilhar > Adicionar à Tela de Início, e abra pelo ícone para receber notificações.

- O nome `financas` vem de `HTTPS_NOME` no `.env`.
- Para entrar sem passar pela tela, gere uma chave de autenticação no painel do Tailscale e ponha em `TAILSCALE_AUTHKEY` no `.env`.
- O acesso vale só para aparelhos da sua rede Tailscale. Se a rede tiver aparelhos de outras pessoas, elas alcançam a tela de login (não entram sem a senha); as regras de acesso (ACL) do Tailscale restringem isso.
- O login real no Tailscale por este caminho ainda não foi testado de ponta a ponta pelo autor: confira o endereço na tela depois de entrar.

As seções abaixo descrevem o jeito manual, com o Tailscale instalado no computador.

> **Aviso:** os comandos do Tailscale foram escritos a partir da documentação do próprio Tailscale e **devem ser conferidos na versão instalada** (`tailscale --help` e `tailscale serve --help` mostram a sintaxe atual). Não copie sem conferir.

## O que isso faz e o que NÃO faz

O Tailscale cria uma rede privada entre os seus aparelhos (computador e celular), ligados à mesma conta. Com ela:

- O celular abre o sistema por um endereço `https://...ts.net`, de qualquer lugar, desde que o celular tenha o Tailscale ligado.
- O endereço HTTPS permite instalar o sistema como aplicativo no celular.
- O `tailscale serve` publica o sistema **só dentro da sua rede Tailscale**.

Isso NÃO faz:

- Não abre nenhuma porta no roteador.
- Não deixa o sistema público na internet: quem não estiver na sua rede Tailscale não consegue abrir o endereço.
- Não mexe no Wi-Fi de casa nem no firewall do roteador.

Por que não usar `tailscale funnel`: o `funnel` publica o sistema **na internet aberta**, para qualquer pessoa. Para um sistema financeiro isso é um risco alto. Só considere o `funnel` com a **verificação em duas etapas ligada** na conta do Tailscale e entendendo que o endereço fica público.

## Passo a passo

### 1. Instalar o Tailscale

1. No computador onde o sistema roda, instale o Tailscale (site oficial) e entre com uma conta.
2. No celular, instale o aplicativo Tailscale e entre **com a mesma conta**.
3. Confirme que os dois aparecem na lista de aparelhos do Tailscale e que estão ligados.

### 2. Publicar o sistema com HTTPS só na sua rede

No computador, com o sistema no ar na porta 8092 (padrão do `WEB_PORT`), rode:

```
tailscale serve --bg 8092
```

Isso cria um endereço HTTPS do tipo `https://meu-pc.tailnet.ts.net`. O nome exato aparece no próprio terminal e no painel do Tailscale. Para ver o que está publicado:

```
tailscale serve status
```

Para desligar a publicação depois:

```
tailscale serve reset
```

Confira a sintaxe na versão instalada antes de rodar.

### 3. Dizer ao sistema qual é o endereço HTTPS

Abra o arquivo `.env` na pasta do projeto e acrescente (ou altere) a linha:

```
URL_PUBLICA=https://meu-pc.tailnet.ts.net
```

Regras: tem que começar com `https://`, ter só o nome do host e a porta (se houver), sem caminho depois. Um valor como `URL_PUBLICA=http://x` é ignorado.

Depois suba de novo o sistema:

```
docker compose up -d
```


### 4. Abrir no celular

1. No computador, abra o sistema e clique no botão de celular (QR code).
2. A primeira opção da lista é `Endereço seguro (HTTPS)`. Leia o QR code com a câmera do celular, ou copie o endereço.
3. No celular, o sistema abre pelo endereço HTTPS. Com o Tailscale ligado no celular, funciona de fora de casa.

### 5. Instalar como aplicativo

- **Android (Chrome):** abra o endereço HTTPS, toque em `Instalar aplicativo` no popup do botão de celular, ou use o menu do navegador > `Instalar aplicativo`.
- **iPhone (Safari):** abra o endereço HTTPS, toque em Compartilhar > `Adicionar à Tela de Início`.

Depois de instalado, o sistema abre em tela cheia, sem a barra do navegador.

## Problemas comuns

- **Não abre de fora de casa:** confira se o Tailscale está ligado no celular e na mesma conta do computador.
- **Não aparece o endereço HTTPS:** confira `URL_PUBLICA` no `.env` (início `https://`, sem caminho) e se o `docker compose up -d` foi rodado depois da mudança.
- **Erro de certificado:** confira se o `tailscale serve` está ativo (`tailscale serve status`).
- **Não aparece a opção de instalar:** o navegador só oferece a instalação com HTTPS. No iPhone a instalação é sempre pelo menu Compartilhar.
