use std::collections::{HashMap, HashSet};
use std::path::Path;

use tauri::command;
use uuid::Uuid;

use crate::models::mod_metadata::{LoaderKind, ModFile};
use crate::models::scout::{
    CandidateSearchRequest, CandidateSearchResult, CreateScoutTargetInput, ScoutAnalysis,
    ScoutModClassification, ScoutProviderMetadata, ScoutTarget,
};
use crate::services::providers::modrinth::ModrinthProvider;
use crate::services::providers::ModProvider;
use crate::services::scout::{analyze_target, resolve_mods_path};
use crate::services::scout_scoring::score_candidates;
use crate::state::with_state;

#[command]
pub async fn list_scout_targets() -> Result<Vec<ScoutTarget>, String> {
    with_state(|state| {
        state
            .db
            .list_scout_targets()
            .map_err(|error| error.to_string())
    })
}

#[command]
pub async fn create_scout_target(input: CreateScoutTargetInput) -> Result<ScoutTarget, String> {
    with_state(|state| {
        let mods_path =
            resolve_mods_path(Path::new(&input.path)).map_err(|error| error.to_string())?;
        let name = input.name.unwrap_or_else(|| {
            mods_path
                .parent()
                .and_then(|path| path.file_name())
                .map(|value| value.to_string_lossy().to_string())
                .unwrap_or_else(|| "Minecraft modpack".to_string())
        });
        state
            .db
            .upsert_scout_target(name, mods_path.to_string_lossy().to_string(), None)
            .map_err(|error| error.to_string())
    })
}

#[command]
pub async fn create_scout_instance_target(instance_id: String) -> Result<ScoutTarget, String> {
    with_state(|state| {
        let instance = state
            .db
            .get_instance(&instance_id)
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "Minecraft instance not found".to_string())?;
        let mods_path =
            resolve_mods_path(&Path::new(&instance.game_dir)).map_err(|error| error.to_string())?;
        state
            .db
            .upsert_scout_target(
                instance.name,
                mods_path.to_string_lossy().to_string(),
                Some(instance.id),
            )
            .map_err(|error| error.to_string())
    })
}

#[command]
pub async fn analyze_scout_target(target_id: String) -> Result<ScoutAnalysis, String> {
    let (target, minecraft_version, loader) = with_state(|state| {
        let target = state
            .db
            .get_scout_target(&target_id)
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "Scout target not found".to_string())?;
        let (minecraft_version, loader) = target
            .instance_id
            .as_deref()
            .and_then(|instance_id| state.db.get_instance(instance_id).ok().flatten())
            .map(|instance| {
                (
                    instance.mc_version,
                    LoaderKind::from_str(instance.loader.as_str()),
                )
            })
            .unwrap_or((None, LoaderKind::Unknown));
        Ok((target, minecraft_version, loader))
    })?;
    let mut analysis =
        analyze_target(&target, minecraft_version, loader).map_err(|error| error.to_string())?;
    enrich_with_modrinth_categories(&mut analysis).await?;

    with_state(|state| {
        if let Some(instance_id) = target.instance_id.as_deref() {
            for scanned_mod in &analysis.mods {
                let existing = state
                    .db
                    .get_mod_by_path(instance_id, &scanned_mod.file_path)
                    .map_err(|error| error.to_string())?;
                let saved = ModFile {
                    id: existing
                        .as_ref()
                        .map(|mod_file| mod_file.id.clone())
                        .unwrap_or_else(|| Uuid::new_v4().to_string()),
                    instance_id: instance_id.to_string(),
                    file_name: scanned_mod.file_name.clone(),
                    file_path: scanned_mod.file_path.clone(),
                    installed_at: existing
                        .as_ref()
                        .map(|mod_file| mod_file.installed_at.clone())
                        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
                    enabled: !scanned_mod.file_name.ends_with(".disabled"),
                    hash_sha256: existing
                        .as_ref()
                        .and_then(|mod_file| mod_file.hash_sha256.clone()),
                    source_url: existing
                        .as_ref()
                        .and_then(|mod_file| mod_file.source_url.clone()),
                    metadata: existing
                        .as_ref()
                        .and_then(|mod_file| mod_file.metadata.clone())
                        .filter(|metadata| metadata.customized)
                        .or_else(|| Some(scanned_mod.metadata.clone())),
                    categories: existing
                        .as_ref()
                        .map(|mod_file| mod_file.categories.clone())
                        .unwrap_or_default(),
                    related_mods: existing
                        .as_ref()
                        .map(|mod_file| mod_file.related_mods.clone())
                        .unwrap_or_default(),
                };
                state
                    .db
                    .upsert_mod(&saved)
                    .map_err(|error| error.to_string())?;
            }
        }
        state
            .db
            .save_scout_analysis(&analysis)
            .map_err(|error| error.to_string())?;
        state
            .db
            .append_log(
                "info",
                "Modpack Scout analyzed a local mod directory",
                Some("scout"),
            )
            .map_err(|error| error.to_string())?;
        Ok(analysis)
    })
}

async fn enrich_with_modrinth_categories(analysis: &mut ScoutAnalysis) -> Result<(), String> {
    let mut cached: HashMap<String, Option<ScoutProviderMetadata>> = HashMap::new();
    for installed_mod in &analysis.mods {
        let key = modrinth_file_cache_key(&installed_mod.hash_sha512);
        let Some(json) = with_state(|state| {
            state
                .db
                .get_scout_provider_cache_entry(&key)
                .map_err(|error| error.to_string())
        })?
        else {
            continue;
        };
        if let Ok(metadata) = serde_json::from_str(&json) {
            cached.insert(installed_mod.hash_sha512.clone(), metadata);
        }
    }

    analysis.provider_cache_hits = analysis
        .mods
        .iter()
        .filter(|installed_mod| cached.contains_key(&installed_mod.hash_sha512))
        .count();
    let hashes = analysis
        .mods
        .iter()
        .map(|installed_mod| installed_mod.hash_sha512.clone())
        .collect::<Vec<_>>();
    let uncached = unique_uncached_hashes(&hashes, &cached);
    analysis.provider_fetches = 0;

    if !uncached.is_empty() {
        match ModrinthProvider::default()
            .metadata_by_hashes(&uncached)
            .await
        {
            Ok(fetched) => {
                analysis.provider_fetches = uncached.len();
                let fetched_at = chrono::Utc::now().to_rfc3339();
                for hash in uncached {
                    let metadata = fetched.get(&hash).cloned();
                    let json =
                        serde_json::to_string(&metadata).map_err(|error| error.to_string())?;
                    with_state(|state| {
                        state
                            .db
                            .save_scout_provider_cache(
                                &modrinth_file_cache_key(&hash),
                                &json,
                                &fetched_at,
                            )
                            .map_err(|error| error.to_string())
                    })?;
                    cached.insert(hash, metadata);
                }
            }
            Err(error) => {
                analysis.provider_warning = Some(format!(
                    "Modrinth categories could not be loaded; local analysis is still available: {error}"
                ));
            }
        }
    }

    for installed_mod in &mut analysis.mods {
        installed_mod.provider_metadata = cached.get(&installed_mod.hash_sha512).cloned().flatten();
    }
    Ok(())
}

fn modrinth_file_cache_key(hash_sha512: &str) -> String {
    format!("modrinth-file-sha512:{hash_sha512}")
}

fn unique_uncached_hashes(
    hashes: &[String],
    cached: &HashMap<String, Option<ScoutProviderMetadata>>,
) -> Vec<String> {
    let mut seen = HashSet::new();
    hashes
        .iter()
        .filter(|hash| !cached.contains_key(*hash) && seen.insert((*hash).clone()))
        .cloned()
        .collect()
}

#[command]
pub async fn get_latest_scout_analysis(target_id: String) -> Result<Option<ScoutAnalysis>, String> {
    with_state(|state| {
        state
            .db
            .get_latest_scout_analysis(&target_id)
            .map_err(|error| error.to_string())
    })
}

#[command]
pub async fn search_scout_candidates(
    target_id: String,
    query: String,
) -> Result<CandidateSearchResult, String> {
    let query = query.trim().to_string();
    if query.len() < 2 {
        return Err(
            "Enter at least two characters describing the mods you want to find.".to_string(),
        );
    }

    let (analysis, minecraft_version) = compatible_analysis(&target_id)?;
    let loader_key = format!("{:?}", analysis.loader).to_ascii_lowercase();
    let cache_key = format!(
        "modrinth-recommendations-v4:{}:{}:{}:{}",
        analysis.id,
        minecraft_version,
        loader_key,
        query.to_ascii_lowercase()
    );
    search_candidates_for_analysis(analysis, query.clone(), query, Vec::new(), cache_key).await
}

#[command]
pub async fn get_scout_recommendations(
    target_id: String,
) -> Result<Option<CandidateSearchResult>, String> {
    let analysis = with_state(|state| {
        state
            .db
            .get_latest_scout_analysis(&target_id)
            .map_err(|error| error.to_string())
    })?;
    let Some(analysis) = analysis else {
        return Ok(None);
    };
    let cache_key = baseline_recommendations_cache_key(&analysis.id);
    let json = with_state(|state| {
        state
            .db
            .get_scout_provider_cache_entry(&cache_key)
            .map_err(|error| error.to_string())
    })?;
    json.map(|value| serde_json::from_str(&value).map_err(|error| error.to_string()))
        .transpose()
}

#[command]
pub async fn discover_scout_candidates(target_id: String) -> Result<CandidateSearchResult, String> {
    let (analysis, _) = compatible_analysis(&target_id)?;
    let categories = profile_categories(&analysis);
    let goal = if categories.is_empty() {
        analysis
            .mods
            .iter()
            .filter(|installed_mod| {
                !matches!(
                    installed_mod.classification,
                    ScoutModClassification::Library
                )
            })
            .map(|installed_mod| installed_mod.metadata.name.clone())
            .take(3)
            .collect::<Vec<_>>()
            .join(" ")
    } else {
        categories.join(" ")
    };
    let provider_query = if categories.is_empty() {
        goal.clone()
    } else {
        String::new()
    };
    let cache_key = baseline_recommendations_cache_key(&analysis.id);
    search_candidates_for_analysis(analysis, provider_query, goal, categories, cache_key).await
}

fn compatible_analysis(target_id: &str) -> Result<(ScoutAnalysis, String), String> {
    let analysis = with_state(|state| {
        state
            .db
            .get_latest_scout_analysis(target_id)
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "Analyze the modpack before searching for candidates.".to_string())
    })?;
    let minecraft_version = analysis.minecraft_version.clone()
        .ok_or_else(|| "Scout could not determine the Minecraft version. Set it on the instance and analyze again.".to_string())?;
    if analysis.loader == LoaderKind::Unknown {
        return Err(
            "Scout could not determine the mod loader. Set it on the instance and analyze again."
                .to_string(),
        );
    }
    Ok((analysis, minecraft_version))
}

async fn search_candidates_for_analysis(
    analysis: ScoutAnalysis,
    provider_query: String,
    scoring_goal: String,
    categories: Vec<String>,
    cache_key: String,
) -> Result<CandidateSearchResult, String> {
    let minecraft_version = analysis
        .minecraft_version
        .clone()
        .expect("validated Minecraft version");
    if let Some(json) = with_state(|state| {
        state
            .db
            .get_scout_provider_cache(&cache_key, 6 * 60 * 60)
            .map_err(|error| error.to_string())
    })? {
        let mut result: CandidateSearchResult =
            serde_json::from_str(&json).map_err(|error| error.to_string())?;
        result.from_cache = true;
        return Ok(result);
    }

    let request = CandidateSearchRequest {
        query: provider_query,
        minecraft_version: minecraft_version.clone(),
        loader: analysis.loader,
        categories,
        limit: 100,
    };
    let installed = analysis
        .mods
        .iter()
        .flat_map(|installed_mod| {
            [
                Some(installed_mod.metadata.name.as_str()),
                installed_mod.metadata.mod_id.as_deref(),
            ]
        })
        .flatten()
        .map(normalize_identifier)
        .collect::<std::collections::HashSet<_>>();
    let mut candidates = ModrinthProvider::default()
        .search(&request)
        .await
        .map_err(|error| format!("Modrinth search failed: {error}"))?;
    candidates.retain(|candidate| {
        !installed.contains(&normalize_identifier(&candidate.slug))
            && !installed.contains(&normalize_identifier(&candidate.title))
            && !installed.contains(&normalize_identifier(&candidate.project_id))
    });

    let recommendations = score_candidates(candidates, &analysis.mods, &scoring_goal);
    let result = CandidateSearchResult {
        query: scoring_goal,
        minecraft_version,
        loader: analysis.loader,
        fetched_at: chrono::Utc::now().to_rfc3339(),
        from_cache: false,
        recommendations,
    };
    let json = serde_json::to_string(&result).map_err(|error| error.to_string())?;
    with_state(|state| {
        state
            .db
            .save_scout_provider_cache(&cache_key, &json, &result.fetched_at)
            .map_err(|error| error.to_string())?;
        state
            .db
            .append_log(
                "info",
                &format!(
                    "Modpack Scout searched Modrinth: {} candidate{}",
                    result.recommendations.len(),
                    if result.recommendations.len() == 1 {
                        ""
                    } else {
                        "s"
                    }
                ),
                Some("scout"),
            )
            .map_err(|error| error.to_string())
    })?;
    Ok(result)
}

fn baseline_recommendations_cache_key(analysis_id: &str) -> String {
    format!("modrinth-recommendations-baseline-v1:{analysis_id}")
}

fn profile_categories(analysis: &ScoutAnalysis) -> Vec<String> {
    let mut counts = HashMap::<String, usize>::new();
    for installed_mod in &analysis.mods {
        if matches!(
            installed_mod.classification,
            ScoutModClassification::Library
        ) {
            continue;
        }
        if let Some(metadata) = &installed_mod.provider_metadata {
            for category in &metadata.categories {
                *counts.entry(category.clone()).or_default() += 1;
            }
        }
    }
    let mut categories = counts.into_iter().collect::<Vec<_>>();
    categories.sort_by(|(left_name, left_count), (right_name, right_count)| {
        right_count
            .cmp(left_count)
            .then_with(|| left_name.cmp(right_name))
    });
    categories
        .into_iter()
        .take(5)
        .map(|(category, _)| category)
        .collect()
}

fn normalize_identifier(value: &str) -> String {
    value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{normalize_identifier, unique_uncached_hashes};
    use std::collections::HashMap;

    #[test]
    fn normalizes_candidate_and_installed_names_for_duplicate_checks() {
        assert_eq!(
            normalize_identifier("Farmer's Delight"),
            normalize_identifier("farmers-delight")
        );
    }

    #[test]
    fn only_returns_unique_hashes_that_are_not_cached() {
        let hashes = vec!["cached".to_string(), "new".to_string(), "new".to_string()];
        let cached = HashMap::from([("cached".to_string(), None)]);

        assert_eq!(unique_uncached_hashes(&hashes, &cached), vec!["new"]);
    }
}
