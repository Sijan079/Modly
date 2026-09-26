# Phase 3 — Add safe change planning for mod add/update/remove operations

Source: [GitHub issue #4](https://github.com/Sijan079/Modly/issues/4)

## Goal
Before Modly mutates a pack, explain the expected impact and make destructive changes recoverable.

The workflow should become **plan → review → backup/stage → apply → rescan → verify**.

## Tasks
- [ ] Introduce a dry-run/change-plan model for add, update, remove, and replace operations.
- [ ] For removals, calculate direct and transitive dependents.
- [ ] For updates, evaluate loader, Minecraft, and dependency constraints before installation.
- [ ] For additions, resolve required dependencies and identify known declared conflicts.
- [ ] Show the user exactly which files/mods are expected to change.
- [ ] Clearly distinguish **dependency-safe** from **save/world-safe**. Modly must not claim world safety unless it has evidence.
- [ ] Create backup/rollback support for destructive changes.
- [ ] Prefer staged writes/atomic replacement where practical.
- [ ] Rescan the pack after mutation and compare expected vs actual state.
- [ ] Surface partial failures instead of leaving an operation falsely marked successful.

## Reliability tests
Cover at least:
- [ ] Permission denied
- [ ] Locked JAR/file
- [ ] Corrupt archive
- [ ] Interrupted operation
- [ ] Duplicate target filename
- [ ] Invalid metadata/manifest
- [ ] Partial copy/write
- [ ] Insufficient disk space where testable
- [ ] Rollback/restore behavior

## Acceptance criteria
- Destructive changes have a reviewable plan before execution.
- A failed operation cannot silently leave Modly believing the requested state was reached.
- Dependency impact is shown before removing/updating affected mods.
- Backups/restoration are available for supported destructive workflows.
- A post-operation rescan verifies the resulting pack state.
