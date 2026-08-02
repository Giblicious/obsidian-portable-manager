import { EventEmitter } from "node:events";
import { spawn as spawnChild } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  isMaintenanceActive,
  launchMaintenance,
  maintenanceWaitPid,
  recoverMaintenanceStatus,
  resolvePowerShellPath,
} = require("../src/maintenance.js");

const temporaryDirectories = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function statusFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opm-maintenance-"));
  temporaryDirectories.push(directory);
  return path.join(directory, "update-status.json");
}

function childFixture(pid = 4242) {
  const child = new EventEmitter();
  child.pid = pid;
  child.unref = () => { child.unreferenced = true; };
  return child;
}

describe("maintenance status recovery", () => {
  it("releases a launch that never advances", () => {
    const now = Date.parse("2026-08-02T12:00:30Z");
    const status = { state: "scheduled", scope: "runtime", timestamp: "2026-08-02T12:00:00Z" };
    const recovered = recoverMaintenanceStatus(status, now);
    expect(recovered.state).toBe("failed");
    expect(recovered.message).toMatch(/did not start/i);
    expect(isMaintenanceActive(recovered, now)).toBe(false);
  });

  it("keeps a recent download active", () => {
    const now = Date.parse("2026-08-02T12:00:30Z");
    const status = { state: "downloading", scope: "runtime", timestamp: "2026-08-02T12:00:00Z" };
    expect(recoverMaintenanceStatus(status, now)).toBe(status);
    expect(isMaintenanceActive(status, now)).toBe(true);
  });
});

describe("maintenance process selection", () => {
  it("waits for Electron's main parent process", () => {
    expect(maintenanceWaitPid({ pid: 200, ppid: 100 })).toBe(100);
    expect(maintenanceWaitPid({ pid: 200, ppid: 0 })).toBe(200);
  });

  it("prefers the absolute Windows PowerShell path", () => {
    const expected = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
    expect(resolvePowerShellPath({ SystemRoot: "C:\\Windows" }, candidate => candidate === expected)).toBe(expected);
    expect(resolvePowerShellPath({}, () => false)).toBe("powershell.exe");
  });
});

describe("maintenance launch handshake", () => {
  it("acknowledges a spawned helper and records its pid", async () => {
    const statusPath = statusFixture();
    const child = childFixture();
    let invocation;
    const resultPromise = launchMaintenance({
      kind: "runtime", helperPath: "X:\\Maintenance\\PortableMaintenance.ps1", statusPath, waitForPid: 100,
      environment: { SystemRoot: "C:\\Windows" }, fsApi: fs,
      spawn: (...args) => {
        invocation = args;
        queueMicrotask(() => {
          child.emit("spawn");
          fs.writeFileSync(statusPath, JSON.stringify({ state: "checking", scope: "runtime", processId: 5000, timestamp: new Date().toISOString() }));
        });
        return child;
      },
      now: () => Date.parse("2026-08-02T12:00:00Z"), launchTimeoutMs: 500,
    });
    await expect(resultPromise).resolves.toEqual({ processId: 5000 });
    const status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
    expect(invocation[0]).toMatch(/powershell\.exe$/i);
    expect(invocation[1]).toContain("-NonInteractive");
    expect(invocation[1]).toContain("100");
    expect(status).toMatchObject({ state: "checking", scope: "runtime", processId: 5000 });
    expect(child.unreferenced).toBe(true);
  });

  it("preserves an immediate checking update from the helper", async () => {
    const statusPath = statusFixture();
    const child = childFixture();
    const promise = launchMaintenance({
      kind: "framework", helperPath: "helper.ps1", statusPath, waitForPid: 100, fsApi: fs,
      spawn: () => {
        queueMicrotask(() => {
          fs.writeFileSync(statusPath, JSON.stringify({ state: "checking", scope: "framework", timestamp: new Date().toISOString() }));
          child.emit("spawn");
        });
        return child;
      },
      launchTimeoutMs: 500,
    });
    await promise;
    expect(JSON.parse(fs.readFileSync(statusPath, "utf8")).state).toBe("checking");
  });

  it("turns an asynchronous spawn error into a retryable failure", async () => {
    const statusPath = statusFixture();
    const child = childFixture();
    const promise = launchMaintenance({
      kind: "runtime", helperPath: "helper.ps1", statusPath, waitForPid: 100, fsApi: fs,
      spawn: () => { queueMicrotask(() => child.emit("error", new Error("blocked"))); return child; },
      launchTimeoutMs: 100,
    });
    await expect(promise).rejects.toThrow(/blocked/);
    expect(JSON.parse(fs.readFileSync(statusPath, "utf8"))).toMatchObject({ state: "failed", scope: "runtime" });
  });

  it("rejects a second active operation", () => {
    const statusPath = statusFixture();
    fs.writeFileSync(statusPath, JSON.stringify({ state: "checking", scope: "framework", timestamp: new Date().toISOString() }));
    expect(() => launchMaintenance({ kind: "runtime", helperPath: "helper.ps1", statusPath, waitForPid: 100, fsApi: fs })).toThrow(/already active/);
  });

  it("reports an unexpected helper exit when no terminal result was written", async () => {
    const statusPath = statusFixture();
    const child = childFixture();
    const promise = launchMaintenance({
      kind: "runtime", helperPath: "helper.ps1", statusPath, waitForPid: 100, fsApi: fs,
      spawn: () => { queueMicrotask(() => child.emit("spawn")); return child; },
      launchTimeoutMs: 100, exitGraceMs: 0,
    });
    child.emit("exit", 7);
    await expect(promise).rejects.toThrow(/code 7/);
    expect(JSON.parse(fs.readFileSync(statusPath, "utf8"))).toMatchObject({ state: "failed", scope: "runtime" });
    expect(JSON.parse(fs.readFileSync(statusPath, "utf8")).message).toMatch(/code 7/);
  });

  it.skipIf(process.platform !== "win32")("launches a real hidden PowerShell helper on Windows", async () => {
    const portableRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opm-windows-launch-"));
    temporaryDirectories.push(portableRoot);
    const maintenanceDirectory = path.join(portableRoot, "Maintenance");
    fs.mkdirSync(maintenanceDirectory);
    const statusPath = path.join(portableRoot, "update-status.json");
    const helperPath = path.join(maintenanceDirectory, "Handshake.ps1");
    fs.copyFileSync(path.join(import.meta.dirname, "fixtures", "Handshake.ps1"), helperPath);

    await launchMaintenance({ kind: "runtime", helperPath, statusPath, waitForPid: 0, fsApi: fs, launchTimeoutMs: 5000 });
    const deadline = Date.now() + 5000;
    let status;
    while (Date.now() < deadline) {
      try { status = JSON.parse(fs.readFileSync(statusPath, "utf8").replace(/^\uFEFF/, "")); } catch (_) {}
      if (["completed", "failed"].includes(status?.state)) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    expect(status).toMatchObject({ state: "completed", scope: "runtime", message: "Integration helper completed." });
  }, 10_000);

  it.skipIf(process.platform !== "win32")("keeps the helper alive after its Node parent exits", async () => {
    const portableRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opm-parent-exit-"));
    temporaryDirectories.push(portableRoot);
    const maintenanceDirectory = path.join(portableRoot, "Maintenance");
    fs.mkdirSync(maintenanceDirectory);
    const helperPath = path.join(maintenanceDirectory, "Handshake.ps1");
    const statusPath = path.join(portableRoot, "update-status.json");
    fs.copyFileSync(path.join(import.meta.dirname, "fixtures", "Handshake.ps1"), helperPath);
    const powershellPath = resolvePowerShellPath(process.env, fs.existsSync);

    const parentExit = await new Promise(resolve => {
      const parent = spawnChild(process.execPath, [path.join(import.meta.dirname, "fixtures", "ParentExit.mjs"), powershellPath, helperPath, statusPath], { stdio: "ignore" });
      parent.once("exit", code => resolve(code));
    });
    expect(parentExit).toBe(0);

    const deadline = Date.now() + 5000;
    let status;
    while (Date.now() < deadline) {
      try { status = JSON.parse(fs.readFileSync(statusPath, "utf8").replace(/^\uFEFF/, "")); } catch (_) {}
      if (["completed", "failed"].includes(status?.state)) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    expect(status).toMatchObject({ state: "completed", message: "Integration helper completed." });
  }, 10_000);
});
