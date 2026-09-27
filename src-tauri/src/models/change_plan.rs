use serde::{Deserialize, Serialize};

use super::mod_metadata::{ModFile, ModMetadata, ModSuggestion};
use super::pack_truth::PackTruth;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ChangeKind {
    Add,
    Update,
    Remove,
    Replace,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeRequest {
    pub kind: ChangeKind,
    pub instance_id: String,
    pub target_mod_id: Option<String>,
    pub source_path: Option<String>,
    pub download_url: Option<String>,
    pub file_name: Option<String>,
    pub expected_sha256: Option<String>,
    pub version_id: Option<String>,
    pub suggestion_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangePlan {
    pub id: String,
    pub kind: ChangeKind,
    pub instance_id: String,
    pub old_file_path: Option<String>,
    pub new_file_path: Option<String>,
    pub source_sha256: Option<String>,
    pub candidate: Option<ModMetadata>,
    pub truth: PackTruth,
    pub direct_dependents: Vec<String>,
    pub transitive_dependents: Vec<Vec<String>>,
    pub backup_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeApplyResult {
    pub instance_id: String,
    pub kind: ChangeKind,
    pub verified: bool,
    pub backup_id: Option<String>,
    pub mod_file: Option<ModFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualEdgeBackup {
    pub source_mod_id: String,
    pub target_mod_id: String,
    pub relationship_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeBackup {
    pub id: String,
    pub instance_id: String,
    pub kind: ChangeKind,
    pub created_at: String,
    pub status: String,
    pub old_file_path: Option<String>,
    pub new_file_path: Option<String>,
    pub old_mod: Option<ModFile>,
    pub new_mod: Option<ModFile>,
    pub suggestion: Option<ModSuggestion>,
    pub manual_edges: Vec<ManualEdgeBackup>,
    pub old_sha256: Option<String>,
    pub new_sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeRestoreResult {
    pub instance_id: String,
    pub backup_id: String,
    pub verified: bool,
    pub warnings: Vec<String>,
}
