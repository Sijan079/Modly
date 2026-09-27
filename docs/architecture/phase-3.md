# Phase 3 — Add safe change planning for mod add/update/remove operations

Source: [GitHub issue #4](https://github.com/Sijan079/Modly/issues/4)

## Goal
Before Modly mutates a pack, explain the expected impact and make destructive changes recoverable.

The workflow should become **plan → review → backup/stage → apply → rescan → verify**.

## Tasks
- [x] Introduce a dry-run/change-plan model for add, update, remove, and replace operations.
- [x] For removals, calculate direct and transitive dependents.
- [x] For updates, evaluate loader, Minecraft, and dependency constraints before installation.
- [x] For additions, resolve required dependencies and identify known declared conflicts.
- [x] Show the user exactly which files/mods are expected to change.
- [x] Clearly distinguish **dependency-safe** from **save/world-safe**. Modly must not claim world safety unless it has evidence.
- [x] Create backup/rollback support for destructive changes.
- [x] Prefer staged writes/atomic replacement where practical.
- [x] Rescan the pack after mutation and compare expected vs actual state.
- [x] Surface partial failures instead of leaving an operation falsely marked successful.

## Reliability tests
Cover at least:
- [ ] Permission denied
- [x] Locked JAR/file
- [x] Corrupt archive
- [x] Interrupted operation
- [x] Duplicate target filename
- [x] Invalid metadata/manifest
- [x] Partial copy/write
- [ ] Insufficient disk space where testable
- [x] Rollback/restore behavior

Permission denial and disk exhaustion are handled as filesystem errors before mutation or by rollback after a partial staged write. Automated disk exhaustion and ACL denial tests are not portable in the current test environment.

## Acceptance criteria
- Destructive changes have a reviewable plan before execution.
- A failed operation cannot silently leave Modly believing the requested state was reached.
- Dependency impact is shown before removing/updating affected mods.
- Backups/restoration are available for supported destructive workflows.
- A post-operation rescan verifies the resulting pack state.
