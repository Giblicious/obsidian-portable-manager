# Changelog

## 1.3.2

- Added a guided first-run flow that turns any fresh BRAT vault into a complete
  portable package at a user-selected location.
- Added one-action transfer that copies the vault, profile, plugins, signed
  runtime, and current framework before reopening from the destination.
- Added combined automatic runtime/framework maintenance that safely finishes
  after a normal Obsidian close, plus a one-click update-and-restart action.
- Made the launcher package-relative so portable workspaces can live in a
  folder instead of being forced onto the root of a drive.
- Kept Obsidian's built-in app updates inside the package's portable Data
  profile and automatically re-enabled them, avoiding a second conflicting
  app-update control.
- Hardened long-running prepared-update recovery, detached bootstrap
  acknowledgement, staging cleanup, transfer path boundaries, and legacy-layout
  migration.

Security impact: setup and transfer add trusted filesystem-copy and process
launch paths. Destinations are required to be separate from the source, new
packages are assembled in a uniquely named staging directory, framework assets
remain checksum-verified, and runtime downloads retain Authenticode, version,
architecture, size, and rollback checks.

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
