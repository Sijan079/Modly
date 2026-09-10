mod commands;
mod configs;
mod models;
mod services;
mod state;

use tauri::Manager;

use commands::categories::{create_category, delete_category, list_categories};
use commands::files::{
    append_log, copy_file, delete_file, get_app_data_dir, hash_file_sha256, list_directory,
    list_logs, move_file, open_in_explorer,
};
use commands::instances::{
    backup_instance, create_instance, delete_instance, duplicate_instance, export_instance_zip,
    export_mods_zip, get_instance, import_instance_zip, list_instances, update_instance,
};
use commands::launcher::{
    detect_java_path, get_launch_config, get_launch_status, launch_instance, save_launch_config,
    stop_instance,
};
use commands::mods::{
    bulk_update_mod_metadata, check_mod_integrity, copy_mod_to_instance, delete_mod,
    delete_mod_suggestion, export_mod_list_html, get_latest_mod_integrity_audit,
    list_instance_relationship_graph, list_mod_relationships, list_mod_suggestions, list_mods,
    parse_mod_metadata, promote_mod_suggestion, reset_mod_metadata, scan_instance_mods,
    set_mod_enabled, toggle_mod_enabled, update_mod_metadata, upsert_mod_suggestion,
};
use commands::packs::{
    list_pack_items, scan_pack_items, toggle_pack_item_enabled, update_pack_item_metadata,
};
use commands::scan::{get_default_minecraft_path, scan_default_minecraft, scan_minecraft_path};
use commands::scout::{
    analyze_scout_target, create_scout_instance_target, create_scout_target,
    discover_scout_candidates, get_latest_scout_analysis, get_scout_recommendations,
    list_scout_targets, search_scout_candidates,
};
use commands::settings::{get_settings, save_settings};
use commands::updates::{
    append_update_log, check_update_target, check_updates, confirm_update_match,
    get_latest_update_check, get_modrinth_project_details, get_modrinth_projects,
    install_suggestion_from_modrinth, list_suggestion_modrinth_versions, list_update_targets,
    save_update_check, update_mod_from_modrinth,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            state::init_state(app.handle())?;
            let launch_window_mode = state::with_state(|s| {
                s.db.get_settings()
                    .map(|settings| settings.launch_window_mode)
                    .map_err(|e| e.to_string())
            })?;
            if let Some(window) = app.get_webview_window("main") {
                match launch_window_mode.as_str() {
                    "fullscreen" => {
                        let _ = window.set_fullscreen(true);
                    }
                    "windowed" => {
                        let _ = window.set_fullscreen(false);
                        let _ = window.unmaximize();
                    }
                    _ => {
                        let _ = window.set_fullscreen(false);
                        let _ = window.maximize();
                    }
                }
            }
            state::with_state(|s| {
                s.db.append_log("info", "Modly started", None)
                    .map_err(|e| e.to_string())
            })?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_default_minecraft_path,
            scan_default_minecraft,
            scan_minecraft_path,
            list_scout_targets,
            create_scout_target,
            create_scout_instance_target,
            analyze_scout_target,
            get_latest_scout_analysis,
            get_scout_recommendations,
            discover_scout_candidates,
            search_scout_candidates,
            list_instances,
            get_instance,
            create_instance,
            update_instance,
            delete_instance,
            duplicate_instance,
            export_instance_zip,
            export_mods_zip,
            import_instance_zip,
            backup_instance,
            list_categories,
            create_category,
            delete_category,
            list_mods,
            list_mod_suggestions,
            scan_instance_mods,
            check_mod_integrity,
            get_latest_mod_integrity_audit,
            parse_mod_metadata,
            set_mod_enabled,
            toggle_mod_enabled,
            delete_mod,
            delete_mod_suggestion,
            update_mod_metadata,
            bulk_update_mod_metadata,
            list_instance_relationship_graph,
            list_mod_relationships,
            upsert_mod_suggestion,
            reset_mod_metadata,
            promote_mod_suggestion,
            copy_mod_to_instance,
            export_mod_list_html,
            list_pack_items,
            scan_pack_items,
            toggle_pack_item_enabled,
            update_pack_item_metadata,
            open_in_explorer,
            hash_file_sha256,
            move_file,
            copy_file,
            delete_file,
            get_app_data_dir,
            list_directory,
            append_log,
            list_logs,
            detect_java_path,
            get_launch_config,
            save_launch_config,
            launch_instance,
            stop_instance,
            get_launch_status,
            // Config commands added with module prefix
            configs::scan_config_tree,
            configs::read_config_file,
            configs::write_config_file,
            configs::create_config_file,
            configs::create_config_folder,
            configs::rename_config_item,
            configs::delete_config_item,
            get_settings,
            save_settings,
            check_updates,
            get_latest_update_check,
            save_update_check,
            list_update_targets,
            check_update_target,
            confirm_update_match,
            update_mod_from_modrinth,
            get_modrinth_projects,
            get_modrinth_project_details,
            list_suggestion_modrinth_versions,
            install_suggestion_from_modrinth,
            append_update_log,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
