const { ButtonComponent, Modal, Notice, Platform, Plugin, requestUrl, setIcon } = require("obsidian");
const fs = require("node:fs");
const { shell } = require("electron");
const { compareVersions, findReleaseAsset, hostArchitecture, portablePaths, readPeMachine } = require("./core");
const { isMaintenanceActive, launchMaintenance, maintenanceWaitPid, recoverMaintenanceStatus } = require("./maintenance");
const EMBEDDED_MAINTENANCE_HELPER = require("../framework/Maintenance/PortableMaintenance.ps1");

const OBSIDIAN_RELEASE_API = "https://api.github.com/repos/obsidianmd/obsidian-releases/releases/latest";
const FRAMEWORK_RELEASE_API = "https://api.github.com/repos/Giblicious/obsidian-portable-manager/releases/latest";

module.exports = class ObsidianPortableManager extends Plugin {
  async onload() {
    if (!Platform.isDesktopApp || process.platform !== "win32") return;
    this.addRibbonIcon("package-check", "Obsidian Portable Manager", () => this.openManager());
    this.addCommand({ id: "open-portable-manager", name: "Open portable manager", callback: () => this.openManager() });
    this.app.workspace.onLayoutReady(() => this.reportMaintenanceResult());
  }

  openManager() {
    try { this.ensureMaintenanceHelper(); }
    catch (error) { new Notice(`Portable helper could not be prepared: ${error.message}`, 10000); }
    new PortableManagerModal(this.app, this).open();
  }

  getPaths() {
    const adapter = this.app.vault.adapter;
    const basePath = typeof adapter.getBasePath === "function" ? adapter.getBasePath() : adapter.basePath;
    return portablePaths(basePath);
  }

  readJson(filePath) {
    try { return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "")); }
    catch (_) { return null; }
  }

  writeJson(filePath, value) {
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
  }

  getMaintenanceStatus(paths = this.getPaths()) {
    const status = this.readJson(paths.statusPath);
    const recovered = recoverMaintenanceStatus(status);
    if (recovered && recovered !== status) this.writeJson(paths.statusPath, recovered);
    return recovered;
  }

  ensureMaintenanceHelper() {
    const paths = this.getPaths();
    if (!fs.existsSync(paths.portableRoot) || !fs.existsSync(`${paths.portableRoot}\\portable.ini`)) {
      throw new Error("This vault is not inside a configured Obsidian portable package.");
    }
    const versionOf = (source) => String(source).match(/^# FrameworkHelperVersion:\s*([0-9.]+)/m)?.[1] || "0.0.0";
    const bundledVersion = versionOf(EMBEDDED_MAINTENANCE_HELPER);
    let installedVersion = "0.0.0";
    try { installedVersion = versionOf(fs.readFileSync(paths.helperPath, "utf8")); } catch (_) {}
    if (compareVersions(installedVersion, bundledVersion) >= 0) return paths.helperPath;
    fs.mkdirSync(require("node:path").dirname(paths.helperPath), { recursive: true });
    const temporary = `${paths.helperPath}.new`;
    fs.writeFileSync(temporary, EMBEDDED_MAINTENANCE_HELPER, "utf8");
    fs.renameSync(temporary, paths.helperPath);
    return paths.helperPath;
  }

  getLocalStatus() {
    const paths = this.getPaths();
    const manifest = this.readJson(paths.manifestPath) || this.readJson(paths.legacyManifestPath) || {};
    let runtimeArchitecture = "Unknown";
    try { runtimeArchitecture = readPeMachine(paths.appExe); } catch (_) {}
    const computerArchitecture = hostArchitecture();
    const helperPath = fs.existsSync(paths.helperPath) ? paths.helperPath : paths.legacyHelperPath;
    return {
      paths, helperPath, manifest, runtimeArchitecture, computerArchitecture,
      runtimeVersion: String(manifest.installedRuntime || this.app.getVersion?.() || "Unknown"),
      frameworkVersion: String(manifest.frameworkVersion || "0.0.0"),
      architectureMatches: runtimeArchitecture === computerArchitecture,
      healthy: fs.existsSync(paths.appExe) && fs.existsSync(paths.dataPath) && fs.existsSync(helperPath) && fs.existsSync(paths.rootLauncher) && runtimeArchitecture === computerArchitecture,
      updateStatus: this.getMaintenanceStatus(paths),
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
      frameworkVersion: String(framework.tag_name).replace(/^v/, ""),
      runtimePage: String(obsidian.html_url || ""),
      frameworkPage: String(framework.html_url || ""),
    };
  }

  async scheduleMaintenance(kind) {
    this.ensureMaintenanceHelper();
    const local = this.getLocalStatus();
    if (!fs.existsSync(local.helperPath)) throw new Error("The portable maintenance helper is missing.");
    return launchMaintenance({ kind, helperPath: local.helperPath, statusPath: local.paths.statusPath, waitForPid: maintenanceWaitPid() });
  }

  openPath(targetPath) { void shell.openPath(targetPath); }

  reportMaintenanceResult() {
    const paths = this.getPaths();
    const status = this.getMaintenanceStatus(paths);
    if (!status || !["completed", "failed"].includes(status.state)) return;
    new Notice(status.state === "completed" ? status.message : `Portable maintenance failed: ${status.message}`, status.state === "completed" ? 8000 : 12000);
    try { fs.unlinkSync(paths.statusPath); } catch (_) {}
  }
};

class PortableManagerModal extends Modal {
  constructor(app, plugin) { super(app); this.plugin = plugin; this.latest = null; this.pollTimer = null; this.starting = false; }
  async onOpen() { this.modalEl.addClass("opm-modal"); this.render(); await this.check(true); }
  onClose() { if (this.pollTimer) window.clearInterval(this.pollTimer); this.contentEl.empty(); }

  render() {
    const local = this.plugin.getLocalStatus();
    const { contentEl } = this;
    contentEl.empty();
    const heading = contentEl.createDiv({ cls: "opm-heading" });
    const icon = heading.createDiv({ cls: "opm-logo" }); setIcon(icon, "package-check");
    const title = heading.createDiv(); title.createEl("h2", { text: "Obsidian Portable Manager" }); title.createEl("p", { text: "Runtime, launcher, and maintenance health for this portable workspace." });
    const health = contentEl.createDiv({ cls: `opm-health ${local.healthy ? "is-good" : "is-bad"}` });
    setIcon(health.createSpan(), local.healthy ? "circle-check" : "triangle-alert");
    health.createSpan({ text: local.healthy ? " Portable package healthy" : " Portable package needs attention" });
    const grid = contentEl.createDiv({ cls: "opm-grid" });
    this.addStatus(grid, "Drive", local.paths.driveRoot);
    this.addStatus(grid, "Runtime", `${local.runtimeVersion} (${local.runtimeArchitecture})`);
    this.addStatus(grid, "Computer", local.computerArchitecture);
    this.addStatus(grid, "Framework", local.frameworkVersion);

    const maintenanceActive = this.starting || isMaintenanceActive(local.updateStatus);
    this.runtimePanel = this.addUpdatePanel(contentEl, "Obsidian runtime", this.runtimeMessage(local));
    this.addActions(this.runtimePanel, "runtime", this.latest && (compareVersions(this.latest.runtimeVersion, local.runtimeVersion) > 0 || !local.architectureMatches), local.architectureMatches ? "Prepare runtime update" : `Repair ${local.computerArchitecture} runtime`, maintenanceActive);
    this.frameworkPanel = this.addUpdatePanel(contentEl, "Portable framework", this.frameworkMessage(local));
    this.addActions(this.frameworkPanel, "framework", this.latest && compareVersions(this.latest.frameworkVersion, local.frameworkVersion) > 0, "Prepare framework update", maintenanceActive);

    const tools = contentEl.createDiv({ cls: "opm-tools" });
    new ButtonComponent(tools).setButtonText("Check again").setIcon("refresh-cw").onClick(() => this.check(false));
    new ButtonComponent(tools).setButtonText("Open portable folder").setIcon("folder-open").onClick(() => this.plugin.openPath(local.paths.portableRoot));
    new ButtonComponent(tools).setButtonText("Open instructions").setIcon("book-open").onClick(() => this.plugin.openPath(local.paths.readmePath));
    if (local.updateStatus && !["completed", "failed"].includes(local.updateStatus.state)) { this.showStatus(local.updateStatus); this.startPolling(); }
  }

  addStatus(container, label, value) { const item = container.createDiv({ cls: "opm-stat" }); item.createDiv({ cls: "opm-stat-label", text: label }); item.createDiv({ cls: "opm-stat-value", text: value }); }
  addUpdatePanel(container, title, message) { const panel = container.createDiv({ cls: "opm-update-panel" }); panel.createEl("h3", { text: title }); panel.createEl("p", { text: message }); panel.createDiv({ cls: "opm-actions" }); return panel; }
  addActions(panel, kind, available, label, disabled) { if (!available) return; new ButtonComponent(panel.querySelector(".opm-actions")).setButtonText(label).setIcon("download").setCta().setDisabled(disabled).onClick(() => this.prepare(kind)); }
  runtimeMessage(local) { if (!local.architectureMatches) return `The runtime is incompatible with this computer and needs a ${local.computerArchitecture} repair.`; if (!this.latest) return "Checking the official Obsidian release..."; return compareVersions(this.latest.runtimeVersion, local.runtimeVersion) > 0 ? `Runtime ${this.latest.runtimeVersion} is available; ${local.runtimeVersion} is installed.` : `Runtime ${local.runtimeVersion} is current.`; }
  frameworkMessage(local) { if (!this.latest) return "Checking the portable framework release..."; return compareVersions(this.latest.frameworkVersion, local.frameworkVersion) > 0 ? `Framework ${this.latest.frameworkVersion} is available; ${local.frameworkVersion} is installed.` : `Framework ${local.frameworkVersion} is current.`; }

  async check(silent) { try { this.latest = await this.plugin.latestStatus(); this.render(); if (!silent) new Notice("Portable update check completed."); } catch (error) { new Notice(`Update check failed: ${error.message}`, 10000); } }
  async prepare(kind) {
    if (this.starting) return;
    this.starting = true;
    this.render();
    try {
      await this.plugin.scheduleMaintenance(kind);
      new Notice(`The ${kind} update helper started.`, 6000);
      this.startPolling();
    } catch (error) {
      new Notice(`Could not start maintenance: ${error.message}`, 10000);
    } finally {
      this.starting = false;
      this.render();
    }
  }
  startPolling() { if (this.pollTimer) return; this.pollTimer = window.setInterval(() => { const status = this.plugin.getMaintenanceStatus(); if (!status) return; this.showStatus(status); if (["completed", "failed"].includes(status.state)) { window.clearInterval(this.pollTimer); this.pollTimer = null; } }, 1000); }
  showStatus(status) { const panel = status.scope === "framework" ? this.frameworkPanel : this.runtimePanel; if (!panel) return; let box = panel.querySelector(".opm-state"); if (!box) box = panel.createDiv({ cls: "opm-state" }); box.toggleClass("is-failed", status.state === "failed"); box.setText(status.state === "ready" ? `${status.message} Close Obsidian normally to finish.` : status.message || status.state); }
}
