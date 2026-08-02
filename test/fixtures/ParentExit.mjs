import { spawn } from "node:child_process";
import fs from "node:fs";

const [powershellPath, helperPath, statusPath] = process.argv.slice(2);
const child = spawn(powershellPath, [
  "-NoLogo", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass",
  "-File", helperPath, "-InstallRuntime", "-WaitForPid", "0", "-Bootstrap",
], { detached: false, windowsHide: true, stdio: "ignore" });

child.once("error", () => process.exit(2));
const deadline = Date.now() + 5000;
const poll = setInterval(() => {
  try {
    const status = JSON.parse(fs.readFileSync(statusPath, "utf8").replace(/^\uFEFF/, ""));
    if (status.state === "checking") {
      clearInterval(poll);
      process.exit(0);
    }
  } catch (_) {}
  if (Date.now() >= deadline) process.exit(3);
}, 50);
