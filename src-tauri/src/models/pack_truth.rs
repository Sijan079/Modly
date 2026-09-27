use serde::Serialize;

use super::category::InstanceCategory;
use super::mod_metadata::{ModMetadata, ModSide, UpdateModRelationshipInput};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackTruth {
    pub instance_id: String,
    pub mods: Vec<ObservedMod>,
    pub relationships: Vec<DeclaredRelationship>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObservedMod {
    pub file_name: String,
    pub file_path: String,
    pub enabled: bool,
    pub hash_sha256: Option<String>,
    pub manifest_path: Option<String>,
    pub parse_status: ParseStatus,
    pub parse_error: Option<String>,
    pub observed: Option<ModMetadata>,
    pub minecraft_constraints: Vec<String>,
    pub provider_enrichment: Option<ProviderEnrichment>,
    pub user_annotation: Option<UserAnnotation>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ParseStatus {
    Parsed,
    MissingManifest,
    ParseFailed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderEnrichment {
    pub provider: String,
    pub name: String,
    pub version: String,
    pub project_url: Option<String>,
    pub version_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserAnnotation {
    pub metadata: Option<ModMetadata>,
    pub categories: Vec<InstanceCategory>,
    pub relationships: Vec<UpdateModRelationshipInput>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeclaredRelationship {
    pub source_file_path: String,
    pub target_mod_id: String,
    pub target_file_path: Option<String>,
    pub kind: String,
    pub version_range: Option<String>,
    pub side: Option<ModSide>,
    pub manifest_path: String,
    pub resolution: RelationshipResolution,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RelationshipResolution {
    Installed,
    Missing,
    Ambiguous,
    External,
    Embedded,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackArchiveIssue {
    pub file_path: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModTruthRelationships {
    pub file_path: String,
    pub outgoing: Vec<DeclaredRelationship>,
    pub incoming: Vec<DeclaredRelationship>,
    pub required_dependency_paths: Vec<Vec<String>>,
    pub required_dependent_paths: Vec<Vec<String>>,
}

impl PackTruth {
    pub fn relationships_for(&self, file_path: &str) -> ModTruthRelationships {
        ModTruthRelationships {
            file_path: file_path.to_string(),
            outgoing: self
                .relationships
                .iter()
                .filter(|edge| edge.source_file_path == file_path)
                .cloned()
                .collect(),
            incoming: self
                .relationships
                .iter()
                .filter(|edge| edge.target_file_path.as_deref() == Some(file_path))
                .cloned()
                .collect(),
            required_dependency_paths: self.required_paths(file_path, false),
            required_dependent_paths: self.required_paths(file_path, true),
        }
    }

    fn required_paths(&self, file_path: &str, reverse: bool) -> Vec<Vec<String>> {
        use std::collections::{HashSet, VecDeque};

        let mut visited = HashSet::from([file_path.to_string()]);
        let mut pending = VecDeque::from([vec![file_path.to_string()]]);
        let mut paths = Vec::new();
        while let Some(path) = pending.pop_front() {
            let current = path.last().expect("path always has a start");
            let mut neighbors = self
                .relationships
                .iter()
                .filter(|edge| {
                    edge.kind == "required" && edge.resolution == RelationshipResolution::Installed
                })
                .filter_map(|edge| {
                    if reverse {
                        (edge.target_file_path.as_deref() == Some(current.as_str()))
                            .then_some(edge.source_file_path.clone())
                    } else {
                        (edge.source_file_path == *current)
                            .then(|| edge.target_file_path.clone())
                            .flatten()
                    }
                })
                .collect::<Vec<_>>();
            neighbors.sort();
            for neighbor in neighbors {
                if visited.insert(neighbor.clone()) {
                    let mut next_path = path.clone();
                    next_path.push(neighbor);
                    pending.push_back(next_path.clone());
                    paths.push(next_path);
                }
            }
        }
        paths
    }
}
