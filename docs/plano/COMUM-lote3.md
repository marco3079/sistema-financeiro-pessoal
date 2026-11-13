# Regras comuns do lote 3 (g25 a g37)

Leia este arquivo inteiro antes do seu mini-plano. Ele vale para todos os geradores do lote.

## Projeto

- `server/`: Node 20 + TypeScript + Express 4 + Prisma 5 + zod 4. Cada módulo é `server/src/modules/<nome>/routes.ts`, com `export default router` (um `Router()` do Express). O servidor carrega a pasta sozinho e monta o router em `/api`, já com login e com o perfil financeiro da requisição.
- `client/`: React 18 + TypeScript + Vite. Cada módulo é `client/src/modules/<nome>/index.tsx` exportando `rotas: RotaModulo[]`; o menu é montado sozinho.

## Leia antes de escrever (para copiar o estilo)

- Servidor: `server/src/modules/perfis/routes.ts` e `server/src/modules/planejamento/routes.ts` (CRUD com zod, `asyncHandler`, `HttpError`, `validar`, `idParam`), `server/src/lib/financas.ts` (helpers: `num`, `arredondar`, `dataISO`, `paraData`, `hoje`, `mesAtual`, `somarMeses`, `intervaloDoMes`, `moeda`, `textoCurto`, `textoOpcional`, `dinheiroSchema`, `dataSchema`, `mesSchema`, `textoQuery`, `inteiroQuery`, `transacaoDTO`, `INCLUIR_NA_TRANSACAO`, `efeitoNoSaldo`), `server/prisma/schema.prisma` (os modelos).
- Cliente: `client/src/modules/perfis/Perfis.tsx` (lista + `Modal` de criar/editar + confirmação), `client/src/modules/drive/Drive.tsx` (estado + botões), `client/src/ui/index.tsx` (`Pagina`, `Cartao`, `Tabela`, `Botao`, `Campo`, `Selecao`, `Modal`, `Aviso`, `Carregando`, `Selo`, `Abas`, `MenuAcoes`), `client/src/ui/financas.tsx` (`ResumoItem`, `Rosca`, `Vazio`, `Valor`, `NomeComCor`, `SeletorMes`, `BarraProgresso`), `client/src/ui/graficos.tsx` (`GraficoLinhas`, `GraficoBarras`, `CORES_SERIE`), `client/src/lib/financas.ts` (tipos DTO, `formatarReais`, `formatarDia`, `rotuloMes`, `mesAtual`, `somarMeses`, `hojeISO`, `lerValor`, `mensagemErro`), `client/src/lib/api.ts` (`api.get/post/put/del`), `client/src/lib/useDados.ts`.

## Regras do servidor

1. **Perfil financeiro**: o filtro por perfil é automático (`server/src/lib/prisma.ts`). Use sempre `import { prisma } from '../../lib/prisma'` e NUNCA escreva `perfilId` em `where` nem em `data`.
2. **Não edite** `schema.prisma`, `app.ts`, `lib/prisma.ts`, `lib/drive.ts`, `lib/perfil.ts` nem arquivos de outro módulo. As tabelas de que você precisa já existem (veja o seu mini-plano). Não há chave estrangeira nas tabelas novas: ao ler, descarte linhas cujo registro pai não existe mais.
3. Valide toda entrada com zod + `validar(schema, req.body)`; ids de rota com `idParam(req)`; erros com `throw new HttpError(status, 'mensagem em português')`.
4. Dinheiro: no banco é `Decimal`; converta com `num()` ao ler e devolva `number` arredondado com `arredondar()`. Datas na API: `'AAAA-MM-DD'`; meses: `'AAAA-MM'`.
5. Lançamentos: `valor` é sempre positivo e `tipo` é `RECEITA` ou `DESPESA`; `transferencia: true` não conta como gasto nem receita; cartão é uma `Conta` com `tipo: 'CARTAO'`, cujo `saldo` é a dívida.
6. Nada de `any`, nada de `// @ts-ignore`, nenhuma dependência nova.

## Regras do cliente

1. Rota: `{ caminho, rotulo, icone, perfis: ['TITULAR'], elemento, ordem }`. Use exatamente o ícone e a ordem do seu mini-plano (o ícone decide o grupo do menu).
2. Componentes só de `ui/index.tsx`, `ui/financas.tsx` e `ui/graficos.tsx`; confira a assinatura real antes de usar.
3. CSS em um arquivo `.css` do seu módulo, só com variáveis do tema (`--cor-texto`, `--cor-texto-suave`, `--cor-borda`, `--cor-superficie`, `--cor-primaria`, `--cor-verde`, `--cor-perigo`, `--cor-aviso`, `--raio`); sem hexadecimal e sem `!important`. Tudo cabe em 360 px sem rolagem horizontal da página.
4. Estados: carregando (`<Carregando />`), erro (`<Aviso tipo="erro">` com `mensagemErro`), vazio (`<Vazio .../>`). Toda exclusão pede confirmação. Nada de `any`, `// @ts-ignore` ou biblioteca nova.
5. Textos em português do Brasil, frases curtas, sem jargão.

## Entrega

- Só crie ou edite os arquivos listados no seu mini-plano.
- Rode `cd server && npx tsc --noEmit` e `cd client && npx tsc --noEmit`. Erros em arquivos que não são seus são de outros geradores do lote: ignore e diga que ignorou.
- Não rode git, Docker, nem scripts `.ps1`/`.sh`. Não abra as pastas `backups/`, `drive/`, `atualizacao/`.
- Sala do squad: `lote3`. BUS: `node "C:/Users/games/.claude/plugins/cache/skill-squad-room/squad-stream/0.2.0/skills/squad-stream/scripts/bus.js"`. Publique `done` ao terminar. Dúvida real: pergunte para `@main` na sala e siga com a opção mais segura.
- Resumo final: arquivos criados, resultado dos dois typechecks e todo desvio do plano, com o motivo.
