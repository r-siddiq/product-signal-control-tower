[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProjectName = 'signal-ai-demo'
$RuntimeRoot = [System.IO.Path]::GetFullPath((Join-Path -Path $PSScriptRoot -ChildPath '..'))
$ComposePath = Join-Path -Path $RuntimeRoot -ChildPath 'compose.yaml'
$EnvPath = Join-Path -Path $RuntimeRoot -ChildPath '.env'
$PreflightPath = Join-Path -Path $PSScriptRoot -ChildPath 'preflight.ps1'
$ComposeArguments = @(
    'compose',
    '--project-name', $ProjectName,
    '--env-file', $EnvPath,
    '-f', $ComposePath
)

if (-not (Test-Path -LiteralPath $PreflightPath -PathType Leaf)) {
    throw "Preflight script is missing: $PreflightPath"
}

& $PreflightPath

& docker @ComposeArguments pull
if ($LASTEXITCODE -ne 0) {
    throw 'Failed to pull one or more approved pinned images.'
}

& docker @ComposeArguments up -d
if ($LASTEXITCODE -ne 0) {
    throw "Failed to start Compose project '$ProjectName'."
}

Write-Host 'n8n is starting. Open the local editor at http://127.0.0.1:5678 after readiness passes.'
