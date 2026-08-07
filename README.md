# Obsidian Portable Manager

Obsidian Portable Manager creates and cares for a complete portable Windows
Obsidian workspace from inside Obsidian. Install it with BRAT in any vault,
choose a flash drive or folder, and it copies the vault, installs the signed
runtime and launcher, closes the original session, and opens the portable copy.

## What it manages

- Creates a portable workspace at a user-selected drive or folder.
- Copies an existing vault without moving or modifying the source.
- Transfers an existing portable workspace to another location and reopens it.
- Discovers portable packages at any folder depth, including legacy drive-root
  layouts.
- Verifies the expected portable package layout and host CPU architecture.
- Keeps Obsidian's built-in app updates inside the portable Data profile.
- Automatically stages runtime and framework updates for the next normal close.
- Provides one-click update, repair, restart, and transfer actions.
- Verifies installer size, Authenticode signer, extracted version, and PE type.
- Updates the root launcher, maintenance helper, and extraction tools from this
  repository's versioned framework release.
- Stages replacements, waits for Obsidian to close, retains rollback copies,
  and reports the result on the next launch.

Runtime and framework maintenance never replaces `Data`, the vault, Remotely
Save, other plugin settings, or `portable.ini`. The launcher only repairs the
portable vault registry and keeps built-in app updates enabled.

## User experience

Add `Giblicious/obsidian-portable-manager` in BRAT and enable the plugin. On a
fresh vault, the guided setup screen opens automatically. The only choice is
the destination location; setup, validation, closing, and relaunch are handled
by the manager.

New packages use this package-relative layout and can live anywhere:

```text
Obsidian Portable/
  Obsidian Portable.exe
  Vault/<vault name>/
  Apps/Portables/ObsidianPortable/
    App/Obsidian.exe
    Data/
    Maintenance/PortableMaintenance.ps1
    Tools/7z.exe
    portable.ini
    portable-manifest.json
```

Existing drive-root packages and packages using `manifest.json` remain
supported and are migrated during successful maintenance or transfer.

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
