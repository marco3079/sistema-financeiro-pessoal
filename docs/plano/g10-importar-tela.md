# g10 — Tela Importar: página e prévia de fatura/extrato

Leia antes: `docs/plano/CONTRATOS.md` (seções "Regras gerais" e "Cliente: como escrever uma tela"),
`client/src/modules/importar/tipos.ts` (inteiro: são os formatos da API), `client/src/modules/importar/lerArquivo.ts`,
`client/src/lib/financas.ts`, `client/src/ui/financas.tsx`, `client/src/ui/index.tsx`,
`client/src/modules/cadastros/usuarios.tsx` (modelo de tela).

## Contexto

O usuário não usa mais o Open Finance como caminho principal. Ele baixa do banco a fatura do cartão ou o extrato da conta
(CSV, OFX ou PDF) e a planilha da B3 (XLSX) e envia nesta tela. O navegador abre o arquivo (`lerArquivo`), manda o conteúdo
para o servidor analisar, mostra uma prévia e só grava quando o usuário confirma. O servidor já existe e está pronto.

O g11 faz, ao mesmo tempo, três componentes que a sua página usa. Programe contra estas assinaturas (não crie esses arquivos):

```ts
// client/src/modules/importar/PreviaB3.tsx
export function PreviaB3(props: { nome: string; planilhas: Planilha[]; aoConcluir: (mensagem: string) => void; aoDescartar: () => void }): JSX.Element
// client/src/modules/importar/Cotacoes.tsx
export function Cotacoes(props: { versao: number }): JSX.Element   // recarrega quando `versao` muda
// client/src/modules/importar/Historico.tsx
export function Historico(props: { versao: number }): JSX.Element  // recarrega quando `versao` muda
```

## Arquivos que você pode criar (só estes)

- `client/src/modules/importar/index.tsx`
- `client/src/modules/importar/Importar.tsx`
- `client/src/modules/importar/PreviaLancamentos.tsx`
- `client/src/modules/importar/importar.css`

## `index.tsx`

Uma rota — caminho `/app/importar`, rótulo `Importar`, ícone `importar`, perfis `['TITULAR']`, elemento `<Importar />`, ordem `58`.

## `Importar.tsx` (export `Importar`)

Estado:

```ts
interface NaFila { id: number; lido: ArquivoLido }           // ArquivoLido vem de ./lerArquivo
const [fila, setFila] = useState<NaFila[]>([]);
const [lendo, setLendo] = useState(false);
const [erros, setErros] = useState<string[]>([]);
const [sucessos, setSucessos] = useState<string[]>([]);
const [versao, setVersao] = useState(0);
const [arrastando, setArrastando] = useState(false);
```

Função `receber(arquivos: File[])`: `setLendo(true)`; para cada arquivo, `try { const lido = await lerArquivo(arquivo); ...adiciona à fila com id único (use um contador em `useRef`) } catch (e) { adiciona `${arquivo.name}: ${mensagemErro(e)}` a `erros` }`; no fim `setLendo(false)`. Limpe `erros` no começo de cada chamada.

Layout:

1. `<Pagina titulo="Importar">`.
2. Área de envio: `<label className={arrastando ? 'importar-area importar-area-ativa' : 'importar-area'}>` com:
   `<input type="file" multiple accept=".csv,.txt,.ofx,.qfx,.pdf,.xlsx" className="importar-input" onChange={...} />` (depois de ler, zere `e.target.value` para
   permitir escolher o mesmo arquivo de novo), o ícone `<Icone nome="importar" tamanho={32} />`, o título
   `Arraste os arquivos para cá ou clique para escolher` e, em `fin-suave`, o texto
   `Fatura do cartão ou extrato da conta em CSV, OFX ou PDF. Planilha de movimentação ou de posição da B3 em XLSX.`
   Trate `onDragOver` (com `preventDefault()` e `setArrastando(true)`), `onDragLeave` e `onDrop` (com `preventDefault()`,
   `setArrastando(false)` e `receber(Array.from(e.dataTransfer.files))`).
3. `{lendo && <Carregando />}`; cada erro em `<Aviso tipo="erro">`; cada sucesso em `<Aviso tipo="sucesso">`.
4. Para cada item da fila (na ordem), dentro de `<Cartao>`:
   - `lido.tipo === 'texto'` → `<PreviaLancamentos arquivo={lido} aoConcluir={(msg) => concluir(id, msg)} aoDescartar={() => descartar(id)} />`
   - `lido.tipo === 'planilha'` → `<PreviaB3 nome={lido.nome} planilhas={lido.planilhas} aoConcluir={...} aoDescartar={...} />`
   `concluir(id, msg)`: tira o item da fila, acrescenta `msg` a `sucessos`, `setVersao((v) => v + 1)`. `descartar(id)`: só tira da fila.
   Use `key={item.id}`.
5. `<div className="fin-duas-colunas">` com `<Cotacoes versao={versao} />` e um `<Cartao titulo="Como baixar os arquivos">` com a lista:
   - `Fatura do cartão: no aplicativo ou no site do banco, abra a fatura e escolha exportar em CSV (ou OFX). Se só houver PDF, envie o PDF.`
   - `Extrato da conta: exporte o período desejado em CSV ou OFX.`
   - `Investimentos: na Área do Investidor da B3 (investidor.b3.com.br), abra Extratos > Movimentação, filtre o período mais longo possível e baixe em Excel.`
   - `Pode enviar o mesmo arquivo de novo: o que já foi importado não é duplicado.`
6. `<Historico versao={versao} />`.

## `PreviaLancamentos.tsx`

```ts
export function PreviaLancamentos(props: {
  arquivo: { nome: string; formato: FormatoArquivo; texto: string };
  aoConcluir: (mensagem: string) => void;
  aoDescartar: () => void;
}): JSX.Element
```

Estado: `analise: AnaliseArquivo | null`, `carregando`, `erro: string | null`, `documento: TipoDocumento | null` (escolha do usuário; começa `null`),
`contaId: string` (`''` = nenhuma; `'nova'` = criar), `nomeNovaConta: string`, `vencimento: string`, `saldoFinal: string`,
`marcados: boolean[]`, `enviando: boolean`.

Função `analisar(documentoPedido: TipoDocumento | null, contaPedida: number | null)`:
`api.post<AnaliseArquivo>('/importacao/analisar', { nome, formato, texto, documento: documentoPedido, contaId: contaPedida })`.
Ao receber: grave `analise`; `setVencimento(a.vencimento ?? '')`; `setMarcados(a.itens.map((i) => !i.jaImportado))`;
se `contaPedida === null`: `setContaId(a.contaSugeridaId !== null ? String(a.contaSugeridaId) : a.contas.length === 0 ? 'nova' : '')` e
`setNomeNovaConta(a.banco ? (a.documento === 'FATURA' ? 'Cartão ' + a.banco : 'Conta ' + a.banco) : '')`.

- Ao montar: `analisar(null, null)` (um `useEffect` com dependências vazias; use um sinalizador `ativo` para ignorar resposta depois de desmontar).
- Ao trocar o tipo de documento (Selecao): `setDocumento(novo)` e `analisar(novo, null)`.
- Ao trocar a conta para uma conta existente: `setContaId(valor)` e `analisar(documento ?? analise.documento, Number(valor))`
  (isso atualiza quais itens já foram importados naquela conta). Para `''` ou `'nova'`: só `setContaId`.

Layout (quando há `analise`):

1. Cabeçalho `fin-cabecalho`: à esquerda o nome do arquivo em `<strong>` e, em `fin-suave`, `Banco: <banco ?? 'não identificado'>`;
   à direita `<Botao variante="texto" aoClicar={aoDescartar}>Descartar</Botao>`.
2. Cada `aviso` de `analise.avisos` em `<Aviso tipo="info">`.
3. Se `analise.itens.length === 0`: pare aqui (só o cabeçalho e os avisos).
4. `<div className="filtros">`:
   - `<Selecao rotulo="Tipo de arquivo" valor={analise.documento} opcoes={[{ valor: 'FATURA', rotulo: 'Fatura do cartão' }, { valor: 'EXTRATO', rotulo: 'Extrato da conta' }]} />`
   - `<Selecao rotulo={FATURA ? 'Cartão' : 'Conta'} valor={contaId} opcoes={[...analise.contas.map((c) => ({ valor: String(c.id), rotulo: c.nome })), { valor: 'nova', rotulo: FATURA ? 'Criar um cartão novo' : 'Criar uma conta nova' }]} vazio="Escolha" />`
   - se `contaId === 'nova'`: `<Campo rotulo={FATURA ? 'Nome do cartão' : 'Nome da conta'} valor={nomeNovaConta} aoMudar={setNomeNovaConta} />`
   - em FATURA: `<Campo rotulo="Vencimento da fatura" tipo="date" valor={vencimento} aoMudar={setVencimento} />`
   - em EXTRATO: `<Campo rotulo="Saldo da conta depois deste extrato (R$, opcional)" valor={saldoFinal} aoMudar={setSaldoFinal} />`
5. `<div className="resumo">` com 3 `ResumoItem` calculados SOBRE OS MARCADOS (índices com `marcados[i] === true`):
   - FATURA: `Total da fatura` (ícone `cartao`, laranja; soma de `valor` das `DESPESA` sem `transferencia` menos a soma das `RECEITA` sem `transferencia`),
     `Lançamentos a importar` (`transacoes`, azul; quantidade marcada), `Já importados` (`visto`, verde; quantidade com `jaImportado`).
   - EXTRATO: `Entradas` (`seta-cima`, verde; soma das `RECEITA`), `Saídas` (`seta-baixo`, vermelho; soma das `DESPESA`), `Lançamentos a importar` (`transacoes`, azul).
6. `Tabela` dos itens (use o índice como chave: monte antes `const linhas = analise.itens.map((item, indice) => ({ ...item, indice }))`):
   - coluna `Importar`: `<input type="checkbox" checked={marcados[l.indice]} onChange={...} aria-label={'Importar ' + l.descricao} />`
   - `Data` (`formatarDia`), `Descrição` (descrição; embaixo, em `fin-suave`, `Parcela X de Y` quando houver; `<Selo cor="cinza">Já importado</Selo>` quando `jaImportado`;
     `<Selo cor="azul">Pagamento/transferência</Selo>` quando `transferencia`),
     `Valor` (`alinhar: 'direita'`; em FATURA: `<Valor valor={l.valor} sentido={l.tipo === 'DESPESA' ? 'saida' : 'entrada'} />`; idem em EXTRATO).
   `vazio="Nenhum lançamento."`
   Acima da tabela, `<div className="pagina-acoes">` com `<Botao variante="texto">Marcar todos</Botao>` e `<Botao variante="texto">Desmarcar todos</Botao>`.
7. `{erro && <Aviso tipo="erro">{erro}</Aviso>}` e `<div className="pagina-acoes">` com
   `<Botao desabilitado={enviando || nenhumMarcado} aoClicar={confirmar}>Importar N lançamentos</Botao>`.

`confirmar()`:

- validações (mostre em `erro` e não envie): `contaId === ''` → `Escolha o cartão (ou a conta) de destino.`; `contaId === 'nova'` com nome vazio → `Informe o nome.`;
  FATURA sem `vencimento` → `Informe o vencimento da fatura.`; EXTRATO com `saldoFinal` preenchido e `lerValor(saldoFinal) === null` → `Informe um saldo válido.`
- corpo (`ConfirmarArquivo`): `arquivo: nome`, `documento: analise.documento`, `banco: analise.banco`,
  `contaId: contaId === 'nova' ? null : Number(contaId)`, `novaConta: contaId === 'nova' ? { nome: nomeNovaConta.trim() } : null`,
  `vencimento: FATURA ? vencimento : null`, `saldoFinal: EXTRATO && saldoFinal.trim() !== '' ? lerValor(saldoFinal) : null`,
  `itens`: os marcados, cada um só com `{ data, descricao, valor, tipo, transferencia, parcela, totalParcelas }` (SEM `jaImportado` e SEM `indice`).
- `const r = await api.post<ResultadoArquivo>('/importacao/confirmar', corpo)`; depois
  `aoConcluir(`${nome}: ${r.novos} ${r.novos === 1 ? 'lançamento importado' : 'lançamentos importados'} em ${r.contaNome}` + (r.repetidos > 0 ? ` (${r.repetidos} já existiam)` : '') + '.')`.
- erro: `setErro(mensagemErro(e))`; `setEnviando(false)` no `finally`.

Enquanto `carregando` e sem `analise`: `<Carregando />`. Erro na análise sem `analise`: `<Aviso tipo="erro">` + botão `Descartar`.

## `importar.css`

Classes `importar-area` (bloco em coluna, centralizado, `gap: 0.5rem`, `padding: 2rem 1rem`, borda `2px dashed var(--cor-borda)`, `border-radius: var(--raio)`,
fundo `var(--cor-superficie)`, cor `var(--cor-texto)`, `cursor: pointer`, `text-align: center`), `importar-area-ativa` (borda `var(--cor-primaria)` e fundo
`var(--cor-primaria-suave)`), `importar-input` (escondido de forma acessível: `position: absolute; width: 1px; height: 1px; opacity: 0;`).
Importe o CSS em `Importar.tsx`. Só variáveis de cor de `estilo.css`.

## Aceite

- `cd client && npx tsc --noEmit` sem erros nos seus arquivos (erros por `PreviaB3`, `Cotacoes` ou `Historico` ainda não existirem são do g11: ignore e avise).
- Nenhum `any`. Nenhuma cor fixa em CSS.
