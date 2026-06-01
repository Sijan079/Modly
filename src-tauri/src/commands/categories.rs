use tauri::command;

use crate::models::category::{CreateCategoryInput, InstanceCategory};
use crate::state::with_state;

#[command]
pub async fn list_categories(instance_id: String) -> Result<Vec<InstanceCategory>, String> {
    with_state(|state| {
        state
            .db
            .list_categories(&instance_id)
            .map_err(|e| e.to_string())
    })
}

#[command]
pub async fn create_category(input: CreateCategoryInput) -> Result<InstanceCategory, String> {
    with_state(|state| state.db.create_category(input).map_err(|e| e.to_string()))
}

#[command]
pub async fn delete_category(category_id: String) -> Result<(), String> {
    with_state(|state| {
        state
            .db
            .delete_category(&category_id)
            .map_err(|e| e.to_string())
    })
}
