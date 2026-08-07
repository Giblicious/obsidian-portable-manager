var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// src/core.js
var require_core = __commonJS({
  "src/core.js"(exports2, module2) {
    var fs2 = require("node:fs");
    var path2 = require("node:path");
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
    function packagePaths(vaultPath, packageRoot) {
      const pathApi = /^[a-z]:[\\/]/i.test(vaultPath) ? path2.win32 : path2;
      const absoluteVaultPath = pathApi.resolve(vaultPath);
      const absolutePackageRoot = pathApi.resolve(packageRoot);
      const portableRoot = pathApi.join(absolutePackageRoot, "Apps", "Portables", "ObsidianPortable");
      return {
        configured: true,
        vaultPath: absoluteVaultPath,
        packageRoot: absolutePackageRoot,
        driveRoot: pathApi.parse(absolutePackageRoot).root,
        portableRoot,
        appExe: pathApi.join(portableRoot, "App", "Obsidian.exe"),
        dataPath: pathApi.join(portableRoot, "Data"),
        manifestPath: pathApi.join(portableRoot, "portable-manifest.json"),
        legacyManifestPath: pathApi.join(portableRoot, "manifest.json"),
        helperPath: pathApi.join(portableRoot, "Maintenance", "PortableMaintenance.ps1"),
        legacyHelperPath: pathApi.join(portableRoot, "Maintenance", "Update-ObsidianPortable.ps1"),
        statusPath: pathApi.join(portableRoot, "update-status.json"),
        rootLauncher: pathApi.join(absolutePackageRoot, "Obsidian Portable.exe"),
        readmePath: pathApi.join(absolutePackageRoot, "README - Obsidian Portable.txt")
      };
    }
    function readIniValue(source, key) {
      for (const rawLine of String(source || "").split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#") || line.startsWith(";")) continue;
        const separator = line.indexOf("=");
        if (separator > 0 && line.slice(0, separator).trim().toLowerCase() === key.toLowerCase()) return line.slice(separator + 1).trim();
      }
      return null;
    }
    function findPortablePackageRoot(vaultPath, existsSync = fs2.existsSync, readFileSync = fs2.readFileSync) {
      const pathApi = /^[a-z]:[\\/]/i.test(vaultPath) ? path2.win32 : path2;
      const absoluteVaultPath = pathApi.resolve(vaultPath);
      let candidate = absoluteVaultPath;
      const filesystemRoot = pathApi.parse(candidate).root;
      while (candidate) {
        const config = pathApi.join(candidate, "Apps", "Portables", "ObsidianPortable", "portable.ini");
        if (existsSync(config)) {
          try {
            const configuredVault = readIniValue(readFileSync(config, "utf8"), "Vault");
            if (configuredVault && pathApi.resolve(candidate, configuredVault).toLowerCase() === absoluteVaultPath.toLowerCase()) return candidate;
          } catch (_) {
          }
        }
        if (candidate === filesystemRoot) break;
        const parent = pathApi.dirname(candidate);
        if (parent === candidate) break;
        candidate = parent;
      }
      return null;
    }
    function portablePaths2(vaultPath, existsSync = fs2.existsSync, readFileSync = fs2.readFileSync) {
      const packageRoot = findPortablePackageRoot(vaultPath, existsSync, readFileSync);
      if (!packageRoot) {
        const pathApi = /^[a-z]:[\\/]/i.test(vaultPath) ? path2.win32 : path2;
        return { configured: false, vaultPath: pathApi.resolve(vaultPath), packageRoot: null };
      }
      return packagePaths(vaultPath, packageRoot);
    }
    function targetPackageRoot2(selectionPath) {
      const pathApi = /^[a-z]:[\\/]/i.test(selectionPath) ? path2.win32 : path2;
      const selected = pathApi.resolve(selectionPath);
      return pathApi.basename(selected).toLowerCase() === "obsidian portable" ? selected : pathApi.join(selected, "Obsidian Portable");
    }
    function assertSafeTransferTarget2(sourcePath, targetPath) {
      const pathApi = /^[a-z]:[\\/]/i.test(sourcePath) || /^[a-z]:[\\/]/i.test(targetPath) ? path2.win32 : path2;
      const source = pathApi.resolve(sourcePath).replace(/[\\/]+$/, "");
      const target = pathApi.resolve(targetPath).replace(/[\\/]+$/, "");
      const normalizedSource = source.toLowerCase();
      const normalizedTarget = target.toLowerCase();
      if (normalizedSource === normalizedTarget || normalizedTarget.startsWith(`${normalizedSource}${pathApi.sep}`) || normalizedSource.startsWith(`${normalizedTarget}${pathApi.sep}`)) {
        throw new Error("Choose a destination outside the current vault and portable package.");
      }
      return target;
    }
    function findReleaseAsset2(release, name) {
      const asset = Array.isArray(release?.assets) ? release.assets.find((candidate) => candidate.name === name) : null;
      if (!asset?.browser_download_url || !Number.isFinite(Number(asset.size))) throw new Error(`Release asset is missing: ${name}`);
      return { name: asset.name, url: String(asset.browser_download_url), size: Number(asset.size) };
    }
    module2.exports = { assertSafeTransferTarget: assertSafeTransferTarget2, compareVersions: compareVersions2, findPortablePackageRoot, findReleaseAsset: findReleaseAsset2, hostArchitecture: hostArchitecture2, packagePaths, portablePaths: portablePaths2, readPeMachine: readPeMachine2, targetPackageRoot: targetPackageRoot2 };
  }
});

// src/maintenance.js
var require_maintenance = __commonJS({
  "src/maintenance.js"(exports2, module2) {
    var childProcess = require("node:child_process");
    var fs2 = require("node:fs");
    var path2 = require("node:path");
    var ACTIVE_STATES = /* @__PURE__ */ new Set(["scheduled", "launching", "checking", "downloading", "copying", "ready", "installing"]);
    var LAUNCH_TIMEOUT_MS = 15e3;
    var OPERATION_TIMEOUT_MS = 6 * 60 * 60 * 1e3;
    function isProcessRunning(processId, probe = process.kill) {
      const pid = Number(processId);
      if (!Number.isInteger(pid) || pid <= 0) return false;
      try {
        probe(pid, 0);
        return true;
      } catch (error) {
        return error?.code === "EPERM";
      }
    }
    function statusAgeMs(status, now = Date.now()) {
      const timestamp = Date.parse(String(status?.timestamp || ""));
      return Number.isFinite(timestamp) ? Math.max(0, now - timestamp) : Number.POSITIVE_INFINITY;
    }
    function failedStatus(status, message, now = Date.now()) {
      return { ...status, state: "failed", message, timestamp: new Date(now).toISOString() };
    }
    function recoverMaintenanceStatus2(status, now = Date.now(), processRunning = isProcessRunning) {
      if (!status || !ACTIVE_STATES.has(status.state)) return status;
      const age = statusAgeMs(status, now);
      if (["scheduled", "launching"].includes(status.state) && age > LAUNCH_TIMEOUT_MS) {
        return failedStatus(status, "The maintenance process did not start. Retry the update; if it fails again, open diagnostics.", now);
      }
      if (status.state === "ready") {
        if (status.processId && processRunning(status.processId)) return status;
        if (status.processId || age > OPERATION_TIMEOUT_MS) return failedStatus(status, "The prepared update is no longer running. Retry the update.", now);
        return status;
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
        const absolute = path2.win32.join(windowsRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
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
      fsApi.mkdirSync(path2.dirname(statusPath), { recursive: true });
      fsApi.writeFileSync(statusPath, JSON.stringify(status, null, 2), "utf8");
    }
    function launchPortableOperation2({
      scope,
      scriptPath,
      statusPath,
      scriptArguments,
      environment = process.env,
      fsApi = fs2,
      spawn = childProcess.spawn,
      now = () => Date.now(),
      launchTimeoutMs = LAUNCH_TIMEOUT_MS,
      acknowledgeStates = null
    }) {
      const existing = recoverMaintenanceStatus2(readStatus(fsApi, statusPath), now());
      if (isMaintenanceActive2(existing, now())) throw new Error(`Another ${existing.scope || "portable"} operation is already active.`);
      const scheduled = { state: "scheduled", scope, message: `Starting the ${scope} helper.`, timestamp: new Date(now()).toISOString() };
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
          scriptPath,
          ...scriptArguments
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
            clearTimeout(timer);
            if (current.state === "failed") {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              clearInterval(poll);
              reject(new Error(current.message || "The maintenance helper failed during startup."));
              return;
            }
            if (Array.isArray(acknowledgeStates) && !acknowledgeStates.includes(current.state)) return;
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
    function launchMaintenance2({ kind, helperPath, statusPath, waitForPid, restartAfter = false, ...dependencies }) {
      const action = kind === "framework" ? "-InstallFramework" : kind === "runtime" ? "-InstallRuntime" : "-InstallAll";
      const scriptArguments = [action, "-WaitForPid", String(waitForPid), "-Bootstrap"];
      if (restartAfter) scriptArguments.push("-RestartAfter");
      return launchPortableOperation2({ scope: kind, scriptPath: helperPath, statusPath, scriptArguments, ...dependencies });
    }
    module2.exports = {
      ACTIVE_STATES,
      LAUNCH_TIMEOUT_MS,
      OPERATION_TIMEOUT_MS,
      isMaintenanceActive: isMaintenanceActive2,
      isProcessRunning,
      launchMaintenance: launchMaintenance2,
      launchPortableOperation: launchPortableOperation2,
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
    module2.exports = `# FrameworkHelperVersion: 1.3.2
param(\r
    [switch]$CheckOnly,
    [Alias('InstallLatest')][switch]$InstallRuntime,
    [switch]$InstallFramework,
    [switch]$InstallAll,
    [int]$WaitForPid = 0,
    [switch]$RestartAfter,
    [switch]$Bootstrap
)\r
\r
$ErrorActionPreference = 'Stop'\r
$ProgressPreference = 'SilentlyContinue'\r
$FrameworkRepository = 'Giblicious/obsidian-portable-manager'
$ObsidianRepository = 'obsidianmd/obsidian-releases'
$script:ProgressForm = $null
$script:ProgressLabel = $null
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
function Save-Status([string]$State, [string]$Scope, [string]$Message, [string]$Version = '') {
    if (-not $script:StatusPath) { return }\r
    $temporary = $script:StatusPath + ".$PID.new"\r
    [ordered]@{ state = $State; scope = $Scope; message = $Message; version = $Version; processId = $PID; timestamp = (Get-Date).ToString('o') } |\r
        ConvertTo-Json | Set-Content -LiteralPath $temporary -Encoding UTF8\r
    Move-Item -LiteralPath $temporary -Destination $script:StatusPath -Force
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
    $title.Text = 'Updating Obsidian Portable'
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
function Install-ObsidianRuntime {
    $scope = 'runtime'\r
    $release = Get-Release $ObsidianRepository\r
    $latestText = ([string]$release.tag_name).TrimStart('v')\r
    $latestVersion = [version]$latestText\r
    $currentText = if (Test-Path -LiteralPath $script:AppExe) { (Get-Item -LiteralPath $script:AppExe).VersionInfo.ProductVersion } else { '0.0.0' }
    $currentVersion = [version]$currentText
\r
    switch ($env:PROCESSOR_ARCHITECTURE.ToUpperInvariant()) {\r
        'AMD64' { $payloadName = 'app-64.7z'; $expectedMachine = 0x8664; $architectureName = 'x64' }\r
        'ARM64' { $payloadName = 'app-arm64.7z'; $expectedMachine = 0xAA64; $architectureName = 'ARM64' }\r
        'X86'   { $payloadName = 'app-32.7z'; $expectedMachine = 0x014C; $architectureName = 'x86' }\r
        default { throw "Unsupported Windows architecture: $env:PROCESSOR_ARCHITECTURE" }\r
    }\r
\r
    $architectureMismatch = -not (Test-Path -LiteralPath $script:AppExe) -or (Get-PeMachineCode $script:AppExe) -ne $expectedMachine
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
    if (Test-Path -LiteralPath $script:AppDir) { Move-Item -LiteralPath $script:AppDir -Destination $previous }
    try { Move-Item -LiteralPath $stage -Destination $script:AppDir }\r
    catch { if (-not (Test-Path -LiteralPath $script:AppDir) -and (Test-Path -LiteralPath $previous)) { Move-Item -LiteralPath $previous -Destination $script:AppDir }; throw }\r
\r
    Set-ManifestValue $script:Manifest 'layoutVersion' 3
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
    $launcher = Join-Path $script:PackageRoot 'Obsidian Portable.exe'
    $launcherPrevious = Join-Path $script:PackageRoot 'Obsidian Portable.previous.exe'
    $launcherNew = Join-Path $script:PackageRoot 'Obsidian Portable.new.exe'
    foreach ($rootFile in @($launcher, $launcherPrevious, $launcherNew)) { [void](Assert-ChildPath $script:PackageRoot $rootFile) }
    $maintenance = Assert-ChildPath $script:PortableRoot (Join-Path $script:PortableRoot 'Maintenance')\r
    $maintenancePrevious = Assert-ChildPath $script:PortableRoot (Join-Path $script:PortableRoot 'Maintenance.previous')\r
    $maintenanceNew = Assert-ChildPath $script:PortableRoot (Join-Path $script:PortableRoot 'Maintenance.new')\r
    $tools = Assert-ChildPath $script:PortableRoot (Join-Path $script:PortableRoot 'Tools')\r
    $toolsPrevious = Assert-ChildPath $script:PortableRoot (Join-Path $script:PortableRoot 'Tools.previous')\r
    $toolsNew = Assert-ChildPath $script:PortableRoot (Join-Path $script:PortableRoot 'Tools.new')\r
    Remove-ChildItem $script:PackageRoot $launcherNew; Remove-ChildItem $script:PackageRoot $launcherPrevious
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
    Set-ManifestValue $script:Manifest 'layoutVersion' 3
    Set-ManifestValue $script:Manifest 'frameworkVersion' $latestText\r
    Set-ManifestValue $script:Manifest 'frameworkUpdatedAt' (Get-Date).ToString('o')\r
    Set-ManifestValue $script:Manifest 'frameworkSource' ([string]$release.html_url)\r
    Save-PackageManifest $script:Manifest\r
    Remove-ChildItem $script:PortableRoot $cache; Remove-ChildItem $script:PortableRoot $stage\r
    Save-Status 'completed' $scope "Portable framework $latestText installed successfully." $latestText\r
}\r
\r
try {
    $script:PortableRoot = Split-Path -Parent $PSScriptRoot
    $script:PackageRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $script:PortableRoot))
    $script:StatusPath = Join-Path $script:PortableRoot 'update-status.json'
    $script:Config = Read-PortableConfig (Join-Path $script:PortableRoot 'portable.ini')
    $script:AppExe = [IO.Path]::GetFullPath((Join-Path $script:PackageRoot $script:Config.App))
    $script:AppDir = Assert-ChildPath $script:PortableRoot (Split-Path -Parent $script:AppExe)
    $script:ManifestPath = Join-Path $script:PortableRoot 'portable-manifest.json'\r
    $legacyManifestPath = Join-Path $script:PortableRoot 'manifest.json'\r
    $script:Manifest = Get-JsonFile $script:ManifestPath\r
    if (-not $script:Manifest) { $script:Manifest = Get-JsonFile $legacyManifestPath }\r
    if (-not $script:Manifest) { $script:Manifest = New-Object PSObject }\r
\r
    if (-not $InstallRuntime -and -not $InstallFramework -and -not $InstallAll -and -not $CheckOnly) { throw 'Specify -InstallRuntime, -InstallFramework, -InstallAll, or -CheckOnly.' }
    if ($Bootstrap) {
        $action = if ($InstallAll) { '-InstallAll' } elseif ($InstallFramework) { '-InstallFramework' } else { '-InstallRuntime' }
        $quotedScript = '"' + $PSCommandPath + '"'
        $arguments = @('-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', $quotedScript, $action, '-WaitForPid', [string]$WaitForPid)
        if ($RestartAfter) { $arguments += '-RestartAfter' }
        Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList $arguments -WindowStyle Hidden | Out-Null
        exit 0
    }
    if ($RestartAfter) { Show-ProgressWindow }
    if (-not $CheckOnly) {\r
        $scope = if ($InstallAll) { 'all' } elseif ($InstallFramework) { 'framework' } else { 'runtime' }
        Save-Status 'checking' $scope 'Checking trusted release metadata.'
    }
    if ($CheckOnly) { Install-ObsidianRuntime; Install-PortableFramework }
    elseif ($InstallAll) { Install-PortableFramework; Install-ObsidianRuntime }
    elseif ($InstallFramework) { Install-PortableFramework }
    else { Install-ObsidianRuntime }
    if ($RestartAfter) { Close-ProgressWindow; Start-Process -FilePath (Join-Path $script:PackageRoot 'Obsidian Portable.exe') | Out-Null }
    exit 0
}
catch {
    Close-ProgressWindow
    $scope = if ($InstallAll) { 'all' } elseif ($InstallFramework) { 'framework' } else { 'runtime' }
    Save-Status 'failed' $scope $_.Exception.Message
    if ($RestartAfter) { Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Obsidian Portable Manager', 'OK', 'Error') | Out-Null }
    Write-Error $_.Exception.Message\r
    exit 1\r
}\r
`;
  }
});

// framework/Maintenance/PortableBootstrap.ps1
var require_PortableBootstrap = __commonJS({
  "framework/Maintenance/PortableBootstrap.ps1"(exports2, module2) {
    module2.exports = `# FrameworkBootstrapVersion: 1.3.2
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

function Quote-ProcessArgument([string]$Value) { return '"' + $Value.Replace('"', '\\"') + '"' }

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
    return [IO.Path]::GetFullPath($Value).TrimEnd('\\')
}

function Assert-SeparatePaths([string]$Source, [string]$Target) {
    $sourceFull = (Resolve-FullPath $Source) + '\\'
    $targetFull = (Resolve-FullPath $Target) + '\\'
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
    $portableRoot = Join-Path $Root 'Apps\\Portables\\ObsidianPortable'
    $config = @(
        '# Managed by Obsidian Portable Manager. Paths are relative to this package.',
        'App=Apps\\Portables\\ObsidianPortable\\App\\Obsidian.exe',
        'Data=Apps\\Portables\\ObsidianPortable\\Data',
        "Vault=Vault\\$VaultName",
        "VaultId=$VaultId"
    ) -join "\`r\`n"
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
    $expectedHash = ([regex]::Match((Get-Content -LiteralPath $hashPath -Raw), '(?i)\\b[0-9a-f]{64}\\b')).Value.ToUpperInvariant()
    $actualHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToUpperInvariant()
    if (-not $expectedHash -or $actualHash -ne $expectedHash) { throw 'The portable framework checksum did not match.' }
    $expanded = Join-Path $WorkingDirectory 'framework'
    Expand-Archive -LiteralPath $zipPath -DestinationPath $expanded -Force
    foreach ($forbidden in @('App', 'Data', 'portable.ini', 'portable-manifest.json', 'manifest.json', 'update-status.json')) {
        if (Get-ChildItem -LiteralPath $expanded -Recurse -Force | Where-Object { $_.Name -ieq $forbidden }) { throw "Framework archive contains protected content: $forbidden" }
    }
    $manifest = Get-Content -LiteralPath (Join-Path $expanded 'framework-manifest.json') -Raw | ConvertFrom-Json
    if ([string]$manifest.frameworkVersion -ne $version) { throw 'Framework manifest version does not match its release.' }
    $launcher = Join-Path $expanded 'Root\\Obsidian Portable.exe'
    if ((Get-Item -LiteralPath $launcher).VersionInfo.FileVersion -ne "\${version}.0") { throw 'Launcher version does not match the framework release.' }
    $portableRoot = Join-Path $Root 'Apps\\Portables\\ObsidianPortable'
    New-Item -ItemType Directory -Force -Path $portableRoot | Out-Null
    Copy-Item -LiteralPath $launcher -Destination (Join-Path $Root 'Obsidian Portable.exe')
    Copy-Directory (Join-Path $expanded 'Package\\Maintenance') (Join-Path $portableRoot 'Maintenance')
    Copy-Directory (Join-Path $expanded 'Package\\Tools') (Join-Path $portableRoot 'Tools')
    return $version
}

function Copy-ExistingPackage([string]$Root) {
    $sourcePortable = Join-Path $SourcePackageRoot 'Apps\\Portables\\ObsidianPortable'
    $targetPortable = Join-Path $Root 'Apps\\Portables\\ObsidianPortable'
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
    Copy-Directory $SourceVault (Join-Path $stagingRoot "Vault\\$vaultName")
    Write-PortableConfiguration $stagingRoot $vaultName $vaultId

    $portableRoot = Join-Path $stagingRoot 'Apps\\Portables\\ObsidianPortable'
    $manifestPath = Join-Path $portableRoot 'portable-manifest.json'
    $manifest = if (Test-Path -LiteralPath $manifestPath) { Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json } else { New-Object PSObject }
    $manifest | Add-Member -NotePropertyName layoutVersion -NotePropertyValue 3 -Force
    $manifest | Add-Member -NotePropertyName updateMode -NotePropertyValue 'portable-automatic' -Force
    $manifest | Add-Member -NotePropertyName vault -NotePropertyValue "Vault\\$vaultName" -Force
    if ($frameworkVersion) { $manifest | Add-Member -NotePropertyName frameworkVersion -NotePropertyValue $frameworkVersion -Force }
    $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
    Remove-Item -LiteralPath $working -Recurse -Force
    Set-Content -LiteralPath (Join-Path $stagingRoot '.opm-created-by-bootstrap') -Value $PID -Encoding Ascii
    Move-Item -LiteralPath $stagingRoot -Destination $TargetRoot

    Save-Status 'installing' 'Verifying the latest signed Obsidian runtime and opening the portable workspace.'
    Close-ProgressWindow
    $helper = Join-Path $TargetRoot 'Apps\\Portables\\ObsidianPortable\\Maintenance\\PortableMaintenance.ps1'
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
`;
  }
});

// src/main.js
var { ButtonComponent, Modal, Notice, Platform, Plugin, requestUrl, setIcon } = require("obsidian");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");
var electron = require("electron");
var shell = electron.shell;
var desktopDialog = electron.dialog || electron.remote?.dialog;
var electronApp = electron.app || electron.remote?.app;
var { assertSafeTransferTarget, compareVersions, findReleaseAsset, hostArchitecture, portablePaths, readPeMachine, targetPackageRoot } = require_core();
var { isMaintenanceActive, launchMaintenance, launchPortableOperation, maintenanceWaitPid, recoverMaintenanceStatus } = require_maintenance();
var EMBEDDED_MAINTENANCE_HELPER = require_PortableMaintenance();
var EMBEDDED_BOOTSTRAP_HELPER = require_PortableBootstrap();
var OBSIDIAN_RELEASE_API = "https://api.github.com/repos/obsidianmd/obsidian-releases/releases/latest";
var FRAMEWORK_RELEASE_API = "https://api.github.com/repos/Giblicious/obsidian-portable-manager/releases/latest";
var AUTO_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1e3;
module.exports = class ObsidianPortableManager extends Plugin {
  async onload() {
    if (!Platform.isDesktopApp || process.platform !== "win32") return;
    this.settings = Object.assign({ automaticMaintenance: true, lastAutomaticCheck: 0 }, await this.loadData());
    this.addRibbonIcon("package-check", "Obsidian Portable Manager", () => this.openManager());
    this.addCommand({ id: "open-portable-manager", name: "Open portable manager", callback: () => this.openManager() });
    this.app.workspace.onLayoutReady(async () => {
      const paths = this.getPaths();
      if (!paths.configured) this.openManager();
      else {
        this.reportMaintenanceResult();
        await this.maybeScheduleAutomaticMaintenance();
      }
    });
  }
  openManager() {
    new PortableManagerModal(this.app, this).open();
  }
  getVaultPath() {
    const adapter = this.app.vault.adapter;
    return typeof adapter.getBasePath === "function" ? adapter.getBasePath() : adapter.basePath;
  }
  getPaths() {
    return portablePaths(this.getVaultPath());
  }
  readJson(filePath) {
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
    } catch (_) {
      return null;
    }
  }
  writeJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
  }
  getMaintenanceStatus(paths = this.getPaths()) {
    if (!paths.configured) return null;
    const status = this.readJson(paths.statusPath);
    const recovered = recoverMaintenanceStatus(status);
    if (recovered && recovered !== status) this.writeJson(paths.statusPath, recovered);
    return recovered;
  }
  ensureMaintenanceHelper() {
    const paths = this.getPaths();
    if (!paths.configured || !fs.existsSync(`${paths.portableRoot}\\portable.ini`)) throw new Error("This vault is not inside a portable package yet.");
    const versionOf = (source) => String(source).match(/^# FrameworkHelperVersion:\s*([0-9.]+)/m)?.[1] || "0.0.0";
    const bundledVersion = versionOf(EMBEDDED_MAINTENANCE_HELPER);
    let installedVersion = "0.0.0";
    try {
      installedVersion = versionOf(fs.readFileSync(paths.helperPath, "utf8"));
    } catch (_) {
    }
    if (compareVersions(installedVersion, bundledVersion) >= 0) return paths.helperPath;
    fs.mkdirSync(path.dirname(paths.helperPath), { recursive: true });
    const temporary = `${paths.helperPath}.new`;
    fs.writeFileSync(temporary, EMBEDDED_MAINTENANCE_HELPER, "utf8");
    fs.renameSync(temporary, paths.helperPath);
    return paths.helperPath;
  }
  getLocalStatus() {
    const paths = this.getPaths();
    if (!paths.configured) return { paths, healthy: false, configured: false, updateStatus: null };
    const manifest = this.readJson(paths.manifestPath) || this.readJson(paths.legacyManifestPath) || {};
    let runtimeArchitecture = "Unknown";
    try {
      runtimeArchitecture = readPeMachine(paths.appExe);
    } catch (_) {
    }
    const computerArchitecture = hostArchitecture();
    const helperPath = fs.existsSync(paths.helperPath) ? paths.helperPath : paths.legacyHelperPath;
    return {
      configured: true,
      paths,
      helperPath,
      manifest,
      runtimeArchitecture,
      computerArchitecture,
      runtimeVersion: String(manifest.installedRuntime || "Unknown"),
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
      frameworkVersion: String(framework.tag_name).replace(/^v/, "")
    };
  }
  async scheduleMaintenance({ restartAfter = false } = {}) {
    const helperPath = this.ensureMaintenanceHelper();
    const local = this.getLocalStatus();
    if (isMaintenanceActive(local.updateStatus)) return { alreadyActive: true };
    return launchMaintenance({ kind: "all", helperPath, statusPath: local.paths.statusPath, waitForPid: maintenanceWaitPid(), restartAfter });
  }
  async maybeScheduleAutomaticMaintenance() {
    if (!this.settings.automaticMaintenance || Date.now() - this.settings.lastAutomaticCheck < AUTO_CHECK_INTERVAL_MS) return;
    this.settings.lastAutomaticCheck = Date.now();
    await this.saveData(this.settings);
    try {
      const local = this.getLocalStatus();
      if (!local.configured || isMaintenanceActive(local.updateStatus)) return;
      const latest = await this.latestStatus();
      if (!local.healthy || compareVersions(latest.runtimeVersion, local.runtimeVersion) > 0 || compareVersions(latest.frameworkVersion, local.frameworkVersion) > 0) {
        await this.scheduleMaintenance();
        new Notice("Portable update prepared. It will install automatically after you close Obsidian.", 8e3);
      }
    } catch (_) {
    }
  }
  prepareBootstrapScript() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-portable-manager-"));
    const scriptPath = path.join(directory, "PortableBootstrap.ps1");
    const statusPath = path.join(directory, "operation-status.json");
    fs.writeFileSync(scriptPath, EMBEDDED_BOOTSTRAP_HELPER, "utf8");
    return { directory, scriptPath, statusPath };
  }
  async chooseDestination(operation) {
    if (!desktopDialog) throw new Error("The Windows folder picker is unavailable. Restart Obsidian and try again.");
    const options = { title: operation === "Setup" ? "Choose where to create Obsidian Portable" : "Choose where to copy Obsidian Portable", properties: ["openDirectory", "createDirectory", "dontAddToRecent"] };
    if (typeof desktopDialog.showOpenDialogSync === "function") {
      const selected = desktopDialog.showOpenDialogSync(options);
      return selected?.[0] ? targetPackageRoot(selected[0]) : null;
    }
    const result = await desktopDialog.showOpenDialog(options);
    return !result.canceled && result.filePaths?.[0] ? targetPackageRoot(result.filePaths[0]) : null;
  }
  async startBootstrap(operation) {
    const sourceVault = this.getVaultPath();
    const local = this.getLocalStatus();
    const targetRoot = await this.chooseDestination(operation);
    if (!targetRoot) return false;
    assertSafeTransferTarget(sourceVault, targetRoot);
    if (operation === "Transfer") {
      if (!local.configured) throw new Error("This vault is not inside a portable package.");
      assertSafeTransferTarget(local.paths.packageRoot, targetRoot);
    }
    const bootstrap = this.prepareBootstrapScript();
    const scriptArguments = [
      "-Operation",
      operation,
      "-TargetRoot",
      targetRoot,
      "-SourceVault",
      sourceVault,
      "-StatusPath",
      bootstrap.statusPath,
      "-WaitForPid",
      String(maintenanceWaitPid()),
      "-Bootstrap"
    ];
    if (operation === "Transfer") scriptArguments.push("-SourcePackageRoot", local.paths.packageRoot);
    await launchPortableOperation({ scope: operation.toLowerCase(), scriptPath: bootstrap.scriptPath, statusPath: bootstrap.statusPath, scriptArguments, acknowledgeStates: ["ready"] });
    new Notice("Obsidian will close now, finish the portable operation, and reopen from the destination.", 8e3);
    this.requestQuit();
    return true;
  }
  async updateAndRestart() {
    await this.scheduleMaintenance({ restartAfter: true });
    new Notice("Obsidian will close, update safely, and reopen automatically.", 7e3);
    this.requestQuit();
  }
  requestQuit() {
    if (electronApp && typeof electronApp.quit === "function") return electronApp.quit();
    try {
      if (this.app.commands?.executeCommandById?.("app:quit")) return;
    } catch (_) {
    }
    window.close();
  }
  openPath(targetPath) {
    void shell.openPath(targetPath);
  }
  reportMaintenanceResult() {
    const paths = this.getPaths();
    if (!paths.configured) return;
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
    this.busy = false;
  }
  async onOpen() {
    this.modalEl.addClass("opm-modal");
    this.render();
    if (this.plugin.getPaths().configured) await this.check();
  }
  onClose() {
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
    title.createEl("h2", { text: local.configured ? "Obsidian Portable" : "Make this vault portable" });
    title.createEl("p", { text: local.configured ? "Automatic app, runtime, and launcher care\u2014kept inside this portable package." : "Choose a flash drive or folder. The manager handles everything else." });
    if (!local.configured) return this.renderSetup(contentEl);
    const health = contentEl.createDiv({ cls: `opm-health ${local.healthy ? "is-good" : "is-bad"}` });
    setIcon(health.createSpan(), local.healthy ? "circle-check" : "triangle-alert");
    health.createSpan({ text: local.healthy ? " Ready and portable" : " Automatic repair is needed" });
    const promise = contentEl.createDiv({ cls: "opm-promise" });
    promise.createEl("strong", { text: "Updates are automatic" });
    promise.createEl("p", { text: "Obsidian\u2019s built-in app updates stay inside the portable Data folder. Portable Manager safely handles the runtime and launcher after you close Obsidian." });
    const grid = contentEl.createDiv({ cls: "opm-grid" });
    this.addStatus(grid, "Location", local.paths.packageRoot);
    this.addStatus(grid, "Obsidian runtime", `${local.runtimeVersion} \xB7 ${local.runtimeArchitecture}`);
    this.addStatus(grid, "Portable framework", local.frameworkVersion);
    this.addStatus(grid, "Computer", local.computerArchitecture);
    const status = local.updateStatus;
    if (status && !["completed"].includes(status.state)) {
      const box = contentEl.createDiv({ cls: `opm-state ${status.state === "failed" ? "is-failed" : ""}` });
      setIcon(box.createSpan(), status.state === "failed" ? "circle-x" : "loader-circle");
      box.createSpan({ text: ` ${status.message || status.state}` });
    }
    const primary = contentEl.createDiv({ cls: "opm-primary-actions" });
    new ButtonComponent(primary).setButtonText(this.updateLabel(local)).setIcon("refresh-cw").setCta().setDisabled(this.busy || isMaintenanceActive(status)).onClick(() => this.run(() => this.plugin.updateAndRestart()));
    new ButtonComponent(primary).setButtonText("Copy to another location").setIcon("copy").setDisabled(this.busy || isMaintenanceActive(status)).onClick(() => this.run(() => this.plugin.startBootstrap("Transfer")));
    const secondary = contentEl.createDiv({ cls: "opm-secondary-actions" });
    new ButtonComponent(secondary).setButtonText("Open portable folder").setIcon("folder-open").onClick(() => this.plugin.openPath(local.paths.packageRoot));
  }
  renderSetup(container) {
    const card = container.createDiv({ cls: "opm-welcome-card" });
    const steps = card.createDiv({ cls: "opm-benefits" });
    for (const [iconName, text] of [["mouse-pointer-click", "One guided setup"], ["shield-check", "Signed downloads and rollback"], ["repeat-2", "Automatic portable updates"], ["copy", "Easy transfer later"]]) {
      const item = steps.createDiv();
      setIcon(item.createSpan(), iconName);
      item.createSpan({ text });
    }
    card.createEl("p", { text: "Your current vault is copied\u2014not moved. After setup, Obsidian reopens from the portable copy." });
    const actions = card.createDiv({ cls: "opm-primary-actions" });
    new ButtonComponent(actions).setButtonText("Choose location and create").setIcon("folder-plus").setCta().setDisabled(this.busy).onClick(() => this.run(() => this.plugin.startBootstrap("Setup")));
  }
  addStatus(container, label, value) {
    const item = container.createDiv({ cls: "opm-stat" });
    item.createDiv({ cls: "opm-stat-label", text: label });
    item.createDiv({ cls: "opm-stat-value", text: value });
  }
  updateLabel(local) {
    if (!this.latest) return local.healthy ? "Check, update, and restart" : "Repair and restart";
    const available = compareVersions(this.latest.runtimeVersion, local.runtimeVersion) > 0 || compareVersions(this.latest.frameworkVersion, local.frameworkVersion) > 0;
    return available ? "Update and restart" : "Recheck and restart";
  }
  async check() {
    try {
      this.latest = await this.plugin.latestStatus();
      this.render();
    } catch (_) {
    }
  }
  async run(action) {
    if (this.busy) return;
    this.busy = true;
    this.render();
    try {
      await action();
    } catch (error) {
      new Notice(error.message, 12e3);
      this.busy = false;
      this.render();
    }
  }
};
