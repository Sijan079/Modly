use tauri::command;

use crate::models::settings::AppSettings;
use crate::state::with_state;

#[command]
pub async fn get_settings() -> Result<AppSettings, String> {
    with_state(|state| state.db.get_settings().map_err(|e| e.to_string()))
}

#[command]
pub async fn save_settings(settings: AppSettings) -> Result<(), String> {
    with_state(|state| state.db.save_settings(&settings).map_err(|e| e.to_string()))
}
