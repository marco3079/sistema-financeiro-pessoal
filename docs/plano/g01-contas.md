# g01 — Contas (servidor e tela)

Leia antes: `docs/plano/CONTRATOS.md` (inteiro), `server/prisma/schema.prisma` (model `Conta`), `server/src/lib/financas.ts`,
`client/src/lib/financas.ts`, `client/src/ui/financas.tsx`, `client/src/modules/cadastros/usuarios.tsx` (modelo de tela).

## Arquivos que você pode criar (só estes)

- `server/src/modules/contas/routes.ts`
- `client/src/modules/contas/index.tsx`
- `client/src/modules/contas/Contas.tsx`
- `client/src/modules/contas/contas.css` (opcional)

## Servidor: `server/src/modules/contas/routes.ts`

Implemente exatamente as rotas da seção "contas (g01)" de CONTRATOS.md.

1. `GET /contas`: `where` = `{ ativo: true }` salvo se `req.query.inativas === 'true'`; se `tipo` vier e for um dos 5 valores de
   `TipoConta`, filtre por ele. `orderBy: [{ tipo: 'asc' }, { nome: 'asc' }]`. Responda `lista.map(contaDTO)`.
2. `GET /contas/resumo` (declare ANTES de `/contas/:id`): `res.json(await totaisPatrimonio())`.
3. `POST /contas`: schema zod:
   `nome: textoCurto`, `tipo: z.enum(['CORRENTE','POUPANCA','CARTEIRA','CARTAO','INVESTIMENTO'])`,
   `instituicao: textoOpcional`, `numero: textoOpcional`, `saldo: dinheiroComSinalSchema.optional()`, `cor: corSchema.optional()`,
   `bandeira: textoOpcional`, `limite: dinheiroSchema.nullable().optional()`,
   `diaFechamento: z.number().int().min(1).max(31).nullable().optional()`, `diaVencimento:` igual.
   Se `tipo !== 'CARTAO'`, grave `bandeira`, `limite`, `diaFechamento`, `diaVencimento` como `null`.
   Se `tipo === 'CARTAO'` e `saldo < 0` → `HttpError(400, 'A fatura em aberto não pode ser negativa')`.
   Depois de criar, chame `await registrarPosicaoPatrimonio()`. Responda `201` com `contaDTO`.
4. `PUT /contas/:id`: schema com todos os campos opcionais: `nome, instituicao, numero, cor, ativo (z.boolean()), bandeira, limite,
   diaFechamento, diaVencimento`. Busque a conta (404 `'Conta não encontrada'`). Se `conta.origem === 'OPEN_FINANCE'` e o corpo trouxer
   qualquer chave diferente de `nome`, `cor`, `ativo` → `HttpError(400, 'Este registro vem do Open Finance e é atualizado automaticamente.')`.
   Atualize só as chaves presentes (`!== undefined`). Chame `registrarPosicaoPatrimonio()`. Responda `contaDTO`.
5. `PUT /contas/:id/saldo`: corpo `{ saldo: dinheiroComSinalSchema }`. 404 se não existir; 400 (mensagem da regra de ouro) se
   `OPEN_FINANCE`; se `CARTAO` e `saldo < 0` → 400. Atualize, chame `registrarPosicaoPatrimonio()`, responda `contaDTO`.
6. `DELETE /contas/:id`: 404 se não existir; 400 `'Esta conta vem do Open Finance. Para removê-la, remova a conexão em Conexões.'`
   se `OPEN_FINANCE`. Apague, chame `registrarPosicaoPatrimonio()`, responda `204`.

## Cliente

`index.tsx`: uma rota — caminho `/app/contas`, rótulo `Contas`, ícone `contas`, perfis `['TITULAR']`, elemento `<Contas />`, ordem `10`.

`Contas.tsx` (export `Contas`): mostra SÓ contas que NÃO são cartão (cartão tem tela própria).

1. Dados: `useDados<ContaDTO[]>('/contas' + queryString({ inativas: mostrarInativas ? 'true' : '' }))` e
   `useDados<{ contas: number; investimentos: number; cartoes: number; patrimonio: number }>('/contas/resumo')`.
   `const lista = (dados ?? []).filter((c) => c.tipo !== 'CARTAO')`.
2. `<Pagina titulo="Contas">`, depois `barra-ferramentas` com `filtros` contendo `<Selecao rotulo="Tipo" ... vazio="Todos" />`
   (opções = `TIPOS_CONTA` sem `CARTAO`; filtro feito no cliente) e `<Caixa rotulo="Mostrar inativas" .../>`; à direita `<Botao>Nova conta</Botao>`.
3. `<div className="resumo">` com 4 `ResumoItem`: `Patrimônio` (ícone `financeiro`, azul, `formatarReais(resumo.patrimonio)`),
   `Saldo em contas` (`contas`, verde), `Investimentos` (`investimentos`, roxo), `Faturas em aberto` (`cartao`, laranja).
4. `<Tabela<ContaDTO>>` com colunas: `Conta` (`<NomeComCor cor={c.cor}>{c.nome}</NomeComCor>` + `<SeloOrigem origem={c.origem} />`),
   `Tipo` (`rotuloDe(TIPOS_CONTA, c.tipo)`), `Instituição` (`c.instituicao ?? '—'`), `Número` (`c.numero ?? '—'`),
   `Saldo` (`alinhar: 'direita'`, `<Valor valor={c.saldo} sentido={c.saldo < 0 ? 'saida' : 'neutro'} />`),
   `Situação` (`Selo` verde `ATIVA` / vermelho `INATIVA`), `Ações` (`acoes: true`, `MenuAcoes`).
   `vazio="Nenhuma conta cadastrada."`.
5. Ações do menu: `Editar` (ícone `lapis`); `Ajustar saldo` (ícone `financeiro`, só MANUAL); `Desativar`/`Reativar` (ícone `fechar`/`visto`,
   via `PUT /contas/:id { ativo }`); `Excluir` (ícone `lixeira`, `perigo: true`, só MANUAL, com
   `window.confirm('Excluir a conta X? Os lançamentos dela também serão apagados.')`).
6. Modal "Nova conta" / "Editar conta" (um formulário só, componente `FormConta`): `Nome*`, `Tipo*` (Selecao, sem `CARTAO`; desabilitado
   visualmente não é preciso — em edição apenas não envie `tipo`), `Instituição`, `Número`, `Saldo inicial (R$)` (só ao criar; aceita negativo),
   `<CampoCor rotulo="Cor" />`. Em conta `OPEN_FINANCE`, mostre só `Nome` e `Cor` e um `<Aviso tipo="info">` dizendo que os demais
   dados vêm do banco. Botão `Salvar`.
7. Modal "Ajustar saldo": campo `Novo saldo (R$)` preenchido com `valorParaCampo(c.saldo)`; envia `PUT /contas/:id/saldo`.
8. Depois de cada ação que dá certo: feche o modal e chame `recarregar()` das DUAS consultas.

## Aceite

- `cd server && npx tsc --noEmit` e `cd client && npx tsc --noEmit` sem erros nos seus arquivos.
- Nenhuma cor fixa em CSS. Nenhum `any`.
