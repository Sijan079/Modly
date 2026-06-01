use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackItem {
    pub id: String,
    pub instance_id: String,
    pub pack_type: PackType,
    pub file_name: String,
    pub file_path: String,
    pub is_dir: bool,
    pub enabled: bool,
    pub metadata: Option<PackItemMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackItemMetadata {
    pub display_name: String,
    pub author: String,
    pub website_url: Option<String>,
    pub notes: String,
    #[serde(default)]
    pub customized: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PackType {
    ResourcePack,
    ShaderPack,
}

impl PackType {
    pub fn from_str(value: &str) -> Self {
        match value {
            "shaderPack" => Self::ShaderPack,
            _ => Self::ResourcePack,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::ResourcePack => "resourcePack",
            Self::ShaderPack => "shaderPack",
        }
    }

    pub fn folder_name(&self) -> &'static str {
        match self {
            Self::ResourcePack => "resourcepacks",
            Self::ShaderPack => "shaderpacks",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePackItemMetadataInput {
    pub item_id: String,
    pub display_name: String,
    pub author: String,
    pub website_url: Option<String>,
    pub notes: String,
}
