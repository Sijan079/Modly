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

fn extract_version_from_filename(name: &str) -> Option<String> {
    name.split('-')
        .last()
        .map(|s| s.trim_end_matches(".jar").to_string())
}
