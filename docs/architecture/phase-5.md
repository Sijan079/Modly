# Phase 5 — Build crash investigation from local evidence before external search

Source: [GitHub issue #6](https://github.com/Sijan079/Modly/issues/6)

## Goal
Create a crash-analysis pipeline that first extracts evidence from the user's pack and logs, then produces a small candidate set for deeper investigation.

External issue trackers should not be queried until local analysis has narrowed the search.

## Tasks
- [x] Parse Minecraft `.txt` crash reports and `.log` files into a normalized diagnostic record.
- [x] Extract exception type/message, stack frames/namespaces, explicit mod IDs, loader/Minecraft versions, and relevant environment data.
- [x] Map explicit references and exact stack package segments back to enabled installed mods where possible.
- [x] Show recent Modly-managed changes as context without assuming they caused the crash.
- [x] Expand direct evidence one hop through installed required dependencies.
- [x] Produce a sorted **investigation candidate set**, not a declaration of root cause.
- [x] Explain why each candidate is being investigated and keep unmapped frames visible.
- [x] Persist crash fingerprints/results in the local database; reuse a saved result when the report and pack file metadata have not changed.

## Language rules
Prefer:
- "Appears in the stack trace"
- "Worth investigating"
- "Possible relationship"
- "Insufficient evidence"

Avoid:
- "This mod caused the crash"
unless there is genuinely authoritative evidence supporting that statement.

## Acceptance criteria
- A crash involving a small subset of installed mods does not trigger remote lookups for the entire pack.
- Candidate mods include human-readable evidence explaining their selection.
- Local crash analysis works offline.
- Unknown/unmapped stack frames remain explicit rather than being guessed.

## Implementation notes

The Logs screen accepts a selected local report, analyzes it without network requests, and keeps the last result for each instance. The parser caps files at 8 MB and records up to 80 frames. Exact mod IDs, `Mod File` lines, and package segments are direct evidence. Installed required dependencies are included only when linked to a direct candidate. Other installed mods are not queried or automatically added. Filename and modification-time changes invalidate the cached result; a file changed while preserving both metadata values may require a fresh analysis after another pack change.
