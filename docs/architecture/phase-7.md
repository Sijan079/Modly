# Phase 7 — Connect diagnostics to maintenance actions and consolidate the UX

Source: [GitHub issue #8](https://github.com/Sijan079/Modly/issues/8)

## Goal
Turn the underlying intelligence into one coherent modpack-management workflow instead of a collection of disconnected tools.

The target loop is:

**Inspect → Diagnose → Change → Verify**

## Tasks
- [x] Connect Pack Health findings to safe remediation/change plans.
- [x] Connect crash investigation results to relevant update/removal/review workflows.
- [x] If a maintainer-confirmed issue states a fix exists in a newer compatible version, allow the user to review an update plan rather than automatically updating.
- [x] Embed dependency/relationship summaries into mod details with a deeper graph view available when useful.
- [x] Consolidate Scout/Mod Suggestions into a coherent analysis/recommendation experience.
- [x] Design a pack overview around actionable categories such as Compatibility, Dependencies, Integrity, Updates, Metadata, and Recent Diagnostics.
- [x] Reduce duplicate concepts/routes introduced by historical feature growth.
- [x] Split oversized frontend pages and backend modules by domain as the new boundaries become clear.
- [x] Ensure destructive filesystem operations and diagnostic pipelines have integration/regression coverage.
- [x] Update product documentation to describe the final workflow and evidence model.

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

## Implementation notes

Dashboard category cards deep-link to filtered Pack Health findings. Findings and crash leads link to mod details, compatible update checks, and the existing removal change-plan preview. A removal link only prepares the plan; applying it still requires explicit confirmation in the change dialog. Mod details show observed incoming and outgoing relationships alongside the user's manually mapped relationships, with a link to the graph.

Community issue labels remain supporting evidence. A maintainer-labeled result links to the update workspace, where the saved provider check must identify a compatible, confirmed replacement before an update plan can be opened. The issue label alone never starts an update. If no saved result exists, the user can run Check Updates and review the original issue. The saved crash analysis remains a snapshot of the pack at analysis time.

The sidebar has one Discover entry for Scout recommendations and saved suggestions; the original suggestions route remains available for existing links. Crash result cards and diagnostic persistence methods now live in focused modules. The existing change-plan filesystem regression tests and crash/community diagnostic tests cover the shared action and evidence pipelines.
