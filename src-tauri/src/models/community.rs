use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueSource {
    pub instance_id: String,
    pub file_path: String,
    pub project_id: Option<String>,
    pub issue_url: Option<String>,
    pub source_url: Option<String>,
    pub repository: Option<String>,
    pub provider: String,
    pub checked_at: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommunityIssue {
    pub candidate_file_path: String,
    pub number: u64,
    pub title: String,
    pub url: String,
    pub state: String,
    pub updated_at: String,
    pub authority: String,
    #[serde(default)]
    pub duplicate_of: Option<String>,
    pub similarities: Vec<String>,
    pub differences: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommunitySearchResult {
    pub fingerprint: String,
    pub fetched_at: String,
    pub from_cache: bool,
    pub sources: Vec<IssueSource>,
    pub reports: Vec<CommunityIssue>,
    pub warnings: Vec<String>,
}
