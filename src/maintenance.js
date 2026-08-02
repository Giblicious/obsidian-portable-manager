const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ACTIVE_STATES = new Set(["scheduled", "launching", "checking", "downloading", "ready", "installing"]);
const LAUNCH_TIMEOUT_MS = 15_000;
const OPERATION_TIMEOUT_MS = 6 * 60 * 60 * 1000;

function statusAgeMs(status, now = Date.now()) {
  const timestamp = Date.parse(String(status?.timestamp || ""));
  return Number.isFinite(timestamp) ? Math.max(0, now - timestamp) : Number.POSITIVE_INFINITY;
}

function failedStatus(status, message, now = Date.now()) {
  return { ...status, state: "failed", message, timestamp: new Date(now).toISOString() };
}

function recoverMaintenanceStatus(status, now = Date.now()) {
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

function isMaintenanceActive(status, now = Date.now()) {
  return Boolean(recoverMaintenanceStatus(status, now) && ACTIVE_STATES.has(recoverMaintenanceStatus(status, now).state));
}

function maintenanceWaitPid(processLike = process) {
  const parent = Number(processLike.ppid);
  const current = Number(processLike.pid);
  return Number.isInteger(parent) && parent > 0 ? parent : current;
}

function resolvePowerShellPath(environment = process.env, existsSync = fs.existsSync) {
  const windowsRoot = environment.SystemRoot || environment.WINDIR;
  if (windowsRoot) {
    const absolute = path.win32.join(windowsRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    if (existsSync(absolute)) return absolute;
  }
  return "powershell.exe";
}

function readStatus(fsApi, statusPath) {
  try { return JSON.parse(fsApi.readFileSync(statusPath, "utf8").replace(/^\uFEFF/, "")); }
  catch (_) { return null; }
}

function writeStatus(fsApi, statusPath, status) {
  fsApi.writeFileSync(statusPath, JSON.stringify(status, null, 2), "utf8");
}

function launchMaintenance({
  kind,
  helperPath,
  statusPath,
  waitForPid,
  environment = process.env,
  fsApi = fs,
  spawn = childProcess.spawn,
  now = () => Date.now(),
  launchTimeoutMs = LAUNCH_TIMEOUT_MS,
}) {
  const existing = recoverMaintenanceStatus(readStatus(fsApi, statusPath), now());
  if (isMaintenanceActive(existing, now())) throw new Error(`Another ${existing.scope || "portable"} maintenance operation is already active.`);

  const action = kind === "framework" ? "-InstallFramework" : "-InstallRuntime";
  const scheduled = { state: "scheduled", scope: kind, message: `Starting the ${kind} update helper.`, timestamp: new Date(now()).toISOString() };
  writeStatus(fsApi, statusPath, scheduled);

  let child;
  try {
    child = spawn(resolvePowerShellPath(environment, fsApi.existsSync.bind(fsApi)), [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass",
      "-File", helperPath, action, "-WaitForPid", String(waitForPid), "-Bootstrap",
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

module.exports = {
  ACTIVE_STATES,
  LAUNCH_TIMEOUT_MS,
  OPERATION_TIMEOUT_MS,
  isMaintenanceActive,
  launchMaintenance,
  maintenanceWaitPid,
  recoverMaintenanceStatus,
  resolvePowerShellPath,
  statusAgeMs,
};
