use tauri::command;
use uuid::Uuid;

use crate::models::pack_item::{PackItem, PackType, UpdatePackItemMetadataInput};
use crate::state::with_state;

#[command]
pub async fn scan_pack_items(
    instance_id: String,
    pack_type: String,
) -> Result<Vec<PackItem>, String> {
    with_state(|state| {
        let instance = state
            .db
            .get_instance(&instance_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Instance not found".to_string())?;
        let pack_type = PackType::from_str(&pack_type);
        let folder = instance.resolved_pack_path(pack_type);

        if !folder.exists() {
            return Ok(vec![]);
        }

        let entries = std::fs::read_dir(&folder).map_err(|e| e.to_string())?;
        for entry in entries.filter_map(|entry| entry.ok()) {
            let file_type = entry.file_type().map_err(|e| e.to_string())?;
            let file_path = entry.path().to_string_lossy().to_string();
            let file_name = entry.file_name().to_string_lossy().to_string();
            let is_dir = file_type.is_dir();
            let item = PackItem {
                id: Uuid::new_v4().to_string(),
                instance_id: instance_id.clone(),
                pack_type,
                file_name,
                file_path,
                is_dir,
                enabled: true,
                metadata: None,
            };
            state
                .db
                .upsert_pack_item(&item)
                .map_err(|e| e.to_string())?;
        }

        let items = state
            .db
            .list_pack_items(&instance_id, pack_type)
            .map_err(|e| e.to_string())?;
        state
            .db
            .append_log(
                "info",
                &format!(
                    "Scanned {} {} item{}",
                    pack_type_label(pack_type),
                    items.len(),
                    if items.len() == 1 { "" } else { "s" }
                ),
                Some(&instance.name),
            )
            .map_err(|e| e.to_string())?;
        Ok(items)
    })
}

#[command]
pub async fn list_pack_items(
    instance_id: String,
    pack_type: String,
) -> Result<Vec<PackItem>, String> {
    with_state(|state| {
        state
            .db
            .list_pack_items(&instance_id, PackType::from_str(&pack_type))
            .map_err(|e| e.to_string())
    })
}

#[command]
pub async fn toggle_pack_item_enabled(item_id: String, enabled: bool) -> Result<(), String> {
    with_state(|state| {
        let item = state
            .db
            .get_pack_item_by_id(&item_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Pack item not found".to_string())?;
        state
            .db
            .set_pack_item_enabled(&item_id, enabled)
            .map_err(|e| e.to_string())?;
        let instance_name = state
            .db
            .get_instance(&item.instance_id)
            .map_err(|e| e.to_string())?
            .map(|instance| instance.name);
        state
            .db
            .append_log(
                "info",
                &format!(
                    "{} {}: {}",
                    if enabled { "Enabled" } else { "Disabled" },
                    pack_type_label(item.pack_type),
                    item.file_name
                ),
                instance_name.as_deref(),
            )
            .map_err(|e| e.to_string())
    })
}

#[command]
pub async fn update_pack_item_metadata(
    input: UpdatePackItemMetadataInput,
) -> Result<PackItem, String> {
    with_state(|state| {
        let updated = state
            .db
            .update_pack_item_metadata(&input)
            .map_err(|e| e.to_string())?;
        let instance_name = state
            .db
            .get_instance(&updated.instance_id)
            .map_err(|e| e.to_string())?
            .map(|instance| instance.name);
        state
            .db
            .append_log(
                "info",
                &format!(
                    "Updated {} metadata: {}",
                    pack_type_label(updated.pack_type),
                    updated.file_name
                ),
                instance_name.as_deref(),
            )
            .map_err(|e| e.to_string())?;
        Ok(updated)
    })
}

fn pack_type_label(pack_type: PackType) -> &'static str {
    match pack_type {
        PackType::ResourcePack => "resource pack",
        PackType::ShaderPack => "shader pack",
        PackType::Datapack => "datapack",
    }
}
