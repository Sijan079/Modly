use std::collections::{HashMap, HashSet};

use crate::models::scout::{
    CandidateMod, PackFit, Recommendation, ScoutInstalledMod, ScoutModClassification,
};

pub fn explain_candidates(
    candidates: Vec<CandidateMod>,
    installed: &[ScoutInstalledMod],
    goal: &str,
) -> Vec<Recommendation> {
    let category_counts = installed
        .iter()
        .filter(|item| {
            item.classification != ScoutModClassification::Library
                && !item.file_name.to_ascii_lowercase().ends_with(".disabled")
        })
        .filter_map(|item| item.provider_metadata.as_ref())
        .flat_map(|metadata| metadata.categories.iter().cloned())
        .fold(HashMap::<String, usize>::new(), |mut counts, category| {
            *counts.entry(category).or_default() += 1;
            counts
        });
    let goal_terms = goal
        .split(|character: char| !character.is_ascii_alphanumeric())
        .map(str::to_ascii_lowercase)
        .filter(|term| term.len() >= 3)
        .collect::<HashSet<_>>();
    let mut recommendations = candidates.into_iter().map(|candidate| {
        let matching_categories = candidate.categories.iter()
            .filter(|category| category_counts.contains_key(*category))
            .cloned().collect::<Vec<_>>();
        let searchable = format!("{} {} {}", candidate.title, candidate.description, candidate.categories.join(" ")).to_ascii_lowercase();
        let mut matching_goal_terms = goal_terms.iter().filter(|term| searchable.contains(term.as_str())).cloned().collect::<Vec<_>>();
        matching_goal_terms.sort();
        let (label, reason) = if !matching_goal_terms.is_empty() {
            ("Goal match", format!("Matches the requested topic: {}.", matching_goal_terms.join(", ")))
        } else if !matching_categories.is_empty() {
            ("Pack theme match", format!("Shares {} with installed mods identified through Modrinth file hashes.", matching_categories.join(", ")))
        } else {
            ("Explore", "Appeared in the provider search; no direct relationship to this pack was established.".to_string())
        };
        Recommendation {
            candidate,
            fit: PackFit { label: label.to_string(), reason, matching_categories, matching_goal_terms },
            availability: "unknown".to_string(),
            version_evidence: None,
            evidence_warning: None,
        }
    }).collect::<Vec<_>>();
    recommendations.sort_by(|left, right| {
        fit_order(&left.fit.label)
            .cmp(&fit_order(&right.fit.label))
            .then_with(|| left.candidate.title.cmp(&right.candidate.title))
    });
    recommendations
}

fn fit_order(label: &str) -> u8 {
    match label {
        "Goal match" => 0,
        "Pack theme match" => 1,
        _ => 2,
    }
}

#[cfg(test)]
mod tests {
    use super::explain_candidates;
    use crate::models::scout::CandidateMod;

    fn candidate(title: &str, categories: Vec<&str>) -> CandidateMod {
        CandidateMod {
            project_id: title.into(),
            slug: title.into(),
            title: title.into(),
            description: String::new(),
            author: "author".into(),
            categories: categories.into_iter().map(str::to_string).collect(),
            supported_versions: vec![],
            downloads: 0,
            icon_url: None,
            date_modified: String::new(),
            project_url: String::new(),
        }
    }

    #[test]
    fn goal_evidence_is_explicit_and_has_no_numeric_score() {
        let results = explain_candidates(
            vec![
                candidate("Farming Tools", vec!["food"]),
                candidate("Other", vec![]),
            ],
            &[],
            "farming",
        );
        assert_eq!(results[0].fit.label, "Goal match");
        assert!(results[0].fit.reason.contains("farming"));
        assert!(serde_json::to_value(&results[0])
            .unwrap()
            .get("score")
            .is_none());
        assert_eq!(results[1].fit.label, "Explore");
    }
}
