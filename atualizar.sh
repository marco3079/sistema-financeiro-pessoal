#!/usr/bin/env sh
# Atualiza o sistema para o último commit do repositório no GitHub (Linux e Mac).
# Guarda uma cópia do banco, baixa a versão nova e reconstrói os contêineres.
#   sh atualizar.sh
# O botão "Atualizar agora" da tela depende do vigia, que só existe para Windows (atualizar.ps1 -Instalar).
# Aqui a tela avisa que há versão nova e você roda este script.
set -eu
cd "$(dirname "$0")"

mkdir -p atualizacao backups
agora() { date -u +%Y-%m-%dT%H:%M:%SZ; }
estado() { printf '{"situacao":"%s","mensagem":"%s","em":"%s"}\n' "$1" "$2" "$(agora)" > atualizacao/estado.json; }
falhou() { estado ERRO "A atualização falhou. Rode sh atualizar.sh no terminal para ver o erro."; }
trap falhou EXIT

estado ATUALIZANDO "Guardando uma cópia do banco de dados..."
copia="financas-$(date +%Y%m%d-%H%M%S).sql"
docker compose exec -T db pg_dump -U financas -d financas > "backups/$copia"
# Ficam as 5 cópias mais recentes.
ls -1 backups/financas-*.sql 2>/dev/null | sort -r | tail -n +6 | while read -r antigo; do rm -f "$antigo"; done

estado ATUALIZANDO "Baixando a versão nova do GitHub..."
ramo="$(git rev-parse --abbrev-ref HEAD)"
# --ff-only: só avança. Se houver alteração local que conflite, para sem apagar nada.
git pull --ff-only origin "$ramo"

estado ATUALIZANDO "Reconstruindo o sistema..."
docker compose up -d --build

repositorio="$(git remote get-url origin | sed -E 's#.*github\.com[:/]+([^/]+/[^/]+)$#\1#; s#\.git$##; s#/$##')"
printf '{"commit":"%s","data":"%s","mensagem":"","ramo":"%s","repositorio":"%s","gravadoEm":"%s"}\n' \
  "$(git rev-parse HEAD)" "$(git log -1 --format=%cI)" "$ramo" "$repositorio" "$(agora)" > atualizacao/versao.json

trap - EXIT
estado OK "Atualizado. Cópia do banco: $copia"
echo "Pronto. Cópia do banco: backups/$copia"
