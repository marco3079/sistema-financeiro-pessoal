# g14 — Cartões com aparência de cartão de verdade

## Objetivo

Na tela Cartões, cada cartão hoje é um retângulo azul com texto. Ele deve parecer um cartão de crédito real: proporção de cartão, cor e acabamento do banco, chip, símbolo de aproximação, número mascarado, nome do banco e bandeira. Também encaixar na tela o componente `Previsao` (feito por outro gerador).

Regra de marca: **não desenhar nem copiar logotipo oficial** de banco ou bandeira. O nome do banco e o da bandeira aparecem como texto estilizado; a identidade vem da cor e do acabamento.

Projeto: `client/` é React 18 + TypeScript + Vite. Leia antes: `client/src/modules/cartoes/Cartoes.tsx` (inteiro), `client/src/modules/cartoes/cartoes.css`, `client/src/lib/financas.ts` (tipo `ContaDTO`, `formatarReais`, `formatarDia`).

## Arquivos (só estes)

- criar `client/src/modules/cartoes/CartaoVisual.tsx`
- criar `client/src/modules/cartoes/cartao-visual.css`
- editar `client/src/modules/cartoes/Cartoes.tsx`
- editar `client/src/modules/cartoes/cartoes.css` (só para remover as regras que deixarem de ser usadas)

`client/src/modules/cartoes/Previsao.tsx` está sendo criado pelo g12: **não crie nem edite esse arquivo**. Contrato dele: `export function Previsao({ versao }: { versao: number })`. Se ele ainda não existir quando você rodar o typecheck, o único erro aceito é o do import dele; avise na sala e confira de novo depois.

## `CartaoVisual.tsx`

```tsx
export interface TemaCartao {
  chave: string;      // 'nubank', 'xp', ...
  fundo: string;      // valor de CSS para `background`
  texto: string;      // cor do texto
  detalhe: string;    // cor de destaque (linha, brilho)
}

// Tema pela instituição ou pelo nome do cartão; null quando não reconhece.
export function temaDoBanco(conta: Pick<ContaDTO, 'nome' | 'instituicao'>): TemaCartao | null

export function CartaoVisual(props: {
  conta: ContaDTO;
  vencimento: string | null;          // 'AAAA-MM-DD' da fatura em aberto, se houver
  percentualUsado: number | null;     // 0 a 100+
  ativo: boolean;
  aoClicar: () => void;
}): JSX.Element
```

### Temas (procure o trecho no texto `nome + ' ' + instituicao`, em minúsculas e sem acento)

| chave | trechos que identificam | fundo | texto | detalhe |
|---|---|---|---|---|
| nubank | `nubank`, `nu pagamentos`, palavra `nu` | `linear-gradient(135deg, #8a05be 0%, #5b0a8c 100%)` | `#ffffff` | `#d9a8f5` |
| xp | palavra `xp` | `linear-gradient(135deg, #1c1c1e 0%, #000000 100%)` | `#f5f5f5` | `#f5c518` |
| inter | `inter` | `linear-gradient(135deg, #ff7a00 0%, #e35d00 100%)` | `#ffffff` | `#ffd9b3` |
| itau | `itau` | `linear-gradient(135deg, #ec7000 0%, #003b7a 130%)` | `#ffffff` | `#ffd166` |
| bradesco | `bradesco` | `linear-gradient(135deg, #cc092f 0%, #7d0520 100%)` | `#ffffff` | `#ffc2cf` |
| santander | `santander` | `linear-gradient(135deg, #ec0000 0%, #990000 100%)` | `#ffffff` | `#ffc7c7` |
| bb | `banco do brasil`, palavra `bb`, `ourocard` | `linear-gradient(135deg, #003da5 0%, #002a73 100%)` | `#ffffff` | `#fae128` |
| caixa | `caixa` | `linear-gradient(135deg, #005ca9 0%, #00407a 100%)` | `#ffffff` | `#f39200` |
| c6 | palavra `c6` | `linear-gradient(135deg, #2b2b2b 0%, #0d0d0d 100%)` | `#f2f2f2` | `#c9c9c9` |
| btg | `btg` | `linear-gradient(135deg, #0b2a5b 0%, #05132b 100%)` | `#ffffff` | `#9ec1ff` |

"Palavra" quer dizer que o trecho não pode estar colado em outra letra: use `new RegExp('(^|[^a-z])' + trecho + '([^a-z]|$)')`. Teste nesta ordem (a primeira que casar vence). `inter` como palavra também (para não casar com "internacional").

Sem tema reconhecido, use a cor que o usuário escolheu: fundo `linear-gradient(135deg, ${conta.cor}, color-mix(in srgb, ${conta.cor} 55%, #000))`, texto `#ffffff`, detalhe `rgba(255,255,255,0.7)`.

Essas cores fixas são a única exceção à regra de "só variáveis do tema": elas ficam no arquivo `.tsx` (na tabela de temas) e chegam ao CSS por variáveis `--cv-fundo`, `--cv-texto`, `--cv-detalhe` definidas no `style` do botão.

### Estrutura (um `<button type="button">`, com `aria-pressed={ativo}` e `onClick={aoClicar}`)

Classe `cv-cartao` (+ `cv-cartao-ativo` quando ativo). Dentro, de cima para baixo:

1. Linha de cima (`cv-topo`): à esquerda o **nome do banco** (`conta.instituicao ?? conta.nome`) em `cv-banco` (negrito, espaçamento de letra leve); à direita o símbolo de aproximação: um `<svg>` de 22×22 com três arcos concêntricos (`<path>` com `stroke="currentColor"`, `fill="none"`, `strokeWidth` 2, `strokeLinecap="round"`), `aria-hidden="true"`.
2. O **chip** (`cv-chip`): um `<span>` de 42×32 px, `border-radius: 6px`, fundo `linear-gradient(135deg, #e6c56b, #b8913a)`, com linhas internas feitas por `::before`/`::after` (duas linhas finas escuras semitransparentes) para lembrar os contatos do chip. `aria-hidden="true"`.
3. O **número** (`cv-numero`): `•••• •••• •••• ` + os 4 últimos dígitos (`conta.numero` só com os dígitos, últimos 4; se não houver, `••••`). Fonte monoespaçada (`font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace`), `letter-spacing: 0.14em`.
4. Linha de baixo (`cv-base`): à esquerda dois textos empilhados — rótulo pequeno `Fatura atual` e o valor `formatarReais(conta.saldo)` em negrito; ao lado (ou abaixo em tela estreita), se `vencimento` não for null, rótulo `Vence em` e `formatarDia(vencimento)`. À direita a **bandeira** (`conta.bandeira`, se houver) em `cv-bandeira`: texto em itálico, negrito, maiúsculas.
5. Se `conta.limite !== null`: uma barra fina de uso do limite (`cv-limite`): trilho com `background: color-mix(in srgb, var(--cv-texto) 25%, transparent)`, preenchimento com `background: var(--cv-detalhe)` e largura `Math.min(100, Math.max(0, percentualUsado ?? 0))%`; ao lado, texto pequeno `Limite {formatarReais(conta.limite)}`.
6. Se `conta.nome` for diferente do nome do banco mostrado no topo, mostre `conta.nome` em texto pequeno logo abaixo do número (`cv-apelido`).
7. Se `conta.origem === 'OPEN_FINANCE'`, um selo pequeno de texto `Open Finance` no canto (classe `cv-selo`).

### CSS (`cartao-visual.css`, importado no topo de `CartaoVisual.tsx`)

- `.cv-cartao`: `aspect-ratio: 1.586 / 1` (proporção de cartão), `width: 100%`, `max-width: 380px`, `border-radius: 16px`, `padding: 1.1rem 1.25rem`, `background: var(--cv-fundo)`, `color: var(--cv-texto)`, `border: 0`, `text-align: left`, `font: inherit`, `cursor: pointer`, `position: relative`, `overflow: hidden`, `display: flex; flex-direction: column; justify-content: space-between`, sombra `0 10px 24px rgba(0, 0, 0, 0.28)`.
- Brilho: `.cv-cartao::after` — faixa diagonal clara (`linear-gradient(115deg, transparent 40%, rgba(255,255,255,0.12) 50%, transparent 60%)`), `position: absolute; inset: 0; pointer-events: none`.
- Hover: sobe 2 px (`transform: translateY(-2px)`) com `transition: transform 0.15s ease, box-shadow 0.15s ease`; dentro de `@media (prefers-reduced-motion: reduce)` sem transição nem transform.
- `.cv-cartao-ativo`: `box-shadow: 0 0 0 3px var(--cor-primaria), 0 10px 24px rgba(0, 0, 0, 0.28)`.
- `.cv-cartao:focus-visible`: `outline: 2px solid var(--cor-primaria); outline-offset: 3px`.
- Em cartões estreitos (`@container` não é necessário): abaixo de 380 px de tela, `padding: 0.9rem 1rem` e número com `font-size: 0.95rem; letter-spacing: 0.08em`. O texto nunca pode vazar do cartão: `min-width: 0` nos filhos e `overflow: hidden; text-overflow: ellipsis; white-space: nowrap` no nome do banco.
- Todo o conteúdo fica acima do brilho: filhos com `position: relative; z-index: 1`.

## Mudanças em `Cartoes.tsx`

1. Importar `CartaoVisual` de `./CartaoVisual` e `Previsao` de `./Previsao`.
2. Trocar o `<button className="cartoes-cartao ...">…</button>` inteiro (dentro do `cartoes.map`) por:
   ```tsx
   <CartaoVisual
     key={conta.id}
     conta={conta}
     vencimento={faturaAtual?.vencimento ?? null}
     percentualUsado={percentualUsado}
     ativo={conta.id === cartaoId}
     aoClicar={() => setCartaoId(conta.id)}
   />
   ```
3. O contêiner `<div className="fin-cartoes">` passa a ser `<div className="cv-grade">`; no `cartao-visual.css`: `.cv-grade { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 380px)); gap: 1.25rem; }`.
4. Logo depois do bloco `{selecionado && (<Cartao>…Faturas de…</Cartao>)}`, ainda dentro do mesmo fragmento, acrescentar `<Previsao versao={versaoPrevisao} />`. Crie `const [versaoPrevisao, setVersaoPrevisao] = useState(0);` e, dentro da função `recarregarTudo` que já existe, chame `setVersaoPrevisao((v) => v + 1);`.
5. Remover os imports que ficarem sem uso (`BarraProgresso`, `SeloOrigem`, `formatarDia` se não forem mais usados no arquivo) e, em `cartoes.css`, as regras `.cartoes-cartao*` que não forem mais usadas. Não mexer nas regras `.cartoes-fatura-*`.

Não mude mais nada na tela (formulário, tabela de faturas, menu de ações, modal).

## Critérios de aceite

- `cd client && npx tsc --noEmit` sem erros (com o `Previsao.tsx` do g12 presente).
- `temaDoBanco({ nome: 'Cartão Nubank', instituicao: null })` devolve o tema `nubank`; `{ nome: 'XP', instituicao: null }` → `xp`; `{ nome: 'Cartão Internacional', instituicao: null }` → `null`; `{ nome: 'Meu cartão', instituicao: 'Banco Inter' }` → `inter`.
- Nenhum logotipo oficial desenhado ou importado; nenhuma imagem externa.
- Sem `any`, sem `// @ts-ignore`, sem biblioteca nova.
- O cartão continua acessível: é um botão, tem foco visível e `aria-pressed`.
- Nenhum arquivo além dos quatro listados foi alterado.
