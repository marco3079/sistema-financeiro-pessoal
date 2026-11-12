# g22 — Tela "Conectar IA" (MCP)

## Objetivo

Tela `/app/ia` em que a pessoa cria chaves de acesso para assistentes de IA (Claude, ChatGPT, Cursor, VS Code) lerem os dados financeiros pelo protocolo MCP, e vê o passo a passo para ligar cada aplicativo. O servidor MCP já existe; você só faz a tela.

Leia antes: `client/src/modules/perfis/Perfis.tsx` (tela com lista, `Modal` de criar e confirmação de apagar), `client/src/modules/importar/Cotacoes.tsx`, `client/src/ui/index.tsx` (`Pagina`, `Cartao`, `Tabela`, `Botao`, `Campo`, `Selecao`, `Modal`, `Aviso`, `Carregando`, `Selo`, `Abas`, `formatarDataHora`), `client/src/lib/api.ts`, `client/src/lib/useDados.ts`, `client/src/lib/financas.ts` (`mensagemErro`).

## Arquivos (só estes)

- criar `client/src/modules/ia/index.tsx`
- criar `client/src/modules/ia/ConectarIA.tsx`
- criar `client/src/modules/ia/ia.css`

## Rota

```tsx
export const rotas: RotaModulo[] = [
  { caminho: '/app/ia', rotulo: 'Conectar IA', icone: 'conexoes', perfis: ['TITULAR'], elemento: <ConectarIA />, ordem: 60 },
];
```

## API

```ts
interface ChaveDTO {
  id: number;
  nome: string;
  prefixo: string;                    // começo da chave, ex.: "fin_AbCdEf"
  permissao: 'LEITURA' | 'ESCRITA';
  criadoEm: string;
  ultimoUsoEm: string | null;
  usos: number;
}
interface FerramentaDTO { nome: string; titulo: string; descricao: string; escrita: boolean }
```

- `GET /mcp/chaves` → `{ chaves: ChaveDTO[]; ferramentas: FerramentaDTO[] }`
- `POST /mcp/chaves` corpo `{ nome: string, permissao: 'LEITURA' | 'ESCRITA' }` → `ChaveDTO & { chave: string }`. O campo `chave` (texto completo, começa com `fin_`) só vem nesta resposta.
- `DELETE /mcp/chaves/:id` → 204

## O que a tela mostra

`<Pagina titulo="Conectar IA" acoes={<Botao aoClicar={abrirNova}>Nova chave</Botao>}>`

1. `<Aviso tipo="info">Com uma chave, um assistente de IA consulta seus dados financeiros para responder perguntas como "quanto gastei com mercado este ano?". O que ele consultar é enviado ao provedor da IA (Anthropic, OpenAI...). Crie uma chave para cada aplicativo e apague as que não usa mais.</Aviso>`
2. **Chave recém-criada** (estado `nova: (ChaveDTO & { chave: string }) | null`): um `<Cartao titulo="Chave criada">` em destaque com: `<Aviso tipo="info">Copie agora: a chave não aparece de novo.</Aviso>`; a chave em um bloco `<code className="ia-codigo">` selecionável; `Botao` `Copiar chave` (`navigator.clipboard.writeText`; troca para `Copiada` por 2 s; não mostre o botão se `navigator.clipboard` não existir); e `Botao variante="texto"` `Já copiei` que limpa o estado `nova`.
3. `<Cartao titulo="Chaves de acesso">`: `Tabela<ChaveDTO>`, `chave={(c) => c.id}`, `vazio="Nenhuma chave criada."`, colunas: `Nome`; `Chave` → `{prefixo}…` em `<code>`; `Permissão` → `<Selo cor="azul">Só consulta</Selo>` ou `<Selo cor="amarelo">Consulta e lança</Selo>` (confira as cores aceitas por `Selo`); `Criada em` → `formatarDataHora`; `Último uso` → `ultimoUsoEm ? formatarDataHora(ultimoUsoEm) : 'Nunca usada'`; `Usos` (direita); e uma coluna de ações com `Botao variante="texto"` `Apagar` (abre confirmação). Veja em `ui/index.tsx` como `Tabela` declara coluna de ações (`acoes: true`) e siga o padrão de `Perfis.tsx` ou de outra tela.
4. `<Cartao titulo="Como conectar">` com `Abas`: `Claude Code`, `Claude Desktop`, `Cursor`, `VS Code`, `Pelo navegador`. Acima das abas, texto suave: `Nos exemplos, troque SUA_CHAVE pela chave criada.` Quando houver `nova`, os exemplos já usam a chave de verdade no lugar de `SUA_CHAVE`. O endereço dos exemplos é `ENDERECO = window.location.origin + '/api/mcp'`. Cada exemplo fica em `<pre className="ia-codigo"><code>…</code></pre>` com um `Botao variante="texto"` `Copiar` ao lado. Conteúdo de cada aba (monte os JSON com `JSON.stringify(objeto, null, 2)`, nunca com texto concatenado):
   - **Claude Code** — texto: `No terminal, na pasta do seu projeto:` e o comando em uma linha: `claude mcp add --transport http financas ${ENDERECO} --header "Authorization: Bearer ${CHAVE}"`
   - **Claude Desktop** — texto: `Abra Configurações > Desenvolvedor > Editar configuração e acrescente ao arquivo claude_desktop_config.json (precisa do Node.js instalado). Depois feche e abra o Claude Desktop.` e o JSON: `{ mcpServers: { financas: { command: 'npx', args: ['-y', 'mcp-remote', ENDERECO, '--header', 'Authorization:${AUTH_HEADER}'], env: { AUTH_HEADER: 'Bearer ' + CHAVE } } } }` (o texto `Authorization:${AUTH_HEADER}` vai literal, com o cifrão e as chaves: é o próprio programa que substitui).
   - **Cursor** — texto: `Crie o arquivo .cursor/mcp.json na pasta do projeto (ou ~/.cursor/mcp.json para valer em todos):` e o JSON `{ mcpServers: { financas: { url: ENDERECO, headers: { Authorization: 'Bearer ' + CHAVE } } } }`
   - **VS Code** — texto: `Crie o arquivo .vscode/mcp.json na pasta do projeto:` e o JSON `{ servers: { financas: { type: 'http', url: ENDERECO, headers: { Authorization: 'Bearer ' + CHAVE } } } }`
   - **Pelo navegador** — `<Aviso tipo="info">O ChatGPT e o Claude pelo navegador rodam na nuvem e não alcançam o seu computador. Para usar com eles, o sistema precisa estar publicado na internet com HTTPS (um domínio seu ou um túnel). Isso expõe a tela de login: use uma senha forte.</Aviso>`; texto: `Com o sistema publicado, cadastre um conector personalizado (nas configurações do aplicativo, em Conectores) com este endereço, que já leva a chave:` e o exemplo `https://SEU-ENDERECO/api/mcp/${CHAVE}`; texto suave: `Quem tiver esse endereço consulta seus dados. Trate-o como uma senha e prefira uma chave "Só consulta".`
   - Abaixo das abas, texto suave: `O caminho dos menus muda entre as versões de cada aplicativo; o que importa é o endereço e o cabeçalho Authorization.`
5. `<Cartao titulo="O que a IA pode fazer">`: duas listas a partir de `ferramentas`: `Consultar` (as com `escrita === false`) e `Lançar (só chaves "Consulta e lança")` (as com `escrita === true`). Cada item: `titulo` em negrito e `descricao` em texto suave. Texto suave no fim: `Nenhuma ferramenta apaga dados. Cada chave enxerga só o perfil financeiro em que foi criada.`

### Modal "Nova chave"

`Campo` rótulo `Nome` (obrigatório, até 60 caracteres; ex.: placeholder não é necessário), `Selecao` rótulo `Permissão` com `Só consulta` (`LEITURA`, padrão) e `Consulta e lança` (`ESCRITA`). Quando `ESCRITA` está escolhida, `<Aviso tipo="info">A IA poderá criar lançamentos e mudar categorias. Ela não apaga nada.</Aviso>`. Botões `Cancelar` e `Criar chave` (desabilitado enquanto envia ou com nome vazio). Erro em `<Aviso tipo="erro">` com `mensagemErro`. Sucesso: fecha o modal, guarda a resposta em `nova`, recarrega a lista e rola a página para o topo (`window.scrollTo({ top: 0 })`).

### Apagar

`Modal` de confirmação: `Apagar a chave "{nome}"? O aplicativo que a usa perde o acesso na hora.` com `Cancelar` e `Apagar chave` (variante `perigo`). Depois de apagar, recarrega a lista; se a chave apagada era a `nova`, limpa `nova`.

## CSS (`ia.css`)

Só variáveis do tema; sem `!important`; sem hexadecimal. `.ia-codigo`: `display: block; padding: 0.75rem 1rem; background: var(--cor-fundo, var(--cor-superficie)); border: 1px solid var(--cor-borda); border-radius: var(--raio); font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 0.85rem; white-space: pre-wrap; overflow-wrap: anywhere; user-select: all;` (confira em `client/src/ui/estilo.css` o nome real da variável de fundo da página). Blocos da página com `gap: 1rem`. Tudo cabe em 360 px sem rolagem horizontal da página.

## Critérios de aceite

- `cd client && npx tsc --noEmit` sem erros.
- Sem `any`, sem `// @ts-ignore`, sem biblioteca nova.
- A chave completa nunca é gravada em `localStorage` nem em nenhum outro armazenamento: fica só no estado do componente.
- Os JSON de exemplo são válidos (gerados com `JSON.stringify`).
- Nenhum arquivo além dos três listados foi alterado.
