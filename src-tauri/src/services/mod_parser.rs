use std::io::Read;
use std::path::Path;

use anyhow::{Context, Result};
use serde::Deserialize;
use zip::ZipArchive;

use crate::models::mod_metadata::{modrinth_url_from_id, LoaderKind, ModDependency, ModMetadata};

pub fn parse_mod_jar(path: &Path) -> Result<ModMetadata> {
    let file = std::fs::File::open(path)
        .with_context(|| format!("Failed to open mod jar: {}", path.display()))?;
    let mut archive = ZipArchive::new(file)?;

    if let Some(meta) = try_parse_fabric(&mut archive)? {
        return Ok(finalize_metadata(meta));
    }

    let file = std::fs::File::open(path)?;
    let mut archive = ZipArchive::new(file)?;
    if let Some(meta) = try_parse_neoforge_forge(&mut archive)? {
        return Ok(finalize_metadata(meta));
    }

    let file = std::fs::File::open(path)?;
    let mut archive = ZipArchive::new(file)?;
    if let Some(meta) = try_parse_legacy_mcmod(&mut archive)? {
        return Ok(finalize_metadata(meta));
    }

    Ok(finalize_metadata(fallback_metadata(path)))
}

fn finalize_metadata(mut meta: ModMetadata) -> ModMetadata {
    if meta.modrinth_url.is_none() {
        if let Some(ref id) = meta.mod_id {
            let id = id.trim();
            if !id.is_empty() && !id.contains(' ') {
                meta.modrinth_url = Some(modrinth_url_from_id(id));
            }
        }
    }
    meta
}

fn try_parse_fabric(archive: &mut ZipArchive<std::fs::File>) -> Result<Option<ModMetadata>> {
    let mut fabric_json = String::new();
    if read_zip_entry(archive, "fabric.mod.json", &mut fabric_json).is_err() {
        return Ok(None);
    }

    #[derive(Deserialize)]
    struct FabricMod {
        id: Option<String>,
        name: Option<String>,
        version: Option<String>,
        description: Option<String>,
        authors: Option<Vec<FabricPerson>>,
        depends: Option<serde_json::Value>,
        suggests: Option<serde_json::Value>,
    }

    #[derive(Deserialize)]
    struct FabricPerson {
        name: Option<String>,
    }

    let parsed: FabricMod = serde_json::from_str(&fabric_json)?;
    let authors: Vec<String> = parsed
        .authors
        .unwrap_or_default()
        .into_iter()
        .filter_map(|a| a.name)
        .collect();

    let dependencies = extract_fabric_deps(parsed.depends, "depends")
        .into_iter()
        .chain(extract_fabric_deps(parsed.suggests, "suggests"))
        .collect();

    Ok(Some(ModMetadata {
        name: parsed.name.unwrap_or_else(|| "Unknown Mod".to_string()),
        version: parsed.version.unwrap_or_else(|| "?".to_string()),
        authors,
        modrinth_url: None,
        dependencies,
        loader: LoaderKind::Fabric,
        mod_id: parsed.id,
        installed_modrinth_version_id: None,
        customized: false,
    }))
}

fn extract_fabric_deps(value: Option<serde_json::Value>, kind: &str) -> Vec<ModDependency> {
    let Some(serde_json::Value::Object(map)) = value else {
        return vec![];
    };
    map.into_iter()
        .map(|(mod_id, version)| ModDependency {
            mod_id,
            version_range: match version {
                serde_json::Value::String(s) => Some(s),
                other => Some(other.to_string()),
            },
            kind: kind.to_string(),
        })
        .collect()
}

fn try_parse_neoforge_forge(
    archive: &mut ZipArchive<std::fs::File>,
) -> Result<Option<ModMetadata>> {
    // NeoForge-specific manifest first so we don't label NeoForge mods as Forge.
    let candidates = [
        ("META-INF/neoforge.mods.toml", LoaderKind::NeoForge),
        ("META-INF/mods.toml", LoaderKind::Forge),
    ];

    for (entry, default_loader) in candidates {
        let mut toml_content = String::new();
        if read_zip_entry(archive, entry, &mut toml_content).is_err() {
            continue;
        }
        let loader = detect_toml_loader(&toml_content).unwrap_or(default_loader);
        return Ok(Some(parse_mods_toml(&toml_content, loader)));
    }
    Ok(None)
}

fn detect_toml_loader(content: &str) -> Option<LoaderKind> {
    let lower = content.to_lowercase();
    if lower.contains("modloader=\"neoforge\"")
        || lower.contains("modloader = \"neoforge\"")
        || lower.contains("neoforge")
            && (lower.contains("modloader") || lower.contains("loaderversion"))
    {
        return Some(LoaderKind::NeoForge);
    }
    if lower.contains("modloader=\"forge\"") || lower.contains("modloader = \"forge\"") {
        return Some(LoaderKind::Forge);
    }
    None
}

fn parse_mods_toml(content: &str, loader: LoaderKind) -> ModMetadata {
    let mut name = "Unknown Mod".to_string();
    let mut version = "?".to_string();
    let mut mod_id = None;
    let mut authors = Vec::new();
    let mut in_mods_block = false;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed == "[[mods]]" {
            in_mods_block = true;
            continue;
        }
        if trimmed.starts_with("[[") && trimmed != "[[mods]]" {
            in_mods_block = false;
        }
        if !in_mods_block {
            continue;
        }
        if let Some((key, value)) = trimmed.split_once('=') {
            let key = key.trim();
            let value = value.trim().trim_matches('"');
            match key {
                "modId" => mod_id = Some(value.to_string()),
                "displayName" => name = value.to_string(),
                "version" => version = value.to_string(),
                "authors" => {
                    authors = value
                        .trim_matches(|c| c == '"' || c == '\'')
                        .split(',')
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                        .collect();
                }
                _ => {}
            }
        }
    }

    let loader = detect_toml_loader(content).unwrap_or(loader);

    ModMetadata {
        name,
        version,
        authors,
        modrinth_url: None,
        dependencies: vec![],
        loader,
        mod_id,
        installed_modrinth_version_id: None,
        customized: false,
    }
}

fn try_parse_legacy_mcmod(archive: &mut ZipArchive<std::fs::File>) -> Result<Option<ModMetadata>> {
    let mut content = String::new();
    if read_zip_entry(archive, "mcmod.info", &mut content).is_err() {
        return Ok(None);
    }

    #[derive(Deserialize)]
    struct McModInfo {
        modid: Option<String>,
        name: Option<String>,
        version: Option<String>,
        description: Option<String>,
        author: Option<String>,
    }

    let parsed: Vec<McModInfo> = serde_json::from_str(&content)?;
    let first = parsed.into_iter().next();
    Ok(first.map(|m| ModMetadata {
        name: m.name.unwrap_or_else(|| "Unknown Mod".to_string()),
        version: m.version.unwrap_or_else(|| "?".to_string()),
        authors: m.author.map(|a| vec![a]).unwrap_or_default(),
        modrinth_url: None,
        dependencies: vec![],
        loader: LoaderKind::Forge,
        mod_id: m.modid,
        installed_modrinth_version_id: None,
        customized: false,
    }))
}

fn read_zip_entry(
    archive: &mut ZipArchive<std::fs::File>,
    name: &str,
    out: &mut String,
) -> Result<()> {
    let mut file = archive.by_name(name)?;
    out.clear();
    file.read_to_string(out)?;
    Ok(())
}

fn fallback_metadata(path: &Path) -> ModMetadata {
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Unknown Mod");
    let (name, version) = split_name_and_version(stem);
    let loader = if stem.to_lowercase().contains("neoforge") {
        LoaderKind::NeoForge
    } else if stem.to_lowercase().contains("fabric") {
        LoaderKind::Fabric
    } else if stem.to_lowercase().contains("quilt") {
        LoaderKind::Quilt
    } else {
        LoaderKind::Unknown
    };
    ModMetadata {
        name,
        version,
        authors: vec![],
        modrinth_url: None,
        dependencies: vec![],
        loader,
        mod_id: None,
        installed_modrinth_version_id: None,
        customized: false,
    }
}

/// Split `modname-1.2.3` or `modname_1.20.1-2.0.0` into display name + version.
pub fn split_name_and_version(stem: &str) -> (String, String) {
    let parts: Vec<&str> = stem
        .split(&['-', '_'][..])
        .filter(|part| !part.trim().is_empty())
        .collect();
    if parts.len() < 2 {
        return (humanize_mod_name(stem), "?".to_string());
    }

    if let Some(version_index) = choose_version_index(&parts) {
        let name_parts = parts[..version_index]
            .iter()
            .copied()
            .filter(|part| !is_metadata_token(part))
            .collect::<Vec<_>>();
        let name = if name_parts.is_empty() {
            humanize_mod_name(stem)
        } else {
            humanize_mod_name(&name_parts.join("-"))
        };
        return (name, parts[version_index].to_string());
    }

    let name = parts
        .iter()
        .copied()
        .filter(|part| !is_metadata_token(part))
        .collect::<Vec<_>>();
    let name = if name.is_empty() {
        stem.to_string()
    } else {
        name.join("-")
    };
    (humanize_mod_name(&name), "?".to_string())
}

fn choose_version_index(parts: &[&str]) -> Option<usize> {
    for (index, part) in parts.iter().enumerate().rev() {
        if !looks_like_version(part) || is_minecraft_version_token(part) {
            continue;
        }
        return Some(index);
    }
    parts
        .iter()
        .enumerate()
        .rev()
        .find_map(|(index, part)| looks_like_version(part).then_some(index))
}

fn looks_like_version(s: &str) -> bool {
    if s.is_empty() {
        return false;
    }
    let s = s.trim_start_matches(['v', 'V']);
    s.chars()
        .next()
        .map(|c| c.is_ascii_digit())
        .unwrap_or(false)
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '+' || c == '-' || c == '_')
}

fn is_metadata_token(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    matches!(
        lower.as_str(),
        "fabric" | "forge" | "neoforge" | "quilt" | "common" | "client" | "server"
    ) || is_minecraft_version_token(value)
}

fn is_minecraft_version_token(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    let stripped = lower.strip_prefix("mc").unwrap_or(&lower);
    let parts: Vec<&str> = stripped.split('.').collect();
    parts.len() >= 2
        && parts.len() <= 3
        && parts
            .iter()
            .all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit()))
        && parts.first() == Some(&"1")
}

fn humanize_mod_name(s: &str) -> String {
    let s = s.replace(['-', '_'], " ");
    if s.is_empty() {
        return "Unknown Mod".to_string();
    }
    s.split_whitespace()
        .map(|w| {
            let mut c = w.chars();
            match c.next() {
                None => String::new(),
                Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::split_name_and_version;

    #[test]
    fn extracts_mod_version_from_loader_and_minecraft_tokens() {
        assert_eq!(
            split_name_and_version("sodium-fabric-0.5.11+mc1.20.1"),
            ("Sodium".to_string(), "0.5.11+mc1.20.1".to_string())
        );
        assert_eq!(
            split_name_and_version("ImmediatelyFast-Fabric-1.3.2+1.20.4"),
            ("ImmediatelyFast".to_string(), "1.3.2+1.20.4".to_string())
        );
    }

    #[test]
    fn extracts_simple_mod_version() {
        assert_eq!(
            split_name_and_version("modmenu-7.2.2"),
            ("Modmenu".to_string(), "7.2.2".to_string())
        );
    }

    #[test]
    fn prefers_mod_version_over_minecraft_version() {
        assert_eq!(
            split_name_and_version("journeymap-1.20.1-5.10.3-forge"),
            ("Journeymap".to_string(), "5.10.3".to_string())
        );
    }
}
