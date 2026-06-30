use std::fmt::Write as _;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::Deserialize;
use tauri::command;
use uuid::Uuid;
use zip::ZipArchive;

use crate::models::mod_metadata::{
    ModFile, ModIntegrityAudit, ModIntegrityAuditStatus, ModIntegrityReport, ModIntegrityStatus,
    ModRelationshipsForMod, ModSuggestion, UpdateModMetadataInput, UpsertModSuggestionInput,
};
use crate::services::hash_service::hash_file;
use crate::services::mod_parser::parse_mod_jar;
use crate::services::scanner::scan_mods_directory;
use crate::state::with_state;

#[command]
pub async fn list_mods(instance_id: String) -> Result<Vec<ModFile>, String> {
    with_state(|state| {
        let mods = state.db.list_mods(&instance_id).map_err(|e| e.to_string())?;
        let refreshed = mods
            .into_iter()
            .map(|mut mod_file| {
                if let Some(installed_at) = file_installed_at(Path::new(&mod_file.file_path)) {
                    if mod_file.installed_at != installed_at {
                        mod_file.installed_at = installed_at;
                        state.db.upsert_mod(&mod_file).map_err(|e| e.to_string())?;
                    }
                }
                Ok(mod_file)
            })
            .collect::<Result<Vec<_>, String>>()?;
        Ok(refreshed)
    })
}

#[command]
pub async fn scan_instance_mods(instance_id: String) -> Result<Vec<ModFile>, String> {
    with_state(|state| {
        let instance = state
            .db
            .get_instance(&instance_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Instance not found".to_string())?;

        let mods_dir = Path::new(&instance.game_dir).join("mods");
        let jar_paths = scan_mods_directory(&mods_dir).map_err(|e| e.to_string())?;
        let mut results = Vec::new();

        for jar_path in jar_paths {
            let file_name = jar_path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            let file_path = jar_path.to_string_lossy().to_string();
            let enabled = !file_name.ends_with(".disabled");

            let existing = state
                .db
                .get_mod_by_path(&instance_id, &file_path)
                .map_err(|e| e.to_string())?;

            let metadata = if existing
                .as_ref()
                .and_then(|m| m.metadata.as_ref())
                .map(|m| m.customized)
                .unwrap_or(false)
            {
                existing.as_ref().and_then(|m| m.metadata.clone())
            } else {
                parse_mod_jar(&jar_path).ok()
            };
            let hash_sha256 = hash_file(&jar_path).ok();

            let mod_file = ModFile {
                id: existing
                    .as_ref()
                    .map(|m| m.id.clone())
                    .unwrap_or_else(|| Uuid::new_v4().to_string()),
                instance_id: instance_id.clone(),
                file_name,
                file_path: file_path.clone(),
                installed_at: file_installed_at(&jar_path)
                    .or_else(|| existing.as_ref().map(|m| m.installed_at.clone()))
                    .unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
                enabled,
                hash_sha256,
                source_url: existing.as_ref().and_then(|m| m.source_url.clone()),
                metadata,
                categories: existing
                    .as_ref()
                    .map(|m| m.categories.clone())
                    .unwrap_or_default(),
                related_mods: existing
                    .as_ref()
                    .map(|m| m.related_mods.clone())
                    .unwrap_or_default(),
            };

            state.db.upsert_mod(&mod_file).map_err(|e| e.to_string())?;
            let saved = state
                .db
                .get_mod_by_path(&instance_id, &file_path)
                .map_err(|e| e.to_string())?
                .unwrap_or(mod_file);
            results.push(saved);
        }

        Ok(results)
    })
}

#[command]
pub async fn parse_mod_metadata(
    file_path: String,
) -> Result<crate::models::mod_metadata::ModMetadata, String> {
    parse_mod_jar(Path::new(&file_path)).map_err(|e| e.to_string())
}

#[command]
pub async fn check_mod_integrity(instance_id: String) -> Result<ModIntegrityAudit, String> {
    with_state(|state| {
        let instance = state
            .db
            .get_instance(&instance_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Instance not found".to_string())?;
        let mods = state
            .db
            .list_mods(&instance_id)
            .map_err(|e| e.to_string())?;
        let reports = mods
            .iter()
            .map(check_mod_file_integrity)
            .collect::<Vec<_>>();
        let healthy_mods = reports.iter().filter(|report| report.healthy).count();
        let corrupted_mods = reports.len().saturating_sub(healthy_mods);
        let audit = ModIntegrityAudit {
            instance_id: instance_id.clone(),
            audited_at: chrono::Utc::now().to_rfc3339(),
            total_mods: reports.len(),
            healthy_mods,
            corrupted_mods,
            status: if corrupted_mods == 0 {
                ModIntegrityAuditStatus::Clean
            } else {
                ModIntegrityAuditStatus::IssuesFound
            },
            reports,
        };

        state
            .db
            .save_mod_integrity_audit(&audit)
            .map_err(|e| e.to_string())?;

        let level = if audit.corrupted_mods == 0 {
            "info"
        } else {
            "warn"
        };
        let message = format!(
            "Security audit completed: {} mods checked, {} issue{} found",
            audit.total_mods,
            audit.corrupted_mods,
            if audit.corrupted_mods == 1 { "" } else { "s" }
        );
        state
            .db
            .append_log(level, &message, Some(&instance.name))
            .map_err(|e| e.to_string())?;

        Ok(audit)
    })
}

#[command]
pub async fn get_latest_mod_integrity_audit(
    instance_id: String,
) -> Result<Option<ModIntegrityAudit>, String> {
    with_state(|state| {
        state
            .db
            .get_mod_integrity_audit(&instance_id)
            .map_err(|e| e.to_string())
    })
}

fn check_mod_file_integrity(mod_file: &ModFile) -> ModIntegrityReport {
    let path = Path::new(&mod_file.file_path);

    if !path.exists() {
        return integrity_report(
            mod_file,
            false,
            ModIntegrityStatus::Missing,
            "File is missing from disk.",
        );
    }

    let file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(error) => {
            return integrity_report(
                mod_file,
                false,
                ModIntegrityStatus::Unreadable,
                &format!("Could not open file: {error}"),
            );
        }
    };

    let mut archive = match ZipArchive::new(file) {
        Ok(archive) => archive,
        Err(error) => {
            return integrity_report(
                mod_file,
                false,
                ModIntegrityStatus::InvalidArchive,
                &format!("Invalid jar/zip archive: {error}"),
            );
        }
    };

    if archive.is_empty() {
        return integrity_report(
            mod_file,
            false,
            ModIntegrityStatus::EmptyArchive,
            "Archive has no entries.",
        );
    }

    let mut buffer = Vec::new();
    for index in 0..archive.len() {
        let mut entry = match archive.by_index(index) {
            Ok(entry) => entry,
            Err(error) => {
                return integrity_report(
                    mod_file,
                    false,
                    ModIntegrityStatus::CorruptEntry,
                    &format!("Could not read archive entry #{index}: {error}"),
                );
            }
        };

        if entry.is_dir() {
            continue;
        }

        buffer.clear();
        if let Err(error) = entry.read_to_end(&mut buffer) {
            return integrity_report(
                mod_file,
                false,
                ModIntegrityStatus::CorruptEntry,
                &format!("Corrupt archive entry '{}': {error}", entry.name()),
            );
        }
    }

    integrity_report(
        mod_file,
        true,
        ModIntegrityStatus::Ok,
        "Archive opened and all entries were readable.",
    )
}

fn integrity_report(
    mod_file: &ModFile,
    healthy: bool,
    status: ModIntegrityStatus,
    message: &str,
) -> ModIntegrityReport {
    ModIntegrityReport {
        mod_id: mod_file.id.clone(),
        file_name: mod_file.file_name.clone(),
        file_path: mod_file.file_path.clone(),
        healthy,
        status,
        message: message.to_string(),
    }
}

#[command]
pub async fn set_mod_enabled(mod_id: String, enabled: bool) -> Result<(), String> {
    with_state(|state| {
        state
            .db
            .set_mod_enabled(&mod_id, enabled)
            .map_err(|e| e.to_string())
    })
}

#[command]
pub async fn toggle_mod_enabled(
    instance_id: String,
    mod_id: String,
    enabled: bool,
) -> Result<(), String> {
    with_state(|state| {
        let mod_list = state
            .db
            .list_mods(&instance_id)
            .map_err(|e| e.to_string())?;
        let mod_file = mod_list
            .into_iter()
            .find(|m| m.id == mod_id)
            .ok_or_else(|| "Mod not found".to_string())?;

        let path = Path::new(&mod_file.file_path);
        let disabled_path = path.with_extension("jar.disabled");

        if enabled {
            if path.extension().map(|e| e == "disabled").unwrap_or(false) {
                let enabled_path = path.with_file_name(
                    path.file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("")
                        .trim_end_matches(".disabled"),
                );
                if path.exists() {
                    std::fs::rename(&path, &enabled_path).map_err(|e| e.to_string())?;
                }
            } else if disabled_path.exists() {
                std::fs::rename(&disabled_path, path).map_err(|e| e.to_string())?;
            }
        } else {
            let target = format!("{}.disabled", mod_file.file_path);
            if path.exists() && !mod_file.file_path.ends_with(".disabled") {
                std::fs::rename(path, &target).map_err(|e| e.to_string())?;
            }
        }

        state
            .db
            .set_mod_enabled(&mod_id, enabled)
            .map_err(|e| e.to_string())
    })
}

#[command]
pub async fn delete_mod(mod_id: String) -> Result<(), String> {
    with_state(|state| {
        let mod_file = state
            .db
            .get_mod_by_id(&mod_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Mod not found".to_string())?;

        let path = Path::new(&mod_file.file_path);
        if path.exists() {
            std::fs::remove_file(path).map_err(|e| e.to_string())?;
        }

        state.db.delete_mod(&mod_id).map_err(|e| e.to_string())
    })
}

#[command]
pub async fn update_mod_metadata(input: UpdateModMetadataInput) -> Result<ModFile, String> {
    with_state(|state| {
        state
            .db
            .update_mod_metadata(&input)
            .map_err(|e| e.to_string())
    })
}

#[command]
pub async fn list_mod_relationships(mod_id: String) -> Result<ModRelationshipsForMod, String> {
    with_state(|state| {
        state
            .db
            .get_mod_relationships(&mod_id)
            .map_err(|e| e.to_string())
    })
}

#[command]
pub async fn reset_mod_metadata(mod_id: String) -> Result<ModFile, String> {
    with_state(|state| {
        let existing = state
            .db
            .get_mod_by_id(&mod_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Mod not found".to_string())?;

        let path = Path::new(&existing.file_path);
        let mut metadata = parse_mod_jar(path).ok();
        if let Some(ref mut m) = metadata {
            m.customized = false;
        }
        let updated = ModFile {
            metadata,
            ..existing
        };
        state.db.upsert_mod(&updated).map_err(|e| e.to_string())?;
        state
            .db
            .get_mod_by_id(&mod_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Mod not found after reset".to_string())
    })
}

#[command]
pub async fn copy_mod_to_instance(
    source_path: String,
    target_instance_id: String,
) -> Result<ModFile, String> {
    with_state(|state| {
        let instance = state
            .db
            .get_instance(&target_instance_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Instance not found".to_string())?;

        let source = Path::new(&source_path);
        let file_name = source
            .file_name()
            .ok_or_else(|| "Invalid source path".to_string())?;
        let dest = Path::new(&instance.game_dir).join("mods").join(file_name);
        std::fs::create_dir_all(dest.parent().unwrap()).map_err(|e| e.to_string())?;
        std::fs::copy(source, &dest).map_err(|e| e.to_string())?;

        let metadata = parse_mod_jar(&dest).ok();
        let hash_sha256 = hash_file(&dest).ok();

        let mod_file = ModFile {
            id: Uuid::new_v4().to_string(),
            instance_id: target_instance_id,
            file_name: file_name.to_string_lossy().to_string(),
            file_path: dest.to_string_lossy().to_string(),
            installed_at: file_installed_at(&dest).unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
            enabled: true,
            hash_sha256,
            source_url: None,
            metadata,
            categories: vec![],
            related_mods: vec![],
        };

        state.db.upsert_mod(&mod_file).map_err(|e| e.to_string())?;
        Ok(mod_file)
    })
}

#[command]
pub async fn promote_mod_suggestion(suggestion_id: String) -> Result<ModFile, String> {
    with_state(|state| {
        let suggestion = state
            .db
            .get_mod_suggestion_by_id(&suggestion_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Suggestion not found".to_string())?;

        if suggestion.file_path.trim().is_empty() {
            return Err("Suggestion has no downloaded file attached".to_string());
        }

        let instance = state
            .db
            .get_instance(&suggestion.instance_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Instance not found".to_string())?;

        let source = Path::new(&suggestion.file_path);
        if !source.exists() {
            return Err("Downloaded file could not be found".to_string());
        }

        let file_name = source
            .file_name()
            .ok_or_else(|| "Invalid suggestion file path".to_string())?;
        let dest = Path::new(&instance.game_dir).join("mods").join(file_name);
        std::fs::create_dir_all(dest.parent().unwrap()).map_err(|e| e.to_string())?;
        std::fs::copy(source, &dest).map_err(|e| e.to_string())?;

        let metadata = suggestion.metadata.clone().or_else(|| parse_mod_jar(&dest).ok());
        let hash_sha256 = hash_file(&dest).ok();
        let mod_file = ModFile {
            id: Uuid::new_v4().to_string(),
            instance_id: suggestion.instance_id.clone(),
            file_name: file_name.to_string_lossy().to_string(),
            file_path: dest.to_string_lossy().to_string(),
            installed_at: file_installed_at(&dest).unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
            enabled: true,
            hash_sha256,
            source_url: suggestion.source_url.clone(),
            metadata,
            categories: suggestion.categories.clone(),
            related_mods: vec![],
        };

        state.db.upsert_mod(&mod_file).map_err(|e| e.to_string())?;
        let saved = state
            .db
            .get_mod_by_path(&suggestion.instance_id, &mod_file.file_path)
            .map_err(|e| e.to_string())?
            .unwrap_or(mod_file);
        state
            .db
            .delete_mod_suggestion(&suggestion_id)
            .map_err(|e| e.to_string())?;
        Ok(saved)
    })
}

fn file_installed_at(path: &Path) -> Option<String> {
    let metadata = std::fs::metadata(path).ok()?;
    let system_time = metadata
        .created()
        .ok()
        .or_else(|| metadata.modified().ok())
        .unwrap_or(SystemTime::now());
    Some(chrono::DateTime::<chrono::Utc>::from(system_time).to_rfc3339())
}

#[command]
pub async fn list_mod_suggestions(instance_id: String) -> Result<Vec<ModSuggestion>, String> {
    with_state(|state| {
        state
            .db
            .list_mod_suggestions(&instance_id)
            .map_err(|e| e.to_string())
    })
}

#[command]
pub async fn upsert_mod_suggestion(
    input: UpsertModSuggestionInput,
) -> Result<ModSuggestion, String> {
    with_state(|state| {
        if input.instance_id.trim().is_empty() {
            return Err("Instance is required".to_string());
        }
        if input.name.trim().is_empty() && input.file_name.trim().is_empty() {
            return Err("Mod name is required".to_string());
        }
        state
            .db
            .upsert_mod_suggestion(&input)
            .map_err(|e| e.to_string())
    })
}

#[command]
pub async fn delete_mod_suggestion(id: String) -> Result<(), String> {
    with_state(|state| {
        state
            .db
            .delete_mod_suggestion(&id)
            .map_err(|e| e.to_string())
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportModListInput {
    pub instance_name: String,
    pub applied_search: String,
    pub status_filter: String,
    pub loader_filter: String,
    pub side_filter: String,
    pub category_filter: Option<String>,
    pub total_count: usize,
    pub mods: Vec<ModFile>,
    pub output_path: String,
}

#[command]
pub async fn export_mod_list_html(input: ExportModListInput) -> Result<(), String> {
    let output_path = PathBuf::from(&input.output_path);
    let css_path = output_path.with_extension("css");

    let html = build_mod_list_html(&input, &css_path);
    let css = build_mod_list_css();

    std::fs::write(&output_path, html).map_err(|e| e.to_string())?;
    std::fs::write(&css_path, css).map_err(|e| e.to_string())?;

    Ok(())
}

fn build_mod_list_html(input: &ExportModListInput, css_path: &Path) -> String {
    let generated_at = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let css_name = css_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("modlist.css");
    let enabled_mods: Vec<&ModFile> = input
        .mods
        .iter()
        .filter(|mod_file| mod_file.enabled)
        .collect();
    let mut grouped_mods: Vec<(String, Vec<&ModFile>)> = Vec::new();

    for mod_file in &enabled_mods {
        let category_names: Vec<String> = if mod_file.categories.is_empty() {
            vec!["Uncategorized".to_string()]
        } else {
            mod_file
                .categories
                .iter()
                .map(|category| category.name.clone())
                .collect()
        };

        for category_name in category_names {
            if let Some((_, mods)) = grouped_mods
                .iter_mut()
                .find(|(existing, _)| existing == &category_name)
            {
                mods.push(*mod_file);
            } else {
                grouped_mods.push((category_name, vec![*mod_file]));
            }
        }
    }

    grouped_mods.sort_by(|a, b| a.0.to_lowercase().cmp(&b.0.to_lowercase()));

    let mut sections = String::new();
    for (category_name, mods) in grouped_mods {
        let mut items = String::new();
        let mut sorted_mods = mods;
        sorted_mods.sort_by_key(|mod_file| mod_display_name(mod_file).to_lowercase());

        for mod_file in sorted_mods {
            let name = mod_display_name(mod_file);
            let version = mod_file
                .metadata
                .as_ref()
                .map(|meta| meta.version.as_str())
                .filter(|value| !value.trim().is_empty())
                .unwrap_or("N/A");
            let loader = mod_file
                .metadata
                .as_ref()
                .map(|meta| format_loader_label(meta.loader))
                .unwrap_or("Unknown");
            let side = mod_file
                .metadata
                .as_ref()
                .map(|meta| format_side_label(meta.side))
                .unwrap_or("Both");
            let authors = mod_file
                .metadata
                .as_ref()
                .map(|meta| join_or_fallback(&meta.authors, "Unknown"))
                .unwrap_or_else(|| "Unknown".to_string());
            let href = mod_file
                .source_url
                .clone()
                .or_else(|| {
                    mod_file
                        .metadata
                        .as_ref()
                        .and_then(|meta| meta.modrinth_url.clone())
                })
                .unwrap_or_else(|| modrinth_search_url(&name));

            let _ = write!(
                items,
                "<li>\
                    <a href=\"{}\" target=\"_blank\" rel=\"noreferrer\">{}</a>\
                    <div class=\"meta\">{} · {} · {} · {}</div>\
                </li>",
                escape_html(&href),
                escape_html(&name),
                escape_html(version),
                escape_html(loader),
                escape_html(side),
                escape_html(&authors)
            );
        }

        let _ = write!(
            sections,
            "<section class=\"category-section\">\
                <h2>{}</h2>\
                <ul>{}</ul>\
            </section>",
            escape_html(&category_name),
            items
        );
    }

    format!(
        "<!DOCTYPE html>\
<html lang=\"en\">\
<head>\
  <meta charset=\"utf-8\" />\
  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />\
  <title>{instance} Mod List</title>\
  <link rel=\"stylesheet\" href=\"{css}\" />\
</head>\
<body>\
  <main class=\"page\">\
    <h1>{instance} Mod List</h1>\
    <div class=\"summary\">\
      <h3>Enabled Mods Exported: {shown}</h3>\
      <p>From {total} total mods · Generated {generated}</p>\
      <p>Search: {search} · Status: {status} · Loader: {loader} · Side: {side} · Category: {category}</p>\
    </div>\
    {sections}\
  </main>\
</body>\
</html>",
        instance = escape_html(&input.instance_name),
        css = escape_html(css_name),
        shown = enabled_mods.len(),
        total = input.total_count,
        generated = escape_html(&generated_at),
        search = escape_html(if input.applied_search.trim().is_empty() {
            "None"
        } else {
            input.applied_search.as_str()
        }),
        status = escape_html(&input.status_filter),
        loader = escape_html(&input.loader_filter),
        side = escape_html(&input.side_filter),
        category = escape_html(input.category_filter.as_deref().unwrap_or("All categories")),
        sections = sections
    )
}

fn build_mod_list_css() -> &'static str {
    r#":root {
  color-scheme: dark;
  --bg: #1e1e2e;
  --panel: #313244;
  --panel-hover: #45475a;
  --border: #313244;
  --text: #cdd6f4;
  --title: #89b4fa;
  --section: #f38ba8;
  --link: #89dceb;
  --link-hover: #f9e2af;
  --meta: #a6adc8;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background-color: var(--bg);
  color: var(--text);
  line-height: 1.6;
  padding: 20px;
  max-width: 1000px;
  margin: 0 auto;
  font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
}

.page {
  width: 100%;
}

h1 {
  margin: 0;
  color: var(--title);
  border-bottom: 2px solid var(--border);
  padding-bottom: 10px;
}

.summary {
  margin: 18px 0 24px;
}

.summary h3 {
  color: #a6e3a1;
  margin: 0 0 8px;
}

.summary p {
  margin: 4px 0;
  color: var(--meta);
}

.category-section + .category-section {
  margin-top: 30px;
}

h2 {
  color: var(--section);
  margin-top: 30px;
  margin-bottom: 12px;
}

ul {
  list-style-type: none;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 10px;
}

li {
  background-color: var(--panel);
  border-radius: 6px;
  padding: 10px;
  transition: transform 0.2s ease, background-color 0.2s ease;
}

a {
  color: var(--link);
  text-decoration: none;
  display: block;
  font-weight: bold;
}

a:hover {
  color: var(--link-hover);
}

li:hover {
  transform: translateY(-3px);
  background-color: var(--panel-hover);
}

.meta {
  margin-top: 6px;
  color: var(--meta);
  font-size: 12px;
}

@media (max-width: 640px) {
  body {
    padding: 14px;
  }

  ul {
    grid-template-columns: 1fr;
  }
}"#
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn join_or_fallback(values: &[String], fallback: &str) -> String {
    if values.is_empty() {
        fallback.to_string()
    } else {
        values.join(", ")
    }
}

fn format_loader_label(loader: crate::models::mod_metadata::LoaderKind) -> &'static str {
    match loader {
        crate::models::mod_metadata::LoaderKind::Fabric => "Fabric",
        crate::models::mod_metadata::LoaderKind::Forge => "Forge",
        crate::models::mod_metadata::LoaderKind::NeoForge => "NeoForge",
        crate::models::mod_metadata::LoaderKind::Quilt => "Quilt",
        crate::models::mod_metadata::LoaderKind::Unknown => "Unknown",
    }
}

fn format_side_label(side: crate::models::mod_metadata::ModSide) -> &'static str {
    match side {
        crate::models::mod_metadata::ModSide::Unknown => "",
        crate::models::mod_metadata::ModSide::Client => "Client",
        crate::models::mod_metadata::ModSide::Server => "Server",
        crate::models::mod_metadata::ModSide::Both => "Both",
    }
}

fn mod_display_name(mod_file: &ModFile) -> String {
    mod_file
        .metadata
        .as_ref()
        .map(|meta| meta.name.clone())
        .unwrap_or_else(|| mod_file.file_name.clone())
}

fn modrinth_search_url(name: &str) -> String {
    let encoded = name
        .replace('%', "%25")
        .replace(' ', "%20")
        .replace('&', "%26")
        .replace('+', "%2B")
        .replace('\'', "%27")
        .replace(':', "%3A")
        .replace('/', "%2F")
        .replace('?', "%3F")
        .replace('=', "%3D");
    format!("https://modrinth.com/discover/mods?q={encoded}")
}
