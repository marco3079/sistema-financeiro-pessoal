# g05 — Investimentos (servidor e tela)

Leia antes: `docs/plano/CONTRATOS.md` (inteiro; seção "investimentos"), `server/prisma/schema.prisma` (models `Investimento`,
`MovimentoInvestimento`), `server/src/lib/financas.ts`, `client/src/lib/financas.ts`, `client/src/ui/financas.tsx`,
`client/src/modules/cadastros/usuarios.tsx` (modelo de tela).

## Arquivos que você pode criar (só estes)

- `server/src/modules/investimentos/routes.ts`
- `client/src/modules/investimentos/index.tsx`
- `client/src/modules/investimentos/Investimentos.tsx`
- `client/src/modules/investimentos/DetalheInvestimento.tsx`
- `client/src/modules/investimentos/investimentos.css` (opcional)

## Servidor: `server/src/modules/investimentos/routes.ts`

`const TIPOS = ['RENDA_FIXA','FUNDO','ACAO','FII','ETF','PREVIDENCIA','CRIPTO','OUTRO'] as const;`
`const TIPOS_MOVIMENTO = ['APLICACAO','RESGATE','RENDIMENTO','IMPOSTO'] as const;`
`const MENSAGEM_OF = 'Este registro vem do Open Finance e é atualizado automaticamente.';`

1. `GET /investimentos`: `where` = `{ ativo: true }` salvo `inativos === 'true'`; `tipo` opcional (só se estiver em `TIPOS`).
   `orderBy: [{ tipo: 'asc' }, { saldo: 'desc' }]`. Calcule sobre a lista devolvida:
   `total` = soma de `saldo`; `aplicado` = soma de `valorAplicado`; `rendimento = arredondar(total - aplicado)`;
   `porTipo` = para cada tipo presente, `{ tipo, total: arredondar(soma), percentual: total > 0 ? Math.round((soma / total) * 1000) / 10 : 0 }`,
   ordenado por `total` desc. Resposta: `{ itens: lista.map(investimentoDTO), total, aplicado, rendimento, porTipo }` (com `arredondar`).
2. `GET /investimentos/:id`: 404 `'Investimento não encontrado'`; movimentos `orderBy: [{ data: 'desc' }, { id: 'desc' }]`, `take: 200`.
   Resposta `{ investimento: investimentoDTO(i), movimentos: lista.map(movimentoDTO) }`.
3. `POST /investimentos`: schema `nome: textoCurto`, `tipo: z.enum(TIPOS)`, `codigo, subtipo, instituicao, emissor, taxa: textoOpcional`,
   `valorAplicado: dinheiroSchema`, `saldo: dinheiroSchema.optional()` (padrão = `valorAplicado`),
   `quantidade: z.number().finite().min(0).nullable().optional()`, `vencimento: dataSchema.nullable().optional()`.
   Em `$transaction`: crie o investimento (`dataPosicao: new Date()`) e, se `valorAplicado > 0`, um movimento
   `{ data: hoje(), tipo: 'APLICACAO', valor: valorAplicado, descricao: 'Aplicação inicial' }`.
   Depois `registrarPosicaoPatrimonio()`. `201` com `investimentoDTO`.
4. `PUT /investimentos/:id`: todos os campos do POST opcionais + `ativo: z.boolean()`. 404. Se `origem === 'OPEN_FINANCE'` e o corpo
   tiver chave além de `nome` e `ativo` → `HttpError(400, MENSAGEM_OF)`. Atualize só as chaves presentes; se `saldo` mudou, grave também
   `dataPosicao: new Date()`. `registrarPosicaoPatrimonio()`. Responda DTO.
5. `DELETE /investimentos/:id`: 404; `OPEN_FINANCE` → 400 `'Este investimento vem do Open Finance. Para removê-lo, remova a conexão em Conexões.'`;
   apague; `registrarPosicaoPatrimonio()`; `204`.
6. `POST /investimentos/:id/movimentos`: schema `data: dataSchema`, `tipo: z.enum(TIPOS_MOVIMENTO)`,
   `valor: dinheiroSchema.refine((v) => v > 0, 'O valor deve ser maior que zero')`, `quantidade` (como acima), `descricao: textoOpcional`.
   404; `OPEN_FINANCE` → 400 `MENSAGEM_OF`. Efeito no investimento (função local `efeito(tipo, valor)` → `{ saldo: number, aplicado: number }`):
   `APLICACAO` → saldo `+valor`, aplicado `+valor`; `RESGATE` → saldo `-valor`, aplicado `-valor`; `RENDIMENTO` → saldo `+valor`, aplicado `0`;
   `IMPOSTO` → saldo `-valor`, aplicado `0`.
   Em `$transaction`: crie o movimento; `novoSaldo = Math.max(0, arredondar(saldoAtual + efeito.saldo))`,
   `novoAplicado = Math.max(0, arredondar(aplicadoAtual + efeito.aplicado))`; atualize o investimento com os dois e `dataPosicao: new Date()`.
   `registrarPosicaoPatrimonio()`. `201` com `{ investimento: investimentoDTO(atualizado), movimento: movimentoDTO(criado) }`.
7. `DELETE /investimentos/:id/movimentos/:movimentoId` (`idParam(req, 'movimentoId')`): 404 se o movimento não existir ou não for deste
   investimento; `OPEN_FINANCE` → 400. Em `$transaction`: apague e aplique o efeito INVERSO (mesma função, sinais trocados, com o mesmo `Math.max(0, ...)`).
   `registrarPosicaoPatrimonio()`. `204`.

## Cliente

`index.tsx`: uma rota — `/app/investimentos`, rótulo `Investimentos`, ícone `investimentos`, ordem `40`, elemento `<Investimentos />`.

Tipo local:
`interface RespostaInvestimentos { itens: InvestimentoDTO[]; total: number; aplicado: number; rendimento: number; porTipo: { tipo: TipoInvestimento; total: number; percentual: number }[] }`

### `Investimentos.tsx` (export `Investimentos`)

1. Estado `tipo` (filtro, texto), `mostrarInativos`. `useDados<RespostaInvestimentos>('/investimentos' + queryString({ tipo, inativos: mostrarInativos ? 'true' : '' }))`.
2. `<Pagina titulo="Investimentos">`; `barra-ferramentas`: `filtros` com `Selecao` `Tipo` (`TIPOS_INVESTIMENTO`, vazio "Todos") e
   `<Caixa rotulo="Mostrar resgatados/inativos" />`; à direita `<Botao>Novo investimento</Botao>`.
3. `resumo` com 4 `ResumoItem`: `Total investido hoje` (`investimentos`, azul, `formatarReais(total)`), `Valor aplicado` (`financeiro`, roxo),
   `Rendimento` (`seta-cima` verde se ≥ 0; `seta-baixo` vermelho se < 0; `formatarReais(rendimento)`),
   `Rentabilidade` (`grafico`, laranja; `aplicado > 0 ? formatarPercentual((rendimento / aplicado) * 100) : '—'`).
4. `<div className="fin-duas-colunas">`:
   - `<Cartao titulo="Alocação por tipo">` com `<Rosca fatias={porTipo.map((p) => ({ rotulo: rotuloDe(TIPOS_INVESTIMENTO, p.tipo), valor: p.total, cor: COR_TIPO_INVESTIMENTO[p.tipo] }))} centro={formatarReais(total)} />`
     (ou `<p className="fin-suave">Sem investimentos ainda.</p>`).
   - `<Cartao titulo="Maiores posições">`: os 5 maiores `itens` por `saldo`; cada linha: `<NomeComCor cor={COR_TIPO_INVESTIMENTO[i.tipo]}>{i.nome}</NomeComCor>`,
     `formatarReais(i.saldo)` e `<BarraProgresso percentual={total > 0 ? (i.saldo / total) * 100 : 0} cor={COR_TIPO_INVESTIMENTO[i.tipo]} />`.
5. `Tabela<InvestimentoDTO>`: `Investimento` (nome; embaixo em `fin-suave`: `codigo`, `subtipo`, `instituicao` que existirem, unidos por ` · `; + `<SeloOrigem />`),
   `Tipo` (`rotuloDe`), `Taxa` (`i.taxa ?? '—'`), `Vencimento` (`formatarDia`), `Aplicado` (direita, `formatarReais`),
   `Saldo` (direita, `formatarReais`), `Rendimento` (direita, `<Valor valor={i.rendimento} sentido="auto" />` e, em `fin-suave`,
   `formatarPercentual(i.rentabilidade)` quando não for `null`), `Ações` (`MenuAcoes`: `Ver detalhes` `documento`; `Editar` `lapis`;
   `Desativar`/`Reativar`; `Excluir` `lixeira` `perigo` só `MANUAL` com `window.confirm`). `aoClicarLinha` abre o detalhe.
   `vazio="Nenhum investimento. Cadastre um aqui ou conecte sua corretora em Conexões."`
6. Modal "Novo investimento" / "Editar investimento" (`FormInvestimento` no mesmo arquivo): `Nome*`, `Tipo*`, `Código/ticker`, `Subtipo (ex.: CDB, Tesouro Selic)`,
   `Instituição`, `Emissor`, `Valor aplicado (R$)*`, `Saldo atual (R$)` (vazio = igual ao aplicado), `Quantidade`, `Taxa (ex.: 110% do CDI)`,
   `Vencimento` (date). Use `fin-linha` para pares de campos. `OPEN_FINANCE`: só `Nome` + `<Aviso tipo="info">`.
7. `{detalheId !== null && <DetalheInvestimento investimentoId={detalheId} aoFechar={...} aoMudar={recarregar} />}`.

### `DetalheInvestimento.tsx`

```ts
export function DetalheInvestimento(props: { investimentoId: number; aoFechar: () => void; aoMudar: () => void }): JSX.Element
```

`<Modal aberto titulo={investimento.nome} aoFechar={aoFechar}>`:

1. `useDados<{ investimento: InvestimentoDTO; movimentos: MovimentoInvestimentoDTO[] }>('/investimentos/' + investimentoId)`.
2. `resumo` com 3 `ResumoItem`: `Saldo`, `Aplicado`, `Rendimento`. Linha em `fin-suave` com tipo, taxa, vencimento e
   `Posição de ` + `formatarDataHora(investimento.dataPosicao)`; `<SeloOrigem />`.
3. Só `MANUAL`: formulário em linha "Novo movimento": `Tipo` (`TIPOS_MOVIMENTO`), `Data` (date, `hojeISO()`), `Valor (R$)`, `Descrição`,
   botão `Lançar` → `api.post('/investimentos/' + id + '/movimentos', { data, tipo, valor, descricao })`; depois `recarregar()` e `aoMudar()`.
4. `Tabela<MovimentoInvestimentoDTO>`: `Data`, `Tipo` (`rotuloDe(TIPOS_MOVIMENTO, m.tipo)`), `Descrição` (`m.descricao ?? '—'`),
   `Valor` (direita; `<Valor sentido={m.tipo === 'APLICACAO' || m.tipo === 'RENDIMENTO' ? 'entrada' : 'saida'} />`),
   `Ações` (só `MANUAL`: `MenuAcoes` com `Excluir`, `window.confirm`). `vazio="Nenhum movimento registrado."`

## Aceite

- `cd server && npx tsc --noEmit` e `cd client && npx tsc --noEmit` sem erros nos seus arquivos. Nenhum `any`. Nenhuma cor fixa em CSS.
