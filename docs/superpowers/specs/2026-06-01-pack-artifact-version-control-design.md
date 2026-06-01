# Pack Artifact Version Control Design

## Goal

Add reliable Modrinth version detection and verified replacement for ZIP-based resource packs and shader packs. Directory-based packs remain visible but report-only because they are working copies rather than immutable artifacts.

## Trust Model

Version status is based on artifact identity, not filenames or saved project URLs alone.

- A SHA-256 match returned by Modrinth is deterministic and may be adopted automatically.
- A saved Modrinth project identity identifies the upstream project but does not prove the installed version.
- A fuzzy search result is only a candidate. It must not be persisted or used to classify an update until the user confirms it.
- An app-managed ZIP whose current SHA-256 differs from its recorded installed artifact hash is modified. The app must block replacement.
- Directory packs are classified as local/custom directories. The app must not compare or replace them.

## Persisted Data

Extend file-based pack records and metadata with:

```rust
pub sha256: Option<String>
pub installed_modrinth_project_id: Option<String>
pub installed_modrinth_version_id: Option<String>
pub installed_artifact_sha256: Option<String>
```

`sha256` is the current scan-time hash for ZIP files. The installed artifact fields are persisted after an exact Modrinth hash adoption or a successful app-managed replacement. Directory packs do not receive artifact identity.

## Scan And Check Flow

During pack scanning:

1. Detect whether each resource pack or shader pack is a file or directory.
2. Compute SHA-256 for ZIP files.
3. Store the current hash with the pack record.
4. Leave directory packs unhashed and report-only.

During a Modrinth update check for a ZIP:

1. Compare the current SHA-256 with the recorded installed artifact SHA-256 when one exists.
2. If they differ, classify the item as `modified` and stop. Do not offer replacement.
3. Query Modrinth by the current SHA-256.
4. If Modrinth returns an exact artifact, automatically persist its project ID, version ID, and artifact hash.
5. Query the latest release compatible with the selected instance Minecraft version and loader.
6. If the exact installed version ID equals the latest compatible version ID, classify the item as `upToDate`.
7. If the exact installed version ID differs from the latest compatible version ID, classify the item as `updateAvailable`.
8. If the hash lookup fails but a saved project identity exists, classify the item as `unknown` because the installed version is not proven.
9. If no project identity exists, use conservative search fallback to return confirmation candidates only.

The latest compatible version keeps the existing strict Minecraft-version and loader rules.

## Statuses

Extend update statuses with:

- `updateAvailable`
- `upToDate`
- `unknown`
- `modified`
- `localDirectory`
- `error`

`modified` and `localDirectory` are terminal report states for the current check. Neither state allows replacement.

## Replacement Flow

Allow individual and bulk updates for eligible ZIP-based resource packs and shader packs alongside mods.

For each eligible ZIP replacement:

1. Show the existing blocking update modal. Replacement cannot be cancelled after it starts.
2. Re-read and hash the source ZIP immediately before replacement.
3. Reject replacement if the source hash differs from the recorded installed artifact SHA-256.
4. Download the selected latest compatible Modrinth file.
5. Verify that the downloaded file exists.
6. Verify the downloaded SHA-256 against Modrinth when the expected hash is available.
7. Move the old ZIP to the existing app backup/trash location.
8. Move the verified ZIP into the original pack directory.
9. Persist the new project ID, version ID, and installed artifact SHA-256.
10. Rescan pack records and run a fresh update check so the row becomes `upToDate`.
11. Write an update log entry containing pack type, pack name, old version ID, new version ID, and timestamp.

If download, verification, or replacement fails before the new ZIP is active, preserve or restore the old ZIP. Never leave a partially replaced pack active.

## User Interface

The Updates page reuses its current selected-row and blocking-progress patterns.

- ZIP resource packs and shader packs with `updateAvailable` status receive row checkboxes.
- `Update selected` includes eligible mods and ZIP packs.
- The details modal shows the current artifact state, latest compatible version, changelog when available, Modrinth link, and update action.
- Modified ZIP packs explain that replacement is blocked because local changes were detected.
- Directory packs explain that they are local/custom and report-only.
- Unknown ZIP packs explain that a deterministic installed version could not be established.

## Interfaces

Extend update replacement inputs so a single backend command can identify the item type and expected source artifact:

```rust
pub struct UpdateArtifactFromModrinthInput {
    pub item_id: String,
    pub item_type: UpdateItemType,
    pub project_id: String,
    pub version_id: String,
    pub download_url: String,
    pub file_name: String,
    pub expected_download_sha256: Option<String>,
    pub expected_source_sha256: Option<String>,
}
```

The backend routes mods, resource packs, and shader packs to the correct folder and refresh path. Mods retain their existing behavior while pack ZIPs gain the stricter source-modification guard.

## Testing

Add Rust unit-level coverage for:

- Imported ZIP exact hash is automatically adopted.
- Exact latest ZIP hash produces `upToDate`.
- Exact older compatible ZIP hash produces `updateAvailable`.
- Saved project identity with an unknown installed artifact produces `unknown`.
- Changed current hash for an app-managed ZIP produces `modified`.
- Directory pack produces `localDirectory`.
- Verified pack replacement stores the new artifact identity and refreshes to `upToDate`.
- Download hash mismatch keeps the old ZIP active.
- Source hash mismatch keeps the old ZIP active.

Run:

```powershell
npm run build
cd src-tauri
cargo check
cargo test
```

Manually verify individual and bulk updates for resource-pack ZIPs and shader-pack ZIPs, modified ZIP blocking, directory report-only behavior, progress modal behavior, refreshed row state, and update log output.

## Non-Goals

- Automatically replacing directory-based packs.
- Claiming a version match based only on filenames, URLs, or fuzzy search.
- Live CurseForge checks.
- Preserving edits made inside modified ZIP files during replacement.
