# g23 — Tela "Atualização" e botão no topo

## Objetivo

O sistema passa a se atualizar para o último commit do repositório no GitHub. Quem atualiza é um script no computador (`atualizar.ps1`); a tela mostra a versão instalada, o que há de novo e tem o botão **Atualizar agora**, que pede a atualização ao script. Você faz a tela e um botão pequeno para o topo. A API já existe.

Leia antes: `client/src/modules/drive/Drive.tsx` (tela com estado consultado de tempos em tempos, `api`, avisos e botões: siga o mesmo padrão), `client/src/layout/BotaoCelular.tsx` (botão redondo do topo), `client/src/ui/index.tsx` (`Pagina`, `Cartao`, `Botao`, `Aviso`, `Carregando`, `Selo`, `Modal`, `Tabela`, `formatarDataHora`), `client/src/ui/financas.tsx` (`ResumoItem`), `client/src/ui/icones.tsx`, `client/src/lib/api.ts`, `client/src/lib/financas.ts` (`mensagemErro`).

## Arquivos (só estes)

- criar `client/src/modules/atualizacao/index.tsx`
- criar `client/src/modules/atualizacao/Atualizacao.tsx`
- criar `client/src/modules/atualizacao/atualizacao.css`
- criar `client/src/layout/BotaoAtualizar.tsx`

Não edite `Layout.tsx`: o main encaixa `<BotaoAtualizar />` no topo.

## Rota

```tsx
export const rotas: RotaModulo[] = [
  { caminho: '/app/atualizacao', rotulo: 'Atualização', icone: 'engrenagem', perfis: ['TITULAR'], elemento: <Atualizacao />, ordem: 97 },
];
```

## API

```ts
export interface CommitDTO { commit: string; data: string | null; mensagem: string }
export interface AtualizacaoDTO {
  // null: o script ainda não rodou neste computador (não se sabe qual commit está instalado)
  instalada: { commit: string; data: string | null; mensagem: string | null; repositorio: string; ramo: string } | null;
  ultima: CommitDTO | null;        // último commit do GitHub
  novidades: CommitDTO[];          // commits que faltam aqui, do mais novo para o mais antigo
  haNovidade: boolean;
  erroDoGitHub: string | null;
  vigiaAtivo: boolean;             // o atualizador está ligado neste computador
  pedidoPendente: boolean;
  ultimaAtualizacao: { situacao: 'ATUALIZANDO' | 'OK' | 'ERRO'; mensagem: string; em: string | null } | null;
}
```

- `GET /atualizacao` → `AtualizacaoDTO` (a consulta ao GitHub é guardada por 5 minutos no servidor)
- `GET /atualizacao?conferir=1` → o mesmo, consultando o GitHub agora
- `POST /atualizacao/pedir` (corpo `{}`) → 202 com `AtualizacaoDTO`; 400 se o atualizador não está ligado; 409 se já há uma em andamento

Exporte os dois tipos de `Atualizacao.tsx` (o botão do topo importa `AtualizacaoDTO` de lá).

## `Atualizacao.tsx`

`export function Atualizacao(): JSX.Element`

Estado em `useState<AtualizacaoDTO | null>`. Carregue ao montar com `api.get('/atualizacao')`.

**Consulta periódica**: `emAndamento = estado.pedidoPendente || estado.ultimaAtualizacao?.situacao === 'ATUALIZANDO' || aguardando` (onde `aguardando` é um estado local que fica `true` depois que o pedido foi aceito). Enquanto `emAndamento`, consulte a cada 4 segundos; fora disso, a cada 60 segundos. Use `setInterval` dentro de `useEffect` (dependência: `emAndamento`) e limpe no retorno. Durante a atualização o servidor reinicia e as consultas falham por um ou dois minutos: nesse período NÃO mostre erro; mantenha o último estado e o texto `O sistema está reiniciando…`. Guarde num `useRef` o commit instalado no momento do pedido; quando uma consulta voltar com `instalada.commit` diferente dele, ou com `ultimaAtualizacao.situacao` igual a `OK` ou `ERRO` e `em` mais novo que o momento do pedido, pare de aguardar (`aguardando = false`) e, se o commit mudou, mostre `<Aviso tipo="info">Sistema atualizado.</Aviso>` com um `Botao` `Recarregar a página` (`window.location.reload()`). Não recarregue sozinho.

`<Pagina titulo="Atualização" acoes={<Botao variante="secundario" desabilitado={conferindo || emAndamento} aoClicar={conferir}>{conferindo ? 'Conferindo…' : 'Conferir agora'}</Botao>}>` — `conferir()` chama `GET /atualizacao?conferir=1`.

De cima para baixo:

1. Erro de carga → `<Aviso tipo="erro">`; sem dados → `<Carregando />`; `erroDoGitHub` → `<Aviso tipo="erro">{erroDoGitHub}</Aviso>`.
2. `<div className="resumo">` com três `ResumoItem`:
   - `Versão instalada`: `instalada ? instalada.commit.slice(0, 7) : 'Desconhecida'`
   - `Última versão no GitHub`: `ultima ? ultima.commit.slice(0, 7) : '—'`
   - `Situação`: `Atualizando…` quando `emAndamento`; `Há versão nova` (cor `laranja`) quando `haNovidade`; `Em dia` (cor `verde`) quando `instalada && !haNovidade && !erroDoGitHub`; senão `—`.
   Confira em `icones.tsx` e em `ResumoItem` os nomes de ícone e de cor que existem.
3. **Quando `instalada === null`**: `<Cartao titulo="Ligue o atualizador">` com o texto `O sistema ainda não sabe qual versão está instalada neste computador. Na pasta em que ele foi instalado, clique com o botão direito em atualizar.ps1 e escolha "Executar com o PowerShell" usando o comando abaixo, uma única vez:` e um bloco `<code className="atu-codigo">powershell -ExecutionPolicy Bypass -File atualizar.ps1 -Instalar</code>`, e o texto suave `Isso cria uma tarefa do Windows que espera o seu clique em "Atualizar agora". Ela só sabe baixar a versão nova deste repositório e reconstruir o sistema.` Não mostre os itens 4 e 5.
4. **Quando há `instalada`**: `<Cartao titulo={haNovidade ? 'Há uma versão nova' : 'Você está na última versão'}>`:
   - linha `Instalada: {commit curto} · {mensagem} · {formatarDataHora(data)}` (omita o que for null) e `Repositório: {repositorio} ({ramo})` em texto suave.
   - se `emAndamento`: um bloco `atu-andamento` com `<Carregando />` e o texto `ultimaAtualizacao?.situacao === 'ATUALIZANDO' ? ultimaAtualizacao.mensagem : 'Pedido enviado. Aguardando o atualizador…'` e, abaixo, texto suave `Pode levar alguns minutos. Não feche o Docker. A tela pode ficar sem resposta enquanto o sistema reinicia.`
   - senão, se `haNovidade`: o botão `Atualizar agora` (primário). Se `!vigiaAtivo`, o botão fica desabilitado e aparece `<Aviso tipo="info">O atualizador não está ligado neste computador. Para o botão funcionar, rode uma vez: powershell -ExecutionPolicy Bypass -File atualizar.ps1 -Instalar. Ou atualize agora rodando atualizar.ps1 (sem o -Instalar).</Aviso>`.
   - clicar em `Atualizar agora` abre um `Modal` de confirmação: `O sistema guarda uma cópia do banco de dados, baixa a versão nova do GitHub e reinicia. Ele fica fora do ar por alguns minutos.` com `Cancelar` e `Atualizar`. Confirmar: `POST /atualizacao/pedir`; sucesso → guarda o commit atual no `useRef`, `aguardando = true`; erro → `<Aviso tipo="erro">` com `mensagemErro`.
5. Se `novidades.length > 0`: `<Cartao titulo={`O que há de novo (${novidades.length})`}>` com uma lista (`atu-novidades`): cada item com o commit curto em `<code>`, a `mensagem` e a data (`formatarDataHora`) em texto suave.
6. Se `ultimaAtualizacao` e a situação é `OK` ou `ERRO` (e não está em andamento): `<Aviso tipo={situacao === 'ERRO' ? 'erro' : 'info'}>{situacao === 'ERRO' ? 'A última atualização falhou: ' : 'Última atualização: '}{mensagem}{em ? ' (' + formatarDataHora(em) + ')' : ''}</Aviso>`
7. `<Cartao titulo="Como funciona">`, lista:
   - `O sistema compara a versão instalada com o último commit do repositório no GitHub.`
   - `Ao atualizar, uma cópia do banco de dados é guardada na pasta backups (ficam as 5 mais recentes).`
   - `Seus dados não são apagados: só o programa é trocado.`
   - `Se você alterou arquivos do sistema neste computador e eles conflitarem com a versão nova, a atualização para sem apagar nada e mostra o erro aqui.`
   - `Para desligar o atualizador: powershell -ExecutionPolicy Bypass -File atualizar.ps1 -Desinstalar.`

## `client/src/layout/BotaoAtualizar.tsx`

`export function BotaoAtualizar(): JSX.Element | null`

- Ao montar e depois a cada 30 minutos, `api.get<AtualizacaoDTO>('/atualizacao')` (erros são ignorados em silêncio; limpe o intervalo no retorno).
- Sem dados ou `haNovidade === false` → `null` (o botão só existe quando há versão nova).
- Com novidade: `<button type="button" className="casca-botao-redondo atu-botao-topo" aria-label="Há uma versão nova do sistema" title="Há uma versão nova do sistema" onClick={() => navigate('/app/atualizacao')}>` com um ícone de `icones.tsx` (procure um de download, seta para baixo ou sincronizar; use o componente `Icone`) e um ponto de destaque (`<span className="atu-ponto" aria-hidden="true" />`).
- Importe `'../modules/atualizacao/atualizacao.css'` para as classes `atu-botao-topo` e `atu-ponto`.

## CSS (`atualizacao.css`)

Só variáveis do tema; sem `!important`; sem hexadecimal. `.atu-codigo`: bloco monoespaçado com borda, `overflow-wrap: anywhere`, `user-select: all`. `.atu-botao-topo { position: relative; }` e `.atu-ponto`: bolinha de 9 px no canto superior direito, fundo `var(--cor-aviso)`, com borda de 2 px `var(--cor-superficie)`. Blocos da página com `gap: 1rem`. Tudo cabe em 360 px sem rolagem horizontal da página.

## Critérios de aceite

- `cd client && npx tsc --noEmit` sem erros.
- Sem `any`, sem `// @ts-ignore`, sem biblioteca nova.
- Os intervalos são limpos ao sair da tela; nada recarrega a página sem clique.
- Falha de consulta durante a atualização não vira mensagem de erro.
- Nenhum arquivo além dos quatro listados foi alterado.
