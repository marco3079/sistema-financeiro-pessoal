#!/usr/bin/env bash
# Instalador do Sistema Financeiro Pessoal para Linux e macOS.
# Uso: bash instalar.sh [--porta-web N] [--porta-api N] [--sem-perguntas]
# Codigos de saida: 0 = ok; 2 = Docker nao instalado; 3 = Docker parado ou sem Compose;
#                   4 = falha ao subir os conteineres; 5 = API nao respondeu;
#                   6 = existe o banco de uma instalacao anterior, mas nao ha .env com a senha dele.

set -euo pipefail

PORTA_WEB=8092
PORTA_API=3092
SEM_PERGUNTAS=0
ESCOLHIDA=""

while [ $# -gt 0 ]; do
  case "$1" in
    --porta-web)
      PORTA_WEB="${2:?informe o numero da porta web}"
      shift
      ;;
    --porta-api)
      PORTA_API="${2:?informe o numero da porta da API}"
      shift
      ;;
    --sem-perguntas)
      SEM_PERGUNTAS=1
      ;;
    -h|--help)
      echo "Uso: bash instalar.sh [--porta-web N] [--porta-api N] [--sem-perguntas]"
      exit 0
      ;;
    *)
      echo "Opcao desconhecida: $1"
      echo "Uso: bash instalar.sh [--porta-web N] [--porta-api N] [--sem-perguntas]"
      exit 1
      ;;
  esac
  shift
done

for valor in "$PORTA_WEB" "$PORTA_API"; do
  case "$valor" in
    ''|*[!0-9]*)
      echo "Porta invalida: $valor"
      exit 1
      ;;
  esac
done

perguntar_sim() {
  # $1 = pergunta. Retorna 0 para sim. Sem terminal e sem --sem-perguntas, responde nao.
  if [ "$SEM_PERGUNTAS" -eq 1 ]; then
    return 0
  fi
  if [ ! -t 0 ]; then
    return 1
  fi
  local resposta=""
  read -r -p "$1 [S/n] " resposta || resposta="n"
  case "$resposta" in
    ''|[sSyY]*) return 0 ;;
    *) return 1 ;;
  esac
}

gerar_segredo() {
  # $1 = tamanho. Letras e numeros aleatorios.
  LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$1" || true
}

ler_variavel() {
  # $1 = arquivo, $2 = nome da variavel. Imprime o valor (ou nada).
  local linha
  linha=$(grep -E "^[[:space:]]*$2[[:space:]]*=" "$1" | tail -n 1 || true)
  linha=${linha#*=}
  printf '%s' "$linha" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'
}

porta_ocupada() {
  # Retorna 0 se algo estiver escutando na porta.
  (echo >/dev/tcp/127.0.0.1/"$1") 2>/dev/null
}

escolher_porta() {
  # $1 = porta inicial, $2 = porta a evitar. Resultado em ESCOLHIDA.
  local porta="$1"
  local tentativa=0
  while [ "$tentativa" -lt 20 ]; do
    if [ "$porta" != "$2" ] && ! porta_ocupada "$porta"; then
      if [ "$porta" != "$1" ]; then
        echo "Porta $1 em uso. Usando a porta $porta."
      fi
      ESCOLHIDA="$porta"
      return 0
    fi
    porta=$((porta + 1))
    tentativa=$((tentativa + 1))
  done
  echo "Nenhuma porta livre encontrada a partir de $1."
  exit 1
}

obter_nome_projeto() {
  # Nome do projeto Compose (campo "name" de docker compose config); se nao der, deriva da pasta.
  local nome=""
  nome=$(docker compose config --format json 2>/dev/null | sed -n 's/^{"name":"\([^"]*\)".*/\1/p' | head -n 1 || true)
  if [ -z "$nome" ]; then
    nome=$(basename "$PASTA_PROJETO" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-')
  fi
  printf '%s' "$nome"
}

existe_volume() {
  # $1 = nome exato do volume. Retorna 0 se existir (o filtro do docker faz busca parcial).
  local volume
  while IFS= read -r volume; do
    if [ "$volume" = "$1" ]; then
      return 0
    fi
  done < <(docker volume ls -q --filter "name=$1" 2>/dev/null || true)
  return 1
}

obter_ip() {
  local ip=""
  if [ "$(uname -s)" = "Linux" ]; then
    ip=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
  elif [ "$(uname -s)" = "Darwin" ]; then
    ip=$(ipconfig getifaddr en0 2>/dev/null || true)
  fi
  if [ -z "$ip" ]; then
    ip="<IP do computador>"
  fi
  printf '%s' "$ip"
}

# [1/6] Pasta do script
echo "[1/6] Indo para a pasta do projeto..."
cd -- "$(dirname -- "$0")"
PASTA_PROJETO=$(pwd)
ARQ_ENV="$PASTA_PROJETO/.env"
ENV_EXISTE=0
if [ -f "$ARQ_ENV" ]; then
  ENV_EXISTE=1
fi
ENV_CRIADO_AGORA=0
SENHA_ADMIN=""
ADMIN_EMAIL="demo@financas.local"
ADMIN_SENHA_EXISTENTE=""

# [2/6] Docker instalado
echo "[2/6] Verificando o Docker..."
if ! docker --version >/dev/null 2>&1; then
  echo "O Docker e necessario para rodar o sistema, e ele nao foi encontrado."
  if [ "$(uname -s)" = "Darwin" ]; then
    if command -v brew >/dev/null 2>&1; then
      if perguntar_sim "Instalar o Docker Desktop agora com o Homebrew (brew install --cask docker)?"; then
        brew install --cask docker || echo "O Homebrew nao conseguiu instalar o Docker Desktop."
      fi
    fi
    echo "Depois de instalar: abra o Docker Desktop, espere ele iniciar e rode este script de novo."
    echo "Guia oficial: https://www.docker.com/products/docker-desktop/"
    exit 2
  fi
  echo "Comando oficial para instalar o Docker no Linux:"
  echo "  curl -fsSL https://get.docker.com | sh"
  if perguntar_sim "Executar esse comando agora (pode pedir a senha de administrador)?"; then
    curl -fsSL https://get.docker.com | sh || echo "A instalacao do Docker nao terminou com sucesso."
  fi
  if ! docker --version >/dev/null 2>&1; then
    echo "Docker ainda nao disponivel. Instale o Docker e rode este script de novo."
    echo "Guia oficial: https://docs.docker.com/get-docker/"
    exit 2
  fi
fi

# [3/6] Docker rodando e com Compose
echo "[3/6] Verificando se o Docker esta rodando..."
if ! docker info >/dev/null 2>&1; then
  echo "O Docker esta instalado, mas nao esta rodando."
  echo "Abra o Docker, espere ele iniciar e rode este script de novo."
  echo "(No Linux, se o erro falar em permissao, rode com sudo ou inclua seu usuario no grupo docker.)"
  exit 3
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose nao encontrado. Atualize o Docker e rode este script de novo."
  exit 3
fi

# [4/6] Portas
echo "[4/6] Verificando as portas..."
if [ "$ENV_EXISTE" -eq 1 ]; then
  LIDA_WEB=$(ler_variavel "$ARQ_ENV" WEB_PORT)
  LIDA_API=$(ler_variavel "$ARQ_ENV" API_PORT)
  PORTA_WEB_FINAL=8092
  PORTA_API_FINAL=3092
  case "$LIDA_WEB" in
    ''|*[!0-9]*) ;;
    *) PORTA_WEB_FINAL="$LIDA_WEB" ;;
  esac
  case "$LIDA_API" in
    ''|*[!0-9]*) ;;
    *) PORTA_API_FINAL="$LIDA_API" ;;
  esac
  echo "Usando as portas do .env existente."
  if porta_ocupada "$PORTA_WEB_FINAL"; then
    echo "Aviso: a porta $PORTA_WEB_FINAL ja esta em uso (se for o proprio sistema rodando, pode ignorar)."
  fi
  if porta_ocupada "$PORTA_API_FINAL"; then
    echo "Aviso: a porta $PORTA_API_FINAL ja esta em uso (se for o proprio sistema rodando, pode ignorar)."
  fi
else
  escolher_porta "$PORTA_WEB" 0
  PORTA_WEB_FINAL="$ESCOLHIDA"
  escolher_porta "$PORTA_API" "$PORTA_WEB_FINAL"
  PORTA_API_FINAL="$ESCOLHIDA"
fi

# [5/6] Arquivo .env
echo "[5/6] Preparando o arquivo .env..."
if [ "$ENV_EXISTE" -eq 1 ]; then
  echo "Usando o .env existente."
  EMAIL_LIDO=$(ler_variavel "$ARQ_ENV" ADMIN_EMAIL)
  if [ -n "$EMAIL_LIDO" ]; then
    ADMIN_EMAIL="$EMAIL_LIDO"
  fi
  ADMIN_SENHA_EXISTENTE=$(ler_variavel "$ARQ_ENV" ADMIN_SENHA)
else
  # Um banco de uma instalacao anterior nao aceita senha nova: para antes de criar o .env.
  VOLUME_BANCO="$(obter_nome_projeto)_dados_db"
  if existe_volume "$VOLUME_BANCO"; then
    echo "Ja existe um banco de dados desta instalacao (volume $VOLUME_BANCO), mas nao ha arquivo .env com a senha dele."
    echo "Saidas possiveis:"
    echo "  (a) Recoloque o arquivo .env antigo nesta pasta e rode este script de novo."
    echo "  (b) Se o banco antigo puder ser apagado (isso apaga todos os dados), rode: docker compose down -v"
    echo "      e depois rode este script de novo."
    echo "Nada foi apagado e o .env nao foi criado."
    exit 6
  fi
  SENHA_BANCO=$(gerar_segredo 24)
  SEGREDO_JWT=$(gerar_segredo 48)
  SENHA_ADMIN="demo1234"
  (
    umask 077
    cat > "$ARQ_ENV" <<EOF
# Gerado pelo instalar.sh. Nao envie este arquivo para o Git.
POSTGRES_PASSWORD=$SENHA_BANCO
JWT_SECRET=$SEGREDO_JWT
ADMIN_NOME=Demo
ADMIN_EMAIL=$ADMIN_EMAIL
ADMIN_SENHA=$SENHA_ADMIN
WEB_PORT=$PORTA_WEB_FINAL
API_PORT=$PORTA_API_FINAL
DB_PORT=5434
EOF
  )
  ENV_CRIADO_AGORA=1
  echo "Arquivo .env criado com segredos aleatorios."
fi

# [6/6] Subir os conteineres e esperar a API
echo "[6/6] Subindo os conteineres (na primeira vez o Docker baixa as dependencias, pode demorar)..."
if ! docker compose up -d --build; then
  echo "Falha ao subir os conteineres. Ultimas linhas do log:"
  docker compose logs --tail 40 || true
  exit 4
fi

URL_SAUDE="http://localhost:$PORTA_API_FINAL/api/saude"
echo "Aguardando a API responder em $URL_SAUDE (ate 180 segundos)..."
PRONTO=0
TENTATIVA=0
while [ "$TENTATIVA" -lt 60 ]; do
  if command -v curl >/dev/null 2>&1; then
    if curl -fsS -m 5 "$URL_SAUDE" >/dev/null 2>&1; then
      PRONTO=1
      break
    fi
  else
    if docker compose exec -T api node -e "fetch('http://localhost:3000/api/saude').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
      PRONTO=1
      break
    fi
  fi
  sleep 3
  TENTATIVA=$((TENTATIVA + 1))
done
if [ "$PRONTO" -ne 1 ]; then
  echo "A API nao respondeu a tempo. Ultimas linhas do log da API:"
  docker compose logs --tail 40 api || true
  exit 5
fi

# Quadro final
if [ "$ENV_CRIADO_AGORA" -eq 1 ] || [ -z "$ADMIN_SENHA_EXISTENTE" ] || [ "$ADMIN_SENHA_EXISTENTE" = "demo1234" ]; then
  LINHA_SENHA='Senha:          demo1234 (padrao; troque em "Meu perfil")'
else
  LINHA_SENHA="Senha:          a senha esta no arquivo .env, variavel ADMIN_SENHA"
fi
IP_COMPUTADOR=$(obter_ip)

echo ""
echo "============================================================"
echo " Sistema financeiro pessoal instalado e no ar"
echo "============================================================"
echo "Site:           http://localhost:$PORTA_WEB_FINAL"
echo "Titular:        $ADMIN_EMAIL"
echo "$LINHA_SENHA"
echo 'Troque a senha em "Meu perfil" depois do primeiro acesso.'
echo ""
echo "No celular (mesma rede Wi-Fi): http://$IP_COMPUTADOR:$PORTA_WEB_FINAL"
echo ""
echo "Parar o sistema:           docker compose down"
echo "Apagar tudo (inclui banco): docker compose down -v"
echo "============================================================"
exit 0
