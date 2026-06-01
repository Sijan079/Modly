use std::fs::{self, File};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use walkdir::WalkDir;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

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

pub fn create_instance_export_zip(
    source_dir: &Path,
    output_path: &Path,
    enabled_mod_paths: &[PathBuf],
) -> Result<()> {
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let file = File::create(output_path)?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    for folder in ["config", "resourcepacks", "shaderpacks"] {
        let path = source_dir.join(folder);
        if path.exists() {
            add_path_to_zip(&mut zip, &path, source_dir, options)?;
        }
    }

    let mods_dir = source_dir.join("mods");
    if mods_dir.exists() {
        zip.add_directory("mods/", options)?;
    }
    for mod_path in enabled_mod_paths {
        if mod_path.exists() && mod_path.is_file() {
            add_file_to_zip(&mut zip, mod_path, source_dir, options)?;
        }
    }

    zip.finish()?;
    Ok(())
}

fn add_path_to_zip(
    zip: &mut ZipWriter<File>,
    path: &Path,
    source_dir: &Path,
    options: SimpleFileOptions,
) -> Result<()> {
    for entry in WalkDir::new(path).into_iter().filter_map(|e| e.ok()) {
        let entry_path = entry.path();
        let name = entry_path
            .strip_prefix(source_dir)
            .context("Invalid path prefix")?;
        let name_str = name.to_string_lossy().replace('\\', "/");

        if entry_path.is_dir() {
            if !name_str.is_empty() {
                zip.add_directory(format!("{name_str}/"), options)?;
            }
        } else if entry_path.is_file() {
            add_file_to_zip(zip, entry_path, source_dir, options)?;
        }
    }

    Ok(())
}

fn add_file_to_zip(
    zip: &mut ZipWriter<File>,
    file_path: &Path,
    source_dir: &Path,
    options: SimpleFileOptions,
) -> Result<()> {
    let name = file_path
        .strip_prefix(source_dir)
        .context("Invalid path prefix")?;
    let name_str = name.to_string_lossy().replace('\\', "/");

    zip.start_file(name_str, options)?;
    let mut f = File::open(file_path)?;
    std::io::copy(&mut f, zip)?;
    Ok(())
}

pub fn import_modpack_zip(archive_path: &Path, dest_dir: &Path) -> Result<PathBuf> {
    fs::create_dir_all(dest_dir)?;
    extract_zip(archive_path, dest_dir)?;
    Ok(dest_dir.to_path_buf())
}
