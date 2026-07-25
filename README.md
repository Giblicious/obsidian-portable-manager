# Obsidian Portable Manager

Obsidian Portable Manager audits, repairs, and updates a portable Windows
Obsidian package from inside Obsidian. It keeps the application runtime and
portable framework separate from the vault and profile, so updates do not
replace notes, settings, plugins, or sync credentials.

## What it manages

- Detects the flash-drive root from the active vault.
- Verifies the expected portable package layout and host CPU architecture.
- Updates Obsidian from the official `obsidianmd/obsidian-releases` installer.
- Verifies installer size, Authenticode signer, extracted version, and PE type.
- Updates the root launcher, maintenance helper, and extraction tools from this
  repository's versioned framework release.
- Stages replacements, waits for Obsidian to close, retains rollback copies,
  and reports the result on the next launch.

The manager intentionally does not modify `Data`, the vault, Remotely Save or
other plugin settings, or `portable.ini` during an update.

## Install with BRAT

1. Install and enable BRAT in Obsidian.
2. Choose **Add Beta Plugin** in BRAT settings.
3. Enter `Giblicious/obsidian-portable-manager`.
4. Enable **Obsidian Portable Manager**.

The plugin expects this drive-relative layout:

```text
Obsidian Portable.exe
Apps/Portables/ObsidianPortable/
  App/Obsidian.exe
  Data/
  Maintenance/PortableMaintenance.ps1
  Tools/7z.exe
  portable.ini
  portable-manifest.json
```

Existing packages using `manifest.json` remain supported and are migrated to
`portable-manifest.json` by a successful maintenance operation.

## Release policy

Pushes and pull requests must pass the build, tests, public-content audit, and
Windows launcher/helper checks. A semantic version tag is accepted only when
all version files agree. The release publishes the standard Obsidian plugin
assets plus `portable-framework.zip` and its SHA-256 checksum.

Official Obsidian binaries are never stored in this repository or framework
archive. 7-Zip is redistributed under its included license solely to extract
the architecture-specific payload from the official Obsidian installer.

## Development

```text
npm ci
npm run check
```

See [SECURITY.md](SECURITY.md) before changing downloads, filesystem paths,
process handling, or rollback behavior.
