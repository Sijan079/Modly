use std::path::Path;

use tauri::command;

use crate::models::crash::CrashAnalysis;
use crate::services::change_plan::list_backups;
use crate::services::crash::{analyze, fingerprint, read_report};
use crate::services::pack_truth::scan_pack_truth;
use crate::state::with_state;

#[command]
pub async fn analyze_crash_report(
    instance_id: String,
    source_path: String,
) -> Result<CrashAnalysis, String> {
    tauri::async_runtime::spawn_blocking(move || {
        with_state(|state| {
            let instance = state
                .db
                .get_instance(&instance_id)
                .map_err(|error| error.to_string())?
                .ok_or_else(|| "Instance not found".to_string())?;
            let report = read_report(Path::new(&source_path)).map_err(|error| error.to_string())?;
            let backups = list_backups(state, &instance_id).map_err(|error| error.to_string())?;
            let key = fingerprint(&report, &source_path, &instance, &backups)
                .map_err(|error| error.to_string())?;
            if let Some(saved) = state
                .db
                .get_crash_analysis(&instance_id, &key)
                .map_err(|error| error.to_string())?
            {
                return Ok(saved);
            }
            let saved_mods = state
                .db
                .list_mods(&instance_id)
                .map_err(|error| error.to_string())?;
            let truth = scan_pack_truth(
                &instance_id,
                &Path::new(&instance.game_dir).join("mods"),
                &saved_mods,
            )
            .map_err(|error| error.to_string())?;
            let result = analyze(&report, &instance, &source_path, key, &truth, &backups);
            state
                .db
                .save_crash_analysis(&result)
                .map_err(|error| error.to_string())?;
            Ok(result)
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[command]
pub async fn get_latest_crash_analysis(
    instance_id: String,
) -> Result<Option<CrashAnalysis>, String> {
    with_state(|state| {
        state
            .db
            .get_latest_crash_analysis(&instance_id)
            .map_err(|error| error.to_string())
    })
}
