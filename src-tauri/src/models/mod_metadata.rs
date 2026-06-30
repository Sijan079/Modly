use serde::{Deserialize, Serialize};

use super::category::InstanceCategory;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModFile {
    pub id: String,
    pub instance_id: String,
    pub file_name: String,
    pub file_path: String,
    pub installed_at: String,
    pub enabled: bool,
    pub hash_sha256: Option<String>,
    pub source_url: Option<String>,
    pub metadata: Option<ModMetadata>,
    #[serde(default)]
    pub categories: Vec<InstanceCategory>,
    #[serde(default)]
    pub related_mods: Vec<UpdateModRelationshipInput>,
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
    #[serde(default = "default_mod_side")]
    pub side: ModSide,
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
    #[serde(default)]
    pub source_url: Option<String>,
    pub loader: LoaderKind,
    pub side: ModSide,
    pub mod_id_field: Option<String>,
    #[serde(default)]
    pub installed_modrinth_version_id: Option<String>,
    pub category_ids: Vec<String>,
    #[serde(default)]
    pub related_mods: Vec<UpdateModRelationshipInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModSuggestion {
    pub id: String,
    pub instance_id: String,
    pub file_name: String,
    pub file_path: String,
    pub enabled: bool,
    pub hash_sha256: Option<String>,
    pub source_url: Option<String>,
    pub metadata: Option<ModMetadata>,
    #[serde(default)]
    pub categories: Vec<InstanceCategory>,
    #[serde(default)]
    pub related_mods: Vec<UpdateModRelationshipInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertModSuggestionInput {
    #[serde(default)]
    pub id: Option<String>,
    pub instance_id: String,
    pub file_name: String,
    #[serde(default)]
    pub file_path: String,
    #[serde(default = "default_suggestion_enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub hash_sha256: Option<String>,
    #[serde(default)]
    pub source_url: Option<String>,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub authors: Vec<String>,
    pub loader: LoaderKind,
    #[serde(default)]
    pub mod_id_field: Option<String>,
    #[serde(default)]
    pub category_ids: Vec<String>,
}

fn default_suggestion_enabled() -> bool {
    true
}

fn default_mod_side() -> ModSide {
    ModSide::Unknown
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
#[serde(rename_all = "snake_case")]
pub enum ModRelationshipType {
    Dependency,
    AddonFor,
}

impl ModRelationshipType {
    pub fn as_str(self) -> &'static str {
        match self {
            ModRelationshipType::Dependency => "dependency",
            ModRelationshipType::AddonFor => "addon_for",
        }
    }

    pub fn from_str(value: &str) -> Self {
        match value {
            "addon_for" => ModRelationshipType::AddonFor,
            _ => ModRelationshipType::Dependency,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateModRelationshipInput {
    pub target_mod_id: String,
    pub relationship_type: ModRelationshipType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModRelationshipEdge {
    pub id: String,
    pub instance_id: String,
    pub source_mod_id: String,
    pub source_mod_name: String,
    pub target_mod_id: String,
    pub target_mod_name: String,
    pub relationship_type: ModRelationshipType,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModRelationshipsForMod {
    pub mod_id: String,
    pub outgoing: Vec<ModRelationshipEdge>,
    pub incoming: Vec<ModRelationshipEdge>,
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

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ModSide {
    Unknown,
    Client,
    Server,
    Both,
}
