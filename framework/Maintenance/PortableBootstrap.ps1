# FrameworkBootstrapVersion: 1.3.3
param(
    [ValidateSet('Setup', 'Transfer')][string]$Operation,
    [string]$TargetRoot,
    [string]$SourceVault,
    [string]$SourcePackageRoot = '',
    [string]$StatusPath,
    [int]$WaitForPid = 0,
    [switch]$Probe,
    [switch]$Bootstrap
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$FrameworkRepository = 'Giblicious/obsidian-portable-manager'
$script:ProgressForm = $null
$script:ProgressLabel = $null

function Quote-ProcessArgument([string]$Value) { return '"' + $Value.Replace('"', '\"') + '"' }

if ($Bootstrap) {
    $arguments = @(
        '-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass',
        '-File', (Quote-ProcessArgument $PSCommandPath),
        '-Operation', $Operation,
        '-TargetRoot', (Quote-ProcessArgument $TargetRoot),
        '-SourceVault', (Quote-ProcessArgument $SourceVault),
        '-StatusPath', (Quote-ProcessArgument $StatusPath),
        '-WaitForPid', [string]$WaitForPid
    )
    if ($SourcePackageRoot) { $arguments += @('-SourcePackageRoot', (Quote-ProcessArgument $SourcePackageRoot)) }
    if ($Probe) { $arguments += '-Probe' }
    Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList $arguments -WindowStyle Hidden | Out-Null
    exit 0
}

function Save-Status([string]$State, [string]$Message, [string]$Version = '') {
    $temporary = $StatusPath + ".$PID.new"
    [ordered]@{
        state = $State
        scope = $Operation.ToLowerInvariant()
        message = $Message
        version = $Version
        targetRoot = $TargetRoot
        processId = $PID
        timestamp = (Get-Date).ToString('o')
    } | ConvertTo-Json | Set-Content -LiteralPath $temporary -Encoding UTF8
    Move-Item -LiteralPath $temporary -Destination $StatusPath -Force
    if ($script:ProgressLabel) {
        $script:ProgressLabel.Text = $Message
        [System.Windows.Forms.Application]::DoEvents()
    }
}

function Show-ProgressWindow {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $script:ProgressForm = New-Object System.Windows.Forms.Form
    $script:ProgressForm.Text = 'Obsidian Portable Manager'
    $script:ProgressForm.Width = 460
    $script:ProgressForm.Height = 170
    $script:ProgressForm.StartPosition = 'CenterScreen'
    $script:ProgressForm.FormBorderStyle = 'FixedDialog'
    $script:ProgressForm.MaximizeBox = $false
    $script:ProgressForm.MinimizeBox = $false
    $title = New-Object System.Windows.Forms.Label
    $title.Text = if ($Operation -eq 'Setup') { 'Creating Obsidian Portable' } else { 'Copying Obsidian Portable' }
    $title.Font = New-Object System.Drawing.Font('Segoe UI', 12, [System.Drawing.FontStyle]::Bold)
    $title.SetBounds(22, 18, 400, 28)
    $script:ProgressLabel = New-Object System.Windows.Forms.Label
    $script:ProgressLabel.Text = 'Preparing...'
    $script:ProgressLabel.SetBounds(22, 53, 400, 30)
    $progress = New-Object System.Windows.Forms.ProgressBar
    $progress.Style = 'Marquee'
    $progress.MarqueeAnimationSpeed = 30
    $progress.SetBounds(22, 91, 400, 16)
    $script:ProgressForm.Controls.AddRange(@($title, $script:ProgressLabel, $progress))
    $script:ProgressForm.Show()
    [System.Windows.Forms.Application]::DoEvents()
}

function Close-ProgressWindow {
    if ($script:ProgressForm) { $script:ProgressForm.Close(); $script:ProgressForm.Dispose(); $script:ProgressForm = $null; $script:ProgressLabel = $null }
}

function Resolve-FullPath([string]$Value) {
    if (-not $Value) { throw 'A required path was not provided.' }
    return [IO.Path]::GetFullPath($Value).TrimEnd('\')
}

function Assert-SeparatePaths([string]$Source, [string]$Target) {
    $sourceFull = (Resolve-FullPath $Source) + '\'
    $targetFull = (Resolve-FullPath $Target) + '\'
    if ($sourceFull.StartsWith($targetFull, [StringComparison]::OrdinalIgnoreCase) -or $targetFull.StartsWith($sourceFull, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'The destination must be outside the current vault and portable package.'
    }
}

function Get-Release([string]$Repository) {
    $headers = @{ 'User-Agent' = 'Obsidian-Portable-Manager'; 'Accept' = 'application/vnd.github+json' }
    return Invoke-RestMethod -Uri "https://api.github.com/repos/$Repository/releases/latest" -Headers $headers
}

function Get-ReleaseAsset([object]$Release, [string]$Name) {
    $asset = $Release.assets | Where-Object { $_.name -eq $Name } | Select-Object -First 1
    if (-not $asset) { throw "Release asset is missing: $Name" }
    $prefix = "https://github.com/$FrameworkRepository/releases/download/"
    if (-not ([string]$asset.browser_download_url).StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw "Untrusted framework asset URL: $($asset.browser_download_url)" }
    return $asset
}

function Download-Asset([object]$Asset, [string]$Destination) {
    & curl.exe -L --fail --retry 3 --silent --show-error -o $Destination $Asset.browser_download_url
    if ($LASTEXITCODE -ne 0) { throw "Download failed with curl exit code $LASTEXITCODE." }
    if ((Get-Item -LiteralPath $Destination).Length -ne [long]$Asset.size) { throw "Downloaded size does not match GitHub for $($Asset.name)." }
}

function Copy-Directory([string]$Source, [string]$Destination) {
    if (-not (Test-Path -LiteralPath $Source -PathType Container)) { throw "Required folder is missing: $Source" }
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    Get-ChildItem -LiteralPath $Source -Force | Copy-Item -Destination $Destination -Recurse -Force
}

function Write-PortableConfiguration([string]$Root, [string]$VaultName, [string]$VaultId) {
    $portableRoot = Join-Path $Root 'Apps\Portables\ObsidianPortable'
    $config = @(
        '# Managed by Obsidian Portable Manager. Paths are relative to this package.',
        'App=Apps\Portables\ObsidianPortable\App\Obsidian.exe',
        'Data=Apps\Portables\ObsidianPortable\Data',
        "Vault=Vault\$VaultName",
        "VaultId=$VaultId"
    ) -join "`r`n"
    Set-Content -LiteralPath (Join-Path $portableRoot 'portable.ini') -Value $config -Encoding UTF8
}

function Install-Framework([string]$Root, [string]$WorkingDirectory) {
    Save-Status 'downloading' 'Downloading and verifying the portable framework.'
    $release = Get-Release $FrameworkRepository
    $version = ([string]$release.tag_name).TrimStart('v')
    $zipAsset = Get-ReleaseAsset $release 'portable-framework.zip'
    $hashAsset = Get-ReleaseAsset $release 'portable-framework.sha256'
    $zipPath = Join-Path $WorkingDirectory 'portable-framework.zip'
    $hashPath = Join-Path $WorkingDirectory 'portable-framework.sha256'
    Download-Asset $zipAsset $zipPath
    Download-Asset $hashAsset $hashPath
    $expectedHash = ([regex]::Match((Get-Content -LiteralPath $hashPath -Raw), '(?i)\b[0-9a-f]{64}\b')).Value.ToUpperInvariant()
    $actualHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToUpperInvariant()
    if (-not $expectedHash -or $actualHash -ne $expectedHash) { throw 'The portable framework checksum did not match.' }
    $expanded = Join-Path $WorkingDirectory 'framework'
    Expand-Archive -LiteralPath $zipPath -DestinationPath $expanded -Force
    foreach ($forbidden in @('App', 'Data', 'portable.ini', 'portable-manifest.json', 'manifest.json', 'update-status.json')) {
        if (Get-ChildItem -LiteralPath $expanded -Recurse -Force | Where-Object { $_.Name -ieq $forbidden }) { throw "Framework archive contains protected content: $forbidden" }
    }
    $manifest = Get-Content -LiteralPath (Join-Path $expanded 'framework-manifest.json') -Raw | ConvertFrom-Json
    if ([string]$manifest.frameworkVersion -ne $version) { throw 'Framework manifest version does not match its release.' }
    $launcher = Join-Path $expanded 'Root\Obsidian Portable.exe'
    if ((Get-Item -LiteralPath $launcher).VersionInfo.FileVersion -ne "${version}.0") { throw 'Launcher version does not match the framework release.' }
    $portableRoot = Join-Path $Root 'Apps\Portables\ObsidianPortable'
    New-Item -ItemType Directory -Force -Path $portableRoot | Out-Null
    Copy-Item -LiteralPath $launcher -Destination (Join-Path $Root 'Obsidian Portable.exe')
    Copy-Directory (Join-Path $expanded 'Package\Maintenance') (Join-Path $portableRoot 'Maintenance')
    Copy-Directory (Join-Path $expanded 'Package\Tools') (Join-Path $portableRoot 'Tools')
    return $version
}

function Copy-ExistingPackage([string]$Root) {
    $sourcePortable = Join-Path $SourcePackageRoot 'Apps\Portables\ObsidianPortable'
    $targetPortable = Join-Path $Root 'Apps\Portables\ObsidianPortable'
    New-Item -ItemType Directory -Force -Path $targetPortable | Out-Null
    foreach ($directory in @('App', 'Data')) { Copy-Directory (Join-Path $sourcePortable $directory) (Join-Path $targetPortable $directory) }
    $manifestPath = Join-Path $sourcePortable 'portable-manifest.json'
    if (Test-Path -LiteralPath $manifestPath) { Copy-Item -LiteralPath $manifestPath -Destination (Join-Path $targetPortable 'portable-manifest.json') }
}

if ($Probe) {
    Save-Status 'checking' 'Bootstrap probe started.'
    Start-Sleep -Milliseconds 250
    Save-Status 'completed' 'Bootstrap probe completed.'
    exit 0
}

try {
    Show-ProgressWindow
    $TargetRoot = Resolve-FullPath $TargetRoot
    $SourceVault = Resolve-FullPath $SourceVault
    if (-not (Test-Path -LiteralPath $SourceVault -PathType Container)) { throw "The source vault is missing: $SourceVault" }
    Assert-SeparatePaths $SourceVault $TargetRoot
    if ($SourcePackageRoot) { $SourcePackageRoot = Resolve-FullPath $SourcePackageRoot; Assert-SeparatePaths $SourcePackageRoot $TargetRoot }
    if (Test-Path -LiteralPath $TargetRoot) { throw 'The destination already contains an Obsidian Portable package. Choose another folder.' }
    $stagingRoot = $TargetRoot + ".opm-staging-$PID"
    if (Test-Path -LiteralPath $stagingRoot) { throw "A setup staging folder already exists: $stagingRoot" }
    New-Item -ItemType Directory -Path $stagingRoot | Out-Null
    $working = Join-Path $stagingRoot '.setup'
    New-Item -ItemType Directory -Path $working | Out-Null
    Save-Status 'checking' "Preparing the portable $($Operation.ToLowerInvariant())."
    $vaultName = [IO.Path]::GetFileName($SourceVault)
    if (-not $vaultName) { $vaultName = 'Vault' }
    $vaultId = [Guid]::NewGuid().ToString('N').Substring(0, 16)
    $frameworkVersion = Install-Framework $stagingRoot $working

    if ($WaitForPid -gt 0) {
        Save-Status 'ready' 'Everything is ready. Obsidian will close, finish the operation, and reopen automatically.' $frameworkVersion
        Wait-Process -Id $WaitForPid -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
    }

    if ($Operation -eq 'Transfer') {
        if (-not $SourcePackageRoot) { throw 'The current portable package location was not provided.' }
        Save-Status 'copying' 'Copying the portable app, settings, plugins, and vault.'
        Copy-ExistingPackage $stagingRoot
    }
    else {
        Save-Status 'copying' 'Copying this vault into the portable package.' $frameworkVersion
    }
    Copy-Directory $SourceVault (Join-Path $stagingRoot "Vault\$vaultName")
    Write-PortableConfiguration $stagingRoot $vaultName $vaultId

    $portableRoot = Join-Path $stagingRoot 'Apps\Portables\ObsidianPortable'
    $manifestPath = Join-Path $portableRoot 'portable-manifest.json'
    $manifest = if (Test-Path -LiteralPath $manifestPath) { Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json } else { New-Object PSObject }
    $manifest | Add-Member -NotePropertyName layoutVersion -NotePropertyValue 3 -Force
    $manifest | Add-Member -NotePropertyName updateMode -NotePropertyValue 'portable-automatic' -Force
    $manifest | Add-Member -NotePropertyName vault -NotePropertyValue "Vault\$vaultName" -Force
    if ($frameworkVersion) { $manifest | Add-Member -NotePropertyName frameworkVersion -NotePropertyValue $frameworkVersion -Force }
    $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
    Remove-Item -LiteralPath $working -Recurse -Force
    Set-Content -LiteralPath (Join-Path $stagingRoot '.opm-created-by-bootstrap') -Value $PID -Encoding Ascii
    Move-Item -LiteralPath $stagingRoot -Destination $TargetRoot

    Save-Status 'installing' 'Verifying the latest signed Obsidian runtime and opening the portable workspace.'
    Close-ProgressWindow
    $helper = Join-Path $TargetRoot 'Apps\Portables\ObsidianPortable\Maintenance\PortableMaintenance.ps1'
    & (Join-Path $PSHOME 'powershell.exe') -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $helper -InstallRuntime -RestartAfter
    if ($LASTEXITCODE -ne 0) { throw 'The signed Obsidian runtime could not be installed or verified.' }
    Remove-Item -LiteralPath (Join-Path $TargetRoot '.opm-created-by-bootstrap') -Force
    exit 0
}
catch {
    Close-ProgressWindow
    if ($stagingRoot -and (Test-Path -LiteralPath $stagingRoot) -and $stagingRoot.StartsWith($TargetRoot + '.opm-staging-', [StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $stagingRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
    $createdMarker = if ($TargetRoot) { Join-Path $TargetRoot '.opm-created-by-bootstrap' } else { $null }
    if ($createdMarker -and (Test-Path -LiteralPath $createdMarker)) {
        Remove-Item -LiteralPath $TargetRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
    try { Save-Status 'failed' $_.Exception.Message } catch {}
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Obsidian Portable Manager', 'OK', 'Error') | Out-Null
    exit 1
}
