use anyhow::{Context, Result};
use reqwest::Client;
use serde::Deserialize;

use crate::models::instance::Instance;
use crate::models::mod_metadata::{LoaderKind, ModFile};
use crate::models::updates::{
    SuggestionVersionOption, UpdateCandidate, UpdateFile, UpdateItemType, UpdateMatchConfidence,
    UpdateRow, UpdateStatus,
};

const MODRINTH_API: &str = "https://api.modrinth.com/v2";

pub struct UpdateService {
    client: Client,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MatchSource {
    SavedMetadata,
    Hash,
    SearchFallback,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MatchClassification {
    pub confidence: UpdateMatchConfidence,
    pub confirmed: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ModrinthVersion {
    pub id: String,
    pub project_id: String,
    pub version_number: String,
    pub date_published: String,
    #[serde(default)]
    pub changelog: Option<String>,
    pub game_versions: Vec<String>,
    pub loaders: Vec<String>,
    pub files: Vec<ModrinthFile>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ModrinthFile {
    pub url: String,
    pub filename: String,
    pub hashes: ModrinthHashes,
    #[serde(default)]
    pub primary: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ModrinthHashes {
    #[serde(default)]
    pub sha256: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct ModrinthSearchResponse {
    hits: Vec<ModrinthSearchHit>,
}

#[derive(Debug, Clone, Deserialize)]
struct ModrinthSearchHit {
    project_id: String,
    slug: String,
    title: String,
}

impl Default for UpdateService {
    fn default() -> Self {
        Self {
            client: Client::builder()
                .user_agent("ModpackManager/0.1.0 (local update checker)")
                .build()
                .expect("valid Modrinth HTTP client"),
        }
    }
}

impl UpdateService {
    pub async fn compatible_versions_for_project(
        &self,
        project_id: &str,
        mc_version: Option<&str>,
        loader: Option<&str>,
    ) -> Result<Vec<SuggestionVersionOption>> {
        let versions = self.project_versions(project_id).await?;
        let loader = loader.map(|value| value.to_ascii_lowercase());
        let mut compatible = versions
            .into_iter()
            .filter(|version| {
                mc_version
                    .map(|mc| version.game_versions.iter().any(|value| value == mc))
                    .unwrap_or(true)
            })
            .filter(|version| {
                loader
                    .as_deref()
                    .filter(|value| *value != "unknown" && !value.is_empty())
                    .map(|loader| {
                        version
                            .loaders
                            .iter()
                            .any(|value| value.eq_ignore_ascii_case(loader))
                    })
                    .unwrap_or(true)
            })
            .filter_map(|version| {
                version.primary_file().map(|file| SuggestionVersionOption {
                    version_id: version.id.clone(),
                    version_number: version.version_number.clone(),
                    download_url: file.url.clone(),
                    file_name: file.filename.clone(),
                    expected_sha256: file.hashes.sha256.clone(),
                    release_date: version.date_published.clone(),
                })
            })
            .collect::<Vec<_>>();
        compatible.sort_by(|a, b| b.release_date.cmp(&a.release_date));
        Ok(compatible)
    }

    pub async fn check_instance(&self, instance: &Instance, mods: &[ModFile]) -> Vec<UpdateRow> {
        let mut rows = Vec::new();
        for item in mods {
            rows.push(self.check_mod(instance, item).await);
        }
        rows
    }

    async fn check_mod(&self, instance: &Instance, item: &ModFile) -> UpdateRow {
        let metadata = item.metadata.as_ref();
        let current_version = metadata.map(|meta| meta.version.clone());
        let installed_version_id =
            metadata.and_then(|meta| meta.installed_modrinth_version_id.clone());
        let saved_project = metadata
            .and_then(|meta| meta.modrinth_url.as_deref())
            .and_then(extract_modrinth_project_id);
        let loader = metadata
            .map(|meta| loader_kind_to_modrinth(meta.loader))
            .or_else(|| Some(instance.loader.as_str().to_string()));

        match self
            .resolve_project(
                saved_project,
                item.hash_sha256.as_deref(),
                &item.file_name,
                "mod",
            )
            .await
        {
            Ok(Some((project_id, source, candidates))) => {
                self.row_for_project(
                    item.id.clone(),
                    UpdateItemType::Mod,
                    item.file_name.clone(),
                    item.file_path.clone(),
                    current_version,
                    installed_version_id,
                    project_id,
                    source,
                    candidates,
                    instance.mc_version.as_deref(),
                    loader.as_deref(),
                )
                .await
            }
            Ok(None) => unknown_row(
                item.id.clone(),
                UpdateItemType::Mod,
                item.file_name.clone(),
                item.file_path.clone(),
                current_version,
                Vec::new(),
                "No Modrinth match found.",
            ),
            Err(error) => error_row(
                item.id.clone(),
                UpdateItemType::Mod,
                item.file_name.clone(),
                item.file_path.clone(),
                current_version,
                error.to_string(),
            ),
        }
    }

    async fn resolve_project(
        &self,
        saved_project: Option<String>,
        sha256: Option<&str>,
        query: &str,
        project_type: &str,
    ) -> Result<Option<(String, MatchSource, Vec<UpdateCandidate>)>> {
        if let Some(project_id) = saved_project {
            return Ok(Some((project_id, MatchSource::SavedMetadata, Vec::new())));
        }

        if let Some(hash) = sha256.filter(|value| !value.trim().is_empty()) {
            if let Some(version) = self.version_by_hash(hash).await? {
                return Ok(Some((version.project_id, MatchSource::Hash, Vec::new())));
            }
        }

        let candidates = self.search_projects(query, project_type).await?;
        if candidates.is_empty() {
            Ok(None)
        } else {
            Ok(Some((
                candidates[0].project_id.clone(),
                MatchSource::SearchFallback,
                candidates,
            )))
        }
    }

    async fn row_for_project(
        &self,
        item_id: String,
        item_type: UpdateItemType,
        file_name: String,
        file_path: String,
        current_version: Option<String>,
        installed_version_id: Option<String>,
        project_id: String,
        source: MatchSource,
        candidates: Vec<UpdateCandidate>,
        mc_version: Option<&str>,
        loader: Option<&str>,
    ) -> UpdateRow {
        let classification = classify_match_source(source);
        let project_url = Some(format!("https://modrinth.com/project/{project_id}"));
        let mut base = UpdateRow {
            item_id,
            item_type,
            file_name,
            file_path,
            current_version: current_version.clone(),
            latest_version: None,
            latest_version_id: None,
            source: "Modrinth".to_string(),
            project_id: Some(project_id.clone()),
            project_url,
            release_date: None,
            status: UpdateStatus::Unknown,
            match_confidence: classification.confidence,
            confirmed: classification.confirmed,
            candidates,
            latest_file: None,
            changelog: None,
            message: None,
        };

        match self.project_versions(&project_id).await {
            Ok(versions) => {
                if let Some(latest) =
                    select_latest_compatible_version(&versions, mc_version, loader)
                {
                    base.latest_version = Some(latest.version_number.clone());
                    base.latest_version_id = Some(latest.id.clone());
                    base.release_date = Some(latest.date_published.clone());
                    base.latest_file = latest.primary_file().map(|file| UpdateFile {
                        file_name: file.filename.clone(),
                        url: file.url.clone(),
                        sha256: file.hashes.sha256.clone(),
                    });
                    base.changelog = latest.changelog.clone();
                    base.status = if is_up_to_date(
                        current_version.as_deref(),
                        installed_version_id.as_deref(),
                        latest,
                    ) {
                        UpdateStatus::UpToDate
                    } else {
                        UpdateStatus::UpdateAvailable
                    };
                } else {
                    base.message = Some("No compatible Modrinth version found.".to_string());
                }
            }
            Err(error) => {
                base.status = UpdateStatus::Error;
                base.message = Some(error.to_string());
            }
        }

        base
    }

    async fn version_by_hash(&self, hash: &str) -> Result<Option<ModrinthVersion>> {
        let url = format!("{MODRINTH_API}/version_file/{hash}");
        let response = self
            .client
            .get(url)
            .query(&[("algorithm", "sha256")])
            .send()
            .await?;
        if response.status().as_u16() == 404 {
            return Ok(None);
        }
        Ok(Some(response.error_for_status()?.json().await?))
    }

    async fn project_versions(&self, project_id: &str) -> Result<Vec<ModrinthVersion>> {
        let url = format!("{MODRINTH_API}/project/{project_id}/version");
        Ok(self
            .client
            .get(url)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?)
    }

    async fn search_projects(
        &self,
        query: &str,
        project_type: &str,
    ) -> Result<Vec<UpdateCandidate>> {
        let facets = format!("[[\"project_type:{project_type}\"]]");
        let response: ModrinthSearchResponse = self
            .client
            .get(format!("{MODRINTH_API}/search"))
            .query(&[
                ("query", cleaned_search_query(query).as_str()),
                ("limit", "5"),
                ("facets", facets.as_str()),
            ])
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        Ok(response
            .hits
            .into_iter()
            .map(|hit| UpdateCandidate {
                project_id: hit.project_id,
                slug: hit.slug.clone(),
                title: hit.title,
                project_url: format!("https://modrinth.com/{project_type}/{}", hit.slug),
                source: "Modrinth".to_string(),
            })
            .collect())
    }
}

impl ModrinthVersion {
    fn primary_file(&self) -> Option<&ModrinthFile> {
        self.files
            .iter()
            .find(|file| file.primary)
            .or_else(|| self.files.first())
    }
}

pub fn select_latest_compatible_version<'a>(
    versions: &'a [ModrinthVersion],
    mc_version: Option<&str>,
    loader: Option<&str>,
) -> Option<&'a ModrinthVersion> {
    let loader = loader.map(|value| value.to_ascii_lowercase());
    versions
        .iter()
        .filter(|version| {
            mc_version
                .map(|mc| version.game_versions.iter().any(|value| value == mc))
                .unwrap_or(true)
        })
        .filter(|version| {
            loader
                .as_deref()
                .filter(|value| *value != "unknown" && !value.is_empty())
                .map(|loader| {
                    version
                        .loaders
                        .iter()
                        .any(|value| value.eq_ignore_ascii_case(loader))
                })
                .unwrap_or(true)
        })
        .max_by(|a, b| a.date_published.cmp(&b.date_published))
}

pub fn classify_match_source(source: MatchSource) -> MatchClassification {
    match source {
        MatchSource::SavedMetadata | MatchSource::Hash => MatchClassification {
            confidence: UpdateMatchConfidence::Exact,
            confirmed: true,
        },
        MatchSource::SearchFallback => MatchClassification {
            confidence: UpdateMatchConfidence::Candidate,
            confirmed: false,
        },
    }
}

pub fn is_up_to_date(
    current_version: Option<&str>,
    installed_version_id: Option<&str>,
    latest: &ModrinthVersion,
) -> bool {
    installed_version_id
        .map(|id| id == latest.id)
        .unwrap_or(false)
        || current_version
            .map(|version| version == latest.version_number)
            .unwrap_or(false)
}

pub fn extract_modrinth_project_id(value: &str) -> Option<String> {
    let trimmed = value.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return None;
    }
    if !trimmed.contains("modrinth.com") && !trimmed.contains('/') && !trimmed.contains('.') {
        return Some(trimmed.to_string());
    }

    let normalized = trimmed
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_start_matches("www.");
    let parts: Vec<&str> = normalized.split('/').collect();
    if parts.first().copied() != Some("modrinth.com") {
        return None;
    }
    match parts.as_slice() {
        [_, "mod" | "resourcepack" | "shader" | "project", slug, ..] if !slug.is_empty() => {
            Some((*slug).to_string())
        }
        _ => None,
    }
}

pub async fn download_bytes(url: &str) -> Result<Vec<u8>> {
    let client = Client::builder()
        .user_agent("ModpackManager/0.1.0 (local update downloader)")
        .build()?;
    Ok(client
        .get(url)
        .send()
        .await
        .with_context(|| format!("Failed to download {url}"))?
        .error_for_status()?
        .bytes()
        .await?
        .to_vec())
}

fn cleaned_search_query(value: &str) -> String {
    value
        .replace(".jar", "")
        .replace(".zip", "")
        .replace(['_', '-'], " ")
        .split_whitespace()
        .take(8)
        .collect::<Vec<_>>()
        .join(" ")
}

fn loader_kind_to_modrinth(loader: LoaderKind) -> String {
    match loader {
        LoaderKind::Fabric => "fabric",
        LoaderKind::Forge => "forge",
        LoaderKind::NeoForge => "neoforge",
        LoaderKind::Quilt => "quilt",
        LoaderKind::Unknown => "unknown",
    }
    .to_string()
}

fn unknown_row(
    item_id: String,
    item_type: UpdateItemType,
    file_name: String,
    file_path: String,
    current_version: Option<String>,
    candidates: Vec<UpdateCandidate>,
    message: &str,
) -> UpdateRow {
    UpdateRow {
        item_id,
        item_type,
        file_name,
        file_path,
        current_version,
        latest_version: None,
        latest_version_id: None,
        source: "Modrinth".to_string(),
        project_id: None,
        project_url: None,
        release_date: None,
        status: UpdateStatus::Unknown,
        match_confidence: UpdateMatchConfidence::Unknown,
        confirmed: false,
        candidates,
        latest_file: None,
        changelog: None,
        message: Some(message.to_string()),
    }
}

fn error_row(
    item_id: String,
    item_type: UpdateItemType,
    file_name: String,
    file_path: String,
    current_version: Option<String>,
    message: String,
) -> UpdateRow {
    UpdateRow {
        status: UpdateStatus::Error,
        message: Some(message),
        ..unknown_row(
            item_id,
            item_type,
            file_name,
            file_path,
            current_version,
            Vec::new(),
            "",
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn version(
        id: &str,
        number: &str,
        published: &str,
        game_versions: &[&str],
        loaders: &[&str],
    ) -> ModrinthVersion {
        ModrinthVersion {
            id: id.to_string(),
            project_id: "sodium".to_string(),
            version_number: number.to_string(),
            date_published: published.to_string(),
            changelog: Some(format!("Changes for {number}")),
            game_versions: game_versions
                .iter()
                .map(|value| value.to_string())
                .collect(),
            loaders: loaders.iter().map(|value| value.to_string()).collect(),
            files: vec![ModrinthFile {
                url: "https://cdn.modrinth.com/sodium.jar".to_string(),
                filename: format!("sodium-{number}.jar"),
                hashes: ModrinthHashes {
                    sha256: Some("def".to_string()),
                },
                primary: true,
            }],
        }
    }

    #[test]
    fn selects_newest_strictly_compatible_version() {
        let versions = vec![
            version(
                "old",
                "0.5.8",
                "2024-01-01T00:00:00Z",
                &["1.20.1"],
                &["fabric"],
            ),
            version(
                "wrong-loader",
                "0.6.0",
                "2025-01-01T00:00:00Z",
                &["1.20.1"],
                &["forge"],
            ),
            version(
                "wrong-game",
                "0.6.1",
                "2025-02-01T00:00:00Z",
                &["1.21.1"],
                &["fabric"],
            ),
            version(
                "new",
                "0.5.9",
                "2025-03-01T00:00:00Z",
                &["1.20.1"],
                &["fabric"],
            ),
        ];

        let selected = select_latest_compatible_version(&versions, Some("1.20.1"), Some("fabric"));

        assert_eq!(selected.map(|version| version.id.as_str()), Some("new"));
    }

    #[test]
    fn classifies_search_fallback_as_candidate_not_exact() {
        let matched = classify_match_source(MatchSource::SearchFallback);

        assert_eq!(matched.confidence, UpdateMatchConfidence::Candidate);
        assert!(!matched.confirmed);
    }

    #[test]
    fn extracts_modrinth_project_slug_from_url() {
        assert_eq!(
            extract_modrinth_project_id("https://modrinth.com/mod/sodium"),
            Some("sodium".to_string())
        );
        assert_eq!(
            extract_modrinth_project_id("modrinth.com/resourcepack/fresh-animations"),
            Some("fresh-animations".to_string())
        );
    }

    #[test]
    fn treats_matching_installed_version_id_as_up_to_date_when_labels_differ() {
        let latest = version(
            "version-id",
            "1.3.2+1.20.4",
            "2025-03-01T00:00:00Z",
            &["1.20.4"],
            &["fabric"],
        );

        assert!(is_up_to_date(Some("1.3.2"), Some("version-id"), &latest));
    }
}
