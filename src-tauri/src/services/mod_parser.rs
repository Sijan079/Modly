use std::io::Read;
use std::path::Path;

use anyhow::{Context, Result};
use serde::Deserialize;
use zip::ZipArchive;

use crate::models::mod_metadata::{
    modrinth_url_from_id, LoaderKind, ModDependency, ModMetadata, ModSide,
};

pub fn parse_mod_jar(path: &Path) -> Result<ModMetadata> {
    let file = std::fs::File::open(path)
        .with_context(|| format!("Failed to open mod jar: {}", path.display()))?;
    let mut archive = ZipArchive::new(file)?;

    if let Some(meta) = try_parse_fabric(&mut archive)? {
        return Ok(finalize_metadata(meta, path));
    }

    let file = std::fs::File::open(path)?;
    let mut archive = ZipArchive::new(file)?;
    if let Some(meta) = try_parse_neoforge_forge(&mut archive)? {
        return Ok(finalize_metadata(meta, path));
    }

    let file = std::fs::File::open(path)?;
    let mut archive = ZipArchive::new(file)?;
    if let Some(meta) = try_parse_legacy_mcmod(&mut archive)? {
        return Ok(finalize_metadata(meta, path));
    }

    Ok(finalize_metadata(fallback_metadata(path), path))
}

fn finalize_metadata(mut meta: ModMetadata, path: &Path) -> ModMetadata {
    if is_placeholder_name(&meta.name) {
        meta.name_is_fallback = true;
        meta.name = meta
            .mod_id
            .as_deref()
            .filter(|id| !id.trim().is_empty())
            .map(|id| humanize_mod_name(id.rsplit(':').next().unwrap_or(id)))
            .unwrap_or_else(|| {
                path.file_stem()
                    .and_then(|stem| stem.to_str())
                    .map(|stem| split_name_and_version(stem).0)
                    .unwrap_or_else(|| "Unknown Mod".to_string())
            });
    }
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

fn is_placeholder_name(value: &str) -> bool {
    value.trim().is_empty() || value.trim().eq_ignore_ascii_case("unknown mod")
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
        side: ModSide::Unknown,
        mod_id: parsed.id,
        installed_modrinth_version_id: None,
        customized: false,
        name_is_fallback: false,
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
    let mut dependencies = Vec::new();
    let mut in_mods_block = false;
    let mut dependency_owner = None::<String>;
    let mut current_dependency = None::<ModDependency>;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed == "[[mods]]" {
            in_mods_block = true;
            if let Some(dependency) = current_dependency.take() {
                dependencies.push(dependency);
            }
            continue;
        }
        if let Some(owner) = trimmed
            .strip_prefix("[[dependencies.")
            .and_then(|value| value.strip_suffix("]]"))
        {
            in_mods_block = false;
            if let Some(dependency) = current_dependency.take() {
                dependencies.push(dependency);
            }
            dependency_owner = Some(owner.trim().to_string());
            current_dependency = Some(ModDependency {
                mod_id: String::new(),
                version_range: None,
                kind: "required".to_string(),
            });
            continue;
        }
        if trimmed.starts_with("[[") && trimmed != "[[mods]]" {
            in_mods_block = false;
        }
        if let Some((key, value)) = trimmed.split_once('=') {
            let key = key.trim();
            let value = value.trim().trim_matches('"');
            if in_mods_block {
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
            } else if dependency_owner.as_deref() == mod_id.as_deref() {
                if let Some(dependency) = current_dependency.as_mut() {
                    match key {
                        "modId" => dependency.mod_id = value.to_string(),
                        "type" => dependency.kind = value.to_string(),
                        "versionRange" => dependency.version_range = Some(value.to_string()),
                        _ => {}
                    }
                }
            }
        }
    }

    if let Some(dependency) = current_dependency.take() {
        dependencies.push(dependency);
    }
    dependencies.retain(|dependency| !dependency.mod_id.trim().is_empty());

    let loader = detect_toml_loader(content).unwrap_or(loader);

    ModMetadata {
        name,
        version,
        authors,
        modrinth_url: None,
        dependencies,
        loader,
        side: ModSide::Unknown,
        mod_id,
        installed_modrinth_version_id: None,
        customized: false,
        name_is_fallback: false,
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
        side: ModSide::Unknown,
        mod_id: m.modid,
        installed_modrinth_version_id: None,
        customized: false,
        name_is_fallback: false,
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

/// Builds usable metadata from a file name when a JAR is unreadable or its embedded
/// metadata is malformed. Callers can then still enrich it through an exact hash match.
pub fn fallback_metadata(path: &Path) -> ModMetadata {
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
        side: ModSide::Unknown,
        mod_id: None,
        installed_modrinth_version_id: None,
        customized: false,
        name_is_fallback: true,
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
    ) || is_minecraft_version_token(value.trim_matches(['[', ']', '(', ')']))
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
        .map(split_camel_case)
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

fn split_camel_case(word: &str) -> String {
    let characters = word.chars().collect::<Vec<_>>();
    let mut result = String::with_capacity(word.len());

    for (index, character) in characters.iter().enumerate() {
        let previous = index.checked_sub(1).and_then(|i| characters.get(i));
        let next = characters.get(index + 1);
        let starts_new_word = character.is_uppercase()
            && previous.is_some_and(|previous| previous.is_lowercase() || previous.is_ascii_digit())
            || character.is_uppercase()
                && previous.is_some_and(|previous| previous.is_uppercase())
                && next.is_some_and(|next| next.is_lowercase());
        if starts_new_word {
            result.push(' ');
        }
        result.push(*character);
    }

    result
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::{finalize_metadata, parse_mods_toml, split_name_and_version};
    use crate::models::mod_metadata::{LoaderKind, ModMetadata, ModSide};

    #[test]
    fn replaces_unknown_display_names_with_the_mod_id() {
        let metadata = finalize_metadata(
            ModMetadata {
                name: "Unknown Mod".to_string(),
                version: "1.0.0".to_string(),
                authors: vec![],
                modrinth_url: None,
                dependencies: vec![],
                loader: LoaderKind::Fabric,
                side: ModSide::Unknown,
                mod_id: Some("example_mod".to_string()),
                installed_modrinth_version_id: None,
                customized: false,
                name_is_fallback: false,
            },
            Path::new("example-mod-1.0.0.jar"),
        );

        assert_eq!(metadata.name, "Example Mod");
    }

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
    fn normalizes_camel_case_filename_fallbacks() {
        assert_eq!(
            split_name_and_version("HopoBetterRuinedPortals-[1.21.1-1.21.3]-1.4.4b"),
            ("Hopo Better Ruined Portals".to_string(), "1.4.4b".to_string())
        );
        assert_eq!(
            split_name_and_version("better-trees-1.9.3"),
            ("Better Trees".to_string(), "1.9.3".to_string())
        );
    }

    #[test]
    fn prefers_mod_version_over_minecraft_version() {
        assert_eq!(
            split_name_and_version("journeymap-1.20.1-5.10.3-forge"),
            ("Journeymap".to_string(), "5.10.3".to_string())
        );
    }

    #[test]
    fn extracts_neoforge_dependencies_from_mods_toml() {
        let metadata = parse_mods_toml(
            r#"
modLoader = "neoforge"
loaderVersion = "[20,)"

[[mods]]
modId = "examplemod"
displayName = "Example Mod"
version = "1.0.0"
authors = "Alice, Bob"

[[dependencies.examplemod]]
modId = "minecraft"
type = "required"
versionRange = "[1.20.1]"

[[dependencies.examplemod]]
modId = "librarymod"
type = "required"
versionRange = "[2.0,)"
"#,
            LoaderKind::NeoForge,
        );

        assert_eq!(metadata.mod_id.as_deref(), Some("examplemod"));
        assert_eq!(metadata.loader, LoaderKind::NeoForge);
        assert_eq!(metadata.dependencies.len(), 2);
        assert!(metadata
            .dependencies
            .iter()
            .any(|dependency| dependency.mod_id == "librarymod"
                && dependency.kind == "required"
                && dependency.version_range.as_deref() == Some("[2.0,)")));
    }
}
