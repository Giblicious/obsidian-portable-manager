# Contributing

Use a focused branch and pull request. Before pushing, run:

```text
npm ci
npm run check
```

Public releases use semantic version tags such as `0.1.0`. The tag must match
`package.json`, `manifest.json`, `versions.json`, and
`framework/framework-manifest.json`. Only the release workflow publishes
plugin or framework assets.

Changes to maintenance paths, downloads, signatures, checksums, process waits,
or rollback behavior require tests and an explicit security-impact note in the
pull request.
