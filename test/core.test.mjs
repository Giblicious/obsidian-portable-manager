import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { compareVersions, findReleaseAsset, hostArchitecture, portablePaths, readPeMachine } = require("../src/core.js");

describe("compareVersions", () => {
  it("compares semantic numeric components", () => {
    expect(compareVersions("1.12.7", "1.9.14")).toBeGreaterThan(0);
    expect(compareVersions("v0.1.0", "0.1.0")).toBe(0);
    expect(compareVersions("0.1.0", "0.1.1")).toBeLessThan(0);
  });
});

describe("portablePaths", () => {
  it("derives the package from the vault drive", () => {
    const result = portablePaths("X:\\Notes\\Vault");
    expect(result.portableRoot).toBe(path.win32.join("X:\\", "Apps", "Portables", "ObsidianPortable"));
    expect(result.appExe).toBe(path.win32.join(result.portableRoot, "App", "Obsidian.exe"));
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
