use serde::{Deserialize, Serialize};

use super::instance::LoaderType;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MinecraftScanResult {
    pub minecraft_dir: Option<String>,
    pub detected_paths: Vec<DetectedPath>,
    pub loaders: Vec<DetectedLoader>,
    pub content: ScanContentSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedPath {
    pub path: String,
    pub kind: PathKind,
    pub file_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PathKind {
    MinecraftRoot,
    Mods,
    ResourcePacks,
    ShaderPacks,
    Datapacks,
    Saves,
    Versions,
    Instances,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedLoader {
    pub loader: LoaderType,
    pub version: Option<String>,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ScanContentSummary {
    pub mod_count: u64,
    pub resource_pack_count: u64,
    pub shader_pack_count: u64,
    pub datapack_count: u64,
    pub save_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub phase: String,
    pub current: u64,
    pub total: u64,
    pub message: String,
}
