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

function portablePaths(vaultPath) {
  const pathApi = /^[a-z]:[\\/]/i.test(vaultPath) ? path.win32 : path;
  const absoluteVaultPath = pathApi.resolve(vaultPath);
  const driveRoot = pathApi.parse(absoluteVaultPath).root;
  if (!driveRoot) throw new Error("The vault is not on a mounted drive.");
  const portableRoot = pathApi.join(driveRoot, "Apps", "Portables", "ObsidianPortable");
  return {
    vaultPath: absoluteVaultPath, driveRoot, portableRoot,
    appExe: pathApi.join(portableRoot, "App", "Obsidian.exe"),
    dataPath: pathApi.join(portableRoot, "Data"),
    manifestPath: pathApi.join(portableRoot, "portable-manifest.json"),
    legacyManifestPath: pathApi.join(portableRoot, "manifest.json"),
    helperPath: pathApi.join(portableRoot, "Maintenance", "PortableMaintenance.ps1"),
    legacyHelperPath: pathApi.join(portableRoot, "Maintenance", "Update-ObsidianPortable.ps1"),
    statusPath: pathApi.join(portableRoot, "update-status.json"),
    rootLauncher: pathApi.join(driveRoot, "Obsidian Portable.exe"),
    readmePath: pathApi.join(driveRoot, "README - Obsidian Portable.txt"),
  };
}

function findReleaseAsset(release, name) {
  const asset = Array.isArray(release?.assets) ? release.assets.find((candidate) => candidate.name === name) : null;
  if (!asset?.browser_download_url || !Number.isFinite(Number(asset.size))) throw new Error(`Release asset is missing: ${name}`);
  return { name: asset.name, url: String(asset.browser_download_url), size: Number(asset.size) };
}

module.exports = { compareVersions, findReleaseAsset, hostArchitecture, portablePaths, readPeMachine };
