# Mini-planos do lote 4

Valem TODAS as regras de `docs/plano/COMUM-lote3.md` (leia inteiro antes), com uma troca: a sala do squad é `lote4`. Cada gerador faz só a sua seção e só os arquivos dela. As tabelas e colunas citadas já existem em `server/prisma/schema.prisma` (não edite o schema).

---

## h01 — Desdobramentos e bonificações no histórico

**Arquivos**: `server/src/lib/importacao/b3.ts`, o trecho `/importacao/b3/analisar` e `/importacao/b3/confirmar` de `server/src/modules/importacao/routes.ts` (não mexa no resto do arquivo), `server/src/lib/carteira.ts` (só `valoresDoAtivo` e o que ela precisar), `client/src/modules/importar/tipos.ts` (só acrescentar campo) .
**Tabela**: `EventoAtivo { investimentoId, data, tipo ('DESDOBRAMENTO' | 'GRUPAMENTO' | 'BONIFICACAO'), fator, descricao, chaveImportacao, importacaoId }`. `fator` multiplica a quantidade em mãos na data (desdobramento 1→10 = 10; bonificação de 10% = 1.1); o custo total não muda.

1. `b3.ts`: a função que processa a movimentação já trata `Desdobro`, `Bonificação em Ativos`, `Grupamento` para acertar a quantidade (veja `efeitoDe`). Além disso, passe a devolver em `AnaliseB3` uma lista `eventos: { chave, data, tipo, fator, descricao }[]`: para cada linha dessas, `fator = (quantidade antes + quantidade creditada) / quantidade antes` (grupamento: quantidade depois / antes), só quando a quantidade antes é > 0 e o fator é finito e diferente de 1.
2. `routes.ts`: aceite `eventos` no schema do `confirmar` (opcional, padrão `[]`) e grave em `EventoAtivo` para os ativos importados, sem duplicar (chave `hash('b3ev|chave|data|tipo|fator')` em `chaveImportacao`, conferindo se já existe) e com `importacaoId` do registro; `analisar` devolve a lista. O DELETE de importação da B3 (mesmo arquivo) deve apagar também os `EventoAtivo` com aquele `importacaoId`.
3. `carteira.ts` → `valoresDoAtivo` recebe os eventos do ativo (carregue-os onde os ativos são carregados: `montarCarteira` e `patrimonioEstimado`, com uma consulta `prisma.eventoAtivo.findMany` agrupada por `investimentoId`). Os preços do Yahoo já vêm ajustados por desdobramento, então a quantidade de cada dia tem de estar "em cotas de hoje": quantidade ajustada do dia = quantidade dos movimentos até o dia × produto dos fatores dos eventos com data POSTERIOR àquele dia. Quando o ativo tem eventos, use isso no lugar do `ajuste` uniforme atual; sem eventos, mantenha o comportamento atual.
**Aceite**: compra de 10 em janeiro, desdobramento ×10 em março, quantidade atual 100: em fevereiro a quantidade ajustada é 100 e o valor é 100 × preço ajustado; tsc dos dois lados.

---

## h02 — Imposto das vendas (estimativa)

**Arquivos**: `server/src/modules/ir/routes.ts`, `client/src/modules/ir/IR.tsx`, `client/src/modules/ir/ir.css` (não toque em `index.tsx`).
1. Custo médio: aplique os `EventoAtivo` do ativo na ordem das datas (quantidade × fator, custo total igual) antes de processar movimentos da mesma data.
2. Acrescente à resposta de `GET /ir` o campo `imposto: { meses: [{ mes, classe, resultado, prejuizoCompensado, base, aliquota, imposto }], totalNoAno, prejuizoAcumulado: { ACOES, FII, ETF } }`. Regras (operações comuns, sem day trade): por classe, mês a mês desde o primeiro movimento (o prejuízo vem de anos anteriores): resultado negativo soma ao prejuízo acumulado da classe; resultado positivo é abatido pelo prejuízo acumulado da mesma classe; `ACOES` com `vendas` do mês ≤ 20000: isento (base 0; lucro isento NÃO consome prejuízo); alíquotas: `ACOES` 15%, `ETF` 15%, `FII` 20%. `imposto = base × alíquota`, arredondado. Devolva só os meses do ano pedido.
3. Tela: nova seção `Imposto estimado por mês` (mês, classe, resultado, prejuízo compensado, base, alíquota, imposto) e o total do ano; mantenha o aviso do topo e acrescente: `Estimativa para operações comuns. Não considera day trade, taxas, IRRF ("dedo-duro") nem prejuízos anteriores ao período importado. Confira antes de gerar o DARF.` Troque a frase "O sistema não calcula o imposto a pagar" por "O imposto mostrado é uma estimativa".
**Aceite**: FII com lucro 100 em janeiro e prejuízo 300 em fevereiro e lucro 250 em março → imposto jan 20, fev 0, mar 0 com prejuízo acumulado 50; tsc.

---

## h03 — Acesso só de leitura (usuário LEITOR)

**Arquivos**: `server/src/lib/auth.ts`, `server/src/lib/perfil.ts` (só `escolherPerfil`), `server/src/modules/usuarios/routes.ts`, `client/src/lib/tipos.ts`, `client/src/lib/rotas.ts` e/ou o ponto ÚNICO do cliente que filtra rotas por perfil (ache-o; não edite os `index.tsx` dos módulos), `client/src/modules/usuarios/*`, `client/src/layout/Layout.tsx` (só para um selo "Somente leitura").
**Já existe**: `enum Perfil { TITULAR, LEITOR }` e `Usuario.perfilFinanceiroId Int?`.
1. `autenticar` aceita `LEITOR`. Logo depois de autenticar, se `req.usuario.perfil === 'LEITOR'` e o método não é `GET`/`HEAD`/`OPTIONS` → 403 `Este acesso é só de leitura`, exceto `POST /api/auth/sair` e a troca da PRÓPRIA senha. E `LEITOR` recebe 403 também em qualquer `GET` de `/api/usuarios`, `/api/mcp`, `/api/drive`, `/api/atualizacao`, `/api/seguranca` (exceto as rotas da própria 2FA, que são POST e ficam bloqueadas mesmo), `/api/logs`, `/api/configuracoes`, `/api/entrada`, `/api/perfis` (lista: devolva só o perfil dele). Faça essa checagem dentro de `autenticar` (um lugar só).
2. `escolherPerfil`: se o usuário tem `perfilFinanceiroId`, esse perfil vale sempre, ignorando o cabeçalho `X-Perfil` (busque o usuário pelo `req.usuario.id`; guarde em cache simples por 30 s).
3. `usuarios`: criar/editar usuário com `perfil` (`TITULAR` | `LEITOR`) e, para `LEITOR`, `perfilFinanceiroId` obrigatório (um perfil existente). Não deixe rebaixar ou apagar o último `TITULAR` ativo.
4. Cliente: `LEITOR` enxerga as mesmas telas do `TITULAR` menos: usuários, configurações, logs, perfis, conectar IA, drive, atualização, segurança, pasta de entrada, importar, lançar rápido, regras. Resolva no ponto único de filtro (lista de caminhos negados para `LEITOR`), mais `NOME_DO_PERFIL`/`RAIZ_DO_PERFIL` em `tipos.ts`. Mostre no topo um selo `Somente leitura` e esconda o seletor de perfil financeiro para ele.
**Aceite**: com token de LEITOR, `POST /api/transacoes` → 403 e `GET /api/contas` → 200 só do perfil dele mesmo mandando `X-Perfil` de outro; TITULAR continua igual; tsc.

---

## h04 — Lançar por foto do cupom (API da Claude)

**Arquivos**: `server/package.json` + `server/package-lock.json` (instale `@anthropic-ai/sdk` com `cd server && npm install @anthropic-ai/sdk`), `server/src/modules/cupom/routes.ts`, `client/src/modules/cupom/index.tsx`, `Cupom.tsx`, `cupom.css`, `client/src/modules/rapido/Rapido.tsx` (só acrescentar o botão e preencher os campos).
**ANTES de escrever**, leia `C:/Users/games/AppData/Local/Temp/claude/bundled-skills/2.1.321/9987d197dd80dd387c76ee0317974ee4/claude-api/typescript/claude-api/README.md` (instalação, cliente, requisição com imagem, saída estruturada, erros, e a seção de Refusal Fallbacks) e siga-o: use o SDK oficial (nunca `fetch` direto), o modelo padrão `claude-opus-5-5` (string exata, sem sufixo de data), verifique `stop_reason` (trate `refusal`), use saída estruturada (`output_config.format` / o helper de parse com zod descrito lá) e as classes de erro tipadas do SDK. Não chute nomes de métodos: copie do README.
**Config** (em `ConfiguracaoPlataforma`, id 1): `anthropicChaveCifrada` (cifre com `cifrar`/`decifrar` de `server/src/lib/cripto.ts`), `anthropicModelo` (null = padrão). A chave também pode vir de `ANTHROPIC_API_KEY` do ambiente.
**API**: `GET /cupom/estado` → `{ configurado, origem: 'BANCO' | 'ENV' | null, modelo }`; `PUT /cupom/chave` `{ chave, modelo? }` (modelo ∈ `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`); `DELETE /cupom/chave`; `POST /cupom/ler` `{ imagem (base64 sem prefixo), tipo ('image/jpeg' | 'image/png' | 'image/webp') }` (até 5 MB decodificado; o `app.ts` limita o corpo a 1 MB — por isso o cliente REDUZ a imagem antes de enviar, veja abaixo) → `{ valor: number | null, data: 'AAAA-MM-DD' | null, estabelecimento: string | null, categoriaSugerida: string | null, itens: number }`. Peça ao modelo: total pago, data da compra, nome do estabelecimento e a categoria mais provável dentre os nomes das categorias de DESPESA do perfil (passe a lista no prompt). Nunca devolva nem registre a chave; erros da API viram mensagens em português (chave inválida, limite, recusa).
**Cliente**: tela `/app/cupom` (rótulo `Leitura de cupom`, ícone `engrenagem`, ordem 96) para colar a chave, escolher o modelo (rótulos: `Opus 5.5 (mais preciso)`, `Sonnet 5.5`, `Haiku 5.5 (mais barato)`) e o aviso `A foto do cupom é enviada à Anthropic para leitura. O uso é cobrado na sua conta da API.` Em `Rapido.tsx`: botão `Foto do cupom` (`<input type="file" accept="image/*" capture="environment">`); reduza a imagem em `canvas` para no máximo 1280 px no maior lado e JPEG qualidade 0.7 (fica bem abaixo de 1 MB), envie, e preencha valor, data, descrição (estabelecimento) e categoria; a pessoa confere e clica em Lançar. Sem chave configurada, o botão leva a `/app/cupom`.
**Aceite**: sem chave, `POST /cupom/ler` → 400 `Configure a chave da API`; nada é lançado sozinho; tsc.

---

## h05 — Avisos por e-mail e Telegram

**Arquivos**: `server/src/lib/avisos.ts`, `server/src/modules/avisos/routes.ts`, `client/src/modules/avisos/index.tsx`, `Avisos.tsx`, `avisos.css`.
**Rota do cliente**: `/app/avisos`, rótulo `Avisos`, ícone `sino`, ordem 95.
**Config** (`ConfiguracaoPlataforma` id 1): `avisosAtivos`, `avisosEmail`, `telegramTokenCifrado` (cifrar), `telegramChatId`. E-mail: use o envio que já existe em `server/src/lib/email.ts` (leia como funciona; se o SMTP não estiver configurado, o e-mail fica indisponível e a tela diz isso). Telegram: `POST https://api.telegram.org/bot<token>/sendMessage` com `{ chat_id, text }` (fetch, timeout de 15 s).
**O que avisa** (por perfil financeiro, uma vez por dia às 8h pelo relógio do servidor e pelo botão `Enviar agora`): faturas não pagas vencendo em até 3 dias ou atrasadas; contas fixas a pagar vencendo em até 3 dias (tabelas `ContaFixa`/`PagamentoContaFixa`); categorias com orçamento do mês acima de 90%; alertas de gravidade alta de `GET /alertas` (use `chamarApiInterna(perfilId, 'GET', '/alertas')` de `server/src/lib/mcp.ts`). Cada aviso tem uma `chave` estável (ex.: `fatura-12-2026-12-08`, `orcamento-5-2026-11`) gravada em `AvisoEnviado` para não repetir. Uma mensagem só por envio, em texto simples, com o nome do perfil no título. Sem novidade, não envia nada.
**API**: `GET /avisos/config` (sem devolver o token), `PUT /avisos/config`, `POST /avisos/testar` (envia "Teste de aviso" pelos canais configurados e devolve o resultado de cada um), `POST /avisos/enviar` (roda agora para o perfil atual e devolve `{ enviados: number, canais }`).
**Tela**: liga/desliga, e-mail de destino, token e chat id do Telegram (com o passo a passo: falar com @BotFather, criar o bot, mandar uma mensagem para ele e pegar o chat id), botões `Testar` e `Enviar agora`, e a lista do que é avisado.
**Aceite**: desligado não envia; o mesmo aviso não sai duas vezes; falha de um canal não impede o outro; tsc.

---

## h06 — Visão do ano

**Arquivos**: `server/src/modules/ano/routes.ts`, `client/src/modules/ano/index.tsx`, `Ano.tsx`, `ano.css`.
**Rota do cliente**: `/app/ano`, rótulo `Visão do ano`, ícone `calendario`, ordem 27.
**API**: `GET /ano?ano=AAAA` → `{ ano, anos: number[], despesas: Linha[], receitas: Linha[], totais: { receitas: number[12], despesas: number[12], saldo: number[12] }, anterior: { receitas, despesas } }` com `Linha = { categoriaId | null, nome, cor, meses: number[12], total, media, totalAnoAnterior, variacao (% ou null) }`. Sem transferências; crédito em conta `CARTAO` abate das despesas do mês (e não entra em receitas); `media` = total / meses com algum valor.
**Tela**: seletor de ano; resumo (receitas, despesas, saldo do ano e comparação com o ano anterior); `GraficoBarras` de receitas × despesas por mês; duas tabelas (despesas e receitas) com 12 colunas de mês + total + média + variação contra o ano anterior, com rolagem horizontal própria, primeira coluna fixa e células com fundo proporcional ao valor (`color-mix` com `--cor-primaria`).
**Aceite**: ano sem dados mostra `<Vazio>`; a soma das linhas bate com os totais; tsc.

---

## h07 — Orçamento sugerido e metas ligadas

**Arquivos**: `server/src/modules/planejamento/routes.ts`, `client/src/modules/planejamento/Orcamento.tsx`, `Metas.tsx` e os `.css` do módulo.
1. `GET /orcamentos/sugestao?meses=3|6` → `[{ categoriaId, nome, cor, media, sugerido, limiteAtual | null }]` para categorias de DESPESA com gasto: `media` = média mensal dos últimos N meses FECHADOS (sem transferências); `sugerido` = média arredondada para cima ao múltiplo de 10. Tela Orçamento: botão `Sugerir limites` abre um modal com a lista (média, sugerido editável, limite atual) e caixas de seleção; `Aplicar` grava só os marcados com a rota de orçamento que já existe.
2. Metas ligadas (`Meta.contaId`, `Meta.investimentoId`, no máximo um dos dois): no criar/editar, opção `Acompanhar o saldo de` (nenhum, uma conta que não é cartão, um investimento). Meta ligada: o valor guardado devolvido pela API é o saldo atual da conta/investimento (não o digitado), o campo de valor guardado some do formulário e a meta mostra de onde vem. Se a conta/investimento não existe mais, a meta volta a usar o valor gravado.
**Aceite**: metas sem ligação continuam iguais; a sugestão não altera nada sem `Aplicar`; tsc.

---

## h08 — Ficha de cada ativo

**Arquivos**: `server/src/modules/ativo/routes.ts`, `client/src/modules/ativo/index.tsx`, `Ativo.tsx`, `ativo.css`.
**Rota do cliente**: `/app/ativo`, rótulo `Ficha do ativo`, ícone `investimentos`, ordem 41 (o ativo é escolhido num `Selecao` e fica em `?id=` na URL).
**API**: `GET /ativo/:id` → `{ investimento: { id, nome, codigo, tipo, quantidade, valorAplicado, saldo, precoMedio }, precos: { datas: string[], valores: number[] } (uma amostra de no máximo 400 pontos da tabela `PrecoAtivo` pelo `codigo`, desde a primeira compra; vazio se não houver), movimentos: [{ data, tipo, valor, quantidade, descricao }], proventosPorAno: [{ ano, total }], proventosDozeMeses, rendimentoSobreOCusto (% ou null), eventos: [{ data, tipo, fator }] (tabela `EventoAtivo`) }`.
**Tela**: resumo (saldo, aplicado, ganho, preço médio × preço atual, proventos em 12 meses e rendimento sobre o custo); `GraficoLinhas` do preço com uma segunda série constante do preço médio; lista das compras e vendas (data, tipo, quantidade, preço unitário = valor/quantidade, valor); `GraficoBarras` de proventos por ano; eventos, se houver. Texto fixo: `Preço de fechamento ajustado por desdobramentos (Yahoo Finance).`
**Aceite**: ativo sem código de bolsa mostra tudo menos o gráfico de preço; id de outro perfil → 404; tsc.

---

## h09 — Simulador de aportes

**Arquivos**: `client/src/modules/simulador/index.tsx`, `Simulador.tsx`, `simulador.css`. Sem servidor (pode ler `GET /contas/resumo` para sugerir o valor inicial = `investimentos`).
**Rota do cliente**: `/app/simulador`, rótulo `Simulador`, ícone `investimentos`, ordem 44.
**Tela**: campos `Valor inicial`, `Aporte mensal`, `Taxa ao ano (%)`, `Inflação ao ano (%)` (opcional), `Prazo em anos` (1 a 50). Conta: taxa mensal = (1+a)^(1/12) − 1; mês a mês `saldo = saldo × (1 + i) + aporte`. Resultado: saldo final, total aportado, rendimento, e o saldo final "em valores de hoje" quando há inflação; `GraficoLinhas` anual com duas séries (`Saldo`, `Total aportado`); tabela ano a ano. Três cenários lado a lado com a taxa informada e ±2 pontos. Aviso fixo: `É uma conta com a taxa que você informou, constante todos os meses. Não é previsão nem recomendação.`
**Aceite**: 0 de inicial, 100 por mês, 0% → 1200 em 1 ano; valores inválidos não quebram a tela; tsc.

---

## h10 — Instalar no celular e acesso de fora de casa

**Arquivos**: `docs/ACESSO-EXTERNO.md`, `server/src/modules/rede/routes.ts`, `client/src/layout/BotaoCelular.tsx`, `client/src/layout/InstalarApp.tsx` (novo), e, se preciso, `client/public/manifest.webmanifest`, `client/public/sw.js` e `client/index.html`.
1. Confira o manifesto e o service worker que já existem (nome, ícones 192/512, `display: standalone`, `start_url: /app`, `theme_color`); corrija o que faltar para o navegador oferecer a instalação.
2. `InstalarApp.tsx`: `export function InstalarApp(): JSX.Element | null` — escuta `beforeinstallprompt`, guarda o evento e mostra um botão `Instalar aplicativo` (no iOS, que não tem o evento, mostra o texto `No iPhone: Compartilhar > Adicionar à Tela de Início`); some quando já está instalado (`display-mode: standalone`). O main encaixa o componente.
3. `rede/routes.ts`: aceite a variável `URL_PUBLICA` (ex.: `https://meu-pc.tailnet.ts.net`): se for uma URL `https://` válida (só host e porta opcional), ela vem primeiro em `enderecos` com o rótulo `Endereço seguro (HTTPS)`. `BotaoCelular.tsx`: quando há endereço HTTPS, mostre o `InstalarApp` e a frase `Com HTTPS dá para instalar como aplicativo`.
4. `docs/ACESSO-EXTERNO.md`: passo a passo com o Tailscale (instalar no computador e no celular, mesma conta, `tailscale serve --bg 8092` para publicar com HTTPS só dentro da sua rede Tailscale, pôr `URL_PUBLICA` no `.env`, `docker compose up -d`), o que isso NÃO faz (não abre porta no roteador, não fica público), e por que não usar `tailscale funnel` sem a verificação em duas etapas ligada. Diga claramente que os comandos do Tailscale foram escritos pela documentação e devem ser conferidos na versão instalada.
**Aceite**: sem `URL_PUBLICA` nada muda; `URL_PUBLICA=http://x` é ignorada; tsc.

---

## h11 — Mais ferramentas para a IA (MCP)

**Arquivos**: `server/src/lib/mcp.ts` (só a lista `FERRAMENTAS`).
Acrescente ferramentas de LEITURA, no mesmo padrão das que existem (zod `entrada`, `esquema` JSON, `executar` chamando a API interna): `contas_a_pagar` (`GET /agenda?mes=`), `fluxo_de_caixa` (`GET /fluxo?meses=`), `cobrancas_estranhas` (`GET /alertas`), `conciliacao_dos_cartoes` (`GET /conciliacao`), `divisao_de_gastos` (`GET /divisoes`), `imposto_de_renda` (`GET /ir?ano=`), `visao_do_ano` (`GET /ano?ano=`), `carteira_alvo` (`GET /alvo`), `regras_de_categoria` (`GET /regras`). Descrições curtas e precisas em português, dizendo o que vem e as unidades. Nenhuma ferramenta nova de escrita.
**Aceite**: `tools/list` devolve as novas só como leitura (`escrita: false`); tsc.

---

## h12 — Testes automáticos

**Arquivos**: `server/tests/` (novo: `fumaca.mjs` e arquivos auxiliares), `server/package.json` (só o script `"teste": "node tests/fumaca.mjs"`), `docs/TESTES.md`.
Uma suíte de integração em Node puro (`node:test` + `node:assert`, sem dependência nova) que roda contra o sistema no ar (`API` = `process.env.TESTE_API ?? 'http://localhost:3092/api'`, usuário `TESTE_EMAIL`/`TESTE_SENHA`, padrão `demo@financas.local` / `demo1234`). **Regra de ouro: os testes criam um PERFIL FINANCEIRO próprio (`POST /perfis` com nome `Teste automático <timestamp>`), mandam `X-Perfil` desse perfil em todas as chamadas e o apagam no fim (em `after`, mesmo se algo falhar). Nunca gravam nada no perfil do usuário.** Cubra, cada item em um `test`: login; categorias padrão do perfil novo (17); criar conta e lançamento e conferir o saldo; importar um extrato CSV de exemplo (analisar + confirmar), conferir que reimportar dá 0 novos e que o Pix no crédito vira transferência; importar uma fatura CSV e conferir fatura e dívida do cartão; remover a importação e conferir que saldo e fatura voltam; regras de categoria + reprocessar (prévia não grava); contas fixas, agenda (dia 31 em fevereiro) e fluxo; divisão de gastos (limite da soma); carteira-alvo (soma 100); conciliação sem divergência; `GET` de cada tela de leitura devolvendo 200 (`/analise`, `/alertas`, `/ir`, `/carteira`, `/carteira/proventos`, `/rendimento`, `/cartoes/previsao`, `/painel/resumo`); MCP: criar chave de leitura, `initialize`, `tools/list`, uma `tools/call`, recusa de escrita, apagar a chave; isolamento: o que foi criado no perfil de teste não aparece no perfil 1.
`docs/TESTES.md`: como rodar (`cd server && npm run teste` com o sistema no ar) e o que a suíte cobre e não cobre.
**Aceite**: rode a suíte de verdade (o sistema está no ar em `localhost:3092`) e entregue a saída resumida; no fim não sobra perfil de teste (`GET /perfis`).

---

## h13 — Menu reorganizado (só depois dos outros)

**Arquivos**: `client/src/layout/grupos.ts`, os `index.tsx` dos módulos do cliente (só o campo de menu/ordem/rótulo), e arquivos novos de "central" em `client/src/modules/centrais/`.
O menu tem telas demais. Veja em `client/src/lib/rotas.ts` e `client/src/layout/Layout.tsx` como uma rota fica fora do menu (se não houver um campo para isso, acrescente `foraDoMenu?: boolean` em `RotaModulo` e respeite-o onde o menu é montado — a rota continua existindo). Deixe no menu, nesta ordem: **Início**; *Dia a dia*: Lançar rápido, Lançamentos, Contas, Cartões, Contas a pagar; *Análises*: Análise, Visão do ano, Relatório do mês, Cobranças estranhas; *Investimentos*: Carteira, Investimentos, Mais de investimentos (central); *Planejamento*: Orçamento, Metas, Divisão de gastos; *Dados*: Importar, Mais de dados (central); *Sistema*: Configurações (central), Meu perfil. Cada **central** é uma página simples com cartões-atalho (título, uma linha de explicação, link): `Mais de investimentos` (Rendimento, Ficha do ativo, Carteira-alvo, Imposto de renda, Simulador); `Mais de dados` (Pasta de entrada, Regras de categoria, Categorias, Conciliação, Conexões, Drive); `Configurações` (a tela de configurações que já existe continua sendo um dos atalhos, mais Perfis financeiros, Usuários, Segurança, Conectar IA, Leitura de cupom, Avisos, Atualização, Logs, Atividade). As telas fora do menu continuam acessíveis pela busca do topo e pelos atalhos. Respeite o filtro do usuário LEITOR (uma central não mostra atalho para tela que ele não pode abrir).
**Aceite**: todas as rotas antigas continuam abrindo pelo endereço; nenhum item do menu aponta para tela inexistente; tsc.

---

## h14 — Painel inicial novo (só depois dos outros)

**Arquivos**: `client/src/layout/Painel.tsx`, `client/src/layout/painel.css`.
Mantenha o cabeçalho, os cartões de resumo e o gráfico de patrimônio que já existem. Acrescente, com as rotas que já existem (cada bloco carrega e falha sozinho, sem derrubar o painel): `Próximos vencimentos` (`GET /agenda?mes=` do mês atual: os 5 próximos itens não pagos, com dias restantes e link para `/app/agenda`); `Saldo projetado` (`GET /fluxo?meses=3`: três números, um por mês, com cor pelo sinal); `Atenção` (`GET /alertas`: quantidade e os 2 primeiros, link para `/app/alertas`; some se não houver); atalho grande `Lançar gasto` para `/app/rapido`. Troque a grade de "Atalhos rápidos" por no máximo 6 atalhos (Lançar rápido, Importar, Contas a pagar, Carteira, Análise, Relatório do mês). Para o usuário LEITOR, esconda o que leva a telas de escrita.
**Aceite**: com todas as rotas novas fora do ar o painel antigo continua aparecendo; 360 px sem rolagem horizontal; tsc.
