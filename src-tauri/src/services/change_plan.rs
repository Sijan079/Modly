use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime};

use anyhow::{bail, Context, Result};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::models::change_plan::{
    ChangeApplyResult, ChangeBackup, ChangeKind, ChangePlan, ChangeRequest,
};
use crate::models::mod_metadata::{ModFile, ModMetadata, ModSuggestion};
use crate::models::pack_truth::PackTruth;
use crate::services::database::Database;
use crate::services::hash_service::hash_file;
use crate::services::mod_parser::parse_mod_jar_observed;
use crate::services::pack_truth::{scan_pack_truth, verify_archive};
use crate::state::AppState;

#[derive(Clone)]
struct StoredPlan {
    plan: ChangePlan,
    old_mod: Option<ModFile>,
    suggestion: Option<ModSuggestion>,
    stage_path: Option<PathBuf>,
    fingerprint: String,
    old_hash: Option<String>,
}

static PLANS: OnceLock<Mutex<HashMap<String, StoredPlan>>> = OnceLock::new();
static ACTIVE_INSTANCES: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
#[cfg(test)]
static TEST_FAULTS: OnceLock<Mutex<HashMap<String, TestFault>>> = OnceLock::new();
#[cfg(test)]
#[derive(Clone, Copy, PartialEq, Eq)]
enum TestFault {
    AfterBackup,
    AfterBackupCollision,
    AfterInstall,
    AfterInstallCollision,
}
fn plans() -> &'static Mutex<HashMap<String, StoredPlan>> {
    PLANS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cleanup_stage_dir(dir: &Path, prefix: &str, suffix: &str, age: Duration) -> Vec<String> {
    let mut warnings = Vec::new();
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return warnings,
        Err(error) => {
            return vec![format!(
                "Could not inspect stages in {}: {error}",
                dir.display()
            )]
        }
    };
    for entry in entries {
        let Ok(entry) = entry else { continue };
        let name = entry.file_name();
        let Some(id) = name
            .to_str()
            .and_then(|name| name.strip_prefix(prefix)?.strip_suffix(suffix))
        else {
            continue;
        };
        if Uuid::parse_str(id).is_err() {
            continue;
        }
        let path = entry.path();
        let stale = entry.metadata().ok().is_some_and(|metadata| {
            metadata.is_file()
                && metadata
                    .modified()
                    .ok()
                    .and_then(|modified| SystemTime::now().duration_since(modified).ok())
                    .is_some_and(|elapsed| elapsed >= age)
        });
        if stale {
            if let Err(error) = fs::remove_file(&path) {
                warnings.push(format!(
                    "Could not remove abandoned stage {}: {error}",
                    path.display()
                ));
            }
        }
    }
    warnings
}

pub fn cleanup_abandoned_stages(db: &Database) -> Result<Vec<String>> {
    let mut warnings = cleanup_stage_dir(
        &std::env::temp_dir(),
        "modly-change-",
        ".jar",
        Duration::from_secs(7 * 24 * 60 * 60),
    );
    for instance in db.list_instances()? {
        warnings.extend(cleanup_stage_dir(
            &Path::new(&instance.game_dir).join("mods"),
            ".modly-",
            ".part",
            Duration::from_secs(24 * 60 * 60),
        ));
    }
    Ok(warnings)
}

struct InstanceMutationGuard(String);

impl InstanceMutationGuard {
    fn acquire(instance_id: &str) -> Result<Self> {
        let mut active = ACTIVE_INSTANCES
            .get_or_init(|| Mutex::new(HashSet::new()))
            .lock()
            .map_err(|_| anyhow::anyhow!("Mutation lock unavailable"))?;
        if !active.insert(instance_id.to_string()) {
            bail!("Another mod change is already running for this instance");
        }
        Ok(Self(instance_id.to_string()))
    }
}

impl Drop for InstanceMutationGuard {
    fn drop(&mut self) {
        if let Ok(mut active) = ACTIVE_INSTANCES
            .get_or_init(|| Mutex::new(HashSet::new()))
            .lock()
        {
            active.remove(&self.0);
        }
    }
}

fn test_failure(plan: &ChangePlan, after_install: bool) -> Result<()> {
    #[cfg(test)]
    {
        let fault = TEST_FAULTS
            .get_or_init(|| Mutex::new(HashMap::new()))
            .lock()
            .map_err(|_| anyhow::anyhow!("Test fault store unavailable"))?
            .get(&plan.id)
            .copied();
        match (fault, after_install) {
            (Some(TestFault::AfterBackup), false) => bail!("Injected failure after backup"),
            (Some(TestFault::AfterBackupCollision), false) => {
                fs::write(
                    plan.old_file_path.as_deref().context("No old path")?,
                    b"external file",
                )?;
                bail!("Injected failure after backup with external collision");
            }
            (Some(TestFault::AfterInstall), true) => bail!("Injected failure after install"),
            (Some(TestFault::AfterInstallCollision), true) => {
                fs::write(
                    plan.new_file_path.as_deref().context("No new path")?,
                    b"external file",
                )?;
                bail!("Injected failure after install with external collision");
            }
            _ => {}
        }
    }
    #[cfg(not(test))]
    let _ = (plan, after_install);
    Ok(())
}

fn pack_truth(state: &AppState, instance_id: &str, game_dir: &str) -> Result<PackTruth> {
    let saved = state.db.list_mods(instance_id)?;
    scan_pack_truth(instance_id, &Path::new(game_dir).join("mods"), &saved)
}

fn fingerprint(truth: &PackTruth) -> Result<String> {
    Ok(format!("{:x}", Sha256::digest(serde_json::to_vec(truth)?)))
}

fn source_file_name(request: &ChangeRequest) -> Result<String> {
    let value = request
        .file_name
        .as_deref()
        .or_else(|| {
            request
                .source_path
                .as_deref()
                .and_then(|path| Path::new(path).file_name())
                .and_then(|name| name.to_str())
        })
        .context("A target JAR filename is required")?;
    if !value.to_ascii_lowercase().ends_with(".jar")
        || value == ".jar"
        || value
            .chars()
            .any(|character| "<>:\"/\\|?*".contains(character))
        || value.ends_with([' ', '.'])
        || Path::new(value).file_name().and_then(|name| name.to_str()) != Some(value)
    {
        bail!("Target filename must be a plain .jar filename");
    }
    Ok(value.to_string())
}

fn stage_source(request: &ChangeRequest, downloaded: Option<&[u8]>, id: &str) -> Result<PathBuf> {
    if request.source_path.is_some() == downloaded.is_some() {
        bail!("Specify exactly one local file or download URL");
    }
    let stage = std::env::temp_dir().join(format!("modly-change-{id}.jar"));
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&stage)?;
    let result = if let Some(source) = request.source_path.as_deref() {
        let mut input =
            File::open(source).with_context(|| format!("Cannot open source JAR: {source}"))?;
        std::io::copy(&mut input, &mut output).map(|_| ())
    } else {
        output.write_all(downloaded.expect("downloaded source required"))
    };
    if let Err(error) = result {
        let _ = fs::remove_file(&stage);
        return Err(error.into());
    }
    if let Err(error) = output.sync_all() {
        let _ = fs::remove_file(&stage);
        return Err(error.into());
    }
    Ok(stage)
}

fn candidate_metadata(path: &Path, request: &ChangeRequest) -> Result<ModMetadata> {
    verify_archive(path).context("Candidate JAR is corrupt or unreadable")?;
    let (mut metadata, _) =
        parse_mod_jar_observed(path)?.context("Candidate JAR has no supported mod manifest")?;
    if metadata.mod_id.as_deref().is_none_or(str::is_empty) {
        bail!("Candidate manifest has no mod ID");
    }
    if let Some(version_id) = &request.version_id {
        metadata.installed_modrinth_version_id = Some(version_id.clone());
    }
    Ok(metadata)
}

pub fn preview_change(
    state: &AppState,
    request: ChangeRequest,
    downloaded: Option<Vec<u8>>,
) -> Result<ChangePlan> {
    let instance = state
        .db
        .get_instance(&request.instance_id)?
        .context("Instance not found")?;
    let mods_dir = Path::new(&instance.game_dir).join("mods");
    let truth = pack_truth(state, &instance.id, &instance.game_dir)?;
    let old_mod = match request.kind {
        ChangeKind::Add => {
            if request.target_mod_id.is_some() {
                bail!("Add cannot have a target mod");
            }
            None
        }
        _ => {
            let id = request
                .target_mod_id
                .as_deref()
                .context("Target mod is required")?;
            let old = state
                .db
                .get_mod_by_id(id)?
                .context("Target mod not found")?;
            if old.instance_id != instance.id {
                bail!("Target mod belongs to another instance");
            }
            let old_path = Path::new(&old.file_path);
            if !old_path.exists() {
                bail!("Target JAR is missing; rescan before planning");
            }
            let root = mods_dir.canonicalize()?;
            if !old_path.canonicalize()?.starts_with(root) {
                bail!("Target JAR is outside this instance's mods folder");
            }
            Some(old)
        }
    };
    let suggestion = if let Some(id) = request.suggestion_id.as_deref() {
        if request.kind != ChangeKind::Add {
            bail!("Suggestions can only be added");
        }
        let suggestion = state
            .db
            .get_mod_suggestion_by_id(id)?
            .context("Suggestion not found")?;
        if suggestion.instance_id != instance.id {
            bail!("Suggestion belongs to another instance");
        }
        Some(suggestion)
    } else {
        None
    };
    let old_hash = old_mod
        .as_ref()
        .map(|old| hash_file(Path::new(&old.file_path)))
        .transpose()?;
    let id = Uuid::new_v4().to_string();
    let (stage_path, candidate, source_sha256, new_file_path) =
        if request.kind == ChangeKind::Remove {
            if request.source_path.is_some() || request.download_url.is_some() {
                bail!("Remove cannot have a source JAR");
            }
            (None, None, None, None)
        } else {
            let file_name = source_file_name(&request)?;
            let dest = mods_dir.join(file_name);
            if dest.exists()
                && old_mod
                    .as_ref()
                    .is_none_or(|old| Path::new(&old.file_path) != dest)
            {
                bail!("Target filename already exists: {}", dest.display());
            }
            let stage = stage_source(&request, downloaded.as_deref(), &id)?;
            let parsed = candidate_metadata(&stage, &request);
            if parsed.is_err() {
                let _ = fs::remove_file(&stage);
            }
            let mut parsed = parsed?;
            if parsed.modrinth_url.is_none() {
                parsed.modrinth_url = old_mod
                    .as_ref()
                    .and_then(|old| old.metadata.as_ref())
                    .and_then(|meta| meta.modrinth_url.clone())
                    .or_else(|| suggestion.as_ref().and_then(|item| item.source_url.clone()));
            }
            let hash = match hash_file(&stage) {
                Ok(hash) => hash,
                Err(error) => {
                    let _ = fs::remove_file(&stage);
                    return Err(error);
                }
            };
            if let Some(expected) = request.expected_sha256.as_deref() {
                if !hash.eq_ignore_ascii_case(expected) {
                    let _ = fs::remove_file(&stage);
                    bail!("Candidate JAR does not match expected SHA-256 hash");
                }
            }
            (
                Some(stage),
                Some(parsed),
                Some(hash),
                Some(dest.to_string_lossy().to_string()),
            )
        };
    let old_file_path = old_mod
        .as_ref()
        .map(|old| -> Result<String> {
            let canonical = Path::new(&old.file_path).canonicalize()?;
            truth
                .mods
                .iter()
                .find(|item| {
                    Path::new(&item.file_path).canonicalize().ok().as_ref() == Some(&canonical)
                })
                .map(|item| item.file_path.clone())
                .context("Target JAR was not observed in this pack")
        })
        .transpose()?;
    let dependent_paths = old_file_path
        .as_deref()
        .map(|path| truth.relationships_for(path).required_dependent_paths)
        .unwrap_or_default();
    let active: HashSet<&str> = truth
        .mods
        .iter()
        .filter(|item| item.enabled)
        .map(|item| item.file_path.as_str())
        .collect();
    let dependent_paths: Vec<Vec<String>> = dependent_paths
        .into_iter()
        .filter(|path| path.iter().all(|part| active.contains(part.as_str())))
        .collect();
    let direct_dependents = dependent_paths
        .iter()
        .filter(|path| path.len() == 2)
        .filter_map(|path| path.last().cloned())
        .collect();
    let transitive_dependents = dependent_paths
        .into_iter()
        .filter(|path| path.len() > 2)
        .collect();
    let backup_path = old_file_path.as_ref().map(|old| {
        Path::new(&instance.game_dir)
            .join(".modly-backups")
            .join(&id)
            .join(
                Path::new(old)
                    .file_name()
                    .expect("observed JAR has a filename"),
            )
            .to_string_lossy()
            .to_string()
    });
    let plan = ChangePlan {
        id: id.clone(),
        kind: request.kind,
        instance_id: instance.id,
        old_file_path,
        new_file_path,
        source_sha256,
        candidate,
        truth,
        direct_dependents,
        transitive_dependents,
        backup_path,
    };
    let stored = StoredPlan {
        fingerprint: fingerprint(&plan.truth)?,
        plan: plan.clone(),
        old_mod,
        suggestion,
        stage_path,
        old_hash,
    };
    plans()
        .lock()
        .map_err(|_| anyhow::anyhow!("Plan store unavailable"))?
        .insert(id, stored);
    Ok(plan)
}

pub fn discard_plan(id: &str) -> Result<()> {
    let plan = plans()
        .lock()
        .map_err(|_| anyhow::anyhow!("Plan store unavailable"))?
        .remove(id);
    if let Some(path) = plan.and_then(|plan| plan.stage_path) {
        if path.exists() {
            fs::remove_file(path)?;
        }
    }
    Ok(())
}
fn backup_root(game_dir: &str) -> PathBuf {
    Path::new(game_dir).join(".modly-backups")
}

fn write_manifest(dir: &Path, backup: &ChangeBackup) -> Result<()> {
    fs::create_dir_all(dir)?;
    let staged = dir.join("manifest.json.tmp");
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&staged)?;
    let result = file
        .write_all(&serde_json::to_vec_pretty(backup)?)
        .and_then(|_| file.sync_all());
    if let Err(error) = result {
        let _ = fs::remove_file(&staged);
        return Err(error.into());
    }
    fs::rename(staged, dir.join("manifest.json"))?;
    Ok(())
}

fn mark_backup(dir: &Path, marker: &str) -> Result<()> {
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(dir.join(marker))?;
    file.sync_all()?;
    Ok(())
}

fn backup_status(dir: &Path) -> &'static str {
    if dir.join("restored").exists() {
        "restored"
    } else if dir.join("applied").exists() {
        "applied"
    } else if dir.join("rolled-back").exists() {
        "rolledBack"
    } else if dir.join("rollback-failed").exists() {
        "rollbackFailed"
    } else if dir.join("failed-before-mutation").exists() {
        "failedBeforeMutation"
    } else {
        "pending"
    }
}

fn read_backup(dir: &Path) -> Result<ChangeBackup> {
    let mut backup: ChangeBackup = serde_json::from_slice(&fs::read(dir.join("manifest.json"))?)?;
    backup.status = backup_status(dir).to_string();
    Ok(backup)
}

fn copy_to_pack_stage(source: &Path, target: &Path, expected_hash: &str) -> Result<()> {
    let input = File::open(source)?;
    copy_reader_to_pack_stage(input, target, expected_hash)
}

fn copy_reader_to_pack_stage(
    mut input: impl Read,
    target: &Path,
    expected_hash: &str,
) -> Result<()> {
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(target)?;
    let result = (|| -> Result<()> {
        std::io::copy(&mut input, &mut output)?;
        output.sync_all()?;
        if !hash_file(target)?.eq_ignore_ascii_case(expected_hash) {
            bail!("Staged JAR hash changed during copy");
        }
        verify_archive(target).context("Staged JAR failed integrity verification")?;
        Ok(())
    })();
    if let Err(error) = result {
        let _ = fs::remove_file(target);
        return Err(error);
    }
    Ok(())
}

fn snapshot_files(truth: &PackTruth) -> BTreeMap<String, Option<String>> {
    truth
        .mods
        .iter()
        .map(|item| (item.file_path.clone(), item.hash_sha256.clone()))
        .collect()
}

fn verify_expected_files(
    before: &PackTruth,
    after: &PackTruth,
    old_path: Option<&str>,
    new_path: Option<&str>,
    new_hash: Option<&str>,
) -> Result<()> {
    let mut expected = snapshot_files(before);
    if let Some(old) = old_path {
        expected.remove(old);
    }
    if let Some(new) = new_path {
        expected.insert(new.to_string(), new_hash.map(str::to_string));
    }
    let actual = snapshot_files(after);
    if expected != actual {
        bail!("Post-change pack rescan differs from the reviewed file plan: expected {expected:?}, actual {actual:?}");
    }
    Ok(())
}

fn rollback_files(
    plan: &ChangePlan,
    backup_path: Option<&Path>,
    pack_stage: Option<&Path>,
    old_moved: bool,
    new_moved: bool,
) -> Vec<String> {
    let mut errors = Vec::new();
    if let Some(stage) = pack_stage {
        if stage.exists() {
            if let Err(error) = fs::remove_file(stage) {
                errors.push(format!("stage {}: {error}", stage.display()));
            }
        }
    }
    let mut new_removed = true;
    if new_moved {
        if let Some(new) = plan.new_file_path.as_deref().map(Path::new) {
            let changed = match plan.source_sha256.as_deref() {
                Some(expected) => hash_file(new)
                    .map(|actual| !actual.eq_ignore_ascii_case(expected))
                    .unwrap_or(true),
                None => true,
            };
            if changed {
                new_removed = false;
                errors.push(format!(
                    "installed file {} changed before rollback; left it in place",
                    new.display()
                ));
            } else if let Err(error) = fs::remove_file(new) {
                new_removed = false;
                errors.push(format!("new file {}: {error}", new.display()));
            }
        }
    }
    if old_moved && new_removed {
        if let (Some(old), Some(backup)) = (plan.old_file_path.as_deref(), backup_path) {
            if backup.exists() {
                if Path::new(old).exists() {
                    errors.push(format!(
                        "old filename is occupied; original remains at {}",
                        backup.display()
                    ));
                } else if let Err(error) = fs::rename(backup, old) {
                    errors.push(format!("old file {}: {error}", old));
                }
            }
        }
    } else if old_moved {
        errors.push(
            "original remains in backup because the installed file could not be removed"
                .to_string(),
        );
    }
    errors
}

pub fn apply_change(state: &AppState, id: &str) -> Result<ChangeApplyResult> {
    let instance_id = plans()
        .lock()
        .map_err(|_| anyhow::anyhow!("Plan store unavailable"))?
        .get(id)
        .map(|stored| stored.plan.instance_id.clone())
        .context("Change plan expired or was already applied")?;
    let _guard = InstanceMutationGuard::acquire(&instance_id)?;
    let stored = plans()
        .lock()
        .map_err(|_| anyhow::anyhow!("Plan store unavailable"))?
        .remove(id)
        .context("Change plan expired or was already applied")?;
    let stage = stored.stage_path.clone();
    let result = apply_stored_change(state, stored);
    if let Some(stage) = stage {
        if let Err(error) = fs::remove_file(&stage) {
            let _ = state.db.append_log(
                "warn",
                &format!(
                    "Change {id}: could not remove temporary stage {}: {error}",
                    stage.display()
                ),
                Some(&instance_id),
            );
        }
    }
    result
}

fn apply_stored_change(state: &AppState, stored: StoredPlan) -> Result<ChangeApplyResult> {
    let plan = &stored.plan;
    let instance = state
        .db
        .get_instance(&plan.instance_id)?
        .context("Instance not found")?;
    let before = pack_truth(state, &plan.instance_id, &instance.game_dir)?;
    if fingerprint(&before)? != stored.fingerprint {
        bail!("Pack changed since preview; review a new plan");
    }
    if let Some(old) = &stored.old_mod {
        if serde_json::to_value(state.db.get_mod_by_id(&old.id)?)? != serde_json::to_value(old)? {
            bail!("Target mod metadata changed since preview; review a new plan");
        }
        if hash_file(Path::new(&old.file_path))?
            != stored
                .old_hash
                .as_deref()
                .context("Target JAR had no readable hash during preview")?
        {
            bail!("Target JAR changed since preview");
        }
    }
    if let Some(suggestion) = &stored.suggestion {
        if serde_json::to_value(state.db.get_mod_suggestion_by_id(&suggestion.id)?)?
            != serde_json::to_value(suggestion)?
        {
            bail!("Suggestion changed since preview; review a new plan");
        }
    }
    if let (Some(stage), Some(expected)) = (&stored.stage_path, &plan.source_sha256) {
        if hash_file(stage)? != *expected {
            bail!("Candidate JAR changed since preview");
        }
    }
    if let Some(new) = &plan.new_file_path {
        if Path::new(new).exists() && plan.old_file_path.as_deref() != Some(new.as_str()) {
            bail!("Target filename appeared since preview: {new}");
        }
    }
    let new_mod = plan.new_file_path.as_ref().map(|new| ModFile {
        id: stored
            .old_mod
            .as_ref()
            .map(|old| old.id.clone())
            .unwrap_or_else(|| Uuid::new_v4().to_string()),
        instance_id: plan.instance_id.clone(),
        file_name: Path::new(new)
            .file_name()
            .unwrap()
            .to_string_lossy()
            .to_string(),
        file_path: new.clone(),
        installed_at: chrono::Utc::now().to_rfc3339(),
        enabled: true,
        hash_sha256: plan.source_sha256.clone(),
        source_url: stored
            .suggestion
            .as_ref()
            .and_then(|item| item.source_url.clone())
            .or_else(|| {
                stored
                    .old_mod
                    .as_ref()
                    .and_then(|old| old.source_url.clone())
            }),
        metadata: plan.candidate.clone(),
        categories: stored
            .suggestion
            .as_ref()
            .map(|item| item.categories.clone())
            .or_else(|| stored.old_mod.as_ref().map(|old| old.categories.clone()))
            .unwrap_or_default(),
        related_mods: stored
            .old_mod
            .as_ref()
            .map(|old| old.related_mods.clone())
            .unwrap_or_default(),
    });
    let backup_dir = backup_root(&instance.game_dir).join(&plan.id);
    let backup_path = plan.backup_path.as_deref().map(Path::new);
    let backup = ChangeBackup {
        id: plan.id.clone(),
        instance_id: plan.instance_id.clone(),
        kind: plan.kind,
        created_at: chrono::Utc::now().to_rfc3339(),
        status: "pending".to_string(),
        old_file_path: plan.old_file_path.clone(),
        new_file_path: plan.new_file_path.clone(),
        old_mod: stored.old_mod.clone(),
        new_mod: new_mod.clone(),
        suggestion: stored.suggestion.clone(),
        manual_edges: if let Some(old) = &stored.old_mod {
            state.db.capture_mod_edges(&old.id)?
        } else {
            vec![]
        },
        old_sha256: stored.old_hash.clone(),
        new_sha256: plan.source_sha256.clone(),
    };
    write_manifest(&backup_dir, &backup)?;
    let _ = state.db.append_log(
        "info",
        &format!("Change {}: applying reviewed {:?} plan", plan.id, plan.kind),
        Some(&plan.instance_id),
    );
    let pack_stage = plan.new_file_path.as_ref().map(|_| {
        Path::new(&instance.game_dir)
            .join("mods")
            .join(format!(".modly-{}.part", plan.id))
    });
    let mut old_moved = false;
    let mut new_moved = false;
    let mut stage_copied = false;
    let operation = (|| -> Result<()> {
        if let (Some(source), Some(part), Some(hash)) =
            (&stored.stage_path, &pack_stage, &plan.source_sha256)
        {
            fs::create_dir_all(part.parent().unwrap())?;
            copy_to_pack_stage(source, part, hash)?;
            stage_copied = true;
        }
        if fingerprint(&pack_truth(state, &plan.instance_id, &instance.game_dir)?)?
            != stored.fingerprint
        {
            bail!("Pack changed during staging; review a new plan");
        }
        if let (Some(old), Some(backup_file)) = (&plan.old_file_path, backup_path) {
            fs::rename(old, backup_file).context("Could not move old JAR into backup")?;
            old_moved = true;
        }
        test_failure(plan, false)?;
        if let (Some(part), Some(new)) = (&pack_stage, &plan.new_file_path) {
            if Path::new(new).exists() {
                bail!("Target filename appeared during apply: {new}");
            }
            fs::hard_link(part, new)
                .context("Could not install staged JAR without replacing an existing file")?;
            new_moved = true;
            fs::remove_file(part).context("Could not remove staged link after install")?;
        }
        test_failure(plan, true)?;
        let after = pack_truth(state, &plan.instance_id, &instance.game_dir)?;
        verify_expected_files(
            &before,
            &after,
            plan.old_file_path.as_deref(),
            plan.new_file_path.as_deref(),
            plan.source_sha256.as_deref(),
        )?;
        state.db.apply_change_record(
            stored.old_mod.as_ref(),
            new_mod.as_ref(),
            stored.suggestion.as_ref(),
        )?;
        Ok(())
    })();
    if let Err(error) = operation {
        let rollback_errors = rollback_files(
            plan,
            backup_path,
            pack_stage.as_deref().filter(|_| stage_copied),
            old_moved,
            new_moved,
        );
        let changed_live_files = old_moved || new_moved;
        let mut rollback_errors = rollback_errors;
        if rollback_errors.is_empty() && changed_live_files {
            match pack_truth(state, &plan.instance_id, &instance.game_dir)
                .and_then(|after| verify_expected_files(&before, &after, None, None, None))
            {
                Ok(()) => {}
                Err(verification_error) => {
                    rollback_errors.push(format!("rollback verification: {verification_error}"))
                }
            }
        }
        if rollback_errors.is_empty() {
            let status = if changed_live_files {
                "rolled-back"
            } else {
                "failed-before-mutation"
            };
            mark_backup(&backup_dir, status).with_context(|| {
                format!(
                    "Change failed and {status} marker could not be saved; backup ID {}",
                    plan.id
                )
            })?;
            let _ = state.db.append_log(
                "warn",
                &format!("Change {}: {status}: {error}", plan.id),
                Some(&plan.instance_id),
            );
            bail!("Change failed; {status}: {error}. Backup ID: {}", plan.id);
        }
        let _ = mark_backup(&backup_dir, "rollback-failed");
        let _ = state.db.append_log(
            "error",
            &format!(
                "Change {}: rollback failed: {}",
                plan.id,
                rollback_errors.join("; ")
            ),
            Some(&plan.instance_id),
        );
        bail!(
            "Change failed: {error}. Rollback incomplete: {}. Backup ID: {}",
            rollback_errors.join("; "),
            plan.id
        );
    }
    mark_backup(&backup_dir, "applied").with_context(|| {
        format!(
            "Change applied and verified, but backup marker failed; backup ID {}",
            plan.id
        )
    })?;
    let _ = state.db.append_log(
        "info",
        &format!("Applied {:?} mod change: {}", plan.kind, plan.id),
        Some(&instance.name),
    );
    Ok(ChangeApplyResult {
        instance_id: plan.instance_id.clone(),
        kind: plan.kind,
        verified: true,
        backup_id: Some(plan.id.clone()),
        mod_file: new_mod,
    })
}

pub fn list_change_history(state: &AppState, instance_id: &str) -> Result<Vec<ChangeBackup>> {
    let instance = state
        .db
        .get_instance(instance_id)?
        .context("Instance not found")?;
    let root = backup_root(&instance.game_dir);
    if !root.exists() {
        return Ok(vec![]);
    }
    let mut backups = Vec::new();
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        if Uuid::parse_str(&entry.file_name().to_string_lossy()).is_err() {
            continue;
        }
        if !entry.path().join("manifest.json").exists() {
            continue;
        }
        let backup = read_backup(&entry.path())?;
        if backup.instance_id == instance_id {
            backups.push(backup);
        }
    }
    backups.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(backups)
}

pub fn list_backups(state: &AppState, instance_id: &str) -> Result<Vec<ChangeBackup>> {
    Ok(list_change_history(state, instance_id)?
        .into_iter()
        .filter(|backup| {
            matches!(
                backup.status.as_str(),
                "applied" | "pending" | "rollbackFailed"
            )
        })
        .collect())
}

pub fn restore_backup(
    state: &AppState,
    instance_id: &str,
    backup_id: &str,
) -> Result<crate::models::change_plan::ChangeRestoreResult> {
    Uuid::parse_str(backup_id).context("Invalid backup ID")?;
    let _guard = InstanceMutationGuard::acquire(instance_id)?;
    let instance = state
        .db
        .get_instance(instance_id)?
        .context("Instance not found")?;
    let dir = backup_root(&instance.game_dir).join(backup_id);
    let backup = read_backup(&dir)?;
    if backup.instance_id != instance_id {
        bail!("Backup belongs to another instance");
    }
    if backup.status != "applied" && backup.status != "pending" && backup.status != "rollbackFailed"
    {
        bail!("Backup is not restorable");
    }
    let mods_dir = Path::new(&instance.game_dir).join("mods");
    for path in [
        backup.old_file_path.as_deref(),
        backup.new_file_path.as_deref(),
    ]
    .into_iter()
    .flatten()
    {
        if !Path::new(path).starts_with(&mods_dir)
            || Path::new(path)
                .components()
                .any(|component| matches!(component, std::path::Component::ParentDir))
        {
            bail!("Backup path is outside the instance mods folder");
        }
    }
    let old_file = backup.old_file_path.as_deref().map(Path::new);
    let new_file = backup.new_file_path.as_deref().map(Path::new);
    let old_backup = old_file.map(|path| dir.join(path.file_name().unwrap()));
    if backup.status == "pending" && old_backup.as_ref().is_some_and(|saved| !saved.exists()) {
        let old = old_file.context("Pending backup has no original path")?;
        if !old.exists()
            || hash_file(old)?
                != backup
                    .old_sha256
                    .as_deref()
                    .context("Backup hash is missing")?
        {
            bail!("Pending change has no intact original JAR or backup");
        }
        if new_file.is_some_and(|new| new != old && new.exists()) {
            bail!("Pending change has an unexpected installed JAR; inspect files before restoring");
        }
        mark_backup(&dir, "rolled-back")?;
        return Ok(crate::models::change_plan::ChangeRestoreResult {
            instance_id: instance_id.to_string(),
            backup_id: backup_id.to_string(),
            verified: true,
            warnings: vec![],
        });
    }
    if let Some(old) = &old_backup {
        if !old.exists()
            || hash_file(old)?
                != backup
                    .old_sha256
                    .as_deref()
                    .context("Backup hash is missing")?
        {
            bail!("Original backup JAR is missing or changed");
        }
    }
    if let Some(new) = new_file {
        if (!new.exists() && backup.status != "pending")
            || (new.exists()
                && hash_file(new)?
                    != backup
                        .new_sha256
                        .as_deref()
                        .context("Installed hash is missing")?)
        {
            bail!("Installed JAR changed since backup; restoration would overwrite newer work");
        }
    }
    if let Some(old) = old_file {
        if old != new_file.unwrap_or(Path::new("")) && old.exists() {
            bail!("Original filename is already occupied");
        }
    }
    let db_was_applied = if backup.status == "applied" {
        true
    } else {
        match (&backup.old_mod, &backup.new_mod) {
            (Some(old), _) => state.db.get_mod_by_id(&old.id)?.is_none_or(|current| {
                current.file_path != old.file_path || current.hash_sha256 != old.hash_sha256
            }),
            (None, Some(new)) => state.db.get_mod_by_id(&new.id)?.is_some(),
            (None, None) => false,
        }
    };
    let displaced = dir.join("displaced-new.jar");
    if displaced.exists() {
        bail!("Restore staging file already exists");
    }
    if let Some(new) = new_file.filter(|path| path.exists()) {
        fs::rename(new, &displaced).context("Could not stage installed JAR for restore")?;
    }
    if let (Some(old), Some(saved)) = (old_file, &old_backup) {
        if let Err(error) = fs::rename(saved, old) {
            if let Some(new) = new_file.filter(|_| displaced.exists()) {
                let _ = fs::rename(&displaced, new);
            }
            return Err(error).context("Could not restore original JAR");
        }
    }
    let restored_edges = if db_was_applied {
        match state.db.restore_change_record(&backup) {
            Ok(count) => count,
            Err(error) => {
                let mut rollback_errors = Vec::new();
                if let (Some(old), Some(saved)) = (old_file, &old_backup) {
                    if let Err(undo) = fs::rename(old, saved) {
                        rollback_errors.push(undo.to_string());
                    }
                }
                if let Some(new) = new_file.filter(|_| displaced.exists()) {
                    if let Err(undo) = fs::rename(&displaced, new) {
                        rollback_errors.push(undo.to_string());
                    }
                }
                if !rollback_errors.is_empty() {
                    bail!(
                        "Restore failed: {error}. File rollback incomplete: {}",
                        rollback_errors.join("; ")
                    );
                }
                return Err(error).context("Restore failed; pack files were left unchanged");
            }
        }
    } else {
        backup.manual_edges.len()
    };
    let after = pack_truth(state, instance_id, &instance.game_dir)
        .context("Original files and database were restored, but post-restore scan failed")?;
    if let Some(old) = old_file {
        if after
            .mods
            .iter()
            .find(|item| item.file_path == old.to_string_lossy())
            .and_then(|item| item.hash_sha256.as_deref())
            != backup.old_sha256.as_deref()
        {
            bail!("Restore did not verify the original JAR; backup ID {backup_id}");
        }
    }
    if let Some(new) = new_file {
        if old_file != Some(new)
            && after
                .mods
                .iter()
                .any(|item| item.file_path == new.to_string_lossy())
        {
            bail!("Restore did not remove the installed JAR; backup ID {backup_id}");
        }
    }
    mark_backup(&dir, "restored").context(
        "Original files and database were restored and verified, but the restore marker failed",
    )?;
    let _ = state.db.append_log(
        "info",
        &format!("Restored mod change backup {backup_id}"),
        Some(&instance.name),
    );
    let mut warnings = Vec::new();
    if backup.new_mod.is_none() && restored_edges < backup.manual_edges.len() {
        warnings.push(format!(
            "Restored {} of {} manual relationships; some related mods no longer exist.",
            restored_edges,
            backup.manual_edges.len()
        ));
    }
    Ok(crate::models::change_plan::ChangeRestoreResult {
        instance_id: instance_id.to_string(),
        backup_id: backup_id.to_string(),
        verified: true,
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use std::fs::{self, File};
    use std::io::{self, Read, Write};
    use std::path::{Path, PathBuf};
    use std::time::{Duration, SystemTime};

    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    use super::{
        apply_change, list_change_history, preview_change, restore_backup, InstanceMutationGuard,
        TestFault, TEST_FAULTS,
    };
    use crate::models::change_plan::{ChangeKind, ChangeRequest};
    use crate::models::instance::{CreateInstanceInput, LoaderType};
    use crate::services::database::Database;
    use crate::services::hash_service::hash_file;
    use crate::services::mod_parser::parse_mod_jar;
    use crate::state::AppState;

    struct Fixture {
        root: PathBuf,
        state: AppState,
        instance_id: String,
    }
    impl Fixture {
        fn new() -> Self {
            let root =
                std::env::temp_dir().join(format!("modly-change-test-{}", uuid::Uuid::new_v4()));
            let mods = root.join("game/mods");
            fs::create_dir_all(&mods).unwrap();
            let db = Database::new(root.join("data")).unwrap();
            let instance = db
                .create_instance(CreateInstanceInput {
                    name: "test".into(),
                    game_dir: root.join("game").to_string_lossy().to_string(),
                    loader: LoaderType::Fabric,
                    mc_version: Some("1.20.1".into()),
                })
                .unwrap();
            Self {
                state: AppState {
                    db,
                    app_data_dir: root.join("data"),
                },
                root,
                instance_id: instance.id,
            }
        }
        fn jar(&self, path: &Path, id: &str, version: &str) {
            let file = File::create(path).unwrap();
            let mut archive = ZipWriter::new(file);
            archive
                .start_file("fabric.mod.json", SimpleFileOptions::default())
                .unwrap();
            write!(archive, "{{\"schemaVersion\":1,\"id\":\"{id}\",\"name\":\"{id}\",\"version\":\"{version}\",\"depends\":{{\"minecraft\":\">=1.20.1\"}}}}").unwrap();
            archive.finish().unwrap();
        }
        fn request(
            &self,
            kind: ChangeKind,
            target: Option<String>,
            source: Option<&Path>,
        ) -> ChangeRequest {
            ChangeRequest {
                kind,
                instance_id: self.instance_id.clone(),
                target_mod_id: target,
                source_path: source.map(|path| path.to_string_lossy().to_string()),
                download_url: None,
                file_name: None,
                expected_sha256: None,
                version_id: None,
                suggestion_id: None,
            }
        }
        fn saved_mod(&self, path: &Path) -> String {
            let mod_file = crate::models::mod_metadata::ModFile {
                id: uuid::Uuid::new_v4().to_string(),
                instance_id: self.instance_id.clone(),
                file_name: path.file_name().unwrap().to_string_lossy().to_string(),
                file_path: path.to_string_lossy().to_string(),
                installed_at: "now".into(),
                enabled: true,
                hash_sha256: Some(hash_file(path).unwrap()),
                source_url: None,
                metadata: Some(parse_mod_jar(path).unwrap()),
                categories: vec![],
                related_mods: vec![],
            };
            let id = mod_file.id.clone();
            self.state.db.upsert_mod(&mod_file).unwrap();
            id
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn add_rejects_duplicate_corrupt_and_invalid_manifest() {
        let f = Fixture::new();
        let source = f.root.join("existing.jar");
        f.jar(&source, "existing", "1.0.0");
        f.jar(&f.root.join("game/mods/existing.jar"), "other", "1.0.0");
        assert!(preview_change(
            &f.state,
            f.request(ChangeKind::Add, None, Some(&source)),
            None
        )
        .unwrap_err()
        .to_string()
        .contains("already exists"));
        let corrupt = f.root.join("corrupt.jar");
        fs::write(&corrupt, b"not a zip").unwrap();
        assert!(preview_change(
            &f.state,
            f.request(ChangeKind::Add, None, Some(&corrupt)),
            None
        )
        .is_err());
        let invalid = f.root.join("invalid.jar");
        let file = File::create(&invalid).unwrap();
        let mut archive = ZipWriter::new(file);
        archive
            .start_file("fabric.mod.json", SimpleFileOptions::default())
            .unwrap();
        archive.write_all(b"{invalid").unwrap();
        archive.finish().unwrap();
        assert!(preview_change(
            &f.state,
            f.request(ChangeKind::Add, None, Some(&invalid)),
            None
        )
        .is_err());
    }

    #[test]
    fn update_same_filename_can_restore_original_file_and_record() {
        let f = Fixture::new();
        let old = f.root.join("game/mods/example.jar");
        f.jar(&old, "example", "1.0.0");
        let id = f.saved_mod(&old);
        let before = hash_file(&old).unwrap();
        let candidate = f.root.join("example.jar");
        f.jar(&candidate, "example", "2.0.0");
        let plan = preview_change(
            &f.state,
            f.request(ChangeKind::Update, Some(id.clone()), Some(&candidate)),
            None,
        )
        .unwrap();
        assert_eq!(
            plan.old_file_path, plan.new_file_path,
            "same filename update paths"
        );
        let applied = apply_change(&f.state, &plan.id).unwrap();
        assert!(applied.verified);
        assert_ne!(hash_file(&old).unwrap(), before);
        assert_eq!(
            f.state
                .db
                .get_mod_by_id(&id)
                .unwrap()
                .unwrap()
                .metadata
                .unwrap()
                .version,
            "2.0.0"
        );
        let restored = restore_backup(
            &f.state,
            &f.instance_id,
            applied.backup_id.as_deref().unwrap(),
        )
        .unwrap();
        assert!(restored.verified);
        assert_eq!(hash_file(&old).unwrap(), before);
        assert_eq!(
            f.state
                .db
                .get_mod_by_id(&id)
                .unwrap()
                .unwrap()
                .metadata
                .unwrap()
                .version,
            "1.0.0"
        );
    }

    #[test]
    fn remove_restores_original_and_stale_plan_does_not_mutate() {
        let f = Fixture::new();
        let old = f.root.join("game/mods/example.jar");
        f.jar(&old, "example", "1.0.0");
        let id = f.saved_mod(&old);
        let stale = preview_change(
            &f.state,
            f.request(ChangeKind::Remove, Some(id.clone()), None),
            None,
        )
        .unwrap();
        f.jar(&old, "example", "2.0.0");
        assert!(apply_change(&f.state, &stale.id).is_err());
        assert!(old.exists());
        let plan = preview_change(
            &f.state,
            f.request(ChangeKind::Remove, Some(id.clone()), None),
            None,
        )
        .unwrap();
        assert!(
            plan.truth
                .mods
                .iter()
                .any(|item| Some(item.file_path.as_str()) == plan.old_file_path.as_deref()),
            "old path {:?} truth {:?}",
            plan.old_file_path,
            plan.truth
                .mods
                .iter()
                .map(|item| &item.file_path)
                .collect::<Vec<_>>()
        );
        let applied = apply_change(&f.state, &plan.id).unwrap();
        assert!(!old.exists());
        assert!(f.state.db.get_mod_by_id(&id).unwrap().is_none());
        assert!(
            restore_backup(
                &f.state,
                &f.instance_id,
                applied.backup_id.as_deref().unwrap()
            )
            .unwrap()
            .verified
        );
        assert!(old.exists());
        assert!(f.state.db.get_mod_by_id(&id).unwrap().is_some());
    }

    #[test]
    fn pending_interrupted_update_recovers_old_file_and_database() {
        let f = Fixture::new();
        let old = f.root.join("game/mods/example.jar");
        f.jar(&old, "example", "1.0.0");
        let id = f.saved_mod(&old);
        let original_hash = hash_file(&old).unwrap();
        let candidate = f.root.join("example.jar");
        f.jar(&candidate, "example", "2.0.0");
        let plan = preview_change(
            &f.state,
            f.request(ChangeKind::Update, Some(id.clone()), Some(&candidate)),
            None,
        )
        .unwrap();
        let applied = apply_change(&f.state, &plan.id).unwrap();
        let backup_id = applied.backup_id.unwrap();
        fs::remove_file(
            f.root
                .join("game/.modly-backups")
                .join(&backup_id)
                .join("applied"),
        )
        .unwrap();
        fs::remove_file(&old).unwrap();
        assert!(
            restore_backup(&f.state, &f.instance_id, &backup_id)
                .unwrap()
                .verified
        );
        assert_eq!(hash_file(&old).unwrap(), original_hash);
        assert_eq!(
            f.state
                .db
                .get_mod_by_id(&id)
                .unwrap()
                .unwrap()
                .metadata
                .unwrap()
                .version,
            "1.0.0"
        );
    }

    #[test]
    fn add_and_replace_can_restore_original_pack() {
        let f = Fixture::new();
        let source = f.root.join("added.jar");
        f.jar(&source, "added", "1.0.0");
        let add = preview_change(
            &f.state,
            f.request(ChangeKind::Add, None, Some(&source)),
            None,
        )
        .unwrap();
        let added = apply_change(&f.state, &add.id).unwrap();
        let installed = f.root.join("game/mods/added.jar");
        assert!(installed.exists());
        assert!(
            restore_backup(
                &f.state,
                &f.instance_id,
                added.backup_id.as_deref().unwrap()
            )
            .unwrap()
            .verified
        );
        assert!(!installed.exists());

        let old = f.root.join("game/mods/original.jar");
        f.jar(&old, "original", "1.0.0");
        let id = f.saved_mod(&old);
        let original_hash = hash_file(&old).unwrap();
        let replacement = f.root.join("replacement.jar");
        f.jar(&replacement, "original", "2.0.0");
        let replace = preview_change(
            &f.state,
            f.request(ChangeKind::Replace, Some(id.clone()), Some(&replacement)),
            None,
        )
        .unwrap();
        let applied = apply_change(&f.state, &replace.id).unwrap();
        assert!(!old.exists());
        assert!(f.root.join("game/mods/replacement.jar").exists());
        assert!(
            restore_backup(
                &f.state,
                &f.instance_id,
                applied.backup_id.as_deref().unwrap()
            )
            .unwrap()
            .verified
        );
        assert_eq!(hash_file(&old).unwrap(), original_hash);
        assert!(!f.root.join("game/mods/replacement.jar").exists());
        assert_eq!(
            f.state
                .db
                .get_mod_by_id(&id)
                .unwrap()
                .unwrap()
                .metadata
                .unwrap()
                .version,
            "1.0.0"
        );
    }

    #[test]
    fn occupied_stage_fails_without_deleting_unowned_file() {
        let f = Fixture::new();
        let source = f.root.join("candidate.jar");
        f.jar(&source, "candidate", "1.0.0");
        let plan = preview_change(
            &f.state,
            f.request(ChangeKind::Add, None, Some(&source)),
            None,
        )
        .unwrap();
        let occupied = f
            .root
            .join("game/mods")
            .join(format!(".modly-{}.part", plan.id));
        fs::write(&occupied, b"another operation").unwrap();
        assert!(apply_change(&f.state, &plan.id).is_err());
        assert_eq!(fs::read(&occupied).unwrap(), b"another operation");
        assert!(!f.root.join("game/mods/candidate.jar").exists());
    }

    #[test]
    fn partial_copy_removes_staged_file() {
        struct FailingReader(bool);
        impl Read for FailingReader {
            fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
                if self.0 {
                    return Err(io::Error::other("simulated read failure"));
                }
                self.0 = true;
                buffer[0] = b'x';
                Ok(1)
            }
        }
        let root =
            std::env::temp_dir().join(format!("modly-partial-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let target = root.join("candidate.part");
        assert!(super::copy_reader_to_pack_stage(FailingReader(false), &target, "unused").is_err());
        assert!(!target.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn locked_jar_cannot_be_planned_or_mutated() {
        use std::os::windows::fs::OpenOptionsExt;
        let f = Fixture::new();
        let old = f.root.join("game/mods/locked.jar");
        f.jar(&old, "locked", "1.0.0");
        let id = f.saved_mod(&old);
        let original_hash = hash_file(&old).unwrap();
        let locked = fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&old)
            .unwrap();
        assert!(preview_change(
            &f.state,
            f.request(ChangeKind::Remove, Some(id.clone()), None),
            None
        )
        .is_err());
        drop(locked);
        assert_eq!(hash_file(&old).unwrap(), original_hash);
        assert!(f.state.db.get_mod_by_id(&id).unwrap().is_some());
    }

    #[test]
    fn removal_plan_lists_direct_and_transitive_dependents() {
        let f = Fixture::new();
        let mods = f.root.join("game/mods");
        let write_mod = |path: &Path, id: &str, dependency: Option<&str>| {
            let file = File::create(path).unwrap();
            let mut archive = ZipWriter::new(file);
            archive
                .start_file("fabric.mod.json", SimpleFileOptions::default())
                .unwrap();
            let depends = dependency
                .map(|target| format!(",\"depends\":{{\"{target}\":\"*\"}}"))
                .unwrap_or_default();
            write!(archive, "{{\"schemaVersion\":1,\"id\":\"{id}\",\"name\":\"{id}\",\"version\":\"1.0.0\"{depends}}}").unwrap();
            archive.finish().unwrap();
        };
        let library = mods.join("library.jar");
        let addon = mods.join("addon.jar");
        let extension = mods.join("extension.jar");
        write_mod(&library, "library", None);
        write_mod(&addon, "addon", Some("library"));
        write_mod(&extension, "extension", Some("addon"));
        let id = f.saved_mod(&library);
        let plan = preview_change(
            &f.state,
            f.request(ChangeKind::Remove, Some(id), None),
            None,
        )
        .unwrap();
        assert_eq!(plan.direct_dependents.len(), 1);
        assert!(plan.direct_dependents[0].ends_with("addon.jar"));
        assert_eq!(plan.transitive_dependents.len(), 1);
        assert_eq!(plan.transitive_dependents[0].len(), 3);
        assert!(plan.transitive_dependents[0][2].ends_with("extension.jar"));
    }

    #[test]
    fn busy_instance_keeps_plan_available_and_duplicate_apply_is_rejected() {
        let f = Fixture::new();
        let source = f.root.join("new.jar");
        f.jar(&source, "newmod", "1.0.0");
        let plan = preview_change(
            &f.state,
            f.request(ChangeKind::Add, None, Some(&source)),
            None,
        )
        .unwrap();
        let guard = InstanceMutationGuard::acquire(&f.instance_id).unwrap();
        assert!(apply_change(&f.state, &plan.id)
            .unwrap_err()
            .to_string()
            .contains("already running"));
        drop(guard);
        assert!(apply_change(&f.state, &plan.id).unwrap().verified);
        assert!(apply_change(&f.state, &plan.id)
            .unwrap_err()
            .to_string()
            .contains("already applied"));
    }

    #[test]
    fn failure_after_backup_restores_and_verifies_original() {
        let f = Fixture::new();
        let old = f.root.join("game/mods/example.jar");
        f.jar(&old, "example", "1.0.0");
        let id = f.saved_mod(&old);
        let original_hash = hash_file(&old).unwrap();
        let plan = preview_change(
            &f.state,
            f.request(ChangeKind::Remove, Some(id), None),
            None,
        )
        .unwrap();
        TEST_FAULTS
            .get_or_init(Default::default)
            .lock()
            .unwrap()
            .insert(plan.id.clone(), TestFault::AfterBackup);
        let error = apply_change(&f.state, &plan.id).unwrap_err().to_string();
        assert!(error.contains("rolled-back"), "{error}");
        assert_eq!(hash_file(&old).unwrap(), original_hash);
        assert_eq!(
            list_change_history(&f.state, &f.instance_id).unwrap()[0].status,
            "rolledBack"
        );
    }

    #[test]
    fn failed_rollback_keeps_original_backup_and_reports_recovery_id() {
        let f = Fixture::new();
        let old = f.root.join("game/mods/example.jar");
        f.jar(&old, "example", "1.0.0");
        let id = f.saved_mod(&old);
        let original_hash = hash_file(&old).unwrap();
        let plan = preview_change(
            &f.state,
            f.request(ChangeKind::Remove, Some(id), None),
            None,
        )
        .unwrap();
        TEST_FAULTS
            .get_or_init(Default::default)
            .lock()
            .unwrap()
            .insert(plan.id.clone(), TestFault::AfterBackupCollision);
        let error = apply_change(&f.state, &plan.id).unwrap_err().to_string();
        assert!(
            error.contains("Rollback incomplete") && error.contains(&plan.id),
            "{error}"
        );
        assert_eq!(fs::read(&old).unwrap(), b"external file");
        assert_eq!(
            hash_file(Path::new(plan.backup_path.as_deref().unwrap())).unwrap(),
            original_hash
        );
        assert_eq!(
            list_change_history(&f.state, &f.instance_id).unwrap()[0].status,
            "rollbackFailed"
        );
    }

    #[test]
    fn failure_after_install_restores_old_file_and_no_staged_link_remains() {
        let f = Fixture::new();
        let old = f.root.join("game/mods/example.jar");
        f.jar(&old, "example", "1.0.0");
        let id = f.saved_mod(&old);
        let original_hash = hash_file(&old).unwrap();
        let candidate = f.root.join("example.jar");
        f.jar(&candidate, "example", "2.0.0");
        let plan = preview_change(
            &f.state,
            f.request(ChangeKind::Update, Some(id), Some(&candidate)),
            None,
        )
        .unwrap();
        TEST_FAULTS
            .get_or_init(Default::default)
            .lock()
            .unwrap()
            .insert(plan.id.clone(), TestFault::AfterInstall);
        let error = apply_change(&f.state, &plan.id).unwrap_err().to_string();
        assert!(error.contains("rolled-back"), "{error}");
        assert_eq!(hash_file(&old).unwrap(), original_hash);
        assert!(!f
            .root
            .join("game/mods")
            .join(format!(".modly-{}.part", plan.id))
            .exists());
    }

    #[test]
    fn rollback_preserves_externally_replaced_installed_file_and_original_backup() {
        let f = Fixture::new();
        let old = f.root.join("game/mods/example.jar");
        f.jar(&old, "example", "1.0.0");
        let id = f.saved_mod(&old);
        let original_hash = hash_file(&old).unwrap();
        let candidate = f.root.join("example.jar");
        f.jar(&candidate, "example", "2.0.0");
        let plan = preview_change(
            &f.state,
            f.request(ChangeKind::Update, Some(id), Some(&candidate)),
            None,
        )
        .unwrap();
        TEST_FAULTS
            .get_or_init(Default::default)
            .lock()
            .unwrap()
            .insert(plan.id.clone(), TestFault::AfterInstallCollision);
        let error = apply_change(&f.state, &plan.id).unwrap_err().to_string();
        assert!(error.contains("Rollback incomplete") && error.contains(&plan.id));
        assert_eq!(
            fs::read(plan.new_file_path.as_deref().unwrap()).unwrap(),
            b"external file"
        );
        assert_eq!(
            hash_file(Path::new(plan.backup_path.as_deref().unwrap())).unwrap(),
            original_hash
        );
        assert_eq!(
            list_change_history(&f.state, &f.instance_id).unwrap()[0].status,
            "rollbackFailed"
        );
    }

    #[test]
    fn deleted_target_and_wrong_source_hash_cannot_apply() {
        let f = Fixture::new();
        let old = f.root.join("game/mods/example.jar");
        f.jar(&old, "example", "1.0.0");
        let id = f.saved_mod(&old);
        let plan = preview_change(
            &f.state,
            f.request(ChangeKind::Remove, Some(id), None),
            None,
        )
        .unwrap();
        fs::remove_file(&old).unwrap();
        assert!(apply_change(&f.state, &plan.id).is_err());
        assert!(!old.exists());
        let source = f.root.join("candidate.jar");
        f.jar(&source, "candidate", "1.0.0");
        let mut request = f.request(ChangeKind::Add, None, Some(&source));
        request.expected_sha256 = Some("0".repeat(64));
        assert!(preview_change(&f.state, request, None)
            .unwrap_err()
            .to_string()
            .contains("expected SHA-256"));
        assert!(!f.root.join("game/mods/candidate.jar").exists());
    }

    #[test]
    fn stage_cleanup_removes_only_old_files_with_modly_plan_names() {
        let root =
            std::env::temp_dir().join(format!("modly-stage-cleanup-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let old = root.join(format!(".modly-{}.part", uuid::Uuid::new_v4()));
        let recent = root.join(format!(".modly-{}.part", uuid::Uuid::new_v4()));
        let foreign = root.join(".modly-not-a-uuid.part");
        for path in [&old, &recent, &foreign] {
            fs::write(path, b"stage").unwrap();
        }
        let old_time = std::fs::FileTimes::new()
            .set_modified(SystemTime::now() - Duration::from_secs(48 * 60 * 60));
        fs::OpenOptions::new()
            .write(true)
            .open(&old)
            .unwrap()
            .set_times(old_time)
            .unwrap();
        fs::OpenOptions::new()
            .write(true)
            .open(&foreign)
            .unwrap()
            .set_times(old_time)
            .unwrap();
        assert!(super::cleanup_stage_dir(
            &root,
            ".modly-",
            ".part",
            Duration::from_secs(24 * 60 * 60)
        )
        .is_empty());
        assert!(!old.exists());
        assert!(recent.exists() && foreign.exists());
        fs::remove_dir_all(root).unwrap();
    }
}
