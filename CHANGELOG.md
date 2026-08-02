# Changelog

## 1.3.1

- Added an acknowledged updater launch handshake with actionable failure reporting.
- Prevented simultaneous runtime and framework maintenance operations.
- Added automatic recovery for abandoned launch and maintenance status records.
- Wait for Obsidian's main process before swapping runtime or framework files.
- Added immediate progress reporting and collision-resistant status writes.

## 1.3.0

- Continued version numbering above the deployed 1.0.0 plugin and 1.2.1
  launcher prototypes so BRAT and framework checks recognize the public build
  as an upgrade.
- Retained the audited plugin, runtime updater, framework updater, and rollback
  behavior introduced by the bootstrap release.

## 0.1.0

- Added portable-package health and CPU architecture checks.
- Added signed official Obsidian runtime updates with staged rollback.
- Added versioned launcher and maintenance-framework updates.
- Added BRAT-compatible plugin releases and a Windows framework bundle.
- Added public-content, path-safety, manifest, syntax, and build audits.
