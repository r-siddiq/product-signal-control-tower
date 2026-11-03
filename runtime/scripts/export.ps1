[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProjectName = 'product-signal-control-tower'
$RuntimeRoot = [System.IO.Path]::GetFullPath((Join-Path -Path $PSScriptRoot -ChildPath '..'))
$WorkspaceRoot = [System.IO.Path]::GetFullPath((Join-Path -Path $RuntimeRoot -ChildPath '..'))
$ComposePath = Join-Path -Path $RuntimeRoot -ChildPath 'compose.yaml'
$EnvPath = Join-Path -Path $RuntimeRoot -ChildPath '.env'
$GitIgnorePath = Join-Path -Path $WorkspaceRoot -ChildPath '.gitignore'
$ExportsRoot = Join-Path -Path $RuntimeRoot -ChildPath 'exports'
$ComposeArguments = @(
    'compose',
    '--project-name', $ProjectName,
    '--env-file', $EnvPath,
    '-f', $ComposePath
)

function Assert-IgnoredArtifactRoot {
    if (-not (Test-Path -LiteralPath $GitIgnorePath -PathType Leaf)) {
        throw "Root ignore file is missing: $GitIgnorePath"
    }

    $patterns = @(
        [System.IO.File]::ReadAllLines($GitIgnorePath) |
            ForEach-Object { $_.Trim() } |
            Where-Object { $_ -and -not $_.StartsWith('#') }
    )
    if ('runtime/exports/' -cnotin $patterns -and '/runtime/exports/' -cnotin $patterns) {
        throw 'Root .gitignore does not protect runtime/exports/.'
    }
}

function Invoke-ComposeQuietly {
    param(
        [Parameter(Mandatory)]
        [string[]]$Arguments,

        [Parameter(Mandatory)]
        [string]$Action
    )

    & docker @ComposeArguments @Arguments *> $null
    if ($LASTEXITCODE -ne 0) {
        throw "$Action failed."
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
Assert-IgnoredArtifactRoot

$runningServices = @(
    & docker @ComposeArguments ps --status running --services 2>$null |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
)
if ($LASTEXITCODE -ne 0 -or 'n8n' -cnotin $runningServices) {
    throw "The n8n service for Compose project '$ProjectName' must be running before export."
}

$timestamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
$exportDirectory = Join-Path -Path $ExportsRoot -ChildPath $timestamp
$workflowFile = Join-Path -Path $exportDirectory -ChildPath 'workflows.json'
$credentialFile = Join-Path -Path $exportDirectory -ChildPath 'credentials.encrypted.json'
$containerWorkflowFile = "/tmp/signal-$timestamp-workflows.json"
$containerCredentialFile = "/tmp/signal-$timestamp-credentials.encrypted.json"

[void][System.IO.Directory]::CreateDirectory($exportDirectory)

try {
    Invoke-ComposeQuietly `
        -Arguments @('exec', '-T', '--user', 'node', 'n8n', 'n8n', 'export:workflow', '--all', "--output=$containerWorkflowFile") `
        -Action 'Workflow export'
    $credentialCount = (
        & docker @ComposeArguments exec -T postgres `
            psql -X -v 'ON_ERROR_STOP=1' -U postgres -d n8n -Atqc `
            'SELECT count(*) FROM credentials_entity;' 2>$null |
            Out-String
    ).Trim()
    if ($LASTEXITCODE -ne 0 -or $credentialCount -notmatch '^\d+$') {
        throw 'Unable to determine the credential count before export.'
    }
    if ([int64]$credentialCount -eq 0) {
        Invoke-ComposeQuietly `
            -Arguments @('exec', '-T', '--user', 'node', 'n8n', 'sh', '-eu', '-c', 'printf "[]\n" > "$1"', 'sh', $containerCredentialFile) `
            -Action 'Empty encrypted credential export creation'
    }
    else {
        Invoke-ComposeQuietly `
            -Arguments @('exec', '-T', '--user', 'node', 'n8n', 'n8n', 'export:credentials', '--all', "--output=$containerCredentialFile") `
            -Action 'Encrypted credential export'
    }
    Invoke-ComposeQuietly `
        -Arguments @('cp', "n8n:$containerWorkflowFile", $workflowFile) `
        -Action 'Workflow export copy'
    Invoke-ComposeQuietly `
        -Arguments @('cp', "n8n:$containerCredentialFile", $credentialFile) `
        -Action 'Encrypted credential export copy'

    foreach ($artifact in @($workflowFile, $credentialFile)) {
        if (-not (Test-Path -LiteralPath $artifact -PathType Leaf) -or (Get-Item -LiteralPath $artifact).Length -le 0) {
            throw "Export artifact is missing or empty: $artifact"
        }
    }
}
finally {
    & docker @ComposeArguments exec -T --user node n8n sh -eu -c `
        'rm -f "$1" "$2"' sh $containerWorkflowFile $containerCredentialFile *> $null
}

Write-Warning 'Credential exports remain encrypted and require the matching N8N_ENCRYPTION_KEY to import. No decrypted credential export was created.'
Write-Host "Export completed: $exportDirectory"
