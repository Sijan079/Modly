use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigTreeNode {
    name: String,
    path: String,
    is_dir: bool,
    children: Vec<ConfigTreeNode>,
}

fn build_tree(path: &Path) -> Result<ConfigTreeNode, String> {
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    let is_dir = metadata.is_dir();
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_string();

    let mut children = Vec::new();
    if is_dir {
        let mut entries = fs::read_dir(path)
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .collect::<Vec<_>>();

        entries.sort_by_key(|entry| {
            let is_file = entry.file_type().map(|kind| kind.is_file()).unwrap_or(true);
            (is_file, entry.file_name().to_string_lossy().to_lowercase())
        });

        for entry in entries {
            children.push(build_tree(&entry.path())?);
        }
    }

    Ok(ConfigTreeNode {
        name,
        path: path.to_string_lossy().to_string(),
        is_dir,
        children,
    })
}

/// Scans the config directory of a Minecraft instance and returns a file tree.
#[tauri::command]
pub async fn scan_config_tree(instance_path: String) -> Result<Vec<ConfigTreeNode>, String> {
    let config_path: PathBuf = Path::new(&instance_path).join("config");
    if !config_path.exists() {
        return Ok(Vec::new());
    }

    let root = build_tree(&config_path)?;
    Ok(root.children)
}

/// Reads the contents of a configuration file.
#[tauri::command]
pub async fn read_config_file(path: String) -> Result<String, String> {
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    Ok(content)
}

/// Writes the given content to a configuration file, overwriting it if it exists.
#[tauri::command]
pub async fn write_config_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(())
}

/// Creates a new empty configuration file at the specified path.
#[tauri::command]
pub async fn create_config_file(path: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, "").map_err(|e| e.to_string())?;
    Ok(())
}

/// Creates a new configuration folder at the specified path.
#[tauri::command]
pub async fn create_config_folder(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(())
}

/// Renames or moves a configuration file or folder.
#[tauri::command]
pub async fn rename_config_item(old_path: String, new_path: String) -> Result<(), String> {
    fs::rename(&old_path, &new_path).map_err(|e| e.to_string())?;
    Ok(())
}

/// Deletes a configuration file or folder.
#[tauri::command]
pub async fn delete_config_item(path: String) -> Result<(), String> {
    let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
    if metadata.is_dir() {
        fs::remove_dir_all(&path).map_err(|e| e.to_string())?;
    } else {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}
