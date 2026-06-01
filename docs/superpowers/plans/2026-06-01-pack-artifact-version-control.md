# Pack Artifact Version Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reliable Modrinth artifact identity, status detection, and verified replacement for ZIP-based resource packs and shader packs while keeping directory packs report-only.

**Architecture:** Store the current ZIP SHA-256 on each `PackItem` and persist adopted Modrinth identity inside pack metadata. Update checks classify packs from deterministic hash evidence before using saved project metadata or fuzzy candidates. A generalized replacement command routes mods and ZIP packs through item-specific refresh logic while pack replacement adds a source-hash modification guard and rollback.

**Tech Stack:** Rust, Tauri 2 commands, rusqlite, reqwest, SHA-256 via `sha2`, React, TypeScript, TanStack Query.

---

## File Map

- Modify: `src-tauri/src/models/pack_item.rs` - add pack hash and persisted Modrinth artifact identity.
- Modify: `src-tauri/src/models/updates.rs` - add statuses and generalized replacement input/output.
- Modify: `src-tauri/src/services/database.rs` - migrate existing databases and persist pack hashes and metadata identity.
- Modify: `src-tauri/src/commands/packs.rs` - hash ZIP packs while scanning.
- Modify: `src-tauri/src/services/updates.rs` - classify ZIP packs from exact artifact evidence and expose pure helpers for tests.
- Modify: `src-tauri/src/commands/updates.rs` - auto-adopt exact hashes and replace ZIP packs with verification, backup, rollback, and logging.
- Modify: `src-tauri/src/lib.rs` - register the generalized replacement command.
- Modify: `src/lib/types.ts` - mirror backend types.
- Modify: `src/lib/api.ts` - expose generalized artifact replacement.
- Modify: `src/hooks/useUpdates.ts` - invalidate mod and pack caches after artifact replacement.
- Modify: `src/pages/Updates.tsx` - support pack selection, replacement, statuses, and pack-aware progress copy.
- Modify: `docs/schema.sql` - document the updated `pack_items` schema.

## Task 1: Persist Pack Artifact Identity

**Files:**
- Modify: `src-tauri/src/models/pack_item.rs`
- Modify: `src-tauri/src/services/database.rs`
- Modify: `docs/schema.sql`

- [ ] **Step 1: Write failing database round-trip tests**

Add `#[cfg(test)]` tests in `src-tauri/src/services/database.rs` using a temporary app-data directory. Assert that an upserted ZIP pack retains `hash_sha256` and metadata identity:

```rust
let item = PackItem {
    id: "pack-1".into(),
    instance_id: instance.id.clone(),
    pack_type: PackType::ResourcePack,
    file_name: "fresh.zip".into(),
    file_path: "C:/packs/fresh.zip".into(),
    is_dir: false,
    enabled: true,
    hash_sha256: Some("abc123".into()),
    metadata: Some(PackItemMetadata {
        display_name: "Fresh".into(),
        author: String::new(),
        website_url: Some("https://modrinth.com/resourcepack/fresh".into()),
        notes: String::new(),
        customized: false,
        installed_modrinth_project_id: Some("fresh-project".into()),
        installed_modrinth_version_id: Some("fresh-version".into()),
        installed_artifact_sha256: Some("abc123".into()),
    }),
};
db.upsert_pack_item(&item)?;
let saved = db.get_pack_item_by_id("pack-1")?.unwrap();
assert_eq!(saved.hash_sha256.as_deref(), Some("abc123"));
assert_eq!(
    saved.metadata.unwrap().installed_modrinth_version_id.as_deref(),
    Some("fresh-version")
);
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `cd src-tauri; cargo test pack_item_round_trip -- --nocapture`

Expected: compilation failure because the new fields do not exist.

- [ ] **Step 3: Extend the Rust models**

Add to `PackItem`:

```rust
#[serde(default)]
pub hash_sha256: Option<String>,
```

Add to `PackItemMetadata`:

```rust
#[serde(default)]
pub installed_modrinth_project_id: Option<String>,
#[serde(default)]
pub installed_modrinth_version_id: Option<String>,
#[serde(default)]
pub installed_artifact_sha256: Option<String>,
```

Extend `UpdatePackItemMetadataInput` with the same optional identity fields so metadata edits and confirmed matches preserve them.

- [ ] **Step 4: Add an additive SQLite migration**

Change `pack_items` in `SCHEMA` to include:

```sql
hash_sha256 TEXT,
```

After `conn.execute_batch(SCHEMA)?`, add an idempotent helper that checks `PRAGMA table_info(pack_items)` and executes:

```sql
ALTER TABLE pack_items ADD COLUMN hash_sha256 TEXT
```

only when the column is absent. This keeps existing user databases readable.

Update every `pack_items` `SELECT`, `INSERT`, `ON CONFLICT`, row index, and parameter list to include `hash_sha256`. Update `docs/schema.sql` to match.

- [ ] **Step 5: Preserve identity during metadata updates**

When `update_pack_item_metadata` constructs `PackItemMetadata`, retain identity from the existing metadata unless explicit optional values were provided:

```rust
installed_modrinth_project_id: input
    .installed_modrinth_project_id
    .clone()
    .or_else(|| existing.metadata.as_ref()?.installed_modrinth_project_id.clone()),
```

Use equivalent logic for version ID and artifact hash without moving `existing.metadata`.

- [ ] **Step 6: Run the focused tests**

Run: `cd src-tauri; cargo test pack_item_round_trip -- --nocapture`

Expected: PASS.

- [ ] **Step 7: Commit**

This workspace currently has no `.git` repository. Record the intended checkpoint in the execution notes instead of running `git commit`:

```text
feat: persist pack artifact identity
```

## Task 2: Hash ZIP Packs During Scans

**Files:**
- Modify: `src-tauri/src/commands/packs.rs`

- [ ] **Step 1: Write failing scan classification tests**

Extract a pure helper and test it in `src-tauri/src/commands/packs.rs`:

```rust
#[test]
fn hashes_zip_files_but_not_directories() {
    assert!(should_hash_pack(false, "fresh.zip"));
    assert!(!should_hash_pack(true, "fresh"));
    assert!(!should_hash_pack(false, "notes.txt"));
}
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `cd src-tauri; cargo test hashes_zip_files_but_not_directories -- --nocapture`

Expected: compilation failure because `should_hash_pack` does not exist.

- [ ] **Step 3: Implement ZIP hashing**

Import `crate::services::hash_service::hash_file`, add:

```rust
fn should_hash_pack(is_dir: bool, file_name: &str) -> bool {
    !is_dir && file_name.to_ascii_lowercase().ends_with(".zip")
}
```

In `scan_pack_items`, compute:

```rust
let is_dir = file_type.is_dir();
let hash_sha256 = should_hash_pack(is_dir, &file_name)
    .then(|| hash_file(&entry.path()).ok())
    .flatten();
```

Store `is_dir` and `hash_sha256` on `PackItem`.

- [ ] **Step 4: Run focused and compile checks**

Run: `cd src-tauri; cargo test hashes_zip_files_but_not_directories -- --nocapture`

Expected: PASS.

Run: `cd src-tauri; cargo check`

Expected: PASS.

- [ ] **Step 5: Record checkpoint**

```text
feat: hash zip packs during scan
```

## Task 3: Classify Pack Updates From Deterministic Evidence

**Files:**
- Modify: `src-tauri/src/models/updates.rs`
- Modify: `src-tauri/src/services/updates.rs`

- [ ] **Step 1: Write failing pure classification tests**

Add tests in `src-tauri/src/services/updates.rs` for:

```rust
assert_eq!(
    classify_pack_artifact(false, Some("abc"), Some("abc"), Some("old"), Some("new")),
    PackArtifactStatus::UpdateAvailable
);
assert_eq!(
    classify_pack_artifact(false, Some("abc"), Some("abc"), Some("new"), Some("new")),
    PackArtifactStatus::UpToDate
);
assert_eq!(
    classify_pack_artifact(false, Some("changed"), Some("installed"), Some("old"), Some("new")),
    PackArtifactStatus::Modified
);
assert_eq!(
    classify_pack_artifact(true, None, None, None, None),
    PackArtifactStatus::LocalDirectory
);
assert_eq!(
    classify_pack_artifact(false, Some("unmatched"), None, None, Some("new")),
    PackArtifactStatus::Unknown
);
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `cd src-tauri; cargo test classify_pack_artifact -- --nocapture`

Expected: compilation failure because `PackArtifactStatus` and `classify_pack_artifact` do not exist.

- [ ] **Step 3: Add statuses and row evidence**

Extend `UpdateStatus`:

```rust
Modified,
LocalDirectory,
```

Extend `UpdateRow`:

```rust
pub installed_version_id: Option<String>,
pub installed_artifact_sha256: Option<String>,
```

Add the pure enum and helper:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PackArtifactStatus {
    UpdateAvailable,
    UpToDate,
    Modified,
    LocalDirectory,
    Unknown,
}
```

The helper returns `Modified` before any remote comparison when a recorded artifact hash differs from the current hash.

- [ ] **Step 4: Make pack checks hash-first**

Refactor `check_pack` so directories return `LocalDirectory` with `Directory packs are local/custom and report-only.`.

For ZIP files:

1. Read `item.hash_sha256`.
2. Stop with `Modified` if it differs from `metadata.installed_artifact_sha256`.
3. Call `version_by_hash` before consulting `website_url`.
4. Treat an exact hash match as the installed version and project identity.
5. Compare the exact installed version ID with the latest compatible version ID.
6. If hash lookup fails but saved project identity exists, fetch latest details but keep status `Unknown` and message `Installed artifact could not be verified.`
7. Keep search fallback as unconfirmed candidate-only output.

Do not use `row_for_project` in a way that turns a saved pack project URL into `UpdateAvailable`. Split pack row construction from mod row construction if necessary.

- [ ] **Step 5: Return adoption evidence**

Ensure exact hash rows include:

```rust
project_id: Some(exact.project_id.clone()),
installed_artifact_sha256: item.hash_sha256.clone(),
confirmed: true,
match_confidence: UpdateMatchConfidence::Exact,
```

Initialize `installed_artifact_sha256: None` in mod, unknown, and error rows.

- [ ] **Step 6: Run update-service tests**

Run: `cd src-tauri; cargo test services::updates::tests -- --nocapture`

Expected: all existing and new update service tests PASS.

- [ ] **Step 7: Record checkpoint**

```text
feat: classify pack updates by exact artifact identity
```

## Task 4: Auto-Adopt Exact Pack Hash Matches

**Files:**
- Modify: `src-tauri/src/services/database.rs`
- Modify: `src-tauri/src/commands/updates.rs`

- [ ] **Step 1: Write a failing metadata adoption test**

Add a database helper test:

```rust
db.save_pack_artifact_identity(
    "pack-1",
    "project-1",
    "version-1",
    "abc123",
)?;
let saved = db.get_pack_item_by_id("pack-1")?.unwrap();
let metadata = saved.metadata.unwrap();
assert_eq!(metadata.installed_modrinth_project_id.as_deref(), Some("project-1"));
assert_eq!(metadata.installed_modrinth_version_id.as_deref(), Some("version-1"));
assert_eq!(metadata.installed_artifact_sha256.as_deref(), Some("abc123"));
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `cd src-tauri; cargo test saves_pack_artifact_identity -- --nocapture`

Expected: compilation failure because `save_pack_artifact_identity` does not exist.

- [ ] **Step 3: Implement the database helper**

Add:

```rust
pub fn save_pack_artifact_identity(
    &self,
    item_id: &str,
    project_id: &str,
    version_id: &str,
    sha256: &str,
) -> Result<PackItem>
```

Load the pack, preserve its user-editable metadata fields, set identity fields, serialize, update `metadata_json`, then return the refreshed row.

- [ ] **Step 4: Persist exact hash adoption after checks**

In `check_update_target`, after `UpdateService` returns the pack row, persist identity only when all are true:

```rust
row.item_type != UpdateItemType::Mod
    && row.match_confidence == UpdateMatchConfidence::Exact
    && row.confirmed
    && row.project_id.is_some()
    && row.installed_version_id.is_some()
    && row.installed_artifact_sha256.is_some()
```

Store `row.installed_version_id`, never `row.latest_version_id`. The installed field is the exact local artifact version; the latest field is the compatible remote target.

- [ ] **Step 5: Preserve identity during manual fuzzy confirmation**

When `confirm_update_match` updates pack metadata, persist the project ID and URL but leave installed version ID and installed artifact SHA-256 unchanged unless an exact hash proved them.

- [ ] **Step 6: Run focused and service tests**

Run: `cd src-tauri; cargo test saves_pack_artifact_identity -- --nocapture`

Expected: PASS.

Run: `cd src-tauri; cargo test services::updates::tests -- --nocapture`

Expected: PASS.

- [ ] **Step 7: Record checkpoint**

```text
feat: auto-adopt exact Modrinth pack hashes
```

## Task 5: Replace ZIP Packs With Guarded Rollback

**Files:**
- Modify: `src-tauri/src/models/updates.rs`
- Modify: `src-tauri/src/commands/updates.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write failing replacement guard tests**

Extract pure validation helpers and test:

```rust
assert!(validate_source_artifact(Some("abc"), "abc").is_ok());
assert!(validate_source_artifact(Some("abc"), "changed").is_err());
assert!(validate_source_artifact(None, "abc").is_err());
```

Also test `sanitize_file_name("folder/new-pack.zip") == "new-pack.zip"`.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `cd src-tauri; cargo test validate_source_artifact -- --nocapture`

Expected: compilation failure because the guard helper does not exist.

- [ ] **Step 3: Generalize the replacement input**

Replace `UpdateModFromModrinthInput` with:

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

Add:

```rust
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatedArtifact {
    pub instance_id: String,
    pub item_id: String,
    pub item_type: UpdateItemType,
    pub file_name: String,
}
```

- [ ] **Step 4: Keep mod replacement behavior behind a helper**

Move current mod replacement logic into:

```rust
fn replace_mod_from_modrinth(
    state: &AppState,
    input: &UpdateArtifactFromModrinthInput,
    bytes: &[u8],
) -> Result<UpdatedArtifact, String>
```

Map the generalized input names and preserve current mod parsing, metadata refresh, backup, and logging.

- [ ] **Step 5: Implement guarded ZIP pack replacement**

Add:

```rust
fn replace_pack_from_modrinth(
    state: &AppState,
    input: &UpdateArtifactFromModrinthInput,
    bytes: &[u8],
) -> Result<UpdatedArtifact, String>
```

Required sequence:

1. Load the pack by ID and reject directories.
2. Hash the active ZIP with `hash_file`.
3. Call `validate_source_artifact(input.expected_source_sha256.as_deref(), &actual_source_hash)`.
4. Write the downloaded bytes to `<safe_file_name>.download`.
5. Verify download hash before moving the old ZIP.
6. Create `backups/pack-updates/<timestamp>/`.
7. Rename the old ZIP to backup.
8. Rename the temporary ZIP into the original pack folder.
9. If the second rename fails, rename the backup back to the original path before returning the error.
10. Delete the old database row, create the refreshed `PackItem` with a fresh UUID, new path, new SHA-256, and persisted project/version/artifact identity.
11. Upsert the refreshed item and log `Updated resource pack: ...` or `Updated shader pack: ...`.

- [ ] **Step 6: Add and register the command**

Expose:

```rust
#[command]
pub async fn update_artifact_from_modrinth(
    input: UpdateArtifactFromModrinthInput,
) -> Result<UpdatedArtifact, String>
```

Download once, validate `expected_download_sha256`, then route by `input.item_type`. Register it in `src-tauri/src/lib.rs`.

- [ ] **Step 7: Run focused and compile checks**

Run: `cd src-tauri; cargo test validate_source_artifact -- --nocapture`

Expected: PASS.

Run: `cd src-tauri; cargo check`

Expected: PASS.

- [ ] **Step 8: Record checkpoint**

```text
feat: replace verified zip packs with rollback
```

## Task 6: Expose Artifact Updates In TypeScript

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/api.ts`
- Modify: `src/hooks/useUpdates.ts`

- [ ] **Step 1: Update frontend types**

Add pack fields:

```ts
hashSha256: string | null;
installedModrinthProjectId?: string | null;
installedModrinthVersionId?: string | null;
installedArtifactSha256?: string | null;
```

Extend:

```ts
export type UpdateStatus =
  | "updateAvailable"
  | "upToDate"
  | "unknown"
  | "modified"
  | "localDirectory"
  | "error";
```

Add `installedArtifactSha256: string | null` and `installedVersionId: string | null` to `UpdateRow`.

Replace `UpdateModFromModrinthInput` with the camelCase mirror of `UpdateArtifactFromModrinthInput`, and add `UpdatedArtifact`.

- [ ] **Step 2: Generalize the API**

Replace:

```ts
updateMod: (input) => invoke<ModFile>("update_mod_from_modrinth", { input })
```

with:

```ts
updateArtifact: (input: UpdateArtifactFromModrinthInput) =>
  invoke<UpdatedArtifact>("update_artifact_from_modrinth", { input }),
```

- [ ] **Step 3: Generalize the mutation hook**

Rename `useUpdateModFromModrinth` to `useUpdateArtifactFromModrinth`. Invalidate:

```ts
qc.invalidateQueries({ queryKey: ["mods", artifact.instanceId] });
qc.invalidateQueries({ queryKey: ["packs"] });
qc.invalidateQueries({ queryKey: ["instances"] });
qc.invalidateQueries({ queryKey: ["updates", artifact.instanceId] });
```

- [ ] **Step 4: Run the TypeScript build and verify expected failure location**

Run: `npm run build`

Expected: TypeScript failures remain only in `src/pages/Updates.tsx` because it still calls the old mod-only hook and input.

- [ ] **Step 5: Record checkpoint**

```text
refactor: expose generalized artifact update API
```

## Task 7: Enable Pack Updates In The Updates Page

**Files:**
- Modify: `src/pages/Updates.tsx`

- [ ] **Step 1: Widen selectable rows**

Replace the mod-only condition with:

```ts
const canReplaceArtifact = (row: UpdateRow) =>
  row.status === "updateAvailable" &&
  !!row.latestFile &&
  !!row.latestVersionId &&
  (row.itemType === "mod" || !!row.installedArtifactSha256);
```

Use this helper for row checkboxes and details-dialog update availability.

- [ ] **Step 2: Send generalized replacement inputs**

Use `useUpdateArtifactFromModrinth` and call:

```ts
await updateArtifact.mutateAsync({
  itemId: row.itemId,
  itemType: row.itemType,
  projectId: row.projectId!,
  versionId: row.latestVersionId!,
  downloadUrl: row.latestFile.url,
  fileName: row.latestFile.fileName,
  expectedDownloadSha256: row.latestFile.sha256,
  expectedSourceSha256:
    row.itemType === "mod" ? null : row.installedArtifactSha256,
});
```

- [ ] **Step 3: Update progress and logging copy**

Use neutral copy:

```ts
label: updateable.length === 1 ? "Updating content" : "Updating selected content"
```

and:

```tsx
description="Downloading verified files and moving previous versions to backup. Keep the app open."
```

Log `Updated content: ...` and `Content update failed: ...`.

- [ ] **Step 4: Add statuses to filters and labels**

Add filter options:

```tsx
<option value="modified">Modified</option>
<option value="localDirectory">Local directory</option>
```

Extend `formatStatus` and keep both statuses on the secondary badge variant.

- [ ] **Step 5: Surface explanatory state**

Ensure the backend `row.message` remains visible in rows and details. Add `Detail` output for the installed artifact SHA-256 when present so exact provenance can be inspected.

- [ ] **Step 6: Run the frontend build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 7: Record checkpoint**

```text
feat: enable resource and shader pack updates in UI
```

## Task 8: Full Verification

**Files:**
- Verify all modified files.

- [ ] **Step 1: Run Rust formatting**

Run: `cd src-tauri; cargo fmt --check`

Expected: PASS. If it fails, run `cargo fmt`, then repeat `cargo fmt --check`.

- [ ] **Step 2: Run Rust tests**

Run: `cd src-tauri; cargo test`

Expected: PASS.

- [ ] **Step 3: Run Rust compile check**

Run: `cd src-tauri; cargo check`

Expected: PASS with no new warnings introduced by this work.

- [ ] **Step 4: Run frontend production build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 5: Run manual Tauri verification**

Run: `npm run tauri dev`

Verify:

1. Imported resource-pack ZIP exact hash is adopted and displays `Up to date` or `Update available`.
2. Imported shader-pack ZIP exact hash is adopted.
3. Directory packs display `Local directory` and cannot be selected.
4. A manually changed app-managed ZIP displays `Modified` and cannot be replaced.
5. A single pack update shows the blocking modal, backs up the old ZIP, refreshes the row, and logs the pack name.
6. Bulk selection accepts eligible mods and ZIP packs together.
7. A forced download-hash mismatch leaves the active ZIP untouched.
8. A forced source-hash mismatch leaves the active ZIP untouched.

- [ ] **Step 6: Record final checkpoint**

```text
feat: add reliable pack artifact version control
```
