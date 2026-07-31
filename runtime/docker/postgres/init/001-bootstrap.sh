#!/usr/bin/env bash
set -Eeuo pipefail

: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${N8N_DB_PASSWORD:?N8N_DB_PASSWORD is required}"
: "${DEMO_DB_PASSWORD:?DEMO_DB_PASSWORD is required}"

psql \
  --username "${POSTGRES_USER}" \
  --dbname "${POSTGRES_DB}" \
  --set=ON_ERROR_STOP=1 \
  --set=n8n_db_password="${N8N_DB_PASSWORD}" \
  --set=demo_db_password="${DEMO_DB_PASSWORD}" <<'SQL'
SELECT format('CREATE ROLE n8n_app LOGIN PASSWORD %L', :'n8n_db_password')
WHERE NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'n8n_app')
\gexec

ALTER ROLE n8n_app WITH LOGIN PASSWORD :'n8n_db_password';

SELECT format('CREATE ROLE signal_app LOGIN PASSWORD %L', :'demo_db_password')
WHERE NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'signal_app')
\gexec

ALTER ROLE signal_app WITH LOGIN PASSWORD :'demo_db_password';

SELECT 'CREATE DATABASE n8n OWNER n8n_app'
WHERE NOT EXISTS (SELECT FROM pg_catalog.pg_database WHERE datname = 'n8n')
\gexec

SELECT 'CREATE DATABASE signal_demo OWNER signal_app'
WHERE NOT EXISTS (
  SELECT FROM pg_catalog.pg_database WHERE datname = 'signal_demo'
)
\gexec

\connect signal_demo
CREATE EXTENSION IF NOT EXISTS vector;
SQL
