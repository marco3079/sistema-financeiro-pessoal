# Contratos do Sistema Financeiro Pessoal

Leia este arquivo inteiro antes de escrever código. Ele vale para todos os geradores.

## O projeto

Sistema financeiro pessoal: contas, lançamentos, cartões e faturas, investimentos, orçamento, metas
e conexão bancária por Open Finance (Pluggy). A casca visual (menu, topo, login, painel, tabelas,
formulários) já existe e NÃO pode ser alterada: o layout tem de ficar igual ao do sistema de origem.

- `server/`: Node 20, TypeScript, Express 4, Prisma 5, zod 4. Banco PostgreSQL.
- `client/`: React 18, TypeScript, Vite, react-router-dom 6. Sem biblioteca de componentes.
- Idioma: tudo em português do Brasil (nomes de variáveis, textos, comentários).

## Regras gerais (obrigatórias)

1. Edite SOMENTE os arquivos listados no seu mini-plano. Nunca edite `schema.prisma`, `package.json`,
   `server/src/lib/*`, `client/src/lib/*`, `client/src/ui/*`, `client/src/layout/*` (salvo se o seu
   mini-plano listar o arquivo).
2. Não instale pacotes.
3. Não invente campo, rota ou formato. Se faltar algo, pergunte ao `@main` na sala.
4. Só existe um perfil: `'TITULAR'`. Toda tela usa `perfis: ['TITULAR']`. Não use `permitir(...)` nas rotas novas.
5. Os dados são da casa toda: nenhuma tabela financeira tem `usuarioId`. Não filtre por usuário.
6. Verificação obrigatória antes de entregar:
   - servidor: `cd server && npx tsc --noEmit` (zero erros nos SEUS arquivos);
   - cliente: `cd client && npx tsc --noEmit` (zero erros nos SEUS arquivos).
   Erros em arquivos de outros geradores (ainda em construção) podem aparecer: ignore-os e avise na sala.
7. Não rode `docker`, `prisma db push`, `npm install`, `git commit` nem `git push`.

## Modelo de dados

Fonte da verdade: `server/prisma/schema.prisma` (leia). Resumo das convenções:

- Dinheiro: `Decimal(14,2)` no banco, `number` no JSON.
- `Transacao.valor` é SEMPRE positivo. O sentido vem de `Transacao.tipo`: `RECEITA` (entra) ou `DESPESA` (sai).
- `Transacao.transferencia = true`: movimento entre contas próprias ou pagamento de fatura. NÃO entra em
  somas de receitas/despesas, orçamento ou relatórios.
- `Conta.tipo`: `CORRENTE | POUPANCA | CARTEIRA | CARTAO | INVESTIMENTO`. Cartão de crédito é uma `Conta` de tipo `CARTAO`.
- `Conta.saldo` de um `CARTAO` é a dívida em aberto (positivo). Nas outras contas é o dinheiro disponível.
- Patrimônio = contas que não são cartão + investimentos − dívida dos cartões.
- `origem`: `MANUAL` (o usuário digitou) ou `OPEN_FINANCE` (veio da Pluggy; é sobrescrito a cada sincronização).
- Datas "só dia" (`@db.Date`): no JSON são texto `'AAAA-MM-DD'`. Mês é `'AAAA-MM'`. Carimbos de hora são ISO completo.

### Regra de ouro para registros OPEN_FINANCE

Registro com `origem = 'OPEN_FINANCE'` não pode ter valores alterados nem ser excluído pelas telas comuns
(a sincronização traria tudo de volta). O que PODE ser alterado nele:

- `Conta`: `nome`, `cor`, `ativo`.
- `Transacao`: `categoriaId`, `observacao`, `transferencia`.
- `Investimento`: `nome`, `ativo`.
- `Fatura`: nada (nem pagar manualmente: o status vem do banco).

Tentativa de alterar outro campo ou excluir: `throw new HttpError(400, 'Este registro vem do Open Finance e é atualizado automaticamente.')`.
No cliente: esconda os botões de editar valor/excluir e mostre `<SeloOrigem origem={x.origem} />`.

## Servidor: como escrever um módulo

Cada módulo é `server/src/modules/<nome>/routes.ts` e é carregado sozinho (não registre em lugar nenhum).
O `export default` é um `Router` montado em `/api` JÁ com autenticação. Modelo:

```ts
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, HttpError, idParam, validar } from '../../lib/erros';
import { contaDTO, dinheiroSchema, num } from '../../lib/financas';

const router = Router();

const criarSchema = z.object({ nome: z.string().trim().min(1).max(120), saldo: dinheiroSchema.optional() });

router.get(
  '/exemplos',
  asyncHandler(async (_req, res) => {
    const lista = await prisma.conta.findMany({ orderBy: { nome: 'asc' } });
    res.json(lista.map(contaDTO));
  })
);

router.post(
  '/exemplos',
  asyncHandler(async (req, res) => {
    const dados = validar(criarSchema, req.body);
    const criada = await prisma.conta.create({ data: { nome: dados.nome, tipo: 'CORRENTE', saldo: dados.saldo ?? 0 } });
    res.status(201).json(contaDTO(criada));
  })
);

router.delete(
  '/exemplos/:id',
  asyncHandler(async (req, res) => {
    await prisma.conta.delete({ where: { id: idParam(req) } });
    res.status(204).end();
  })
);

export default router;
```

Regras:

- Sempre `asyncHandler`. Erros de regra: `throw new HttpError(status, 'mensagem em português')`.
- Registro inexistente: `throw new HttpError(404, 'X não encontrado')`.
- Corpo validado com `validar(schema, req.body)` (zod). Query lida com `textoQuery` / `inteiroQuery` de `lib/financas`.
- Rotas fixas (`/contas/resumo`) ANTES das rotas com parâmetro (`/contas/:id`).
- Criação responde `201` com o DTO; exclusão responde `204` sem corpo.
- Mais de uma gravação que precisa acontecer junta: `prisma.$transaction(async (db) => { ... })`.
- `Decimal` do Prisma: grave passando `number`; leia com `num(...)`.

### `server/src/lib/financas.ts` (já existe; leia o arquivo; USE, não reescreva)

- Dinheiro: `num(d)`, `numOuNulo(d)`, `arredondar(n)`, `moeda(n)` (texto "R$ 1.234,56").
- Datas: `dataISO(date)`, `dataISOOuNula(date)`, `paraData('AAAA-MM-DD')`, `hoje()`, `mesDe(date)`, `mesAtual()`,
  `somarMeses(mes, delta)`, `intervaloDoMes(mes)` → `{ inicio, fim }` (fim exclusivo: use `{ gte: inicio, lt: fim }`),
  `rotuloMesCurto(mes)`, `MESES_CURTOS`.
- zod: `dataSchema`, `mesSchema`, `dinheiroSchema` (≥ 0), `dinheiroComSinalSchema`, `corSchema` (`#rrggbb`), `textoCurto`, `textoOpcional`.
- Query: `textoQuery(req.query.x)`, `inteiroQuery(req.query.x)`.
- DTO: `contaDTO`, `categoriaDTO`, `transacaoDTO` (exige `include: INCLUIR_NA_TRANSACAO`), `faturaDTO`
  (exige `include: { conta: { select: { nome: true } } }`), `investimentoDTO`, `movimentoDTO`.
- Saldo: `efeitoNoSaldo(tipoConta, tipoTransacao, valor)` → quanto somar ao `Conta.saldo` quando a transação entra
  (para desfazer, some o negativo).
- Fatura: `garantirFatura(db, cartao, data)` → id da fatura que recebe a compra; `recalcularFatura(db, faturaId)`;
  `atualizarStatusDasFaturas()`.
- Patrimônio: `totaisPatrimonio()` → `{ contas, investimentos, cartoes, patrimonio }`; `registrarPosicaoPatrimonio()`.

## Cliente: como escrever uma tela

Cada módulo é `client/src/modules/<nome>/index.tsx` exportando `rotas` (entra no menu sozinho):

```tsx
import type { RotaModulo } from '../../lib/rotas';
import { Contas } from './Contas';

export const rotas: RotaModulo[] = [
  { caminho: '/app/contas', rotulo: 'Contas', icone: 'contas', perfis: ['TITULAR'], elemento: <Contas />, ordem: 10 },
];
```

O `icone` define o grupo do menu (ver `client/src/layout/grupos.ts`): use exatamente o ícone e a `ordem` do seu mini-plano.

Leia antes de escrever, como modelo de tela (lista + filtros + resumo + tabela + modal + menu de ações):
`client/src/modules/cadastros/usuarios.tsx`. Siga o mesmo desenho:

```tsx
<Pagina titulo="Contas" acoes={<Botao aoClicar={...}>Nova conta</Botao>}>
  <div className="barra-ferramentas">
    <div className="filtros"> <Selecao .../> <Campo .../> </div>
    <Botao aoClicar={...}>Nova conta</Botao>
  </div>
  {erro && <Aviso tipo="erro">{erro}</Aviso>}
  {dados && <div className="resumo"> <ResumoItem .../> ... </div>}
  {carregando && <Carregando />}
  {dados && <Tabela<ContaDTO> chave={(c) => c.id} dados={dados} vazio="Nenhuma conta." colunas={[...]} />}
  <Modal aberto={...} titulo="Nova conta" aoFechar={...}> <form onSubmit={...}> ... </form> </Modal>
</Pagina>
```

Componentes disponíveis (leia as assinaturas nos arquivos; NÃO crie equivalentes):

- `client/src/ui/index.tsx`: `Pagina`, `Cartao`, `Grade`, `Botao` (variante `primario|secundario|perigo|texto`),
  `Selo` (cor `verde|amarelo|vermelho|azul|cinza`), `Aviso` (tipo `erro|sucesso|info`), `Carregando`,
  `Tabela` + `ColunaTabela` (`alinhar: 'direita'` para dinheiro; `acoes: true` para a coluna do menu),
  `Campo` (tipo `text|number|date`...), `AreaTexto`, `Selecao` (`opcoes`, `vazio`), `Caixa` (checkbox), `Modal`, `Abas`,
  `MenuAcoes` + `AcaoMenu` (`{ rotulo, icone, aoClicar, perigo? }`), `formatarData`, `formatarDataHora`.
- `client/src/ui/financas.tsx`: `ResumoItem`, `SeletorMes`, `Valor` (`sentido: 'entrada'|'saida'|'neutro'|'auto'`),
  `BarraProgresso`, `PontoCor`, `NomeComCor`, `CampoCor`, `Rosca` (+ tipo `Fatia`), `Vazio`, `SeloOrigem`.
  Classes de layout prontas em `ui/financas.css`: `fin-duas-colunas`, `fin-cartoes`, `fin-linha`, `fin-suave`, `fin-cabecalho`.
- `client/src/ui/icones.tsx`: `Icone` e o tipo `NomeIcone`. Use só nomes que existem em `NomeIcone`.
- `client/src/lib/api.ts`: `api.get<T>(caminho)`, `api.post<T>(caminho, corpo)`, `api.put<T>(caminho, corpo)`, `api.del(caminho)`.
  O caminho NÃO leva `/api` (ex.: `api.get('/contas')`).
- `client/src/lib/useDados.ts`: `const { dados, carregando, erro, recarregar } = useDados<T>(caminhoOuNull)`.
- `client/src/lib/financas.ts` (leia): todos os tipos DTO, rótulos (`TIPOS_CONTA`, `TIPOS_TRANSACAO`, `TIPOS_INVESTIMENTO`,
  `TIPOS_MOVIMENTO`, `STATUS_FATURA`, `STATUS_CONEXAO`, `COR_TIPO_INVESTIMENTO`, `rotuloDe`), datas (`hojeISO`, `mesAtual`,
  `somarMeses`, `rotuloMes`, `formatarDia`), dinheiro (`formatarReais`, `lerValor`, `valorParaCampo`, `formatarPercentual`),
  `mensagemErro`, `queryString`.

Regras de tela:

- Campo de dinheiro: `<Campo rotulo="Valor (R$)" valor={texto} aoMudar={setTexto} />` (tipo text) + `lerValor(texto)`;
  se `lerValor` devolver `null`, mostre `<Aviso tipo="erro">Informe um valor válido.</Aviso>` e não envie.
- Datas na tela: `formatarDia('AAAA-MM-DD')`. Dinheiro: `formatarReais(n)` ou `<Valor />`.
- Erros de ação: `try { ... } catch (e) { setErro(mensagemErro(e)); }` e mostre com `<Aviso tipo="erro">`.
- Exclusão: confirme com `window.confirm('...')`.
- CSS próprio (se precisar): um arquivo `client/src/modules/<nome>/<nome>.css`, classes com prefixo do módulo,
  SÓ variáveis de cor de `ui/estilo.css` (`var(--cor-superficie)`, `var(--cor-borda)`, `var(--cor-texto)`,
  `var(--cor-texto-suave)`, `var(--cor-primaria)`, `var(--cor-primaria-suave)`, `var(--cor-sucesso)`, `var(--cor-perigo)`,
  `var(--raio)`, `var(--raio-pequeno)`, `var(--sombra)`). Nenhuma cor fixa (exceção: cor vinda de dado, via `style`).
  Tem de funcionar no tema escuro e no celular (largura 360 px).
- Não use `any`. Não use bibliotecas de gráfico.

## Rotas da API (contrato entre servidor e cliente)

Todas sob `/api`, autenticadas. `XxxDTO` = tipos de `client/src/lib/financas.ts`.

### contas (g01)

| Método e caminho | Entrada | Resposta |
|---|---|---|
| `GET /contas` | query `tipo?` (TipoConta), `inativas?` (`'true'` inclui inativas) | `ContaDTO[]`, ordem: `tipo`, depois `nome` |
| `GET /contas/resumo` | — | `{ contas: number, investimentos: number, cartoes: number, patrimonio: number }` (de `totaisPatrimonio()`) |
| `POST /contas` | `{ nome, tipo, instituicao?, numero?, saldo?, cor?, bandeira?, limite?, diaFechamento?, diaVencimento? }` | `201 ContaDTO` |
| `PUT /contas/:id` | qualquer subconjunto de `{ nome, instituicao, numero, cor, ativo, bandeira, limite, diaFechamento, diaVencimento }` | `ContaDTO` |
| `PUT /contas/:id/saldo` | `{ saldo: number }` (só conta MANUAL) | `ContaDTO` |
| `DELETE /contas/:id` | só conta MANUAL (apaga junto transações e faturas, por cascata) | `204` |

### transacoes e categorias (g02 servidor, g03 cliente)

| Método e caminho | Entrada | Resposta |
|---|---|---|
| `GET /transacoes` | query: `mes?` (`AAAA-MM`) OU `de?` e `ate?` (`AAAA-MM-DD`, inclusive); `contaId?`, `categoriaId?` (número, ou `0` = sem categoria), `tipo?`, `faturaId?`, `busca?` (na descrição, sem diferenciar maiúsculas), `pagina?` (padrão 1), `porPagina?` (padrão 50, máx. 200) | `{ itens: TransacaoDTO[], total: number, receitas: number, despesas: number }` — ordem `data desc, id desc`; `total` = quantidade no filtro inteiro; `receitas`/`despesas` = somas no filtro inteiro, sem `transferencia` |
| `POST /transacoes` | `{ contaId, data, descricao, valor (>0), tipo, categoriaId?, transferencia?, observacao?, totalParcelas? (2 a 48, só em CARTAO) }` | `201 TransacaoDTO` (a primeira parcela, quando parcelado) |
| `PUT /transacoes/:id` | subconjunto de `{ data, descricao, valor, tipo, categoriaId (number ou null), transferencia, observacao }` | `TransacaoDTO` |
| `DELETE /transacoes/:id` | — | `204` |
| `GET /categorias` | query `tipo?` | `CategoriaDTO[]`, ordem `tipo`, `nome` |
| `POST /categorias` | `{ nome, tipo, cor? }` | `201 CategoriaDTO` |
| `PUT /categorias/:id` | `{ nome?, cor? }` | `CategoriaDTO` |
| `DELETE /categorias/:id` | — (as transações ficam sem categoria) | `204` |

### cartoes e faturas (g04)

| Método e caminho | Entrada | Resposta |
|---|---|---|
| `GET /cartoes` | — | `CartaoResumoDTO[]` = `{ conta: ContaDTO, faturaAtual: FaturaDTO \| null, percentualUsado: number \| null }` |
| `GET /faturas` | query `contaId?` | `FaturaDTO[]`, ordem `vencimento desc` |
| `GET /faturas/:id` | — | `{ fatura: FaturaDTO, transacoes: TransacaoDTO[], porCategoria: { nome: string, cor: string, total: number }[] }` |
| `POST /faturas/:id/pagar` | `{ pagaEm?: 'AAAA-MM-DD', contaPagamentoId?: number }` | `FaturaDTO` |

Criar/editar/excluir um cartão é pelas rotas de contas (`POST /contas` com `tipo: 'CARTAO'`).

### investimentos (g05)

| Método e caminho | Entrada | Resposta |
|---|---|---|
| `GET /investimentos` | query `tipo?`, `inativos?` (`'true'`) | `{ itens: InvestimentoDTO[], total: number, aplicado: number, rendimento: number, porTipo: { tipo: TipoInvestimento, total: number, percentual: number }[] }` |
| `GET /investimentos/:id` | — | `{ investimento: InvestimentoDTO, movimentos: MovimentoInvestimentoDTO[] }` (movimentos `data desc`) |
| `POST /investimentos` | `{ nome, tipo, codigo?, subtipo?, instituicao?, emissor?, valorAplicado, saldo?, quantidade?, taxa?, vencimento? }` | `201 InvestimentoDTO` |
| `PUT /investimentos/:id` | subconjunto dos campos acima + `ativo` | `InvestimentoDTO` |
| `DELETE /investimentos/:id` | só MANUAL | `204` |
| `POST /investimentos/:id/movimentos` | `{ data, tipo, valor (>0), quantidade?, descricao? }` (só MANUAL) | `201 { investimento: InvestimentoDTO, movimento: MovimentoInvestimentoDTO }` |
| `DELETE /investimentos/:id/movimentos/:movimentoId` | só MANUAL | `204` |

### planejamento: orçamento e metas (g06)

| Método e caminho | Entrada | Resposta |
|---|---|---|
| `GET /orcamentos` | query `mes?` (padrão: mês atual) | `{ mes: string, itens: OrcamentoDTO[], totalLimite: number, totalGasto: number, semOrcamento: { categoriaId: number, categoriaNome: string, categoriaCor: string, gasto: number }[] }` |
| `PUT /orcamentos/:categoriaId` | `{ limite: number (>0) }` (cria ou atualiza) | `{ categoriaId: number, limite: number }` |
| `DELETE /orcamentos/:categoriaId` | — | `204` |
| `GET /metas` | — | `MetaDTO[]` (não concluídas primeiro, depois por `prazo` asc com nulos no fim) |
| `POST /metas` | `{ nome, valorAlvo (>0), valorAtual?, prazo?, cor? }` | `201 MetaDTO` |
| `PUT /metas/:id` | subconjunto de `{ nome, valorAlvo, valorAtual, prazo (texto ou null), cor, concluida }` | `MetaDTO` |
| `DELETE /metas/:id` | — | `204` |

### painel, avisos e busca (g07)

| Método e caminho | Resposta |
|---|---|
| `GET /painel/resumo` | ver mini-plano g07 |
| `GET /notificacoes` | `{ chave: string, titulo: string, meta: string, quando: string (ISO), caminho: string }[]` |
| `GET /busca?q=` | `{ tipo: string, titulo: string, subtitulo: string, caminho: string }[]` |

### openfinance (servidor feito pelo main; g08 faz a tela)

| Método e caminho | Entrada | Resposta |
|---|---|---|
| `GET /openfinance/estado` | — | `EstadoOpenFinanceDTO` = `{ configurado: boolean, origemCredenciais: 'BANCO' \| 'ENV' \| null, clientId: string \| null, sandbox: boolean, conexoes: ConexaoDTO[] }` |
| `PUT /openfinance/credenciais` | `{ clientId: string, clientSecret?: string, sandbox: boolean }` (sem `clientSecret`, mantém o gravado) | `EstadoOpenFinanceDTO` |
| `DELETE /openfinance/credenciais` | — | `EstadoOpenFinanceDTO` |
| `POST /openfinance/token` | `{ conexaoId?: number }` (com `conexaoId`: token para reconectar aquela conexão) | `{ accessToken: string, sandbox: boolean, itemId: string \| null }` |
| `POST /openfinance/conexoes` | `{ itemId: string }` (id do item devolvido pelo widget da Pluggy) | `ConexaoDTO` (já sincronizada) |
| `POST /openfinance/conexoes/:id/sincronizar` | — | `ConexaoDTO` |
| `POST /openfinance/sincronizar` | — | `ConexaoDTO[]` |
| `DELETE /openfinance/conexoes/:id` | query `manterDados?` (`'true'` mantém contas e lançamentos como manuais) | `204` |

## Telas e menu

| Caminho | Rótulo | Ícone | Ordem | Dono |
|---|---|---|---|---|
| `/app` | Início | `inicio` | 0 | g07 (só `layout/Painel.tsx`) |
| `/app/contas` | Contas | `contas` | 10 | g01 |
| `/app/transacoes` | Lançamentos | `transacoes` | 20 | g03 |
| `/app/cartoes` | Cartões | `cartao` | 30 | g04 |
| `/app/investimentos` | Investimentos | `investimentos` | 40 | g05 |
| `/app/orcamento` | Orçamento | `orcamento` | 50 | g06 |
| `/app/metas` | Metas | `metas` | 52 | g06 |
| `/app/categorias` | Categorias | `categorias` | 54 | g03 |
| `/app/conexoes` | Conexões | `conexoes` | 60 | g08 |
