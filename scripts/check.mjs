import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const json = (relative) => JSON.parse(read(relative));
const packageJson = json("package.json");
const manifest = json("manifest.json");
const versions = json("versions.json");
const framework = json("framework/framework-manifest.json");

for (const [label, value] of [["package", packageJson.version], ["manifest", manifest.version], ["framework", framework.frameworkVersion]]) {
  if (!/^0\.\d+\.\d+$/.test(value)) throw new Error(`${label} version must remain a public-beta 0.x.x version`);
  if (value !== packageJson.version) throw new Error(`${label} version ${value} differs from package version ${packageJson.version}`);
}
if (versions[manifest.version] !== manifest.minAppVersion) throw new Error("versions.json does not map the current plugin and minimum Obsidian versions");
if (manifest.id !== "obsidian-portable-manager" || manifest.name !== "Obsidian Portable Manager" || !manifest.isDesktopOnly) throw new Error("Plugin manifest identity or desktop-only boundary is invalid");

execFileSync(process.execPath, [path.join(root, "scripts/build.mjs")], { stdio: "inherit" });
execFileSync(process.execPath, ["--check", path.join(root, "main.js")], { stdio: "inherit" });
execFileSync(process.execPath, [path.join(root, "node_modules/vitest/vitest.mjs"), "run"], { cwd: root, stdio: "inherit" });

const required = ["main.js", "manifest.json", "styles.css", "versions.json", "README.md", "LICENSE", "SECURITY.md", "CHANGELOG.md", "framework/Maintenance/PortableMaintenance.ps1", "framework/Launcher/PortableLauncher.cs", "framework/Launcher/ObsidianPortable.ico", "third_party/7zip/7z.exe", "third_party/7zip/7z.dll", "third_party/7zip/LICENSE.txt", "third_party/7zip/SHA256SUMS"];
for (const relative of required) if (!fs.existsSync(path.join(root, relative))) throw new Error(`Missing required release source: ${relative}`);

const publicCode = ["src/main.js", "src/core.js", "main.js", "framework/Maintenance/PortableMaintenance.ps1", "framework/Launcher/PortableLauncher.cs", "scripts/package-framework.ps1"];
const forbidden = [/\bTucker\b/i, /\bLauren\b/i, /[A-Z]:\\Users\\/i, /[A-Z]:\\(?:Tucker|Lauren)\\/i, /console\.(?:log|debug)\s*\(/, /-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY-----/];
for (const relative of publicCode) {
  const source = read(relative);
  for (const pattern of forbidden) if (pattern.test(source)) throw new Error(`${relative} contains forbidden public-release content: ${pattern}`);
}
const helper = read("framework/Maintenance/PortableMaintenance.ps1");
for (const safeguard of ["Assert-ChildPath", "Get-AuthenticodeSignature", "Get-FileHash", "App.previous", "Maintenance.previous", "Tools.previous", "Wait-ForPortableObsidian"]) if (!helper.includes(safeguard)) throw new Error(`Maintenance safeguard is missing: ${safeguard}`);
for (const protectedName of ["'App'", "'Data'", "'portable.ini'", "'portable-manifest.json'"]) if (!helper.includes(protectedName)) throw new Error(`Framework protected-content check is missing: ${protectedName}`);
const launcher = read("framework/Launcher/PortableLauncher.cs");
if (!launcher.includes("UseShellExecute = true") || !launcher.includes("ReadPeMachine") || !launcher.includes("ResolveUnderRoot")) throw new Error("Launcher portability, architecture, or detached-process safeguards are missing");

const sums = new Map(read("third_party/7zip/SHA256SUMS").trim().split(/\r?\n/).map((line) => { const [hash, name] = line.trim().split(/\s+/, 2); return [name, hash.toUpperCase()]; }));
const crypto = await import("node:crypto");
for (const name of ["7z.exe", "7z.dll", "LICENSE.txt"]) { const actual = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, "third_party/7zip", name))).digest("hex").toUpperCase(); if (actual !== sums.get(name)) throw new Error(`Pinned 7-Zip file changed: ${name}`); }

const trackedCandidates = [];
function walk(directory) { for (const entry of fs.readdirSync(directory, { withFileTypes: true })) { if ([".git", "node_modules", "dist"].includes(entry.name)) continue; const full = path.join(directory, entry.name); if (entry.isDirectory()) walk(full); else trackedCandidates.push(path.relative(root, full)); } }
walk(root);
for (const relative of trackedCandidates) if (/Obsidian\.exe$/i.test(relative)) throw new Error(`Official Obsidian runtime must not be distributed: ${relative}`);

if (process.platform === "win32") {
  const helperPath = path.join(root, "framework/Maintenance/PortableMaintenance.ps1").replaceAll("'", "''");
  const command = `$e=$null;$t=$null;[System.Management.Automation.Language.Parser]::ParseFile('${helperPath}',[ref]$t,[ref]$e)|Out-Null;if($e.Count){$e|ForEach-Object{Write-Error $_.Message};exit 1}`;
  execFileSync("powershell.exe", ["-NoProfile", "-Command", command], { stdio: "inherit" });
}
console.log(`Obsidian Portable Manager ${manifest.version} passed build, tests, manifests, path safeguards, dependency pins, and public-content audit.`);
