# g03 — Lançamentos e categorias (telas)

Leia antes: `docs/plano/CONTRATOS.md` (inteiro; seção "transacoes e categorias"), `client/src/lib/financas.ts`,
`client/src/ui/financas.tsx`, `client/src/ui/index.tsx`, `client/src/modules/cadastros/usuarios.tsx` (modelo de tela).

O servidor destas rotas está sendo feito pelo g02 ao mesmo tempo: programe contra o contrato, não espere por ele.

## Arquivos que você pode criar (só estes)

- `client/src/modules/transacoes/index.tsx`
- `client/src/modules/transacoes/Lancamentos.tsx`
- `client/src/modules/transacoes/FormLancamento.tsx`
- `client/src/modules/transacoes/Categorias.tsx`
- `client/src/modules/transacoes/transacoes.css` (opcional)

## `index.tsx`

Duas rotas:

- `/app/transacoes`, rótulo `Lançamentos`, ícone `transacoes`, ordem `20`, elemento `<Lancamentos />`.
- `/app/categorias`, rótulo `Categorias`, ícone `categorias`, ordem `54`, elemento `<Categorias />`.

## `FormLancamento.tsx`

```ts
export function FormLancamento(props: {
  lancamento: TransacaoDTO | null; // null = novo
  contas: ContaDTO[];
  categorias: CategoriaDTO[];
  contaInicialId?: number; // conta pré-selecionada ao criar
  aoConcluir: () => void; // chamado depois de salvar com sucesso
}): JSX.Element
```

Campos (estado em texto): `Tipo*` (Selecao com `TIPOS_TRANSACAO`, padrão `DESPESA`), `Conta*` (Selecao; opções = contas ATIVAS e de
origem `MANUAL`; rótulo `nome` + ` (cartão)` quando `tipo === 'CARTAO'`), `Data*` (Campo tipo `date`, padrão `hojeISO()`),
`Descrição*`, `Valor (R$)*`, `Categoria` (Selecao; só as categorias do `tipo` escolhido; `vazio="Sem categoria"`),
`Parcelas` (Selecao de `À vista`, `2x` ... `12x`; aparece SÓ ao criar, com conta de tipo `CARTAO` e tipo `DESPESA`),
`<Caixa rotulo="Transferência entre contas ou pagamento de fatura (não conta como receita/despesa)" />`, `Observação` (AreaTexto).

Regras:

- Lançamento de origem `OPEN_FINANCE` (edição): mostre só `Categoria`, a `Caixa` de transferência e `Observação`, com um
  `<Aviso tipo="info">Este lançamento vem do Open Finance. Você pode mudar só a categoria, a observação e a marcação de transferência.</Aviso>`
  e envie só `{ categoriaId, transferencia, observacao }`.
- Criar: `api.post('/transacoes', { contaId, data, descricao, valor, tipo, categoriaId, transferencia, observacao, totalParcelas })`
  (`totalParcelas` só quando > 1; `categoriaId` é `number` ou `null`; `observacao` vazia vira `null`).
- Editar (MANUAL): `api.put('/transacoes/' + id, { data, descricao, valor, tipo, categoriaId, transferencia, observacao })`.
- `lerValor` devolvendo `null` ou valor ≤ 0 → erro `Informe um valor válido.` sem enviar.
- Botão `Salvar` desabilitado enquanto envia. Erros com `mensagemErro` em `<Aviso tipo="erro">`.
- Use a classe `fin-linha` para pôr dois campos lado a lado (Tipo/Conta, Data/Valor).

## `Lancamentos.tsx` (export `Lancamentos`)

1. Estado: `mes` (padrão `mesAtual()`), `contaId`, `categoriaId`, `tipo`, `busca` (todos texto, vazio = sem filtro), `pagina` (número, 1).
   Ao mudar qualquer filtro, volte `pagina` para 1.
2. Dados:
   - `useDados<{ itens: TransacaoDTO[]; total: number; receitas: number; despesas: number }>('/transacoes' + queryString({ mes, contaId, categoriaId, tipo, busca: busca.trim(), pagina, porPagina: 50 }))`
   - `useDados<ContaDTO[]>('/contas?inativas=true')` e `useDados<CategoriaDTO[]>('/categorias')`.
3. Leia a query da URL uma vez ao montar (`useSearchParams` de react-router-dom): se houver `?conta=<id>`, comece com esse `contaId`.
4. Layout:
   - `<Pagina titulo="Lançamentos" acoes={<SeletorMes mes={mes} aoMudar={...} />}>`
   - `barra-ferramentas`: `filtros` com `Conta` (vazio "Todas"), `Categoria` (vazio "Todas"; inclua a opção `{ valor: '0', rotulo: 'Sem categoria' }`),
     `Tipo` (vazio "Todos"), `Buscar na descrição`; à direita `<Botao>Novo lançamento</Botao>`.
   - `resumo` com 4 `ResumoItem`: `Receitas` (ícone `seta-cima`, verde, `formatarReais(receitas)`), `Despesas` (`seta-baixo`, vermelho),
     `Saldo do mês` (`financeiro`, azul, `formatarReais(receitas - despesas)`), `Lançamentos` (`transacoes`, roxo, `total`).
   - `Tabela<TransacaoDTO>`: `Data` (`formatarDia`), `Descrição` (descrição; embaixo, em `fin-suave`, `parcela/totalParcelas` quando houver
     (ex.: `Parcela 2 de 6`), `Pendente` quando `pendente`, e `<SeloOrigem />`), `Categoria` (`<NomeComCor cor={categoriaCor}>{categoriaNome}</NomeComCor>`
     ou `—`; se `transferencia`, mostre `<Selo cor="cinza">Transferência</Selo>`), `Conta` (`contaNome`),
     `Valor` (`alinhar: 'direita'`, `<Valor valor={t.valor} sentido={t.tipo === 'RECEITA' ? 'entrada' : 'saida'} />`),
     `Ações` (`MenuAcoes`: `Editar` ícone `lapis`; `Excluir` ícone `lixeira`, `perigo`, só `MANUAL`, com `window.confirm`).
     `aoClicarLinha` abre a edição. `vazio="Nenhum lançamento neste período."`
   - Paginação embaixo, só se `total > 50`: `<div className="pagina-acoes">` com `Botao variante="secundario"` `Anterior` / `Próxima`
     (desabilitados nos limites) e o texto `Página X de Y` em `fin-suave`.
   - `<Modal>` com `<FormLancamento />` para novo/editar; ao concluir fecha e `recarregar()`.
5. Se não houver nenhuma conta MANUAL ativa, o botão `Novo lançamento` abre o modal com `<Aviso tipo="info">Cadastre uma conta em Contas (ou um cartão em Cartões) antes de lançar.</Aviso>` no lugar do formulário.

## `Categorias.tsx` (export `Categorias`)

1. `useDados<CategoriaDTO[]>('/categorias')`.
2. `<Pagina titulo="Categorias">`, `barra-ferramentas` com `<Abas>`? NÃO — use dois `<Cartao titulo="Despesas">` e `<Cartao titulo="Receitas">`
   dentro de `<div className="fin-duas-colunas">`. Em cada cartão, uma `Tabela<CategoriaDTO>` com colunas `Categoria`
   (`<NomeComCor>`), `Ações` (`MenuAcoes`: `Editar`, `Excluir` com `window.confirm('Excluir a categoria X? Os lançamentos dela ficam sem categoria.')`).
   `vazio="Nenhuma categoria."`
3. Botão `Nova categoria` na `barra-ferramentas` (sem filtros: deixe `<div className="filtros" />` vazio para manter o alinhamento).
4. Modal com formulário: `Nome*`, `Tipo*` (só ao criar; `TIPOS_TRANSACAO`), `<CampoCor rotulo="Cor" />` (padrão `#2563eb`).
   Criar: `POST /categorias`; editar: `PUT /categorias/:id { nome, cor }`. Erro 409 aparece como mensagem do servidor (`mensagemErro`).

## Aceite

- `cd client && npx tsc --noEmit` sem erros nos seus arquivos. Nenhum `any`. Nenhuma cor fixa em CSS.
