use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::Path;

use anyhow::{bail, Context, Result};
use sha2::{Digest, Sha256};

use crate::models::change_plan::ChangeBackup;
use crate::models::crash::{CrashAnalysis, CrashCandidate, CrashEnvironmentEntry};
use crate::models::instance::Instance;
use crate::models::pack_truth::{PackTruth, RelationshipResolution};
use crate::services::change_plan::list_change_history;
use crate::services::pack_truth::scan_pack_truth;
use crate::state::AppState;

const MAX_REPORT_BYTES: u64 = 8 * 1024 * 1024;
const MAX_FRAMES: usize = 80;
const MAX_PARSED_LINES: usize = 100_000;
const MAX_LINE_CHARS: usize = 4_096;

pub fn read_report(path: &Path) -> Result<String> {
    if !path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("txt") || value.eq_ignore_ascii_case("log"))
    {
        bail!("Select a .txt crash report or .log file");
    }
    let metadata = fs::metadata(path).context("Could not read the selected report")?;
    if !metadata.is_file() || metadata.len() > MAX_REPORT_BYTES {
        bail!("Crash report must be a file of at most 8 MB");
    }
    let mut bytes = Vec::new();
    fs::File::open(path)?
        .take(MAX_REPORT_BYTES + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_REPORT_BYTES {
        bail!("Crash report must be a file of at most 8 MB");
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

fn bounded_line(line: &str) -> &str {
    let end = line
        .char_indices()
        .nth(MAX_LINE_CHARS)
        .map_or(line.len(), |(index, _)| index);
    &line[..end]
}

pub fn fingerprint(
    report: &str,
    source_path: &str,
    instance: &Instance,
    backups: &[ChangeBackup],
    truth: &PackTruth,
) -> Result<String> {
    let mut hasher = Sha256::new();
    hasher.update(b"modly-crash-v3\0");
    hasher.update(report.as_bytes());
    hasher.update(source_path.as_bytes());
    hasher.update(instance.id.as_bytes());
    hasher.update(instance.loader.as_str().as_bytes());
    hasher.update(
        instance
            .mc_version
            .as_deref()
            .unwrap_or_default()
            .as_bytes(),
    );
    for mod_file in &truth.mods {
        hasher.update(mod_file.file_path.replace('\\', "/").as_bytes());
        hasher.update([u8::from(mod_file.enabled)]);
        hasher.update(
            mod_file
                .hash_sha256
                .as_deref()
                .unwrap_or_default()
                .as_bytes(),
        );
    }
    for backup in backups.iter().take(10) {
        hasher.update(backup.id.as_bytes());
        hasher.update(backup.status.as_bytes());
    }
    Ok(format!("{:x}", hasher.finalize()))
}

pub fn snapshot_current(state: &AppState, instance_id: &str, key: &str) -> Result<bool> {
    let Some(saved) = state.db.get_crash_analysis(instance_id, key)? else {
        return Ok(false);
    };
    let Some(instance) = state.db.get_instance(instance_id)? else {
        return Ok(false);
    };
    let Ok(report) = read_report(Path::new(&saved.source_path)) else {
        return Ok(false);
    };
    let history = list_change_history(state, instance_id)?;
    let mods = state.db.list_mods(instance_id)?;
    let truth = scan_pack_truth(
        instance_id,
        &Path::new(&instance.game_dir).join("mods"),
        &mods,
    )?;
    Ok(fingerprint(&report, &saved.source_path, &instance, &history, &truth)? == key)
}

pub fn analyze(
    report: &str,
    instance: &Instance,
    source_path: &str,
    fingerprint: String,
    truth: &PackTruth,
    backups: &[ChangeBackup],
) -> CrashAnalysis {
    let is_log = source_path.to_ascii_lowercase().ends_with(".log");
    let mut selected_lines = if is_log {
        report
            .lines()
            .rev()
            .take(MAX_PARSED_LINES)
            .collect::<Vec<_>>()
    } else {
        report.lines().take(MAX_PARSED_LINES).collect::<Vec<_>>()
    };
    if is_log {
        selected_lines.reverse();
    }
    let lines = selected_lines
        .into_iter()
        .map(|line| {
            let trimmed = bounded_line(line.trim());
            if trimmed.starts_with('[') {
                trimmed
                    .split_once("]: ")
                    .map_or(trimmed, |(_, value)| value.trim())
            } else {
                trimmed
            }
        })
        .collect::<Vec<_>>();
    let exception = lines.iter().enumerate().rev().find_map(|(index, line)| {
        let value = line.strip_prefix("Caused by: ").unwrap_or(line);
        let value = if let Some(thread) = value.strip_prefix("Exception in thread \"") {
            thread.split_once("\" ").map_or(value, |(_, rest)| rest)
        } else {
            value
        };
        let first = value.split_whitespace().next()?;
        (first.trim_end_matches(':').ends_with("Exception")
            || first.trim_end_matches(':').ends_with("Error"))
        .then(|| {
            (
                index,
                value
                    .split_once(':')
                    .map_or((value, ""), |(kind, message)| (kind, message.trim())),
            )
        })
    });
    let frame_lines = if is_log {
        exception.map_or(lines.as_slice(), |(index, _)| {
            &lines[index..lines.len().min(index + 81)]
        })
    } else {
        lines.as_slice()
    };
    let stack_frames = frame_lines
        .iter()
        .filter(|line| line.starts_with("at ") || line.starts_with("\tat "))
        .take(MAX_FRAMES)
        .map(|line| line.trim_start_matches("at ").to_string())
        .collect::<Vec<_>>();
    let mut stack_namespaces = stack_frames
        .iter()
        .filter_map(|frame| frame.split('(').next())
        .filter_map(|method| method.rsplit_once('.').map(|(class, _)| class))
        .filter_map(|class| {
            class
                .rsplit_once('.')
                .map(|(namespace, _)| namespace.to_string())
        })
        .collect::<Vec<_>>();
    stack_namespaces.sort();
    stack_namespaces.dedup();
    let minecraft_version = field(&lines, &["Minecraft Version:", "Minecraft Version ID:"])
        .or_else(|| instance.mc_version.clone());
    let loader_version = field(
        &lines,
        &[
            "Fabric Loader:",
            "Forge Version:",
            "NeoForge Version:",
            "Quilt Loader:",
        ],
    );
    let environment = [
        "Java Version:",
        "Operating System:",
        "Memory:",
        "JVM Flags:",
    ]
    .into_iter()
    .filter_map(|label| {
        field(&lines, &[label]).map(|value| CrashEnvironmentEntry {
            label: label.trim_end_matches(':').to_string(),
            value,
        })
    })
    .collect();
    let explicit_ids = explicit_mod_ids(frame_lines);
    let mut scores = HashMap::<String, (i32, Vec<String>)>::new();
    let mut mapped_frames = HashSet::new();
    let enabled = truth
        .mods
        .iter()
        .filter(|item| item.enabled)
        .collect::<Vec<_>>();

    for mod_file in &enabled {
        let Some(metadata) = &mod_file.observed else {
            continue;
        };
        let ids = metadata
            .mod_id
            .iter()
            .chain(metadata.provided_mod_ids.iter())
            .map(|id| id.to_ascii_lowercase())
            .collect::<Vec<_>>();
        let mut reasons = Vec::new();
        if ids.iter().any(|id| explicit_ids.contains(id)) {
            reasons.push(format!(
                "Explicit mod ID in report: {}",
                ids.iter().find(|id| explicit_ids.contains(*id)).unwrap()
            ));
        }
        let stem = mod_file
            .file_name
            .trim_end_matches(".disabled")
            .trim_end_matches(".jar")
            .to_ascii_lowercase();
        if frame_lines.iter().any(|line| {
            line.starts_with("Mod File:")
                && line
                    .to_ascii_lowercase()
                    .contains(&mod_file.file_name.to_ascii_lowercase())
        }) {
            reasons.push(format!("Mod File entry names {}", mod_file.file_name));
        }
        for (index, frame) in stack_frames.iter().enumerate() {
            let package = frame
                .split('(')
                .next()
                .unwrap_or(frame)
                .to_ascii_lowercase();
            let matching_id = ids
                .iter()
                .filter(|id| {
                    id.len() >= 5
                        && !["common", "library", "client", "server", "coremod"]
                            .contains(&id.as_str())
                })
                .find(|id| package.split('.').any(|segment| segment == *id));
            let matching_stem = stem.len() >= 5
                && !["common", "library", "client", "server", "coremod"].contains(&stem.as_str())
                && package.split('.').any(|segment| segment == stem);
            let game_frame = package.starts_with("java.")
                || package.starts_with("javax.")
                || package.starts_with("sun.")
                || package.starts_with("net.minecraft.")
                || package.starts_with("net.fabricmc.")
                || package.starts_with("net.minecraftforge.")
                || package.starts_with("net.neoforged.")
                || package.starts_with("org.quiltmc.");
            if !game_frame && (matching_id.is_some() || matching_stem) {
                mapped_frames.insert(index);
                if reasons
                    .iter()
                    .filter(|reason| reason.starts_with("Appears in stack trace"))
                    .count()
                    < 2
                {
                    reasons.push(format!("Appears in stack trace: {frame}"));
                }
            }
        }
        if !reasons.is_empty() {
            scores.insert(mod_file.file_path.clone(), (reasons.len() as i32, reasons));
        }
    }

    // Expand one hop only from a mod with direct report evidence.
    let direct_paths = scores.keys().cloned().collect::<HashSet<_>>();
    for edge in &truth.relationships {
        if edge.kind != "required" || edge.resolution != RelationshipResolution::Installed {
            continue;
        }
        let Some(target) = &edge.target_file_path else {
            continue;
        };
        let related = if direct_paths.contains(&edge.source_file_path) {
            Some(target)
        } else if direct_paths.contains(target) {
            Some(&edge.source_file_path)
        } else {
            None
        };
        let Some(related) = related else { continue };
        if !enabled.iter().any(|item| &item.file_path == related) || direct_paths.contains(related)
        {
            continue;
        }
        let label = format!(
            "Possible relationship: declared required dependency {} → {}",
            edge.source_file_path, target
        );
        let entry = scores.entry(related.clone()).or_insert((0, Vec::new()));
        if !entry.1.contains(&label) {
            entry.1.push(label);
        }
    }

    let recent = backups
        .iter()
        .filter(|backup| backup.status == "applied" || backup.status == "restored")
        .filter(|backup| {
            chrono::DateTime::parse_from_rfc3339(&backup.created_at)
                .ok()
                .is_some_and(|date| chrono::Utc::now().signed_duration_since(date).num_days() <= 7)
        })
        .take(5)
        .collect::<Vec<_>>();
    for backup in &recent {
        for path in [&backup.old_file_path, &backup.new_file_path]
            .into_iter()
            .flatten()
        {
            if let Some((_, reasons)) = scores.get_mut(path) {
                reasons.push(format!(
                    "Recent Modly-managed {} on {} ({:?}) — context only",
                    if backup.status == "restored" {
                        "restore"
                    } else {
                        "change"
                    },
                    backup.created_at,
                    backup.kind
                ));
            }
        }
    }
    let mut candidates = scores
        .into_iter()
        .filter_map(|(path, (score, evidence))| {
            enabled
                .iter()
                .find(|item| item.file_path == path)
                .map(|item| {
                    (
                        score,
                        CrashCandidate {
                            file_path: path,
                            name: item
                                .observed
                                .as_ref()
                                .map(|metadata| metadata.name.clone())
                                .unwrap_or_else(|| item.file_name.clone()),
                            evidence,
                        },
                    )
                })
        })
        .collect::<Vec<_>>();
    candidates.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.name.cmp(&b.1.name)));
    candidates.truncate(12);
    let unmapped_frames = stack_frames
        .iter()
        .enumerate()
        .filter(|(index, _)| !mapped_frames.contains(index))
        .take(20)
        .map(|(_, frame)| frame.clone())
        .collect();

    CrashAnalysis {
        fingerprint,
        instance_id: instance.id.clone(),
        source_path: source_path.to_string(),
        analyzed_at: chrono::Utc::now().to_rfc3339(),
        exception_type: exception.map(|(_, (kind, _))| kind.to_string()),
        exception_message: exception
            .and_then(|(_, (_, message))| (!message.is_empty()).then(|| message.to_string())),
        stack_frames,
        stack_namespaces,
        unmapped_frames,
        mentioned_mod_ids: explicit_ids.into_iter().collect(),
        minecraft_version,
        loader: (instance.loader.as_str() != "unknown")
            .then(|| instance.loader.as_str().to_string()),
        loader_version,
        environment,
        candidates: candidates.into_iter().map(|(_, item)| item).collect(),
        recent_changes: recent
            .iter()
            .map(|backup| {
                format!(
                    "{}: {} {:?} {}",
                    backup.created_at,
                    if backup.status == "restored" {
                        "restored"
                    } else {
                        "applied"
                    },
                    backup.kind,
                    backup
                        .new_file_path
                        .as_deref()
                        .or(backup.old_file_path.as_deref())
                        .unwrap_or("unknown file")
                )
            })
            .collect(),
    }
}

fn field(lines: &[&str], labels: &[&str]) -> Option<String> {
    lines.iter().find_map(|line| {
        labels
            .iter()
            .find_map(|label| line.strip_prefix(label))
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    })
}

fn explicit_mod_ids(lines: &[&str]) -> HashSet<String> {
    lines
        .iter()
        .filter_map(|line| {
            if let Some(id) = line
                .strip_prefix("-- MOD ")
                .and_then(|value| value.strip_suffix(" --"))
            {
                return Some(id.trim().to_ascii_lowercase());
            }
            ["Mod ID:", "Mod Id:", "Mod id:"]
                .iter()
                .find_map(|prefix| line.strip_prefix(prefix))
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| {
                    value
                        .split_whitespace()
                        .next()
                        .unwrap_or(value)
                        .to_ascii_lowercase()
                })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::instance::{CreateInstanceInput, LoaderType};
    use crate::models::mod_metadata::{LoaderKind, ModMetadata, ModSide};
    use crate::models::pack_truth::{DeclaredRelationship, ObservedMod, ParseStatus};
    use crate::services::database::Database;

    fn instance() -> Instance {
        Instance {
            id: "pack".into(),
            name: "Pack".into(),
            game_dir: "unused".into(),
            loader: LoaderType::Fabric,
            mc_version: Some("1.20.1".into()),
            icon: None,
            resource_packs_path: None,
            shader_packs_path: None,
            data_packs_path: None,
            config_path: None,
            created_at: String::new(),
            updated_at: String::new(),
            mod_count: 0,
            enabled_mod_count: 0,
        }
    }

    fn installed(id: &str) -> ObservedMod {
        ObservedMod {
            file_name: format!("{id}.jar"),
            file_path: format!("mods/{id}.jar"),
            enabled: true,
            hash_sha256: None,
            manifest_path: Some("fabric.mod.json".into()),
            parse_status: ParseStatus::Parsed,
            parse_error: None,
            observed: Some(ModMetadata {
                name: id.into(),
                name_is_fallback: false,
                version: "1".into(),
                authors: vec![],
                modrinth_url: None,
                dependencies: vec![],
                loader: LoaderKind::Fabric,
                side: ModSide::Both,
                mod_id: Some(id.into()),
                provided_mod_ids: vec![],
                installed_modrinth_version_id: None,
                customized: false,
            }),
            minecraft_constraints: vec![],
            provider_enrichment: None,
            user_annotation: None,
        }
    }

    #[test]
    fn narrows_candidates_and_preserves_unmapped_frames() {
        let truth = PackTruth {
            instance_id: "pack".into(),
            mods: vec![
                installed("alpha"),
                installed("library"),
                installed("unrelated"),
            ],
            relationships: vec![DeclaredRelationship {
                source_file_path: "mods/alpha.jar".into(),
                target_mod_id: "library".into(),
                target_file_path: Some("mods/library.jar".into()),
                kind: "required".into(),
                version_range: None,
                side: None,
                manifest_path: "fabric.mod.json".into(),
                resolution: RelationshipResolution::Installed,
            }],
        };
        let report = "Minecraft Version: 1.20.1\nCaused by: java.lang.IllegalStateException: failed\n\tat com.alpha.Engine.start(Engine.java:7)\n\tat net.minecraft.Main.main(Main.java:1)\nMod ID: alpha";
        let result = analyze(report, &instance(), "crash.txt", "hash".into(), &truth, &[]);
        assert_eq!(
            result.exception_type.as_deref(),
            Some("java.lang.IllegalStateException")
        );
        assert_eq!(result.candidates.len(), 2);
        assert_eq!(result.candidates[0].name, "alpha");
        assert!(result.candidates[1].evidence[0].contains("Possible relationship"));
        assert_eq!(
            result.unmapped_frames,
            vec!["net.minecraft.Main.main(Main.java:1)"]
        );
    }

    #[test]
    fn parses_timestamped_log_without_guessing_a_mod() {
        let truth = PackTruth {
            instance_id: "pack".into(),
            mods: vec![installed("unrelated")],
            relationships: vec![],
        };
        let report = "[12:00:00] [Render thread/ERROR]: Caused by: java.lang.NullPointerException: missing\n[12:00:00] [Render thread/ERROR]: \tat net.minecraft.Main.main(Main.java:1)";
        let result = analyze(
            report,
            &instance(),
            "latest.log",
            "hash".into(),
            &truth,
            &[],
        );
        assert_eq!(
            result.exception_type.as_deref(),
            Some("java.lang.NullPointerException")
        );
        assert!(result.candidates.is_empty());
        assert_eq!(result.unmapped_frames.len(), 1);
    }

    #[test]
    fn disabled_mod_is_not_an_investigation_candidate() {
        let mut disabled = installed("alpha");
        disabled.enabled = false;
        let truth = PackTruth {
            instance_id: "pack".into(),
            mods: vec![disabled],
            relationships: vec![],
        };
        let result = analyze(
            "-- MOD alpha --\n\tat com.alpha.Main.run(Main.java:1)",
            &instance(),
            "crash.txt",
            "hash".into(),
            &truth,
            &[],
        );
        assert!(result.candidates.is_empty());
        assert_eq!(result.mentioned_mod_ids, vec!["alpha"]);
        assert_eq!(result.unmapped_frames.len(), 1);
    }

    #[test]
    fn latest_log_ignores_an_earlier_unrelated_stack() {
        let truth = PackTruth {
            instance_id: "pack".into(),
            mods: vec![installed("alpha"), installed("unrelated")],
            relationships: vec![],
        };
        let report = format!("java.lang.IllegalStateException: old\nMod ID: unrelated\n\tat com.unrelated.Main.run(Main.java:1)\n{}Exception in thread \"main\" java.lang.RuntimeException: current\n\tat com.alpha.Main.run(Main.java:2)", "[INFO] unrelated line\n".repeat(90));
        let result = analyze(
            &report,
            &instance(),
            "latest.log",
            "hash".into(),
            &truth,
            &[],
        );
        assert_eq!(
            result.exception_type.as_deref(),
            Some("java.lang.RuntimeException")
        );
        assert_eq!(result.candidates.len(), 1);
        assert_eq!(result.candidates[0].name, "alpha");
    }

    #[test]
    fn fingerprint_changes_with_content_hash_even_when_path_and_metadata_do_not() {
        let mut truth = PackTruth {
            instance_id: "pack".into(),
            mods: vec![installed("alpha")],
            relationships: vec![],
        };
        truth.mods[0].hash_sha256 = Some("first-hash".into());
        let first = fingerprint("same report", "crash.txt", &instance(), &[], &truth).unwrap();
        truth.mods[0].hash_sha256 = Some("second-hash".into());
        let second = fingerprint("same report", "crash.txt", &instance(), &[], &truth).unwrap();
        assert_ne!(first, second);
        truth.mods[0].enabled = false;
        assert_ne!(
            second,
            fingerprint("same report", "crash.txt", &instance(), &[], &truth).unwrap()
        );
    }

    #[test]
    fn saved_snapshot_rejects_same_size_same_timestamp_mod_changes() {
        let root = std::env::temp_dir().join(format!(
            "modly-crash-snapshot-test-{}",
            uuid::Uuid::new_v4()
        ));
        let mods = root.join("game/mods");
        fs::create_dir_all(&mods).unwrap();
        let db = Database::new(root.join("data")).unwrap();
        let instance = db
            .create_instance(CreateInstanceInput {
                name: "snapshot".into(),
                game_dir: root.join("game").to_string_lossy().to_string(),
                loader: LoaderType::Fabric,
                mc_version: Some("1.20.1".into()),
            })
            .unwrap();
        let state = AppState {
            db,
            app_data_dir: root.join("data"),
        };
        let jar = mods.join("example.jar");
        fs::write(&jar, b"first-content").unwrap();
        let original_modified = jar.metadata().unwrap().modified().unwrap();
        let report_path = root.join("crash.txt");
        fs::write(&report_path, b"Caused by: java.lang.IllegalStateException").unwrap();
        let report = read_report(&report_path).unwrap();
        let source_path = report_path.to_string_lossy().to_string();
        let truth = scan_pack_truth(&instance.id, &mods, &[]).unwrap();
        let key = fingerprint(&report, &source_path, &instance, &[], &truth).unwrap();
        state
            .db
            .save_crash_analysis(&analyze(
                &report,
                &instance,
                &source_path,
                key.clone(),
                &truth,
                &[],
            ))
            .unwrap();
        assert!(snapshot_current(&state, &instance.id, &key).unwrap());
        fs::write(&jar, b"other-content").unwrap();
        fs::OpenOptions::new()
            .write(true)
            .open(&jar)
            .unwrap()
            .set_times(std::fs::FileTimes::new().set_modified(original_modified))
            .unwrap();
        assert_eq!(jar.metadata().unwrap().len(), 13);
        assert!(!snapshot_current(&state, &instance.id, &key).unwrap());
        drop(state);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn malformed_empty_and_oversized_reports_degrade_predictably() {
        let root =
            std::env::temp_dir().join(format!("modly-crash-hardening-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("latest.log");
        fs::write(&path, [b'a', 0xff, b'b']).unwrap();
        assert!(read_report(&path).unwrap().contains('\u{fffd}'));
        let empty = analyze(
            "",
            &instance(),
            "crash.txt",
            "key".into(),
            &PackTruth {
                instance_id: "pack".into(),
                mods: vec![installed("alpha")],
                relationships: vec![],
            },
            &[],
        );
        assert!(empty.exception_type.is_none() && empty.candidates.is_empty());
        let file = fs::File::create(&path).unwrap();
        file.set_len(MAX_REPORT_BYTES + 1).unwrap();
        assert!(read_report(&path).unwrap_err().to_string().contains("8 MB"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn long_lines_and_generic_or_unrelated_frames_do_not_force_a_candidate() {
        let truth = PackTruth {
            instance_id: "pack".into(),
            mods: vec![installed("common"), installed("alpha")],
            relationships: vec![],
        };
        let report = format!("Caused by: java.lang.IllegalStateException: {}\n\tat net.minecraft.common.Main.run(Main.java:1)\n\tat com.example.common.Core.run(Core.java:2)", "x".repeat(100_000));
        let result = analyze(&report, &instance(), "crash.txt", "key".into(), &truth, &[]);
        assert!(result.exception_message.as_ref().unwrap().len() <= MAX_LINE_CHARS);
        assert!(result.candidates.is_empty());
        assert_eq!(result.unmapped_frames.len(), 2);
    }

    #[test]
    fn explicit_provided_id_maps_once_and_dependency_expansion_stops_after_one_hop() {
        let mut alpha = installed("alpha");
        alpha
            .observed
            .as_mut()
            .unwrap()
            .provided_mod_ids
            .push("alternatealpha".into());
        let truth = PackTruth {
            instance_id: "pack".into(),
            mods: vec![alpha, installed("library"), installed("third")],
            relationships: vec![
                DeclaredRelationship {
                    source_file_path: "mods/alpha.jar".into(),
                    target_mod_id: "library".into(),
                    target_file_path: Some("mods/library.jar".into()),
                    kind: "required".into(),
                    version_range: None,
                    side: None,
                    manifest_path: "fabric.mod.json".into(),
                    resolution: RelationshipResolution::Installed,
                },
                DeclaredRelationship {
                    source_file_path: "mods/library.jar".into(),
                    target_mod_id: "third".into(),
                    target_file_path: Some("mods/third.jar".into()),
                    kind: "required".into(),
                    version_range: None,
                    side: None,
                    manifest_path: "fabric.mod.json".into(),
                    resolution: RelationshipResolution::Installed,
                },
            ],
        };
        let result = analyze(
            "Mod ID: alternatealpha",
            &instance(),
            "crash.txt",
            "key".into(),
            &truth,
            &[],
        );
        assert_eq!(result.candidates.len(), 2);
        assert!(!result.candidates.iter().any(|item| item.name == "third"));
    }

    #[test]
    fn large_pack_keeps_candidate_set_narrow() {
        let truth = PackTruth {
            instance_id: "pack".into(),
            mods: (0..220)
                .map(|index| installed(&format!("mod{index:03}")))
                .collect(),
            relationships: vec![],
        };
        let result = analyze(
            "Mod ID: mod123\n\tat com.mod123.Core.run(Core.java:1)",
            &instance(),
            "crash.txt",
            "key".into(),
            &truth,
            &[],
        );
        assert_eq!(result.candidates.len(), 1);
        assert_eq!(result.candidates[0].name, "mod123");
    }
}
