#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -P "$(dirname "$0")" && pwd)
RUNTIME_ROOT=$(CDPATH= cd -P "${SCRIPT_DIR}/.." && pwd)
PROJECT_NAME=signal-ai-demo
ENV_FILE="${RUNTIME_ROOT}/.env"
COMPOSE_FILE="${RUNTIME_ROOT}/compose.yaml"
BOOTSTRAP_FILE="${RUNTIME_ROOT}/docker/postgres/init/001-bootstrap.sh"
N8N_IMAGE='docker.n8n.io/n8nio/n8n:2.32.6@sha256:5f7856f4fc7cd935230f7596e39fdb3d5eda0e379c5b40b699b9c0eb35ebd0bf'
POSTGRES_IMAGE='docker.io/pgvector/pgvector:0.8.6-pg17-bookworm@sha256:7ae6051efd0e60444282c27c7e141af07f322ce033300e727a49c3dd11075e38'

die() {
  printf 'Preflight failed: %s\n' "$1" >&2
  exit 1
}

compose() {
  docker compose \
    --project-name "${PROJECT_NAME}" \
    --env-file "${ENV_FILE}" \
    -f "${COMPOSE_FILE}" \
    "$@"
}

validate_secret() {
  secret_name=$1
  awk -F= -v target="${secret_name}" '
    $1 == target {
      count++
      value = substr($0, index($0, "=") + 1)
    }
    END {
      gsub(/^[[:space:]]+/, "", value)
      gsub(/[[:space:]]+$/, "", value)
      upper = toupper(value)
      placeholder = (
        upper ~ /GENERATE_LOCAL/ ||
        upper ~ /REPLACE_WITH/ ||
        upper ~ /PLACEHOLDER/ ||
        upper ~ /CHANGE_ME/ ||
        upper ~ /CHANGEME/ ||
        upper ~ /YOUR_[A-Z0-9_]*_HERE/
      )
      if (count != 1 || value == "" || placeholder) {
        exit 1
      }
    }
  ' "${ENV_FILE}" >/dev/null 2>&1 ||
    die "${secret_name} must occur exactly once with a nonempty, non-placeholder value in runtime/.env."
}

port_5678_is_listening() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null |
      awk 'NR > 1 && $4 ~ /(^|[.:])5678$/ { found = 1 } END { exit(found ? 0 : 1) }'
    return
  fi

  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:5678 -sTCP:LISTEN >/dev/null 2>&1
    return
  fi

  if command -v netstat >/dev/null 2>&1; then
    netstat -an 2>/dev/null |
      awk 'toupper($0) ~ /LISTEN/ && $0 ~ /[.:]5678[[:space:]]/ { found = 1 } END { exit(found ? 0 : 1) }'
    return
  fi

  die "cannot inspect port 5678; install ss, lsof, or netstat and retry."
}

exact_project_n8n_owns_port() {
  n8n_container_ids=$(docker ps -q \
    --filter "label=com.docker.compose.project=${PROJECT_NAME}" \
    --filter 'label=com.docker.compose.service=n8n')
  all_publishing_ids=$(docker ps -q --filter 'publish=5678')

  [ -n "${n8n_container_ids}" ] || return 1
  [ "${n8n_container_ids}" = "${all_publishing_ids}" ] || return 1
  [ "$(docker port "${n8n_container_ids}" 5678/tcp 2>/dev/null)" = '127.0.0.1:5678' ]
}

command -v docker >/dev/null 2>&1 ||
  die "Docker is not installed or is not on PATH."

docker info >/dev/null 2>&1 ||
  die "the Docker daemon is unavailable; start Docker and retry."

[ "$(docker info --format '{{.OSType}}' 2>/dev/null)" = 'linux' ] ||
  die "the active Docker engine is not using Linux containers."

compose_version=$(docker compose version --short 2>/dev/null) ||
  die "the Docker Compose v2 plugin is unavailable; install it and retry."
[ -n "${compose_version}" ] ||
  die "the Docker Compose v2 plugin did not report a version."

[ -f "${COMPOSE_FILE}" ] ||
  die "runtime/compose.yaml is missing."
[ -f "${ENV_FILE}" ] ||
  die "runtime/.env is missing; run init-env.sh first."
[ -f "${BOOTSTRAP_FILE}" ] ||
  die "runtime/docker/postgres/init/001-bootstrap.sh is missing."

validate_secret POSTGRES_PASSWORD
validate_secret N8N_DB_PASSWORD
validate_secret DEMO_DB_PASSWORD
validate_secret N8N_ENCRYPTION_KEY

umask 077
rendered_config_dir="${TMPDIR:-/tmp}/signal-compose.$$"
mkdir "${rendered_config_dir}" 2>/dev/null ||
  die "could not create a private temporary directory for Compose validation."
rendered_config="${rendered_config_dir}/config.yaml"
cleanup() {
  rm -f "${rendered_config}"
  rmdir "${rendered_config_dir}" 2>/dev/null || :
}
trap cleanup 0 1 2 3 15

compose config >"${rendered_config}" 2>/dev/null ||
  die "runtime/compose.yaml did not render successfully."

awk -v n8n_image="${N8N_IMAGE}" -v postgres_image="${POSTGRES_IMAGE}" '
  $1 == "image:" {
    image_count++
    if ($2 == n8n_image) {
      n8n_count++
    }
    if ($2 == postgres_image) {
      postgres_count++
    }
  }
  END {
    if (image_count != 2 || n8n_count != 1 || postgres_count != 1) {
      exit 1
    }
  }
' "${rendered_config}" ||
  die "rendered Compose configuration does not contain exactly the two approved immutable image references."

if port_5678_is_listening && ! exact_project_n8n_owns_port; then
  die "host port 5678 is already in use by something other than this project's n8n service."
fi

printf 'Preflight passed for project %s.\n' "${PROJECT_NAME}"
