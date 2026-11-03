#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -P "$(dirname "$0")" && pwd)
RUNTIME_ROOT=$(CDPATH= cd -P "${SCRIPT_DIR}/.." && pwd)
PROJECT_NAME=product-signal-control-tower
ENV_FILE="${RUNTIME_ROOT}/.env"
COMPOSE_FILE="${RUNTIME_ROOT}/compose.yaml"

[ -f "${ENV_FILE}" ] || {
  printf 'Status failed: runtime/.env is missing; run init-env.sh first.\n' >&2
  exit 1
}

exec docker compose \
  --project-name "${PROJECT_NAME}" \
  --env-file "${ENV_FILE}" \
  -f "${COMPOSE_FILE}" \
  ps
