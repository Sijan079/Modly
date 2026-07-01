use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use super::pack_item::PackType;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Instance {
    pub id: String,
    pub name: String,
    pub game_dir: String,
    pub loader: LoaderType,
    pub mc_version: Option<String>,
    pub icon: Option<String>,
    pub resource_packs_path: Option<String>,
    pub shader_packs_path: Option<String>,
    pub data_packs_path: Option<String>,
    pub config_path: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub mod_count: i64,
    pub enabled_mod_count: i64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LoaderType {
    Vanilla,
    Fabric,
    Forge,
    NeoForge,
    Quilt,
    Unknown,
}

impl LoaderType {
    pub fn as_str(&self) -> &'static str {
        match self {
            LoaderType::Vanilla => "vanilla",
            LoaderType::Fabric => "fabric",
            LoaderType::Forge => "forge",
            LoaderType::NeoForge => "neoforge",
            LoaderType::Quilt => "quilt",
            LoaderType::Unknown => "unknown",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "vanilla" => LoaderType::Vanilla,
            "fabric" => LoaderType::Fabric,
            "forge" => LoaderType::Forge,
            "neoforge" => LoaderType::NeoForge,
            "quilt" => LoaderType::Quilt,
            _ => LoaderType::Unknown,
        }
    }
}

impl Instance {
    pub fn resolved_pack_path(&self, pack_type: PackType) -> PathBuf {
        match pack_type {
            PackType::ResourcePack => self
                .resource_packs_path
                .as_deref()
                .map(PathBuf::from)
                .unwrap_or_else(|| Path::new(&self.game_dir).join("resourcepacks")),
            PackType::ShaderPack => self
                .shader_packs_path
                .as_deref()
                .map(PathBuf::from)
                .unwrap_or_else(|| Path::new(&self.game_dir).join("shaderpacks")),
            PackType::Datapack => self
                .data_packs_path
                .as_deref()
                .map(PathBuf::from)
                .unwrap_or_else(|| Path::new(&self.game_dir).join("datapacks")),
        }
    }

    pub fn resolved_config_path(&self) -> PathBuf {
        self.config_path
            .as_deref()
            .map(PathBuf::from)
            .unwrap_or_else(|| Path::new(&self.game_dir).join("config"))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateInstanceInput {
    pub name: String,
    pub game_dir: String,
    pub loader: LoaderType,
    pub mc_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInstanceInput {
    pub id: String,
    pub name: Option<String>,
    pub game_dir: Option<String>,
    pub loader: Option<LoaderType>,
    pub mc_version: Option<String>,
    pub resource_packs_path: Option<Option<String>>,
    pub shader_packs_path: Option<Option<String>>,
    pub data_packs_path: Option<Option<String>>,
    pub config_path: Option<Option<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportInstanceZipInput {
    pub instance_id: String,
    pub output_path: String,
    pub include_mods: bool,
    pub include_configs: bool,
    pub include_resource_packs: bool,
    pub include_shader_packs: bool,
    pub include_datapacks: bool,
    pub include_manifest: bool,
}

#[cfg(test)]
mod tests {
    use super::{Instance, LoaderType};
    use crate::models::pack_item::PackType;

    fn instance() -> Instance {
        Instance {
            id: "id".to_string(),
            name: "name".to_string(),
            game_dir: "C:\\packs\\base".to_string(),
            loader: LoaderType::Fabric,
            mc_version: Some("1.20.1".to_string()),
            icon: None,
            resource_packs_path: None,
            shader_packs_path: None,
            data_packs_path: Some("D:\\custom\\datapacks".to_string()),
            config_path: Some("D:\\custom\\config".to_string()),
            created_at: "now".to_string(),
            updated_at: "now".to_string(),
            mod_count: 0,
            enabled_mod_count: 0,
        }
    }

    #[test]
    fn resolves_custom_datapack_and_config_paths() {
        let instance = instance();
        assert_eq!(
            instance.resolved_pack_path(PackType::Datapack).to_string_lossy(),
            "D:\\custom\\datapacks"
        );
        assert_eq!(
            instance.resolved_config_path().to_string_lossy(),
            "D:\\custom\\config"
        );
        assert_eq!(
            instance
                .resolved_pack_path(PackType::ResourcePack)
                .to_string_lossy(),
            "C:\\packs\\base\\resourcepacks"
        );
    }
}
