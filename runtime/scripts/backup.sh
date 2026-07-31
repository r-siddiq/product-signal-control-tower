#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -P "$(dirname "$0")" && pwd)
RUNTIME_ROOT=$(CDPATH= cd -P "${SCRIPT_DIR}/.." && pwd)
WORKSPACE_ROOT=$(CDPATH= cd -P "${RUNTIME_ROOT}/.." && pwd)
PROJECT_NAME=signal-ai-demo
ENV_FILE="${RUNTIME_ROOT}/.env"
COMPOSE_FILE="${RUNTIME_ROOT}/compose.yaml"
GITIGNORE_FILE="${WORKSPACE_ROOT}/.gitignore"
TIMESTAMP=$(date -u '+%Y%m%dT%H%M%SZ')
BACKUP_ROOT="${RUNTIME_ROOT}/backups"
BACKUP_DIR="${BACKUP_ROOT}/${TIMESTAMP}"

die() {
  printf 'Backup failed: %s\n' "$1" >&2
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
  grep -Eq '^/?runtime/backups/$' "${GITIGNORE_FILE}" ||
  die "the workspace .gitignore does not protect runtime/backups/."

sh "${SCRIPT_DIR}/preflight.sh"

postgres_container_id=$(compose ps -q postgres)
n8n_container_id=$(compose ps -q n8n)
[ -n "${postgres_container_id}" ] ||
  die "the postgres service is not running."
[ -n "${n8n_container_id}" ] ||
  die "the n8n service is not running."

umask 077
mkdir -p "${BACKUP_ROOT}"
mkdir "${BACKUP_DIR}" ||
  die "the timestamped backup directory already exists."
chmod 700 "${BACKUP_DIR}"

compose exec -T postgres \
  pg_dump -U postgres -d n8n --format=custom \
  >"${BACKUP_DIR}/n8n.dump.partial"
mv "${BACKUP_DIR}/n8n.dump.partial" "${BACKUP_DIR}/n8n.dump"

compose exec -T postgres \
  pg_dump -U postgres -d signal_demo --format=custom \
  >"${BACKUP_DIR}/signal_demo.dump.partial"
mv \
  "${BACKUP_DIR}/signal_demo.dump.partial" \
  "${BACKUP_DIR}/signal_demo.dump"

compose exec -T postgres \
  pg_dumpall -U postgres --roles-only --no-role-passwords \
  >"${BACKUP_DIR}/roles.sql.partial"
mv "${BACKUP_DIR}/roles.sql.partial" "${BACKUP_DIR}/roles.sql"

for artifact in n8n.dump signal_demo.dump roles.sql
do
  [ -s "${BACKUP_DIR}/${artifact}" ] ||
    die "${artifact} is missing or empty."
done

n8n_image=$(docker inspect --format '{{.Config.Image}}' "${n8n_container_id}")
postgres_image=$(docker inspect --format '{{.Config.Image}}' "${postgres_container_id}")
n8n_version=$(compose exec -T n8n n8n --version | tr -d '\r\n')
postgres_version=$(compose exec -T postgres postgres --version | tr -d '\r\n')
vector_version=$(compose exec -T postgres \
  psql -X -v ON_ERROR_STOP=1 -U postgres -d signal_demo -Atqc \
  "SELECT extversion FROM pg_extension WHERE extname = 'vector';" |
  tr -d '\r\n')
[ -n "${vector_version}" ] ||
  die "the pgvector extension version could not be recorded."

{
  printf 'created_utc=%s\n' "${TIMESTAMP}"
  printf 'compose_project=%s\n' "${PROJECT_NAME}"
  printf 'n8n_image=%s\n' "${n8n_image}"
  printf 'n8n_version=%s\n' "${n8n_version}"
  printf 'postgres_image=%s\n' "${postgres_image}"
  printf 'postgres_version=%s\n' "${postgres_version}"
  printf 'pgvector_extension_version=%s\n' "${vector_version}"
  printf 'contents=n8n.dump,signal_demo.dump,roles.sql\n'
  printf 'roles_passwords_included=false\n'
  printf 'environment_file_included=false\n'
  printf 'encryption_key_included=false\n'
  printf 'n8n_data_volume_included=false\n'
} >"${BACKUP_DIR}/manifest.txt"

cat >"${BACKUP_DIR}/RECOVERY-WARNING.txt" <<'EOF'
This logical backup excludes runtime/.env, N8N_ENCRYPTION_KEY, and filesystem
binary data in n8n_data. Preserve the matching encryption key separately or
restored n8n credentials will be unreadable.
EOF

[ -s "${BACKUP_DIR}/manifest.txt" ] &&
  [ -s "${BACKUP_DIR}/RECOVERY-WARNING.txt" ] ||
  die "backup metadata is missing or empty."

printf 'Logical database backup completed: %s\n' "${BACKUP_DIR}"
printf 'Important: runtime/.env and N8N_ENCRYPTION_KEY were not copied. Preserve the matching encryption key separately or restored n8n credentials will be unreadable.\n'
printf 'Filesystem-mode binary data in the n8n_data volume is not included in this logical database backup.\n'
