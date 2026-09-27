use std::path::{Path, PathBuf};

use anyhow::{bail, Result};
use uuid::Uuid;

use crate::models::mod_metadata::LoaderKind;
use crate::models::scout::{
    classify_mod, minecraft_dependency_version, ScoutAnalysis, ScoutInstalledMod,
    ScoutParseFailure, ScoutTarget,
};
use crate::services::hash_service::{hash_file, hash_file_sha512};
use crate::services::mod_parser::parse_mod_jar;
use crate::services::scanner::scan_mods_directory;

pub fn resolve_mods_path(path: &Path) -> Result<PathBuf> {
    if !path.exists() || !path.is_dir() {
        bail!("Choose an existing Minecraft directory or mods directory.");
    }
    let mods_path = if path
        .file_name()
        .is_some_and(|name| name.eq_ignore_ascii_case("mods"))
    {
        path.to_path_buf()
    } else {
        path.join("mods")
    };
    if !mods_path.is_dir() {
        bail!("No mods directory was found at {}", path.display());
    }
    Ok(mods_path)
}

pub fn analyze_target(
    target: &ScoutTarget,
    minecraft_version: Option<String>,
    loader: LoaderKind,
) -> Result<ScoutAnalysis> {
    let jar_paths = scan_mods_directory(Path::new(&target.mods_path))?;
    let mut mods = Vec::new();
    let mut failures = Vec::new();
    let mut detected_version = minecraft_version;
    let mut detected_loader = loader;

    for jar_path in jar_paths {
        let file_name = jar_path
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_default();
        match parse_mod_jar(&jar_path) {
            Ok(metadata) => {
                let hash_sha512 = match hash_file_sha512(&jar_path) {
                    Ok(hash) => hash,
                    Err(error) => {
                        failures.push(ScoutParseFailure {
                            file_name,
                            message: format!("Could not hash JAR: {error}"),
                        });
                        continue;
                    }
                };
                if detected_loader == LoaderKind::Unknown && metadata.loader != LoaderKind::Unknown
                {
                    detected_loader = metadata.loader;
                }
                if detected_version.is_none() {
                    detected_version = minecraft_dependency_version(&metadata.dependencies);
                }
                mods.push(ScoutInstalledMod {
                    file_name,
                    file_path: jar_path.to_string_lossy().to_string(),
                    classification: classify_mod(&metadata),
                    hash_sha512,
                    hash_sha256: hash_file(&jar_path).ok(),
                    provider_metadata: None,
                    metadata,
                });
            }
            Err(error) => failures.push(ScoutParseFailure {
                file_name,
                message: error.to_string(),
            }),
        }
    }

    let total_jars = mods.len() + failures.len();
    Ok(ScoutAnalysis {
        id: Uuid::new_v4().to_string(),
        target_id: target.id.clone(),
        minecraft_version: detected_version,
        loader: detected_loader,
        scanned_at: chrono::Utc::now().to_rfc3339(),
        total_jars,
        parsed_mods: mods.len(),
        failed_mods: failures.len(),
        mods,
        failures,
        provider_cache_hits: 0,
        provider_fetches: 0,
        provider_warning: None,
    })
}

#[cfg(test)]
mod tests {
    use super::resolve_mods_path;
    use std::fs;
    use uuid::Uuid;

    #[test]
    fn resolves_a_game_directory_or_its_mods_directory() {
        let root = std::env::temp_dir().join(format!("modly-scout-{}", Uuid::new_v4()));
        let mods = root.join("mods");
        fs::create_dir_all(&mods).expect("mods directory should be created");
        assert_eq!(
            resolve_mods_path(&root).expect("game root should resolve"),
            mods
        );
        assert_eq!(
            resolve_mods_path(&mods).expect("mods path should resolve"),
            mods
        );
        fs::remove_dir_all(root).expect("temporary directory should be removed");
    }
}
