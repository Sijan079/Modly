use anyhow::{bail, Result};
use reqwest::{Client, StatusCode, Url};
use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::models::community::{CommunityIssue, IssueSource};
use crate::models::crash::{CrashAnalysis, CrashCandidate};
use crate::models::mod_metadata::ModFile;
use crate::services::updates::extract_modrinth_project_id;

const MODRINTH_API: &str = "https://api.modrinth.com/v2";
const GITHUB_API: &str = "https://api.github.com";
pub const MAX_REMOTE_CANDIDATES: usize = 5;

#[derive(Debug, Deserialize)]
struct ModrinthProject {
    #[serde(default)]
    issues_url: Option<String>,
    #[serde(default)]
    source_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GitHubSearch {
    items: Vec<GitHubIssue>,
}

#[derive(Debug, Deserialize)]
pub struct GitHubIssue {
    number: u64,
    title: String,
    html_url: String,
    state: String,
    updated_at: String,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    labels: Vec<GitHubLabel>,
    #[serde(default)]
    pull_request: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct GitHubLabel {
    name: String,
}

pub fn client() -> Client {
    Client::builder()
        .user_agent(format!(
            "Sijan079/Modly/{} (crash issue lookup)",
            env!("CARGO_PKG_VERSION")
        ))
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(12))
        .build()
        .expect("valid HTTP client")
}

pub fn github_repository(url: &str) -> Option<String> {
    let parsed = Url::parse(url).ok()?;
    if parsed.scheme() != "https"
        || parsed.host_str()? != "github.com"
        || parsed.port().is_some()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return None;
    }
    let mut parts = parsed.path_segments()?;
    let owner = parts.next()?;
    let repo = parts.next()?.trim_end_matches(".git");
    if !valid_repo_part(owner) || !valid_repo_part(repo) {
        return None;
    }
    Some(format!("{owner}/{repo}"))
}

fn safe_https_url(value: &str) -> Option<String> {
    let url = Url::parse(value).ok()?;
    (url.scheme() == "https"
        && url.host_str().is_some()
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none())
    .then(|| url.to_string())
}

fn valid_repo_part(part: &str) -> bool {
    !part.is_empty()
        && part.len() <= 100
        && part
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
}

pub fn source_from_saved_mod(
    instance_id: &str,
    candidate: &CrashCandidate,
    saved: Option<&ModFile>,
) -> IssueSource {
    let metadata_project_url = saved
        .and_then(|item| item.metadata.as_ref())
        .and_then(|metadata| metadata.modrinth_url.as_deref());
    let direct_source = saved
        .and_then(|item| item.source_url.as_deref())
        .and_then(safe_https_url);
    let project_id = metadata_project_url
        .and_then(extract_modrinth_project_id)
        .or_else(|| {
            direct_source
                .as_deref()
                .and_then(extract_modrinth_project_id)
        })
        .filter(|value| {
            !value.is_empty()
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
        });
    let repository = direct_source.as_deref().and_then(github_repository);
    let issue_url = repository
        .as_ref()
        .map(|repo| format!("https://github.com/{repo}/issues"));
    let provider = if project_id.is_some() {
        "modrinth"
    } else {
        "local"
    };
    IssueSource {
        instance_id: instance_id.to_string(),
        file_path: candidate.file_path.clone(),
        project_id,
        issue_url,
        source_url: direct_source,
        repository,
        provider: provider.to_string(),
        checked_at: chrono::Utc::now().to_rfc3339(),
        status: "pending".to_string(),
    }
}

pub async fn resolve_source(client: &Client, mut source: IssueSource) -> IssueSource {
    if let Some(project_id) = &source.project_id {
        let response = client
            .get(format!("{MODRINTH_API}/project/{project_id}"))
            .send()
            .await;
        match response {
            Ok(response) if response.status().is_success() => {
                match response.json::<ModrinthProject>().await {
                    Ok(project) => {
                        source.issue_url = project
                            .issues_url
                            .as_deref()
                            .and_then(safe_https_url)
                            .or(source.issue_url);
                        source.source_url = project
                            .source_url
                            .as_deref()
                            .and_then(safe_https_url)
                            .or(source.source_url);
                    }
                    Err(_) => source.status = "providerError".to_string(),
                }
            }
            _ => source.status = "providerError".to_string(),
        }
    }
    source.repository = if let Some(issue_url) = source.issue_url.as_deref() {
        github_repository(issue_url)
    } else {
        source.source_url.as_deref().and_then(github_repository)
    };
    if source.issue_url.is_none() {
        source.issue_url = source
            .repository
            .as_ref()
            .map(|repo| format!("https://github.com/{repo}/issues"));
    }
    if source.status != "providerError" {
        source.status = if source.repository.is_some() {
            "github"
        } else if source.issue_url.is_some() {
            "unsupported"
        } else {
            "missing"
        }
        .to_string();
    }
    source.checked_at = chrono::Utc::now().to_rfc3339();
    source
}

fn exception_name(analysis: &CrashAnalysis) -> Option<&str> {
    analysis
        .exception_type
        .as_deref()
        .and_then(|value| value.rsplit('.').next())
        .filter(|value| value.len() >= 5)
}

fn distinctive_namespace(analysis: &CrashAnalysis) -> Option<&str> {
    analysis
        .stack_namespaces
        .iter()
        .find(|namespace| {
            !namespace.starts_with("java.")
                && !namespace.starts_with("net.minecraft")
                && !namespace.starts_with("sun.")
        })
        .map(String::as_str)
}

pub fn search_query(
    repository: &str,
    candidate: &CrashCandidate,
    mod_version: Option<&str>,
    analysis: &CrashAnalysis,
) -> String {
    let mut terms = Vec::new();
    if let Some(value) = exception_name(analysis) {
        terms.push(value.to_string());
    }
    if let Some(value) = distinctive_namespace(analysis) {
        terms.push(value.to_string());
    }
    if let Some(value) =
        mod_version.filter(|value| value.len() >= 3 && value.len() <= 25 && *value != "unknown")
    {
        terms.push(value.to_string());
    }
    if let Some(value) = analysis.minecraft_version.as_deref() {
        terms.push(value.to_string());
    }
    if let Some(value) = analysis.loader.as_deref() {
        terms.push(value.to_string());
    }
    if let Some(value) = analysis
        .loader_version
        .as_deref()
        .filter(|value| value.len() <= 20)
    {
        terms.push(value.to_string());
    }
    if let Some(other) = analysis
        .candidates
        .iter()
        .find(|item| item.file_path != candidate.file_path)
    {
        terms.push(other.name.clone());
    }
    if terms.is_empty() {
        terms.push(candidate.name.clone());
    }
    terms.truncate(7);
    let terms = terms
        .into_iter()
        .map(|value| format!("\"{}\"", value.replace('"', "")))
        .collect::<Vec<_>>()
        .join(" OR ");
    format!("repo:{repository} is:issue ({terms})")
}

pub fn cache_key(fingerprint: &str, file_path: &str, query: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(fingerprint.as_bytes());
    hasher.update(file_path.as_bytes());
    hasher.update(query.as_bytes());
    format!("{:x}", hasher.finalize())
}

pub fn fresh(checked_at: &str, hours: i64) -> bool {
    chrono::DateTime::parse_from_rfc3339(checked_at)
        .ok()
        .is_some_and(|time| chrono::Utc::now().signed_duration_since(time).num_hours() < hours)
}

pub async fn search_github(
    client: &Client,
    repository: &str,
    query: &str,
) -> Result<Vec<GitHubIssue>> {
    let response = client
        .get(format!("{GITHUB_API}/search/issues"))
        .header("Accept", "application/vnd.github+json")
        .query(&[("q", query), ("per_page", "20")])
        .send()
        .await?;
    if response.status() == StatusCode::FORBIDDEN
        || response.status() == StatusCode::TOO_MANY_REQUESTS
    {
        bail!("GitHub search is rate limited or inaccessible for {repository}");
    }
    let response: GitHubSearch = response.error_for_status()?.json().await?;
    Ok(response
        .items
        .into_iter()
        .filter(|item| {
            item.pull_request.is_none()
                && github_repository(&item.html_url)
                    .is_some_and(|found| found.eq_ignore_ascii_case(repository))
                && Url::parse(&item.html_url)
                    .ok()
                    .is_some_and(|url| url.path().contains("/issues/"))
        })
        .collect())
}

fn contains_signal(text: &str, signal: &str) -> bool {
    !signal.is_empty()
        && text
            .to_ascii_lowercase()
            .contains(&signal.to_ascii_lowercase())
}

fn contains_version(text: &str, version: &str) -> bool {
    let text = text.to_ascii_lowercase();
    let version = version.to_ascii_lowercase();
    text.match_indices(&version).any(|(index, _)| {
        let before = text[..index].chars().last();
        let after = text[index + version.len()..].chars().next();
        let boundary = |value: Option<char>| {
            value.is_none_or(|character| !character.is_ascii_alphanumeric() && character != '.')
        };
        boundary(before) && boundary(after)
    })
}

fn mentions_loader(text: &str, loader: &str) -> bool {
    text.split(|character: char| !character.is_ascii_alphabetic())
        .any(|word| word.eq_ignore_ascii_case(loader))
}

fn duplicate_reference(body: &str, issue_url: &str) -> Option<String> {
    let lower = body.to_ascii_lowercase();
    let (_, after) = lower.split_once("duplicate of #")?;
    let number = after
        .chars()
        .take_while(char::is_ascii_digit)
        .collect::<String>();
    if number.is_empty() {
        return None;
    }
    let repository = github_repository(issue_url)?;
    Some(format!("https://github.com/{repository}/issues/{number}"))
}

pub fn rank_issues(
    issues: Vec<GitHubIssue>,
    candidate: &CrashCandidate,
    mod_version: Option<&str>,
    analysis: &CrashAnalysis,
) -> Vec<CommunityIssue> {
    let mut ranked = issues
        .into_iter()
        .map(|issue| {
            let text = format!(
                "{}\n{}",
                issue.title,
                issue.body.as_deref().unwrap_or_default()
            );
            let mut similarities = Vec::new();
            let mut differences = Vec::new();
            let mut score = 0;
            if let Some(value) =
                exception_name(analysis).filter(|value| contains_signal(&text, value))
            {
                similarities.push(format!("Same exception type: {value}"));
                score += 5;
            }
            if let Some(value) =
                distinctive_namespace(analysis).filter(|value| contains_signal(&text, value))
            {
                similarities.push(format!("Same stack namespace: {value}"));
                score += 4;
            }
            if let Some(value) = mod_version.filter(|value| {
                value.len() >= 3 && *value != "unknown" && contains_version(&text, value)
            }) {
                similarities.push(format!("Mentions installed mod version: {value}"));
                score += 3;
            }
            if let Some(value) = analysis
                .minecraft_version
                .as_deref()
                .filter(|value| contains_version(&text, value))
            {
                similarities.push(format!("Same Minecraft version: {value}"));
                score += 2;
            }
            if contains_signal(&text, &candidate.name) {
                similarities.push(format!("Mentions {}", candidate.name));
                score += 1;
            }
            for other in analysis
                .candidates
                .iter()
                .filter(|item| item.file_path != candidate.file_path)
                .take(2)
            {
                if contains_signal(&text, &other.name) {
                    similarities.push(format!("Mentions interacting mod: {}", other.name));
                    score += 2;
                }
            }
            if let Some(loader) = analysis.loader.as_deref() {
                if mentions_loader(&text, loader) {
                    similarities.push(format!("Mentions loader: {loader}"));
                    score += 1;
                } else if let Some(other) = ["fabric", "forge", "neoforge", "quilt"]
                    .into_iter()
                    .find(|other| mentions_loader(&text, other))
                {
                    differences.push(format!("Issue mentions {other}; pack uses {loader}"));
                }
            }
            if let Some(expected) = analysis.minecraft_version.as_deref() {
                if let Some(found) = mentioned_minecraft_version(&text) {
                    if found != expected && !contains_version(&text, expected) {
                        differences.push(format!(
                            "Issue mentions Minecraft {found}; pack uses {expected}"
                        ));
                    }
                }
            }
            let labels = issue
                .labels
                .iter()
                .map(|label| label.name.to_ascii_lowercase())
                .collect::<Vec<_>>();
            let duplicate_of = issue
                .body
                .as_deref()
                .and_then(|body| duplicate_reference(body, &issue.html_url));
            let authority = if labels.iter().any(|label| label.contains("duplicate")) {
                "duplicate"
            } else if labels
                .iter()
                .any(|label| label.contains("confirmed") || label == "fixed" || label == "resolved")
            {
                "maintainerLabeled"
            } else if score >= 3 {
                "similar"
            } else {
                "unverified"
            };
            (
                score,
                CommunityIssue {
                    candidate_file_path: candidate.file_path.clone(),
                    number: issue.number,
                    title: issue.title,
                    url: issue.html_url,
                    state: issue.state,
                    updated_at: issue.updated_at,
                    authority: authority.to_string(),
                    duplicate_of,
                    similarities,
                    differences,
                },
            )
        })
        .filter(|(score, _)| *score > 0)
        .collect::<Vec<_>>();
    ranked.sort_by(|left, right| {
        right
            .0
            .cmp(&left.0)
            .then_with(|| right.1.updated_at.cmp(&left.1.updated_at))
    });
    ranked.truncate(6);
    ranked.into_iter().map(|(_, issue)| issue).collect()
}

fn mentioned_minecraft_version(text: &str) -> Option<String> {
    let lower = text.to_ascii_lowercase();
    let (_, after) = lower.split_once("minecraft")?;
    after
        .split(|character: char| !character.is_ascii_digit() && character != '.')
        .find(|part| part.starts_with("1.") && part.len() >= 4)
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn analysis() -> CrashAnalysis {
        CrashAnalysis {
            fingerprint: "fingerprint".into(),
            instance_id: "pack".into(),
            source_path: "crash.txt".into(),
            analyzed_at: String::new(),
            exception_type: Some("java.lang.IllegalStateException".into()),
            exception_message: None,
            stack_frames: vec![],
            stack_namespaces: vec!["com.alpha".into()],
            unmapped_frames: vec![],
            mentioned_mod_ids: vec![],
            minecraft_version: Some("1.20.1".into()),
            loader: Some("fabric".into()),
            loader_version: Some("0.16.0".into()),
            environment: vec![],
            candidates: vec![
                CrashCandidate {
                    file_path: "mods/alpha.jar".into(),
                    name: "Alpha".into(),
                    evidence: vec![],
                },
                CrashCandidate {
                    file_path: "mods/library.jar".into(),
                    name: "Library".into(),
                    evidence: vec![],
                },
            ],
            recent_changes: vec![],
        }
    }

    #[test]
    fn github_host_normalization_rejects_lookalikes() {
        assert_eq!(
            github_repository("https://github.com/acme/mod/issues"),
            Some("acme/mod".into())
        );
        assert_eq!(
            github_repository("https://github.com/acme/mod.git"),
            Some("acme/mod".into())
        );
        assert_eq!(
            github_repository("https://github.com.evil.test/acme/mod"),
            None
        );
        assert_eq!(github_repository("http://github.com/acme/mod"), None);
        assert!(safe_https_url("file:///tmp/report").is_none());
    }

    #[test]
    fn query_uses_crash_evidence_and_ranking_keeps_differences() {
        let analysis = analysis();
        let candidate = &analysis.candidates[0];
        let query = search_query("acme/alpha", candidate, Some("1.0.0"), &analysis);
        assert!(query.contains("IllegalStateException"));
        assert!(query.contains("com.alpha"));
        assert!(query.contains("1.20.1"));
        assert!(query.contains("fabric"));
        assert!(query.contains("Library"));
        let issue: GitHubIssue = serde_json::from_value(serde_json::json!({
            "number": 42, "title": "IllegalStateException with Alpha on Minecraft 1.19.4 Forge",
            "html_url": "https://github.com/acme/alpha/issues/42", "state": "closed",
            "updated_at": "2026-01-01T00:00:00Z", "body": "com.alpha Library 1.0.0",
            "labels": [{"name": "confirmed"}]
        }))
        .unwrap();
        let result = rank_issues(vec![issue], candidate, Some("1.0.0"), &analysis);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].authority, "maintainerLabeled");
        assert!(result[0]
            .similarities
            .iter()
            .any(|item| item.contains("exception")));
        assert!(result[0]
            .differences
            .iter()
            .any(|item| item.contains("Minecraft 1.19.4")));
        assert!(result[0]
            .differences
            .iter()
            .any(|item| item.contains("forge")));
    }

    #[test]
    fn mere_closed_state_does_not_confirm_a_fix() {
        let analysis = analysis();
        let issue: GitHubIssue = serde_json::from_value(serde_json::json!({
            "number": 9, "title": "Alpha crash", "html_url": "https://github.com/acme/alpha/issues/9",
            "state": "closed", "updated_at": "2026-01-01T00:00:00Z", "body": null, "labels": []
        })).unwrap();
        let result = rank_issues(vec![issue], &analysis.candidates[0], None, &analysis);
        assert_eq!(result[0].authority, "unverified");
    }

    #[test]
    fn duplicate_label_keeps_reference_to_original_report() {
        let analysis = analysis();
        let issue: GitHubIssue = serde_json::from_value(serde_json::json!({
            "number": 12, "title": "Alpha crash", "html_url": "https://github.com/acme/alpha/issues/12",
            "state": "closed", "updated_at": "2026-01-01T00:00:00Z",
            "body": "Duplicate of #7", "labels": [{"name": "duplicate"}]
        })).unwrap();
        let result = rank_issues(vec![issue], &analysis.candidates[0], None, &analysis);
        assert_eq!(result[0].authority, "duplicate");
        assert_eq!(
            result[0].duplicate_of.as_deref(),
            Some("https://github.com/acme/alpha/issues/7")
        );
    }
}
