# Phase 4 — Rework Scout into evidence-based pack analysis and recommendations

Source: [GitHub issue #5](https://github.com/Sijan079/Modly/issues/5)

## Goal
Make Scout reason from the actual pack rather than presenting pseudo-precise recommendation scores.

Scout should answer **what might improve this pack, why, and what are the compatibility implications?**

## Tasks
- [ ] Replace the current generic 0–100 recommendation score with explainable dimensions/signals.
- [ ] Base recommendations on the canonical local pack model and health/dependency engine.
- [ ] Evaluate Minecraft version, loader, required dependencies, and known declared incompatibilities before recommending a candidate.
- [ ] Explain *why* each mod is suggested in relation to the current pack.
- [ ] Show maintenance/activity information as evidence, not as proof of quality.
- [ ] Represent performance impact as unknown unless Modly has defensible evidence.
- [ ] Merge or rationalize conceptual overlap between **Mod Suggestions** and **Scout**.
- [ ] Support saved/rejected recommendations without globally interpreting a rejection as "I dislike this category of mod."
- [ ] Keep recommendation output separate from deterministic health findings.

## Example output
Instead of:

`87/100 — Recommended`

Prefer:

- Minecraft compatibility: ✓
- Loader compatibility: ✓
- Required dependencies: ✓ / needs review
- Known declared conflicts: none detected
- Pack fit: strong (with explanation)
- Maintenance: active/recent (with source/date)
- Performance impact: unknown
- Why suggested: explicit evidence

## Acceptance criteria
- Every recommendation contains an understandable reason.
- Incompatible candidates are blocked or prominently flagged before installation.
- Scout does not present heuristic scores as scientific confidence.
- Scout uses the same dependency/version rules as Pack Health and safe-change planning.
