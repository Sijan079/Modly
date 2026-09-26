# Phase 1 — Build a canonical local modpack truth model and dependency graph

Source: [GitHub issue #2](https://github.com/Sijan079/Modly/issues/2)

## Goal
Create a deterministic model of what is **actually installed locally** before Modly tries to judge health or make recommendations.

The filesystem and mod manifests should be the source of truth for installed content. Provider APIs enrich that truth; they should not replace it.

## Tasks
- [x] Normalize installed mod records across Fabric, Forge, and NeoForge.
- [x] Extract mod ID, name, version, loader, Minecraft constraints, side/environment, and declared relationships from JAR metadata.
- [x] Parse required, optional/recommended, incompatible/conflicting, and embedded relationships where available.
- [x] Distinguish three data classes:
  - observed local facts,
  - provider-enriched metadata,
  - user annotations/manual overrides.
- [x] Build a normalized dependency graph from declared metadata.
- [x] Preserve parse failures and unknown metadata instead of silently guessing.
- [x] Track provenance for important facts so diagnostics can explain where information came from.
- [x] Add fixture packs/JAR metadata samples for supported loaders.

## Relationship UI direction
The graph should be an underlying capability, not the only way relationships are exposed. A mod detail view should be able to answer:
- What does this mod require?
- What optionally integrates with it?
- What installed mods depend on it?
- Why is this mod installed?
- What breaks if it is removed?

## Acceptance criteria
- Re-scanning an unchanged fixture pack produces the same normalized model.
- Declared dependencies do not require manual relationship creation.
- Unknown/unsupported metadata is explicitly represented.
- Provider enrichment cannot overwrite contradictory observed local facts without retaining provenance.
- Dependency paths can be traversed in both directions.

## Implementation

The read-only `get_pack_truth` command scans the instance's current `mods` folder and returns a stable snapshot of observed JAR facts, saved Modrinth enrichment, and user annotations in separate fields. It includes disabled JARs. A missing supported manifest and a failed parse have distinct statuses; neither is converted into a guessed local fact. The snapshot does not include scan time or generated IDs, so unchanged fixture packs serialize identically across scans.

Fabric `fabric.mod.json`, Forge `mods.toml`, and NeoForge `neoforge.mods.toml` supply mod IDs, display names, versions, loader identity, declared Minecraft constraints, environment or dependency side where available, provided IDs, and declared relationships. Relationship kinds include required, optional, recommended, suggested, incompatible, conflicting, and embedded. The graph retains its manifest path, raw version constraint, and target resolution: installed, missing, ambiguous, external, or embedded. `get_mod_truth_relationships` returns direct incoming/outgoing links and traversable required dependency paths in both directions. Manual links remain a separate annotation. The existing relationship graph now retains detected required links even when manual dependencies exist.

Fixture manifests are in `src-tauri/tests/fixtures/phase1`; the test builds JARs from them and checks repeat scans, provenance separation, parse failures, unknown manifests, disabled files, provided IDs, and forward/reverse paths. Format mappings follow the official [Fabric manifest reference](https://docs.fabricmc.net/develop/loader/fabric-mod-json), [Forge mod file reference](https://docs.minecraftforge.net/en/1.20.x/gettingstarted/modfiles/), and [NeoForge mod file reference](https://docs.neoforged.net/docs/1.21.10/gettingstarted/modfiles/).

Version ranges are preserved as declared; compatibility judgments belong to Phase 2. For Forge and NeoForge files containing several `[[mods]]` entries, the first entry supplies the displayed name/version and later entries are retained as provided IDs. The current TOML reader handles common single-line fields; complex TOML constructs need separate parser work before their values can be treated as observed facts.
