# Phase 7 — Connect diagnostics to maintenance actions and consolidate the UX

Source: [GitHub issue #8](https://github.com/Sijan079/Modly/issues/8)

## Goal
Turn the underlying intelligence into one coherent modpack-management workflow instead of a collection of disconnected tools.

The target loop is:

**Inspect → Diagnose → Change → Verify**

## Tasks
- [ ] Connect Pack Health findings to safe remediation/change plans.
- [ ] Connect crash investigation results to relevant update/removal/review workflows.
- [ ] If a maintainer-confirmed issue states a fix exists in a newer compatible version, allow the user to review an update plan rather than automatically updating.
- [ ] Embed dependency/relationship summaries into mod details with a deeper graph view available when useful.
- [ ] Consolidate Scout/Mod Suggestions into a coherent analysis/recommendation experience.
- [ ] Design a pack overview around actionable categories such as Compatibility, Dependencies, Integrity, Updates, Metadata, and Recent Diagnostics.
- [ ] Reduce duplicate concepts/routes introduced by historical feature growth.
- [ ] Split oversized frontend pages and backend modules by domain as the new boundaries become clear.
- [ ] Ensure destructive filesystem operations and diagnostic pipelines have integration/regression coverage.
- [ ] Update product documentation to describe the final workflow and evidence model.

## Product principle
Modly should help the user answer:
1. **What is in my pack?**
2. **Why is it here / what depends on it?**
3. **Is anything detectably wrong?**
4. **What happens if I change this?**
5. **What evidence can help investigate a crash?**
6. **How can I improve the pack without blindly changing it?**

## Acceptance criteria
- Common maintenance tasks flow through shared dependency/health/change-plan primitives rather than separate ad-hoc logic.
- Diagnostic findings can lead to reviewable actions without automatically mutating the pack.
- The UI consistently distinguishes facts, warnings, inferences, community evidence, and unknowns.
- The app reads as a **modpack manager with maintenance intelligence**, not a launcher or generic collection of Minecraft utilities.
