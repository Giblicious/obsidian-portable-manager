var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// src/core.js
var require_core = __commonJS({
  "src/core.js"(exports2, module2) {
    var fs2 = require("node:fs");
    var path = require("node:path");
    var MACHINE_NAMES = { 34404: "x64", 43620: "ARM64", 332: "x86" };
    function compareVersions2(left, right) {
      const a = String(left || "0").replace(/^v/, "").split(".").map((value) => Number.parseInt(value, 10) || 0);
      const b = String(right || "0").replace(/^v/, "").split(".").map((value) => Number.parseInt(value, 10) || 0);
      for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
        const difference = (a[index] || 0) - (b[index] || 0);
        if (difference !== 0) return difference;
      }
      return 0;
    }
    function hostArchitecture2(nodeArchitecture = process.arch) {
      return { x64: "x64", arm64: "ARM64", ia32: "x86" }[nodeArchitecture] || nodeArchitecture;
    }
    function readPeMachine2(filePath) {
      const handle = fs2.openSync(filePath, "r");
      try {
        const dosHeader = Buffer.alloc(64);
        if (fs2.readSync(handle, dosHeader, 0, dosHeader.length, 0) !== dosHeader.length) throw new Error("Incomplete DOS header");
        const peOffset = dosHeader.readUInt32LE(60);
        const signature = Buffer.alloc(6);
        if (fs2.readSync(handle, signature, 0, signature.length, peOffset) !== signature.length) throw new Error("Incomplete PE header");
        if (signature.toString("ascii", 0, 4) !== "PE\0\0") throw new Error("Invalid PE signature");
        const code = signature.readUInt16LE(4);
        return MACHINE_NAMES[code] || `0x${code.toString(16).padStart(4, "0")}`;
      } finally {
        fs2.closeSync(handle);
      }
    }
    function portablePaths2(vaultPath) {
      const pathApi = /^[a-z]:[\\/]/i.test(vaultPath) ? path.win32 : path;
      const absoluteVaultPath = pathApi.resolve(vaultPath);
      const driveRoot = pathApi.parse(absoluteVaultPath).root;
      if (!driveRoot) throw new Error("The vault is not on a mounted drive.");
      const portableRoot = pathApi.join(driveRoot, "Apps", "Portables", "ObsidianPortable");
      return {
        vaultPath: absoluteVaultPath,
        driveRoot,
        portableRoot,
        appExe: pathApi.join(portableRoot, "App", "Obsidian.exe"),
        dataPath: pathApi.join(portableRoot, "Data"),
        manifestPath: pathApi.join(portableRoot, "portable-manifest.json"),
        legacyManifestPath: pathApi.join(portableRoot, "manifest.json"),
        helperPath: pathApi.join(portableRoot, "Maintenance", "PortableMaintenance.ps1"),
        legacyHelperPath: pathApi.join(portableRoot, "Maintenance", "Update-ObsidianPortable.ps1"),
        statusPath: pathApi.join(portableRoot, "update-status.json"),
        rootLauncher: pathApi.join(driveRoot, "Obsidian Portable.exe"),
        readmePath: pathApi.join(driveRoot, "README - Obsidian Portable.txt")
      };
    }
    function findReleaseAsset2(release, name) {
      const asset = Array.isArray(release?.assets) ? release.assets.find((candidate) => candidate.name === name) : null;
      if (!asset?.browser_download_url || !Number.isFinite(Number(asset.size))) throw new Error(`Release asset is missing: ${name}`);
      return { name: asset.name, url: String(asset.browser_download_url), size: Number(asset.size) };
    }
    module2.exports = { compareVersions: compareVersions2, findReleaseAsset: findReleaseAsset2, hostArchitecture: hostArchitecture2, portablePaths: portablePaths2, readPeMachine: readPeMachine2 };
  }
});

// framework/Maintenance/PortableMaintenance.ps1
var require_PortableMaintenance = __commonJS({
  "framework/Maintenance/PortableMaintenance.ps1"(exports2, module2) {
    module2.exports = `# FrameworkHelperVersion: 1.3.0
param(
    [switch]$CheckOnly,
    [Alias('InstallLatest')][switch]$InstallRuntime,
    [switch]$InstallFramework,
    [int]$WaitForPid = 0
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$FrameworkRepository = 'Giblicious/obsidian-portable-manager'
$ObsidianRepository = 'obsidianmd/obsidian-releases'

function Read-PortableConfig([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { throw "Portable configuration is missing: $Path" }
    $settings = @{}
    foreach ($rawLine in Get-Content -LiteralPath $Path) {
        $line = $rawLine.Trim()
        if (-not $line -or $line.StartsWith('#') -or $line.StartsWith(';')) { continue }
        $parts = $line -split '=', 2
        if ($parts.Count -eq 2) { $settings[$parts[0].Trim()] = $parts[1].Trim() }
    }
    foreach ($required in @('App', 'Data', 'Vault', 'VaultId')) {
        if (-not $settings[$required]) { throw "portable.ini is missing the $required setting." }
    }
    return $settings
}

function Assert-ChildPath([string]$Parent, [string]$Candidate) {
    $parentFull = [IO.Path]::GetFullPath($Parent).TrimEnd('\\') + '\\'
    $candidateFull = [IO.Path]::GetFullPath($Candidate)
    if (-not $candidateFull.StartsWith($parentFull, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Unsafe maintenance path outside the allowed root: $candidateFull"
    }
    return $candidateFull
}

function Remove-ChildItem([string]$Parent, [string]$Candidate) {
    $checked = Assert-ChildPath $Parent $Candidate
    if (Test-Path -LiteralPath $checked) { Remove-Item -LiteralPath $checked -Recurse -Force }
}

function Save-Status([string]$State, [string]$Scope, [string]$Message, [string]$Version = '') {
    if (-not $script:StatusPath) { return }
    $temporary = $script:StatusPath + '.new'
    [ordered]@{ state = $State; scope = $Scope; message = $Message; version = $Version; timestamp = (Get-Date).ToString('o') } |
        ConvertTo-Json | Set-Content -LiteralPath $temporary -Encoding UTF8
    Move-Item -LiteralPath $temporary -Destination $script:StatusPath -Force
}

function Get-JsonFile([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

function Save-PackageManifest([object]$Manifest) {
    $Manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $script:ManifestPath -Encoding UTF8
}

function Set-ManifestValue([object]$Manifest, [string]$Name, [object]$Value) {
    $Manifest | Add-Member -NotePropertyName $Name -NotePropertyValue $Value -Force
}

function Get-PeMachineCode([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    try {
        $reader = New-Object IO.BinaryReader($stream)
        $stream.Position = 0x3C
        $peOffset = $reader.ReadInt32()
        $stream.Position = $peOffset
        if ($reader.ReadUInt32() -ne 0x00004550) { throw "Invalid PE signature: $Path" }
        return $reader.ReadUInt16()
    }
    finally { $stream.Dispose() }
}

function Get-Release([string]$Repository) {
    $headers = @{ 'User-Agent' = 'Obsidian-Portable-Manager'; 'Accept' = 'application/vnd.github+json' }
    return Invoke-RestMethod -Uri "https://api.github.com/repos/$Repository/releases/latest" -Headers $headers
}

function Get-ReleaseAsset([object]$Release, [string]$Name, [string]$ExpectedPrefix) {
    $asset = $Release.assets | Where-Object { $_.name -eq $Name } | Select-Object -First 1
    if (-not $asset) { throw "Release asset is missing: $Name" }
    if (-not ([string]$asset.browser_download_url).StartsWith($ExpectedPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Release asset URL is outside the trusted repository: $($asset.browser_download_url)"
    }
    return $asset
}

function Download-Asset([object]$Asset, [string]$Destination) {
    & curl.exe -L --fail --retry 3 --silent --show-error -o $Destination $Asset.browser_download_url
    if ($LASTEXITCODE -ne 0) { throw "Download failed with curl exit code $LASTEXITCODE." }
    if ((Get-Item -LiteralPath $Destination).Length -ne [long]$Asset.size) { throw "Downloaded size does not match GitHub for $($Asset.name)." }
}

function Wait-ForPortableObsidian([string]$Scope, [string]$Version) {
    if ($WaitForPid -gt 0) {
        Save-Status 'ready' $Scope 'Update ready.' $Version
        Wait-Process -Id $WaitForPid -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
    }
    $running = Get-CimInstance Win32_Process -Filter "Name='Obsidian.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($script:AppDir, [StringComparison]::OrdinalIgnoreCase) }
    if ($running) { throw 'The portable Obsidian runtime is still open.' }
}

function Install-ObsidianRuntime {
    $scope = 'runtime'
    $release = Get-Release $ObsidianRepository
    $latestText = ([string]$release.tag_name).TrimStart('v')
    $latestVersion = [version]$latestText
    $currentText = (Get-Item -LiteralPath $script:AppExe).VersionInfo.ProductVersion
    $currentVersion = [version]$currentText

    switch ($env:PROCESSOR_ARCHITECTURE.ToUpperInvariant()) {
        'AMD64' { $payloadName = 'app-64.7z'; $expectedMachine = 0x8664; $architectureName = 'x64' }
        'ARM64' { $payloadName = 'app-arm64.7z'; $expectedMachine = 0xAA64; $architectureName = 'ARM64' }
        'X86'   { $payloadName = 'app-32.7z'; $expectedMachine = 0x014C; $architectureName = 'x86' }
        default { throw "Unsupported Windows architecture: $env:PROCESSOR_ARCHITECTURE" }
    }

    $architectureMismatch = (Get-PeMachineCode $script:AppExe) -ne $expectedMachine
    if ($CheckOnly) {
        Write-Host "Installed runtime: $currentText"
        Write-Host "Latest public release: $latestText"
        Write-Host "Required architecture: $architectureName"
        return
    }
    if ($currentVersion -ge $latestVersion -and -not $architectureMismatch) {
        Save-Status 'completed' $scope "Runtime $currentText is already current." $currentText
        return
    }

    $asset = Get-ReleaseAsset $release "Obsidian-$latestText.exe" "https://github.com/$ObsidianRepository/releases/download/"
    $cache = Assert-ChildPath $script:PortableRoot (Join-Path $script:PortableRoot 'UpdateCache\\runtime')
    $stage = Assert-ChildPath $script:PortableRoot (Join-Path $script:PortableRoot 'App.staging')
    $payload = Assert-ChildPath $script:PortableRoot (Join-Path $script:PortableRoot 'UpdatePayload')
    Remove-ChildItem $script:PortableRoot $cache; Remove-ChildItem $script:PortableRoot $stage; Remove-ChildItem $script:PortableRoot $payload
    New-Item -ItemType Directory -Force -Path $cache, $stage, $payload | Out-Null
    $installer = Join-Path $cache $asset.name
    Save-Status 'downloading' $scope "Downloading signed Obsidian $latestText." $latestText
    Download-Asset $asset $installer
    $signature = Get-AuthenticodeSignature -LiteralPath $installer
    $signer = [string]$signature.SignerCertificate.Subject
    if ($signature.Status -ne 'Valid' -or $signer -notmatch 'Dynalist Inc|Obsidian') { throw "Installer signature validation failed. Status: $($signature.Status); signer: $signer" }

    $extractor = Join-Path $script:PortableRoot 'Tools\\7z.exe'
    if (-not (Test-Path -LiteralPath $extractor)) { throw "7-Zip is missing: $extractor" }
    & $extractor e $installer "-o$payload" ('$PLUGINSDIR\\' + $payloadName) -y | Out-Null
    if ($LASTEXITCODE -gt 1) { throw "Architecture payload extraction failed with exit code $LASTEXITCODE." }
    $payloadArchive = Join-Path $payload $payloadName
    if (-not (Test-Path -LiteralPath $payloadArchive)) { throw "The installer did not contain $payloadName." }
    & $extractor x $payloadArchive "-o$stage" -y | Out-Null
    if ($LASTEXITCODE -gt 1) { throw "Runtime extraction failed with exit code $LASTEXITCODE." }

    $newExe = Join-Path $stage 'Obsidian.exe'
    if (-not (Test-Path -LiteralPath $newExe) -or -not (Test-Path -LiteralPath (Join-Path $stage 'resources\\app.asar'))) { throw 'The extracted runtime is incomplete.' }
    $runtimeSignature = Get-AuthenticodeSignature -LiteralPath $newExe
    if ($runtimeSignature.Status -ne 'Valid') { throw 'The extracted Obsidian executable does not have a valid signature.' }
    if ([version](Get-Item -LiteralPath $newExe).VersionInfo.ProductVersion -ne $latestVersion) { throw 'The extracted runtime version does not match the release.' }
    if ((Get-PeMachineCode $newExe) -ne $expectedMachine) { throw 'The extracted runtime has the wrong CPU architecture.' }
    Remove-ChildItem $script:PortableRoot $payload
    Wait-ForPortableObsidian $scope $latestText

    $previous = Assert-ChildPath $script:PortableRoot (Join-Path $script:PortableRoot 'App.previous')
    Remove-ChildItem $script:PortableRoot $previous
    Move-Item -LiteralPath $script:AppDir -Destination $previous
    try { Move-Item -LiteralPath $stage -Destination $script:AppDir }
    catch { if (-not (Test-Path -LiteralPath $script:AppDir) -and (Test-Path -LiteralPath $previous)) { Move-Item -LiteralPath $previous -Destination $script:AppDir }; throw }

    Set-ManifestValue $script:Manifest 'layoutVersion' 2
    Set-ManifestValue $script:Manifest 'installedRuntime' $latestText
    Set-ManifestValue $script:Manifest 'installedArchitecture' $architectureName
    Set-ManifestValue $script:Manifest 'installedAt' (Get-Date).ToString('o')
    Set-ManifestValue $script:Manifest 'source' ([string]$release.html_url)
    Set-ManifestValue $script:Manifest 'app' $script:Config.App
    Set-ManifestValue $script:Manifest 'data' $script:Config.Data
    Set-ManifestValue $script:Manifest 'vault' $script:Config.Vault
    Set-ManifestValue $script:Manifest 'previousRuntime' $currentText
    Save-PackageManifest $script:Manifest
    Remove-ChildItem $script:PortableRoot $cache
    Save-Status 'completed' $scope "Obsidian runtime $latestText installed successfully." $latestText
}

function Install-PortableFramework {
    $scope = 'framework'
    $release = Get-Release $FrameworkRepository
    $latestText = ([string]$release.tag_name).TrimStart('v')
    $currentText = [string]$script:Manifest.frameworkVersion
    if (-not $currentText) { $currentText = '0.0.0' }
    if ($CheckOnly) { Write-Host "Installed framework: $currentText"; Write-Host "Latest framework: $latestText"; return }
    if ([version]$currentText -ge [version]$latestText) { Save-Status 'completed' $scope "Framework $currentText is already current." $currentText; return }

    $prefix = "https://github.com/$FrameworkRepository/releases/download/"
    $zipAsset = Get-ReleaseAsset $release 'portable-framework.zip' $prefix
    $hashAsset = Get-ReleaseAsset $release 'portable-framework.sha256' $prefix
    $cache = Assert-ChildPath $script:PortableRoot (Join-Path $script:PortableRoot 'UpdateCache\\framework')
    $stage = Assert-ChildPath $script:PortableRoot (Join-Path $script:PortableRoot 'Framework.staging')
    Remove-ChildItem $script:PortableRoot $cache; Remove-ChildItem $script:PortableRoot $stage
    New-Item -ItemType Directory -Force -Path $cache, $stage | Out-Null
    $zipPath = Join-Path $cache 'portable-framework.zip'; $hashPath = Join-Path $cache 'portable-framework.sha256'
    Save-Status 'downloading' $scope "Downloading framework $latestText." $latestText
    Download-Asset $zipAsset $zipPath; Download-Asset $hashAsset $hashPath
    $expectedHash = ([regex]::Match((Get-Content -LiteralPath $hashPath -Raw), '(?i)\\b[0-9a-f]{64}\\b')).Value.ToUpperInvariant()
    if (-not $expectedHash) { throw 'The release checksum file is invalid.' }
    $actualHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToUpperInvariant()
    if ($actualHash -ne $expectedHash) { throw 'The framework archive SHA-256 checksum does not match.' }
    Expand-Archive -LiteralPath $zipPath -DestinationPath $stage -Force

    foreach ($forbidden in @('App', 'Data', 'portable.ini', 'portable-manifest.json', 'manifest.json', 'update-status.json')) {
        if (Get-ChildItem -LiteralPath $stage -Recurse -Force | Where-Object { $_.Name -ieq $forbidden }) { throw "Framework archive contains protected content: $forbidden" }
    }
    $frameworkManifest = Get-JsonFile (Join-Path $stage 'framework-manifest.json')
    if (-not $frameworkManifest -or [string]$frameworkManifest.frameworkVersion -ne $latestText) { throw 'Framework manifest version does not match the release tag.' }
    $newLauncher = Join-Path $stage 'Root\\Obsidian Portable.exe'
    $newMaintenance = Join-Path $stage 'Package\\Maintenance'
    $newTools = Join-Path $stage 'Package\\Tools'
    if (-not (Test-Path -LiteralPath $newLauncher) -or -not (Test-Path -LiteralPath (Join-Path $newMaintenance 'PortableMaintenance.ps1')) -or -not (Test-Path -LiteralPath (Join-Path $newTools '7z.exe'))) { throw 'Framework archive is incomplete.' }
    if ((Get-Item -LiteralPath $newLauncher).VersionInfo.FileVersion -ne "\${latestText}.0") { throw 'Launcher version does not match the framework release.' }
    Wait-ForPortableObsidian $scope $latestText

    $launcher = Join-Path $script:DriveRoot 'Obsidian Portable.exe'
    $launcherPrevious = Join-Path $script:DriveRoot 'Obsidian Portable.previous.exe'
    $launcherNew = Join-Path $script:DriveRoot 'Obsidian Portable.new.exe'
    foreach ($rootFile in @($launcher, $launcherPrevious, $launcherNew)) { [void](Assert-ChildPath $script:DriveRoot $rootFile) }
    $maintenance = Assert-ChildPath $script:PortableRoot (Join-Path $script:PortableRoot 'Maintenance')
    $maintenancePrevious = Assert-ChildPath $script:PortableRoot (Join-Path $script:PortableRoot 'Maintenance.previous')
    $maintenanceNew = Assert-ChildPath $script:PortableRoot (Join-Path $script:PortableRoot 'Maintenance.new')
    $tools = Assert-ChildPath $script:PortableRoot (Join-Path $script:PortableRoot 'Tools')
    $toolsPrevious = Assert-ChildPath $script:PortableRoot (Join-Path $script:PortableRoot 'Tools.previous')
    $toolsNew = Assert-ChildPath $script:PortableRoot (Join-Path $script:PortableRoot 'Tools.new')
    Remove-ChildItem $script:DriveRoot $launcherNew; Remove-ChildItem $script:DriveRoot $launcherPrevious
    Remove-ChildItem $script:PortableRoot $maintenanceNew; Remove-ChildItem $script:PortableRoot $maintenancePrevious
    Remove-ChildItem $script:PortableRoot $toolsNew; Remove-ChildItem $script:PortableRoot $toolsPrevious
    Copy-Item -LiteralPath $newLauncher -Destination $launcherNew
    Copy-Item -LiteralPath $newMaintenance -Destination $maintenanceNew -Recurse
    Copy-Item -LiteralPath $newTools -Destination $toolsNew -Recurse

    Save-Status 'installing' $scope 'Installing the launcher and maintenance framework.' $latestText
    try {
        if (Test-Path -LiteralPath $launcher) { Move-Item -LiteralPath $launcher -Destination $launcherPrevious }
        Move-Item -LiteralPath $launcherNew -Destination $launcher
        if (Test-Path -LiteralPath $maintenance) { Move-Item -LiteralPath $maintenance -Destination $maintenancePrevious }
        Move-Item -LiteralPath $maintenanceNew -Destination $maintenance
        if (Test-Path -LiteralPath $tools) { Move-Item -LiteralPath $tools -Destination $toolsPrevious }
        Move-Item -LiteralPath $toolsNew -Destination $tools
    }
    catch {
        if (-not (Test-Path -LiteralPath $launcher) -and (Test-Path -LiteralPath $launcherPrevious)) { Move-Item -LiteralPath $launcherPrevious -Destination $launcher }
        if (-not (Test-Path -LiteralPath $maintenance) -and (Test-Path -LiteralPath $maintenancePrevious)) { Move-Item -LiteralPath $maintenancePrevious -Destination $maintenance }
        if (-not (Test-Path -LiteralPath $tools) -and (Test-Path -LiteralPath $toolsPrevious)) { Move-Item -LiteralPath $toolsPrevious -Destination $tools }
        throw
    }

    Set-ManifestValue $script:Manifest 'layoutVersion' 2
    Set-ManifestValue $script:Manifest 'frameworkVersion' $latestText
    Set-ManifestValue $script:Manifest 'frameworkUpdatedAt' (Get-Date).ToString('o')
    Set-ManifestValue $script:Manifest 'frameworkSource' ([string]$release.html_url)
    Save-PackageManifest $script:Manifest
    Remove-ChildItem $script:PortableRoot $cache; Remove-ChildItem $script:PortableRoot $stage
    Save-Status 'completed' $scope "Portable framework $latestText installed successfully." $latestText
}

try {
    $script:PortableRoot = Split-Path -Parent $PSScriptRoot
    $script:DriveRoot = [IO.Path]::GetPathRoot($script:PortableRoot)
    $script:StatusPath = Join-Path $script:PortableRoot 'update-status.json'
    $script:Config = Read-PortableConfig (Join-Path $script:PortableRoot 'portable.ini')
    $script:AppExe = [IO.Path]::GetFullPath((Join-Path $script:DriveRoot $script:Config.App))
    $script:AppDir = Assert-ChildPath $script:PortableRoot (Split-Path -Parent $script:AppExe)
    if (-not (Test-Path -LiteralPath $script:AppExe)) { throw "Current Obsidian runtime not found: $script:AppExe" }
    $script:ManifestPath = Join-Path $script:PortableRoot 'portable-manifest.json'
    $legacyManifestPath = Join-Path $script:PortableRoot 'manifest.json'
    $script:Manifest = Get-JsonFile $script:ManifestPath
    if (-not $script:Manifest) { $script:Manifest = Get-JsonFile $legacyManifestPath }
    if (-not $script:Manifest) { $script:Manifest = New-Object PSObject }

    if (-not $InstallRuntime -and -not $InstallFramework -and -not $CheckOnly) { throw 'Specify -InstallRuntime, -InstallFramework, or -CheckOnly.' }
    if ($CheckOnly) { Install-ObsidianRuntime; Install-PortableFramework }
    elseif ($InstallFramework) { Install-PortableFramework }
    else { Install-ObsidianRuntime }
    exit 0
}
catch {
    $scope = if ($InstallFramework) { 'framework' } else { 'runtime' }
    Save-Status 'failed' $scope $_.Exception.Message
    Write-Error $_.Exception.Message
    exit 1
}
`;
  }
});

// src/main.js
var { ButtonComponent, Modal, Notice, Platform, Plugin, requestUrl, setIcon } = require("obsidian");
var childProcess = require("node:child_process");
var fs = require("node:fs");
var { shell } = require("electron");
var { compareVersions, findReleaseAsset, hostArchitecture, portablePaths, readPeMachine } = require_core();
var EMBEDDED_MAINTENANCE_HELPER = require_PortableMaintenance();
var OBSIDIAN_RELEASE_API = "https://api.github.com/repos/obsidianmd/obsidian-releases/releases/latest";
var FRAMEWORK_RELEASE_API = "https://api.github.com/repos/Giblicious/obsidian-portable-manager/releases/latest";
module.exports = class ObsidianPortableManager extends Plugin {
  async onload() {
    if (!Platform.isDesktopApp || process.platform !== "win32") return;
    this.addRibbonIcon("package-check", "Obsidian Portable Manager", () => this.openManager());
    this.addCommand({ id: "open-portable-manager", name: "Open portable manager", callback: () => this.openManager() });
    this.app.workspace.onLayoutReady(() => this.reportMaintenanceResult());
  }
  openManager() {
    try {
      this.ensureMaintenanceHelper();
    } catch (error) {
      new Notice(`Portable helper could not be prepared: ${error.message}`, 1e4);
    }
    new PortableManagerModal(this.app, this).open();
  }
  getPaths() {
    const adapter = this.app.vault.adapter;
    const basePath = typeof adapter.getBasePath === "function" ? adapter.getBasePath() : adapter.basePath;
    return portablePaths(basePath);
  }
  readJson(filePath) {
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
    } catch (_) {
      return null;
    }
  }
  ensureMaintenanceHelper() {
    const paths = this.getPaths();
    if (!fs.existsSync(paths.portableRoot) || !fs.existsSync(`${paths.portableRoot}\\portable.ini`)) {
      throw new Error("This vault is not inside a configured Obsidian portable package.");
    }
    const versionOf = (source) => String(source).match(/^# FrameworkHelperVersion:\s*([0-9.]+)/m)?.[1] || "0.0.0";
    const bundledVersion = versionOf(EMBEDDED_MAINTENANCE_HELPER);
    let installedVersion = "0.0.0";
    try {
      installedVersion = versionOf(fs.readFileSync(paths.helperPath, "utf8"));
    } catch (_) {
    }
    if (compareVersions(installedVersion, bundledVersion) >= 0) return paths.helperPath;
    fs.mkdirSync(require("node:path").dirname(paths.helperPath), { recursive: true });
    const temporary = `${paths.helperPath}.new`;
    fs.writeFileSync(temporary, EMBEDDED_MAINTENANCE_HELPER, "utf8");
    fs.renameSync(temporary, paths.helperPath);
    return paths.helperPath;
  }
  getLocalStatus() {
    const paths = this.getPaths();
    const manifest = this.readJson(paths.manifestPath) || this.readJson(paths.legacyManifestPath) || {};
    let runtimeArchitecture = "Unknown";
    try {
      runtimeArchitecture = readPeMachine(paths.appExe);
    } catch (_) {
    }
    const computerArchitecture = hostArchitecture();
    const helperPath = fs.existsSync(paths.helperPath) ? paths.helperPath : paths.legacyHelperPath;
    return {
      paths,
      helperPath,
      manifest,
      runtimeArchitecture,
      computerArchitecture,
      runtimeVersion: String(manifest.installedRuntime || this.app.getVersion?.() || "Unknown"),
      frameworkVersion: String(manifest.frameworkVersion || "0.0.0"),
      architectureMatches: runtimeArchitecture === computerArchitecture,
      healthy: fs.existsSync(paths.appExe) && fs.existsSync(paths.dataPath) && fs.existsSync(helperPath) && fs.existsSync(paths.rootLauncher) && runtimeArchitecture === computerArchitecture,
      updateStatus: this.readJson(paths.statusPath)
    };
  }
  async fetchRelease(url) {
    const response = await requestUrl({ url, method: "GET", headers: { "User-Agent": "Obsidian-Portable-Manager" }, throw: false });
    if (response.status !== 200 || !response.json?.tag_name) throw new Error(`Release check returned HTTP ${response.status}.`);
    return response.json;
  }
  async latestStatus() {
    const [obsidian, framework] = await Promise.all([this.fetchRelease(OBSIDIAN_RELEASE_API), this.fetchRelease(FRAMEWORK_RELEASE_API)]);
    findReleaseAsset(framework, "portable-framework.zip");
    findReleaseAsset(framework, "portable-framework.sha256");
    return {
      runtimeVersion: String(obsidian.tag_name).replace(/^v/, ""),
      frameworkVersion: String(framework.tag_name).replace(/^v/, ""),
      runtimePage: String(obsidian.html_url || ""),
      frameworkPage: String(framework.html_url || "")
    };
  }
  scheduleMaintenance(kind) {
    this.ensureMaintenanceHelper();
    const local = this.getLocalStatus();
    if (!fs.existsSync(local.helperPath)) throw new Error("The portable maintenance helper is missing.");
    const action = kind === "framework" ? "-InstallFramework" : "-InstallRuntime";
    fs.writeFileSync(local.paths.statusPath, JSON.stringify({ state: "scheduled", scope: kind, message: `Preparing the ${kind} update.`, timestamp: (/* @__PURE__ */ new Date()).toISOString() }, null, 2));
    const processHandle = childProcess.spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", local.helperPath, action, "-WaitForPid", String(process.pid)], { detached: true, windowsHide: true, stdio: "ignore" });
    processHandle.unref();
  }
  openPath(targetPath) {
    void shell.openPath(targetPath);
  }
  reportMaintenanceResult() {
    const paths = this.getPaths();
    const status = this.readJson(paths.statusPath);
    if (!status || !["completed", "failed"].includes(status.state)) return;
    new Notice(status.state === "completed" ? status.message : `Portable maintenance failed: ${status.message}`, status.state === "completed" ? 8e3 : 12e3);
    try {
      fs.unlinkSync(paths.statusPath);
    } catch (_) {
    }
  }
};
var PortableManagerModal = class extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.latest = null;
    this.pollTimer = null;
  }
  async onOpen() {
    this.modalEl.addClass("opm-modal");
    this.render();
    await this.check(true);
  }
  onClose() {
    if (this.pollTimer) window.clearInterval(this.pollTimer);
    this.contentEl.empty();
  }
  render() {
    const local = this.plugin.getLocalStatus();
    const { contentEl } = this;
    contentEl.empty();
    const heading = contentEl.createDiv({ cls: "opm-heading" });
    const icon = heading.createDiv({ cls: "opm-logo" });
    setIcon(icon, "package-check");
    const title = heading.createDiv();
    title.createEl("h2", { text: "Obsidian Portable Manager" });
    title.createEl("p", { text: "Runtime, launcher, and maintenance health for this portable workspace." });
    const health = contentEl.createDiv({ cls: `opm-health ${local.healthy ? "is-good" : "is-bad"}` });
    setIcon(health.createSpan(), local.healthy ? "circle-check" : "triangle-alert");
    health.createSpan({ text: local.healthy ? " Portable package healthy" : " Portable package needs attention" });
    const grid = contentEl.createDiv({ cls: "opm-grid" });
    this.addStatus(grid, "Drive", local.paths.driveRoot);
    this.addStatus(grid, "Runtime", `${local.runtimeVersion} (${local.runtimeArchitecture})`);
    this.addStatus(grid, "Computer", local.computerArchitecture);
    this.addStatus(grid, "Framework", local.frameworkVersion);
    this.runtimePanel = this.addUpdatePanel(contentEl, "Obsidian runtime", this.runtimeMessage(local));
    this.addActions(this.runtimePanel, "runtime", this.latest && (compareVersions(this.latest.runtimeVersion, local.runtimeVersion) > 0 || !local.architectureMatches), local.architectureMatches ? "Prepare runtime update" : `Repair ${local.computerArchitecture} runtime`);
    this.frameworkPanel = this.addUpdatePanel(contentEl, "Portable framework", this.frameworkMessage(local));
    this.addActions(this.frameworkPanel, "framework", this.latest && compareVersions(this.latest.frameworkVersion, local.frameworkVersion) > 0, "Prepare framework update");
    const tools = contentEl.createDiv({ cls: "opm-tools" });
    new ButtonComponent(tools).setButtonText("Check again").setIcon("refresh-cw").onClick(() => this.check(false));
    new ButtonComponent(tools).setButtonText("Open portable folder").setIcon("folder-open").onClick(() => this.plugin.openPath(local.paths.portableRoot));
    new ButtonComponent(tools).setButtonText("Open instructions").setIcon("book-open").onClick(() => this.plugin.openPath(local.paths.readmePath));
    if (local.updateStatus && !["completed", "failed"].includes(local.updateStatus.state)) {
      this.showStatus(local.updateStatus);
      this.startPolling();
    }
  }
  addStatus(container, label, value) {
    const item = container.createDiv({ cls: "opm-stat" });
    item.createDiv({ cls: "opm-stat-label", text: label });
    item.createDiv({ cls: "opm-stat-value", text: value });
  }
  addUpdatePanel(container, title, message) {
    const panel = container.createDiv({ cls: "opm-update-panel" });
    panel.createEl("h3", { text: title });
    panel.createEl("p", { text: message });
    panel.createDiv({ cls: "opm-actions" });
    return panel;
  }
  addActions(panel, kind, available, label) {
    if (!available) return;
    new ButtonComponent(panel.querySelector(".opm-actions")).setButtonText(label).setIcon("download").setCta().onClick(() => this.prepare(kind));
  }
  runtimeMessage(local) {
    if (!local.architectureMatches) return `The runtime is incompatible with this computer and needs a ${local.computerArchitecture} repair.`;
    if (!this.latest) return "Checking the official Obsidian release...";
    return compareVersions(this.latest.runtimeVersion, local.runtimeVersion) > 0 ? `Runtime ${this.latest.runtimeVersion} is available; ${local.runtimeVersion} is installed.` : `Runtime ${local.runtimeVersion} is current.`;
  }
  frameworkMessage(local) {
    if (!this.latest) return "Checking the portable framework release...";
    return compareVersions(this.latest.frameworkVersion, local.frameworkVersion) > 0 ? `Framework ${this.latest.frameworkVersion} is available; ${local.frameworkVersion} is installed.` : `Framework ${local.frameworkVersion} is current.`;
  }
  async check(silent) {
    try {
      this.latest = await this.plugin.latestStatus();
      this.render();
      if (!silent) new Notice("Portable update check completed.");
    } catch (error) {
      new Notice(`Update check failed: ${error.message}`, 1e4);
    }
  }
  prepare(kind) {
    try {
      this.plugin.scheduleMaintenance(kind);
      new Notice(`Preparing the ${kind} update in the background.`, 6e3);
      this.showStatus({ state: "scheduled", scope: kind, message: `Preparing the ${kind} update...` });
      this.startPolling();
    } catch (error) {
      new Notice(`Could not start maintenance: ${error.message}`, 1e4);
    }
  }
  startPolling() {
    if (this.pollTimer) return;
    this.pollTimer = window.setInterval(() => {
      const status = this.plugin.readJson(this.plugin.getPaths().statusPath);
      if (!status) return;
      this.showStatus(status);
      if (["completed", "failed"].includes(status.state)) {
        window.clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
    }, 1e3);
  }
  showStatus(status) {
    const panel = status.scope === "framework" ? this.frameworkPanel : this.runtimePanel;
    if (!panel) return;
    let box = panel.querySelector(".opm-state");
    if (!box) box = panel.createDiv({ cls: "opm-state" });
    box.toggleClass("is-failed", status.state === "failed");
    box.setText(status.state === "ready" ? `${status.message} Close Obsidian normally to finish.` : status.message || status.state);
  }
};
