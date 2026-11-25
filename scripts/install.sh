#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
origin="${1:-}"
probe_url="${2:-}"

if [[ ! "$origin" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]]; then
  printf 'Uso: %s https://checkout.exemplo.com [https://servico-de-ip.exemplo/]\n' "$0" >&2
  exit 1
fi
if [[ -n "$probe_url" && ! "$probe_url" =~ ^https://[^[:space:]#]+$ ]]; then
  printf 'Informe uma URL HTTPS válida para a consulta de IP.\n' >&2
  exit 1
fi
if [[ "$probe_url" == *"'"* || "$probe_url" == *'@'* || "$probe_url" == *'\'* ]]; then
  printf 'Informe uma URL do serviço de IP sem credenciais ou caracteres de escape.\n' >&2
  exit 1
fi
if [[ -e .env ]]; then
  printf 'O arquivo .env já existe. Use o procedimento de atualização do README.\n' >&2
  exit 1
fi
if [[ ! -s infra/tls/fullchain.pem || ! -s infra/tls/privkey.pem ]]; then
  printf 'Disponibilize o certificado TLS e a chave em infra/tls antes de instalar.\n' >&2
  exit 1
fi

docker compose version >/dev/null
database_secret="$(openssl rand -hex 32)"
link_secret="$(openssl rand -base64 32)"
connect_secret="$(openssl rand -hex 32)"
rede_secret="$(openssl rand -base64 32)"
(
  umask 077
  set -o noclobber
  {
    printf 'APP_ORIGIN=%s\nPOSTGRES_PASSWORD=%s\nLINK_ENCRYPTION_KEY=%s\nCONNECT_TOKEN=%s\n' \
      "$origin" "$database_secret" "$link_secret" "$connect_secret"
    printf 'CONNECT_REDE_KEY=%s\n' "$rede_secret"
    printf 'CONNECT_URL=http://connect:3400\nCONNECT_PRIVATE_HTTP=true\nCOMPOSE_PROFILES=connect\n'
    if [[ -n "$probe_url" ]]; then printf "EGRESS_PROBE_URL='%s'\n" "$probe_url"; fi
  } > .env
)
unset database_secret link_secret connect_secret rede_secret
docker compose up -d --build --wait
docker compose exec -T app node backend/src/cli.js issue-setup
