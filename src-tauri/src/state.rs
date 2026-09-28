use std::path::PathBuf;
use std::sync::OnceLock;

use tauri::Manager;

use crate::services::change_plan::cleanup_abandoned_stages;
use crate::services::database::Database;

pub struct AppState {
    pub db: Database,
    pub app_data_dir: PathBuf,
}

static APP_STATE: OnceLock<AppState> = OnceLock::new();

pub fn init_state(app_handle: &tauri::AppHandle) -> Result<(), String> {
    let app_data_dir = std::env::var_os("MODLY_APP_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or(
            app_handle
                .path()
                .app_data_dir()
                .map_err(|e| e.to_string())?,
        );
    let db = Database::new(app_data_dir.clone()).map_err(|e| {
        format!(
            "Database initialization failed at {}: {e}",
            app_data_dir.display()
        )
    })?;
    for warning in cleanup_abandoned_stages(&db).map_err(|error| error.to_string())? {
        let _ = db.append_log("warn", &warning, None);
    }
    APP_STATE
        .set(AppState { db, app_data_dir })
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
