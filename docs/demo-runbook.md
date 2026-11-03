# Local Demo Runbook

This guide describes a synthetic, isolated demonstration. It is intended for a local n8n, PostgreSQL/pgvector, and Jaeger stack.

## Data flow

The main n8n workflow accepts synthetic product feedback, normalizes and minimizes it, checks for replay, and validates structured model extraction. It retrieves reviewed evidence from PostgreSQL, creates an evidence-backed brief, then pauses at a human-review wait. Approval records a decision and an outbox entry; rejection records a separate decision. The error workflow sanitizes unexpected errors. OpenTelemetry traces workflow and node activity for Jaeger inspection.

## Initialize and start

Use Node.js/npm and Docker Compose. From the repository root:

```powershell
npm ci --ignore-scripts --no-audit --fund=false
npx playwright install chromium
node tools/init-local-env.mjs
./runtime/scripts/init-env.ps1
./runtime/scripts/start.ps1
node tools/apply-migrations.mjs --dry-run
node tools/apply-migrations.mjs
```

The optional Node initializer creates the root `.env` only when it does not already exist. The runtime initializer creates local database and n8n settings. The migration helper previews the ordered batch and applies it to the isolated `signal_demo` database in one transaction with a checksum ledger; it refuses a repeat application and has no reset option. Use a fresh demo database, not a database containing user data.

## Configure n8n

Create the local n8n owner in the UI. Copy `runtime/.n8n-api.env.example` and `runtime/.owner.env.example` to their matching local files and fill them in locally. Configure a PostgreSQL credential named `Signal Demo Postgres` for host `postgres`, port `5432`, database `signal_demo`, and user `signal_app`; use the local `DEMO_DB_PASSWORD` from `runtime/.env`. Configure the model-provider credential in n8n using a locally supplied API key.

Import workflows inactive, review the selected n8n instance, then activate explicitly if you choose to run them:

```powershell
node tools/import-local-workflows.mjs
node tools/import-local-workflows.mjs --activate
```

## Observe and run

Start the local tracing stack, run the configured demo preflight, and exercise the browser review path:

```powershell
./runtime/scripts/start-observability.ps1
npm run demo:check
node tools/run-playwright-demo.mjs --mode headless --scenarios invalid,replay,reject,approve
```

The standalone demo uses the provider credential configured in n8n. The current mock-run record describes a separate isolated test instance where only the test workflows' model endpoints were redirected to a local structured mock.

## Validation and evidence

Focused checks cover workflow generation, deterministic stubs, input minimization, fixture contracts, workflow layout, migration batching, import options, and the static project validator. The current synthetic local-mock run records fresh migrations, inactive import, explicit activation, demo preflight, and four passing Playwright scenarios. Six local mock requests were made and no real provider was called in that run.

The 21-gate matrix is an evaluation plan; it is not a report that all gates passed. The current run is in [current-mock-run.json](../evaluation/current-mock-run.json). Dated, redacted captures—including the August 4 Playwright capture—are in [historical evidence](../evaluation/historical/).

The [source status matrix](../evaluation/historical/source-evaluation-matrix.md) is a mixed static, manual, and test record; it does not represent one end-to-end evaluation run.

## Interactive walkthrough

The [standalone synthetic walkthrough](../presentation/interactive/index.html) is self-contained. To view it in a browser, serve it from the repository root on loopback only:

```powershell
python -m http.server 4173 --bind 127.0.0.1 --directory presentation/interactive
```

Open `http://127.0.0.1:4173/` and stop the server with Ctrl+C when finished.
