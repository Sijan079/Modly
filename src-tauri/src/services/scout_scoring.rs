use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Utc};

use crate::models::scout::{
    CandidateMod, Recommendation, RecommendationStatus, ScoutInstalledMod, ScoutModClassification,
};

pub fn score_candidates(
    candidates: Vec<CandidateMod>,
    installed_mods: &[ScoutInstalledMod],
    query: &str,
) -> Vec<Recommendation> {
    score_candidates_at(candidates, installed_mods, query, Utc::now())
}

fn score_candidates_at(
    candidates: Vec<CandidateMod>,
    installed_mods: &[ScoutInstalledMod],
    query: &str,
    now: DateTime<Utc>,
) -> Vec<Recommendation> {
    let category_counts = installed_category_counts(installed_mods);
    let query_terms = meaningful_terms(query);
    let ecosystem_names = installed_ecosystem_names(installed_mods);
    let mut recommendations = candidates
        .into_iter()
        .map(|candidate| {
            score_candidate(
                candidate,
                &category_counts,
                &query_terms,
                &ecosystem_names,
                now,
            )
        })
        .collect::<Vec<_>>();
    recommendations.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| right.candidate.downloads.cmp(&left.candidate.downloads))
            .then_with(|| left.candidate.title.cmp(&right.candidate.title))
    });
    recommendations
}

fn score_candidate(
    candidate: CandidateMod,
    category_counts: &HashMap<String, usize>,
    query_terms: &[String],
    ecosystem_names: &[String],
    now: DateTime<Utc>,
) -> Recommendation {
    let matching_categories = candidate
        .categories
        .iter()
        .filter(|category| category_counts.contains_key(*category))
        .cloned()
        .collect::<Vec<_>>();
    let theme_fit = if candidate.categories.is_empty() {
        35
    } else if category_counts.is_empty() {
        50
    } else {
        ((matching_categories.len() * 100) / candidate.categories.len()) as u8
    };

    let searchable = format!(
        "{} {} {}",
        candidate.title,
        candidate.description,
        candidate.categories.join(" ")
    )
    .to_ascii_lowercase();
    let matched_goal_term_count = query_terms
        .iter()
        .filter(|term| searchable.contains(term.as_str()))
        .count();
    let goal_fit = if query_terms.is_empty() {
        50
    } else {
        ((matched_goal_term_count * 100) / query_terms.len()) as u8
    };

    let normalized_candidate = normalize_identifier(&searchable);
    let ecosystem_match = ecosystem_names
        .iter()
        .any(|normalized| normalized_candidate.contains(normalized));
    let ecosystem_fit = if ecosystem_match {
        100
    } else if matching_categories.is_empty() {
        25
    } else {
        50
    };
    let maintenance = maintenance_score(&candidate.date_modified, now);
    let overlap_penalty = overlap_penalty(&candidate.categories, category_counts);
    let performance_risk_penalty = candidate
        .categories
        .iter()
        .any(|category| matches!(category.as_str(), "worldgen" | "shaders"))
        .then_some(5)
        .unwrap_or(0);

    let weighted_score = 100.0 * 0.30
        + theme_fit as f32 * 0.20
        + goal_fit as f32 * 0.20
        + ecosystem_fit as f32 * 0.15
        + maintenance as f32 * 0.15
        - overlap_penalty as f32
        - performance_risk_penalty as f32;
    let score = weighted_score.round().clamp(0.0, 100.0) as u8;
    let status = if score >= 80 && overlap_penalty < 10 {
        RecommendationStatus::Add
    } else if score >= 50 {
        RecommendationStatus::Consider
    } else {
        RecommendationStatus::Skip
    };

    let mut concerns = Vec::new();
    if overlap_penalty > 0 {
        concerns.push(format!(
            "Its categories are already represented in the pack ({} point overlap penalty).",
            overlap_penalty
        ));
    }
    if maintenance <= 40 {
        concerns.push("The project has not been updated recently.".to_string());
    }
    if performance_risk_penalty > 0 {
        concerns.push(
            "Its Modrinth category suggests content that may increase rendering or world-generation cost."
                .to_string(),
        );
    }
    if matching_categories.is_empty() && !category_counts.is_empty() {
        concerns.push("No Modrinth category overlaps the current pack profile.".to_string());
    }

    Recommendation {
        candidate,
        score,
        status,
        concerns,
    }
}

fn installed_category_counts(installed_mods: &[ScoutInstalledMod]) -> HashMap<String, usize> {
    let mut counts = HashMap::new();
    for installed_mod in installed_mods
        .iter()
        .filter(|installed_mod| installed_mod.classification != ScoutModClassification::Library)
    {
        let Some(metadata) = &installed_mod.provider_metadata else {
            continue;
        };
        for category in &metadata.categories {
            *counts.entry(category.clone()).or_insert(0) += 1;
        }
    }
    counts
}

fn installed_ecosystem_names(installed_mods: &[ScoutInstalledMod]) -> Vec<String> {
    let mut seen = HashSet::new();
    installed_mods
        .iter()
        .filter(|installed_mod| installed_mod.classification == ScoutModClassification::Gameplay)
        .flat_map(|installed_mod| {
            [
                installed_mod.metadata.name.clone(),
                installed_mod.metadata.mod_id.clone().unwrap_or_default(),
            ]
        })
        .filter_map(|name| {
            let normalized = normalize_identifier(&name);
            (normalized.len() >= 5 && seen.insert(normalized.clone())).then_some(normalized)
        })
        .collect()
}

fn meaningful_terms(value: &str) -> Vec<String> {
    value
        .split(|character: char| !character.is_ascii_alphanumeric())
        .map(str::to_ascii_lowercase)
        .filter(|term| term.len() >= 3)
        .collect()
}

fn normalize_identifier(value: &str) -> String {
    value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn maintenance_score(date_modified: &str, now: DateTime<Utc>) -> u8 {
    let Ok(modified) = DateTime::parse_from_rfc3339(date_modified) else {
        return 50;
    };
    match now
        .signed_duration_since(modified.with_timezone(&Utc))
        .num_days()
    {
        days if days <= 180 => 100,
        days if days <= 365 => 85,
        days if days <= 730 => 65,
        days if days <= 1095 => 40,
        _ => 20,
    }
}

fn overlap_penalty(
    candidate_categories: &[String],
    category_counts: &HashMap<String, usize>,
) -> u8 {
    let saturation = candidate_categories
        .iter()
        .filter_map(|category| category_counts.get(category))
        .copied()
        .max()
        .unwrap_or(0);
    match saturation {
        0..=2 => 0,
        3..=4 => 5,
        5..=7 => 10,
        _ => 15,
    }
}

#[cfg(test)]
mod tests {
    use super::{maintenance_score, overlap_penalty, score_candidate, score_candidates_at};
    use crate::models::scout::{CandidateMod, RecommendationStatus};
    use chrono::{TimeZone, Utc};
    use std::collections::HashMap;

    #[test]
    fn maintenance_score_declines_with_age() {
        let now = Utc.with_ymd_and_hms(2026, 9, 10, 0, 0, 0).unwrap();
        assert_eq!(maintenance_score("2026-08-01T00:00:00Z", now), 100);
        assert_eq!(maintenance_score("2024-01-01T00:00:00Z", now), 40);
        assert_eq!(maintenance_score("not-a-date", now), 50);
    }

    #[test]
    fn overlap_uses_the_most_saturated_matching_category() {
        let counts = HashMap::from([("technology".to_string(), 6), ("adventure".to_string(), 2)]);
        assert_eq!(
            overlap_penalty(
                &["technology".to_string(), "adventure".to_string()],
                &counts
            ),
            10
        );
        assert_eq!(overlap_penalty(&["magic".to_string()], &counts), 0);
    }

    #[test]
    fn strong_fit_is_add_but_saturated_category_is_consider() {
        let now = Utc.with_ymd_and_hms(2026, 9, 10, 0, 0, 0).unwrap();
        let candidate = CandidateMod {
            project_id: "project".to_string(),
            slug: "useful-tech".to_string(),
            title: "Useful Technology".to_string(),
            description: "Adds technology tools".to_string(),
            author: "Author".to_string(),
            categories: vec!["technology".to_string()],
            supported_versions: vec!["1.21.1".to_string()],
            downloads: 100,
            icon_url: None,
            date_modified: "2026-08-01T00:00:00Z".to_string(),
            project_url: "https://modrinth.com/mod/useful-tech".to_string(),
        };
        let query_terms = vec!["technology".to_string()];

        let add = score_candidate(
            candidate.clone(),
            &HashMap::from([("technology".to_string(), 1)]),
            &query_terms,
            &[],
            now,
        );
        let consider = score_candidate(
            candidate,
            &HashMap::from([("technology".to_string(), 6)]),
            &query_terms,
            &[],
            now,
        );

        assert_eq!(add.score, 93);
        assert_eq!(add.status, RecommendationStatus::Add);
        assert_eq!(consider.score, 83);
        assert_eq!(consider.status, RecommendationStatus::Consider);
    }

    #[test]
    fn recommendations_sort_by_score_then_downloads() {
        let now = Utc.with_ymd_and_hms(2026, 9, 10, 0, 0, 0).unwrap();
        let candidate = CandidateMod {
            project_id: "low".to_string(),
            slug: "technology-low".to_string(),
            title: "Technology Low".to_string(),
            description: "Technology".to_string(),
            author: "Author".to_string(),
            categories: vec!["technology".to_string()],
            supported_versions: vec!["1.21.1".to_string()],
            downloads: 10,
            icon_url: None,
            date_modified: "2026-08-01T00:00:00Z".to_string(),
            project_url: "https://modrinth.com/mod/technology-low".to_string(),
        };
        let mut popular = candidate.clone();
        popular.project_id = "popular".to_string();
        popular.downloads = 100;

        let recommendations = score_candidates_at(vec![candidate, popular], &[], "technology", now);

        assert_eq!(recommendations[0].candidate.project_id, "popular");
    }
}
