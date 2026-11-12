# g11 — Tela Importar: prévia da planilha da B3, cotações e histórico

Leia antes: `docs/plano/CONTRATOS.md` (seções "Regras gerais" e "Cliente: como escrever uma tela"),
`client/src/modules/importar/tipos.ts` (inteiro: são os formatos da API), `client/src/lib/financas.ts`,
`client/src/ui/financas.tsx`, `client/src/ui/index.tsx`, `client/src/modules/cadastros/usuarios.tsx` (modelo de tela).

## Contexto

A tela Importar (feita pelo g10) recebe arquivos. Quando o arquivo é a planilha da B3 (XLSX), ela mostra o seu componente `PreviaB3`.
Embaixo, mostra `Cotacoes` (token e atualização dos preços dos ativos) e `Historico` (o que já foi importado). O servidor já existe.

## Arquivos que você pode criar (só estes)

- `client/src/modules/importar/PreviaB3.tsx`
- `client/src/modules/importar/Cotacoes.tsx`
- `client/src/modules/importar/Historico.tsx`
- `client/src/modules/importar/importar-b3.css` (opcional)

## `PreviaB3.tsx`

```ts
export function PreviaB3(props: {
  nome: string; // nome do arquivo
  planilhas: Planilha[];
  aoConcluir: (mensagem: string) => void;
  aoDescartar: () => void;
}): JSX.Element
```

Estado: `analise: AnaliseB3 | null`, `carregando`, `erro: string | null`, `marcadas: Record<string, boolean>` (por `chave`), `enviando`.

Ao montar (um `useEffect` com dependências vazias e um sinalizador `ativo`):
`api.post<AnaliseB3>('/importacao/b3/analisar', { nome, planilhas })`. Ao receber: grave `analise` e
`setMarcadas(Object.fromEntries(a.posicoes.map((p) => [p.chave, !p.suspeita])))`.

Layout (com `analise`):

1. Cabeçalho `fin-cabecalho`: à esquerda o nome do arquivo em `<strong>` e, em `fin-suave`:
   `MOVIMENTACAO` → `Movimentação da B3` + (com `periodo`: ` de ${formatarDia(de)} a ${formatarDia(ate)}`); `POSICAO` → `Posição da B3`; `DESCONHECIDA` → `Planilha não reconhecida`.
   À direita `<Botao variante="texto" aoClicar={aoDescartar}>Descartar</Botao>`.
2. Cada aviso de `analise.avisos` em `<Aviso tipo="info">`.
3. Se `analise.posicoes.length === 0`: pare aqui.
4. `<div className="resumo">` com 4 `ResumoItem`: `Ativos a importar` (ícone `investimentos`, azul; quantidade marcada),
   `Valor aplicado` (`financeiro`, roxo; `formatarReais` da soma de `valorAplicado ?? 0` das marcadas),
   `Proventos recebidos` (`seta-cima`, verde; `formatarReais(analise.totalProventos)`),
   `Movimentos no arquivo` (`transacoes`, laranja; `analise.movimentos.length`).
5. Se alguma posição tem `suspeita`: `<Aviso tipo="info">Os ativos desmarcados não têm movimento há mais de um ano ou a quantidade não bate com o último provento: provavelmente saíram da carteira ou mudaram de código. Marque só os que você ainda tem.</Aviso>`
6. `<div className="pagina-acoes">` com `Botao variante="texto"`: `Marcar todos` e `Desmarcar todos`.
7. `Tabela<PosicaoB3>` (`chave={(p) => p.chave}`), colunas:
   - `Importar`: `<input type="checkbox" checked={marcadas[p.chave] ?? false} onChange={...} aria-label={'Importar ' + p.chave} />`
   - `Ativo`: `<strong>{p.codigo ?? p.nome}</strong>`; embaixo, em `fin-suave`, `p.nome` (quando há `codigo`) e `p.instituicao`;
     `<Selo cor="azul">Atualiza</Selo>` quando `investimentoId !== null`, senão `<Selo cor="verde">Novo</Selo>`;
     `<Selo cor="amarelo">Conferir</Selo>` quando `suspeita`.
   - `Tipo`: `rotuloDe(TIPOS_INVESTIMENTO, p.tipo)`
   - `Quantidade` (`alinhar: 'direita'`): `p.quantidade.toLocaleString('pt-BR', { maximumFractionDigits: 6 })`
   - `Aplicado` (direita): `p.valorAplicado === null ? '—' : formatarReais(p.valorAplicado)`
   - `Saldo` (direita; só inclua esta coluna quando `analise.tipo === 'POSICAO'`): `p.saldo === null ? '—' : formatarReais(p.saldo)`
   - `Proventos` (direita): `p.proventos > 0 ? formatarReais(p.proventos) : '—'`
   - `Último movimento`: `formatarDia(p.ultimoMovimento)`
   `vazio="Nenhum ativo."` — use um wrapper `<span className="b3-celula">` em coluna para o nome (nome em cima, apoio embaixo).
8. `{erro && <Aviso tipo="erro">{erro}</Aviso>}` e `<div className="pagina-acoes">` com
   `<Botao desabilitado={enviando || nenhumaMarcada} aoClicar={confirmar}>Importar N ativos</Botao>`.

`confirmar()` — corpo `ConfirmarB3`:

- `arquivo: nome`, `tipo: analise.tipo` (só é chamado quando o tipo é `MOVIMENTACAO` ou `POSICAO`; se for `DESCONHECIDA` não há botão),
  `periodo: analise.periodo`,
- `posicoes`: as marcadas, cada uma só com `{ chave, codigo, nome, tipo, subtipo, instituicao, quantidade, valorAplicado, saldo, vencimento }`,
- `movimentos`: `analise.movimentos.filter((m) => marcadas[m.chave])`,
- `encerradas: analise.encerradas`.
- `const r = await api.post<ResultadoB3>('/importacao/b3/confirmar', corpo)`; depois
  `aoConcluir(`${nome}: ${r.criados} ${r.criados === 1 ? 'ativo novo' : 'ativos novos'}, ${r.atualizados} atualizados e ${r.movimentosNovos} movimentos importados` + (r.movimentosRepetidos > 0 ? ` (${r.movimentosRepetidos} já existiam)` : '') + '.')`.
- erro: `setErro(mensagemErro(e))`; `setEnviando(false)` no `finally`.

Enquanto carrega sem `analise`: `<Carregando />`. Erro sem `analise`: `<Aviso tipo="erro">` + botão `Descartar`.

## `Cotacoes.tsx`

```ts
export function Cotacoes(props: { versao: number }): JSX.Element
```

Estado: `estado: EstadoCotacoes | null`, `token: string`, `erro`, `sucesso`, `ocupado`.
Carregue com `api.get<EstadoCotacoes>('/cotacoes/estado')` num `useEffect` que depende de `versao` (sinalizador `ativo`).

`<Cartao titulo="Cotações automáticas">`:

1. Texto em `fin-suave`: `O preço das ações, dos fundos imobiliários e dos ETFs é atualizado sozinho a cada 8 horas pela brapi.dev. É preciso um token gratuito.`
2. Avisos de `erro` (`<Aviso tipo="erro">`) e `sucesso` (`<Aviso tipo="sucesso">`).
3. Se `estado.configurado`:
   - linha `fin-suave`: `Token configurado` + (`origemToken === 'ENV'` → ` no arquivo .env`) + ` · ${estado.ativosComCodigo} ativos com código` +
     (`ultimaAtualizacao` → ` · atualizado em ${formatarDataHora(ultimaAtualizacao)}`, senão ` · ainda não atualizado`).
   - `<div className="pagina-acoes">`: `<Botao desabilitado={ocupado} aoClicar={atualizar}>Atualizar cotações agora</Botao>` e, quando `origemToken === 'BANCO'`,
     `<Botao variante="perigo" desabilitado={ocupado} aoClicar={apagar}>Apagar token</Botao>` (com `window.confirm('Apagar o token das cotações?')`).
4. Se `!estado.configurado`: lista numerada curta — `1. Crie uma conta gratuita em brapi.dev` (link `<a href="https://brapi.dev" target="_blank" rel="noreferrer">`),
   `2. Copie o seu token no painel da brapi`, `3. Cole aqui e salve` — e um formulário: `<Campo rotulo="Token da brapi" tipo="password" valor={token} aoMudar={setToken} />`
   + `<Botao tipo="submit" desabilitado={ocupado || token.trim() === ''}>Salvar token</Botao>`.

Ações:

- salvar: `setEstado(await api.put<EstadoCotacoes>('/cotacoes/token', { token: token.trim() }))`; `setToken('')`; sucesso `Token salvo.` (o servidor testa o token e devolve 400 com mensagem se for inválido).
- apagar: `await api.del('/cotacoes/token')`; depois recarregue com `api.get<EstadoCotacoes>('/cotacoes/estado')`.
- atualizar: `const r = await api.post<ResultadoCotacoes>('/cotacoes/atualizar')`; `setEstado(r.estado)`;
  se `r.erro` → `setErro(r.erro)`; senão sucesso: `${r.atualizados} ${r.atualizados === 1 ? 'ativo atualizado' : 'ativos atualizados'}.` +
  (`r.semCotacao.length > 0` → ` Sem cotação: ${r.semCotacao.join(', ')}.`).
- Em todas: `setOcupado(true)` antes, limpar `erro` e `sucesso`, `try/catch` com `mensagemErro`, `setOcupado(false)` no `finally`.

Sem `estado` ainda: `<Carregando />`.

## `Historico.tsx`

```ts
export function Historico(props: { versao: number }): JSX.Element
```

`const { dados, carregando, erro, recarregar } = useDados<ImportacaoDTO[]>('/importacao/historico')` e
`useEffect(() => { recarregar(); }, [versao, recarregar])`.

`<Cartao titulo="Arquivos importados">` com `erro` em `<Aviso tipo="erro">`, `<Carregando />` enquanto não há dados, e `Tabela<ImportacaoDTO>`:

- `Quando`: `formatarDataHora(i.criadoEm)`
- `Arquivo`: `i.arquivo`
- `Tipo`: `<Selo cor={i.tipo === 'FATURA' ? 'azul' : i.tipo === 'EXTRATO' ? 'verde' : 'amarelo'}>{i.tipo === 'FATURA' ? 'Fatura' : i.tipo === 'EXTRATO' ? 'Extrato' : 'B3'}</Selo>`
- `Banco`: `i.banco ?? '—'`
- `Referência`: `i.tipo === 'FATURA' && i.referencia ? 'Vencimento ' + formatarDia(i.referencia) : (i.referencia ?? '—')`
- `Conta`: `i.contaNome ?? '—'`
- `Novos` (`alinhar: 'direita'`): `i.novos`; `Repetidos` (direita): `i.repetidos`
- `Total` (direita): `i.total === null ? '—' : formatarReais(i.total)`

`vazio="Nenhum arquivo importado ainda."`

## `importar-b3.css` (se precisar)

Só `.b3-celula { display: flex; flex-direction: column; gap: 2px; min-width: 0; }`. Importe em `PreviaB3.tsx`.

## Aceite

- `cd client && npx tsc --noEmit` sem erros nos seus arquivos (erros em `Importar.tsx` ou `PreviaLancamentos.tsx` são do g10: ignore e avise).
- Nenhum `any`. Nenhuma cor fixa em CSS.
