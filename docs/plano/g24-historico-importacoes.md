# g24 — Histórico de importações: ver detalhes, editar e remover

## Objetivo

Na tela Importar, a tabela "Arquivos importados" só lista. Cada linha passa a ter ações: **Ver detalhes** (os lançamentos que aquele arquivo trouxe, com editar e excluir de cada um) e **Remover importação** (apaga tudo o que o arquivo trouxe). A API já existe.

Leia antes, inteiros: `client/src/modules/importar/Historico.tsx`, `client/src/modules/importar/tipos.ts`, `client/src/modules/importar/Importar.tsx` (como o `Historico` é usado), `client/src/modules/cartoes/DetalheFatura.tsx` (um modal de detalhe com tabela: siga o padrão), `client/src/modules/transacoes/Lancamentos.tsx` (como a tela de lançamentos abre o `FormLancamento` para editar, carrega contas e categorias e exclui um lançamento: copie esse padrão), `client/src/modules/transacoes/FormLancamento.tsx`, `client/src/ui/index.tsx` (`Tabela` com coluna de ações, `MenuAcoes`, `Modal`, `Botao`, `Aviso`, `Carregando`, `Selo`), `client/src/ui/financas.tsx` (`Valor`, `NomeComCor`), `client/src/lib/financas.ts`.

## Arquivos (só estes)

- editar `client/src/modules/importar/Historico.tsx`
- editar `client/src/modules/importar/tipos.ts` (só acrescentar os tipos abaixo; não mude os que existem, exceto acrescentar `contaId` em `ImportacaoDTO`)
- criar `client/src/modules/importar/DetalheImportacao.tsx`
- criar `client/src/modules/importar/historico.css`

## API

- `GET /importacao/historico` → `ImportacaoDTO[]` (como hoje)
- `GET /importacao/:id` → `DetalheImportacaoDTO`
- `DELETE /importacao/:id` → `RemocaoDTO` (apaga os lançamentos ou movimentos que o arquivo trouxe e ainda existem, acerta saldos e faturas e tira a linha do histórico)
- Editar um lançamento: é o `FormLancamento` que já existe (ele chama `PUT /transacoes/:id`).
- Excluir um lançamento: `DELETE /transacoes/:id` (204), como em `Lancamentos.tsx`.
- Listas para o formulário: `GET /contas` (`ContaDTO[]`) e `GET /categorias` (`CategoriaDTO[]`).

Acrescente em `tipos.ts`:

```ts
import type { TransacaoDTO } from '../../lib/financas';

export interface MovimentoImportadoDTO {
  id: number;
  data: string;                 // 'AAAA-MM-DD'
  tipo: 'APLICACAO' | 'RESGATE' | 'RENDIMENTO' | 'IMPOSTO';
  valor: number;
  quantidade: number | null;
  descricao: string | null;
  investimentoId: number;
  investimento: string;         // código ou nome do ativo
}

export interface DetalheImportacaoDTO {
  importacao: ImportacaoDTO;
  lancamentos: TransacaoDTO[];          // fatura e extrato
  movimentos: MovimentoImportadoDTO[];  // planilha da B3 (até 3000)
}

export interface RemocaoDTO { lancamentos: number; movimentos: number; investimentos: number; faturas: number }
```

e, em `ImportacaoDTO`, o campo `contaId?: number | null;`. Se `tipos.ts` já importa algo de `../../lib/financas`, junte o import.

## `Historico.tsx`

- Acrescente à tabela uma coluna de ações (veja em `ui/index.tsx` como declarar: `acoes: true`) com `MenuAcoes` de dois itens: `Ver detalhes` (ícone `lista` ou outro que exista) → abre `<DetalheImportacao importacaoId={i.id} ... />`; `Remover importação` (ícone `lixeira`, `perigo: true`) → abre a confirmação.
- A linha inteira também abre os detalhes (`aoClicarLinha`).
- **Confirmação de remover** (`Modal`): título `Remover importação`; texto: para `FATURA` e `EXTRATO`, `Remover "{arquivo}" apaga os {novos} lançamentos que esse arquivo trouxe, inclusive os que você editou depois, e acerta o saldo e a fatura. Não dá para desfazer.`; para `B3`, `Remover "{arquivo}" apaga os movimentos (compras, vendas e proventos) que essa planilha trouxe. Os ativos que vieram só dela saem junto; os demais continuam com a quantidade e o saldo atuais.` Botões `Cancelar` e `Remover` (variante `perigo`, desabilitado enquanto envia). Erro em `<Aviso tipo="erro">` com `mensagemErro`. Sucesso: fecha, recarrega a lista e mostra acima da tabela um `<Aviso tipo="info">` com o resultado: `Importação removida: {lancamentos} lançamentos apagados.` (ou `{movimentos} movimentos e {investimentos} ativos apagados.` para a B3; acrescente `{faturas} fatura(s) vazia(s) removida(s).` quando `faturas > 0`).
- Mantenha a prop `versao` e o comportamento atual. Depois de remover, ou quando o detalhe avisar que algo mudou, chame `recarregar()`.

## `DetalheImportacao.tsx`

```tsx
export function DetalheImportacao(props: {
  importacaoId: number;
  aoFechar: () => void;
  aoMudar: () => void;   // algo foi editado ou excluído: a lista de fora deve recarregar
}): JSX.Element
```

Um `Modal` (`aberto`, título = nome do arquivo quando carregado, senão `Importação`). Busque com `useDados<DetalheImportacaoDTO>('/importacao/' + importacaoId)`, mais `/contas` e `/categorias`.

1. Cabeçalho (`historico-resumo`): `Selo` do tipo (como na tabela), banco, conta, referência (`Vencimento {formatarDia}` para fatura), `Importado em {formatarDataHora(criadoEm)}` e a contagem `{n} lançamentos` (ou `{n} movimentos`).
2. Se `lancamentos.length === 0 && movimentos.length === 0`: `<Aviso tipo="info">Nenhum registro deste arquivo foi encontrado. Eles podem ter sido apagados, ou a importação é anterior ao controle por arquivo.</Aviso>`
3. **Fatura e extrato**: `Tabela<TransacaoDTO>`, `chave={(t) => t.id}`, colunas: `Data` (`formatarDia`), `Descrição` (com `Parcela X de Y` em texto suave quando houver, e `Selo` `Transferência` quando `transferencia`), `Categoria` (`NomeComCor` com a cor e o nome da categoria, ou `—`; confira em `TransacaoDTO` como a categoria vem), `Valor` (direita, componente `Valor` com o sentido pelo tipo), e ações (`MenuAcoes`): `Editar` → abre o `FormLancamento` daquele lançamento dentro de um segundo `Modal` (`titulo="Editar lançamento"`), passando `contas` e `categorias`; `Excluir` (perigo) → confirmação simples e `DELETE /transacoes/:id`. Depois de editar ou excluir: recarregue o detalhe e chame `aoMudar()`.
   - Acima da tabela, um `Campo` `Buscar` que filtra pela descrição, e o total: `Receitas {R$}` · `Despesas {R$}` (sem contar transferências).
4. **B3**: texto suave `Os movimentos são editados na tela Investimentos, dentro de cada ativo.`; `Campo` `Buscar ativo`; `Tabela<MovimentoImportadoDTO>` com `Data`, `Ativo`, `Tipo` (rótulo de `TIPOS_MOVIMENTO` em `lib/financas`), `Quantidade` (direita, ou `—`), `Valor` (direita). Mostre 100 por vez com um botão `Mostrar mais` (são até 3000 linhas).
5. Estados: `<Carregando />`; erro em `<Aviso tipo="erro">`.

## CSS (`historico.css`)

Só variáveis do tema; sem `!important`; sem hexadecimal. `.historico-resumo`: flex com quebra, `gap: 0.5rem 1rem`, alinhado ao centro. Blocos do modal com `gap: 1rem`. Tudo cabe em 360 px.

## Critérios de aceite

- `cd client && npx tsc --noEmit` sem erros.
- Sem `any`, sem `// @ts-ignore`, sem biblioteca nova.
- Remover sempre pede confirmação; nada é apagado com um clique só.
- Depois de editar, excluir ou remover, as listas mostram o estado novo sem recarregar a página.
- A tela `Importar.tsx` continua compilando sem alteração (a prop `versao` do `Historico` não muda).
- Nenhum arquivo além dos quatro listados foi alterado.
