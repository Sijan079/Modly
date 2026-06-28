use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum UpdateItemType {
    Mod,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum UpdateStatus {
    UpdateAvailable,
    UpToDate,
    Unknown,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum UpdateMatchConfidence {
    Exact,
    Candidate,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateFile {
    pub file_name: String,
    pub url: String,
    pub sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCandidate {
    pub project_id: String,
    pub slug: String,
    pub title: String,
    pub project_url: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRow {
    pub item_id: String,
    pub item_type: UpdateItemType,
    pub file_name: String,
    pub file_path: String,
    pub current_version: Option<String>,
    pub latest_version: Option<String>,
    pub latest_version_id: Option<String>,
    pub source: String,
    pub project_id: Option<String>,
    pub project_url: Option<String>,
    pub release_date: Option<String>,
    pub status: UpdateStatus,
    pub match_confidence: UpdateMatchConfidence,
    pub confirmed: bool,
    pub candidates: Vec<UpdateCandidate>,
    pub latest_file: Option<UpdateFile>,
    pub changelog: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedUpdateCheck {
    pub instance_id: String,
    pub checked_at: String,
    pub rows: Vec<UpdateRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTarget {
    pub item_id: String,
    pub item_type: UpdateItemType,
    pub file_name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckUpdateTargetInput {
    pub instance_id: String,
    pub item_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmUpdateMatchInput {
    pub item_id: String,
    pub project_id: String,
    pub project_url: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateModFromModrinthInput {
    pub mod_id: String,
    pub version_id: String,
    pub download_url: String,
    pub file_name: String,
    pub expected_sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestionVersionOption {
    pub version_id: String,
    pub version_number: String,
    pub download_url: String,
    pub file_name: String,
    pub expected_sha256: Option<String>,
    pub release_date: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallSuggestionFromModrinthInput {
    pub suggestion_id: String,
    pub version_id: String,
    pub download_url: String,
    pub file_name: String,
    pub expected_sha256: Option<String>,
}
