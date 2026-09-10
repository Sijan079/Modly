use std::path::{Path, PathBuf};

use anyhow::Result;
use walkdir::WalkDir;

use crate::models::instance::LoaderType;
use crate::models::scan::{
    DetectedLoader, DetectedPath, MinecraftScanResult, PathKind, ScanContentSummary,
};

pub fn default_minecraft_dir() -> Option<PathBuf> {
    dirs::data_dir().map(|d| d.join(".minecraft"))
}

pub fn scan_minecraft_directory(root: &Path) -> Result<MinecraftScanResult> {
    let mut detected_paths = Vec::new();
    let mut loaders = Vec::new();
    let mut content = ScanContentSummary::default();

    if !root.exists() {
        return Ok(MinecraftScanResult {
            minecraft_dir: None,
            detected_paths,
            loaders,
            content,
        });
    }

    let subdirs = [
        ("mods", PathKind::Mods),
        ("resourcepacks", PathKind::ResourcePacks),
        ("shaderpacks", PathKind::ShaderPacks),
        ("datapacks", PathKind::Datapacks),
        ("saves", PathKind::Saves),
        ("versions", PathKind::Versions),
    ];

    for (name, kind) in subdirs {
        let path = root.join(name);
        if path.exists() {
            let count = count_entries(&path);
            match kind {
                PathKind::Mods => content.mod_count = count,
                PathKind::ResourcePacks => content.resource_pack_count = count,
                PathKind::ShaderPacks => content.shader_pack_count = count,
                PathKind::Datapacks => content.datapack_count = count,
                PathKind::Saves => content.save_count = count,
                _ => {}
            }
            detected_paths.push(DetectedPath {
                path: path.to_string_lossy().to_string(),
                kind,
                file_count: count,
            });
        }
    }

    detected_paths.push(DetectedPath {
        path: root.to_string_lossy().to_string(),
        kind: PathKind::MinecraftRoot,
        file_count: count_entries(root),
    });

    loaders.extend(detect_loaders(root));

    Ok(MinecraftScanResult {
        minecraft_dir: Some(root.to_string_lossy().to_string()),
        detected_paths,
        loaders,
        content,
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstanceMetadataGuess {
    pub name: String,
    pub loader: LoaderType,
    pub mc_version: Option<String>,
}

/// Infers sensible initial instance metadata from an existing game directory.
pub fn infer_instance_metadata(root: &Path) -> InstanceMetadataGuess {
    let name = root
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or("Minecraft Instance")
        .to_string();
    let loaders = detect_loaders(root);
    let loader = loaders
        .first()
        .map(|detected| detected.loader)
        .unwrap_or(LoaderType::Unknown);
    let mc_version = loaders
        .iter()
        .find_map(|detected| {
            detected
                .version
                .as_deref()
                .and_then(extract_minecraft_version)
                .or_else(|| extract_minecraft_version(&detected.path))
        })
        .or_else(|| find_minecraft_version_in_versions_dir(root));

    InstanceMetadataGuess {
        name,
        loader,
        mc_version,
    }
}

pub fn scan_mods_directory(mods_dir: &Path) -> Result<Vec<PathBuf>> {
    if !mods_dir.exists() {
        return Ok(vec![]);
    }
    let mut jars = Vec::new();
    for entry in WalkDir::new(mods_dir)
        .max_depth(2)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if path.is_file() {
            if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                if ext.eq_ignore_ascii_case("jar") {
                    jars.push(path.to_path_buf());
                }
            }
        }
    }
    jars.sort();
    Ok(jars)
}

fn count_entries(path: &Path) -> u64 {
    if !path.exists() {
        return 0;
    }
    if path.is_file() {
        return 1;
    }
    walkdir::WalkDir::new(path)
        .min_depth(1)
        .max_depth(1)
        .into_iter()
        .filter(|e| e.as_ref().map(|x| x.file_type().is_file()).unwrap_or(false))
        .count() as u64
}

fn detect_loaders(root: &Path) -> Vec<DetectedLoader> {
    let mut loaders = Vec::new();
    let mods_dir = root.join("mods");

    if mods_dir.exists() {
        for entry in WalkDir::new(&mods_dir)
            .max_depth(1)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            let name = entry.file_name().to_string_lossy().to_lowercase();
            if name.starts_with("fabric-api") || name.contains("fabric") {
                loaders.push(DetectedLoader {
                    loader: LoaderType::Fabric,
                    version: extract_version_from_filename(&name),
                    path: entry.path().to_string_lossy().to_string(),
                });
                break;
            }
            if name.starts_with("quilt") {
                loaders.push(DetectedLoader {
                    loader: LoaderType::Quilt,
                    version: extract_version_from_filename(&name),
                    path: entry.path().to_string_lossy().to_string(),
                });
                break;
            }
            if name.contains("neoforge") {
                loaders.push(DetectedLoader {
                    loader: LoaderType::NeoForge,
                    version: extract_minecraft_version(&name),
                    path: entry.path().to_string_lossy().to_string(),
                });
                break;
            }
            if name.contains("forge") {
                loaders.push(DetectedLoader {
                    loader: LoaderType::Forge,
                    version: extract_minecraft_version(&name),
                    path: entry.path().to_string_lossy().to_string(),
                });
                break;
            }
        }
    }

    let versions_dir = root.join("versions");
    if versions_dir.exists() {
        for entry in std::fs::read_dir(&versions_dir)
            .into_iter()
            .flatten()
            .flatten()
        {
            let name = entry.file_name().to_string_lossy().to_lowercase();
            if name.contains("forge") && !name.contains("neoforge") {
                loaders.push(DetectedLoader {
                    loader: LoaderType::Forge,
                    version: Some(name.clone()),
                    path: entry.path().to_string_lossy().to_string(),
                });
            }
            if name.contains("neoforge") {
                loaders.push(DetectedLoader {
                    loader: LoaderType::NeoForge,
                    version: Some(name.clone()),
                    path: entry.path().to_string_lossy().to_string(),
                });
            }
            if name.contains("fabric") {
                loaders.push(DetectedLoader {
                    loader: LoaderType::Fabric,
                    version: Some(name.clone()),
                    path: entry.path().to_string_lossy().to_string(),
                });
            }
            if name.contains("quilt") {
                loaders.push(DetectedLoader {
                    loader: LoaderType::Quilt,
                    version: Some(name.clone()),
                    path: entry.path().to_string_lossy().to_string(),
                });
            }
        }
    }

    if loaders.is_empty() {
        loaders.push(DetectedLoader {
            loader: LoaderType::Vanilla,
            version: None,
            path: root.to_string_lossy().to_string(),
        });
    }

    loaders
}

fn find_minecraft_version_in_versions_dir(root: &Path) -> Option<String> {
    let entries = std::fs::read_dir(root.join("versions")).ok()?;
    entries
        .flatten()
        .find_map(|entry| extract_minecraft_version(&entry.file_name().to_string_lossy()))
}

fn extract_minecraft_version(value: &str) -> Option<String> {
    let chars = value.chars().collect::<Vec<_>>();
    for start in 0..chars.len() {
        if chars.get(start) != Some(&'1') || chars.get(start + 1) != Some(&'.') {
            continue;
        }
        let end = chars[start..]
            .iter()
            .take_while(|character| character.is_ascii_digit() || **character == '.')
            .count()
            + start;
        let candidate = chars[start..end].iter().collect::<String>();
        let parts = candidate.split('.').collect::<Vec<_>>();
        if (2..=3).contains(&parts.len())
            && parts.iter().all(|part| {
                !part.is_empty() && part.chars().all(|character| character.is_ascii_digit())
            })
        {
            return Some(candidate);
        }
    }
    None
}

fn extract_version_from_filename(name: &str) -> Option<String> {
    name.split('-')
        .last()
        .map(|s| s.trim_end_matches(".jar").to_string())
}

#[cfg(test)]
mod tests {
    use super::{infer_instance_metadata, scan_minecraft_directory};
    use crate::models::instance::LoaderType;
    use std::fs;
    use uuid::Uuid;

    #[test]
    fn detects_datapacks_folder_and_counts_entries() {
        let root = std::env::temp_dir().join(format!("modly-scan-test-{}", Uuid::new_v4()));
        fs::create_dir_all(root.join("datapacks")).expect("datapacks dir should exist");
        fs::write(root.join("datapacks").join("example.zip"), b"zip").expect("file should exist");

        let result = scan_minecraft_directory(&root).expect("scan should succeed");

        assert_eq!(result.content.datapack_count, 1);
        assert!(result
            .detected_paths
            .iter()
            .any(|path| matches!(path.kind, crate::models::scan::PathKind::Datapacks)));

        fs::remove_dir_all(root).expect("temp dir should be removed");
    }

    #[test]
    fn infers_metadata_from_mod_filename_and_folder_name() {
        let root = std::env::temp_dir().join(format!("My NeoForge Pack-{}", Uuid::new_v4()));
        fs::create_dir_all(root.join("mods")).expect("mods directory should exist");
        fs::write(
            root.join("mods").join("example-neoforge-1.21.1-1.0.0.jar"),
            b"jar",
        )
        .expect("mod file should exist");

        let guess = infer_instance_metadata(&root);

        assert_eq!(guess.name, root.file_name().unwrap().to_string_lossy());
        assert_eq!(guess.loader, LoaderType::NeoForge);
        assert_eq!(guess.mc_version.as_deref(), Some("1.21.1"));

        fs::remove_dir_all(root).expect("temp dir should be removed");
    }
}
