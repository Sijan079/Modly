use tauri::command;

use crate::models::change_plan::{
    ChangeApplyResult, ChangeBackup, ChangePlan, ChangeRequest, ChangeRestoreResult,
};
use crate::services::change_plan::{
    apply_change, discard_plan, list_backups, preview_change, restore_backup,
};
use crate::services::updates::download_bytes;
use crate::state::with_state;

#[command]
pub async fn preview_mod_change(request: ChangeRequest) -> Result<ChangePlan, String> {
    if request.source_path.is_some() == request.download_url.is_some()
        && request.kind != crate::models::change_plan::ChangeKind::Remove
    {
        return Err("Specify exactly one local file or download URL".to_string());
    }
    if request.kind == crate::models::change_plan::ChangeKind::Remove
        && (request.source_path.is_some() || request.download_url.is_some())
    {
        return Err("Remove cannot have a source JAR".to_string());
    }
    let downloaded = if let Some(url) = &request.download_url {
        Some(
            download_bytes(url)
                .await
                .map_err(|error| error.to_string())?,
        )
    } else {
        None
    };
    tauri::async_runtime::spawn_blocking(move || {
        with_state(|state| {
            preview_change(state, request, downloaded).map_err(|error| error.to_string())
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[command]
pub async fn apply_mod_change(plan_id: String) -> Result<ChangeApplyResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        with_state(|state| apply_change(state, &plan_id).map_err(|error| error.to_string()))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[command]
pub async fn discard_mod_change_plan(plan_id: String) -> Result<(), String> {
    discard_plan(&plan_id).map_err(|error| error.to_string())
}

#[command]
pub async fn list_mod_change_backups(instance_id: String) -> Result<Vec<ChangeBackup>, String> {
    with_state(|state| list_backups(state, &instance_id).map_err(|error| error.to_string()))
}

#[command]
pub async fn restore_mod_change(
    instance_id: String,
    backup_id: String,
) -> Result<ChangeRestoreResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        with_state(|state| {
            restore_backup(state, &instance_id, &backup_id).map_err(|error| error.to_string())
        })
    })
    .await
    .map_err(|error| error.to_string())?
}
