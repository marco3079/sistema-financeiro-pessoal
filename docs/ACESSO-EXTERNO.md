# Acesso de fora de casa e instalação no celular

Este guia mostra como abrir o sistema no celular quando ele não está na mesma rede Wi-Fi do computador (por exemplo, na rua), e como instalar o sistema como aplicativo no celular.

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
