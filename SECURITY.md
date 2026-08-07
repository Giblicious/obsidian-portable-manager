# Security

Report vulnerabilities privately through this repository's GitHub security
advisory form. Do not open a public issue for an unpatched vulnerability.

Obsidian Portable Manager is a desktop-only plugin with authority to start a
PowerShell maintenance helper and replace executable files inside the portable
package. It therefore applies a narrower trust boundary than a normal theme or
display plugin:

- Obsidian runtime downloads must come from `obsidianmd/obsidian-releases`.
- The downloaded installer size, Authenticode signer, extracted version, and
  PE architecture are checked before installation.
- Framework downloads must come from this repository's GitHub Releases and
  match the published SHA-256 checksum and GitHub asset size.
- Maintenance paths are resolved beneath the configured flash-drive package.
- `App`, `Data`, `portable.ini`, and the vault are never included in framework
  release archives. Framework updates may replace only the root launcher,
  `Maintenance`, and `Tools`.
- Changes are staged before Obsidian closes. Existing components are retained
  until the replacement validates, and failed swaps are rolled back.
- Setup and transfer destinations must be separate from both the source vault
  and source package. New packages are assembled in a PID-unique sibling
  staging directory and moved into place only after the copy and framework
  validation succeed.
- Setup copies the source vault after Obsidian closes, then installs the latest
  official signed runtime. Transfer copies only the managed app/profile and
  vault boundaries, refreshes the checksum-verified framework, validates the
  runtime, and repairs the destination vault registry on launch.

The launcher in the initial public release is not Authenticode-signed. Its
release checksum protects against corruption but does not replace code-signing
identity. Windows may show the normal warning for an unsigned application.
Repository compromise remains in the framework-update threat model until a
code-signing certificate or independently signed release manifest is added.

Never commit vaults, portable profiles, `portable.ini`, plugin `data.json`
files, API tokens, passwords, update caches, or extracted Obsidian runtimes.
The official Obsidian application is downloaded directly by each user and is
not redistributed by this project.
