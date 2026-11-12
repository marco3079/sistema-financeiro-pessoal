# g21 — Tela Drive (dados na pasta sincronizada)

## Objetivo

Tela `/app/drive` que mostra e controla a sincronização dos dados com uma pasta do Drive (Google Drive, OneDrive, Dropbox), para usar o sistema em mais de um computador. O servidor já faz tudo sozinho a cada 20 segundos; a tela mostra o estado, explica como conectar e resolve os casos que pedem decisão. Na interface o nome é só **Drive** (nunca "Google Drive" como nome do recurso).

Leia antes: `client/src/modules/importar/Cotacoes.tsx` (padrão de cartão com estado, botões e `api`), `client/src/modules/importar/Historico.tsx`, `client/src/ui/index.tsx` (`Pagina`, `Cartao`, `Botao`, `Aviso`, `Carregando`, `Selo`, `Modal`, `formatarDataHora`), `client/src/ui/financas.tsx` (`ResumoItem`), `client/src/lib/api.ts`, `client/src/lib/useDados.ts`, `client/src/lib/financas.ts` (`mensagemErro`).

## Arquivos (só estes)

- criar `client/src/modules/drive/index.tsx`
- criar `client/src/modules/drive/Drive.tsx`
- criar `client/src/modules/drive/drive.css`

## Rota

```tsx
export const rotas: RotaModulo[] = [
  { caminho: '/app/drive', rotulo: 'Drive', icone: 'sincronizar', perfis: ['TITULAR'], elemento: <Drive />, ordem: 59 },
];
```

## API

```ts
interface EstadoDriveDTO {
  configurado: boolean;          // há pasta escolhida (PASTA_DRIVE no .env)
  pasta: string | null;          // caminho da pasta neste computador
  acessivel: boolean;            // o sistema consegue ler e gravar nela
  maquina: string;               // nome deste computador
  versao: string | null;
  alteracoesAEnviar: boolean;    // há mudança local ainda não gravada na pasta
  sincronizadoEm: string | null; // ISO
  pendencia: 'ESCOLHER' | null;  // primeira conexão de um computador que já tinha dados
  erro: string | null;
  naPasta: { atualizadoEm: string; maquina: string; registros: number } | null;
  ultimoConflito: { quando: string; copia: string } | null;
}
```

- `GET /drive/estado` → `EstadoDriveDTO`
- `POST /drive/sincronizar` (corpo `{}`) → `EstadoDriveDTO` (roda um ciclo agora)
- `POST /drive/escolher` corpo `{ origem: 'PASTA' | 'COMPUTADOR' }` → `EstadoDriveDTO`

## Comportamento

- Estado em `useState<EstadoDriveDTO | null>`; carregue com `api.get` ao montar e de novo a cada 10 segundos (`setInterval` dentro de `useEffect`, limpo no retorno). Erro de carga → `<Aviso tipo="erro">`.
- Guarde em um `useRef` a `versao` vista na primeira carga. Quando uma carga seguinte trouxer `versao` diferente E `alteracoesAEnviar === false` (ou seja, este computador RECEBEU dados novos da pasta), mostre no topo `<Aviso tipo="info">Este computador recebeu dados novos do Drive.</Aviso>` com um `Botao` `Recarregar o sistema` que faz `window.location.assign('/app')`. Não recarregue sozinho.

## O que a tela mostra

`<Pagina titulo="Drive" acoes={configurado && acessivel ? <Botao desabilitado={enviando} aoClicar={sincronizar}>{enviando ? 'Sincronizando…' : 'Sincronizar agora'}</Botao> : undefined}>`

### Caso A — `configurado === false`

`<Cartao titulo="Use o sistema em mais de um computador">` com:

1. Texto: `Escolha uma pasta do seu Drive (Google Drive, OneDrive, Dropbox). O sistema guarda nela uma cópia completa dos seus dados e a mantém atualizada. No outro computador, basta instalar o sistema e escolher a mesma pasta: os dados aparecem sozinhos.`
2. Lista numerada (`<ol className="drive-passos">`):
   1. `Instale o programa do Drive neste computador e confira que a pasta aparece no Explorador de Arquivos.`
   2. `Na pasta em que o sistema foi instalado, clique com o botão direito em conectar-drive.ps1 e escolha "Executar com o PowerShell".`
   3. `Escolha uma pasta dentro do Drive (por exemplo "Meu Drive\Finanças").`
   4. `O sistema reinicia sozinho. Volte a esta tela: em até um minuto os dados são enviados.`
   5. `No outro computador, repita os passos e escolha a mesma pasta.`
3. `<Aviso tipo="info">No Linux ou no Mac, escreva o caminho da pasta em PASTA_DRIVE no arquivo .env e rode "docker compose up -d".</Aviso>`

### Caso B — `configurado && !acessivel`

`<Aviso tipo="erro">O sistema não consegue abrir a pasta {pasta}. Confira se o programa do Drive está aberto e se a pasta ainda existe. No Google Drive, use o modo "Espelhar arquivos" ou uma pasta que exista de verdade no disco.</Aviso>`

### Caso C — `configurado && acessivel`

1. Se `erro`: `<Aviso tipo="erro">{erro}</Aviso>`.
2. Se `pendencia === 'ESCOLHER'`: `<Cartao titulo="Qual versão dos dados vale?">` com o texto `Este computador já tem dados, e a pasta do Drive também (gravados em {formatarDataHora(naPasta.atualizadoEm)} por {naPasta.maquina}). Escolha qual deles fica. O outro é guardado na pasta como cópia de segurança, sem ser apagado.` e dois botões: `Usar os dados da pasta` e `Usar os dados deste computador` (variante `secundario`). Cada um abre um `Modal` de confirmação (`Os dados deste computador serão trocados pelos da pasta.` / `Os dados da pasta serão trocados pelos deste computador.`, com `Cancelar` e `Confirmar`). Ao confirmar: `POST /drive/escolher`; no caso `PASTA`, depois do sucesso faça `window.location.assign('/app')`.
3. `<div className="resumo">` com três `ResumoItem`:
   - Situação: `Tudo sincronizado` (cor `verde`, ícone `visto`) quando `!alteracoesAEnviar && !pendencia && !erro`; `Enviando alterações` (cor `laranja`, ícone `sincronizar`) quando `alteracoesAEnviar`; `Aguardando sua escolha` quando há pendência; `Com erro` (cor `vermelho`) quando há erro. Rótulo `Situação`.
   - `Última sincronização`: `sincronizadoEm ? formatarDataHora(sincronizadoEm) : 'Ainda não sincronizou'`.
   - `Registros na pasta`: `naPasta ? naPasta.registros.toLocaleString('pt-BR') : '—'`.
   Confira em `icones.tsx` e `ResumoItem` os nomes de ícone e cor que existem.
4. `<Cartao titulo="Pasta">`: pares rótulo/valor (`drive-pares`): `Pasta neste computador` → `pasta`; `Este computador` → `maquina`; `Última gravação na pasta` → `naPasta ? formatarDataHora(naPasta.atualizadoEm) + ' por ' + naPasta.maquina : 'A pasta ainda está vazia'`.
5. Se `ultimoConflito`: `<Aviso tipo="info">Em {formatarDataHora(ultimoConflito.quando)} os dois computadores tinham alterações diferentes. Ficou valendo a mais recente; a outra está guardada na pasta ({ultimoConflito.copia}).</Aviso>`
6. `<Cartao titulo="Como funciona">`: lista simples:
   - `A cada 20 segundos o sistema confere a pasta. O que você altera aqui é gravado nela; o que o outro computador gravou é carregado aqui.`
   - `O programa do Drive leva alguns segundos para subir e baixar o arquivo. Depois de alterar algo, espere a situação voltar para "Tudo sincronizado" antes de usar o outro computador.`
   - `Se os dois computadores alterarem dados no mesmo intervalo, vale a alteração mais recente e a outra fica guardada na pasta, sem ser apagada.`
   - `Para os tokens gravados (cotações, Open Finance) funcionarem nos dois computadores, use o mesmo JWT_SECRET no .env dos dois.`
   - `Para desconectar: powershell -File conectar-drive.ps1 -Desconectar.`

`sincronizar()`: `setEnviando(true)`; `try { setEstado(await api.post('/drive/sincronizar', {})) } catch (e) { setErroAcao(mensagemErro(e)) } finally { setEnviando(false) }`.

## CSS (`drive.css`)

Só variáveis do tema; sem `!important`; sem hexadecimal. `.drive-pares`: grid de 2 colunas (`minmax(140px, 220px) 1fr`) que vira 1 coluna abaixo de 520 px; o caminho da pasta com `overflow-wrap: anywhere`. `.drive-passos li` com `margin-bottom: 0.5rem`. Blocos da página com `gap: 1rem`.

## Critérios de aceite

- `cd client && npx tsc --noEmit` sem erros nos seus arquivos (erros em `src/modules/carteira/` são de outros geradores: ignore e diga que ignorou).
- Sem `any`, sem `// @ts-ignore`, sem biblioteca nova.
- O intervalo de 10 segundos é limpo ao sair da tela.
- A tela nunca recarrega nem troca dados sem um clique.
- Nenhum arquivo além dos três listados foi alterado.
