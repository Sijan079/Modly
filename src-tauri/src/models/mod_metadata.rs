use serde::{Deserialize, Serialize};

use super::category::InstanceCategory;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModFile {
    pub id: String,
    pub instance_id: String,
    pub file_name: String,
    pub file_path: String,
    pub enabled: bool,
    pub hash_sha256: Option<String>,
    pub metadata: Option<ModMetadata>,
    #[serde(default)]
    pub categories: Vec<InstanceCategory>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModIntegrityReport {
    pub mod_id: String,
    pub file_name: String,
    pub file_path: String,
    pub healthy: bool,
    pub status: ModIntegrityStatus,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModIntegrityAudit {
    pub instance_id: String,
    pub audited_at: String,
    pub total_mods: usize,
    pub healthy_mods: usize,
    pub corrupted_mods: usize,
    pub status: ModIntegrityAuditStatus,
    pub reports: Vec<ModIntegrityReport>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ModIntegrityAuditStatus {
    Clean,
    IssuesFound,
}

impl ModIntegrityAuditStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            ModIntegrityAuditStatus::Clean => "clean",
            ModIntegrityAuditStatus::IssuesFound => "issuesFound",
        }
    }

    pub fn from_str(value: &str) -> Self {
        match value {
            "issuesFound" => ModIntegrityAuditStatus::IssuesFound,
            _ => ModIntegrityAuditStatus::Clean,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ModIntegrityStatus {
    Ok,
    Missing,
    Unreadable,
    InvalidArchive,
    EmptyArchive,
    CorruptEntry,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModMetadata {
    pub name: String,
    pub version: String,
    pub authors: Vec<String>,
    /// Link to the mod's Modrinth project page (e.g. https://modrinth.com/mod/sodium).
    #[serde(default, alias = "description")]
    pub modrinth_url: Option<String>,
    pub dependencies: Vec<ModDependency>,
    pub loader: LoaderKind,
    pub mod_id: Option<String>,
    #[serde(default)]
    pub installed_modrinth_version_id: Option<String>,
    /// User-edited metadata; preserved across rescans when true.
    #[serde(default)]
    pub customized: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateModMetadataInput {
    pub mod_id: String,
    pub name: String,
    pub version: String,
    pub authors: Vec<String>,
    pub modrinth_url: Option<String>,
    pub loader: LoaderKind,
    pub mod_id_field: Option<String>,
    #[serde(default)]
    pub installed_modrinth_version_id: Option<String>,
    pub category_ids: Vec<String>,
}

/// Build a default Modrinth project URL from a mod slug/id.
pub fn modrinth_url_from_id(mod_id: &str) -> String {
    let slug = mod_id.trim().trim_start_matches('/');
    format!("https://modrinth.com/mod/{slug}")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModDependency {
    pub mod_id: String,
    pub version_range: Option<String>,
    pub kind: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LoaderKind {
    Fabric,
    Forge,
    NeoForge,
    Quilt,
    Unknown,
}

impl LoaderKind {
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "fabric" => LoaderKind::Fabric,
            "forge" => LoaderKind::Forge,
            "neoforge" => LoaderKind::NeoForge,
            "quilt" => LoaderKind::Quilt,
            _ => LoaderKind::Unknown,
        }
    }
}
