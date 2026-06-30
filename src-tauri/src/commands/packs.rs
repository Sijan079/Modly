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

        state
            .db
            .list_pack_items(&instance_id, pack_type)
            .map_err(|e| e.to_string())
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
        state
            .db
            .set_pack_item_enabled(&item_id, enabled)
            .map_err(|e| e.to_string())
    })
}

#[command]
pub async fn update_pack_item_metadata(
    input: UpdatePackItemMetadataInput,
) -> Result<PackItem, String> {
    with_state(|state| {
        state
            .db
            .update_pack_item_metadata(&input)
            .map_err(|e| e.to_string())
    })
}
