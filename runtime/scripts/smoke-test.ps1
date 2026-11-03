[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProjectName = 'product-signal-control-tower'
$RuntimeRoot = [System.IO.Path]::GetFullPath((Join-Path -Path $PSScriptRoot -ChildPath '..'))
$ComposePath = Join-Path -Path $RuntimeRoot -ChildPath 'compose.yaml'
$EnvPath = Join-Path -Path $RuntimeRoot -ChildPath '.env'
$ComposeArguments = @(
    'compose',
    '--project-name', $ProjectName,
    '--env-file', $EnvPath,
    '-f', $ComposePath
)

function Invoke-PostgresScalar {
    param(
        [Parameter(Mandatory)]
        [string]$Database,

        [Parameter(Mandatory)]
        [string]$Sql
    )

    $result = (
        & docker @ComposeArguments exec -T postgres `
            psql -X -v 'ON_ERROR_STOP=1' -U postgres -d $Database -Atqc $Sql 2>$null |
            Out-String
    ).Trim()
    if ($LASTEXITCODE -ne 0) {
        throw "PostgreSQL verification failed in database '$Database'."
    }

    return $result
}

function Assert-HealthEndpoint {
    param(
        [Parameter(Mandatory)]
        [string]$Path
    )

    $requestParameters = @{
        Uri = "http://127.0.0.1:5678$Path"
        Method = 'Get'
        TimeoutSec = 15
        ErrorAction = 'Stop'
    }
    if ($PSVersionTable.PSVersion.Major -lt 6) {
        $requestParameters['UseBasicParsing'] = $true
    }

    $response = Invoke-WebRequest @requestParameters
    if ([int]$response.StatusCode -ne 200) {
        throw "n8n endpoint '$Path' returned HTTP $($response.StatusCode)."
    }

    try {
        $body = $response.Content | ConvertFrom-Json
    }
    catch {
        throw "n8n endpoint '$Path' did not return valid JSON."
    }
    if ($body.status -cne 'ok') {
        throw "n8n endpoint '$Path' did not report status ok."
    }
}

function Get-ServiceContainerId {
    param(
        [Parameter(Mandatory)]
        [string]$Service
    )

    $ids = @(
        & docker @ComposeArguments ps -q $Service 2>$null |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    )
    if ($LASTEXITCODE -ne 0 -or $ids.Count -ne 1) {
        throw "Expected exactly one container for service '$Service'."
    }

    return $ids[0].Trim()
}

function Assert-ApplicationRoleConnectivity {
    $connectionTest = @'
test "$(PGPASSWORD="${N8N_DB_PASSWORD}" psql -h 127.0.0.1 -U n8n_app -d n8n -Atqc \
  "SELECT current_user || '|' || current_database();")" = "n8n_app|n8n"
test "$(PGPASSWORD="${DEMO_DB_PASSWORD}" psql -h 127.0.0.1 -U signal_app -d signal_demo -Atqc \
  "SELECT current_user || '|' || current_database();")" = "signal_app|signal_demo"
test "$(PGPASSWORD="${DEMO_DB_PASSWORD}" psql -h 127.0.0.1 -U signal_app -d signal_demo -Atqc \
  "SELECT '[1,2,3]'::vector <-> '[1,2,4]'::vector;")" = "1"
'@

    & docker @ComposeArguments exec -T postgres sh -eu -c $connectionTest *> $null
    if ($LASTEXITCODE -ne 0) {
        throw 'Application-role connectivity or known-value pgvector verification failed.'
    }
}

if ($null -eq (Get-Command -Name 'docker' -CommandType Application -ErrorAction SilentlyContinue)) {
    throw 'Docker is not installed or docker.exe is not available on PATH.'
}
foreach ($requiredPath in @($ComposePath, $EnvPath)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        throw "Required runtime file is missing: $requiredPath"
    }
}

$runningServices = @(
    & docker @ComposeArguments ps --status running --services 2>$null |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
        ForEach-Object { $_.Trim() }
)
if ($LASTEXITCODE -ne 0) {
    throw "Unable to inspect running services for Compose project '$ProjectName'."
}
foreach ($service in @('n8n', 'postgres')) {
    if ($service -cnotin $runningServices) {
        throw "Required service '$service' is not running."
    }
}

Assert-HealthEndpoint -Path '/healthz'
Assert-HealthEndpoint -Path '/healthz/readiness'

if ((Invoke-PostgresScalar -Database 'postgres' -Sql 'SELECT current_database();') -cne 'postgres') {
    throw 'PostgreSQL administrative connection reached an unexpected database.'
}
if ((Invoke-PostgresScalar -Database 'postgres' -Sql "SELECT count(*) FROM pg_database WHERE datname IN ('n8n', 'signal_demo');") -cne '2') {
    throw 'Expected n8n and signal_demo databases were not both found.'
}
if ((Invoke-PostgresScalar -Database 'postgres' -Sql "SELECT count(*) FROM pg_roles WHERE rolname IN ('n8n_app', 'signal_app');") -cne '2') {
    throw 'Expected n8n_app and signal_app roles were not both found.'
}
$vectorVersion = Invoke-PostgresScalar -Database 'signal_demo' -Sql "SELECT extversion FROM pg_extension WHERE extname = 'vector';"
if ([string]::IsNullOrWhiteSpace($vectorVersion)) {
    throw 'The vector extension is not installed in signal_demo.'
}
Assert-ApplicationRoleConnectivity

$postgresContainerId = Get-ServiceContainerId -Service 'postgres'
$postgresPortBindings = (& docker inspect --format '{{json .HostConfig.PortBindings}}' $postgresContainerId 2>$null | Out-String).Trim()
if ($LASTEXITCODE -ne 0) {
    throw 'Unable to inspect PostgreSQL port bindings.'
}
if ($postgresPortBindings -notin @('', 'null', '{}')) {
    throw 'PostgreSQL unexpectedly publishes a host port.'
}

$n8nContainerId = Get-ServiceContainerId -Service 'n8n'
$n8nPortBindingsJson = (& docker inspect --format '{{json .HostConfig.PortBindings}}' $n8nContainerId 2>$null | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($n8nPortBindingsJson)) {
    throw 'Unable to inspect n8n port bindings.'
}
$n8nPortBindings = $n8nPortBindingsJson | ConvertFrom-Json
$bindingProperties = @($n8nPortBindings.PSObject.Properties)
if ($bindingProperties.Count -ne 1 -or $bindingProperties[0].Name -cne '5678/tcp') {
    throw 'n8n must publish only container port 5678/tcp.'
}
$hostBindings = @($bindingProperties[0].Value)
if (
    $hostBindings.Count -ne 1 -or
    $hostBindings[0].HostIp -cne '127.0.0.1' -or
    $hostBindings[0].HostPort -cne '5678'
) {
    throw 'n8n must publish exactly 127.0.0.1:5678.'
}

Write-Host "Smoke test passed: both services are running, n8n is ready, PostgreSQL is private, and pgvector $vectorVersion is installed."
