# Como contribuir

Obrigado pelo interesse em melhorar o sistema financeiro pessoal. Este guia explica como relatar problemas, preparar o ambiente, organizar o código e enviar mudanças.

## Relatar um defeito ou sugerir uma melhoria

Use as **issues** do repositório: https://github.com/marco3079/sistema-financeiro-pessoal/issues

- Para um defeito, use o modelo "Relatar um defeito". Diga o que aconteceu, o que era esperado e como reproduzir.
- Para uma sugestão, use o modelo "Sugerir uma melhoria". Diga qual problema ela resolve.
- Não cole senhas, tokens nem o conteúdo do arquivo `.env` em issues, pull requests ou comentários.
- Vulnerabilidades de segurança não devem virar issue pública. Veja o arquivo [SECURITY.md](SECURITY.md).

## Preparar o ambiente

### Para testar com Docker (recomendado)

Requisitos: Docker com Docker Compose.

- Windows: `instalar.ps1` (com `-Demo` para carregar dados fictícios).
- Linux e macOS: `bash instalar.sh --demo`.

O instalador confere o Docker, cria o arquivo `.env` com segredos aleatórios e sobe os contêineres. As instruções completas estão no [README.md](README.md).

### Para desenvolver sem Docker

Suba só o banco pelo Compose e rode a API e o app com Node.js 20. O passo a passo está na seção "Desenvolvimento" do [README.md](README.md).

## Estrutura do código

```
server/                          API (Node 20, Express, Prisma, PostgreSQL)
  prisma/schema.prisma           modelo de dados
  src/lib/                       código compartilhado (erros, autenticação, regras)
  src/modules/<modulo>/routes.ts um arquivo de rotas por módulo
client/                          site (React, TypeScript, Vite)
  src/lib/                       código compartilhado (API, autenticação, rotas)
  src/ui/                        componentes visuais e estilo.css
  src/layout/                    casca do app, painel inicial e login
  src/modules/<modulo>/index.tsx telas de cada módulo
```

Cada módulo é uma pasta. O servidor carrega todas as pastas de `server/src/modules/` sozinho, e o cliente carrega todas as pastas de `client/src/modules/` que têm um `index.tsx` exportando `rotas`. Para criar um módulo novo, basta criar a pasta com o arquivo esperado; não é preciso editar uma lista central.

Para a visão completa, veja [docs/ARQUITETURA.md](docs/ARQUITETURA.md). Para as rotas da API, veja [docs/API.md](docs/API.md).

## Convenções

- TypeScript em modo estrito (`strict: true`).
- Nomes de domínio e rotas da API em português (`/contas`, `/faturas/:id/pagar`).
- Não adicione dependência sem necessidade. Antes de instalar um pacote, confirme que a funcionalidade não existe no que já está no projeto.
- Cores só por variáveis de CSS definidas em `client/src/ui/estilo.css`. Não escreva cor fixa em outros arquivos.
- Erros da API devolvem `{ "erro": "mensagem em português" }`, com o status HTTP adequado.
- Telas precisam funcionar em celular, a partir de 360 px de largura.

## Verificação antes do pull request

Rode estes comandos antes de abrir um pull request:

```bash
cd server && npx tsc --noEmit
cd ../client && npx tsc --noEmit
npx vite build
```

O projeto não tem, hoje, testes automatizados. Por isso, descreva no pull request como você testou a mudança.

## Mensagens de commit

- Curtas, no imperativo e em português. Exemplos: `Adiciona filtro por turma no diário`, `Corrige cálculo da frequência`.
- Uma mudança por commit, sempre que possível.

## Fluxo de pull request

1. Crie uma branch a partir de `main`.
2. Faça a mudança e rode a verificação acima.
3. Abra o pull request preenchendo o modelo. Descreva o que mudou, por que e como foi testado.
4. Quando a mudança alterar a tela, inclua prints (antes e depois, se for o caso) e diga se testou no celular.
5. Mantenha a documentação em dia: `docs/API.md` para rotas e `docs/ARQUITETURA.md` para a estrutura.

Ao contribuir, você concorda em seguir o [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
