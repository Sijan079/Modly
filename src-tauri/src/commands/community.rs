use std::path::Path;

use tauri::command;

use crate::models::community::CommunitySearchResult;
use crate::services::change_plan::list_backups;
use crate::services::community::{
    cache_key, client, fresh, rank_issues, resolve_source, search_github, search_query,
    source_from_saved_mod, MAX_REMOTE_CANDIDATES,
};
use crate::services::crash::{fingerprint, read_report};
use crate::state::with_state;

#[command]
pub async fn search_crash_community(
    instance_id: String,
    fingerprint_key: String,
) -> Result<CommunitySearchResult, String> {
    let (analysis, instance, saved_mods) = with_state(|state| {
        let analysis = state
            .db
            .get_crash_analysis(&instance_id, &fingerprint_key)
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "Saved crash analysis not found".to_string())?;
        let instance = state
            .db
            .get_instance(&instance_id)
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "Instance not found".to_string())?;
        let saved_mods = state
            .db
            .list_mods(&instance_id)
            .map_err(|error| error.to_string())?;
        Ok((analysis, instance, saved_mods))
    })?;
    let source_path = analysis.source_path.clone();
    let instance_for_check = instance.clone();
    let key_for_check = fingerprint_key.clone();
    tauri::async_runtime::spawn_blocking(move || with_state(|state| {
        let report = read_report(Path::new(&source_path)).map_err(|error| error.to_string())?;
        let backups = list_backups(state, &instance_for_check.id).map_err(|error| error.to_string())?;
        let current = fingerprint(&report, &source_path, &instance_for_check, &backups)
            .map_err(|error| error.to_string())?;
        if current != key_for_check { return Err("The report or pack changed. Analyze it again before searching community issues.".to_string()); }
        Ok(())
    })).await.map_err(|error| error.to_string())??;

    let http = client();
    let mut result = CommunitySearchResult {
        fingerprint: analysis.fingerprint.clone(),
        fetched_at: chrono::Utc::now().to_rfc3339(),
        from_cache: true,
        sources: Vec::new(),
        reports: Vec::new(),
        warnings: Vec::new(),
    };
    let mut github_unavailable = false;
    for candidate in analysis.candidates.iter().take(MAX_REMOTE_CANDIDATES) {
        let saved_mod = saved_mods
            .iter()
            .find(|item| item.file_path == candidate.file_path);
        let mod_version = saved_mod
            .and_then(|item| item.metadata.as_ref())
            .map(|meta| meta.version.as_str());
        let initial = source_from_saved_mod(&instance_id, candidate, saved_mod);
        let stored = with_state(|state| {
            state
                .db
                .get_issue_source(&instance_id, &candidate.file_path)
                .map_err(|error| error.to_string())
        })?;
        let source = match stored {
            Some(source)
                if source.project_id == initial.project_id
                    && (source.provider != "local" || source.source_url == initial.source_url)
                    && fresh(
                        &source.checked_at,
                        if source.status == "providerError" {
                            1
                        } else {
                            24
                        },
                    ) =>
            {
                source
            }
            _ => {
                result.from_cache = false;
                let resolved = resolve_source(&http, initial).await;
                with_state(|state| {
                    state
                        .db
                        .save_issue_source(&resolved)
                        .map_err(|error| error.to_string())
                })?;
                resolved
            }
        };
        if source.status == "providerError" {
            result.warnings.push(format!(
                "Could not refresh provider issue links for {}. Saved links may be incomplete.",
                candidate.name
            ));
        }
        let Some(repository) = source.repository.as_deref() else {
            result.warnings.push(match source.status.as_str() {
                "unsupported" => format!(
                    "{} uses a non-GitHub issue tracker; open its issue link directly.",
                    candidate.name
                ),
                _ => format!(
                    "No supported issue tracker was found for {}.",
                    candidate.name
                ),
            });
            result.sources.push(source);
            continue;
        };
        let query = search_query(repository, candidate, mod_version, &analysis);
        let key = cache_key(&analysis.fingerprint, &candidate.file_path, &query);
        let cached = with_state(|state| {
            state
                .db
                .get_community_issue_cache(&key)
                .map_err(|error| error.to_string())
        })?;
        let reports = if let Some((checked_at, reports)) = &cached {
            if fresh(checked_at, 6) {
                reports.clone()
            } else if github_unavailable {
                result.warnings.push(format!("Skipped another GitHub request for {repository}; showing older cached reports."));
                reports.clone()
            } else {
                fetch_or_stale(
                    &http,
                    repository,
                    &query,
                    &key,
                    candidate,
                    mod_version,
                    &analysis,
                    cached.as_ref(),
                    &mut result,
                    &mut github_unavailable,
                )
                .await?
            }
        } else if github_unavailable {
            result.warnings.push(format!(
                "Skipped GitHub search for {repository} after an API limit or access failure."
            ));
            Vec::new()
        } else {
            fetch_or_stale(
                &http,
                repository,
                &query,
                &key,
                candidate,
                mod_version,
                &analysis,
                None,
                &mut result,
                &mut github_unavailable,
            )
            .await?
        };
        result.reports.extend(reports);
        result.sources.push(source);
    }
    result.reports.sort_by(|left, right| {
        right
            .similarities
            .len()
            .cmp(&left.similarities.len())
            .then_with(|| right.updated_at.cmp(&left.updated_at))
    });
    result.reports.truncate(15);
    Ok(result)
}

async fn fetch_or_stale(
    http: &reqwest::Client,
    repository: &str,
    query: &str,
    key: &str,
    candidate: &crate::models::crash::CrashCandidate,
    mod_version: Option<&str>,
    analysis: &crate::models::crash::CrashAnalysis,
    stale: Option<&(String, Vec<crate::models::community::CommunityIssue>)>,
    result: &mut CommunitySearchResult,
    github_unavailable: &mut bool,
) -> Result<Vec<crate::models::community::CommunityIssue>, String> {
    result.from_cache = false;
    match search_github(http, repository, query).await {
        Ok(issues) => {
            let reports = rank_issues(issues, candidate, mod_version, analysis);
            with_state(|state| {
                state
                    .db
                    .save_community_issue_cache(key, &reports)
                    .map_err(|error| error.to_string())
            })?;
            Ok(reports)
        }
        Err(error) => {
            if error.to_string().contains("rate limited or inaccessible") {
                *github_unavailable = true;
            }
            result
                .warnings
                .push(format!("Could not search {repository}: {error}"));
            if let Some((_, reports)) = stale {
                result
                    .warnings
                    .push(format!("Showing older cached reports for {repository}."));
                Ok(reports.clone())
            } else {
                Ok(Vec::new())
            }
        }
    }
}
