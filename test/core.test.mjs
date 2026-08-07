import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { assertSafeTransferTarget, compareVersions, findPortablePackageRoot, findReleaseAsset, hostArchitecture, portablePaths, readPeMachine, targetPackageRoot } = require("../src/core.js");

describe("compareVersions", () => {
  it("compares semantic numeric components", () => {
    expect(compareVersions("1.12.7", "1.9.14")).toBeGreaterThan(0);
    expect(compareVersions("v0.1.0", "0.1.0")).toBe(0);
    expect(compareVersions("0.1.0", "0.1.1")).toBeLessThan(0);
  });
});

describe("portablePaths", () => {
  it("discovers a package at any vault ancestor", () => {
    const config = path.win32.join("X:\\Portable Kit", "Apps", "Portables", "ObsidianPortable", "portable.ini");
    const result = portablePaths("X:\\Portable Kit\\Vault\\Notes", candidate => candidate === config, () => "Vault=Vault\\Notes");
    expect(result.packageRoot).toBe("X:\\Portable Kit");
    expect(result.portableRoot).toBe(path.win32.join(result.packageRoot, "Apps", "Portables", "ObsidianPortable"));
    expect(result.appExe).toBe(path.win32.join(result.portableRoot, "App", "Obsidian.exe"));
  });

  it("reports a fresh vault without inventing a package", () => {
    expect(portablePaths("X:\\Notes\\Vault", () => false)).toMatchObject({ configured: false, packageRoot: null });
    expect(findPortablePackageRoot("X:\\Notes\\Vault", () => false)).toBeNull();
  });

  it("does not adopt another vault's package on the same drive", () => {
    const config = path.win32.join("X:\\", "Apps", "Portables", "ObsidianPortable", "portable.ini");
    const result = portablePaths("X:\\Other Vault", candidate => candidate === config, () => "Vault=Main Vault");
    expect(result.configured).toBe(false);
  });

  it("creates a friendly child package and rejects nested transfers", () => {
    expect(targetPackageRoot("X:\\")).toBe("X:\\Obsidian Portable");
    expect(targetPackageRoot("X:\\Obsidian Portable")).toBe("X:\\Obsidian Portable");
    expect(assertSafeTransferTarget("X:\\Current\\Vault", "Y:\\Obsidian Portable")).toBe("Y:\\Obsidian Portable");
    expect(() => assertSafeTransferTarget("X:\\Current", "X:\\Current\\Copy")).toThrow(/outside/i);
    expect(() => assertSafeTransferTarget("X:\\Current\\Vault", "X:\\Current")).toThrow(/outside/i);
  });
});

describe("architecture", () => {
  it("normalizes Node architecture names", () => {
    expect(hostArchitecture("x64")).toBe("x64");
    expect(hostArchitecture("arm64")).toBe("ARM64");
    expect(hostArchitecture("ia32")).toBe("x86");
  });

  it("reads an x64 PE machine field", () => {
    const file = path.join(os.tmpdir(), `opm-pe-${process.pid}.exe`);
    const buffer = Buffer.alloc(0x90);
    buffer.writeUInt32LE(0x80, 0x3c);
    buffer.write("PE\0\0", 0x80, "ascii");
    buffer.writeUInt16LE(0x8664, 0x84);
    fs.writeFileSync(file, buffer);
    try { expect(readPeMachine(file)).toBe("x64"); }
    finally { fs.unlinkSync(file); }
  });
});

describe("release assets", () => {
  it("requires a named asset with a URL and size", () => {
    const asset = findReleaseAsset({ assets: [{ name: "portable-framework.zip", browser_download_url: "https://example.test/file", size: 12 }] }, "portable-framework.zip");
    expect(asset.size).toBe(12);
    expect(() => findReleaseAsset({ assets: [] }, "missing.zip")).toThrow(/missing/);
  });
});
