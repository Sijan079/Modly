use std::path::PathBuf;
use std::sync::OnceLock;

use tauri::Manager;

use crate::services::database::Database;
use crate::services::launcher::LauncherService;

pub struct AppState {
    pub db: Database,
    pub launcher: LauncherService,
    pub app_data_dir: PathBuf,
}

static APP_STATE: OnceLock<AppState> = OnceLock::new();

pub fn init_state(app_handle: &tauri::AppHandle) -> Result<(), String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let db = Database::new(app_data_dir.clone()).map_err(|e| e.to_string())?;
    let launcher = LauncherService::new();
    APP_STATE
        .set(AppState {
            db,
            launcher,
            app_data_dir,
        })
        .map_err(|_| "App state already initialized".to_string())?;
    Ok(())
}

/// Run a closure against global app state. Uses `String` errors to match Tauri command signatures.
pub fn with_state<F, T>(f: F) -> Result<T, String>
where
    F: FnOnce(&AppState) -> Result<T, String>,
{
    let state = APP_STATE
        .get()
        .ok_or_else(|| "App not initialized".to_string())?;
    f(state)
}
