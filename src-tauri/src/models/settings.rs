use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub minecraft_dir: Option<String>,
    pub instances_dir: Option<String>,
    pub default_java_path: Option<String>,
    pub default_max_memory_mb: u32,
    pub export_modpack_dir: Option<String>,
    pub export_modlist_dir: Option<String>,
    pub auto_scan_on_instance_add: bool,
    pub auto_scan_after_mod_add: bool,
    pub auto_audit_after_scan: bool,
    pub audit_stale_days: u32,
    pub include_disabled_mods_in_exports: bool,
    pub include_audit_in_exports: bool,
    pub theme: String,
    pub last_instance_id: Option<String>,
    /// Reserved for future Modrinth integration
    pub modrinth_enabled: bool,
    /// Reserved for future CurseForge integration
    pub curseforge_enabled: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            minecraft_dir: None,
            instances_dir: None,
            default_java_path: None,
            default_max_memory_mb: 4096,
            export_modpack_dir: None,
            export_modlist_dir: None,
            auto_scan_on_instance_add: true,
            auto_scan_after_mod_add: true,
            auto_audit_after_scan: false,
            audit_stale_days: 7,
            include_disabled_mods_in_exports: false,
            include_audit_in_exports: true,
            theme: "dark".to_string(),
            last_instance_id: None,
            modrinth_enabled: false,
            curseforge_enabled: false,
        }
    }
}
