use std::path::Path;

use sha2::{Digest, Sha256};
use tauri::command;
use uuid::Uuid;

use crate::models::mod_metadata::{ModFile, UpdateModMetadataInput};
use crate::models::updates::{
    CheckUpdateTargetInput, ConfirmUpdateMatchInput, SavedUpdateCheck, UpdateItemType,
    UpdateModFromModrinthInput, UpdateRow, UpdateTarget,
};
use crate::services::hash_service::hash_file;
use crate::services::mod_parser::parse_mod_jar;
use crate::services::updates::{download_bytes, UpdateService};
use crate::state::with_state;

#[command]
pub async fn check_updates(instance_id: String) -> Result<Vec<UpdateRow>, String> {
    let (instance, mods) = with_state(|state| {
        let instance = state
            .db
            .get_instance(&instance_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Instance not found".to_string())?;
        let mods: Vec<ModFile> = state
            .db
            .list_mods(&instance_id)
            .map_err(|e| e.to_string())?;
        Ok((instance, mods))
    })?;
    Ok(UpdateService::default()
        .check_instance(&instance, &mods)
        .await)
}

#[command]
pub async fn get_latest_update_check(
    instance_id: String,
) -> Result<Option<SavedUpdateCheck>, String> {
    with_state(|state| {
        state
            .db
            .get_update_check(&instance_id)
            .map_err(|e| e.to_string())
    })
}

#[command]
pub async fn save_update_check(
    instance_id: String,
    rows: Vec<UpdateRow>,
) -> Result<SavedUpdateCheck, String> {
    with_state(|state| {
        let saved = state
            .db
            .save_update_check(&instance_id, &rows)
            .map_err(|e| e.to_string())?;
        let instance_name = state
            .db
            .get_instance(&instance_id)
            .map_err(|e| e.to_string())?
            .map(|instance| instance.name);
        let updates_available = rows
            .iter()
            .filter(|row| {
                matches!(
                    row.status,
                    crate::models::updates::UpdateStatus::UpdateAvailable
                )
            })
            .count();
        state
            .db
            .append_log(
                "info",
                &format!(
                    "Update check completed: {} items checked, {} update{} available",
                    rows.len(),
                    updates_available,
                    if updates_available == 1 { "" } else { "s" }
                ),
                instance_name.as_deref(),
            )
            .map_err(|e| e.to_string())?;
        Ok(saved)
    })
}

#[command]
pub async fn list_update_targets(instance_id: String) -> Result<Vec<UpdateTarget>, String> {
    with_state(|state| {
        Ok(state
            .db
            .list_mods(&instance_id)
            .map_err(|e| e.to_string())?
            .into_iter()
            .map(|item| UpdateTarget {
                item_id: item.id,
                item_type: UpdateItemType::Mod,
                file_name: item.file_name,
            })
            .collect())
    })
}

#[command]
pub async fn check_update_target(input: CheckUpdateTargetInput) -> Result<UpdateRow, String> {
    let (instance, mods) = with_state(|state| {
        let instance = state
            .db
            .get_instance(&input.instance_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Instance not found".to_string())?;
        let mods: Vec<ModFile> = state
            .db
            .get_mod_by_id(&input.item_id)
            .map_err(|e| e.to_string())?
            .into_iter()
            .collect();
        Ok((instance, mods))
    })?;
    let mut rows = UpdateService::default()
        .check_instance(&instance, &mods)
        .await;
    rows.pop()
        .ok_or_else(|| "Update target not found".to_string())
}

#[command]
pub async fn confirm_update_match(input: ConfirmUpdateMatchInput) -> Result<(), String> {
    with_state(|state| {
        let project_url = if input.project_url.trim().is_empty() {
            format!("https://modrinth.com/project/{}", input.project_id)
        } else {
            input.project_url.clone()
        };
        let existing = state
            .db
            .get_mod_by_id(&input.item_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Mod not found".to_string())?;
        let metadata = existing.metadata.clone();
        state
            .db
            .update_mod_metadata(&UpdateModMetadataInput {
                mod_id: existing.id,
                name: metadata
                    .as_ref()
                    .map(|meta| meta.name.clone())
                    .unwrap_or_else(|| existing.file_name.clone()),
                version: metadata
                    .as_ref()
                    .map(|meta| meta.version.clone())
                    .unwrap_or_default(),
                authors: metadata
                    .as_ref()
                    .map(|meta| meta.authors.clone())
                    .unwrap_or_default(),
                modrinth_url: Some(project_url),
                loader: metadata
                    .as_ref()
                    .map(|meta| meta.loader)
                    .unwrap_or(crate::models::mod_metadata::LoaderKind::Unknown),
                mod_id_field: metadata.as_ref().and_then(|meta| meta.mod_id.clone()),
                installed_modrinth_version_id: metadata
                    .as_ref()
                    .and_then(|meta| meta.installed_modrinth_version_id.clone()),
                category_ids: existing
                    .categories
                    .iter()
                    .map(|category| category.id.clone())
                    .collect(),
            })
            .map_err(|e| e.to_string())?;
        Ok(())
    })
}

#[command]
pub async fn update_mod_from_modrinth(
    input: UpdateModFromModrinthInput,
) -> Result<ModFile, String> {
    let bytes = download_bytes(&input.download_url)
        .await
        .map_err(|e| e.to_string())?;
    if let Some(expected) = input.expected_sha256.as_deref() {
        let actual = format!("{:x}", Sha256::digest(&bytes));
        if !actual.eq_ignore_ascii_case(expected) {
            return Err("Downloaded file did not match expected SHA-256 hash.".to_string());
        }
    }

    with_state(|state| {
        let existing = state
            .db
            .get_mod_by_id(&input.mod_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Mod not found".to_string())?;
        let old_path = Path::new(&existing.file_path);
        let mods_dir = old_path
            .parent()
            .ok_or_else(|| "Could not resolve mods folder".to_string())?;
        std::fs::create_dir_all(mods_dir).map_err(|e| e.to_string())?;

        let safe_file_name = sanitize_file_name(&input.file_name);
        let new_path = mods_dir.join(&safe_file_name);
        let temp_path = mods_dir.join(format!("{safe_file_name}.download"));
        std::fs::write(&temp_path, &bytes).map_err(|e| e.to_string())?;

        let backup_dir = state
            .app_data_dir
            .join("backups")
            .join("mod-updates")
            .join(chrono::Utc::now().format("%Y%m%d%H%M%S").to_string());
        std::fs::create_dir_all(&backup_dir).map_err(|e| e.to_string())?;
        if old_path.exists() {
            let backup_path = backup_dir.join(
                old_path
                    .file_name()
                    .ok_or_else(|| "Could not resolve old mod file name".to_string())?,
            );
            std::fs::rename(old_path, backup_path).map_err(|e| e.to_string())?;
        }
        std::fs::rename(&temp_path, &new_path).map_err(|e| e.to_string())?;

        state
            .db
            .delete_mod(&existing.id)
            .map_err(|e| e.to_string())?;
        let metadata = {
            let existing_metadata = existing.metadata.clone();
            let mut parsed = parse_mod_jar(&new_path).ok();
            if let Some(ref mut parsed_meta) = parsed {
                if parsed_meta.modrinth_url.is_none() {
                    parsed_meta.modrinth_url = existing_metadata
                        .as_ref()
                        .and_then(|meta| meta.modrinth_url.clone());
                }
                parsed_meta.installed_modrinth_version_id = Some(input.version_id.clone());
            }
            parsed.or_else(|| {
                existing_metadata.map(|mut meta| {
                    meta.installed_modrinth_version_id = Some(input.version_id.clone());
                    meta
                })
            })
        };
        let updated = ModFile {
            id: Uuid::new_v4().to_string(),
            instance_id: existing.instance_id.clone(),
            file_name: safe_file_name,
            file_path: new_path.to_string_lossy().to_string(),
            enabled: true,
            hash_sha256: hash_file(&new_path).ok(),
            metadata,
            categories: existing.categories,
        };
        state.db.upsert_mod(&updated).map_err(|e| e.to_string())?;
        let saved = state
            .db
            .get_mod_by_path(&existing.instance_id, &updated.file_path)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Updated mod not found after save".to_string())?;
        let instance_name = state
            .db
            .get_instance(&existing.instance_id)
            .map_err(|e| e.to_string())?
            .map(|instance| instance.name);
        state
            .db
            .append_log(
                "info",
                &format!("Updated mod: {}", saved.file_name),
                instance_name.as_deref(),
            )
            .map_err(|e| e.to_string())?;
        Ok(saved)
    })
}

#[command]
pub async fn append_update_log(
    instance_id: String,
    level: String,
    message: String,
) -> Result<(), String> {
    with_state(|state| {
        let instance_name = state
            .db
            .get_instance(&instance_id)
            .map_err(|e| e.to_string())?
            .map(|instance| instance.name);
        state
            .db
            .append_log(&level, &message, instance_name.as_deref())
            .map_err(|e| e.to_string())
    })
}

fn sanitize_file_name(value: &str) -> String {
    Path::new(value)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or("updated-mod.jar")
        .to_string()
}
