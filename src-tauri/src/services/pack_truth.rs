use std::collections::HashMap;
use std::io;
use std::path::Path;
use zip::ZipArchive;

use anyhow::Result;

use crate::models::mod_metadata::ModFile;
use crate::models::pack_truth::{
    DeclaredRelationship, ObservedMod, PackArchiveIssue, PackTruth, ParseStatus,
    ProviderEnrichment, RelationshipResolution, UserAnnotation,
};
use crate::services::hash_service::hash_file;
use crate::services::mod_parser::parse_mod_jar_observed;
use crate::services::scanner::scan_mods_directory;

pub fn verify_archive(path: &Path) -> Result<()> {
    let mut archive = ZipArchive::new(std::fs::File::open(path)?)?;
    if archive.is_empty() {
        anyhow::bail!("Archive has no entries");
    }
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index)?;
        if !entry.is_dir() {
            io::copy(&mut entry, &mut io::sink())?;
        }
    }
    Ok(())
}

pub fn scan_pack_integrity(mods_dir: &Path) -> Result<Vec<PackArchiveIssue>> {
    let mut issues = Vec::new();
    for path in scan_mods_directory(mods_dir)? {
        let result = verify_archive(&path);
        if let Err(error) = result {
            issues.push(PackArchiveIssue {
                file_path: path.to_string_lossy().to_string(),
                message: format!("Archive or entry cannot be read: {error}"),
            });
        }
    }
    Ok(issues)
}

pub fn scan_pack_truth(
    instance_id: &str,
    mods_dir: &Path,
    saved_mods: &[ModFile],
) -> Result<PackTruth> {
    let saved_by_path = saved_mods
        .iter()
        .map(|mod_file| (mod_file.file_path.as_str(), mod_file))
        .collect::<HashMap<_, _>>();
    let mut mods = Vec::new();

    for path in scan_mods_directory(mods_dir)? {
        let file_path = path.to_string_lossy().to_string();
        let file_name = path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_default();
        let saved = saved_by_path.get(file_path.as_str()).copied();
        let (observed, manifest_path, parse_status, parse_error) =
            match parse_mod_jar_observed(&path) {
                Ok(Some((metadata, manifest))) => (
                    Some(metadata),
                    Some(manifest.to_string()),
                    ParseStatus::Parsed,
                    None,
                ),
                Ok(None) => (None, None, ParseStatus::MissingManifest, None),
                Err(error) => (
                    None,
                    None,
                    ParseStatus::ParseFailed,
                    Some(error.to_string()),
                ),
            };
        let minecraft_constraints = observed
            .as_ref()
            .map(|metadata| {
                metadata
                    .dependencies
                    .iter()
                    .filter(|dependency| dependency.mod_id.eq_ignore_ascii_case("minecraft"))
                    .filter_map(|dependency| dependency.version_range.clone())
                    .collect()
            })
            .unwrap_or_default();
        let provider_enrichment = saved
            .and_then(|mod_file| mod_file.metadata.as_ref())
            .filter(|metadata| {
                !metadata.customized && metadata.installed_modrinth_version_id.is_some()
            })
            .map(|metadata| ProviderEnrichment {
                provider: "modrinth".to_string(),
                name: metadata.name.clone(),
                version: metadata.version.clone(),
                project_url: metadata.modrinth_url.clone(),
                version_id: metadata.installed_modrinth_version_id.clone(),
            });
        let user_annotation = saved.and_then(|mod_file| {
            let metadata = mod_file
                .metadata
                .as_ref()
                .filter(|metadata| metadata.customized)
                .cloned();
            if metadata.is_none()
                && mod_file.categories.is_empty()
                && mod_file.related_mods.is_empty()
            {
                None
            } else {
                Some(UserAnnotation {
                    metadata,
                    categories: mod_file.categories.clone(),
                    relationships: mod_file.related_mods.clone(),
                })
            }
        });

        mods.push(ObservedMod {
            file_name: file_name.clone(),
            file_path,
            enabled: !file_name.to_ascii_lowercase().ends_with(".disabled"),
            hash_sha256: hash_file(&path).ok(),
            manifest_path,
            parse_status,
            parse_error,
            observed,
            minecraft_constraints,
            provider_enrichment,
            user_annotation,
        });
    }

    let mut by_mod_id: HashMap<String, Vec<String>> = HashMap::new();
    for mod_file in &mods {
        if let Some(metadata) = &mod_file.observed {
            for mod_id in metadata
                .mod_id
                .iter()
                .chain(metadata.provided_mod_ids.iter())
            {
                let paths = by_mod_id.entry(mod_id.to_ascii_lowercase()).or_default();
                if !paths.contains(&mod_file.file_path) {
                    paths.push(mod_file.file_path.clone());
                }
            }
        }
    }

    let mut relationships = Vec::new();
    for source in &mods {
        let (Some(metadata), Some(manifest_path)) = (&source.observed, &source.manifest_path)
        else {
            continue;
        };
        for dependency in &metadata.dependencies {
            if dependency.mod_id.trim().is_empty() {
                continue;
            }
            let candidates = by_mod_id.get(&dependency.mod_id.to_ascii_lowercase());
            let (target_file_path, resolution) = if dependency.kind == "embedded" {
                (None, RelationshipResolution::Embedded)
            } else if matches!(
                dependency.mod_id.to_ascii_lowercase().as_str(),
                "minecraft" | "fabricloader" | "forge" | "neoforge" | "java"
            ) {
                (None, RelationshipResolution::External)
            } else {
                match candidates.map(Vec::as_slice).unwrap_or_default() {
                    [target] => (Some(target.clone()), RelationshipResolution::Installed),
                    [] => (None, RelationshipResolution::Missing),
                    _ => (None, RelationshipResolution::Ambiguous),
                }
            };
            relationships.push(DeclaredRelationship {
                source_file_path: source.file_path.clone(),
                target_mod_id: dependency.mod_id.clone(),
                target_file_path,
                kind: dependency.kind.clone(),
                version_range: dependency.version_range.clone(),
                side: dependency.side,
                manifest_path: manifest_path.clone(),
                resolution,
            });
        }
    }
    relationships.sort_by(|left, right| {
        (
            &left.source_file_path,
            &left.kind,
            &left.target_mod_id,
            &left.version_range,
        )
            .cmp(&(
                &right.source_file_path,
                &right.kind,
                &right.target_mod_id,
                &right.version_range,
            ))
    });

    Ok(PackTruth {
        instance_id: instance_id.to_string(),
        mods,
        relationships,
    })
}

#[cfg(test)]
mod tests {
    use std::fs::{self, File};
    use std::io::Write;
    use std::path::Path;

    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    use super::scan_pack_truth;
    use crate::models::mod_metadata::{LoaderKind, ModFile, ModMetadata, ModSide};
    use crate::models::pack_truth::{ParseStatus, RelationshipResolution};

    fn fixture_jar(path: &Path, entry: &str, content: &str) {
        let file = File::create(path).expect("fixture jar should be created");
        let mut zip = ZipWriter::new(file);
        zip.start_file(entry, SimpleFileOptions::default())
            .expect("manifest entry should be created");
        zip.write_all(content.as_bytes())
            .expect("manifest should be written");
        zip.finish().expect("fixture jar should finish");
    }

    fn saved_mod(path: &Path, metadata: ModMetadata) -> ModFile {
        ModFile {
            id: path.to_string_lossy().to_string(),
            instance_id: "fixture-pack".to_string(),
            file_name: path.file_name().unwrap().to_string_lossy().to_string(),
            file_path: path.to_string_lossy().to_string(),
            installed_at: "saved".to_string(),
            enabled: true,
            hash_sha256: None,
            source_url: None,
            metadata: Some(metadata),
            categories: vec![],
            related_mods: vec![],
        }
    }

    #[test]
    fn integrity_scan_detects_corrupt_entries_without_flagging_readable_jars() {
        let root = std::env::temp_dir().join(format!("modly-health-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let good = root.join("good.jar");
        let bad = root.join("bad.jar");
        for path in [&good, &bad] {
            let mut zip = ZipWriter::new(File::create(path).unwrap());
            zip.start_file(
                "payload.bin",
                SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored),
            )
            .unwrap();
            zip.write_all(b"unique-content-for-crc").unwrap();
            zip.finish().unwrap();
        }
        let mut bytes = fs::read(&bad).unwrap();
        let needle = b"unique-content-for-crc";
        let offset = bytes
            .windows(needle.len())
            .position(|window| window == needle)
            .unwrap();
        bytes[offset] = b'X';
        fs::write(&bad, bytes).unwrap();
        let issues = super::scan_pack_integrity(&root).unwrap();
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].file_path, bad.to_string_lossy());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn fixture_pack_is_deterministic_and_separates_observed_provider_and_user_facts() {
        let root = std::env::temp_dir().join(format!("modly-truth-{}", uuid::Uuid::new_v4()));
        let mods_dir = root.join("mods");
        fs::create_dir_all(&mods_dir).expect("fixture mods directory should be created");
        let fabric = mods_dir.join("a-fabric.jar");
        let forge = mods_dir.join("b-forge.jar");
        let neo = mods_dir.join("c-neoforge.jar");
        fixture_jar(
            &fabric,
            "fabric.mod.json",
            include_str!("../../tests/fixtures/phase1/fabric.mod.json"),
        );
        fixture_jar(
            &forge,
            "META-INF/mods.toml",
            include_str!("../../tests/fixtures/phase1/forge.mods.toml"),
        );
        fixture_jar(
            &neo,
            "META-INF/neoforge.mods.toml",
            include_str!("../../tests/fixtures/phase1/neoforge.mods.toml"),
        );
        fixture_jar(
            &mods_dir.join("d-invalid.jar"),
            "fabric.mod.json",
            "{invalid",
        );
        fixture_jar(&mods_dir.join("e-unknown.jar"), "readme.txt", "no manifest");
        let disabled_manifest = include_str!("../../tests/fixtures/phase1/fabric.mod.json")
            .replace("fabricexample", "disabledexample")
            .replace("fabric_alias", "disabled_alias");
        fixture_jar(
            &mods_dir.join("f-disabled.jar.disabled"),
            "fabric.mod.json",
            &disabled_manifest,
        );

        let mut provider_metadata = crate::services::mod_parser::parse_mod_jar(&fabric)
            .expect("fabric metadata should parse");
        provider_metadata.name = "Provider Name".to_string();
        provider_metadata.version = "9.9.9".to_string();
        provider_metadata.installed_modrinth_version_id = Some("version-id".to_string());
        provider_metadata.modrinth_url = Some("https://modrinth.com/mod/provider".to_string());

        let mut user_metadata = crate::services::mod_parser::parse_mod_jar(&forge)
            .expect("forge metadata should parse");
        user_metadata.name = "User Name".to_string();
        user_metadata.customized = true;

        let saved = vec![
            saved_mod(&fabric, provider_metadata),
            saved_mod(&forge, user_metadata),
        ];
        let first =
            scan_pack_truth("fixture-pack", &mods_dir, &saved).expect("fixture pack should scan");
        let second = scan_pack_truth("fixture-pack", &mods_dir, &saved)
            .expect("unchanged fixture pack should rescan");
        assert_eq!(
            serde_json::to_value(&first).unwrap(),
            serde_json::to_value(&second).unwrap()
        );
        assert_eq!(first.mods.len(), 6);
        assert_eq!(
            first
                .mods
                .iter()
                .map(|item| item.file_name.as_str())
                .collect::<Vec<_>>(),
            vec![
                "a-fabric.jar",
                "b-forge.jar",
                "c-neoforge.jar",
                "d-invalid.jar",
                "e-unknown.jar",
                "f-disabled.jar.disabled",
            ]
        );

        let fabric_mod = &first.mods[0];
        let observed = fabric_mod
            .observed
            .as_ref()
            .expect("manifest should be observed");
        assert_eq!(observed.name, "Fabric Example");
        assert_eq!(observed.version, "1.2.0");
        assert_eq!(observed.loader, LoaderKind::Fabric);
        assert_eq!(observed.side, ModSide::Client);
        assert_eq!(fabric_mod.minecraft_constraints, vec![">=1.20.1"]);
        assert_eq!(fabric_mod.manifest_path.as_deref(), Some("fabric.mod.json"));
        assert_eq!(
            fabric_mod.provider_enrichment.as_ref().unwrap().name,
            "Provider Name"
        );
        assert!(fabric_mod.user_annotation.is_none());
        assert_eq!(first.mods[1].observed.as_ref().unwrap().name, "Library Mod");
        assert_eq!(
            first.mods[1].observed.as_ref().unwrap().provided_mod_ids,
            vec!["secondarylib"]
        );
        assert_eq!(
            first.mods[1]
                .user_annotation
                .as_ref()
                .unwrap()
                .metadata
                .as_ref()
                .unwrap()
                .name,
            "User Name"
        );
        assert_eq!(first.mods[3].parse_status, ParseStatus::ParseFailed);
        assert!(first.mods[3].parse_error.is_some());
        assert_eq!(first.mods[4].parse_status, ParseStatus::MissingManifest);
        assert!(first.mods[4].observed.is_none());
        assert!(!first.mods[5].enabled);

        let requires_library = first
            .relationships
            .iter()
            .find(|edge| {
                edge.source_file_path == fabric.to_string_lossy()
                    && edge.target_mod_id == "librarymod"
            })
            .expect("declared required dependency should exist");
        assert_eq!(requires_library.kind, "required");
        assert_eq!(
            requires_library.resolution,
            RelationshipResolution::Installed
        );
        assert_eq!(
            requires_library.target_file_path.as_deref(),
            Some(forge.to_string_lossy().as_ref())
        );
        assert!(first
            .relationships
            .iter()
            .any(|edge| edge.kind == "recommended"));
        assert!(first
            .relationships
            .iter()
            .any(|edge| edge.kind == "suggested"));
        assert!(first
            .relationships
            .iter()
            .any(|edge| edge.kind == "incompatible"));
        assert!(first
            .relationships
            .iter()
            .any(|edge| edge.kind == "conflicting"));
        assert!(first
            .relationships
            .iter()
            .any(|edge| edge.kind == "embedded"));
        assert!(first.relationships.iter().any(|edge| {
            edge.source_file_path == neo.to_string_lossy()
                && edge.target_mod_id == "secondarylib"
                && edge.target_file_path.as_deref() == Some(forge.to_string_lossy().as_ref())
        }));
        assert!(first.relationships.iter().any(|edge| {
            edge.source_file_path == forge.to_string_lossy()
                && edge.target_mod_id == "fabric_alias"
                && edge.target_file_path.as_deref() == Some(fabric.to_string_lossy().as_ref())
        }));
        assert!(first.relationships.iter().any(|edge| {
            edge.target_mod_id == "minecraft" && edge.resolution == RelationshipResolution::External
        }));
        assert!(first.relationships.iter().any(|edge| {
            edge.source_file_path == neo.to_string_lossy()
                && edge.target_mod_id == "fabricexample"
                && edge.resolution == RelationshipResolution::Installed
        }));

        let forge_relationships = first.relationships_for(&forge.to_string_lossy());
        assert!(forge_relationships
            .outgoing
            .iter()
            .any(|edge| edge.target_mod_id == "optionalmod"));
        assert!(forge_relationships.outgoing.iter().any(|edge| {
            edge.target_mod_id == "optionalmod"
                && edge.kind == "optional"
                && edge.side == Some(ModSide::Client)
        }));
        assert!(first.relationships.iter().any(|edge| {
            edge.source_file_path == neo.to_string_lossy()
                && edge.target_mod_id == "oldmod"
                && edge.kind == "incompatible"
                && edge.resolution == RelationshipResolution::Missing
        }));
        assert!(forge_relationships
            .incoming
            .iter()
            .any(|edge| edge.target_mod_id == "librarymod"));
        assert!(forge_relationships
            .required_dependent_paths
            .iter()
            .any(|path| {
                path == &vec![
                    forge.to_string_lossy().to_string(),
                    fabric.to_string_lossy().to_string(),
                    neo.to_string_lossy().to_string(),
                ]
            }));
        let neo_relationships = first.relationships_for(&neo.to_string_lossy());
        assert!(neo_relationships
            .required_dependency_paths
            .iter()
            .any(|path| {
                path == &vec![
                    neo.to_string_lossy().to_string(),
                    fabric.to_string_lossy().to_string(),
                    forge.to_string_lossy().to_string(),
                ]
            }));
    }
}
