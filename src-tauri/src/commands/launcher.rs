use tauri::command;
use uuid::Uuid;

use crate::models::launch::{LaunchConfig, LaunchRequest, LaunchStatus};
use crate::services::launcher::detect_java;
use crate::state::with_state;

#[command]
pub async fn detect_java_path() -> Result<Option<String>, String> {
    Ok(detect_java().ok())
}

#[command]
pub async fn get_launch_config(instance_id: String) -> Result<Option<LaunchConfig>, String> {
    with_state(|state| {
        state
            .db
            .get_launch_config(&instance_id)
            .map_err(|e| e.to_string())
    })
}

#[command]
pub async fn save_launch_config(config: LaunchConfig) -> Result<(), String> {
    with_state(|state| {
        state
            .db
            .save_launch_config(&config)
            .map_err(|e| e.to_string())
    })
}

#[command]
pub async fn launch_instance(request: LaunchRequest) -> Result<u32, String> {
    with_state(|state| {
        let instance = state
            .db
            .get_instance(&request.instance_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Instance not found".to_string())?;

        let settings = state.db.get_settings().map_err(|e| e.to_string())?;

        let config = if let Some(config_id) = request.config_id {
            state
                .db
                .get_launch_config(&request.instance_id)
                .map_err(|e| e.to_string())?
                .filter(|c| c.id == config_id)
        } else {
            state
                .db
                .get_launch_config(&request.instance_id)
                .map_err(|e| e.to_string())?
        };

        let config = config.unwrap_or_else(|| LaunchConfig {
            id: Uuid::new_v4().to_string(),
            instance_id: request.instance_id.clone(),
            java_path: settings.default_java_path.clone().unwrap_or_default(),
            min_memory_mb: 512,
            max_memory_mb: settings.default_max_memory_mb,
            jvm_args: String::new(),
            game_args: format!("--gameDir {}", instance.game_dir),
            wrapper_command: None,
        });

        let java = if config.java_path.is_empty() {
            detect_java().map_err(|e| e.to_string())?
        } else {
            config.java_path.clone()
        };

        let mut effective = config.clone();
        effective.java_path = java;

        state
            .launcher
            .launch(&effective.java_path, &instance.game_dir, &effective)
            .map_err(|e| e.to_string())?;

        state
            .db
            .append_log(
                "info",
                &format!("Launched instance: {}", instance.name),
                None,
            )
            .ok();

        Ok(state.launcher.status().pid.unwrap_or(0))
    })
}

#[command]
pub async fn stop_instance() -> Result<(), String> {
    with_state(|state| {
        state.launcher.stop().map_err(|e| e.to_string())?;
        state
            .db
            .append_log("info", "Stopped running instance", None)
            .ok();
        Ok(())
    })
}

#[command]
pub async fn get_launch_status() -> Result<LaunchStatus, String> {
    with_state(|state| Ok(state.launcher.status()))
}
