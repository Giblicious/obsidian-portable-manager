const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ACTIVE_STATES = new Set(["scheduled", "launching", "checking", "downloading", "copying", "ready", "installing"]);
const LAUNCH_TIMEOUT_MS = 60_000;
const OPERATION_TIMEOUT_MS = 6 * 60 * 60 * 1000;

function isProcessRunning(processId, probe = process.kill) {
  const pid = Number(processId);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { probe(pid, 0); return true; }
  catch (error) { return error?.code === "EPERM"; }
}

function statusAgeMs(status, now = Date.now()) {
  const timestamp = Date.parse(String(status?.timestamp || ""));
  return Number.isFinite(timestamp) ? Math.max(0, now - timestamp) : Number.POSITIVE_INFINITY;
}

function failedStatus(status, message, now = Date.now()) {
  return { ...status, state: "failed", message, timestamp: new Date(now).toISOString() };
}

function recoverMaintenanceStatus(status, now = Date.now(), processRunning = isProcessRunning) {
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
  fsApi.mkdirSync(path.dirname(statusPath), { recursive: true });
  fsApi.writeFileSync(statusPath, JSON.stringify(status, null, 2), "utf8");
}

function launchPortableOperation({
  scope,
  scriptPath,
  statusPath,
  scriptArguments,
  environment = process.env,
  fsApi = fs,
  spawn = childProcess.spawn,
  now = () => Date.now(),
  launchTimeoutMs = LAUNCH_TIMEOUT_MS,
  acknowledgeStates = null,
}) {
  const existing = recoverMaintenanceStatus(readStatus(fsApi, statusPath), now());
  if (isMaintenanceActive(existing, now())) throw new Error(`Another ${existing.scope || "portable"} operation is already active.`);

  const scheduled = { state: "scheduled", scope, message: `Starting the ${scope} helper.`, timestamp: new Date(now()).toISOString() };
  writeStatus(fsApi, statusPath, scheduled);

  let child;
  try {
    child = spawn(resolvePowerShellPath(environment, fsApi.existsSync.bind(fsApi)), [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass",
      "-File", scriptPath, ...scriptArguments,
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

function launchMaintenance({ kind, helperPath, statusPath, waitForPid, restartAfter = false, ...dependencies }) {
  const action = kind === "framework" ? "-InstallFramework" : kind === "runtime" ? "-InstallRuntime" : "-InstallAll";
  const scriptArguments = [action, "-WaitForPid", String(waitForPid), "-Bootstrap"];
  if (restartAfter) scriptArguments.push("-RestartAfter");
  return launchPortableOperation({ scope: kind, scriptPath: helperPath, statusPath, scriptArguments, ...dependencies });
}

module.exports = {
  ACTIVE_STATES,
  LAUNCH_TIMEOUT_MS,
  OPERATION_TIMEOUT_MS,
  isMaintenanceActive,
  isProcessRunning,
  launchMaintenance,
  launchPortableOperation,
  maintenanceWaitPid,
  recoverMaintenanceStatus,
  resolvePowerShellPath,
  statusAgeMs,
};
