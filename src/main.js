const { ButtonComponent, Modal, Notice, Platform, Plugin, requestUrl, setIcon } = require("obsidian");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const electron = require("electron");
const shell = electron.shell;
const desktopDialog = electron.dialog || electron.remote?.dialog;
const electronApp = electron.app || electron.remote?.app;
const { assertSafeTransferTarget, compareVersions, findReleaseAsset, hostArchitecture, portablePaths, readPeMachine, targetPackageRoot } = require("./core");
const { isMaintenanceActive, launchMaintenance, launchPortableOperation, maintenanceWaitPid, recoverMaintenanceStatus } = require("./maintenance");
const EMBEDDED_MAINTENANCE_HELPER = require("../framework/Maintenance/PortableMaintenance.ps1");
const EMBEDDED_BOOTSTRAP_HELPER = require("../framework/Maintenance/PortableBootstrap.ps1");

const OBSIDIAN_RELEASE_API = "https://api.github.com/repos/obsidianmd/obsidian-releases/releases/latest";
const FRAMEWORK_RELEASE_API = "https://api.github.com/repos/Giblicious/obsidian-portable-manager/releases/latest";
const AUTO_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;

module.exports = class ObsidianPortableManager extends Plugin {
  async onload() {
    if (!Platform.isDesktopApp || process.platform !== "win32") return;
    this.settings = Object.assign({ automaticMaintenance: true, lastAutomaticCheck: 0 }, await this.loadData());
    this.addRibbonIcon("package-check", "Obsidian Portable Manager", () => this.openManager());
    this.addCommand({ id: "open-portable-manager", name: "Open portable manager", callback: () => this.openManager() });
    this.app.workspace.onLayoutReady(async () => {
      const paths = this.getPaths();
      if (!paths.configured) this.openManager();
      else {
        this.reportMaintenanceResult();
        await this.maybeScheduleAutomaticMaintenance();
      }
    });
  }

  openManager() { new PortableManagerModal(this.app, this).open(); }

  getVaultPath() {
    const adapter = this.app.vault.adapter;
    return typeof adapter.getBasePath === "function" ? adapter.getBasePath() : adapter.basePath;
  }

  getPaths() { return portablePaths(this.getVaultPath()); }
  readJson(filePath) { try { return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "")); } catch (_) { return null; } }
  writeJson(filePath, value) { fs.mkdirSync(path.dirname(filePath), { recursive: true }); fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8"); }

  getMaintenanceStatus(paths = this.getPaths()) {
    if (!paths.configured) return null;
    const status = this.readJson(paths.statusPath);
    const recovered = recoverMaintenanceStatus(status);
    if (recovered && recovered !== status) this.writeJson(paths.statusPath, recovered);
    return recovered;
  }

  ensureMaintenanceHelper() {
    const paths = this.getPaths();
    if (!paths.configured || !fs.existsSync(`${paths.portableRoot}\\portable.ini`)) throw new Error("This vault is not inside a portable package yet.");
    const versionOf = (source) => String(source).match(/^# FrameworkHelperVersion:\s*([0-9.]+)/m)?.[1] || "0.0.0";
    const bundledVersion = versionOf(EMBEDDED_MAINTENANCE_HELPER);
    let installedVersion = "0.0.0";
    try { installedVersion = versionOf(fs.readFileSync(paths.helperPath, "utf8")); } catch (_) {}
    if (compareVersions(installedVersion, bundledVersion) >= 0) return paths.helperPath;
    fs.mkdirSync(path.dirname(paths.helperPath), { recursive: true });
    const temporary = `${paths.helperPath}.new`;
    fs.writeFileSync(temporary, EMBEDDED_MAINTENANCE_HELPER, "utf8");
    fs.renameSync(temporary, paths.helperPath);
    return paths.helperPath;
  }

  getLocalStatus() {
    const paths = this.getPaths();
    if (!paths.configured) return { paths, healthy: false, configured: false, updateStatus: null };
    const manifest = this.readJson(paths.manifestPath) || this.readJson(paths.legacyManifestPath) || {};
    let runtimeArchitecture = "Unknown";
    try { runtimeArchitecture = readPeMachine(paths.appExe); } catch (_) {}
    const computerArchitecture = hostArchitecture();
    const helperPath = fs.existsSync(paths.helperPath) ? paths.helperPath : paths.legacyHelperPath;
    return {
      configured: true, paths, helperPath, manifest, runtimeArchitecture, computerArchitecture,
      runtimeVersion: String(manifest.installedRuntime || "Unknown"),
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
    };
  }

  async scheduleMaintenance({ restartAfter = false } = {}) {
    const helperPath = this.ensureMaintenanceHelper();
    const local = this.getLocalStatus();
    if (isMaintenanceActive(local.updateStatus)) return { alreadyActive: true };
    return launchMaintenance({ kind: "all", helperPath, statusPath: local.paths.statusPath, waitForPid: maintenanceWaitPid(), restartAfter });
  }

  async maybeScheduleAutomaticMaintenance() {
    if (!this.settings.automaticMaintenance || Date.now() - this.settings.lastAutomaticCheck < AUTO_CHECK_INTERVAL_MS) return;
    this.settings.lastAutomaticCheck = Date.now();
    await this.saveData(this.settings);
    try {
      const local = this.getLocalStatus();
      if (!local.configured || isMaintenanceActive(local.updateStatus)) return;
      const latest = await this.latestStatus();
      if (!local.healthy || compareVersions(latest.runtimeVersion, local.runtimeVersion) > 0 || compareVersions(latest.frameworkVersion, local.frameworkVersion) > 0) {
        await this.scheduleMaintenance();
        new Notice("Portable update prepared. It will install automatically after you close Obsidian.", 8000);
      }
    } catch (_) {}
  }

  prepareBootstrapScript() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-portable-manager-"));
    const scriptPath = path.join(directory, "PortableBootstrap.ps1");
    const statusPath = path.join(directory, "operation-status.json");
    fs.writeFileSync(scriptPath, EMBEDDED_BOOTSTRAP_HELPER, "utf8");
    return { directory, scriptPath, statusPath };
  }

  async chooseDestination(operation) {
    if (!desktopDialog) throw new Error("The Windows folder picker is unavailable. Restart Obsidian and try again.");
    const options = { title: operation === "Setup" ? "Choose where to create Obsidian Portable" : "Choose where to copy Obsidian Portable", properties: ["openDirectory", "createDirectory", "dontAddToRecent"] };
    if (typeof desktopDialog.showOpenDialogSync === "function") {
      const selected = desktopDialog.showOpenDialogSync(options);
      return selected?.[0] ? targetPackageRoot(selected[0]) : null;
    }
    const result = await desktopDialog.showOpenDialog(options);
    return !result.canceled && result.filePaths?.[0] ? targetPackageRoot(result.filePaths[0]) : null;
  }

  async startBootstrap(operation) {
    const sourceVault = this.getVaultPath();
    const local = this.getLocalStatus();
    const targetRoot = await this.chooseDestination(operation);
    if (!targetRoot) return false;
    assertSafeTransferTarget(sourceVault, targetRoot);
    if (operation === "Transfer") {
      if (!local.configured) throw new Error("This vault is not inside a portable package.");
      assertSafeTransferTarget(local.paths.packageRoot, targetRoot);
    }
    const bootstrap = this.prepareBootstrapScript();
    const scriptArguments = [
      "-Operation", operation,
      "-TargetRoot", targetRoot,
      "-SourceVault", sourceVault,
      "-StatusPath", bootstrap.statusPath,
      "-WaitForPid", String(maintenanceWaitPid()),
      "-Bootstrap",
    ];
    if (operation === "Transfer") scriptArguments.push("-SourcePackageRoot", local.paths.packageRoot);
    await launchPortableOperation({ scope: operation.toLowerCase(), scriptPath: bootstrap.scriptPath, statusPath: bootstrap.statusPath, scriptArguments, acknowledgeStates: ["ready"] });
    new Notice("Obsidian will close now, finish the portable operation, and reopen from the destination.", 8000);
    this.requestQuit();
    return true;
  }

  async updateAndRestart() {
    await this.scheduleMaintenance({ restartAfter: true });
    new Notice("Obsidian will close, update safely, and reopen automatically.", 7000);
    this.requestQuit();
  }

  requestQuit() {
    if (electronApp && typeof electronApp.quit === "function") return electronApp.quit();
    try { if (this.app.commands?.executeCommandById?.("app:quit")) return; } catch (_) {}
    window.close();
  }

  openPath(targetPath) { void shell.openPath(targetPath); }
  reportMaintenanceResult() {
    const paths = this.getPaths();
    if (!paths.configured) return;
    const status = this.getMaintenanceStatus(paths);
    if (!status || !["completed", "failed"].includes(status.state)) return;
    new Notice(status.state === "completed" ? status.message : `Portable maintenance failed: ${status.message}`, status.state === "completed" ? 8000 : 12000);
    try { fs.unlinkSync(paths.statusPath); } catch (_) {}
  }
};

class PortableManagerModal extends Modal {
  constructor(app, plugin) { super(app); this.plugin = plugin; this.latest = null; this.busy = false; }
  async onOpen() { this.modalEl.addClass("opm-modal"); this.render(); if (this.plugin.getPaths().configured) await this.check(); }
  onClose() { this.contentEl.empty(); }

  render() {
    const local = this.plugin.getLocalStatus();
    const { contentEl } = this;
    contentEl.empty();
    const heading = contentEl.createDiv({ cls: "opm-heading" });
    const icon = heading.createDiv({ cls: "opm-logo" }); setIcon(icon, "package-check");
    const title = heading.createDiv();
    title.createEl("h2", { text: local.configured ? "Obsidian Portable" : "Make this vault portable" });
    title.createEl("p", { text: local.configured ? "Automatic app, runtime, and launcher care—kept inside this portable package." : "Choose a flash drive or folder. The manager handles everything else." });
    if (!local.configured) return this.renderSetup(contentEl);

    const health = contentEl.createDiv({ cls: `opm-health ${local.healthy ? "is-good" : "is-bad"}` });
    setIcon(health.createSpan(), local.healthy ? "circle-check" : "triangle-alert");
    health.createSpan({ text: local.healthy ? " Ready and portable" : " Automatic repair is needed" });

    const promise = contentEl.createDiv({ cls: "opm-promise" });
    promise.createEl("strong", { text: "Updates are automatic" });
    promise.createEl("p", { text: "Obsidian’s built-in app updates stay inside the portable Data folder. Portable Manager safely handles the runtime and launcher after you close Obsidian." });

    const grid = contentEl.createDiv({ cls: "opm-grid" });
    this.addStatus(grid, "Location", local.paths.packageRoot);
    this.addStatus(grid, "Obsidian runtime", `${local.runtimeVersion} · ${local.runtimeArchitecture}`);
    this.addStatus(grid, "Portable framework", local.frameworkVersion);
    this.addStatus(grid, "Computer", local.computerArchitecture);

    const status = local.updateStatus;
    if (status && !["completed"].includes(status.state)) {
      const box = contentEl.createDiv({ cls: `opm-state ${status.state === "failed" ? "is-failed" : ""}` });
      setIcon(box.createSpan(), status.state === "failed" ? "circle-x" : "loader-circle");
      box.createSpan({ text: ` ${status.message || status.state}` });
    }

    const primary = contentEl.createDiv({ cls: "opm-primary-actions" });
    new ButtonComponent(primary).setButtonText(this.updateLabel(local)).setIcon("refresh-cw").setCta().setDisabled(this.busy || isMaintenanceActive(status)).onClick(() => this.run(() => this.plugin.updateAndRestart()));
    new ButtonComponent(primary).setButtonText("Copy to another location").setIcon("copy").setDisabled(this.busy || isMaintenanceActive(status)).onClick(() => this.run(() => this.plugin.startBootstrap("Transfer")));
    const secondary = contentEl.createDiv({ cls: "opm-secondary-actions" });
    new ButtonComponent(secondary).setButtonText("Open portable folder").setIcon("folder-open").onClick(() => this.plugin.openPath(local.paths.packageRoot));
  }

  renderSetup(container) {
    const card = container.createDiv({ cls: "opm-welcome-card" });
    const steps = card.createDiv({ cls: "opm-benefits" });
    for (const [iconName, text] of [["mouse-pointer-click", "One guided setup"], ["shield-check", "Signed downloads and rollback"], ["repeat-2", "Automatic portable updates"], ["copy", "Easy transfer later"]]) {
      const item = steps.createDiv(); setIcon(item.createSpan(), iconName); item.createSpan({ text });
    }
    card.createEl("p", { text: "Your current vault is copied—not moved. After setup, Obsidian reopens from the portable copy." });
    const actions = card.createDiv({ cls: "opm-primary-actions" });
    new ButtonComponent(actions).setButtonText("Choose location and create").setIcon("folder-plus").setCta().setDisabled(this.busy).onClick(() => this.run(() => this.plugin.startBootstrap("Setup")));
  }

  addStatus(container, label, value) { const item = container.createDiv({ cls: "opm-stat" }); item.createDiv({ cls: "opm-stat-label", text: label }); item.createDiv({ cls: "opm-stat-value", text: value }); }
  updateLabel(local) {
    if (!this.latest) return local.healthy ? "Check, update, and restart" : "Repair and restart";
    const available = compareVersions(this.latest.runtimeVersion, local.runtimeVersion) > 0 || compareVersions(this.latest.frameworkVersion, local.frameworkVersion) > 0;
    return available ? "Update and restart" : "Recheck and restart";
  }
  async check() { try { this.latest = await this.plugin.latestStatus(); this.render(); } catch (_) {} }
  async run(action) {
    if (this.busy) return;
    this.busy = true; this.render();
    try { await action(); }
    catch (error) { new Notice(error.message, 12000); this.busy = false; this.render(); }
  }
}
