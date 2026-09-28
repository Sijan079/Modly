# Modly product boundary

Modly is a desktop modpack manager. It helps people understand, maintain, change, and improve the contents of Minecraft packs they already have. A Minecraft instance or folder is an input to Modly, regardless of which launcher created it.

## Responsibilities

| Stage | What Modly owns | Current features |
| --- | --- | --- |
| Understand | Inventory and explain pack contents and relationships. | Instance and folder discovery, mod and pack scans, metadata, categories, relationship graph, Scout analysis, local activity logs. |
| Maintain | Keep existing packs healthy and portable. | Integrity audits, compatible update checks, config editing, resource pack/shader pack/datapack management, import, export, backup, duplication. |
| Change Safely | Help people review and apply additions, updates, and removals with clear effects. | Change-plan previews, dependency impact, backups and restore, update matching and confirmation, filtered exports, category reassignment. |
| Improve | Find useful additions and investigate problems. | Discover recommendations and saved suggestions, local crash investigation, optional community issue evidence. |

Modly owns pack metadata and files: mods, configs, resource packs, shader packs, and datapacks. It may read existing Minecraft directories and instances to discover packs. It keeps its own settings and records locally.

## Non-goals

Modly does not manage Minecraft accounts or authentication, provision Java or other game runtimes, launch or stop Minecraft, or replace launcher account and game management. Launcher-specific JVM, memory, and game argument settings are outside Modly's scope.

## Scope check

New features should support at least one stage above. App window preferences and local logs support the manager itself and remain valid utility features. The historical game-launch commands, Java detection, launch configurations, and shell execution permissions did not fit this boundary and were removed in Phase 0. Existing launcher configuration rows and Java/memory settings in older local databases are removed when Modly next opens the database. Pack records and Modly's own window preference remain.

See [Phase 0](architecture/phase-0.md) for the transition plan.
