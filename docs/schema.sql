-- Modpack Manager SQLite Schema
-- Database file: {app_data_dir}/modpack_manager.db

CREATE TABLE IF NOT EXISTS instances (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    game_dir TEXT NOT NULL UNIQUE,
    loader TEXT NOT NULL DEFAULT 'unknown',
    mc_version TEXT,
    icon TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mods (
    id TEXT PRIMARY KEY NOT NULL,
    instance_id TEXT NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    hash_sha256 TEXT,
    metadata_json TEXT,
    UNIQUE(instance_id, file_path)
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

CREATE INDEX IF NOT EXISTS idx_mods_instance ON mods(instance_id);
CREATE INDEX IF NOT EXISTS idx_categories_instance ON instance_categories(instance_id);
CREATE INDEX IF NOT EXISTS idx_logs_created ON logs(created_at DESC);
