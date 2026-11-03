#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -P "$(dirname "$0")" && pwd)
RUNTIME_ROOT=$(CDPATH= cd -P "${SCRIPT_DIR}/.." && pwd)
PROJECT_NAME=product-signal-control-tower
ENV_FILE="${RUNTIME_ROOT}/.env"
COMPOSE_FILE="${RUNTIME_ROOT}/compose.yaml"

die() {
  printf 'Smoke test failed: %s\n' "$1" >&2
  exit 1
}

compose() {
  docker compose \
    --project-name "${PROJECT_NAME}" \
    --env-file "${ENV_FILE}" \
    -f "${COMPOSE_FILE}" \
    "$@"
}

check_n8n_endpoint() {
  endpoint=$1
  compose exec -T n8n node -e '
    const endpoint = process.argv[1];
    fetch(`http://127.0.0.1:5678${endpoint}`)
      .then((response) => {
        if (!response.ok) {
          process.exit(1);
        }
      })
      .catch(() => process.exit(1));
  ' "${endpoint}" >/dev/null ||
    die "n8n endpoint ${endpoint} did not return a successful response."
}

sh "${SCRIPT_DIR}/preflight.sh"

postgres_container_id=$(compose ps -q postgres)
n8n_container_id=$(compose ps -q n8n)
[ -n "${postgres_container_id}" ] ||
  die "the postgres service is not running."
[ -n "${n8n_container_id}" ] ||
  die "the n8n service is not running."

check_n8n_endpoint /healthz
check_n8n_endpoint /healthz/readiness

compose exec -T postgres sh -eu -s <<'CONTAINER_SH' >/dev/null
pg_isready -h 127.0.0.1 -U "${POSTGRES_USER}" -d "${POSTGRES_DB}"

test "$(psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -Atqc \
  "SELECT count(*) = 2 FROM pg_database WHERE datname IN ('n8n', 'signal_demo');")" = "t"

test "$(psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -Atqc \
  "SELECT count(*) = 2 FROM pg_roles WHERE rolname IN ('n8n_app', 'signal_app');")" = "t"

test "$(PGPASSWORD="${N8N_DB_PASSWORD}" psql -h 127.0.0.1 -U n8n_app -d n8n -Atqc \
  "SELECT current_user || '|' || current_database();")" = "n8n_app|n8n"

test "$(PGPASSWORD="${DEMO_DB_PASSWORD}" psql -h 127.0.0.1 -U signal_app -d signal_demo -Atqc \
  "SELECT current_user || '|' || current_database();")" = "signal_app|signal_demo"

test "$(PGPASSWORD="${DEMO_DB_PASSWORD}" psql -h 127.0.0.1 -U signal_app -d signal_demo -Atqc \
  "SELECT extname FROM pg_extension WHERE extname = 'vector';")" = "vector"

test "$(PGPASSWORD="${DEMO_DB_PASSWORD}" psql -h 127.0.0.1 -U signal_app -d signal_demo -Atqc \
  "SELECT '[1,2,3]'::vector <-> '[1,2,4]'::vector;")" = "1"
CONTAINER_SH

[ -z "$(docker port "${postgres_container_id}" 2>/dev/null)" ] ||
  die "PostgreSQL has a published host port; it must remain private to the Compose network."

[ "$(docker port "${n8n_container_id}" 5678/tcp 2>/dev/null)" = '127.0.0.1:5678' ] ||
  die "n8n is not published exclusively on host loopback 127.0.0.1:5678."

printf 'Smoke test passed: n8n is ready, both databases and roles are usable, vector works, and port exposure is constrained.\n'
