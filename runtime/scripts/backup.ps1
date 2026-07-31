[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProjectName = 'signal-ai-demo'
$RuntimeRoot = [System.IO.Path]::GetFullPath((Join-Path -Path $PSScriptRoot -ChildPath '..'))
$WorkspaceRoot = [System.IO.Path]::GetFullPath((Join-Path -Path $RuntimeRoot -ChildPath '..'))
$ComposePath = Join-Path -Path $RuntimeRoot -ChildPath 'compose.yaml'
$EnvPath = Join-Path -Path $RuntimeRoot -ChildPath '.env'
$GitIgnorePath = Join-Path -Path $WorkspaceRoot -ChildPath '.gitignore'
$BackupsRoot = Join-Path -Path $RuntimeRoot -ChildPath 'backups'
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
    if ('runtime/backups/' -cnotin $patterns -and '/runtime/backups/' -cnotin $patterns) {
        throw 'Root .gitignore does not protect runtime/backups/.'
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

function Invoke-ComposeText {
    param(
        [Parameter(Mandatory)]
        [string[]]$Arguments,

        [Parameter(Mandatory)]
        [string]$Action
    )

    $result = (& docker @ComposeArguments @Arguments 2>$null | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) {
        throw "$Action failed."
    }

    return $result
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
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
        ForEach-Object { $_.Trim() }
)
if ($LASTEXITCODE -ne 0) {
    throw "Unable to inspect running services for Compose project '$ProjectName'."
}
foreach ($service in @('n8n', 'postgres')) {
    if ($service -cnotin $runningServices) {
        throw "Required service '$service' must be running before backup."
    }
}

$timestamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
$backupDirectory = Join-Path -Path $BackupsRoot -ChildPath $timestamp
$n8nDump = Join-Path -Path $backupDirectory -ChildPath 'n8n.dump'
$demoDump = Join-Path -Path $backupDirectory -ChildPath 'signal_demo.dump'
$rolesDump = Join-Path -Path $backupDirectory -ChildPath 'roles.sql'
$manifestPath = Join-Path -Path $backupDirectory -ChildPath 'manifest.txt'
$warningPath = Join-Path -Path $backupDirectory -ChildPath 'RECOVERY-WARNING.txt'
$containerN8nDump = "/tmp/signal-$timestamp-n8n.dump"
$containerDemoDump = "/tmp/signal-$timestamp-signal_demo.dump"
$containerRolesDump = "/tmp/signal-$timestamp-roles.sql"

[void][System.IO.Directory]::CreateDirectory($backupDirectory)

try {
    Invoke-ComposeQuietly `
        -Arguments @('exec', '-T', 'postgres', 'pg_dump', '-U', 'postgres', '-d', 'n8n', '--format=custom', "--file=$containerN8nDump") `
        -Action 'n8n database dump'
    Invoke-ComposeQuietly `
        -Arguments @('exec', '-T', 'postgres', 'pg_dump', '-U', 'postgres', '-d', 'signal_demo', '--format=custom', "--file=$containerDemoDump") `
        -Action 'signal_demo database dump'
    Invoke-ComposeQuietly `
        -Arguments @('exec', '-T', 'postgres', 'pg_dumpall', '-U', 'postgres', '--roles-only', '--no-role-passwords', "--file=$containerRolesDump") `
        -Action 'PostgreSQL roles dump'
    Invoke-ComposeQuietly -Arguments @('cp', "postgres:$containerN8nDump", $n8nDump) -Action 'n8n dump copy'
    Invoke-ComposeQuietly -Arguments @('cp', "postgres:$containerDemoDump", $demoDump) -Action 'signal_demo dump copy'
    Invoke-ComposeQuietly -Arguments @('cp', "postgres:$containerRolesDump", $rolesDump) -Action 'roles dump copy'

    foreach ($artifact in @($n8nDump, $demoDump, $rolesDump)) {
        if (-not (Test-Path -LiteralPath $artifact -PathType Leaf) -or (Get-Item -LiteralPath $artifact).Length -le 0) {
            throw "Backup artifact is missing or empty: $artifact"
        }
    }
}
finally {
    & docker @ComposeArguments exec -T postgres sh -eu -c `
        'rm -f "$1" "$2" "$3"' sh $containerN8nDump $containerDemoDump $containerRolesDump *> $null
}

$imageReferences = @(
    & docker @ComposeArguments config --images 2>$null |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
        ForEach-Object { $_.Trim() }
)
if ($LASTEXITCODE -ne 0 -or $imageReferences.Count -eq 0) {
    throw 'Unable to capture image references for the backup manifest.'
}

$n8nVersion = Invoke-ComposeText `
    -Arguments @('exec', '-T', '--user', 'node', 'n8n', 'n8n', '--version') `
    -Action 'n8n version capture'
$postgresVersion = Invoke-ComposeText `
    -Arguments @('exec', '-T', 'postgres', 'postgres', '--version') `
    -Action 'PostgreSQL version capture'
$vectorVersion = Invoke-ComposeText `
    -Arguments @('exec', '-T', 'postgres', 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'signal_demo', '-Atqc', "SELECT extversion FROM pg_extension WHERE extname = 'vector';") `
    -Action 'pgvector version capture'
if ([string]::IsNullOrWhiteSpace($vectorVersion)) {
    throw 'The vector extension version could not be recorded.'
}

$warning = @(
    'This backup intentionally does not contain runtime/.env or N8N_ENCRYPTION_KEY.',
    'Preserve the matching N8N_ENCRYPTION_KEY separately in an approved secret manager.',
    'Encrypted n8n credentials cannot be recovered from the database dump without that exact key.',
    'This logical backup also excludes filesystem binary data and other files in the n8n_data volume.'
)
[System.IO.File]::WriteAllLines($warningPath, $warning, (New-Object System.Text.UTF8Encoding($false)))

$artifactLines = foreach ($artifact in @($n8nDump, $demoDump, $rolesDump)) {
    $item = Get-Item -LiteralPath $artifact
    $hash = (Get-FileHash -LiteralPath $artifact -Algorithm SHA256).Hash.ToLowerInvariant()
    "- $($item.Name): $($item.Length) bytes; sha256=$hash"
}
$manifest = @(
    "CreatedUtc: $([DateTime]::UtcNow.ToString('o'))",
    "ComposeProject: $ProjectName",
    'ImageReferences:',
    ($imageReferences | ForEach-Object { "- $_" }),
    "n8nVersion: $n8nVersion",
    "PostgreSQLVersion: $postgresVersion",
    "pgvectorExtensionVersion: $vectorVersion",
    'Artifacts:',
    $artifactLines,
    'Secrets: runtime/.env and N8N_ENCRYPTION_KEY are intentionally excluded; preserve the matching key separately.',
    'Scope: the n8n_data volume and its filesystem binary data are not included.'
) | ForEach-Object { $_ }
[System.IO.File]::WriteAllLines($manifestPath, $manifest, (New-Object System.Text.UTF8Encoding($false)))

foreach ($artifact in @($manifestPath, $warningPath)) {
    if (-not (Test-Path -LiteralPath $artifact -PathType Leaf) -or (Get-Item -LiteralPath $artifact).Length -le 0) {
        throw "Backup metadata artifact is missing or empty: $artifact"
    }
}

Write-Warning 'The backup excludes runtime/.env. Preserve the matching N8N_ENCRYPTION_KEY separately or encrypted credentials cannot be recovered.'
Write-Warning 'This logical backup does not include filesystem binary data or other files in the n8n_data volume.'
Write-Host "Backup completed: $backupDirectory"
