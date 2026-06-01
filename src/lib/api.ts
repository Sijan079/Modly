import { invoke } from "@tauri-apps/api/core";
import type {
  AppSettings,
  CreateInstanceInput,
  Instance,
  LaunchConfig,
  LaunchStatus,
  LogEntry,
  MinecraftScanResult,
  ModFile,
  ModIntegrityAudit,
  ModMetadata,
  UpdateModMetadataInput,
  InstanceCategory,
  CreateCategoryInput,
  ExportModListInput,
  DirectoryEntry,
  PackItem,
  PackType,
  UpdatePackItemMetadataInput,
  UpdateInstanceInput,
  ConfigTreeNode,
  CheckUpdateTargetInput,
  ConfirmUpdateMatchInput,
  SavedUpdateCheck,
  UpdateModFromModrinthInput,
  UpdateRow,
  UpdateTarget,
} from "./types";

export const api = {
  scan: {
    defaultMinecraft: () =>
      invoke<MinecraftScanResult>("scan_default_minecraft"),
    path: (path: string) =>
      invoke<MinecraftScanResult>("scan_minecraft_path", { path }),
    defaultPath: () =>
      invoke<string | null>("get_default_minecraft_path"),
  },
  instances: {
    list: () => invoke<Instance[]>("list_instances"),
    get: (id: string) => invoke<Instance | null>("get_instance", { id }),
    create: (input: CreateInstanceInput) =>
      invoke<Instance>("create_instance", { input }),
    update: (input: UpdateInstanceInput) =>
      invoke<Instance>("update_instance", { input }),
    delete: (id: string, deleteFiles: boolean) =>
      invoke<void>("delete_instance", { id, deleteFiles }),
    duplicate: (id: string, newName: string, newGameDir: string) =>
      invoke<Instance>("duplicate_instance", { id, newName, newGameDir }),
    exportZip: (instanceId: string, outputPath: string) =>
      invoke<void>("export_instance_zip", { instanceId, outputPath }),
    importZip: (name: string, archivePath: string, destParent: string) =>
      invoke<Instance>("import_instance_zip", { name, archivePath, destParent }),
    backup: (instanceId: string, outputPath: string) =>
      invoke<void>("backup_instance", { instanceId, outputPath }),
  },
  mods: {
    list: (instanceId: string) =>
      invoke<ModFile[]>("list_mods", { instanceId }),
    scan: (instanceId: string) =>
      invoke<ModFile[]>("scan_instance_mods", { instanceId }),
    checkIntegrity: (instanceId: string) =>
      invoke<ModIntegrityAudit>("check_mod_integrity", { instanceId }),
    latestIntegrityAudit: (instanceId: string) =>
      invoke<ModIntegrityAudit | null>("get_latest_mod_integrity_audit", { instanceId }),
    parse: (filePath: string) =>
      invoke<ModMetadata>("parse_mod_metadata", { filePath }),
    toggle: (instanceId: string, modId: string, enabled: boolean) =>
      invoke<void>("toggle_mod_enabled", { instanceId, modId, enabled }),
    copyToInstance: (sourcePath: string, targetInstanceId: string) =>
      invoke<ModFile>("copy_mod_to_instance", { sourcePath, targetInstanceId }),
    exportHtml: (input: ExportModListInput) =>
      invoke<void>("export_mod_list_html", { input }),
    updateMetadata: (input: UpdateModMetadataInput) =>
      invoke<ModFile>("update_mod_metadata", { input }),
    resetMetadata: (modId: string) =>
      invoke<ModFile>("reset_mod_metadata", { modId }),
  },
  categories: {
    list: (instanceId: string) =>
      invoke<InstanceCategory[]>("list_categories", { instanceId }),
    create: (input: CreateCategoryInput) =>
      invoke<InstanceCategory>("create_category", { input }),
    delete: (categoryId: string) =>
      invoke<void>("delete_category", { categoryId }),
  },
  packs: {
    list: (instanceId: string, packType: PackType) =>
      invoke<PackItem[]>("list_pack_items", { instanceId, packType }),
    scan: (instanceId: string, packType: PackType) =>
      invoke<PackItem[]>("scan_pack_items", { instanceId, packType }),
    toggle: (itemId: string, enabled: boolean) =>
      invoke<void>("toggle_pack_item_enabled", { itemId, enabled }),
    updateMetadata: (input: UpdatePackItemMetadataInput) =>
      invoke<PackItem>("update_pack_item_metadata", { input }),
  },
  updates: {
    check: (instanceId: string) =>
      invoke<UpdateRow[]>("check_updates", { instanceId }),
    latest: (instanceId: string) =>
      invoke<SavedUpdateCheck | null>("get_latest_update_check", { instanceId }),
    saveCheck: (instanceId: string, rows: UpdateRow[]) =>
      invoke<SavedUpdateCheck>("save_update_check", { instanceId, rows }),
    listTargets: (instanceId: string) =>
      invoke<UpdateTarget[]>("list_update_targets", { instanceId }),
    checkTarget: (input: CheckUpdateTargetInput) =>
      invoke<UpdateRow>("check_update_target", { input }),
    confirmMatch: (input: ConfirmUpdateMatchInput) =>
      invoke<void>("confirm_update_match", { input }),
    updateMod: (input: UpdateModFromModrinthInput) =>
      invoke<ModFile>("update_mod_from_modrinth", { input }),
    log: (instanceId: string, level: string, message: string) =>
      invoke<void>("append_update_log", { instanceId, level, message }),
  },
  configs: {
    scanTree: (instancePath: string) =>
      invoke<ConfigTreeNode[]>("scan_config_tree", { instancePath }),
    readFile: (path: string) =>
      invoke<string>("read_config_file", { path }),
    writeFile: (path: string, content: string) =>
      invoke<void>("write_config_file", { path, content }),
  },
  files: {
    openInExplorer: (path: string) =>
      invoke<void>("open_in_explorer", { path }),
    hash: (path: string) => invoke<string>("hash_file_sha256", { path }),
    copy: (source: string, destination: string) =>
      invoke<void>("copy_file", { source, destination }),
    move: (source: string, destination: string) =>
      invoke<void>("move_file", { source, destination }),
    delete: (path: string) => invoke<void>("delete_file", { path }),
    appDataDir: () => invoke<string>("get_app_data_dir"),
    listDirectory: (path: string) =>
      invoke<DirectoryEntry[]>("list_directory", { path }),
    logs: (limit = 200) => invoke<LogEntry[]>("list_logs", { limit }),
    appendLog: (level: string, message: string, context?: string) =>
      invoke<void>("append_log", { level, message, context }),
  },
  launcher: {
    detectJava: () => invoke<string | null>("detect_java_path"),
    getConfig: (instanceId: string) =>
      invoke<LaunchConfig | null>("get_launch_config", { instanceId }),
    saveConfig: (config: LaunchConfig) =>
      invoke<void>("save_launch_config", { config }),
    launch: (instanceId: string, configId?: string) =>
      invoke<number>("launch_instance", {
        request: { instanceId, configId },
      }),
    stop: () => invoke<void>("stop_instance"),
    status: () => invoke<LaunchStatus>("get_launch_status"),
  },
  settings: {
    get: () => invoke<AppSettings>("get_settings"),
    save: (settings: AppSettings) =>
      invoke<void>("save_settings", { settings }),
  },
};
