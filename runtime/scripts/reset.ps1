[CmdletBinding()]
param(
    [string]$ConfirmToken = '',

    [switch]$RemoveVolumes
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProjectName = 'product-signal-control-tower'
$RequiredToken = 'RESET-SIGNAL-AI-DEMO'
$RuntimeRoot = [System.IO.Path]::GetFullPath((Join-Path -Path $PSScriptRoot -ChildPath '..'))
$ComposePath = Join-Path -Path $RuntimeRoot -ChildPath 'compose.yaml'
$EnvPath = Join-Path -Path $RuntimeRoot -ChildPath '.env'
$ComposeArguments = @(
    'compose',
    '--project-name', $ProjectName,
    '--env-file', $EnvPath,
    '-f', $ComposePath
)
$Services = @('n8n', 'postgres')
$Volumes = @(
    "${ProjectName}_n8n_data",
    "${ProjectName}_postgres_data"
)

Write-Host 'DESTRUCTIVE RESET TARGET'
Write-Host "Project: $ProjectName"
Write-Host "Services: $($Services -join ', ')"
Write-Host "Volumes: $($Volumes -join ', ')"
Write-Warning 'A confirmed reset permanently removes PostgreSQL data, n8n state, workflows, credentials, execution history, and filesystem binary data stored in these volumes.'

if ($ConfirmToken -cne $RequiredToken -or -not $RemoveVolumes.IsPresent) {
    Write-Host 'No changes made.'
    Write-Host "To authorize this exact reset, pass -ConfirmToken '$RequiredToken' and -RemoveVolumes together."
    return
}

if ($null -eq (Get-Command -Name 'docker' -CommandType Application -ErrorAction SilentlyContinue)) {
    throw 'Docker is not installed or docker.exe is not available on PATH.'
}
foreach ($requiredPath in @($ComposePath, $EnvPath)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        throw "Required runtime file is missing: $requiredPath"
    }
}

Write-Warning "Confirmation accepted. Removing only Compose project '$ProjectName' containers, networks, and its declared volumes."
& docker @ComposeArguments down --volumes --remove-orphans
if ($LASTEXITCODE -ne 0) {
    throw "Destructive reset failed for Compose project '$ProjectName'. Inspect Docker state before retrying."
}

Write-Host "Reset completed for Compose project '$ProjectName'. The removed volume data is not recoverable unless a separate verified backup exists."
