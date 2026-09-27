# Phase 2 — Implement evidence-based Pack Health diagnostics

Source: [GitHub issue #3](https://github.com/Sijan079/Modly/issues/3)

## Goal
Turn Modly's metadata and dependency model into actionable **preventative health checks** without pretending that uncertain observations are facts.

This phase is deterministic/local-first. Community issue searching belongs to the later crash-intelligence phase.

## Initial health checks
- [x] Missing required dependencies.
- [x] Installed dependency versions outside declared constraints.
- [x] Minecraft-version incompatibilities.
- [x] Loader incompatibilities.
- [x] Duplicate/conflicting mod IDs or suspicious duplicate libraries.
- [x] Corrupt/unreadable mod archives and metadata.
- [x] Potential orphan libraries/dependencies with no detected dependents.
- [x] Provider-known compatible updates.
- [x] Unidentified mods / incomplete metadata.
- [x] Declared incompatibilities between installed mods where metadata provides them.

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
- [x] Introduce a normalized health-finding/result model.
- [x] Include affected mods, evidence/provenance, severity, and possible remediation.
- [x] Keep deterministic findings separate from heuristics.
- [x] Build a Pack Health UI that explains each finding.
- [x] Allow users to navigate from a finding to the affected mod/dependency relationship.
- [x] Add fixture tests for every supported diagnostic.
- [x] Ensure Modly never labels a pack "safe" merely because no known finding was detected.

## Acceptance criteria
- Every warning/error shown to the user can explain why it exists.
- Known facts and heuristic warnings are visually/semantically distinguishable.
- Health scanning requires no GitHub issue crawling.
- Test fixtures cover both positive findings and non-finding cases to reduce false positives.

## Implementation

The Pack Health page reads a fresh Phase 1 pack truth snapshot, verifies each local JAR entry, and incorporates the last saved Modrinth update check. It does not crawl community issues or make network requests during the health scan. It checks enabled JARs; disabled JARs are excluded from compatibility findings.

Findings include category, severity, certainty, affected file paths, observed manifest or provider evidence, and a suggested next step. Confirmed local facts and known incompatibilities are labeled separately from possible or unknown cases. Users can open the affected mod and inspect its declared incoming and outgoing relationships directly from a finding. The page never presents an empty result as proof of safety.

Version comparisons support numeric dotted versions, comparison operators, Fabric-style caret and tilde ranges, and Forge/NeoForge interval syntax. Unsupported syntax, unresolved dependency versions, provided IDs without their own observed version, and missing instance versions produce an insufficient-evidence finding instead of a compatibility judgment. Side-scoped relationships remain possible warnings because Modly does not know whether the instance is used as a client or server. Saved update findings require an exact confirmed project match and a current version that still matches the observed JAR; the page shows the original check date because provider availability can change.

The normalized fixture in `tests/fixtures/phase2` and `npm run test:health` cover each diagnostic with positive and non-finding cases. A Rust ZIP fixture verifies that a corrupt entry is detected even when the archive opens normally. The full archive scan is read-only and leaves existing integrity audit records unchanged.
