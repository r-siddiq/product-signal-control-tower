#!/usr/bin/env sh
set -eu

runtime_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

docker compose \
  --project-name product-signal-control-tower \
  --env-file "${runtime_root}/.env" \
  -f "${runtime_root}/compose.yaml" \
  -f "${runtime_root}/compose.otel.yaml" \
  up --detach --wait

test "$(wget -q -O - http://127.0.0.1:5678/healthz/readiness)" != ""
wget -q -O /dev/null http://127.0.0.1:16686/

printf '%s\n' \
  'Observability runtime is ready: n8n http://127.0.0.1:5678 and Jaeger http://127.0.0.1:16686.'
