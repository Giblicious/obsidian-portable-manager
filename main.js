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

// src/maintenance.js
var require_maintenance = __commonJS({
  "src/maintenance.js"(exports2, module2) {
    var childProcess = require("node:child_process");
    var fs2 = require("node:fs");
    var path = require("node:path");
    var ACTIVE_STATES = /* @__PURE__ */ new Set(["scheduled", "launching", "checking", "downloading", "ready", "installing"]);
    var LAUNCH_TIMEOUT_MS = 15e3;
    var OPERATION_TIMEOUT_MS = 6 * 60 * 60 * 1e3;
    function statusAgeMs(status, now = Date.now()) {
      const timestamp = Date.parse(String(status?.timestamp || ""));
      return Number.isFinite(timestamp) ? Math.max(0, now - timestamp) : Number.POSITIVE_INFINITY;
    }
    function failedStatus(status, message, now = Date.now()) {
      return { ...status, state: "failed", message, timestamp: new Date(now).toISOString() };
    }
    function recoverMaintenanceStatus2(status, now = Date.now()) {
      if (!status || !ACTIVE_STATES.has(status.state)) return status;
      const age = statusAgeMs(status, now);
      if (["scheduled", "launching"].includes(status.state) && age > LAUNCH_TIMEOUT_MS) {
        return failedStatus(status, "The maintenance process did not start. Retry the update; if it fails again, open diagnostics.", now);
      }
      if (age > OPERATION_TIMEOUT_MS) {
        return failedStatus(status, "The maintenance operation stopped reporting progress and was released. Retry the update.", now);
      }
      return status;
    }
    function isMaintenanceActive2(status, now = Date.now()) {
      return Boolean(recoverMaintenanceStatus2(status, now) && ACTIVE_STATES.has(recoverMaintenanceStatus2(status, now).state));
    }
    function maintenanceWaitPid2(processLike = process) {
      const parent = Number(processLike.ppid);
      const current = Number(processLike.pid);
      return Number.isInteger(parent) && parent > 0 ? parent : current;
    }
    function resolvePowerShellPath(environment = process.env, existsSync = fs2.existsSync) {
      const windowsRoot = environment.SystemRoot || environment.WINDIR;
      if (windowsRoot) {
        const absolute = path.win32.join(windowsRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
        if (existsSync(absolute)) return absolute;
      }
      return "powershell.exe";
    }
    function readStatus(fsApi, statusPath) {
      try {
        return JSON.parse(fsApi.readFileSync(statusPath, "utf8").replace(/^\uFEFF/, ""));
      } catch (_) {
        return null;
      }
    }
    function writeStatus(fsApi, statusPath, status) {
      fsApi.writeFileSync(statusPath, JSON.stringify(status, null, 2), "utf8");
    }
    function launchMaintenance2({
      kind,
      helperPath,
      statusPath,
      waitForPid,
      environment = process.env,
      fsApi = fs2,
      spawn = childProcess.spawn,
      now = () => Date.now(),
      launchTimeoutMs = LAUNCH_TIMEOUT_MS
    }) {
      const existing = recoverMaintenanceStatus2(readStatus(fsApi, statusPath), now());
      if (isMaintenanceActive2(existing, now())) throw new Error(`Another ${existing.scope || "portable"} maintenance operation is already active.`);
      const action = kind === "framework" ? "-InstallFramework" : "-InstallRuntime";
      const scheduled = { state: "scheduled", scope: kind, message: `Starting the ${kind} update helper.`, timestamp: new Date(now()).toISOString() };
      writeStatus(fsApi, statusPath, scheduled);
      let child;
      try {
        child = spawn(resolvePowerShellPath(environment, fsApi.existsSync.bind(fsApi)), [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-WindowStyle",
          "Hidden",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          helperPath,
          action,
          "-WaitForPid",
          String(waitForPid),
          "-Bootstrap"
        ], { detached: false, windowsHide: true, stdio: "ignore" });
      } catch (error) {
        const failed = failedStatus(scheduled, `Could not launch the maintenance helper: ${error.message}`, now());
        writeStatus(fsApi, statusPath, failed);
        throw new Error(failed.message);
      }
      return new Promise((resolve, reject) => {
        let settled = false;
        let poll;
        const failLaunch = (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          clearInterval(poll);
          const message = `Could not launch the maintenance helper: ${error.message}`;
          writeStatus(fsApi, statusPath, failedStatus(scheduled, message, now()));
          reject(new Error(message));
        };
        const timer = setTimeout(() => failLaunch(new Error("Windows did not acknowledge the process launch.")), launchTimeoutMs);
        child.once("error", failLaunch);
        child.once("spawn", () => {
          if (settled) return;
          child.unref();
          poll = setInterval(() => {
            const current = readStatus(fsApi, statusPath);
            if (!current || current.state === "scheduled") return;
            if (current.state === "failed") {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              clearInterval(poll);
              reject(new Error(current.message || "The maintenance helper failed during startup."));
              return;
            }
            settled = true;
            clearTimeout(timer);
            clearInterval(poll);
            resolve({ processId: current.processId || child.pid });
          }, 100);
        });
        child.once("exit", (code) => {
          if (code !== 0) failLaunch(new Error(`The bootstrap process exited with code ${code ?? "unknown"}.`));
        });
      });
    }
    module2.exports = {
      ACTIVE_STATES,
      LAUNCH_TIMEOUT_MS,
      OPERATION_TIMEOUT_MS,
      isMaintenanceActive: isMaintenanceActive2,
      launchMaintenance: launchMaintenance2,
      maintenanceWaitPid: maintenanceWaitPid2,
      recoverMaintenanceStatus: recoverMaintenanceStatus2,
      resolvePowerShellPath,
      statusAgeMs
    };
  }
});

// framework/Maintenance/PortableMaintenance.ps1
var require_PortableMaintenance = __commonJS({
  "framework/Maintenance/PortableMaintenance.ps1"(exports2, module2) {
    module2.exports = `# FrameworkHelperVersion: 1.3.1
param(\r
    [switch]$CheckOnly,\r
    [Alias('InstallLatest')][switch]$InstallRuntime,
    [switch]$InstallFramework,
    [int]$WaitForPid = 0,
    [switch]$Bootstrap
)\r
\r
$ErrorActionPreference = 'Stop'\r
$ProgressPreference = 'SilentlyContinue'\r
$FrameworkRepository = 'Giblicious/obsidian-portable-manager'\r
$ObsidianRepository = 'obsidianmd/obsidian-releases'\r
\r
function Read-PortableConfig([string]$Path) {\r
    if (-not (Test-Path -LiteralPath $Path)) { throw "Portable configuration is missing: $Path" }\r
    $settings = @{}\r
    foreach ($rawLine in Get-Content -LiteralPath $Path) {\r
        $line = $rawLine.Trim()\r
        if (-not $line -or $line.StartsWith('#') -or $line.StartsWith(';')) { continue }\r
        $parts = $line -split '=', 2\r
        if ($parts.Count -eq 2) { $settings[$parts[0].Trim()] = $parts[1].Trim() }\r
    }\r
    foreach ($required in @('App', 'Data', 'Vault', 'VaultId')) {\r
        if (-not $settings[$required]) { throw "portable.ini is missing the $required setting." }\r
    }\r
    return $settings\r
}\r
\r
function Assert-ChildPath([string]$Parent, [string]$Candidate) {\r
    $parentFull = [IO.Path]::GetFullPath($Parent).TrimEnd('\\') + '\\'\r
    $candidateFull = [IO.Path]::GetFullPath($Candidate)\r
    if (-not $candidateFull.StartsWith($parentFull, [StringComparison]::OrdinalIgnoreCase)) {\r
        throw "Unsafe maintenance path outside the allowed root: $candidateFull"\r
    }\r
    return $candidateFull\r
}\r
\r
function Remove-ChildItem([string]$Parent, [string]$Candidate) {\r
    $checked = Assert-ChildPath $Parent $Candidate\r
    if (Test-Path -LiteralPath $checked) { Remove-Item -LiteralPath $checked -Recurse -Force }\r
}\r
\r
function Save-Status([string]$State, [string]$Scope, [string]$Message, [string]$Version = '') {\r
    if (-not $script:StatusPath) { return }\r
    $temporary = $script:StatusPath + ".$PID.new"
    [ordered]@{ state = $State; scope = $Scope; message = $Message; version = $Version; processId = $PID; timestamp = (Get-Date).ToString('o') } |
        ConvertTo-Json | Set-Content -LiteralPath $temporary -Encoding UTF8\r
    Move-Item -LiteralPath $temporary -Destination $script:StatusPath -Force\r
}\r
\r
function Get-JsonFile([string]$Path) {\r
    if (-not (Test-Path -LiteralPath $Path)) { return $null }\r
    return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json\r
}\r
\r
function Save-PackageManifest([object]$Manifest) {\r
    $Manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $script:ManifestPath -Encoding UTF8\r
}\r
\r
function Set-ManifestValue([object]$Manifest, [string]$Name, [object]$Value) {\r
    $Manifest | Add-Member -NotePropertyName $Name -NotePropertyValue $Value -Force\r
}\r
\r
function Get-PeMachineCode([string]$Path) {\r
    $stream = [IO.File]::OpenRead($Path)\r
    try {\r
        $reader = New-Object IO.BinaryReader($stream)\r
        $stream.Position = 0x3C\r
        $peOffset = $reader.ReadInt32()\r
        $stream.Position = $peOffset\r
        if ($reader.ReadUInt32() -ne 0x00004550) { throw "Invalid PE signature: $Path" }\r
        return $reader.ReadUInt16()\r
    }\r
    finally { $stream.Dispose() }\r
}\r
\r
function Get-Release([string]$Repository) {\r
    $headers = @{ 'User-Agent' = 'Obsidian-Portable-Manager'; 'Accept' = 'application/vnd.github+json' }\r
    return Invoke-RestMethod -Uri "https://api.github.com/repos/$Repository/releases/latest" -Headers $headers\r
}\r
\r
function Get-ReleaseAsset([object]$Release, [string]$Name, [string]$ExpectedPrefix) {\r
    $asset = $Release.assets | Where-Object { $_.name -eq $Name } | Select-Object -First 1\r
    if (-not $asset) { throw "Release asset is missing: $Name" }\r
    if (-not ([string]$asset.browser_download_url).StartsWith($ExpectedPrefix, [StringComparison]::OrdinalIgnoreCase)) {\r
        throw "Release asset URL is outside the trusted repository: $($asset.browser_download_url)"\r
    }\r
    return $asset\r
}\r
\r
function Download-Asset([object]$Asset, [string]$Destination) {\r
    & curl.exe -L --fail --retry 3 --silent --show-error -o $Destination $Asset.browser_download_url\r
    if ($LASTEXITCODE -ne 0) { throw "Download failed with curl exit code $LASTEXITCODE." }\r
    if ((Get-Item -LiteralPath $Destination).Length -ne [long]$Asset.size) { throw "Downloaded size does not match GitHub for $($Asset.name)." }\r
}\r
\r
function Wait-ForPortableObsidian([string]$Scope, [string]$Version) {\r
    if ($WaitForPid -gt 0) {\r
        Save-Status 'ready' $Scope 'Update ready.' $Version\r
        Wait-Process -Id $WaitForPid -ErrorAction SilentlyContinue\r
        Start-Sleep -Seconds 2\r
    }\r
    $running = Get-CimInstance Win32_Process -Filter "Name='Obsidian.exe'" -ErrorAction SilentlyContinue |\r
        Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($script:AppDir, [StringComparison]::OrdinalIgnoreCase) }\r
    if ($running) { throw 'The portable Obsidian runtime is still open.' }\r
}\r
\r
function Install-ObsidianRuntime {\r
    $scope = 'runtime'\r
    $release = Get-Release $ObsidianRepository\r
    $latestText = ([string]$release.tag_name).TrimStart('v')\r
    $latestVersion = [version]$latestText\r
    $currentText = (Get-Item -LiteralPath $script:AppExe).VersionInfo.ProductVersion\r
    $currentVersion = [version]$currentText\r
\r
    switch ($env:PROCESSOR_ARCHITECTURE.ToUpperInvariant()) {\r
        'AMD64' { $payloadName = 'app-64.7z'; $expectedMachine = 0x8664; $architectureName = 'x64' }\r
        'ARM64' { $payloadName = 'app-arm64.7z'; $expectedMachine = 0xAA64; $architectureName = 'ARM64' }\r
        'X86'   { $payloadName = 'app-32.7z'; $expectedMachine = 0x014C; $architectureName = 'x86' }\r
        default { throw "Unsupported Windows architecture: $env:PROCESSOR_ARCHITECTURE" }\r
    }\r
\r
    $architectureMismatch = (Get-PeMachineCode $script:AppExe) -ne $expectedMachine\r
    if ($CheckOnly) {\r
        Write-Host "Installed runtime: $currentText"\r
        Write-Host "Latest public release: $latestText"\r
        Write-Host "Required architecture: $architectureName"\r
        return\r
    }\r
    if ($currentVersion -ge $latestVersion -and -not $architectureMismatch) {\r
        Save-Status 'completed' $scope "Runtime $currentText is already current." $currentText\r
        return\r
    }\r
\r
    $asset = Get-ReleaseAsset $release "Obsidian-$latestText.exe" "https://github.com/$ObsidianRepository/releases/download/"\r
    $cache = Assert-ChildPath $script:PortableRoot (Join-Path $script:PortableRoot 'UpdateCache\\runtime')\r
    $stage = Assert-ChildPath $script:PortableRoot (Join-Path $script:PortableRoot 'App.staging')\r
    $payload = Assert-ChildPath $script:PortableRoot (Join-Path $script:PortableRoot 'UpdatePayload')\r
    Remove-ChildItem $script:PortableRoot $cache; Remove-ChildItem $script:PortableRoot $stage; Remove-ChildItem $script:PortableRoot $payload\r
    New-Item -ItemType Directory -Force -Path $cache, $stage, $payload | Out-Null\r
    $installer = Join-Path $cache $asset.name\r
    Save-Status 'downloading' $scope "Downloading signed Obsidian $latestText." $latestText\r
    Download-Asset $asset $installer\r
    $signature = Get-AuthenticodeSignature -LiteralPath $installer\r
    $signer = [string]$signature.SignerCertificate.Subject\r
    if ($signature.Status -ne 'Valid' -or $signer -notmatch 'Dynalist Inc|Obsidian') { throw "Installer signature validation failed. Status: $($signature.Status); signer: $signer" }\r
\r
    $extractor = Join-Path $script:PortableRoot 'Tools\\7z.exe'\r
    if (-not (Test-Path -LiteralPath $extractor)) { throw "7-Zip is missing: $extractor" }\r
    & $extractor e $installer "-o$payload" ('$PLUGINSDIR\\' + $payloadName) -y | Out-Null\r
    if ($LASTEXITCODE -gt 1) { throw "Architecture payload extraction failed with exit code $LASTEXITCODE." }\r
    $payloadArchive = Join-Path $payload $payloadName\r
    if (-not (Test-Path -LiteralPath $payloadArchive)) { throw "The installer did not contain $payloadName." }\r
    & $extractor x $payloadArchive "-o$stage" -y | Out-Null\r
    if ($LASTEXITCODE -gt 1) { throw "Runtime extraction failed with exit code $LASTEXITCODE." }\r
\r
    $newExe = Join-Path $stage 'Obsidian.exe'\r
    if (-not (Test-Path -LiteralPath $newExe) -or -not (Test-Path -LiteralPath (Join-Path $stage 'resources\\app.asar'))) { throw 'The extracted runtime is incomplete.' }\r
    $runtimeSignature = Get-AuthenticodeSignature -LiteralPath $newExe\r
    if ($runtimeSignature.Status -ne 'Valid') { throw 'The extracted Obsidian executable does not have a valid signature.' }\r
    if ([version](Get-Item -LiteralPath $newExe).VersionInfo.ProductVersion -ne $latestVersion) { throw 'The extracted runtime version does not match the release.' }\r
    if ((Get-PeMachineCode $newExe) -ne $expectedMachine) { throw 'The extracted runtime has the wrong CPU architecture.' }\r
    Remove-ChildItem $script:PortableRoot $payload\r
    Wait-ForPortableObsidian $scope $latestText\r
\r
    $previous = Assert-ChildPath $script:PortableRoot (Join-Path $script:PortableRoot 'App.previous')\r
    Remove-ChildItem $script:PortableRoot $previous\r
    Move-Item -LiteralPath $script:AppDir -Destination $previous\r
    try { Move-Item -LiteralPath $stage -Destination $script:AppDir }\r
    catch { if (-not (Test-Path -LiteralPath $script:AppDir) -and (Test-Path -LiteralPath $previous)) { Move-Item -LiteralPath $previous -Destination $script:AppDir }; throw }\r
\r
    Set-ManifestValue $script:Manifest 'layoutVersion' 2\r
    Set-ManifestValue $script:Manifest 'installedRuntime' $latestText\r
    Set-ManifestValue $script:Manifest 'installedArchitecture' $architectureName\r
    Set-ManifestValue $script:Manifest 'installedAt' (Get-Date).ToString('o')\r
    Set-ManifestValue $script:Manifest 'source' ([string]$release.html_url)\r
    Set-ManifestValue $script:Manifest 'app' $script:Config.App\r
    Set-ManifestValue $script:Manifest 'data' $script:Config.Data\r
    Set-ManifestValue $script:Manifest 'vault' $script:Config.Vault\r
    Set-ManifestValue $script:Manifest 'previousRuntime' $currentText\r
    Save-PackageManifest $script:Manifest\r
    Remove-ChildItem $script:PortableRoot $cache\r
    Save-Status 'completed' $scope "Obsidian runtime $latestText installed successfully." $latestText\r
}\r
\r
function Install-PortableFramework {\r
    $scope = 'framework'\r
    $release = Get-Release $FrameworkRepository\r
    $latestText = ([string]$release.tag_name).TrimStart('v')\r
    $currentText = [string]$script:Manifest.frameworkVersion\r
    if (-not $currentText) { $currentText = '0.0.0' }\r
    if ($CheckOnly) { Write-Host "Installed framework: $currentText"; Write-Host "Latest framework: $latestText"; return }\r
    if ([version]$currentText -ge [version]$latestText) { Save-Status 'completed' $scope "Framework $currentText is already current." $currentText; return }\r
\r
    $prefix = "https://github.com/$FrameworkRepository/releases/download/"\r
    $zipAsset = Get-ReleaseAsset $release 'portable-framework.zip' $prefix\r
    $hashAsset = Get-ReleaseAsset $release 'portable-framework.sha256' $prefix\r
    $cache = Assert-ChildPath $script:PortableRoot (Join-Path $script:PortableRoot 'UpdateCache\\framework')\r
    $stage = Assert-ChildPath $script:PortableRoot (Join-Path $script:PortableRoot 'Framework.staging')\r
    Remove-ChildItem $script:PortableRoot $cache; Remove-ChildItem $script:PortableRoot $stage\r
    New-Item -ItemType Directory -Force -Path $cache, $stage | Out-Null\r
    $zipPath = Join-Path $cache 'portable-framework.zip'; $hashPath = Join-Path $cache 'portable-framework.sha256'\r
    Save-Status 'downloading' $scope "Downloading framework $latestText." $latestText\r
    Download-Asset $zipAsset $zipPath; Download-Asset $hashAsset $hashPath\r
    $expectedHash = ([regex]::Match((Get-Content -LiteralPath $hashPath -Raw), '(?i)\\b[0-9a-f]{64}\\b')).Value.ToUpperInvariant()\r
    if (-not $expectedHash) { throw 'The release checksum file is invalid.' }\r
    $actualHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToUpperInvariant()\r
    if ($actualHash -ne $expectedHash) { throw 'The framework archive SHA-256 checksum does not match.' }\r
    Expand-Archive -LiteralPath $zipPath -DestinationPath $stage -Force\r
\r
    foreach ($forbidden in @('App', 'Data', 'portable.ini', 'portable-manifest.json', 'manifest.json', 'update-status.json')) {\r
        if (Get-ChildItem -LiteralPath $stage -Recurse -Force | Where-Object { $_.Name -ieq $forbidden }) { throw "Framework archive contains protected content: $forbidden" }\r
    }\r
    $frameworkManifest = Get-JsonFile (Join-Path $stage 'framework-manifest.json')\r
    if (-not $frameworkManifest -or [string]$frameworkManifest.frameworkVersion -ne $latestText) { throw 'Framework manifest version does not match the release tag.' }\r
    $newLauncher = Join-Path $stage 'Root\\Obsidian Portable.exe'\r
    $newMaintenance = Join-Path $stage 'Package\\Maintenance'\r
    $newTools = Join-Path $stage 'Package\\Tools'\r
    if (-not (Test-Path -LiteralPath $newLauncher) -or -not (Test-Path -LiteralPath (Join-Path $newMaintenance 'PortableMaintenance.ps1')) -or -not (Test-Path -LiteralPath (Join-Path $newTools '7z.exe'))) { throw 'Framework archive is incomplete.' }\r
    if ((Get-Item -LiteralPath $newLauncher).VersionInfo.FileVersion -ne "\${latestText}.0") { throw 'Launcher version does not match the framework release.' }\r
    Wait-ForPortableObsidian $scope $latestText\r
\r
    $launcher = Join-Path $script:DriveRoot 'Obsidian Portable.exe'\r
    $launcherPrevious = Join-Path $script:DriveRoot 'Obsidian Portable.previous.exe'\r
    $launcherNew = Join-Path $script:DriveRoot 'Obsidian Portable.new.exe'\r
    foreach ($rootFile in @($launcher, $launcherPrevious, $launcherNew)) { [void](Assert-ChildPath $script:DriveRoot $rootFile) }\r
    $maintenance = Assert-ChildPath $script:PortableRoot (Join-Path $script:PortableRoot 'Maintenance')\r
    $maintenancePrevious = Assert-ChildPath $script:PortableRoot (Join-Path $script:PortableRoot 'Maintenance.previous')\r
    $maintenanceNew = Assert-ChildPath $script:PortableRoot (Join-Path $script:PortableRoot 'Maintenance.new')\r
    $tools = Assert-ChildPath $script:PortableRoot (Join-Path $script:PortableRoot 'Tools')\r
    $toolsPrevious = Assert-ChildPath $script:PortableRoot (Join-Path $script:PortableRoot 'Tools.previous')\r
    $toolsNew = Assert-ChildPath $script:PortableRoot (Join-Path $script:PortableRoot 'Tools.new')\r
    Remove-ChildItem $script:DriveRoot $launcherNew; Remove-ChildItem $script:DriveRoot $launcherPrevious\r
    Remove-ChildItem $script:PortableRoot $maintenanceNew; Remove-ChildItem $script:PortableRoot $maintenancePrevious\r
    Remove-ChildItem $script:PortableRoot $toolsNew; Remove-ChildItem $script:PortableRoot $toolsPrevious\r
    Copy-Item -LiteralPath $newLauncher -Destination $launcherNew\r
    Copy-Item -LiteralPath $newMaintenance -Destination $maintenanceNew -Recurse\r
    Copy-Item -LiteralPath $newTools -Destination $toolsNew -Recurse\r
\r
    Save-Status 'installing' $scope 'Installing the launcher and maintenance framework.' $latestText\r
    try {\r
        if (Test-Path -LiteralPath $launcher) { Move-Item -LiteralPath $launcher -Destination $launcherPrevious }\r
        Move-Item -LiteralPath $launcherNew -Destination $launcher\r
        if (Test-Path -LiteralPath $maintenance) { Move-Item -LiteralPath $maintenance -Destination $maintenancePrevious }\r
        Move-Item -LiteralPath $maintenanceNew -Destination $maintenance\r
        if (Test-Path -LiteralPath $tools) { Move-Item -LiteralPath $tools -Destination $toolsPrevious }\r
        Move-Item -LiteralPath $toolsNew -Destination $tools\r
    }\r
    catch {\r
        if (-not (Test-Path -LiteralPath $launcher) -and (Test-Path -LiteralPath $launcherPrevious)) { Move-Item -LiteralPath $launcherPrevious -Destination $launcher }\r
        if (-not (Test-Path -LiteralPath $maintenance) -and (Test-Path -LiteralPath $maintenancePrevious)) { Move-Item -LiteralPath $maintenancePrevious -Destination $maintenance }\r
        if (-not (Test-Path -LiteralPath $tools) -and (Test-Path -LiteralPath $toolsPrevious)) { Move-Item -LiteralPath $toolsPrevious -Destination $tools }\r
        throw\r
    }\r
\r
    Set-ManifestValue $script:Manifest 'layoutVersion' 2\r
    Set-ManifestValue $script:Manifest 'frameworkVersion' $latestText\r
    Set-ManifestValue $script:Manifest 'frameworkUpdatedAt' (Get-Date).ToString('o')\r
    Set-ManifestValue $script:Manifest 'frameworkSource' ([string]$release.html_url)\r
    Save-PackageManifest $script:Manifest\r
    Remove-ChildItem $script:PortableRoot $cache; Remove-ChildItem $script:PortableRoot $stage\r
    Save-Status 'completed' $scope "Portable framework $latestText installed successfully." $latestText\r
}\r
\r
try {\r
    $script:PortableRoot = Split-Path -Parent $PSScriptRoot\r
    $script:DriveRoot = [IO.Path]::GetPathRoot($script:PortableRoot)\r
    $script:StatusPath = Join-Path $script:PortableRoot 'update-status.json'\r
    $script:Config = Read-PortableConfig (Join-Path $script:PortableRoot 'portable.ini')\r
    $script:AppExe = [IO.Path]::GetFullPath((Join-Path $script:DriveRoot $script:Config.App))\r
    $script:AppDir = Assert-ChildPath $script:PortableRoot (Split-Path -Parent $script:AppExe)\r
    if (-not (Test-Path -LiteralPath $script:AppExe)) { throw "Current Obsidian runtime not found: $script:AppExe" }\r
    $script:ManifestPath = Join-Path $script:PortableRoot 'portable-manifest.json'\r
    $legacyManifestPath = Join-Path $script:PortableRoot 'manifest.json'\r
    $script:Manifest = Get-JsonFile $script:ManifestPath\r
    if (-not $script:Manifest) { $script:Manifest = Get-JsonFile $legacyManifestPath }\r
    if (-not $script:Manifest) { $script:Manifest = New-Object PSObject }\r
\r
    if (-not $InstallRuntime -and -not $InstallFramework -and -not $CheckOnly) { throw 'Specify -InstallRuntime, -InstallFramework, or -CheckOnly.' }
    if ($Bootstrap) {
        $action = if ($InstallFramework) { '-InstallFramework' } else { '-InstallRuntime' }
        $quotedScript = '"' + $PSCommandPath + '"'
        $arguments = @('-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', $quotedScript, $action, '-WaitForPid', [string]$WaitForPid)
        Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList $arguments -WindowStyle Hidden | Out-Null
        exit 0
    }
    if (-not $CheckOnly) {
        $scope = if ($InstallFramework) { 'framework' } else { 'runtime' }
        Save-Status 'checking' $scope 'Checking trusted release metadata.'
    }
    if ($CheckOnly) { Install-ObsidianRuntime; Install-PortableFramework }\r
    elseif ($InstallFramework) { Install-PortableFramework }\r
    else { Install-ObsidianRuntime }\r
    exit 0\r
}\r
catch {\r
    $scope = if ($InstallFramework) { 'framework' } else { 'runtime' }\r
    Save-Status 'failed' $scope $_.Exception.Message\r
    Write-Error $_.Exception.Message\r
    exit 1\r
}\r
`;
  }
});

// src/main.js
var { ButtonComponent, Modal, Notice, Platform, Plugin, requestUrl, setIcon } = require("obsidian");
var fs = require("node:fs");
var { shell } = require("electron");
var { compareVersions, findReleaseAsset, hostArchitecture, portablePaths, readPeMachine } = require_core();
var { isMaintenanceActive, launchMaintenance, maintenanceWaitPid, recoverMaintenanceStatus } = require_maintenance();
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
  writeJson(filePath, value) {
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
  }
  getMaintenanceStatus(paths = this.getPaths()) {
    const status = this.readJson(paths.statusPath);
    const recovered = recoverMaintenanceStatus(status);
    if (recovered && recovered !== status) this.writeJson(paths.statusPath, recovered);
    return recovered;
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
      updateStatus: this.getMaintenanceStatus(paths)
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
  async scheduleMaintenance(kind) {
    this.ensureMaintenanceHelper();
    const local = this.getLocalStatus();
    if (!fs.existsSync(local.helperPath)) throw new Error("The portable maintenance helper is missing.");
    return launchMaintenance({ kind, helperPath: local.helperPath, statusPath: local.paths.statusPath, waitForPid: maintenanceWaitPid() });
  }
  openPath(targetPath) {
    void shell.openPath(targetPath);
  }
  reportMaintenanceResult() {
    const paths = this.getPaths();
    const status = this.getMaintenanceStatus(paths);
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
    this.starting = false;
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
    const maintenanceActive = this.starting || isMaintenanceActive(local.updateStatus);
    this.runtimePanel = this.addUpdatePanel(contentEl, "Obsidian runtime", this.runtimeMessage(local));
    this.addActions(this.runtimePanel, "runtime", this.latest && (compareVersions(this.latest.runtimeVersion, local.runtimeVersion) > 0 || !local.architectureMatches), local.architectureMatches ? "Prepare runtime update" : `Repair ${local.computerArchitecture} runtime`, maintenanceActive);
    this.frameworkPanel = this.addUpdatePanel(contentEl, "Portable framework", this.frameworkMessage(local));
    this.addActions(this.frameworkPanel, "framework", this.latest && compareVersions(this.latest.frameworkVersion, local.frameworkVersion) > 0, "Prepare framework update", maintenanceActive);
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
  addActions(panel, kind, available, label, disabled) {
    if (!available) return;
    new ButtonComponent(panel.querySelector(".opm-actions")).setButtonText(label).setIcon("download").setCta().setDisabled(disabled).onClick(() => this.prepare(kind));
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
  async prepare(kind) {
    if (this.starting) return;
    this.starting = true;
    this.render();
    try {
      await this.plugin.scheduleMaintenance(kind);
      new Notice(`The ${kind} update helper started.`, 6e3);
      this.startPolling();
    } catch (error) {
      new Notice(`Could not start maintenance: ${error.message}`, 1e4);
    } finally {
      this.starting = false;
      this.render();
    }
  }
  startPolling() {
    if (this.pollTimer) return;
    this.pollTimer = window.setInterval(() => {
      const status = this.plugin.getMaintenanceStatus();
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
