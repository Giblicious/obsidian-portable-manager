const fs = require("node:fs");
const path = require("node:path");

const MACHINE_NAMES = { 0x8664: "x64", 0xaa64: "ARM64", 0x014c: "x86" };

function compareVersions(left, right) {
  const a = String(left || "0").replace(/^v/, "").split(".").map((value) => Number.parseInt(value, 10) || 0);
  const b = String(right || "0").replace(/^v/, "").split(".").map((value) => Number.parseInt(value, 10) || 0);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function hostArchitecture(nodeArchitecture = process.arch) {
  return { x64: "x64", arm64: "ARM64", ia32: "x86" }[nodeArchitecture] || nodeArchitecture;
}

function readPeMachine(filePath) {
  const handle = fs.openSync(filePath, "r");
  try {
    const dosHeader = Buffer.alloc(64);
    if (fs.readSync(handle, dosHeader, 0, dosHeader.length, 0) !== dosHeader.length) throw new Error("Incomplete DOS header");
    const peOffset = dosHeader.readUInt32LE(0x3c);
    const signature = Buffer.alloc(6);
    if (fs.readSync(handle, signature, 0, signature.length, peOffset) !== signature.length) throw new Error("Incomplete PE header");
    if (signature.toString("ascii", 0, 4) !== "PE\0\0") throw new Error("Invalid PE signature");
    const code = signature.readUInt16LE(4);
    return MACHINE_NAMES[code] || `0x${code.toString(16).padStart(4, "0")}`;
  } finally {
    fs.closeSync(handle);
  }
}

function packagePaths(vaultPath, packageRoot) {
  const pathApi = /^[a-z]:[\\/]/i.test(vaultPath) ? path.win32 : path;
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
    readmePath: pathApi.join(absolutePackageRoot, "README - Obsidian Portable.txt"),
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

function findPortablePackageRoot(vaultPath, existsSync = fs.existsSync, readFileSync = fs.readFileSync) {
  const pathApi = /^[a-z]:[\\/]/i.test(vaultPath) ? path.win32 : path;
  const absoluteVaultPath = pathApi.resolve(vaultPath);
  let candidate = absoluteVaultPath;
  const filesystemRoot = pathApi.parse(candidate).root;
  while (candidate) {
    const config = pathApi.join(candidate, "Apps", "Portables", "ObsidianPortable", "portable.ini");
    if (existsSync(config)) {
      try {
        const configuredVault = readIniValue(readFileSync(config, "utf8"), "Vault");
        if (configuredVault && pathApi.resolve(candidate, configuredVault).toLowerCase() === absoluteVaultPath.toLowerCase()) return candidate;
      } catch (_) {}
    }
    if (candidate === filesystemRoot) break;
    const parent = pathApi.dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  return null;
}

function portablePaths(vaultPath, existsSync = fs.existsSync, readFileSync = fs.readFileSync) {
  const packageRoot = findPortablePackageRoot(vaultPath, existsSync, readFileSync);
  if (!packageRoot) {
    const pathApi = /^[a-z]:[\\/]/i.test(vaultPath) ? path.win32 : path;
    return { configured: false, vaultPath: pathApi.resolve(vaultPath), packageRoot: null };
  }
  return packagePaths(vaultPath, packageRoot);
}

function targetPackageRoot(selectionPath) {
  const pathApi = /^[a-z]:[\\/]/i.test(selectionPath) ? path.win32 : path;
  const selected = pathApi.resolve(selectionPath);
  return pathApi.basename(selected).toLowerCase() === "obsidian portable" ? selected : pathApi.join(selected, "Obsidian Portable");
}

function assertSafeTransferTarget(sourcePath, targetPath) {
  const pathApi = /^[a-z]:[\\/]/i.test(sourcePath) || /^[a-z]:[\\/]/i.test(targetPath) ? path.win32 : path;
  const source = pathApi.resolve(sourcePath).replace(/[\\/]+$/, "");
  const target = pathApi.resolve(targetPath).replace(/[\\/]+$/, "");
  const normalizedSource = source.toLowerCase();
  const normalizedTarget = target.toLowerCase();
  if (normalizedSource === normalizedTarget || normalizedTarget.startsWith(`${normalizedSource}${pathApi.sep}`) || normalizedSource.startsWith(`${normalizedTarget}${pathApi.sep}`)) {
    throw new Error("Choose a destination outside the current vault and portable package.");
  }
  return target;
}

function findReleaseAsset(release, name) {
  const asset = Array.isArray(release?.assets) ? release.assets.find((candidate) => candidate.name === name) : null;
  if (!asset?.browser_download_url || !Number.isFinite(Number(asset.size))) throw new Error(`Release asset is missing: ${name}`);
  return { name: asset.name, url: String(asset.browser_download_url), size: Number(asset.size) };
}

module.exports = { assertSafeTransferTarget, compareVersions, findPortablePackageRoot, findReleaseAsset, hostArchitecture, packagePaths, portablePaths, readPeMachine, targetPackageRoot };
