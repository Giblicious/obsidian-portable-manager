param([string]$FrameworkDirectory = (Join-Path (Split-Path -Parent $PSScriptRoot) 'dist\framework'))
$ErrorActionPreference = 'Stop'
$repository = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$smoke = [IO.Path]::GetFullPath((Join-Path $repository "dist\launcher-smoke-$PID"))
if (-not $smoke.StartsWith($repository.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe launcher smoke path.' }

try {
    $portable = Join-Path $smoke 'Apps\Portables\ObsidianPortable'
    $appDirectory = Join-Path $portable 'App'
    $vault = Join-Path $smoke 'Vault\Smoke'
    New-Item -ItemType Directory -Force -Path $appDirectory, $vault | Out-Null
    $bytes = New-Object byte[] 144
    [BitConverter]::GetBytes([int]128).CopyTo($bytes, 60)
    [BitConverter]::GetBytes([uint32]0x00004550).CopyTo($bytes, 128)
    [BitConverter]::GetBytes([uint16]0x8664).CopyTo($bytes, 132)
    [IO.File]::WriteAllBytes((Join-Path $appDirectory 'Obsidian.exe'), $bytes)
    @(
        '# Launcher smoke test',
        'App=Apps\Portables\ObsidianPortable\App\Obsidian.exe',
        'Data=Apps\Portables\ObsidianPortable\Data',
        'Vault=Vault\Smoke',
        'VaultId=0123456789abcdef'
    ) | Set-Content -LiteralPath (Join-Path $portable 'portable.ini') -Encoding UTF8
    $dataDirectory = Join-Path $portable 'Data'
    New-Item -ItemType Directory -Force -Path $dataDirectory | Out-Null
    '{"updateDisabled":true,"vaults":{}}' | Set-Content -LiteralPath (Join-Path $dataDirectory 'obsidian.json') -Encoding UTF8
    $launcher = Join-Path $smoke 'Obsidian Portable.exe'
    Copy-Item -LiteralPath (Join-Path $FrameworkDirectory 'Root\Obsidian Portable.exe') -Destination $launcher
    $process = Start-Process -FilePath $launcher -ArgumentList '--repair-only' -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Package-relative launcher smoke test failed with exit code $($process.ExitCode)." }
    $registry = Get-Content -LiteralPath (Join-Path $dataDirectory 'obsidian.json') -Raw | ConvertFrom-Json
    if ($null -ne $registry.updateDisabled) { throw 'The launcher did not enable portable built-in updates.' }
    if ([string]$registry.vaults.'0123456789abcdef'.path -ne $vault) { throw 'The launcher did not repair the package-relative vault registry.' }
    Write-Host "Package-relative launcher smoke test passed with version $((Get-Item -LiteralPath $launcher).VersionInfo.FileVersion)."
}
finally {
    if (Test-Path -LiteralPath $smoke) { Remove-Item -LiteralPath $smoke -Recurse -Force }
}
