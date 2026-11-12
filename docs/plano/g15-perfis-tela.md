# g15 — Perfis financeiros: seletor no topo e tela de gerenciamento

## Objetivo

O mesmo login pode ter vários perfis financeiros ("Pessoal", "Empresa", "Casal"), cada um com as próprias contas, cartões, investimentos, categorias, orçamento e metas. O servidor já separa tudo pelo cabeçalho `X-Perfil`, que o `client/src/lib/api.ts` já envia a partir de `localStorage['financas.perfil']` (feito pelo main). Você faz: (1) o seletor de perfil que fica no topo e (2) a tela para criar, renomear e apagar perfis.

Leia antes: `client/src/layout/MenuUsuario.tsx` (padrão de menu suspenso: abrir/fechar, clique fora, Esc), `client/src/layout/casca.css` (classes do topo), `client/src/modules/importar/Historico.tsx`, `client/src/modules/cartoes/Cartoes.tsx` (padrão de tela com Modal e formulário), `client/src/ui/index.tsx`, `client/src/ui/financas.tsx`, `client/src/ui/icones.tsx`.

## Arquivos (só estes)

- criar `client/src/lib/perfilFinanceiro.ts`
- criar `client/src/layout/SeletorPerfil.tsx`
- criar `client/src/layout/seletor-perfil.css`
- criar `client/src/modules/perfis/index.tsx`
- criar `client/src/modules/perfis/Perfis.tsx`
- criar `client/src/modules/perfis/perfis.css`

Não edite `Layout.tsx` nem `api.ts`: o main encaixa `<SeletorPerfil />` no topo.

## API

- `GET /perfis` → `PerfilDTO[]`
- `POST /perfis` corpo `{ nome: string, cor?: string }` → `{ id, nome, cor, criadoEm }` (409 se o nome já existe; o perfil novo já nasce com as categorias padrão)
- `PUT /perfis/:id` corpo `{ nome?: string, cor?: string }`
- `DELETE /perfis/:id` → 204 (400 se for o único perfil). Apaga TUDO do perfil.

```ts
export interface PerfilDTO {
  id: number;
  nome: string;
  cor: string;          // '#rrggbb'
  criadoEm: string;
  atual: boolean;       // é o perfil desta requisição
  contas: number;       // contas e cartões ativos
  investimentos: number;
  patrimonio: number;
}
```

## `client/src/lib/perfilFinanceiro.ts`

```ts
export const CHAVE_PERFIL = 'financas.perfil';
export interface PerfilDTO { /* como acima */ }
// Grava o perfil escolhido e recarrega o app na tela inicial, para todas as telas buscarem os dados do novo perfil.
export function trocarDePerfil(id: number): void {
  localStorage.setItem(CHAVE_PERFIL, String(id));
  window.location.assign('/app');
}
```

## `SeletorPerfil.tsx`

`export function SeletorPerfil(): JSX.Element | null`

- Busca `useDados<PerfilDTO[]>('/perfis')`. Sem dados ainda → `null`.
- Botão (`type="button"`, classe `seletor-perfil-botao`, `aria-haspopup="menu"`, `aria-expanded`) mostrando uma bolinha com a cor do perfil atual (`PontoCor` de `../ui/financas`), o nome do perfil atual e um ícone de seta para baixo (procure em `icones.tsx` um nome que exista; se não houver seta, use o caractere `▾` com `aria-hidden`).
- Ao clicar, abre um menu (`role="menu"`, classe `seletor-perfil-menu`) com: um item por perfil (`role="menuitemradio"`, `aria-checked={p.atual}`; bolinha de cor, nome e, em texto suave, `formatarReais(p.patrimonio)`); o atual com um visto. Clicar em outro perfil chama `trocarDePerfil(p.id)`. Depois, um separador e o item `Gerenciar perfis`, que navega para `/app/perfis` (`useNavigate`) e fecha o menu.
- Fecha com clique fora e com Esc, igual ao `MenuUsuario.tsx`.
- CSS em `seletor-perfil.css`: só variáveis do tema (`--cor-superficie`, `--cor-borda`, `--cor-texto`, `--cor-texto-suave`, `--cor-primaria`, `--raio`, `--sombra`). Botão com `border: 1px solid var(--cor-borda)`, `border-radius: 999px`, `padding: 0.35rem 0.75rem`, altura parecida com os botões redondos do topo; o nome com `max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap`. Menu `position: absolute; right: 0; top: calc(100% + 6px); min-width: 240px; z-index: 50`, com sombra e borda. O contêiner tem `position: relative`. Foco visível nos itens.

## Tela `/app/perfis` (`index.tsx` + `Perfis.tsx`)

`index.tsx`:

```tsx
export const rotas: RotaModulo[] = [
  { caminho: '/app/perfis', rotulo: 'Perfis financeiros', icone: 'usuarios', perfis: ['TITULAR'], elemento: <Perfis />, ordem: 88 },
];
```

(Confira em `client/src/lib/rotas.ts` os campos de `RotaModulo` e em `icones.tsx` se `usuarios` existe; se não existir, use `engrenagem`.)

`Perfis.tsx`: `<Pagina titulo="Perfis financeiros" acoes={<Botao aoClicar={abrirNovo}>Novo perfil</Botao>}>`

1. Texto suave no topo: `Cada perfil tem as próprias contas, cartões, faturas, investimentos, categorias, orçamento e metas. O login é o mesmo: troque de perfil pelo seletor no topo.`
2. Grade de cartões (`perfis-grade`: `display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 1rem`), um `<Cartao>` por perfil com: bolinha de cor + nome em negrito; selo `<Selo cor="azul">Em uso</Selo>` quando `atual`; três linhas `Patrimônio: formatarReais(patrimonio)`, `Contas e cartões: {contas}`, `Investimentos: {investimentos}`; e os botões: `Usar este perfil` (só quando não é o atual; chama `trocarDePerfil(p.id)`), `Editar` (variante `texto`), `Apagar` (variante `perigo`; não aparece quando só existe um perfil).
3. `Modal` de criar/editar com `Campo` rótulo `Nome` (obrigatório, até 60 caracteres) e `CampoCor` (de `../../ui/financas`) rótulo `Cor`. Botão `Salvar` desabilitado enquanto envia. Erro da API em `<Aviso tipo="erro">` (use `mensagemErro`). Ao criar com sucesso, fecha e recarrega a lista; ao editar o perfil atual, recarrega a página (`window.location.reload()`) para o seletor do topo mostrar o nome novo.
4. Apagar: abre um `Modal` de confirmação com o texto `Apagar o perfil "{nome}" apaga todas as contas, cartões, faturas, lançamentos, investimentos, categorias, orçamentos e metas dele. Não dá para desfazer.` e pede para digitar o nome do perfil num `Campo` (rótulo `Digite o nome do perfil para confirmar`); o botão `Apagar perfil` (variante `perigo`) só habilita quando o texto digitado é igual ao nome (ignorando maiúsculas e espaços nas pontas). Depois de apagar: se o perfil apagado era o atual, `localStorage.removeItem(CHAVE_PERFIL)` e `window.location.assign('/app')`; senão, recarrega a lista.
5. Estados: `<Carregando />`, erro em `<Aviso tipo="erro">`.

## Critérios de aceite

- `cd client && npx tsc --noEmit` sem erros nos seus arquivos.
- Sem `any`, sem `// @ts-ignore`, sem biblioteca nova, sem cor fixa no CSS.
- Menu do seletor navegável por teclado (Tab, Enter, Esc) e com foco visível.
- Nenhum arquivo além dos seis listados foi alterado.
