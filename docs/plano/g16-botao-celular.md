# g16 — Botão "Abrir no celular" com QR code

## Objetivo

Um botão no topo que abre um popup com um QR code. A pessoa aponta a câmera do celular (na mesma rede Wi-Fi) e abre o sistema. O QR code leva ao endereço deste computador na rede (nunca `localhost`, que no celular não funciona).

Leia antes: `client/src/layout/Notificacoes.tsx` e `client/src/layout/Layout.tsx` (como são os botões redondos do topo, classe `casca-botao-redondo`), `client/src/ui/index.tsx` (`Modal`, `Campo`, `Botao`, `Aviso`), `client/src/ui/icones.tsx`.

## Arquivos (só estes)

- criar `client/src/layout/BotaoCelular.tsx`
- criar `client/src/layout/botao-celular.css`

Não edite `Layout.tsx`: o main encaixa `<BotaoCelular />` no topo. A biblioteca `qrcode` (com `@types/qrcode`) JÁ está no `package.json`: não instale nada.

## API: `GET /rede`

```ts
interface RedeDTO {
  porta: number;                                 // porta do site, ex.: 8092
  enderecos: { rotulo: string; url: string }[];  // ex.: [{ rotulo: 'Nome do computador', url: 'http://meu-pc.local:8092' }]; pode vir vazio
}
```

Busque só quando o popup abrir (`api.get<RedeDTO>('/rede')` dentro de um `useEffect` que depende de `aberto`).

## Qual endereço vai no QR code (nesta ordem)

1. O que a pessoa digitou e salvou antes: `localStorage['financas.enderecoRede']` (se existir).
2. Se o navegador já NÃO está em localhost (`window.location.hostname` diferente de `localhost`, `127.0.0.1` e `[::1]`): `window.location.origin`.
3. O primeiro de `enderecos` vindo da API.
4. Nenhum: não há QR code; mostra só as instruções e o campo para digitar.

Escreva isso numa função pura `escolherEndereco(salvo: string | null, origem: string, hostname: string, daApi: string[]): string | null`.

`normalizar(texto: string, porta: number): string | null` — aceita o que a pessoa digitar: `192.168.0.15`, `192.168.0.15:8092`, `http://192.168.0.15:8092/`, `financas-pessoais.local`. Regras: tira espaços; se não começar com `http://` ou `https://`, põe `http://`; tira tudo depois do host[:porta] (caminho, `?`, `#`); se não tiver porta e `porta !== 80`, acrescenta `:porta`; o host só pode ter letras, números, ponto e hífen (senão devolve `null`); `localhost` e `127.0.0.1` devolvem `null`.

## Componente

`export function BotaoCelular(): JSX.Element`

- Botão `type="button"` com `className="casca-botao-redondo"`, `aria-label="Abrir no celular"`, `title="Abrir no celular"`. Ícone: procure em `icones.tsx` um ícone de celular; se não houver, desenhe um `<svg>` inline 22×22 (`viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`, `strokeWidth="2"`): um retângulo arredondado `x=7 y=2 width=10 height=20 rx=2` e uma linha curta `M11 18h2`.
- `Modal` (`aberto`, `titulo="Abrir no celular"`, `aoFechar`) com, de cima para baixo:
  1. Texto: `Aponte a câmera do celular para o código. O celular precisa estar na mesma rede Wi-Fi deste computador.`
  2. O QR code: `<img>` de 220×220 com `alt={'QR code para ' + endereco}`, dentro de uma moldura branca (`botao-celular-qr`: fundo `#fff` — exceção permitida, o QR precisa de fundo branco para ser lido no tema escuro —, `padding: 12px`, `border-radius: 12px`, centralizado). Gere com `import QRCode from 'qrcode'` e `QRCode.toDataURL(endereco, { width: 440, margin: 1, errorCorrectionLevel: 'M' })` dentro de um `useEffect` que depende de `endereco`; guarde o resultado em estado; se a promessa falhar, mostre `<Aviso tipo="erro">Não consegui gerar o código.</Aviso>`.
  3. O endereço em texto, grande e selecionável (`botao-celular-endereco`, fonte monoespaçada, `user-select: all`, quebra de linha permitida), e um `Botao variante="texto"` `Copiar endereço` que usa `navigator.clipboard.writeText` e troca o texto para `Copiado` por 2 segundos (se `navigator.clipboard` não existir, não mostre o botão).
  4. Se a API devolveu mais de um endereço, uma lista de botões de texto com o `rotulo` de cada um para trocar o endereço do QR.
  5. Um bloco recolhível `<details>` com `<summary>Não abriu? Usar outro endereço</summary>`: explicação `Digite o IP deste computador na rede (no Windows: Configurações > Rede e Internet > propriedades do Wi-Fi > Endereço IPv4) ou um nome como financas-pessoais.local.`; um `Campo` rótulo `Endereço deste computador`; `Botao` `Usar este endereço` que chama `normalizar`, e se der `null` mostra `<Aviso tipo="erro">Endereço inválido. Exemplo: 192.168.0.15</Aviso>`, senão grava em `localStorage['financas.enderecoRede']` e passa a usá-lo; e, se houver um endereço salvo, um `Botao variante="texto"` `Voltar ao automático` que apaga a chave.
  6. Quando não há endereço nenhum (caso 4): no lugar do QR, `<Aviso tipo="info">Não consegui descobrir o endereço deste computador na rede. Digite abaixo o IP dele.</Aviso>` e o `<details>` já aberto (`open`).
  7. Rodapé em texto suave: `Se o celular não abrir, confira se o firewall do computador permite a porta {porta}.`
- Envolva os acessos a `localStorage` em try/catch.

## CSS (`botao-celular.css`)

Só variáveis do tema, com a única exceção do fundo branco da moldura do QR. Conteúdo do modal em coluna com `gap: 1rem`; o QR centralizado; nada passa de 100% da largura em tela de 360 px (`img { max-width: 100%; height: auto; }`).

## Critérios de aceite

- `cd client && npx tsc --noEmit` sem erros nos seus arquivos.
- `normalizar('192.168.0.15', 8092)` → `'http://192.168.0.15:8092'`; `normalizar('http://192.168.0.15:8092/app?x=1', 8092)` → `'http://192.168.0.15:8092'`; `normalizar('financas-pessoais.local', 80)` → `'http://financas-pessoais.local'`; `normalizar('localhost', 8092)` → `null`; `normalizar('a b', 8092)` → `null`.
- O QR nunca aponta para `localhost`.
- Sem `any`, sem `// @ts-ignore`, sem biblioteca nova.
- Nenhum arquivo além dos dois listados foi alterado.
