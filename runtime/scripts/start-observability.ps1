[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$runtimeRoot = Split-Path -Parent $PSScriptRoot
$composeFiles = @(
    '-f', (Join-Path $runtimeRoot 'compose.yaml'),
    '-f', (Join-Path $runtimeRoot 'compose.otel.yaml')
)

& docker compose `
    --project-name signal-ai-demo `
    --env-file (Join-Path $runtimeRoot '.env') `
    @composeFiles `
    up --detach --wait

if ($LASTEXITCODE -ne 0) {
    throw 'The n8n/PostgreSQL/Jaeger Compose project did not start successfully.'
}

$n8nReady = Invoke-WebRequest `
    -UseBasicParsing `
    -Uri 'http://127.0.0.1:5678/healthz/readiness' `
    -TimeoutSec 10
if ($n8nReady.StatusCode -ne 200) {
    throw 'n8n readiness did not return HTTP 200.'
}

$jaegerReady = Invoke-WebRequest `
    -UseBasicParsing `
    -Uri 'http://127.0.0.1:16686/' `
    -TimeoutSec 10
if ($jaegerReady.StatusCode -ne 200) {
    throw 'Jaeger UI did not return HTTP 200.'
}

Write-Output 'Observability runtime is ready: n8n http://127.0.0.1:5678 and Jaeger http://127.0.0.1:16686.'
