use std::collections::{HashMap, HashSet};

use anyhow::Result;
use reqwest::Client;
use serde::{Deserialize, Serialize};

use super::ModProvider;
use crate::models::scout::{CandidateMod, CandidateSearchRequest, ScoutProviderMetadata};

const MODRINTH_API: &str = "https://api.modrinth.com/v2";

pub struct ModrinthProvider {
    client: Client,
}

#[derive(Debug, Deserialize)]
struct SearchResponse {
    hits: Vec<SearchHit>,
}

#[derive(Debug, Deserialize)]
struct SearchHit {
    project_id: String,
    #[serde(default)]
    slug: Option<String>,
    title: String,
    description: String,
    author: String,
    #[serde(default)]
    categories: Vec<String>,
    #[serde(default)]
    versions: Vec<String>,
    #[serde(default)]
    downloads: u64,
    #[serde(default)]
    icon_url: Option<String>,
    date_modified: String,
}

#[derive(Debug, Serialize)]
struct HashLookupRequest<'a> {
    hashes: &'a [String],
    algorithm: &'static str,
}

#[derive(Debug, Deserialize)]
struct HashLookupVersion {
    project_id: String,
}

#[derive(Debug, Deserialize)]
struct ProjectResponse {
    id: String,
    slug: String,
    title: String,
    #[serde(default)]
    categories: Vec<String>,
    #[serde(default)]
    additional_categories: Vec<String>,
}

impl Default for ModrinthProvider {
    fn default() -> Self {
        Self {
            client: Client::builder()
                .user_agent("Sijan079/Modly/1.2.2 (Modpack Scout)")
                .build()
                .expect("valid Modrinth HTTP client"),
        }
    }
}

impl ModrinthProvider {
    pub async fn metadata_by_hashes(
        &self,
        hashes: &[String],
    ) -> Result<HashMap<String, ScoutProviderMetadata>> {
        let mut versions = HashMap::new();
        for chunk in hashes.chunks(100) {
            let response: HashMap<String, HashLookupVersion> = self
                .client
                .post(format!("{MODRINTH_API}/version_files"))
                .json(&HashLookupRequest {
                    hashes: chunk,
                    algorithm: "sha512",
                })
                .send()
                .await?
                .error_for_status()?
                .json()
                .await?;
            versions.extend(response);
        }

        let project_ids = versions
            .values()
            .map(|version| version.project_id.clone())
            .collect::<HashSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        let mut projects = HashMap::new();
        for chunk in project_ids.chunks(100) {
            let ids = serde_json::to_string(chunk)?;
            let response: Vec<ProjectResponse> = self
                .client
                .get(format!("{MODRINTH_API}/projects"))
                .query(&[("ids", ids.as_str())])
                .send()
                .await?
                .error_for_status()?
                .json()
                .await?;
            projects.extend(
                response
                    .into_iter()
                    .map(|project| (project.id.clone(), project)),
            );
        }

        Ok(versions
            .into_iter()
            .filter_map(|(hash, version)| {
                let project = projects.get(&version.project_id)?;
                Some((
                    hash,
                    ScoutProviderMetadata {
                        provider: "modrinth".to_string(),
                        project_id: project.id.clone(),
                        slug: project.slug.clone(),
                        title: project.title.clone(),
                        categories: thematic_categories(
                            project
                                .categories
                                .iter()
                                .chain(&project.additional_categories),
                        ),
                        project_url: format!("https://modrinth.com/mod/{}", project.slug),
                    },
                ))
            })
            .collect())
    }
}

fn thematic_categories<'a>(categories: impl Iterator<Item = &'a String>) -> Vec<String> {
    let loader_categories = ["fabric", "forge", "neoforge", "quilt", "liteloader", "rift"];
    let mut categories = categories
        .filter(|category| !loader_categories.contains(&category.as_str()))
        .cloned()
        .collect::<Vec<_>>();
    categories.sort();
    categories.dedup();
    categories
}

impl ModProvider for ModrinthProvider {
    async fn search(&self, request: &CandidateSearchRequest) -> Result<Vec<CandidateMod>> {
        let facets = serde_json::to_string(&search_facets(request))?;
        let limit = request.limit.clamp(1, 100).to_string();
        let response: SearchResponse = self
            .client
            .get(format!("{MODRINTH_API}/search"))
            .query(&[
                ("query", request.query.as_str()),
                ("facets", facets.as_str()),
                ("index", "relevance"),
                ("limit", limit.as_str()),
            ])
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;

        Ok(response
            .hits
            .into_iter()
            .map(|hit| {
                let slug = hit.slug.unwrap_or_else(|| hit.project_id.clone());
                let categories = thematic_categories(hit.categories.iter());
                CandidateMod {
                    project_url: format!("https://modrinth.com/mod/{slug}"),
                    project_id: hit.project_id,
                    slug,
                    title: hit.title,
                    description: hit.description,
                    author: hit.author,
                    categories,
                    supported_versions: hit.versions,
                    downloads: hit.downloads,
                    icon_url: hit.icon_url,
                    date_modified: hit.date_modified,
                }
            })
            .collect())
    }
}

fn search_facets(request: &CandidateSearchRequest) -> Vec<Vec<String>> {
    let mut facets = vec![
        vec!["project_type:mod".to_string()],
        vec![format!("versions:{}", request.minecraft_version)],
        vec![format!("categories:{}", loader_name(request))],
    ];
    if !request.categories.is_empty() {
        facets.push(
            request
                .categories
                .iter()
                .map(|category| format!("categories:{category}"))
                .collect(),
        );
    }
    facets
}

fn loader_name(request: &CandidateSearchRequest) -> &'static str {
    match request.loader {
        crate::models::mod_metadata::LoaderKind::Fabric => "fabric",
        crate::models::mod_metadata::LoaderKind::Forge => "forge",
        crate::models::mod_metadata::LoaderKind::NeoForge => "neoforge",
        crate::models::mod_metadata::LoaderKind::Quilt => "quilt",
        crate::models::mod_metadata::LoaderKind::Unknown => "unknown",
    }
}

#[cfg(test)]
mod tests {
    use super::{search_facets, thematic_categories};
    use crate::models::mod_metadata::LoaderKind;
    use crate::models::scout::CandidateSearchRequest;

    #[test]
    fn requires_mod_project_version_and_loader_facets() {
        let facets = search_facets(&CandidateSearchRequest {
            query: "structures".to_string(),
            minecraft_version: "1.21.1".to_string(),
            loader: LoaderKind::NeoForge,
            categories: Vec::new(),
            limit: 30,
        });

        assert_eq!(
            facets,
            vec![
                vec!["project_type:mod"],
                vec!["versions:1.21.1"],
                vec!["categories:neoforge"]
            ]
        );
    }

    #[test]
    fn keeps_content_categories_and_removes_loader_tags() {
        let categories = [
            "forge".to_string(),
            "adventure".to_string(),
            "technology".to_string(),
            "adventure".to_string(),
        ];

        assert_eq!(
            thematic_categories(categories.iter()),
            vec!["adventure", "technology"]
        );
    }

    #[test]
    fn profile_categories_are_combined_as_alternatives() {
        let facets = search_facets(&CandidateSearchRequest {
            query: String::new(),
            minecraft_version: "1.21.1".to_string(),
            loader: LoaderKind::NeoForge,
            categories: vec!["adventure".to_string(), "technology".to_string()],
            limit: 100,
        });

        assert_eq!(
            facets.last(),
            Some(&vec![
                "categories:adventure".to_string(),
                "categories:technology".to_string()
            ])
        );
    }
}
