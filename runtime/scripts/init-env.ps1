[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RuntimeRoot = [System.IO.Path]::GetFullPath((Join-Path -Path $PSScriptRoot -ChildPath '..'))
$WorkspaceRoot = [System.IO.Path]::GetFullPath((Join-Path -Path $RuntimeRoot -ChildPath '..'))
$ExamplePath = Join-Path -Path $RuntimeRoot -ChildPath '.env.example'
$EnvPath = Join-Path -Path $RuntimeRoot -ChildPath '.env'
$GitIgnorePath = Join-Path -Path $WorkspaceRoot -ChildPath '.gitignore'
$RequiredKeys = @(
    'POSTGRES_PASSWORD',
    'N8N_DB_PASSWORD',
    'DEMO_DB_PASSWORD',
    'N8N_ENCRYPTION_KEY'
)

function New-HexSecret {
    param(
        [ValidateRange(16, 128)]
        [int]$ByteCount = 32
    )

    $bytes = New-Object byte[] $ByteCount
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($bytes)
    }
    finally {
        $generator.Dispose()
    }

    return ([System.BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
}

if (Test-Path -LiteralPath $EnvPath) {
    throw "Refusing to overwrite existing environment file: $EnvPath"
}
if (-not (Test-Path -LiteralPath $ExamplePath -PathType Leaf)) {
    throw "Environment template is missing: $ExamplePath"
}
if (-not (Test-Path -LiteralPath $GitIgnorePath -PathType Leaf)) {
    throw "Root ignore file is missing: $GitIgnorePath"
}

$ignorePatterns = @(
    [System.IO.File]::ReadAllLines($GitIgnorePath) |
        ForEach-Object { $_.Trim() } |
        Where-Object { $_ -and -not $_.StartsWith('#') }
)
$acceptedIgnorePatterns = @('.env', '**/.env', 'runtime/.env', '/runtime/.env')
if (@($acceptedIgnorePatterns | Where-Object { $_ -cin $ignorePatterns }).Count -eq 0) {
    throw 'Root .gitignore does not contain a rule that protects runtime/.env.'
}

$template = [System.IO.File]::ReadAllText($ExamplePath)
foreach ($key in $RequiredKeys) {
    $pattern = "(?m)^\s*$([System.Text.RegularExpressions.Regex]::Escape($key))\s*=.*$"
    $matches = [System.Text.RegularExpressions.Regex]::Matches($template, $pattern)
    if ($matches.Count -ne 1) {
        throw "Environment template must define required key '$key' exactly once."
    }
}

$generatedLines = foreach ($key in $RequiredKeys) {
    "$key=$(New-HexSecret -ByteCount 32)"
}
$content = ($generatedLines -join [Environment]::NewLine) + [Environment]::NewLine

foreach ($key in $RequiredKeys) {
    if ($content -notmatch "(?m)^\s*$([System.Text.RegularExpressions.Regex]::Escape($key))=[0-9a-f]{64}\s*$") {
        throw "Generated content failed validation for required key '$key'."
    }
}

$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
$fileStream = $null
$writer = $null
try {
    $fileStream = [System.IO.File]::Open(
        $EnvPath,
        [System.IO.FileMode]::CreateNew,
        [System.IO.FileAccess]::Write,
        [System.IO.FileShare]::None
    )
    $writer = New-Object System.IO.StreamWriter($fileStream, $utf8WithoutBom)
    $writer.Write($content)
}
finally {
    if ($null -ne $writer) {
        $writer.Dispose()
    }
    elseif ($null -ne $fileStream) {
        $fileStream.Dispose()
    }
}

try {
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $acl = New-Object System.Security.AccessControl.FileSecurity
    $acl.SetOwner($identity.User)
    $acl.SetAccessRuleProtection($true, $false)
    $accessRule = New-Object System.Security.AccessControl.FileSystemAccessRule(
        $identity.User,
        [System.Security.AccessControl.FileSystemRights]::FullControl,
        [System.Security.AccessControl.AccessControlType]::Allow
    )
    [void]$acl.AddAccessRule($accessRule)
    Set-Acl -LiteralPath $EnvPath -AclObject $acl
}
catch {
    # ACL hardening is best-effort because some copied filesystems do not support Windows ACLs.
}

Write-Host "Created protected runtime environment file: $EnvPath"
