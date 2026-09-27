use tauri::command;

use crate::models::mod_metadata::{ModFile, UpdateModMetadataInput};
use crate::models::updates::{
    CheckUpdateTargetInput, ConfirmUpdateMatchInput, ModrinthProjectDetails,
    ModrinthProjectSummary, SavedUpdateCheck, SuggestionVersionOption, UpdateItemType, UpdateRow,
    UpdateTarget,
};
use crate::services::updates::{extract_modrinth_project_id, UpdateService};
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
                modrinth_url: Some(project_url.clone()),
                source_url: Some(project_url),
                loader: metadata
                    .as_ref()
                    .map(|meta| meta.loader)
                    .unwrap_or(crate::models::mod_metadata::LoaderKind::Unknown),
                side: metadata
                    .as_ref()
                    .map(|meta| meta.side)
                    .unwrap_or(crate::models::mod_metadata::ModSide::Unknown),
                mod_id_field: metadata.as_ref().and_then(|meta| meta.mod_id.clone()),
                installed_modrinth_version_id: metadata
                    .as_ref()
                    .and_then(|meta| meta.installed_modrinth_version_id.clone()),
                category_ids: existing
                    .categories
                    .iter()
                    .map(|category| category.id.clone())
                    .collect(),
                related_mods: vec![],
            })
            .map_err(|e| e.to_string())?;
        Ok(())
    })
}

#[command]
pub async fn list_suggestion_modrinth_versions(
    suggestion_id: String,
    game_version: Option<String>,
    loader: Option<String>,
) -> Result<Vec<SuggestionVersionOption>, String> {
    let source_url = with_state(|state| {
        let suggestion = state
            .db
            .get_mod_suggestion_by_id(&suggestion_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Suggestion not found".to_string())?;
        suggestion
            .source_url
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| "Suggestion has no source URL".to_string())
    })?;

    if !source_url.contains("modrinth.com") {
        return Err("Only Modrinth suggestion downloads are supported right now.".to_string());
    }

    let project_id = extract_modrinth_project_id(&source_url)
        .ok_or_else(|| "Could not read Modrinth project from source URL".to_string())?;
    let versions = UpdateService::default()
        .compatible_versions_for_project(&project_id, game_version.as_deref(), loader.as_deref())
        .await
        .map_err(|e| e.to_string())?;

    if versions.is_empty() {
        return Err("No matching Modrinth files were found for that loader/version.".to_string());
    }

    Ok(versions)
}

#[command]
pub async fn get_modrinth_projects(
    project_ids: Vec<String>,
) -> Result<Vec<ModrinthProjectSummary>, String> {
    let mut ids = project_ids
        .into_iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .collect::<Vec<_>>();
    ids.sort();
    ids.dedup();

    UpdateService::default()
        .get_projects(&ids)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn get_modrinth_project_details(
    project_id: String,
) -> Result<ModrinthProjectDetails, String> {
    let project_id = project_id.trim();
    if project_id.is_empty() {
        return Err("A Modrinth project ID is required.".to_string());
    }

    UpdateService::default()
        .get_project_details(project_id)
        .await
        .map_err(|e| e.to_string())
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
