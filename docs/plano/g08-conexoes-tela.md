# g08 — Conexões Open Finance (tela)

Leia antes: `docs/plano/CONTRATOS.md` (inteiro; seção "openfinance"), `client/src/lib/financas.ts` (tipos `ConexaoDTO`, `STATUS_CONEXAO`),
`client/src/ui/financas.tsx`, `client/src/ui/index.tsx`, `client/src/modules/cadastros/usuarios.tsx` (modelo de tela),
`client/node_modules/pluggy-connect-sdk/dist/main/pluggy-connect.d.ts` (tipos do widget).

O servidor destas rotas é feito pelo main ao mesmo tempo: programe contra o contrato.

## Arquivos que você pode criar (só estes)

- `client/src/modules/conexoes/index.tsx`
- `client/src/modules/conexoes/Conexoes.tsx`
- `client/src/modules/conexoes/Credenciais.tsx`
- `client/src/modules/conexoes/conexoes.css`

## Como funciona (contexto)

O Open Finance é feito pela Pluggy. O usuário cria uma conta gratuita em https://dashboard.pluggy.ai, pega um `Client ID` e um
`Client Secret` e grava nesta tela. Para conectar um banco, o site pede um token ao servidor (`POST /openfinance/token`) e abre o
widget "Pluggy Connect" (pacote `pluggy-connect-sdk`, já instalado). Quando o usuário termina, o widget devolve um `item` (com `id`);
o site manda esse id ao servidor (`POST /openfinance/conexoes`), que busca contas, cartões, faturas, lançamentos e investimentos.

## `index.tsx`

Uma rota — `/app/conexoes`, rótulo `Conexões`, ícone `conexoes`, ordem `60`, elemento `<Conexoes />`.

## Tipos locais (em `Conexoes.tsx`, exportados)

```ts
export interface EstadoOpenFinanceDTO {
  configurado: boolean;
  origemCredenciais: 'BANCO' | 'ENV' | null;
  clientId: string | null;
  sandbox: boolean;
  conexoes: ConexaoDTO[];
}
```

## Abrir o widget (função em `Conexoes.tsx`)

```ts
import { PluggyConnect } from 'pluggy-connect-sdk';

async function abrirWidget(conexao: ConexaoDTO | null) {
  // 1. token
  const { accessToken, sandbox, itemId } = await api.post<{ accessToken: string; sandbox: boolean; itemId: string | null }>(
    '/openfinance/token',
    conexao ? { conexaoId: conexao.id } : {},
  );
  // 2. widget
  const widget = new PluggyConnect({
    connectToken: accessToken,
    includeSandbox: sandbox,
    ...(itemId ? { updateItem: itemId } : {}),
    onSuccess: ({ item }) => { void aoConectar(item.id, conexao); },
    onError: (erro) => { setErro(erro.message || 'Não foi possível conectar à instituição.'); },
  });
  await widget.init();
}
```

- `aoConectar(itemId, conexao)`: se `conexao` é `null` → `api.post<ConexaoDTO>('/openfinance/conexoes', { itemId })`; senão →
  `api.post<ConexaoDTO>('/openfinance/conexoes/' + conexao.id + '/sincronizar')`. Enquanto espera, mostre
  `<Aviso tipo="info">Buscando contas, faturas e investimentos... isso pode levar até um minuto.</Aviso>` (estado `sincronizando`).
  Ao terminar: `<Aviso tipo="sucesso">` com `Conexão com <instituicao> atualizada.` e `recarregar()`.
- Confira os nomes exatos das propriedades e do retorno de `onSuccess`/`onError` no arquivo `.d.ts` do pacote e ajuste se forem diferentes.
  Se o TypeScript reclamar do tipo do `item`, leia o tipo no `.d.ts`; não use `any`.
- Envolva tudo em `try/catch` com `setErro(mensagemErro(e))`.

## `Conexoes.tsx` (export `Conexoes`)

1. `useDados<EstadoOpenFinanceDTO>('/openfinance/estado')`. Estados: `erro`, `sucesso`, `sincronizando` (boolean), `mostrarCredenciais` (boolean).
2. `<Pagina titulo="Conexões" acoes={...}>` com, nas ações (só quando `configurado`): `<Botao variante="secundario">Sincronizar tudo</Botao>`
   (`api.post<ConexaoDTO[]>('/openfinance/sincronizar')`, depois `recarregar()`) e `<Botao>Conectar instituição</Botao>` (`abrirWidget(null)`).
3. Se `!configurado`: `<Vazio icone="conexoes" titulo="Conecte seus bancos pelo Open Finance" texto="Traga saldos, faturas do cartão e investimentos automaticamente. Primeiro informe as credenciais da Pluggy.">`
   com `<Botao>Configurar credenciais</Botao>` (abre `mostrarCredenciais`). Abaixo, um `<Cartao titulo="Como obter as credenciais">` com a lista
   numerada: 1) Crie uma conta gratuita em dashboard.pluggy.ai (link `<a href="https://dashboard.pluggy.ai" target="_blank" rel="noreferrer">`);
   2) Crie uma aplicação e copie o Client ID e o Client Secret; 3) Para ler os seus próprios bancos sem custo, ative o conector "MeuPluggy"
   (https://meu.pluggy.ai) na aplicação; 4) Cole as credenciais aqui e clique em Conectar instituição. Acrescente a frase:
   "Para testar sem banco real, marque 'Mostrar bancos de teste' e use o Pluggy Bank com usuário user-ok e senha password-ok."
4. Se `configurado`:
   - `resumo` com 3 `ResumoItem`: `Instituições conectadas` (`conexoes`, azul, `conexoes.length`), `Contas e cartões` (`contas`, verde, soma de `contas`),
     `Investimentos` (`investimentos`, roxo, soma de `investimentos`).
   - Lista `<div className="fin-cartoes">`: um `<article className="cartao conexoes-item">` por conexão: logo (`<img src={instituicaoLogo} className="conexoes-logo" alt="" />`
     quando houver; senão um círculo `conexoes-logo` com fundo `instituicaoCor ?? 'var(--cor-primaria)'` e o ícone `contas`), nome da instituição,
     `<Selo cor={STATUS_CONEXAO[c.status].cor}>{STATUS_CONEXAO[c.status].rotulo}</Selo>`, linha `fin-suave`:
     `<n> contas e cartões · <n> investimentos`, linha `fin-suave`: `Atualizada em ` + `formatarDataHora(ultimaSincronizacao)` (ou `Ainda não sincronizada`),
     `c.erro` em `<Aviso tipo="erro">` quando houver, e `MenuAcoes`: `Sincronizar agora` (`sincronizar`; `POST /openfinance/conexoes/:id/sincronizar`),
     `Reconectar` (`cadeado`; `abrirWidget(c)`), `Remover e manter os dados` (`fechar`; `api.del('/openfinance/conexoes/' + id + '?manterDados=true')`,
     com `window.confirm`), `Remover e apagar os dados` (`lixeira`, `perigo`; `api.del('/openfinance/conexoes/' + id)`, com
     `window.confirm('Remover a conexão com X e apagar as contas, faturas, lançamentos e investimentos que vieram dela?')`).
   - Sem conexões: `<Vazio icone="conexoes" titulo="Nenhuma instituição conectada" texto="Clique em Conectar instituição e escolha seu banco, cartão ou corretora.">`.
   - No fim, `<Cartao>` com `fin-cabecalho`: à esquerda `Credenciais da Pluggy` e, em `fin-suave`, `Client ID: <clientId>` +
     (`origemCredenciais === 'ENV'` → ` (definidas no arquivo .env)`) + (`sandbox` → ` · bancos de teste ligados`); à direita
     `<Botao variante="secundario">Alterar credenciais</Botao>`.
5. `<Modal aberto={mostrarCredenciais} titulo="Credenciais da Pluggy" aoFechar={...}><Credenciais estado={dados} aoSalvo={...} /></Modal>`.
6. Avisos de `erro`/`sucesso`/`sincronizando` logo abaixo do cabeçalho da página. Botões desabilitados enquanto `sincronizando`.

## `Credenciais.tsx`

```ts
export function Credenciais(props: { estado: EstadoOpenFinanceDTO; aoSalvo: () => void }): JSX.Element
```

Formulário: `Client ID*` (preenchido com `estado.clientId ?? ''` quando `origemCredenciais === 'BANCO'`), `Client Secret` (tipo `password`;
obrigatório só quando ainda não há credenciais gravadas no banco; rótulo `Client Secret (deixe vazio para manter o atual)` quando já há),
`<Caixa rotulo="Mostrar bancos de teste (sandbox da Pluggy)" />` (padrão `estado.sandbox`).
`Salvar`: `api.put('/openfinance/credenciais', { clientId, clientSecret (omitido se vazio), sandbox })` → `aoSalvo()`.
O servidor testa as credenciais na Pluggy e devolve erro 400 com mensagem se forem inválidas: mostre com `<Aviso tipo="erro">`.
Quando `origemCredenciais === 'BANCO'`: `<Botao variante="perigo">Apagar credenciais</Botao>` (`window.confirm`; `api.del('/openfinance/credenciais')` → `aoSalvo()`).
Texto de apoio em `fin-suave`: "O Client Secret é guardado cifrado no banco de dados e nunca volta para o navegador."

## `conexoes.css`

Classes `conexoes-item` (coluna, `gap: 0.5rem`, cabeçalho com logo + nome + menu) e `conexoes-logo` (44 px, redondo, `object-fit: contain`,
fundo `var(--cor-superficie-2)`, borda `var(--cor-borda)`). Só variáveis de cor de `estilo.css` (a cor da instituição entra por `style`).

## Aceite

- `cd client && npx tsc --noEmit` sem erros nos seus arquivos. Nenhum `any`. Nenhuma cor fixa em CSS.
