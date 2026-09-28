use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashAnalysis {
    pub fingerprint: String,
    pub instance_id: String,
    pub source_path: String,
    pub analyzed_at: String,
    pub exception_type: Option<String>,
    pub exception_message: Option<String>,
    pub stack_frames: Vec<String>,
    pub stack_namespaces: Vec<String>,
    pub unmapped_frames: Vec<String>,
    pub mentioned_mod_ids: Vec<String>,
    pub minecraft_version: Option<String>,
    #[serde(default)]
    pub loader: Option<String>,
    pub loader_version: Option<String>,
    pub environment: Vec<CrashEnvironmentEntry>,
    pub candidates: Vec<CrashCandidate>,
    pub recent_changes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashEnvironmentEntry {
    pub label: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashCandidate {
    pub file_path: String,
    pub name: String,
    pub evidence: Vec<String>,
}
