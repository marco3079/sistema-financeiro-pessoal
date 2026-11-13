# Testes automáticos

A suíte de fumaça roda contra o sistema **já no ar** (API em `http://localhost:3092/api`). Não sobe o servidor sozinha.

## Como rodar

1. Suba o sistema (`docker compose up -d` ou o servidor em modo dev).
2. Na pasta `server`:

```
cd server
npm run teste
```

Por padrão ela entra com `demo@financas.local` / `demo1234`. Para outro usuário ou outro endereço da API, defina antes:

- `TESTE_EMAIL` e `TESTE_SENHA`: usuário de login.
- `TESTE_API`: endereço da API (padrão `http://localhost:3092/api`).

Não há dependência nova: a suíte usa `node:test` e `node:assert`, e o `fetch` nativo do Node 20+.

## Regra de segurança

- A suíte cria um **perfil financeiro próprio** (`Teste automático <timestamp>`) e manda `X-Perfil` desse perfil em todas as chamadas. Nada é gravado no perfil do usuário.
- O perfil de teste é apagado no fim (bloco `after`), inclusive quando algum teste falha. Ao final, a suíte confere em `GET /perfis` que ele não existe mais.
- Se sobrar um perfil de teste de uma execução anterior (mesmo padrão de nome), ele é apagado no início. Nenhum outro perfil é tocado.

## O que a suíte cobre

- Login e `/auth/me`.
- Perfil novo com as 17 categorias padrão.
- Conta e lançamento: o saldo muda como esperado.
- Extrato CSV: analisar, confirmar, reimportar (0 novos) e Pix pago no crédito marcado como transferência.
- Fatura CSV: fatura criada, dívida do cartão, conciliação sem divergência; remover a importação devolve saldo e fatura.
- Regras de categoria: a prévia não grava; aplicar grava.
- Contas fixas, agenda (dia 31 em fevereiro cai no dia 28) e fluxo de caixa (só 3, 6 ou 12 meses).
- Divisão de gastos: a soma das partes não passa do valor do lançamento.
- Carteira-alvo: aceita soma 100 e recusa os demais.
- Conciliação sem divergência.
- Telas de leitura respondendo 200: `/analise`, `/alertas`, `/ir`, `/carteira`, `/carteira/proventos`, `/rendimento`, `/cartoes/previsao`, `/painel/resumo`.
- MCP: chave de leitura, `initialize`, `tools/list` (só ferramentas de leitura), uma `tools/call`, recusa de ferramenta de escrita, e chave apagada deixa de valer.
- Isolamento: o que foi criado no perfil de teste não aparece em outro perfil (conta, categoria e lançamento).

## O que a suíte não cobre

- Telas do navegador (React): não há teste de interface.
- Usuário LEITOR e permissões por tela.
- Open Finance, cotações online, Drive, atualização e backup.
- Importação de PDF e OFX, e importação de B3.
- Cálculos de imposto de renda, rendimento e índices além de checar que a tela responde.
- Carga, concorrência e limites de tempo.
- Migrações do banco.

## Saída

A saída segue o formato do `node:test`. Em caso de falha, a mensagem mostra o passo que falhou, o status HTTP esperado e o recebido, e o erro devolvido pela API, sem o corpo completo da resposta nem tokens.
