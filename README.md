# Modly

<p align="center">
  <img src="public/app-icon.png" alt="Modly icon" width="88" />
</p>

<p align="center">
  A desktop modpack manager for understanding and maintaining Minecraft packs in the folders you already use.
</p>

Modly inventories pack files, explains relationships and health findings, helps investigate crashes, and previews changes before applying them. It works with existing Minecraft instances; it does not launch the game, manage accounts, or install Java runtimes. See the [product boundary](docs/PRODUCT.md).

## Get Modly

Download a Windows `.msi` from [GitHub Releases](../../releases) when one is available. Install it, then add or import an existing Minecraft instance and point Modly at its game directory.

Modly stores its settings, scans, and diagnostic history locally. Your mod JARs, configs, resource packs, shader packs, and datapacks stay in the instance folders you choose.

## Inspect → diagnose → change → verify

1. **Inspect.** Select an instance on the dashboard. Scan its files, then open Pack Health for findings grouped by compatibility, dependencies, integrity, updates, or metadata. The Relationships graph and each mod's details show declared and manually mapped links.
2. **Diagnose.** Open a finding to see its evidence and certainty. In Logs, choose a Minecraft crash report or log to identify installed mods worth investigating. Local crash analysis works offline and keeps unmapped stack frames visible. A separate, optional search checks relevant public GitHub issues for those candidates.
3. **Change.** From a finding or crash lead, inspect the mod, check compatible updates, or preview removal impact. Add, replace, update, and removal plans show the expected file operation and dependency effects before you confirm. Supported changes keep a backup and rescan the pack after applying.
4. **Verify.** Recheck Pack Health after a change. If you are investigating a crash, analyze the report again against the current pack. A saved crash result describes the pack as it was when analyzed.

Findings describe what Modly can observe; no finding means no detected issue, not proof that a pack will launch. Dependency checks cannot establish save or world safety. A crash candidate or similar community report is a lead, not a confirmed cause. Community labels never start an update: the update workspace requires a confirmed, compatible provider result and a reviewable change plan.

## Improve a pack

**Discover** runs Scout analysis on the selected instance and explains why an addition might fit. It checks available release evidence for the instance's Minecraft version and loader, and flags missing dependencies or declared conflicts where possible. Performance effects and other unsupported claims remain unknown. Save a recommendation to **Saved suggestions** for later review; saving does not install it. Provider searches require a network connection.

Modly also supports instance import, duplication, and ZIP export; mod categories and metadata edits; config editing; compatible update checks; and resource pack, shader pack, and datapack management. You can set custom content and config paths per instance.

## Development

The desktop app uses Tauri, Rust, React, TypeScript, and SQLite. With the platform prerequisites for Tauri installed:

```bash
npm ci
npm run tauri dev
```

Run the frontend build and automated checks with:

```bash
npm run build
npm run test:health
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

For a distributable desktop build, follow the [versioning and release checklist](docs/VERSIONING.md) before running `npm run tauri build`.

## Design and architecture

- [Product boundary](docs/PRODUCT.md): what Modly owns and excludes.
- [Architecture phases](docs/architecture/phase-0.md): the implementation path from launcher cleanup through diagnostic workflows. Continue through the numbered phase documents for details.
- [Versioning](docs/VERSIONING.md): SemVer and release artifact checks.
