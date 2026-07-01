use tauri::command;

use crate::models::instance::{
    CreateInstanceInput, ExportInstanceZipInput, Instance, LoaderType, UpdateInstanceInput,
};
use crate::models::pack_item::PackType;
use crate::services::zip_service::{
    create_instance_export_zip, import_modpack_zip, read_imported_instance_metadata,
};
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
        for folder in ["mods", "resourcepacks", "shaderpacks", "datapacks", "config"] {
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
pub async fn export_instance_zip(input: ExportInstanceZipInput) -> Result<(), String> {
    with_state(|state| {
        let instance = state
            .db
            .get_instance(&input.instance_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Instance not found".to_string())?;
        let enabled_mod_paths = state
            .db
            .list_mods(&input.instance_id)
            .map_err(|e| e.to_string())?
            .into_iter()
            .filter(|mod_file| mod_file.enabled)
            .map(|mod_file| std::path::PathBuf::from(mod_file.file_path))
            .collect::<Vec<_>>();

        let export_options = crate::services::zip_service::InstanceExportOptions {
            include_mods: input.include_mods,
            include_configs: input.include_configs,
            include_resource_packs: input.include_resource_packs,
            include_shader_packs: input.include_shader_packs,
            include_datapacks: input.include_datapacks,
            include_manifest: input.include_manifest,
        };

        let manifest = crate::services::zip_service::InstanceExportManifest {
            format_version: 1,
            instance_name: instance.name.clone(),
            loader: instance.loader.as_str().to_string(),
            minecraft_version: instance.mc_version.clone(),
            sections: export_options.clone(),
            resolved_source_paths: crate::services::zip_service::InstanceExportResolvedPaths {
                mods: std::path::Path::new(&instance.game_dir)
                    .join("mods")
                    .to_string_lossy()
                    .to_string(),
                config: instance.resolved_config_path().to_string_lossy().to_string(),
                resourcepacks: instance
                    .resolved_pack_path(PackType::ResourcePack)
                    .to_string_lossy()
                    .to_string(),
                shaderpacks: instance
                    .resolved_pack_path(PackType::ShaderPack)
                    .to_string_lossy()
                    .to_string(),
                datapacks: instance
                    .resolved_pack_path(PackType::Datapack)
                    .to_string_lossy()
                    .to_string(),
            },
            configured_overrides: crate::services::zip_service::InstanceExportOverrides {
                resource_packs_path: instance.resource_packs_path.clone(),
                shader_packs_path: instance.shader_packs_path.clone(),
                data_packs_path: instance.data_packs_path.clone(),
                config_path: instance.config_path.clone(),
            },
        };

        create_instance_export_zip(
            &instance,
            std::path::Path::new(&input.output_path),
            &enabled_mod_paths,
            &export_options,
            &manifest,
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

        let imported_metadata = read_imported_instance_metadata(std::path::Path::new(&dest_dir))
            .map_err(|e| e.to_string())?;

        let created = state
            .db
            .create_instance(CreateInstanceInput {
                name: imported_metadata
                    .as_ref()
                    .map(|metadata| metadata.name.clone())
                    .unwrap_or(name),
                game_dir: dest_dir.clone(),
                loader: imported_metadata
                    .as_ref()
                    .map(|metadata| LoaderType::from_str(&metadata.loader))
                    .unwrap_or(LoaderType::Unknown),
                mc_version: imported_metadata
                    .as_ref()
                    .and_then(|metadata| metadata.minecraft_version.clone()),
            })
            .map_err(|e| e.to_string())?;

        if let Some(metadata) = imported_metadata {
            return state
                .db
                .update_instance(UpdateInstanceInput {
                    id: created.id,
                    name: None,
                    game_dir: None,
                    loader: None,
                    mc_version: metadata.minecraft_version,
                    resource_packs_path: Some(metadata.resource_packs_path),
                    shader_packs_path: Some(metadata.shader_packs_path),
                    data_packs_path: Some(metadata.data_packs_path),
                    config_path: Some(metadata.config_path),
                })
                .map_err(|e| e.to_string());
        }

        Ok(created)
    })
}

#[command]
pub async fn backup_instance(instance_id: String, output_path: String) -> Result<(), String> {
    export_instance_zip(ExportInstanceZipInput {
        instance_id,
        output_path,
        include_mods: true,
        include_configs: true,
        include_resource_packs: true,
        include_shader_packs: true,
        include_datapacks: true,
        include_manifest: true,
    })
    .await
}
