#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -P "$(dirname "$0")" && pwd)
RUNTIME_ROOT=$(CDPATH= cd -P "${SCRIPT_DIR}/.." && pwd)
PROJECT_NAME=product-signal-control-tower
ENV_FILE="${RUNTIME_ROOT}/.env"
COMPOSE_FILE="${RUNTIME_ROOT}/compose.yaml"
REQUIRED_TOKEN=RESET-SIGNAL-AI-DEMO

printf '%s\n' \
  'Destructive reset target:' \
  "  Project: ${PROJECT_NAME}" \
  '  Services: n8n, postgres' \
  '  Volumes:' \
  '    product-signal-control-tower_n8n_data' \
  '    product-signal-control-tower_postgres_data'

if [ "$#" -ne 1 ] ||
  [ "$1" != '--remove-volumes' ] ||
  [ "${SIGNAL_RESET_CONFIRM:-}" != "${REQUIRED_TOKEN}" ]; then
  printf '%s\n' \
    'Reset not authorized; nothing was changed.' \
    "To authorize this exact destructive action, set SIGNAL_RESET_CONFIRM=${REQUIRED_TOKEN}" \
    'and pass the sole argument --remove-volumes.' >&2
  exit 1
fi

[ -f "${ENV_FILE}" ] || {
  printf 'Reset failed: runtime/.env is missing; no Docker state was changed.\n' >&2
  exit 1
}
[ -f "${COMPOSE_FILE}" ] || {
  printf 'Reset failed: runtime/compose.yaml is missing; no Docker state was changed.\n' >&2
  exit 1
}

exec docker compose \
  --project-name "${PROJECT_NAME}" \
  --env-file "${ENV_FILE}" \
  -f "${COMPOSE_FILE}" \
  down --volumes --remove-orphans
