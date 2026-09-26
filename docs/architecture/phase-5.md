# Phase 5 — Build crash investigation from local evidence before external search

Source: [GitHub issue #6](https://github.com/Sijan079/Modly/issues/6)

## Goal
Create a crash-analysis pipeline that first extracts evidence from the user's pack and logs, then produces a small candidate set for deeper investigation.

External issue trackers should not be queried until local analysis has narrowed the search.

## Tasks
- [ ] Parse Minecraft crash reports and relevant logs into a normalized diagnostic record.
- [ ] Extract exception type/message, stack frames/namespaces, mentioned mod IDs, loader/Minecraft versions, and relevant environment data.
- [ ] Map stack namespaces and explicit mod references back to installed mods where possible.
- [ ] Incorporate recent Modly-managed changes as contextual evidence without assuming they caused the crash.
- [ ] Use the dependency graph to expand likely related components when justified.
- [ ] Produce a ranked/sorted **investigation candidate set**, not a declaration of root cause.
- [ ] Explain why each candidate is being investigated.
- [ ] Persist crash fingerprints/results locally to avoid repeating expensive analysis.

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
