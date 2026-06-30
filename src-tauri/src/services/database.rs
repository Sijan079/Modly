use std::path::PathBuf;
use std::sync::Mutex;

use anyhow::{Context, Result};
use rusqlite::{params, Connection};
use serde_json::Value;
use uuid::Uuid;

use crate::models::category::{
    CreateCategoryInput, DeleteCategoryInput, DeleteCategoryMode, InstanceCategory,
};
use crate::models::instance::{CreateInstanceInput, Instance, LoaderType, UpdateInstanceInput};
use crate::models::launch::LaunchConfig;
use crate::models::mod_metadata::{
    ModFile, ModIntegrityAudit, ModIntegrityAuditStatus, ModIntegrityReport, ModMetadata,
    ModRelationshipEdge, ModRelationshipType, ModRelationshipsForMod, ModSide, ModSuggestion,
    UpdateModMetadataInput, UpdateModRelationshipInput, UpsertModSuggestionInput,
};
use crate::models::pack_item::{PackItem, PackItemMetadata, PackType, UpdatePackItemMetadataInput};
use crate::models::settings::AppSettings;
use crate::models::updates::{SavedUpdateCheck, UpdateRow};

pub struct Database {
    conn: Mutex<Connection>,
}

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS instances (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    game_dir TEXT NOT NULL UNIQUE,
    loader TEXT NOT NULL DEFAULT 'unknown',
    mc_version TEXT,
    icon TEXT,
    resource_packs_path TEXT,
    shader_packs_path TEXT,
    data_packs_path TEXT,
    config_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mods (
    id TEXT PRIMARY KEY NOT NULL,
    instance_id TEXT NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    installed_at TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    hash_sha256 TEXT,
    source_url TEXT,
    metadata_json TEXT,
    UNIQUE(instance_id, file_path)
);

CREATE TABLE IF NOT EXISTS mod_suggestions (
    id TEXT PRIMARY KEY NOT NULL,
    instance_id TEXT NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    hash_sha256 TEXT,
    source_url TEXT,
    metadata_json TEXT
);

CREATE TABLE IF NOT EXISTS launch_configs (
    id TEXT PRIMARY KEY NOT NULL,
    instance_id TEXT NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    java_path TEXT NOT NULL,
    min_memory_mb INTEGER NOT NULL DEFAULT 512,
    max_memory_mb INTEGER NOT NULL DEFAULT 4096,
    jvm_args TEXT NOT NULL DEFAULT '',
    game_args TEXT NOT NULL DEFAULT '',
    wrapper_command TEXT
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT NOT NULL,
    message TEXT NOT NULL,
    context TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS instance_categories (
    id TEXT PRIMARY KEY NOT NULL,
    instance_id TEXT NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    UNIQUE(instance_id, name)
);

CREATE TABLE IF NOT EXISTS mod_category_tags (
    mod_id TEXT NOT NULL REFERENCES mods(id) ON DELETE CASCADE,
    category_id TEXT NOT NULL REFERENCES instance_categories(id) ON DELETE CASCADE,
    PRIMARY KEY (mod_id, category_id)
);

CREATE TABLE IF NOT EXISTS mod_suggestion_category_tags (
    suggestion_id TEXT NOT NULL REFERENCES mod_suggestions(id) ON DELETE CASCADE,
    category_id TEXT NOT NULL REFERENCES instance_categories(id) ON DELETE CASCADE,
    PRIMARY KEY (suggestion_id, category_id)
);

CREATE TABLE IF NOT EXISTS mod_relationships (
    id TEXT PRIMARY KEY NOT NULL,
    instance_id TEXT NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    source_mod_id TEXT NOT NULL REFERENCES mods(id) ON DELETE CASCADE,
    target_mod_id TEXT NOT NULL REFERENCES mods(id) ON DELETE CASCADE,
    relationship_type TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(source_mod_id, target_mod_id)
);

CREATE TABLE IF NOT EXISTS pack_items (
    id TEXT PRIMARY KEY NOT NULL,
    instance_id TEXT NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    pack_type TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    is_dir INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    hash_sha256 TEXT,
    metadata_json TEXT,
    UNIQUE(instance_id, pack_type, file_path)
);

CREATE TABLE IF NOT EXISTS mod_integrity_audits (
    instance_id TEXT PRIMARY KEY NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    audited_at TEXT NOT NULL,
    total_mods INTEGER NOT NULL,
    healthy_mods INTEGER NOT NULL,
    corrupted_mods INTEGER NOT NULL,
    status TEXT NOT NULL,
    reports_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS update_checks (
    instance_id TEXT PRIMARY KEY NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    checked_at TEXT NOT NULL,
    rows_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mods_instance ON mods(instance_id);
CREATE INDEX IF NOT EXISTS idx_mod_suggestions_instance ON mod_suggestions(instance_id);
CREATE INDEX IF NOT EXISTS idx_mod_suggestion_categories ON mod_suggestion_category_tags(suggestion_id);
CREATE INDEX IF NOT EXISTS idx_mod_relationships_source ON mod_relationships(source_mod_id);
CREATE INDEX IF NOT EXISTS idx_mod_relationships_target ON mod_relationships(target_mod_id);
CREATE INDEX IF NOT EXISTS idx_pack_items_instance ON pack_items(instance_id, pack_type);
CREATE INDEX IF NOT EXISTS idx_categories_instance ON instance_categories(instance_id);
CREATE INDEX IF NOT EXISTS idx_logs_created ON logs(created_at DESC);
"#;

fn ensure_column(conn: &Connection, table: &str, column: &str, definition: &str) -> Result<()> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let columns = stmt.query_map([], |row| row.get::<_, String>(1))?;
    for existing in columns {
        if existing? == column {
            return Ok(());
        }
    }
    conn.execute(
        &format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"),
        [],
    )?;
    Ok(())
}

fn reset_legacy_mod_side_defaults(conn: &Connection) -> Result<()> {
    let already_reset: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM settings WHERE key = 'reset_mod_side_defaults_v1')",
        [],
        |row| row.get(0),
    )?;
    if already_reset {
        return Ok(());
    }

    let mut stmt = conn.prepare("SELECT id, metadata_json FROM mods WHERE metadata_json IS NOT NULL")?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;

    for row in rows {
        let (id, metadata_json) = row?;
        let Ok(mut value) = serde_json::from_str::<Value>(&metadata_json) else {
            continue;
        };
        let Some(side) = value.get("side").and_then(|entry| entry.as_str()) else {
            continue;
        };
        if side != "both" {
            continue;
        }
        if let Some(object) = value.as_object_mut() {
            object.insert("side".to_string(), Value::String("unknown".to_string()));
            conn.execute(
                "UPDATE mods SET metadata_json = ?1 WHERE id = ?2",
                params![serde_json::to_string(&value)?, id],
            )?;
        }
    }

    conn.execute(
        "INSERT INTO settings (key, value) VALUES ('reset_mod_side_defaults_v1', 'true')",
        [],
    )?;
    Ok(())
}

impl Database {
    pub fn new(app_data_dir: PathBuf) -> Result<Self> {
        std::fs::create_dir_all(&app_data_dir)?;
        let db_path = app_data_dir.join("modpack_manager.db");
        let conn = Connection::open(&db_path)
            .with_context(|| format!("Failed to open database at {}", db_path.display()))?;
        conn.execute("PRAGMA foreign_keys = ON", [])?;
        conn.execute_batch(SCHEMA)?;
        ensure_column(&conn, "instances", "resource_packs_path", "TEXT")?;
        ensure_column(&conn, "instances", "shader_packs_path", "TEXT")?;
        ensure_column(&conn, "instances", "data_packs_path", "TEXT")?;
        ensure_column(&conn, "instances", "config_path", "TEXT")?;
        ensure_column(&conn, "mods", "source_url", "TEXT")?;
        ensure_column(&conn, "mods", "installed_at", "TEXT NOT NULL DEFAULT ''")?;
        conn.execute(
            "UPDATE mods SET installed_at = COALESCE(NULLIF(installed_at, ''), CURRENT_TIMESTAMP)",
            [],
        )?;
        reset_legacy_mod_side_defaults(&conn)?;
        ensure_column(&conn, "pack_items", "hash_sha256", "TEXT")?;
        let cleared_pack_update_cache: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM settings WHERE key = 'cleared_pack_update_cache_v1')",
            [],
            |row| row.get(0),
        )?;
        if !cleared_pack_update_cache {
            conn.execute("DELETE FROM update_checks", [])?;
            conn.execute(
                "INSERT INTO settings (key, value) VALUES ('cleared_pack_update_cache_v1', 'true')",
                [],
            )?;
        }
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn get_settings(&self) -> Result<AppSettings> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{e}"))?;
        let mut settings = AppSettings::default();
        let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        for row in rows {
            let (key, value) = row?;
            match key.as_str() {
                "minecraft_dir" => settings.minecraft_dir = Some(value),
                "instances_dir" => settings.instances_dir = Some(value),
                "default_java_path" => settings.default_java_path = Some(value),
                "default_max_memory_mb" => {
                    settings.default_max_memory_mb = value.parse().unwrap_or(4096)
                }
                "export_modpack_dir" => settings.export_modpack_dir = non_empty_setting(value),
                "export_modlist_dir" => settings.export_modlist_dir = non_empty_setting(value),
                "auto_scan_on_instance_add" => settings.auto_scan_on_instance_add = value == "true",
                "auto_scan_after_mod_add" => settings.auto_scan_after_mod_add = value == "true",
                "auto_audit_after_scan" => settings.auto_audit_after_scan = value == "true",
                "audit_stale_days" => settings.audit_stale_days = value.parse().unwrap_or(7),
                "include_disabled_mods_in_exports" => {
                    settings.include_disabled_mods_in_exports = value == "true"
                }
                "include_audit_in_exports" => settings.include_audit_in_exports = value == "true",
                "theme" => settings.theme = value,
                "last_instance_id" => settings.last_instance_id = Some(value),
                "modrinth_enabled" => settings.modrinth_enabled = value == "true",
                "curseforge_enabled" => settings.curseforge_enabled = value == "true",
                _ => {}
            }
        }
        Ok(settings)
    }

    pub fn save_settings(&self, settings: &AppSettings) -> Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{e}"))?;
        let pairs: Vec<(&str, String)> = vec![
            (
                "minecraft_dir",
                settings.minecraft_dir.clone().unwrap_or_default(),
            ),
            (
                "instances_dir",
                settings.instances_dir.clone().unwrap_or_default(),
            ),
            (
                "default_java_path",
                settings.default_java_path.clone().unwrap_or_default(),
            ),
            (
                "default_max_memory_mb",
                settings.default_max_memory_mb.to_string(),
            ),
            (
                "export_modpack_dir",
                settings.export_modpack_dir.clone().unwrap_or_default(),
            ),
            (
                "export_modlist_dir",
                settings.export_modlist_dir.clone().unwrap_or_default(),
            ),
            (
                "auto_scan_on_instance_add",
                settings.auto_scan_on_instance_add.to_string(),
            ),
            (
                "auto_scan_after_mod_add",
                settings.auto_scan_after_mod_add.to_string(),
            ),
            (
                "auto_audit_after_scan",
                settings.auto_audit_after_scan.to_string(),
            ),
            ("audit_stale_days", settings.audit_stale_days.to_string()),
            (
                "include_disabled_mods_in_exports",
                settings.include_disabled_mods_in_exports.to_string(),
            ),
            (
                "include_audit_in_exports",
                settings.include_audit_in_exports.to_string(),
            ),
            ("theme", settings.theme.clone()),
            (
                "last_instance_id",
                settings.last_instance_id.clone().unwrap_or_default(),
            ),
            ("modrinth_enabled", settings.modrinth_enabled.to_string()),
            (
                "curseforge_enabled",
                settings.curseforge_enabled.to_string(),
            ),
        ];
        for (key, value) in pairs {
            conn.execute(
                "INSERT INTO settings (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![key, value],
            )?;
        }
        Ok(())
    }

    pub fn list_instances(&self) -> Result<Vec<Instance>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{e}"))?;
        let mut stmt = conn.prepare(
            "SELECT i.id, i.name, i.game_dir, i.loader, i.mc_version, i.icon,
                    i.resource_packs_path, i.shader_packs_path, i.data_packs_path, i.config_path,
                    i.created_at, i.updated_at,
                    (SELECT COUNT(*) FROM mods m WHERE m.instance_id = i.id) as mod_count,
                    (SELECT COUNT(*) FROM mods m WHERE m.instance_id = i.id AND m.enabled = 1) as enabled_mod_count
             FROM instances i ORDER BY i.updated_at DESC",
        )?;
        let instances = stmt
            .query_map([], |row| {
                Ok(Instance {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    game_dir: row.get(2)?,
                    loader: LoaderType::from_str(&row.get::<_, String>(3)?),
                    mc_version: row.get(4)?,
                    icon: row.get(5)?,
                    resource_packs_path: row.get(6)?,
                    shader_packs_path: row.get(7)?,
                    data_packs_path: row.get(8)?,
                    config_path: row.get(9)?,
                    created_at: row.get(10)?,
                    updated_at: row.get(11)?,
                    mod_count: row.get(12)?,
                    enabled_mod_count: row.get(13)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(instances)
    }

    pub fn get_instance(&self, id: &str) -> Result<Option<Instance>> {
        Ok(self.list_instances()?.into_iter().find(|i| i.id == id))
    }

    pub fn create_instance(&self, input: CreateInstanceInput) -> Result<Instance> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{e}"))?;
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO instances (
                id, name, game_dir, loader, mc_version,
                resource_packs_path, shader_packs_path, data_packs_path, config_path,
                created_at, updated_at
             )
             VALUES (?1, ?2, ?3, ?4, ?5, NULL, NULL, NULL, NULL, ?6, ?7)",
            params![
                id,
                input.name,
                input.game_dir,
                input.loader.as_str(),
                input.mc_version,
                now,
                now
            ],
        )?;
        drop(conn);
        self.get_instance(&id)
            .and_then(|opt| opt.ok_or_else(|| anyhow::anyhow!("Instance not found after create")))
    }

    pub fn update_instance(&self, input: UpdateInstanceInput) -> Result<Instance> {
        let existing = self
            .get_instance(&input.id)?
            .ok_or_else(|| anyhow::anyhow!("Instance not found"))?;
        let name = input.name.unwrap_or(existing.name);
        let game_dir = input.game_dir.unwrap_or(existing.game_dir);
        let loader = input.loader.unwrap_or(existing.loader);
        let mc_version = input.mc_version.or(existing.mc_version);
        let resource_packs_path = input
            .resource_packs_path
            .unwrap_or(existing.resource_packs_path);
        let shader_packs_path = input
            .shader_packs_path
            .unwrap_or(existing.shader_packs_path);
        let data_packs_path = input
            .data_packs_path
            .unwrap_or(existing.data_packs_path);
        let config_path = input.config_path.unwrap_or(existing.config_path);
        let now = chrono::Utc::now().to_rfc3339();
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{e}"))?;
        conn.execute(
            "UPDATE instances
             SET name = ?1, game_dir = ?2, loader = ?3, mc_version = ?4,
                 resource_packs_path = ?5, shader_packs_path = ?6, data_packs_path = ?7, config_path = ?8,
                 updated_at = ?9
             WHERE id = ?10",
            params![
                name,
                game_dir,
                loader.as_str(),
                mc_version,
                resource_packs_path,
                shader_packs_path,
                data_packs_path,
                config_path,
                now,
                input.id
            ],
        )?;
        drop(conn);
        self.get_instance(&input.id)?
            .ok_or_else(|| anyhow::anyhow!("Instance not found after update"))
    }

    pub fn delete_instance(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{e}"))?;
        conn.execute("DELETE FROM instances WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn duplicate_instance(
        &self,
        id: &str,
        new_name: &str,
        new_game_dir: &str,
    ) -> Result<Instance> {
        let source = self
            .get_instance(id)?
            .ok_or_else(|| anyhow::anyhow!("Source instance not found"))?;
        std::fs::create_dir_all(new_game_dir)?;
        copy_dir_recursive(&source.game_dir, new_game_dir)?;
        self.create_instance(CreateInstanceInput {
            name: new_name.to_string(),
            game_dir: new_game_dir.to_string(),
            loader: source.loader,
            mc_version: source.mc_version,
        })
    }

    pub fn list_mods(&self, instance_id: &str) -> Result<Vec<ModFile>> {
        let mods = {
            let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{e}"))?;
            let mut stmt = conn.prepare(
                "SELECT id, instance_id, file_name, file_path, installed_at, enabled, hash_sha256, source_url, metadata_json
                 FROM mods WHERE instance_id = ?1 ORDER BY file_name",
            )?;
            let rows = stmt.query_map(params![instance_id], |row| Self::row_to_mod_file(row))?;
            rows.collect::<Result<Vec<_>, _>>()?
        };
        self.attach_mod_details(mods)
    }

    fn row_to_mod_file(row: &rusqlite::Row<'_>) -> rusqlite::Result<ModFile> {
        let metadata_json: Option<String> = row.get(8)?;
        let metadata = metadata_json
            .as_ref()
            .and_then(|j| serde_json::from_str(j).ok());
        Ok(ModFile {
            id: row.get(0)?,
            instance_id: row.get(1)?,
            file_name: row.get(2)?,
            file_path: row.get(3)?,
            installed_at: row.get(4)?,
            enabled: row.get::<_, i32>(5)? != 0,
            hash_sha256: row.get(6)?,
            source_url: row.get(7)?,
            metadata,
            categories: vec![],
            related_mods: vec![],
        })
    }

    fn attach_mod_details(&self, mut mods: Vec<ModFile>) -> Result<Vec<ModFile>> {
        if mods.is_empty() {
            return Ok(mods);
        }
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{e}"))?;
        let mut categories_stmt = conn.prepare(
            "SELECT mct.mod_id, ic.id, ic.instance_id, ic.name
             FROM mod_category_tags mct
             JOIN instance_categories ic ON ic.id = mct.category_id
             WHERE mct.mod_id = ?1
             ORDER BY ic.name",
        )?;
        let mut relationships_stmt = conn.prepare(
            "SELECT target_mod_id, relationship_type
             FROM mod_relationships
             WHERE source_mod_id = ?1
             ORDER BY created_at ASC, id ASC",
        )?;

        for m in &mut mods {
            let tags = categories_stmt
                .query_map(params![m.id.clone()], |row| {
                    Ok(InstanceCategory {
                        id: row.get(1)?,
                        instance_id: row.get(2)?,
                        name: row.get(3)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            m.categories = tags;
            m.related_mods = relationships_stmt
                .query_map(params![m.id.clone()], |row| {
                    Ok(UpdateModRelationshipInput {
                        target_mod_id: row.get(0)?,
                        relationship_type: ModRelationshipType::from_str(&row.get::<_, String>(1)?),
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
        }
        Ok(mods)
    }

    pub fn get_mod_by_path(&self, instance_id: &str, file_path: &str) -> Result<Option<ModFile>> {
        let mod_file = {
            let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{e}"))?;
            let mut stmt = conn.prepare(
                "SELECT id, instance_id, file_name, file_path, installed_at, enabled, hash_sha256, source_url, metadata_json
                 FROM mods WHERE instance_id = ?1 AND file_path = ?2",
            )?;
            let mut rows =
                stmt.query_map(params![instance_id, file_path], Self::row_to_mod_file)?;
            rows.next().transpose()?
        };
        Ok(match mod_file {
            Some(m) => self.attach_mod_details(vec![m])?.into_iter().next(),
            None => None,
        })
    }

    pub fn get_mod_by_id(&self, mod_id: &str) -> Result<Option<ModFile>> {
        let mod_file = {
            let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{e}"))?;
            let mut stmt = conn.prepare(
                "SELECT id, instance_id, file_name, file_path, installed_at, enabled, hash_sha256, source_url, metadata_json
                 FROM mods WHERE id = ?1",
            )?;
            let mut rows = stmt.query_map(params![mod_id], Self::row_to_mod_file)?;
            rows.next().transpose()?
        };
        Ok(match mod_file {
            Some(m) => self.attach_mod_details(vec![m])?.into_iter().next(),
            None => None,
        })
    }

    pub fn upsert_mod(&self, mod_file: &ModFile) -> Result<()> {
        let existing = self.get_mod_by_path(&mod_file.instance_id, &mod_file.file_path)?;
        let now = chrono::Utc::now().to_rfc3339();
        let (id, installed_at, source_url, metadata) = if let Some(existing) = existing {
            let keep_metadata = existing
                .metadata
                .as_ref()
                .map(|m| m.customized)
                .unwrap_or(false);
            let metadata = if keep_metadata {
                existing.metadata
            } else {
                mod_file.metadata.clone()
            };
            let source_url = mod_file.source_url.clone().or(existing.source_url);
            let installed_at = if mod_file.installed_at.trim().is_empty() {
                existing.installed_at
            } else {
                mod_file.installed_at.clone()
            };
            (existing.id, installed_at, source_url, metadata)
        } else {
            (
                mod_file.id.clone(),
                if mod_file.installed_at.trim().is_empty() {
                    now
                } else {
                    mod_file.installed_at.clone()
                },
                normalize_url(mod_file.source_url.clone()),
                mod_file.metadata.clone(),
            )
        };

        let metadata_json = metadata
            .as_ref()
            .map(|m| serde_json::to_string(m))
            .transpose()?;
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{e}"))?;
        conn.execute(
            "INSERT INTO mods (id, instance_id, file_name, file_path, installed_at, enabled, hash_sha256, source_url, metadata_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(instance_id, file_path) DO UPDATE SET
               file_name = excluded.file_name,
               enabled = excluded.enabled,
               hash_sha256 = excluded.hash_sha256,
               source_url = excluded.source_url,
               metadata_json = excluded.metadata_json",
            params![
                id,
                mod_file.instance_id,
                mod_file.file_name,
                mod_file.file_path,
                installed_at,
                mod_file.enabled as i32,
                mod_file.hash_sha256,
                source_url,
                metadata_json
            ],
        )?;
        Ok(())
    }

    pub fn update_mod_metadata(&self, input: &UpdateModMetadataInput) -> Result<ModFile> {
        let existing = self
            .get_mod_by_id(&input.mod_id)?
            .ok_or_else(|| anyhow::anyhow!("Mod not found"))?;

        let metadata = ModMetadata {
            name: input.name.clone(),
            version: input.version.clone(),
            authors: input.authors.clone(),
            modrinth_url: normalize_modrinth_url(input.modrinth_url.clone()),
            dependencies: existing
                .metadata
                .as_ref()
                .map(|m| m.dependencies.clone())
                .unwrap_or_default(),
            loader: input.loader,
            side: input.side,
            mod_id: input.mod_id_field.clone(),
            installed_modrinth_version_id: input.installed_modrinth_version_id.clone(),
            customized: true,
        };
        let source_url = normalize_url(
            input
                .source_url
                .clone()
                .or_else(|| input.modrinth_url.clone()),
        );

        let metadata_json = serde_json::to_string(&metadata)?;
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{e}"))?;
        conn.execute(
            "UPDATE mods SET source_url = ?1, metadata_json = ?2 WHERE id = ?3",
            params![source_url, metadata_json, input.mod_id],
        )?;
        drop(conn);

        self.set_mod_categories(&input.mod_id, &input.category_ids)?;
        self.replace_mod_relationships(&input.mod_id, &input.related_mods)?;

        self.get_mod_by_id(&input.mod_id)?
            .ok_or_else(|| anyhow::anyhow!("Mod not found after update"))
    }

    pub fn get_mod_relationships(&self, mod_id: &str) -> Result<ModRelationshipsForMod> {
        let source = self
            .get_mod_by_id(mod_id)?
            .ok_or_else(|| anyhow::anyhow!("Mod not found"))?;
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{e}"))?;
        let outgoing = {
            let mut stmt = conn.prepare(
                "SELECT
                    mr.id,
                    mr.instance_id,
                    mr.source_mod_id,
                    COALESCE(json_extract(source.metadata_json, '$.name'), source.file_name),
                    mr.target_mod_id,
                    COALESCE(json_extract(target.metadata_json, '$.name'), target.file_name),
                    mr.relationship_type,
                    mr.created_at
                 FROM mod_relationships mr
                 JOIN mods source ON source.id = mr.source_mod_id
                 JOIN mods target ON target.id = mr.target_mod_id
                 WHERE mr.source_mod_id = ?1
                 ORDER BY mr.created_at ASC, mr.id ASC",
            )?;
            let rows = stmt.query_map(params![mod_id], Self::row_to_mod_relationship_edge)?;
            rows.collect::<Result<Vec<_>, _>>()?
        };
        let incoming = {
            let mut stmt = conn.prepare(
                "SELECT
                    mr.id,
                    mr.instance_id,
                    mr.source_mod_id,
                    COALESCE(json_extract(source.metadata_json, '$.name'), source.file_name),
                    mr.target_mod_id,
                    COALESCE(json_extract(target.metadata_json, '$.name'), target.file_name),
                    mr.relationship_type,
                    mr.created_at
                 FROM mod_relationships mr
                 JOIN mods source ON source.id = mr.source_mod_id
                 JOIN mods target ON target.id = mr.target_mod_id
                 WHERE mr.target_mod_id = ?1
                 ORDER BY mr.created_at ASC, mr.id ASC",
            )?;
            let rows = stmt.query_map(params![mod_id], Self::row_to_mod_relationship_edge)?;
            rows.collect::<Result<Vec<_>, _>>()?
        };
        Ok(ModRelationshipsForMod {
            mod_id: source.id,
            outgoing,
            incoming,
        })
    }

    pub fn replace_mod_relationships(
        &self,
        mod_id: &str,
        related_mods: &[UpdateModRelationshipInput],
    ) -> Result<()> {
        let source = self
            .get_mod_by_id(mod_id)?
            .ok_or_else(|| anyhow::anyhow!("Mod not found"))?;

        let mut seen_targets = std::collections::HashSet::new();
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{e}"))?;
        let tx = conn.unchecked_transaction()?;
        tx.execute(
            "DELETE FROM mod_relationships WHERE source_mod_id = ?1",
            params![mod_id],
        )?;

        for related_mod in related_mods {
            let target_id = related_mod.target_mod_id.trim();
            if target_id.is_empty() {
                continue;
            }
            if target_id == mod_id {
                anyhow::bail!("A mod cannot relate to itself");
            }
            if !seen_targets.insert(target_id.to_string()) {
                anyhow::bail!("A mod can only have one relationship per target mod");
            }

            let target: (String, String) = tx
                .query_row(
                    "SELECT id, instance_id FROM mods WHERE id = ?1",
                    params![target_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .map_err(|_| anyhow::anyhow!("Related mod not found"))?;

            if target.1 != source.instance_id {
                anyhow::bail!("Related mods must belong to the same instance");
            }

            tx.execute(
                "INSERT INTO mod_relationships (id, instance_id, source_mod_id, target_mod_id, relationship_type, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, CURRENT_TIMESTAMP)",
                params![
                    Uuid::new_v4().to_string(),
                    source.instance_id,
                    mod_id,
                    target.0,
                    related_mod.relationship_type.as_str(),
                ],
            )?;
        }

        tx.commit()?;
        Ok(())
    }

    pub fn set_mod_categories(&self, mod_id: &str, category_ids: &[String]) -> Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{e}"))?;
        conn.execute(
            "DELETE FROM mod_category_tags WHERE mod_id = ?1",
            params![mod_id],
        )?;
        for category_id in category_ids {
            conn.execute(
                "INSERT OR IGNORE INTO mod_category_tags (mod_id, category_id) VALUES (?1, ?2)",
                params![mod_id, category_id],
            )?;
        }
        Ok(())
    }

    pub fn list_mod_suggestions(&self, instance_id: &str) -> Result<Vec<ModSuggestion>> {
        let suggestions = {
            let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{e}"))?;
            let mut stmt = conn.prepare(
                "SELECT id, instance_id, file_name, file_path, enabled, hash_sha256, source_url, metadata_json
                 FROM mod_suggestions WHERE instance_id = ?1 ORDER BY file_name",
            )?;
            let rows = stmt.query_map(params![instance_id], Self::row_to_mod_suggestion)?;
            rows.collect::<Result<Vec<_>, _>>()?
        };
        self.attach_categories_to_suggestions(suggestions)
    }

    fn row_to_mod_suggestion(row: &rusqlite::Row<'_>) -> rusqlite::Result<ModSuggestion> {
        let metadata_json: Option<String> = row.get(7)?;
        let metadata = metadata_json
            .as_ref()
            .and_then(|j| serde_json::from_str(j).ok());
        Ok(ModSuggestion {
            id: row.get(0)?,
            instance_id: row.get(1)?,
            file_name: row.get(2)?,
            file_path: row.get(3)?,
            enabled: row.get::<_, i32>(4)? != 0,
            hash_sha256: row.get(5)?,
            source_url: row.get(6)?,
            metadata,
            categories: vec![],
            related_mods: vec![],
        })
    }

    fn attach_categories_to_suggestions(
        &self,
        mut suggestions: Vec<ModSuggestion>,
    ) -> Result<Vec<ModSuggestion>> {
        if suggestions.is_empty() {
            return Ok(suggestions);
        }
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{e}"))?;
        let mut stmt = conn.prepare(
            "SELECT mst.suggestion_id, ic.id, ic.instance_id, ic.name
             FROM mod_suggestion_category_tags mst
             JOIN instance_categories ic ON ic.id = mst.category_id
             WHERE mst.suggestion_id = ?1
             ORDER BY ic.name",
        )?;
        for suggestion in &mut suggestions {
            let tags = stmt
                .query_map(params![suggestion.id], |row| {
                    Ok(InstanceCategory {
                        id: row.get(1)?,
                        instance_id: row.get(2)?,
                        name: row.get(3)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            suggestion.categories = tags;
        }
        Ok(suggestions)
    }

    pub fn upsert_mod_suggestion(
        &self,
        input: &UpsertModSuggestionInput,
    ) -> Result<ModSuggestion> {
        let id = input
            .id
            .clone()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let source_url = normalize_url(input.source_url.clone());
        let metadata = ModMetadata {
            name: input.name.trim().to_string(),
            version: input.version.trim().to_string(),
            authors: input.authors.clone(),
            modrinth_url: source_url
                .as_ref()
                .filter(|url| url.contains("modrinth.com"))
                .cloned(),
            dependencies: vec![],
            loader: input.loader,
            side: ModSide::Unknown,
            mod_id: input.mod_id_field.clone(),
            installed_modrinth_version_id: None,
            customized: true,
        };
        let file_name = if input.file_name.trim().is_empty() {
            metadata.name.clone()
        } else {
            input.file_name.trim().to_string()
        };
        let metadata_json = serde_json::to_string(&metadata)?;
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{e}"))?;
        conn.execute(
            "INSERT INTO mod_suggestions (id, instance_id, file_name, file_path, enabled, hash_sha256, source_url, metadata_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(id) DO UPDATE SET
               instance_id = excluded.instance_id,
               file_name = excluded.file_name,
               file_path = excluded.file_path,
               enabled = excluded.enabled,
               hash_sha256 = excluded.hash_sha256,
               source_url = excluded.source_url,
               metadata_json = excluded.metadata_json",
            params![
                id,
                input.instance_id,
                file_name,
                input.file_path,
                input.enabled as i32,
                input.hash_sha256,
                source_url,
                metadata_json
            ],
        )?;
        drop(conn);
        self.set_mod_suggestion_categories(&id, &input.category_ids)?;
        self.get_mod_suggestion_by_id(&id)?
            .ok_or_else(|| anyhow::anyhow!("Mod suggestion not found after save"))
    }

    pub fn set_mod_suggestion_categories(
        &self,
        suggestion_id: &str,
        category_ids: &[String],
    ) -> Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{e}"))?;
        conn.execute(
            "DELETE FROM mod_suggestion_category_tags WHERE suggestion_id = ?1",
            params![suggestion_id],
        )?;
        for category_id in category_ids {
            conn.execute(
                "INSERT OR IGNORE INTO mod_suggestion_category_tags (suggestion_id, category_id) VALUES (?1, ?2)",
                params![suggestion_id, category_id],
            )?;
        }
        Ok(())
    }

    pub fn get_mod_suggestion_by_id(&self, id: &str) -> Result<Option<ModSuggestion>> {
        let suggestion = {
            let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{e}"))?;
            let mut stmt = conn.prepare(
                "SELECT id, instance_id, file_name, file_path, enabled, hash_sha256, source_url, metadata_json
                 FROM mod_suggestions WHERE id = ?1",
            )?;
            let mut rows = stmt.query_map(params![id], Self::row_to_mod_suggestion)?;
            rows.next().transpose()?
        };
        Ok(match suggestion {
            Some(s) => self.attach_categories_to_suggestions(vec![s])?.into_iter().next(),
            None => None,
        })
    }

    pub fn delete_mod_suggestion(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{e}"))?;
        conn.execute(
            "DELETE FROM mod_suggestion_category_tags WHERE suggestion_id = ?1",
            params![id],
        )?;
        conn.execute("DELETE FROM mod_suggestions WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn get_mod_suggestion_by_path(
        &self,
        instance_id: &str,
        file_path: &str,
    ) -> Result<Option<ModSuggestion>> {
        let suggestion = {
            let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{e}"))?;
            let mut stmt = conn.prepare(
                "SELECT id, instance_id, file_name, file_path, enabled, hash_sha256, source_url, metadata_json
                 FROM mod_suggestions WHERE instance_id = ?1 AND file_path = ?2",
            )?;
            let mut rows =
                stmt.query_map(params![instance_id, file_path], Self::row_to_mod_suggestion)?;
            rows.next().transpose()?
        };
        Ok(match suggestion {
            Some(s) => self.attach_categories_to_suggestions(vec![s])?.into_iter().next(),
            None => None,
        })
    }

    pub fn list_categories(&self, instance_id: &str) -> Result<Vec<InstanceCategory>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{e}"))?;
        let mut stmt = conn.prepare(
            "SELECT id, instance_id, name FROM instance_categories
             WHERE instance_id = ?1 ORDER BY name",
        )?;
        let rows = stmt
            .query_map(params![instance_id], |row| {
                Ok(InstanceCategory {
                    id: row.get(0)?,
                    instance_id: row.get(1)?,
                    name: row.get(2)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn create_category(&self, input: CreateCategoryInput) -> Result<InstanceCategory> {
        let name = input.name.trim().to_string();
        if name.is_empty() {
            anyhow::bail!("Category name cannot be empty");
        }
        let id = Uuid::new_v4().to_string();
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{e}"))?;
        let instance_id = input.instance_id.clone();
        let display_name = name.clone();
        conn.execute(
            "INSERT INTO instance_categories (id, instance_id, name) VALUES (?1, ?2, ?3)",
            params![id, instance_id, display_name],
        )?;
        Ok(InstanceCategory {
            id,
            instance_id: input.instance_id,
            name,
        })
    }

    pub fn delete_category(&self, input: &DeleteCategoryInput) -> Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{e}"))?;
        let category: (String, String) = conn.query_row(
            "SELECT id, instance_id FROM instance_categories WHERE id = ?1",
            params![input.category_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;

        let tx = conn.unchecked_transaction()?;
        match input.mode {
            DeleteCategoryMode::Clear => {
                tx.execute(
                    "DELETE FROM mod_category_tags WHERE category_id = ?1",
                    params![category.0],
                )?;
                tx.execute(
                    "DELETE FROM mod_suggestion_category_tags WHERE category_id = ?1",
                    params![category.0],
                )?;
            }
            DeleteCategoryMode::Recategorize => {
                let replacement_id = input
                    .replacement_category_id
                    .as_deref()
                    .ok_or_else(|| anyhow::anyhow!("Replacement category is required"))?;
                if replacement_id == category.0 {
                    anyhow::bail!("Replacement category must be different");
                }

                let replacement_exists: bool = tx.query_row(
                    "SELECT EXISTS(
                        SELECT 1 FROM instance_categories
                        WHERE id = ?1 AND instance_id = ?2
                    )",
                    params![replacement_id, category.1],
                    |row| row.get(0),
                )?;
                if !replacement_exists {
                    anyhow::bail!("Replacement category must belong to the same instance");
                }

                tx.execute(
                    "INSERT OR IGNORE INTO mod_category_tags (mod_id, category_id)
                     SELECT mod_id, ?1 FROM mod_category_tags WHERE category_id = ?2",
                    params![replacement_id, category.0],
                )?;
                tx.execute(
                    "INSERT OR IGNORE INTO mod_suggestion_category_tags (suggestion_id, category_id)
                     SELECT suggestion_id, ?1 FROM mod_suggestion_category_tags WHERE category_id = ?2",
                    params![replacement_id, category.0],
                )?;
                tx.execute(
                    "DELETE FROM mod_category_tags WHERE category_id = ?1",
                    params![category.0],
                )?;
                tx.execute(
                    "DELETE FROM mod_suggestion_category_tags WHERE category_id = ?1",
                    params![category.0],
                )?;
            }
        }

        tx.execute(
            "DELETE FROM instance_categories WHERE id = ?1",
            params![category.0],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn set_mod_enabled(&self, mod_id: &str, enabled: bool) -> Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{e}"))?;
        conn.execute(
            "UPDATE mods SET enabled = ?1 WHERE id = ?2",
            params![enabled as i32, mod_id],
        )?;
        Ok(())
    }

    pub fn save_mod_integrity_audit(&self, audit: &ModIntegrityAudit) -> Result<()> {
        let reports_json = serde_json::to_string(&audit.reports)?;
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{e}"))?;
        conn.execute(
            "INSERT INTO mod_integrity_audits (
                instance_id, audited_at, total_mods, healthy_mods, corrupted_mods, status, reports_json
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(instance_id) DO UPDATE SET
               audited_at = excluded.audited_at,
               total_mods = excluded.total_mods,
               healthy_mods = excluded.healthy_mods,
               corrupted_mods = excluded.corrupted_mods,
               status = excluded.status,
               reports_json = excluded.reports_json",
            params![
                audit.instance_id,
                audit.audited_at,
                audit.total_mods as i64,
                audit.healthy_mods as i64,
                audit.corrupted_mods as i64,
                audit.status.as_str(),
                reports_json
            ],
        )?;
        Ok(())
    }

    pub fn get_mod_integrity_audit(&self, instance_id: &str) -> Result<Option<ModIntegrityAudit>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{e}"))?;
        let mut stmt = conn.prepare(
            "SELECT instance_id, audited_at, total_mods, healthy_mods, corrupted_mods, status, reports_json
             FROM mod_integrity_audits WHERE instance_id = ?1",
        )?;
        let mut rows = stmt.query_map(params![instance_id], |row| {
            let reports_json: String = row.get(6)?;
            let reports: Vec<ModIntegrityReport> =
                serde_json::from_str(&reports_json).unwrap_or_default();
            Ok(ModIntegrityAudit {
                instance_id: row.get(0)?,
                audited_at: row.get(1)?,
                total_mods: row.get::<_, i64>(2)? as usize,
                healthy_mods: row.get::<_, i64>(3)? as usize,
                corrupted_mods: row.get::<_, i64>(4)? as usize,
                status: ModIntegrityAuditStatus::from_str(&row.get::<_, String>(5)?),
                reports,
            })
        })?;
        Ok(rows.next().transpose()?)
    }

    pub fn save_update_check(
        &self,
        instance_id: &str,
        rows: &[UpdateRow],
    ) -> Result<SavedUpdateCheck> {
        let checked_at = chrono::Utc::now().to_rfc3339();
        let rows_json = serde_json::to_string(rows)?;
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{e}"))?;
        conn.execute(
            "INSERT INTO update_checks (instance_id, checked_at, rows_json)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(instance_id) DO UPDATE SET
               checked_at = excluded.checked_at,
               rows_json = excluded.rows_json",
            params![instance_id, checked_at, rows_json],
        )?;
        Ok(SavedUpdateCheck {
            instance_id: instance_id.to_string(),
            checked_at,
            rows: rows.to_vec(),
        })
    }

    pub fn get_update_check(&self, instance_id: &str) -> Result<Option<SavedUpdateCheck>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{e}"))?;
        let mut stmt = conn.prepare(
            "SELECT instance_id, checked_at, rows_json FROM update_checks WHERE instance_id = ?1",
        )?;
        let mut rows = stmt.query_map(params![instance_id], |row| {
            let rows_json: String = row.get(2)?;
            let update_rows: Vec<UpdateRow> = serde_json::from_str(&rows_json).unwrap_or_default();
            Ok(SavedUpdateCheck {
                instance_id: row.get(0)?,
                checked_at: row.get(1)?,
                rows: update_rows,
            })
        })?;
        Ok(rows.next().transpose()?)
    }

    pub fn delete_mod(&self, mod_id: &str) -> Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{e}"))?;
        conn.execute("DELETE FROM mods WHERE id = ?1", params![mod_id])?;
        Ok(())
    }

    fn row_to_mod_relationship_edge(
        row: &rusqlite::Row<'_>,
    ) -> rusqlite::Result<ModRelationshipEdge> {
        Ok(ModRelationshipEdge {
            id: row.get(0)?,
            instance_id: row.get(1)?,
            source_mod_id: row.get(2)?,
            source_mod_name: row.get(3)?,
            target_mod_id: row.get(4)?,
            target_mod_name: row.get(5)?,
            relationship_type: ModRelationshipType::from_str(&row.get::<_, String>(6)?),
            created_at: row.get(7)?,
        })
    }

    pub fn list_pack_items(&self, instance_id: &str, pack_type: PackType) -> Result<Vec<PackItem>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{e}"))?;
        let mut stmt = conn.prepare(
            "SELECT id, instance_id, pack_type, file_name, file_path, is_dir, enabled, metadata_json
             FROM pack_items WHERE instance_id = ?1 AND pack_type = ?2 ORDER BY file_name",
        )?;
        let rows = stmt.query_map(
            params![instance_id, pack_type.as_str()],
            Self::row_to_pack_item,
        )?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    fn row_to_pack_item(row: &rusqlite::Row<'_>) -> rusqlite::Result<PackItem> {
        let metadata_json: Option<String> = row.get(7)?;
        let metadata = metadata_json
            .as_ref()
            .and_then(|j| serde_json::from_str(j).ok());
        Ok(PackItem {
            id: row.get(0)?,
            instance_id: row.get(1)?,
            pack_type: PackType::from_str(&row.get::<_, String>(2)?),
            file_name: row.get(3)?,
            file_path: row.get(4)?,
            is_dir: row.get::<_, i32>(5)? != 0,
            enabled: row.get::<_, i32>(6)? != 0,
            metadata,
        })
    }

    pub fn get_pack_item_by_path(
        &self,
        instance_id: &str,
        pack_type: PackType,
        file_path: &str,
    ) -> Result<Option<PackItem>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{e}"))?;
        let mut stmt = conn.prepare(
            "SELECT id, instance_id, pack_type, file_name, file_path, is_dir, enabled, metadata_json
             FROM pack_items WHERE instance_id = ?1 AND pack_type = ?2 AND file_path = ?3",
        )?;
        let mut rows = stmt.query_map(
            params![instance_id, pack_type.as_str(), file_path],
            Self::row_to_pack_item,
        )?;
        Ok(rows.next().transpose()?)
    }

    pub fn get_pack_item_by_id(&self, item_id: &str) -> Result<Option<PackItem>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{e}"))?;
        let mut stmt = conn.prepare(
            "SELECT id, instance_id, pack_type, file_name, file_path, is_dir, enabled, metadata_json
             FROM pack_items WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(params![item_id], Self::row_to_pack_item)?;
        Ok(rows.next().transpose()?)
    }

    pub fn upsert_pack_item(&self, item: &PackItem) -> Result<()> {
        let existing =
            self.get_pack_item_by_path(&item.instance_id, item.pack_type, &item.file_path)?;
        let (id, enabled, metadata) = if let Some(existing) = existing {
            let keep_metadata = existing
                .metadata
                .as_ref()
                .map(|m| m.customized)
                .unwrap_or(false);
            (
                existing.id,
                existing.enabled,
                if keep_metadata {
                    existing.metadata
                } else {
                    item.metadata.clone()
                },
            )
        } else {
            (item.id.clone(), item.enabled, item.metadata.clone())
        };

        let metadata_json = metadata
            .as_ref()
            .map(|m| serde_json::to_string(m))
            .transpose()?;
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{e}"))?;
        conn.execute(
            "INSERT INTO pack_items (id, instance_id, pack_type, file_name, file_path, is_dir, enabled, metadata_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(instance_id, pack_type, file_path) DO UPDATE SET
               file_name = excluded.file_name,
               is_dir = excluded.is_dir,
               enabled = ?7,
               metadata_json = excluded.metadata_json",
            params![
                id,
                item.instance_id,
                item.pack_type.as_str(),
                item.file_name,
                item.file_path,
                item.is_dir as i32,
                enabled as i32,
                metadata_json
            ],
        )?;
        Ok(())
    }

    pub fn update_pack_item_metadata(
        &self,
        input: &UpdatePackItemMetadataInput,
    ) -> Result<PackItem> {
        self.get_pack_item_by_id(&input.item_id)?
            .ok_or_else(|| anyhow::anyhow!("Pack item not found"))?;
        let metadata = PackItemMetadata {
            display_name: input.display_name.clone(),
            author: input.author.clone(),
            website_url: normalize_url(input.website_url.clone()),
            notes: input.notes.clone(),
            customized: true,
        };
        let metadata_json = serde_json::to_string(&metadata)?;
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{e}"))?;
        conn.execute(
            "UPDATE pack_items SET metadata_json = ?1 WHERE id = ?2",
            params![metadata_json, input.item_id],
        )?;
        drop(conn);
        self.get_pack_item_by_id(&input.item_id)?
            .ok_or_else(|| anyhow::anyhow!("Pack item not found after update"))
    }

    pub fn set_pack_item_enabled(&self, item_id: &str, enabled: bool) -> Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{e}"))?;
        conn.execute(
            "UPDATE pack_items SET enabled = ?1 WHERE id = ?2",
            params![enabled as i32, item_id],
        )?;
        Ok(())
    }

    pub fn get_launch_config(&self, instance_id: &str) -> Result<Option<LaunchConfig>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{e}"))?;
        let mut stmt = conn.prepare(
            "SELECT id, instance_id, java_path, min_memory_mb, max_memory_mb, jvm_args, game_args, wrapper_command
             FROM launch_configs WHERE instance_id = ?1 LIMIT 1",
        )?;
        let mut rows = stmt.query_map(params![instance_id], |row| {
            Ok(LaunchConfig {
                id: row.get(0)?,
                instance_id: row.get(1)?,
                java_path: row.get(2)?,
                min_memory_mb: row.get::<_, i64>(3)? as u32,
                max_memory_mb: row.get::<_, i64>(4)? as u32,
                jvm_args: row.get(5)?,
                game_args: row.get(6)?,
                wrapper_command: row.get(7)?,
            })
        })?;
        Ok(rows.next().transpose()?)
    }

    pub fn save_launch_config(&self, config: &LaunchConfig) -> Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{e}"))?;
        conn.execute(
            "INSERT INTO launch_configs (id, instance_id, java_path, min_memory_mb, max_memory_mb, jvm_args, game_args, wrapper_command)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(id) DO UPDATE SET
               java_path = excluded.java_path,
               min_memory_mb = excluded.min_memory_mb,
               max_memory_mb = excluded.max_memory_mb,
               jvm_args = excluded.jvm_args,
               game_args = excluded.game_args,
               wrapper_command = excluded.wrapper_command",
            params![
                config.id,
                config.instance_id,
                config.java_path,
                config.min_memory_mb,
                config.max_memory_mb,
                config.jvm_args,
                config.game_args,
                config.wrapper_command
            ],
        )?;
        Ok(())
    }

    pub fn append_log(&self, level: &str, message: &str, context: Option<&str>) -> Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{e}"))?;
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO logs (level, message, context, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![level, message, context, now],
        )?;
        Ok(())
    }

    pub fn list_logs(
        &self,
        limit: u32,
    ) -> Result<Vec<(i64, String, String, Option<String>, String)>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("{e}"))?;
        let mut stmt = conn.prepare(
            "SELECT id, level, message, context, created_at FROM logs ORDER BY id DESC LIMIT ?1",
        )?;
        let logs = stmt
            .query_map(params![limit], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(logs)
    }
}

fn normalize_modrinth_url(url: Option<String>) -> Option<String> {
    let url = url
        .map(|u| u.trim().to_string())
        .filter(|u| !u.is_empty())?;
    if url.starts_with("http://") || url.starts_with("https://") {
        Some(url)
    } else if url.contains("modrinth.com") {
        Some(format!("https://{url}"))
    } else {
        Some(crate::models::mod_metadata::modrinth_url_from_id(&url))
    }
}

fn non_empty_setting(value: String) -> Option<String> {
    if value.trim().is_empty() {
        None
    } else {
        Some(value)
    }
}

fn normalize_url(url: Option<String>) -> Option<String> {
    let url = url
        .map(|u| u.trim().to_string())
        .filter(|u| !u.is_empty())?;
    if url.starts_with("http://") || url.starts_with("https://") {
        Some(url)
    } else {
        Some(format!("https://{url}"))
    }
}

fn copy_dir_recursive(src: &str, dst: &str) -> Result<()> {
    let src_path = std::path::Path::new(src);
    if !src_path.exists() {
        return Ok(());
    }
    for entry in walkdir::WalkDir::new(src_path)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let rel = entry.path().strip_prefix(src_path)?;
        let target = std::path::Path::new(dst).join(rel);
        if entry.file_type().is_dir() {
            std::fs::create_dir_all(&target)?;
        } else if entry.file_type().is_file() {
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::category::{DeleteCategoryInput, DeleteCategoryMode};
    use crate::models::instance::{CreateInstanceInput, LoaderType};
    use crate::models::mod_metadata::{ModRelationshipType, UpdateModRelationshipInput};

    fn test_db() -> Database {
        let dir = std::env::temp_dir().join(format!("modly-db-test-{}", Uuid::new_v4()));
        Database::new(dir).expect("db should initialize")
    }

    fn seed_category_fixture(db: &Database) -> (String, String, String, String) {
        let instance = db
            .create_instance(CreateInstanceInput {
                name: "Test Instance".to_string(),
                game_dir: "C:\\test-instance".to_string(),
                loader: LoaderType::Fabric,
                mc_version: Some("1.20.1".to_string()),
            })
            .expect("instance should be created");
        let source = db
            .create_category(CreateCategoryInput {
                instance_id: instance.id.clone(),
                name: "Source".to_string(),
            })
            .expect("source category should be created");
        let target = db
            .create_category(CreateCategoryInput {
                instance_id: instance.id.clone(),
                name: "Target".to_string(),
            })
            .expect("target category should be created");

        let conn = db.conn.lock().expect("lock should work");
        conn.execute(
            "INSERT INTO mods (id, instance_id, file_name, file_path, installed_at, enabled, hash_sha256, source_url, metadata_json)
             VALUES (?1, ?2, ?3, ?4, CURRENT_TIMESTAMP, 1, NULL, NULL, NULL)",
            params![
                "mod-a",
                instance.id,
                "mod-a.jar",
                "C:\\test-instance\\mods\\mod-a.jar",
            ],
        )
        .expect("mod should be inserted");
        conn.execute(
            "INSERT INTO mod_category_tags (mod_id, category_id) VALUES (?1, ?2)",
            params!["mod-a", source.id],
        )
        .expect("tag should be inserted");
        drop(conn);

        (instance.id, source.id, target.id, "mod-a".to_string())
    }

    fn insert_mod(db: &Database, instance_id: &str, mod_id: &str, file_name: &str) {
        let conn = db.conn.lock().expect("lock should work");
        conn.execute(
            "INSERT INTO mods (id, instance_id, file_name, file_path, installed_at, enabled, hash_sha256, source_url, metadata_json)
             VALUES (?1, ?2, ?3, ?4, CURRENT_TIMESTAMP, 1, NULL, NULL, NULL)",
            params![
                mod_id,
                instance_id,
                file_name,
                format!(r"C:\test-instance\mods\{file_name}"),
            ],
        )
        .expect("mod should be inserted");
    }

    fn seed_relationship_fixture(db: &Database) -> (String, String, String, String, String) {
        let instance = db
            .create_instance(CreateInstanceInput {
                name: "Relationships".to_string(),
                game_dir: "C:\\relationship-instance".to_string(),
                loader: LoaderType::Fabric,
                mc_version: Some("1.20.1".to_string()),
            })
            .expect("instance should be created");
        insert_mod(db, &instance.id, "mod-source", "source.jar");
        insert_mod(db, &instance.id, "mod-dependency", "dependency.jar");
        insert_mod(db, &instance.id, "mod-addon-base", "addon-base.jar");

        let other_instance = db
            .create_instance(CreateInstanceInput {
                name: "Other".to_string(),
                game_dir: "C:\\relationship-instance-other".to_string(),
                loader: LoaderType::Fabric,
                mc_version: Some("1.20.1".to_string()),
            })
            .expect("second instance should be created");
        insert_mod(db, &other_instance.id, "mod-other-instance", "other.jar");

        (
            instance.id,
            "mod-source".to_string(),
            "mod-dependency".to_string(),
            "mod-addon-base".to_string(),
            "mod-other-instance".to_string(),
        )
    }

    #[test]
    fn clears_mod_assignments_when_deleting_category_in_clear_mode() {
        let db = test_db();
        let (instance_id, source_id, _target_id, mod_id) = seed_category_fixture(&db);

        db.delete_category(&DeleteCategoryInput {
            category_id: source_id.clone(),
            mode: DeleteCategoryMode::Clear,
            replacement_category_id: None,
        })
        .expect("delete should succeed");

        let remaining = db
            .list_categories(&instance_id)
            .expect("categories should load");
        assert!(remaining.iter().all(|category| category.id != source_id));

        let updated_mod = db
            .get_mod_by_id(&mod_id)
            .expect("mod should load")
            .expect("mod should exist");
        assert!(updated_mod.categories.is_empty());
    }

    #[test]
    fn recategorizes_mod_assignments_when_deleting_category_in_recategorize_mode() {
        let db = test_db();
        let (instance_id, source_id, target_id, mod_id) = seed_category_fixture(&db);

        db.delete_category(&DeleteCategoryInput {
            category_id: source_id.clone(),
            mode: DeleteCategoryMode::Recategorize,
            replacement_category_id: Some(target_id.clone()),
        })
        .expect("delete should succeed");

        let remaining = db
            .list_categories(&instance_id)
            .expect("categories should load");
        assert!(remaining.iter().all(|category| category.id != source_id));

        let updated_mod = db
            .get_mod_by_id(&mod_id)
            .expect("mod should load")
            .expect("mod should exist");
        assert_eq!(updated_mod.categories.len(), 1);
        assert_eq!(updated_mod.categories[0].id, target_id);
    }

    #[test]
    fn stores_custom_instance_paths_on_update() {
        let db = test_db();
        let instance = db
            .create_instance(CreateInstanceInput {
                name: "Paths".to_string(),
                game_dir: "C:\\packs\\paths".to_string(),
                loader: LoaderType::Fabric,
                mc_version: Some("1.20.1".to_string()),
            })
            .expect("instance should be created");

        let updated = db
            .update_instance(UpdateInstanceInput {
                id: instance.id,
                name: None,
                game_dir: None,
                loader: None,
                mc_version: instance.mc_version,
                resource_packs_path: Some(Some("D:\\rp".to_string())),
                shader_packs_path: Some(None),
                data_packs_path: Some(Some("D:\\dp".to_string())),
                config_path: Some(Some("D:\\cfg".to_string())),
            })
            .expect("instance should update");

        assert_eq!(updated.resource_packs_path.as_deref(), Some("D:\\rp"));
        assert_eq!(updated.shader_packs_path, None);
        assert_eq!(updated.data_packs_path.as_deref(), Some("D:\\dp"));
        assert_eq!(updated.config_path.as_deref(), Some("D:\\cfg"));
    }

    #[test]
    fn stores_manual_relationships_and_reports_reverse_links() {
        let db = test_db();
        let (_instance_id, source_id, dependency_id, addon_base_id, _other_instance_mod_id) =
            seed_relationship_fixture(&db);

        db.replace_mod_relationships(
            &source_id,
            &[
                UpdateModRelationshipInput {
                    target_mod_id: dependency_id.clone(),
                    relationship_type: ModRelationshipType::Dependency,
                },
                UpdateModRelationshipInput {
                    target_mod_id: addon_base_id.clone(),
                    relationship_type: ModRelationshipType::AddonFor,
                },
            ],
        )
        .expect("relationships should save");

        let relationships = db
            .get_mod_relationships(&source_id)
            .expect("relationships should load");
        assert_eq!(relationships.outgoing.len(), 2);
        assert!(
            relationships
                .outgoing
                .iter()
                .any(|edge| edge.target_mod_id == dependency_id
                    && edge.relationship_type == ModRelationshipType::Dependency)
        );
        assert!(
            relationships
                .outgoing
                .iter()
                .any(|edge| edge.target_mod_id == addon_base_id
                    && edge.relationship_type == ModRelationshipType::AddonFor)
        );

        let reverse = db
            .get_mod_relationships(&dependency_id)
            .expect("reverse relationships should load");
        assert_eq!(reverse.incoming.len(), 1);
        assert_eq!(reverse.incoming[0].source_mod_id, source_id);
        assert_eq!(
            reverse.incoming[0].relationship_type,
            ModRelationshipType::Dependency
        );
    }

    #[test]
    fn rejects_invalid_manual_relationships() {
        let db = test_db();
        let (_instance_id, source_id, dependency_id, _addon_base_id, other_instance_mod_id) =
            seed_relationship_fixture(&db);

        let self_error = db
            .replace_mod_relationships(
                &source_id,
                &[UpdateModRelationshipInput {
                    target_mod_id: source_id.clone(),
                    relationship_type: ModRelationshipType::Dependency,
                }],
            )
            .expect_err("self links should be rejected");
        assert!(self_error.to_string().contains("cannot relate to itself"));

        let duplicate_error = db
            .replace_mod_relationships(
                &source_id,
                &[
                    UpdateModRelationshipInput {
                        target_mod_id: dependency_id.clone(),
                        relationship_type: ModRelationshipType::Dependency,
                    },
                    UpdateModRelationshipInput {
                        target_mod_id: dependency_id.clone(),
                        relationship_type: ModRelationshipType::AddonFor,
                    },
                ],
            )
            .expect_err("duplicate targets should be rejected");
        assert!(duplicate_error
            .to_string()
            .contains("one relationship per target mod"));

        let cross_instance_error = db
            .replace_mod_relationships(
                &source_id,
                &[UpdateModRelationshipInput {
                    target_mod_id: other_instance_mod_id,
                    relationship_type: ModRelationshipType::Dependency,
                }],
            )
            .expect_err("cross-instance links should be rejected");
        assert!(cross_instance_error
            .to_string()
            .contains("same instance"));
    }

    #[test]
    fn cascades_manual_relationships_when_target_mod_is_deleted() {
        let db = test_db();
        let (_instance_id, source_id, dependency_id, _addon_base_id, _other_instance_mod_id) =
            seed_relationship_fixture(&db);

        db.replace_mod_relationships(
            &source_id,
            &[UpdateModRelationshipInput {
                target_mod_id: dependency_id.clone(),
                relationship_type: ModRelationshipType::Dependency,
            }],
        )
        .expect("relationships should save");

        db.delete_mod(&dependency_id).expect("target mod should delete");

        let relationships = db
            .get_mod_relationships(&source_id)
            .expect("relationships should load");
        assert!(relationships.outgoing.is_empty());
    }
}
