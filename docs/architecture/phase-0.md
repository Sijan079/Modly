# Phase 0 — Re-establish Modly as a modpack manager and remove launcher scope

Source: [GitHub issue #1](https://github.com/Sijan079/Modly/issues/1)

## Goal
Make the repository reflect Modly's intended product boundary: **Modly manages modpacks; it does not launch Minecraft.**

The current repository still contains historical launcher/runtime code that makes the product look like a launcher competitor. Remove or isolate that scope before adding more features.

## Product boundary

Modly should own:
- Installed modpack inventory and metadata
- Mods, configs, resource packs, shader packs, and datapacks
- Pack import/export, backup, duplication, and restoration
- Dependency/relationship intelligence
- Pack health and maintenance
- Safe add/update/remove planning
- Scout/recommendations
- Crash investigation and supporting community evidence

Modly should **not** own:
- Minecraft account/authentication
- Starting/stopping the game
- Java/runtime provisioning
- Launcher-specific account management
- Reimplementing Prism/Modrinth/CurseForge launcher responsibilities

Existing Minecraft instances/folders remain valid inputs because they represent modpacks Modly can manage.

## Tasks
- [x] Audit Rust commands/services and React UI for launcher-only responsibilities.
- [x] Remove or deprecate launch/start/stop/runtime configuration code that has no modpack-management purpose.
- [x] Remove dead launcher UI/routes/settings.
- [x] Preserve instance/folder discovery where it is useful for locating modpacks.
- [x] Add a short product-boundary document (for example `docs/PRODUCT.md`) defining mission, responsibilities, and non-goals.
- [x] Map existing major features to: **Understand → Maintain → Change Safely → Improve**.
- [x] Flag functionality that does not fit any of those responsibilities instead of expanding it by default.
- [x] Update stale documentation/TODOs so they match the actual direction.

## Acceptance criteria
- No normal user workflow requires Modly to launch Minecraft.
- Product documentation clearly describes Modly as a modpack manager.
- Historical launcher functionality is removed or explicitly isolated/deprecated.
- Instance discovery still works for supported local modpack locations.
- Existing pack-management behavior is not regressed.
