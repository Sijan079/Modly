use serde::{Deserialize, Serialize};

use super::mod_metadata::{LoaderKind, ModDependency, ModMetadata};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoutTarget {
    pub id: String,
    pub name: String,
    pub mods_path: String,
    pub instance_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateScoutTargetInput {
    pub path: String,
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoutAnalysis {
    pub id: String,
    pub target_id: String,
    pub minecraft_version: Option<String>,
    pub loader: LoaderKind,
    pub scanned_at: String,
    pub total_jars: usize,
    pub parsed_mods: usize,
    pub failed_mods: usize,
    pub mods: Vec<ScoutInstalledMod>,
    pub failures: Vec<ScoutParseFailure>,
    #[serde(default)]
    pub provider_cache_hits: usize,
    #[serde(default)]
    pub provider_fetches: usize,
    #[serde(default)]
    pub provider_warning: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoutInstalledMod {
    pub file_name: String,
    pub file_path: String,
    pub metadata: ModMetadata,
    pub classification: ScoutModClassification,
    #[serde(default)]
    pub hash_sha512: String,
    #[serde(default)]
    pub provider_metadata: Option<ScoutProviderMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoutProviderMetadata {
    pub provider: String,
    pub project_id: String,
    pub slug: String,
    pub title: String,
    pub categories: Vec<String>,
    pub project_url: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ScoutModClassification {
    Gameplay,
    Library,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoutParseFailure {
    pub file_name: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateSearchRequest {
    pub query: String,
    pub minecraft_version: String,
    pub loader: LoaderKind,
    #[serde(default)]
    pub categories: Vec<String>,
    pub limit: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateMod {
    pub project_id: String,
    pub slug: String,
    pub title: String,
    pub description: String,
    pub author: String,
    pub categories: Vec<String>,
    pub supported_versions: Vec<String>,
    pub downloads: u64,
    pub icon_url: Option<String>,
    pub date_modified: String,
    pub project_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateSearchResult {
    pub query: String,
    pub minecraft_version: String,
    pub loader: LoaderKind,
    pub fetched_at: String,
    pub from_cache: bool,
    pub recommendations: Vec<Recommendation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Recommendation {
    pub candidate: CandidateMod,
    pub score: u8,
    pub status: RecommendationStatus,
    pub concerns: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RecommendationStatus {
    Add,
    Consider,
    Skip,
}

pub fn classify_mod(metadata: &ModMetadata) -> ScoutModClassification {
    let value = format!(
        "{} {} {}",
        metadata.name,
        metadata.mod_id.as_deref().unwrap_or_default(),
        metadata.authors.join(" ")
    )
    .to_ascii_lowercase();

    if [
        "library",
        "lib",
        "api",
        "config",
        "framework",
        "core",
        "architectury",
        "cloth",
    ]
    .iter()
    .any(|needle| value.contains(needle))
    {
        ScoutModClassification::Library
    } else if metadata.name_is_fallback || metadata.mod_id.is_none() {
        ScoutModClassification::Unknown
    } else {
        ScoutModClassification::Gameplay
    }
}

pub fn minecraft_dependency_version(dependencies: &[ModDependency]) -> Option<String> {
    dependencies
        .iter()
        .find(|dependency| dependency.mod_id.eq_ignore_ascii_case("minecraft"))
        .and_then(|dependency| dependency.version_range.clone())
        .and_then(|value| {
            let cleaned =
                value.trim_matches(|character| matches!(character, '[' | ']' | '(' | ')'));
            cleaned
                .split(',')
                .next()
                .map(str::trim)
                .filter(|value| value.starts_with("1."))
                .map(str::to_string)
        })
}
