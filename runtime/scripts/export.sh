#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -P "$(dirname "$0")" && pwd)
RUNTIME_ROOT=$(CDPATH= cd -P "${SCRIPT_DIR}/.." && pwd)
WORKSPACE_ROOT=$(CDPATH= cd -P "${RUNTIME_ROOT}/.." && pwd)
PROJECT_NAME=product-signal-control-tower
ENV_FILE="${RUNTIME_ROOT}/.env"
COMPOSE_FILE="${RUNTIME_ROOT}/compose.yaml"
GITIGNORE_FILE="${WORKSPACE_ROOT}/.gitignore"
TIMESTAMP=$(date -u '+%Y%m%dT%H%M%SZ')
EXPORT_ROOT="${RUNTIME_ROOT}/exports"
EXPORT_DIR="${EXPORT_ROOT}/${TIMESTAMP}"
REMOTE_DIR="/tmp/signal-export-${TIMESTAMP}"

die() {
  printf 'Export failed: %s\n' "$1" >&2
  exit 1
}

compose() {
  docker compose \
    --project-name "${PROJECT_NAME}" \
    --env-file "${ENV_FILE}" \
    -f "${COMPOSE_FILE}" \
    "$@"
}

[ -f "${ENV_FILE}" ] ||
  die "runtime/.env is missing; run init-env.sh first."
[ -f "${GITIGNORE_FILE}" ] &&
  grep -Eq '^/?runtime/exports/$' "${GITIGNORE_FILE}" ||
  die "the workspace .gitignore does not protect runtime/exports/."

sh "${SCRIPT_DIR}/preflight.sh"

n8n_container_id=$(compose ps -q n8n)
[ -n "${n8n_container_id}" ] ||
  die "the n8n service is not running."

umask 077
mkdir -p "${EXPORT_ROOT}"
mkdir "${EXPORT_DIR}" ||
  die "the timestamped export directory already exists."
chmod 700 "${EXPORT_DIR}"

remote_created=0
cleanup_remote() {
  if [ "${remote_created}" -eq 1 ]; then
    compose exec -T -u node n8n sh -eu -c \
      'rm -f "$1/workflows.json" "$1/credentials.encrypted.json"; rmdir "$1"' \
      sh "${REMOTE_DIR}" >/dev/null 2>&1 || :
  fi
}
trap cleanup_remote 0 1 2 3 15

compose exec -T -u node n8n \
  sh -eu -c 'mkdir "$1"' sh "${REMOTE_DIR}"
remote_created=1

credential_count=$(compose exec -T postgres \
  psql -X -v ON_ERROR_STOP=1 -U postgres -d n8n -Atqc \
  'SELECT count(*) FROM credentials_entity;' |
  tr -d '\r\n')
case "${credential_count}" in
  ''|*[!0-9]*)
    die "could not determine the credential count before export."
    ;;
esac

compose exec -T -u node n8n sh -eu -c '
  destination=$1
  n8n export:workflow --all --output="${destination}/workflows.json" >/dev/null
' sh "${REMOTE_DIR}"

if [ "${credential_count}" -eq 0 ]; then
  compose exec -T -u node n8n sh -eu -c \
    'printf "[]\n" > "$1/credentials.encrypted.json"' sh "${REMOTE_DIR}"
else
  compose exec -T -u node n8n sh -eu -c \
    'n8n export:credentials --all --output="$1/credentials.encrypted.json" >/dev/null' \
    sh "${REMOTE_DIR}"
fi

docker cp \
  "${n8n_container_id}:${REMOTE_DIR}/workflows.json" \
  "${EXPORT_DIR}/workflows.json" >/dev/null
docker cp \
  "${n8n_container_id}:${REMOTE_DIR}/credentials.encrypted.json" \
  "${EXPORT_DIR}/credentials.encrypted.json" >/dev/null
[ -s "${EXPORT_DIR}/workflows.json" ] ||
  die "the workflow export is missing or empty."
[ -s "${EXPORT_DIR}/credentials.encrypted.json" ] ||
  die "the encrypted credential export is missing or empty."
chmod 600 \
  "${EXPORT_DIR}/workflows.json" \
  "${EXPORT_DIR}/credentials.encrypted.json"

printf 'Export completed: %s\n' "${EXPORT_DIR}"
printf 'The credential export remains sensitive even though its values are encrypted; protect it and retain the matching N8N_ENCRYPTION_KEY separately.\n'
