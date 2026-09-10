use tauri::command;

use crate::models::category::{CreateCategoryInput, DeleteCategoryInput, InstanceCategory};
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
    with_state(|state| {
        let category = state.db.create_category(input).map_err(|e| e.to_string())?;
        let instance_name = state
            .db
            .get_instance(&category.instance_id)
            .map_err(|e| e.to_string())?
            .map(|instance| instance.name);
        state
            .db
            .append_log(
                "info",
                &format!("Created category: {}", category.name),
                instance_name.as_deref(),
            )
            .map_err(|e| e.to_string())?;
        Ok(category)
    })
}

#[command]
pub async fn delete_category(input: DeleteCategoryInput) -> Result<(), String> {
    with_state(|state| {
        let category = state
            .db
            .get_category_by_id(&input.category_id)
            .map_err(|e| e.to_string())?;
        state
            .db
            .delete_category(&input)
            .map_err(|e| e.to_string())?;
        if let Some(category) = category {
            let instance_name = state
                .db
                .get_instance(&category.instance_id)
                .map_err(|e| e.to_string())?
                .map(|instance| instance.name);
            state
                .db
                .append_log(
                    "info",
                    &format!("Deleted category: {}", category.name),
                    instance_name.as_deref(),
                )
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    })
}
