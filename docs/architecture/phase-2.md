# Phase 2 — Implement evidence-based Pack Health diagnostics

Source: [GitHub issue #3](https://github.com/Sijan079/Modly/issues/3)

## Goal
Turn Modly's metadata and dependency model into actionable **preventative health checks** without pretending that uncertain observations are facts.

This phase is deterministic/local-first. Community issue searching belongs to the later crash-intelligence phase.

## Initial health checks
- [ ] Missing required dependencies.
- [ ] Installed dependency versions outside declared constraints.
- [ ] Minecraft-version incompatibilities.
- [ ] Loader incompatibilities.
- [ ] Duplicate/conflicting mod IDs or suspicious duplicate libraries.
- [ ] Corrupt/unreadable mod archives and metadata.
- [ ] Potential orphan libraries/dependencies with no detected dependents.
- [ ] Provider-known compatible updates.
- [ ] Unidentified mods / incomplete metadata.
- [ ] Declared incompatibilities between installed mods where metadata provides them.

## Evidence model
Findings should carry a type/severity and evidence rather than an arbitrary universal score.

Suggested language:
- **Confirmed locally**
- **Known incompatibility**
- **Warning**
- **Possible relationship**
- **Unknown / insufficient evidence**

Avoid an unexplained `83/100 health` score. Prefer a breakdown such as Compatibility, Dependencies, Integrity, Updates, Orphans, and Metadata.

## Tasks
- [ ] Introduce a normalized health-finding/result model.
- [ ] Include affected mods, evidence/provenance, severity, and possible remediation.
- [ ] Keep deterministic findings separate from heuristics.
- [ ] Build a Pack Health UI that explains each finding.
- [ ] Allow users to navigate from a finding to the affected mod/dependency relationship.
- [ ] Add fixture tests for every supported diagnostic.
- [ ] Ensure Modly never labels a pack "safe" merely because no known finding was detected.

## Acceptance criteria
- Every warning/error shown to the user can explain why it exists.
- Known facts and heuristic warnings are visually/semantically distinguishable.
- Health scanning requires no GitHub issue crawling.
- Test fixtures cover both positive findings and non-finding cases to reduce false positives.
