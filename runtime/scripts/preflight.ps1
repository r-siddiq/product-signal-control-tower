[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProjectName = 'signal-ai-demo'
$RuntimeRoot = [System.IO.Path]::GetFullPath((Join-Path -Path $PSScriptRoot -ChildPath '..'))
$ComposePath = Join-Path -Path $RuntimeRoot -ChildPath 'compose.yaml'
$EnvPath = Join-Path -Path $RuntimeRoot -ChildPath '.env'
$BootstrapPath = Join-Path -Path $RuntimeRoot -ChildPath 'docker/postgres/init/001-bootstrap.sh'
$ComposeArguments = @(
    'compose',
    '--project-name', $ProjectName,
    '--env-file', $EnvPath,
    '-f', $ComposePath
)
$ExpectedImages = @(
    'docker.n8n.io/n8nio/n8n:2.32.6@sha256:5f7856f4fc7cd935230f7596e39fdb3d5eda0e379c5b40b699b9c0eb35ebd0bf',
    'docker.io/pgvector/pgvector:0.8.6-pg17-bookworm@sha256:7ae6051efd0e60444282c27c7e141af07f322ce033300e727a49c3dd11075e38'
)
$RequiredEnvironmentKeys = @(
    'POSTGRES_PASSWORD',
    'N8N_DB_PASSWORD',
    'DEMO_DB_PASSWORD',
    'N8N_ENCRYPTION_KEY'
)

function Assert-LastExitCode {
    param(
        [Parameter(Mandatory)]
        [string]$Action
    )

    if ($LASTEXITCODE -ne 0) {
        throw "$Action failed. Correct the reported Docker problem and retry."
    }
}

function Assert-RequiredEnvironment {
    $seen = @{}

    foreach ($line in [System.IO.File]::ReadAllLines($EnvPath)) {
        if ($line -notmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') {
            continue
        }

        $key = $Matches[1]
        if ($key -notin $RequiredEnvironmentKeys) {
            continue
        }
        if ($seen.ContainsKey($key)) {
            throw "The .env file defines required key '$key' more than once."
        }

        $value = $Matches[2].Trim()
        if (
            $value.Length -ge 2 -and
            (($value.StartsWith('"') -and $value.EndsWith('"')) -or
             ($value.StartsWith("'") -and $value.EndsWith("'")))
        ) {
            $value = $value.Substring(1, $value.Length - 2).Trim()
        }

        if ([string]::IsNullOrWhiteSpace($value)) {
            throw "The .env file contains an empty value for required key '$key'."
        }
        if ($value -match '^(?i:change[_-]?me.*|replace[_-]?with.*|generate[_-]?.*|__.*__|placeholder.*|your[_-].*|todo|unset|secret|password|<[^>]+>)$') {
            throw "The .env file still contains a placeholder for required key '$key'."
        }

        $seen[$key] = $true
    }

    foreach ($key in $RequiredEnvironmentKeys) {
        if (-not $seen.ContainsKey($key)) {
            throw "The .env file is missing required key '$key'."
        }
    }
}

function Test-PortIsAvailable {
    foreach ($address in @([System.Net.IPAddress]::Any, [System.Net.IPAddress]::IPv6Any)) {
        $listener = [System.Net.Sockets.TcpListener]::new($address, 5678)
        $listener.Server.ExclusiveAddressUse = $true
        try {
            $listener.Start()
        }
        catch {
            return $false
        }
        finally {
            $listener.Stop()
        }
    }

    return $true
}

function Test-ProjectN8nOwnsPort {
    $containerIds = @(
        & docker ps `
            --filter "label=com.docker.compose.project=$ProjectName" `
            --filter 'label=com.docker.compose.service=n8n' `
            --filter 'status=running' `
            --format '{{.ID}}' 2>$null |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    )
    if ($LASTEXITCODE -ne 0 -or $containerIds.Count -ne 1) {
        return $false
    }

    $bindings = @(
        & docker port $containerIds[0] '5678/tcp' 2>$null |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    )
    if ($LASTEXITCODE -ne 0 -or $bindings.Count -ne 1) {
        return $false
    }

    return $bindings[0].Trim() -ceq '127.0.0.1:5678'
}

foreach ($requiredPath in @($ComposePath, $EnvPath, $BootstrapPath)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        throw "Required runtime file is missing: $requiredPath"
    }
}

if ($null -eq (Get-Command -Name 'docker' -CommandType Application -ErrorAction SilentlyContinue)) {
    throw 'Docker is not installed or docker.exe is not available on PATH.'
}

& docker info --format '{{.ServerVersion}}' *> $null
Assert-LastExitCode -Action 'Docker daemon check'

$composeVersionText = (& docker compose version --short 2>$null | Out-String).Trim()
Assert-LastExitCode -Action 'Docker Compose plugin check'
$composeVersion = $null
if (
    [string]::IsNullOrWhiteSpace($composeVersionText) -or
    -not [System.Version]::TryParse(
        ($composeVersionText -replace '^[vV]', ''),
        [ref]$composeVersion
    ) -or
    $composeVersion.Major -lt 2
) {
    throw 'Docker Compose v2 or newer is required through the docker compose plugin.'
}

$engineOs = (& docker info --format '{{.OSType}}' 2>$null | Out-String).Trim()
Assert-LastExitCode -Action 'Docker engine type check'
if ($engineOs -cne 'linux') {
    throw 'Docker must be running the Linux container engine.'
}

Assert-RequiredEnvironment

if (-not (Test-PortIsAvailable) -and -not (Test-ProjectN8nOwnsPort)) {
    throw "Host port 5678 is already in use by something other than this project's loopback-only n8n container."
}

$renderedImages = @(
    & docker @ComposeArguments config --images 2>$null |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
        ForEach-Object { $_.Trim() }
)
Assert-LastExitCode -Action 'Docker Compose configuration rendering'

if ($renderedImages.Count -ne $ExpectedImages.Count) {
    throw 'Rendered Compose configuration does not contain exactly the two frozen image references.'
}
foreach ($image in $ExpectedImages) {
    if ($image -cnotin $renderedImages) {
        throw "Rendered Compose configuration does not use the approved immutable image reference: $image"
    }
}

Write-Host "Preflight passed for Compose project '$ProjectName' using Docker Compose $composeVersionText and the Linux engine."
