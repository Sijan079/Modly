use tauri::command;

use crate::models::instance::{CreateInstanceInput, Instance, UpdateInstanceInput};
use crate::services::zip_service::{create_instance_export_zip, import_modpack_zip};
use crate::state::with_state;

#[command]
pub async fn list_instances() -> Result<Vec<Instance>, String> {
    with_state(|state| state.db.list_instances().map_err(|e| e.to_string()))
}

#[command]
pub async fn get_instance(id: String) -> Result<Option<Instance>, String> {
    with_state(|state| state.db.get_instance(&id).map_err(|e| e.to_string()))
}

#[command]
pub async fn create_instance(input: CreateInstanceInput) -> Result<Instance, String> {
    with_state(|state| {
        std::fs::create_dir_all(&input.game_dir).map_err(|e| e.to_string())?;
        for folder in ["mods", "resourcepacks", "shaderpacks", "config"] {
            std::fs::create_dir_all(std::path::Path::new(&input.game_dir).join(folder))
                .map_err(|e| e.to_string())?;
        }
        state.db.create_instance(input).map_err(|e| e.to_string())
    })
}

#[command]
pub async fn update_instance(input: UpdateInstanceInput) -> Result<Instance, String> {
    with_state(|state| state.db.update_instance(input).map_err(|e| e.to_string()))
}

#[command]
pub async fn delete_instance(id: String, delete_files: bool) -> Result<(), String> {
    with_state(|state| {
        if delete_files {
            if let Some(instance) = state.db.get_instance(&id).map_err(|e| e.to_string())? {
                if std::path::Path::new(&instance.game_dir).exists() {
                    std::fs::remove_dir_all(&instance.game_dir).map_err(|e| e.to_string())?;
                }
            }
        }
        state.db.delete_instance(&id).map_err(|e| e.to_string())
    })
}

#[command]
pub async fn duplicate_instance(
    id: String,
    new_name: String,
    new_game_dir: String,
) -> Result<Instance, String> {
    with_state(|state| {
        state
            .db
            .duplicate_instance(&id, &new_name, &new_game_dir)
            .map_err(|e| e.to_string())
    })
}

#[command]
pub async fn export_instance_zip(instance_id: String, output_path: String) -> Result<(), String> {
    with_state(|state| {
        let instance = state
            .db
            .get_instance(&instance_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Instance not found".to_string())?;
        let enabled_mod_paths = state
            .db
            .list_mods(&instance_id)
            .map_err(|e| e.to_string())?
            .into_iter()
            .filter(|mod_file| mod_file.enabled)
            .map(|mod_file| std::path::PathBuf::from(mod_file.file_path))
            .collect::<Vec<_>>();

        create_instance_export_zip(
            std::path::Path::new(&instance.game_dir),
            std::path::Path::new(&output_path),
            &enabled_mod_paths,
        )
        .map_err(|e| e.to_string())
    })
}

#[command]
pub async fn import_instance_zip(
    name: String,
    archive_path: String,
    dest_parent: String,
) -> Result<Instance, String> {
    with_state(|state| {
        let dest_dir = format!(
            "{}/{}",
            dest_parent.trim_end_matches(['/', '\\']),
            name.replace(' ', "_")
        );
        import_modpack_zip(
            std::path::Path::new(&archive_path),
            std::path::Path::new(&dest_dir),
        )
        .map_err(|e| e.to_string())?;

        let loader = crate::models::instance::LoaderType::Unknown;
        state
            .db
            .create_instance(CreateInstanceInput {
                name,
                game_dir: dest_dir,
                loader,
                mc_version: None,
            })
            .map_err(|e| e.to_string())
    })
}

#[command]
pub async fn backup_instance(instance_id: String, output_path: String) -> Result<(), String> {
    export_instance_zip(instance_id, output_path).await
}
