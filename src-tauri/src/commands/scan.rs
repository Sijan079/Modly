use tauri::command;

use crate::models::scan::MinecraftScanResult;
use crate::services::scanner::{default_minecraft_dir, scan_minecraft_directory};
use crate::state::with_state;

#[command]
pub async fn scan_default_minecraft() -> Result<MinecraftScanResult, String> {
    with_state(|state| {
        let settings = state.db.get_settings().map_err(|e| e.to_string())?;
        let root = settings
            .minecraft_dir
            .map(std::path::PathBuf::from)
            .or_else(default_minecraft_dir)
            .ok_or_else(|| "Could not determine .minecraft directory".to_string())?;
        scan_minecraft_directory(&root).map_err(|e| e.to_string())
    })
}

#[command]
pub async fn scan_minecraft_path(path: String) -> Result<MinecraftScanResult, String> {
    scan_minecraft_directory(std::path::Path::new(&path)).map_err(|e| e.to_string())
}

#[command]
pub async fn get_default_minecraft_path() -> Result<Option<String>, String> {
    Ok(default_minecraft_dir().map(|p| p.to_string_lossy().to_string()))
}
