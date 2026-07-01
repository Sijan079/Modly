use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use walkdir::WalkDir;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::models::instance::Instance;
use crate::models::pack_item::PackType;

pub fn extract_zip(archive_path: &Path, dest_dir: &Path) -> Result<()> {
    fs::create_dir_all(dest_dir)?;
    let file = File::open(archive_path)?;
    let mut archive = ZipArchive::new(file)?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i)?;
        let outpath = match file.enclosed_name() {
            Some(path) => dest_dir.join(path),
            None => continue,
        };

        if file.name().ends_with('/') {
            fs::create_dir_all(&outpath)?;
        } else {
            if let Some(parent) = outpath.parent() {
                fs::create_dir_all(parent)?;
            }
            let mut outfile = File::create(&outpath)?;
            std::io::copy(&mut file, &mut outfile)?;
        }
    }
    Ok(())
}

pub fn create_zip(source_dir: &Path, output_path: &Path) -> Result<()> {
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let file = File::create(output_path)?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    for entry in WalkDir::new(source_dir).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        let name = path
            .strip_prefix(source_dir)
            .context("Invalid path prefix")?;
        let name_str = name.to_string_lossy().replace('\\', "/");

        if path.is_dir() {
            if !name_str.is_empty() {
                zip.add_directory(format!("{name_str}/"), options)?;
            }
        } else if path.is_file() {
            zip.start_file(name_str, options)?;
            let mut f = File::open(path)?;
            std::io::copy(&mut f, &mut zip)?;
        }
    }

    zip.finish()?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceExportOptions {
    pub include_mods: bool,
    pub include_configs: bool,
    pub include_resource_packs: bool,
    pub include_shader_packs: bool,
    pub include_datapacks: bool,
    pub include_manifest: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceExportResolvedPaths {
    pub mods: String,
    pub config: String,
    pub resourcepacks: String,
    pub shaderpacks: String,
    pub datapacks: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceExportOverrides {
    pub resource_packs_path: Option<String>,
    pub shader_packs_path: Option<String>,
    pub data_packs_path: Option<String>,
    pub config_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceExportSummary {
    pub mod_count: usize,
    pub config_file_count: usize,
    pub resource_pack_count: usize,
    pub shader_pack_count: usize,
    pub datapack_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceExportManifest {
    pub format_version: u32,
    pub instance_name: String,
    pub loader: String,
    pub minecraft_version: Option<String>,
    pub sections: InstanceExportOptions,
    pub resolved_source_paths: InstanceExportResolvedPaths,
    pub configured_overrides: InstanceExportOverrides,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportedInstanceMetadata {
    pub name: String,
    pub loader: String,
    pub minecraft_version: Option<String>,
    pub resource_packs_path: Option<String>,
    pub shader_packs_path: Option<String>,
    pub data_packs_path: Option<String>,
    pub config_path: Option<String>,
}

pub fn create_instance_export_zip(
    instance: &Instance,
    output_path: &Path,
    enabled_mod_paths: &[PathBuf],
    export_options: &InstanceExportOptions,
    manifest: &InstanceExportManifest,
) -> Result<()> {
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let file = File::create(output_path)?;
    let mut zip = ZipWriter::new(file);
    let zip_options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    let mods_dir = Path::new(&instance.game_dir).join("mods");
    let mut summary = InstanceExportSummary {
        mod_count: 0,
        config_file_count: 0,
        resource_pack_count: 0,
        shader_pack_count: 0,
        datapack_count: 0,
    };

    if export_options.include_configs {
        let config_path = instance.resolved_config_path();
        if config_path.exists() {
            summary.config_file_count =
                add_path_to_zip(&mut zip, &config_path, "config", zip_options)?;
        }
    }

    if export_options.include_resource_packs {
        let resource_packs_path = instance.resolved_pack_path(PackType::ResourcePack);
        if resource_packs_path.exists() {
            summary.resource_pack_count =
                add_path_to_zip(&mut zip, &resource_packs_path, "resourcepacks", zip_options)?;
        }
    }

    if export_options.include_shader_packs {
        let shader_packs_path = instance.resolved_pack_path(PackType::ShaderPack);
        if shader_packs_path.exists() {
            summary.shader_pack_count =
                add_path_to_zip(&mut zip, &shader_packs_path, "shaderpacks", zip_options)?;
        }
    }

    if export_options.include_datapacks {
        let datapacks_path = instance.resolved_pack_path(PackType::Datapack);
        if datapacks_path.exists() {
            summary.datapack_count =
                add_path_to_zip(&mut zip, &datapacks_path, "datapacks", zip_options)?;
        }
    }

    if export_options.include_mods && mods_dir.exists() {
        zip.add_directory("mods/", zip_options)?;
        for mod_path in enabled_mod_paths {
            if mod_path.exists() && mod_path.is_file() {
                add_file_to_zip(&mut zip, mod_path, &mods_dir, "mods", zip_options)?;
                summary.mod_count += 1;
            }
        }
    }

    if export_options.include_manifest {
        add_manifest_to_zip(&mut zip, manifest, &summary, zip_options)?;
    }

    zip.finish()?;
    Ok(())
}

fn add_path_to_zip(
    zip: &mut ZipWriter<File>,
    path: &Path,
    archive_root: &str,
    options: SimpleFileOptions,
) -> Result<usize> {
    let mut file_count = 0;
    for entry in WalkDir::new(path).into_iter().filter_map(|e| e.ok()) {
        let entry_path = entry.path();
        let name = match entry_path.strip_prefix(path) {
            Ok(name) => name,
            Err(_) => continue,
        };
        let name_str = normalize_archive_path(archive_root, name);

        if entry_path.is_dir() {
            if !name_str.is_empty() {
                zip.add_directory(format!("{name_str}/"), options)?;
            }
        } else if entry_path.is_file() {
            add_file_to_zip(zip, entry_path, path, archive_root, options)?;
            file_count += 1;
        }
    }

    Ok(file_count)
}

fn add_file_to_zip(
    zip: &mut ZipWriter<File>,
    file_path: &Path,
    source_dir: &Path,
    archive_root: &str,
    options: SimpleFileOptions,
) -> Result<()> {
    let name = file_path.strip_prefix(source_dir).unwrap_or(file_path);
    let name_str = normalize_archive_path(archive_root, name);

    zip.start_file(name_str, options)?;
    let mut f = File::open(file_path)?;
    std::io::copy(&mut f, zip)?;
    Ok(())
}

fn add_manifest_to_zip(
    zip: &mut ZipWriter<File>,
    manifest: &InstanceExportManifest,
    summary: &InstanceExportSummary,
    options: SimpleFileOptions,
) -> Result<()> {
    zip.start_file("modly-instance.json", options)?;
    let payload = serde_json::json!({
        "formatVersion": manifest.format_version,
        "instanceName": manifest.instance_name,
        "loader": manifest.loader,
        "minecraftVersion": manifest.minecraft_version,
        "sections": manifest.sections,
        "resolvedSourcePaths": manifest.resolved_source_paths,
        "configuredOverrides": manifest.configured_overrides,
        "summary": summary,
    });
    zip.write_all(serde_json::to_string_pretty(&payload)?.as_bytes())?;
    Ok(())
}

fn normalize_archive_path(root: &str, relative: &Path) -> String {
    let relative = relative.to_string_lossy().replace('\\', "/");
    if relative.is_empty() {
        root.to_string()
    } else {
        format!("{root}/{relative}")
    }
}

pub fn import_modpack_zip(archive_path: &Path, dest_dir: &Path) -> Result<PathBuf> {
    fs::create_dir_all(dest_dir)?;
    extract_zip(archive_path, dest_dir)?;
    Ok(dest_dir.to_path_buf())
}

pub fn read_imported_instance_metadata(dest_dir: &Path) -> Result<Option<ImportedInstanceMetadata>> {
    let manifest_path = dest_dir.join("modly-instance.json");
    if !manifest_path.exists() {
        return Ok(None);
    }

    let manifest: InstanceExportManifest = match serde_json::from_str(
        &fs::read_to_string(&manifest_path)?,
    ) {
        Ok(manifest) => manifest,
        Err(_) => return Ok(None),
    };

    Ok(Some(ImportedInstanceMetadata {
        name: manifest.instance_name,
        loader: manifest.loader,
        minecraft_version: manifest.minecraft_version,
        resource_packs_path: rebase_import_override(
            manifest.configured_overrides.resource_packs_path,
            &manifest.resolved_source_paths.resourcepacks,
            dest_dir,
            "resourcepacks",
        ),
        shader_packs_path: rebase_import_override(
            manifest.configured_overrides.shader_packs_path,
            &manifest.resolved_source_paths.shaderpacks,
            dest_dir,
            "shaderpacks",
        ),
        data_packs_path: rebase_import_override(
            manifest.configured_overrides.data_packs_path,
            &manifest.resolved_source_paths.datapacks,
            dest_dir,
            "datapacks",
        ),
        config_path: rebase_import_override(
            manifest.configured_overrides.config_path,
            &manifest.resolved_source_paths.config,
            dest_dir,
            "config",
        ),
    }))
}

fn rebase_import_override(
    override_path: Option<String>,
    resolved_source_path: &str,
    dest_dir: &Path,
    archive_folder: &str,
) -> Option<String> {
    let override_path = override_path?;
    let normalized_override = override_path.replace('/', "\\").to_lowercase();
    let normalized_resolved = resolved_source_path.replace('/', "\\").to_lowercase();

    if normalized_override == normalized_resolved {
        return Some(dest_dir.join(archive_folder).to_string_lossy().to_string());
    }

    Some(override_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::instance::LoaderType;
    use uuid::Uuid;

    fn test_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("modly-export-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).expect("test dir should exist");
        dir
    }

    fn write_file(path: &Path, contents: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("parent should exist");
        }
        fs::write(path, contents).expect("file should write");
    }

    fn sample_instance(root: &Path) -> Instance {
        let game_dir = root.join("instance");
        let resource_override = root.join("shared-resourcepacks");
        let shader_override = root.join("shared-shaderpacks");
        let datapack_override = root.join("shared-datapacks");
        let config_override = root.join("shared-config");

        write_file(&game_dir.join("mods/enabled-a.jar"), "enabled-a");
        write_file(&game_dir.join("mods/disabled-b.jar"), "disabled-b");
        write_file(&resource_override.join("fancy.zip"), "rp");
        write_file(&shader_override.join("shader-a.zip"), "sp");
        write_file(&datapack_override.join("datapack-a.zip"), "dp");
        write_file(&config_override.join("options.txt"), "cfg");

        Instance {
            id: "instance-id".to_string(),
            name: "Test Instance".to_string(),
            game_dir: game_dir.to_string_lossy().to_string(),
            loader: LoaderType::Fabric,
            mc_version: Some("1.20.1".to_string()),
            icon: None,
            resource_packs_path: Some(resource_override.to_string_lossy().to_string()),
            shader_packs_path: Some(shader_override.to_string_lossy().to_string()),
            data_packs_path: Some(datapack_override.to_string_lossy().to_string()),
            config_path: Some(config_override.to_string_lossy().to_string()),
            created_at: "now".to_string(),
            updated_at: "now".to_string(),
            mod_count: 2,
            enabled_mod_count: 1,
        }
    }

    fn sample_manifest(instance: &Instance, options: &InstanceExportOptions) -> InstanceExportManifest {
        InstanceExportManifest {
            format_version: 1,
            instance_name: instance.name.clone(),
            loader: instance.loader.as_str().to_string(),
            minecraft_version: instance.mc_version.clone(),
            sections: options.clone(),
            resolved_source_paths: InstanceExportResolvedPaths {
                mods: Path::new(&instance.game_dir)
                    .join("mods")
                    .to_string_lossy()
                    .to_string(),
                config: instance.resolved_config_path().to_string_lossy().to_string(),
                resourcepacks: instance
                    .resolved_pack_path(PackType::ResourcePack)
                    .to_string_lossy()
                    .to_string(),
                shaderpacks: instance
                    .resolved_pack_path(PackType::ShaderPack)
                    .to_string_lossy()
                    .to_string(),
                datapacks: instance
                    .resolved_pack_path(PackType::Datapack)
                    .to_string_lossy()
                    .to_string(),
            },
            configured_overrides: InstanceExportOverrides {
                resource_packs_path: instance.resource_packs_path.clone(),
                shader_packs_path: instance.shader_packs_path.clone(),
                data_packs_path: instance.data_packs_path.clone(),
                config_path: instance.config_path.clone(),
            },
        }
    }

    fn read_archive_entries(archive_path: &Path) -> Vec<String> {
        let file = File::open(archive_path).expect("archive should open");
        let mut archive = ZipArchive::new(file).expect("archive should parse");
        (0..archive.len())
            .map(|index| archive.by_index(index).expect("entry should load").name().to_string())
            .collect()
    }

    fn read_manifest(archive_path: &Path) -> serde_json::Value {
        let file = File::open(archive_path).expect("archive should open");
        let mut archive = ZipArchive::new(file).expect("archive should parse");
        let mut manifest = archive
            .by_name("modly-instance.json")
            .expect("manifest should exist");
        let mut contents = String::new();
        std::io::Read::read_to_string(&mut manifest, &mut contents).expect("manifest should read");
        serde_json::from_str(&contents).expect("manifest should parse")
    }

    #[test]
    fn export_uses_override_paths_and_manifest() {
        let root = test_dir();
        let instance = sample_instance(&root);
        let archive_path = root.join("export.zip");
        let options = InstanceExportOptions {
            include_mods: true,
            include_configs: true,
            include_resource_packs: true,
            include_shader_packs: true,
            include_datapacks: true,
            include_manifest: true,
        };
        let manifest = sample_manifest(&instance, &options);

        create_instance_export_zip(
            &instance,
            &archive_path,
            &[Path::new(&instance.game_dir).join("mods/enabled-a.jar")],
            &options,
            &manifest,
        )
        .expect("export should succeed");

        let entries = read_archive_entries(&archive_path);
        assert!(entries.contains(&"mods/".to_string()));
        assert!(entries.contains(&"mods/enabled-a.jar".to_string()));
        assert!(entries.contains(&"config/options.txt".to_string()));
        assert!(entries.contains(&"resourcepacks/fancy.zip".to_string()));
        assert!(entries.contains(&"shaderpacks/shader-a.zip".to_string()));
        assert!(entries.contains(&"datapacks/datapack-a.zip".to_string()));
        assert!(entries.contains(&"modly-instance.json".to_string()));
        assert!(!entries.contains(&"mods/disabled-b.jar".to_string()));

        let manifest_json = read_manifest(&archive_path);
        assert_eq!(manifest_json["instanceName"], "Test Instance");
        assert_eq!(manifest_json["sections"]["includeManifest"], true);
        assert_eq!(manifest_json["summary"]["modCount"], 1);
        assert_eq!(manifest_json["summary"]["configFileCount"], 1);
        assert_eq!(
            manifest_json["resolvedSourcePaths"]["datapacks"],
            instance.resolved_pack_path(PackType::Datapack).to_string_lossy().to_string()
        );
    }

    #[test]
    fn export_omits_unchecked_sections() {
        let root = test_dir();
        let instance = sample_instance(&root);
        let archive_path = root.join("export-minimal.zip");
        let options = InstanceExportOptions {
            include_mods: true,
            include_configs: false,
            include_resource_packs: false,
            include_shader_packs: false,
            include_datapacks: false,
            include_manifest: true,
        };
        let manifest = sample_manifest(&instance, &options);

        create_instance_export_zip(
            &instance,
            &archive_path,
            &[Path::new(&instance.game_dir).join("mods/enabled-a.jar")],
            &options,
            &manifest,
        )
        .expect("export should succeed");

        let entries = read_archive_entries(&archive_path);
        assert!(entries.contains(&"mods/enabled-a.jar".to_string()));
        assert!(!entries.iter().any(|entry| entry.starts_with("config/")));
        assert!(!entries.iter().any(|entry| entry.starts_with("resourcepacks/")));
        assert!(!entries.iter().any(|entry| entry.starts_with("shaderpacks/")));
        assert!(!entries.iter().any(|entry| entry.starts_with("datapacks/")));
        assert!(entries.contains(&"modly-instance.json".to_string()));
    }

    #[test]
    fn export_skips_manifest_when_not_requested() {
        let root = test_dir();
        let instance = sample_instance(&root);
        let archive_path = root.join("export-no-manifest.zip");
        let options = InstanceExportOptions {
            include_mods: false,
            include_configs: true,
            include_resource_packs: false,
            include_shader_packs: false,
            include_datapacks: false,
            include_manifest: false,
        };
        let manifest = sample_manifest(&instance, &options);

        create_instance_export_zip(&instance, &archive_path, &[], &options, &manifest)
            .expect("export should succeed");

        let entries = read_archive_entries(&archive_path);
        assert!(entries.contains(&"config/options.txt".to_string()));
        assert!(!entries.contains(&"modly-instance.json".to_string()));
    }

    #[test]
    fn import_metadata_restores_manifest_values_and_rebases_pack_local_paths() {
        let root = test_dir();
        let instance = sample_instance(&root);
        let extracted_dir = root.join("imported-pack");
        fs::create_dir_all(extracted_dir.join("resourcepacks")).expect("resourcepacks dir");
        fs::create_dir_all(extracted_dir.join("shaderpacks")).expect("shaderpacks dir");
        fs::create_dir_all(extracted_dir.join("datapacks")).expect("datapacks dir");
        fs::create_dir_all(extracted_dir.join("config")).expect("config dir");

        let manifest = sample_manifest(
            &instance,
            &InstanceExportOptions {
                include_mods: true,
                include_configs: true,
                include_resource_packs: true,
                include_shader_packs: true,
                include_datapacks: true,
                include_manifest: true,
            },
        );

        fs::write(
            extracted_dir.join("modly-instance.json"),
            serde_json::to_string_pretty(&manifest).expect("manifest should serialize"),
        )
        .expect("manifest should write");

        let metadata =
            read_imported_instance_metadata(&extracted_dir).expect("manifest should parse");
        let metadata = metadata.expect("metadata should exist");

        assert_eq!(metadata.name, "Test Instance");
        assert_eq!(metadata.loader, "fabric");
        assert_eq!(metadata.minecraft_version.as_deref(), Some("1.20.1"));
        assert_eq!(
            metadata.resource_packs_path.as_deref(),
            Some(extracted_dir.join("resourcepacks").to_string_lossy().as_ref())
        );
        assert_eq!(
            metadata.shader_packs_path.as_deref(),
            Some(extracted_dir.join("shaderpacks").to_string_lossy().as_ref())
        );
        assert_eq!(
            metadata.data_packs_path.as_deref(),
            Some(extracted_dir.join("datapacks").to_string_lossy().as_ref())
        );
        assert_eq!(
            metadata.config_path.as_deref(),
            Some(extracted_dir.join("config").to_string_lossy().as_ref())
        );
    }

    #[test]
    fn import_metadata_preserves_external_override_paths() {
        let root = test_dir();
        let extracted_dir = root.join("imported-pack");
        fs::create_dir_all(&extracted_dir).expect("import dir should exist");

        let manifest = InstanceExportManifest {
            format_version: 1,
            instance_name: "External Paths".to_string(),
            loader: "quilt".to_string(),
            minecraft_version: Some("1.21".to_string()),
            sections: InstanceExportOptions {
                include_mods: true,
                include_configs: true,
                include_resource_packs: true,
                include_shader_packs: true,
                include_datapacks: true,
                include_manifest: true,
            },
            resolved_source_paths: InstanceExportResolvedPaths {
                mods: "C:\\old\\mods".to_string(),
                config: "C:\\old\\config".to_string(),
                resourcepacks: "C:\\old\\resourcepacks".to_string(),
                shaderpacks: "C:\\old\\shaderpacks".to_string(),
                datapacks: "C:\\old\\datapacks".to_string(),
            },
            configured_overrides: InstanceExportOverrides {
                resource_packs_path: Some("D:\\shared\\resourcepacks".to_string()),
                shader_packs_path: Some("D:\\shared\\shaderpacks".to_string()),
                data_packs_path: Some("D:\\shared\\datapacks".to_string()),
                config_path: Some("D:\\shared\\config".to_string()),
            },
        };

        fs::write(
            extracted_dir.join("modly-instance.json"),
            serde_json::to_string_pretty(&manifest).expect("manifest should serialize"),
        )
        .expect("manifest should write");

        let metadata =
            read_imported_instance_metadata(&extracted_dir).expect("manifest should parse");
        let metadata = metadata.expect("metadata should exist");

        assert_eq!(
            metadata.resource_packs_path.as_deref(),
            Some("D:\\shared\\resourcepacks")
        );
        assert_eq!(
            metadata.shader_packs_path.as_deref(),
            Some("D:\\shared\\shaderpacks")
        );
        assert_eq!(
            metadata.data_packs_path.as_deref(),
            Some("D:\\shared\\datapacks")
        );
        assert_eq!(metadata.config_path.as_deref(), Some("D:\\shared\\config"));
    }

    #[test]
    fn import_metadata_falls_back_when_manifest_is_invalid() {
        let root = test_dir();
        let extracted_dir = root.join("invalid-import");
        fs::create_dir_all(&extracted_dir).expect("import dir should exist");
        fs::write(extracted_dir.join("modly-instance.json"), "{not valid json")
            .expect("invalid manifest should write");

        let metadata =
            read_imported_instance_metadata(&extracted_dir).expect("invalid manifest should not fail");
        assert!(metadata.is_none());
    }
}
