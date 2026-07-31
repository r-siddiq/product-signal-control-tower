#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -P "$(dirname "$0")" && pwd)
RUNTIME_ROOT=$(CDPATH= cd -P "${SCRIPT_DIR}/.." && pwd)
WORKSPACE_ROOT=$(CDPATH= cd -P "${RUNTIME_ROOT}/.." && pwd)
ENV_FILE="${RUNTIME_ROOT}/.env"
EXAMPLE_FILE="${RUNTIME_ROOT}/.env.example"
GITIGNORE_FILE="${WORKSPACE_ROOT}/.gitignore"

die() {
  printf 'Environment initialization failed: %s\n' "$1" >&2
  exit 1
}

generate_hex() {
  if command -v openssl >/dev/null 2>&1; then
    generated_value=$(openssl rand -hex 32)
  elif [ -r /dev/urandom ] && command -v od >/dev/null 2>&1; then
    generated_value=$(od -An -N 32 -tx1 /dev/urandom | tr -d '[:space:]')
  else
    die "no cryptographically secure generator is available; install openssl or provide /dev/urandom and od."
  fi

  case "${generated_value}" in
    *[!0123456789abcdef]*)
      die "the secure generator returned an invalid value."
      ;;
  esac
  [ "${#generated_value}" -eq 64 ] ||
    die "the secure generator returned an unexpected number of bytes."
  printf '%s\n' "${generated_value}"
}

[ ! -e "${ENV_FILE}" ] ||
  die "runtime/.env already exists; refusing to overwrite it."
[ -f "${EXAMPLE_FILE}" ] ||
  die "runtime/.env.example is missing."
[ -f "${GITIGNORE_FILE}" ] ||
  die "the workspace .gitignore is missing."
grep -Eq '^(\.env|\*\*/\.env|runtime/\.env|/runtime/\.env)$' "${GITIGNORE_FILE}" ||
  die "the workspace .gitignore does not protect runtime/.env."
for required_key in \
  POSTGRES_PASSWORD \
  N8N_DB_PASSWORD \
  DEMO_DB_PASSWORD \
  N8N_ENCRYPTION_KEY
do
  [ "$(grep -Ec "^${required_key}=" "${EXAMPLE_FILE}")" -eq 1 ] ||
    die "runtime/.env.example must define ${required_key} exactly once."
done

umask 077
POSTGRES_PASSWORD=$(generate_hex)
N8N_DB_PASSWORD=$(generate_hex)
DEMO_DB_PASSWORD=$(generate_hex)
N8N_ENCRYPTION_KEY=$(generate_hex)

created_env=0
cleanup_partial_env() {
  if [ "${created_env}" -eq 1 ]; then
    rm -f "${ENV_FILE}"
  fi
}
trap cleanup_partial_env 0 1 2 3 15

if (set -C; : >"${ENV_FILE}") 2>/dev/null; then
  created_env=1
else
  die "runtime/.env appeared during initialization; refusing to overwrite it."
fi

{
  printf 'POSTGRES_PASSWORD=%s\n' "${POSTGRES_PASSWORD}"
  printf 'N8N_DB_PASSWORD=%s\n' "${N8N_DB_PASSWORD}"
  printf 'DEMO_DB_PASSWORD=%s\n' "${DEMO_DB_PASSWORD}"
  printf 'N8N_ENCRYPTION_KEY=%s\n' "${N8N_ENCRYPTION_KEY}"
} >"${ENV_FILE}"
chmod 600 "${ENV_FILE}"

unset POSTGRES_PASSWORD N8N_DB_PASSWORD DEMO_DB_PASSWORD N8N_ENCRYPTION_KEY
created_env=0
trap - 0 1 2 3 15

printf 'Created protected environment file: %s\n' "${ENV_FILE}"
