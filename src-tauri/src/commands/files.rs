use std::path::Path;

use tauri::command;

use crate::services::hash_service::hash_file;
use crate::state::with_state;

#[command]
pub async fn open_in_explorer(path: String) -> Result<(), String> {
    let path = Path::new(&path);
    let target = if path.is_file() {
        path.parent().unwrap_or(path)
    } else {
        path
    };

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(target)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(target)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(target)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[command]
pub async fn hash_file_sha256(path: String) -> Result<String, String> {
    hash_file(Path::new(&path)).map_err(|e| e.to_string())
}

#[command]
pub async fn move_file(source: String, destination: String) -> Result<(), String> {
    std::fs::rename(&source, &destination).map_err(|e| e.to_string())
}

#[command]
pub async fn copy_file(source: String, destination: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&destination).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::copy(&source, &destination).map_err(|e| e.to_string())?;
    Ok(())
}

#[command]
pub async fn delete_file(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.is_dir() {
        std::fs::remove_dir_all(p).map_err(|e| e.to_string())?;
    } else {
        std::fs::remove_file(p).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[command]
pub async fn get_app_data_dir() -> Result<String, String> {
    with_state(|state| Ok(state.app_data_dir.to_string_lossy().to_string()))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

#[command]
pub async fn list_directory(path: String) -> Result<Vec<DirectoryEntry>, String> {
    let mut entries = std::fs::read_dir(&path)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let file_type = entry.file_type().ok()?;
            Some(DirectoryEntry {
                name: entry.file_name().to_string_lossy().to_string(),
                path: entry.path().to_string_lossy().to_string(),
                is_dir: file_type.is_dir(),
            })
        })
        .collect::<Vec<_>>();

    entries.sort_by(|a, b| {
        a.is_dir
            .cmp(&b.is_dir)
            .reverse()
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(entries)
}

#[command]
pub async fn append_log(
    level: String,
    message: String,
    context: Option<String>,
) -> Result<(), String> {
    with_state(|state| {
        state
            .db
            .append_log(&level, &message, context.as_deref())
            .map_err(|e| e.to_string())
    })
}

#[command]
pub async fn list_logs(limit: u32) -> Result<Vec<LogEntry>, String> {
    with_state(|state| {
        let rows = state.db.list_logs(limit).map_err(|e| e.to_string())?;
        Ok(rows
            .into_iter()
            .map(|(id, level, message, context, created_at)| LogEntry {
                id,
                level,
                message,
                context,
                created_at,
            })
            .collect())
    })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub id: i64,
    pub level: String,
    pub message: String,
    pub context: Option<String>,
    pub created_at: String,
}
