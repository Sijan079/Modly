export type LoaderType =
  | "vanilla"
  | "fabric"
  | "forge"
  | "neoforge"
  | "quilt"
  | "unknown";

export interface Instance {
  id: string;
  name: string;
  gameDir: string;
  loader: LoaderType;
  mcVersion: string | null;
  icon: string | null;
  resourcePacksPath: string | null;
  shaderPacksPath: string | null;
  dataPacksPath: string | null;
  configPath: string | null;
  createdAt: string;
  updatedAt: string;
  modCount: number;
  enabledModCount: number;
}

export interface InstanceCategory {
  id: string;
  instanceId: string;
  name: string;
}

export interface ModFile {
  id: string;
  instanceId: string;
  fileName: string;
  filePath: string;
  installedAt: string;
  enabled: boolean;
  hashSha256: string | null;
  sourceUrl: string | null;
  metadata: ModMetadata | null;
  categories: InstanceCategory[];
  relatedMods: UpdateModRelationshipInput[];
}

export type ModSuggestion = ModFile;

export type ModIntegrityStatus =
  | "ok"
  | "missing"
  | "unreadable"
  | "invalidArchive"
  | "emptyArchive"
  | "corruptEntry";

export interface ModIntegrityReport {
  modId: string;
  fileName: string;
  filePath: string;
  healthy: boolean;
  status: ModIntegrityStatus;
  message: string;
}

export type ModIntegrityAuditStatus = "clean" | "issuesFound";

export interface ModIntegrityAudit {
  instanceId: string;
  auditedAt: string;
  totalMods: number;
  healthyMods: number;
  corruptedMods: number;
  status: ModIntegrityAuditStatus;
  reports: ModIntegrityReport[];
}

export interface ExportModListInput {
  instanceName: string;
  appliedSearch: string;
  statusFilter: string;
  loaderFilter: string;
  sideFilter: string;
  categoryFilter: string | null;
  totalCount: number;
  mods: ModFile[];
  outputPath: string;
}

export type ModLoaderKind =
  | "fabric"
  | "forge"
  | "neoforge"
  | "quilt"
  | "unknown";

export type ModSide = "unknown" | "client" | "server" | "both";

export interface ModMetadata {
  name: string;
  version: string;
  authors: string[];
  modrinthUrl: string | null;
  dependencies: ModDependency[];
  loader: ModLoaderKind;
  side: ModSide;
  modId: string | null;
  installedModrinthVersionId?: string | null;
  customized?: boolean;
}

export interface CreateCategoryInput {
  instanceId: string;
  name: string;
}

export type DeleteCategoryMode = "clear" | "recategorize";

export interface DeleteCategoryInput {
  categoryId: string;
  mode: DeleteCategoryMode;
  replacementCategoryId?: string | null;
}

export interface UpdateModMetadataInput {
  modId: string;
  name: string;
  version: string;
  authors: string[];
  modrinthUrl: string | null;
  sourceUrl?: string | null;
  loader: ModLoaderKind;
  side: ModSide;
  modIdField: string | null;
  installedModrinthVersionId?: string | null;
  categoryIds: string[];
  relatedMods: UpdateModRelationshipInput[];
}

export interface UpsertModSuggestionInput {
  id?: string | null;
  instanceId: string;
  fileName: string;
  filePath?: string;
  enabled: boolean;
  hashSha256?: string | null;
  sourceUrl?: string | null;
  name: string;
  version: string;
  authors: string[];
  loader: ModLoaderKind;
  modIdField?: string | null;
  categoryIds: string[];
}

export interface ModDependency {
  modId: string;
  versionRange: string | null;
  kind: string;
}

export type ModRelationshipType = "dependency" | "addon_for";

export interface UpdateModRelationshipInput {
  targetModId: string;
  relationshipType: ModRelationshipType;
}

export interface ModRelationshipEdge {
  id: string;
  instanceId: string;
  sourceModId: string;
  sourceModName: string;
  targetModId: string;
  targetModName: string;
  relationshipType: ModRelationshipType;
  createdAt: string;
}

export interface ModRelationshipsForMod {
  modId: string;
  outgoing: ModRelationshipEdge[];
  incoming: ModRelationshipEdge[];
}

export interface MinecraftScanResult {
  minecraftDir: string | null;
  detectedPaths: DetectedPath[];
  loaders: DetectedLoader[];
  content: ScanContentSummary;
}

export interface DetectedPath {
  path: string;
  kind: string;
  fileCount: number;
}

export interface DetectedLoader {
  loader: LoaderType;
  version: string | null;
  path: string;
}

export interface ScanContentSummary {
  modCount: number;
  resourcePackCount: number;
  shaderPackCount: number;
  datapackCount: number;
  saveCount: number;
}

export interface LaunchConfig {
  id: string;
  instanceId: string;
  javaPath: string;
  minMemoryMb: number;
  maxMemoryMb: number;
  jvmArgs: string;
  gameArgs: string;
  wrapperCommand: string | null;
}

export interface LaunchStatus {
  running: boolean;
  pid: number | null;
  instanceId: string | null;
}

export interface AppSettings {
  minecraftDir: string | null;
  instancesDir: string | null;
  defaultJavaPath: string | null;
  defaultMaxMemoryMb: number;
  exportModpackDir: string | null;
  exportModlistDir: string | null;
  autoScanOnInstanceAdd: boolean;
  autoScanAfterModAdd: boolean;
  autoAuditAfterScan: boolean;
  auditStaleDays: number;
  includeDisabledModsInExports: boolean;
  includeAuditInExports: boolean;
  theme: string;
  lastInstanceId: string | null;
  modrinthEnabled: boolean;
  curseforgeEnabled: boolean;
}

export interface LogEntry {
  id: number;
  level: string;
  message: string;
  context: string | null;
  createdAt: string;
}

export interface DirectoryEntry {
  name: string;
  path: string;
  isDir: boolean;
}

export type PackType = "resourcePack" | "shaderPack" | "datapack";

export interface PackItemMetadata {
  displayName: string;
  author: string;
  websiteUrl: string | null;
  notes: string;
  customized?: boolean;
}

export interface PackItem {
  id: string;
  instanceId: string;
  packType: PackType;
  fileName: string;
  filePath: string;
  isDir: boolean;
  enabled: boolean;
  metadata: PackItemMetadata | null;
}

export interface UpdatePackItemMetadataInput {
  itemId: string;
  displayName: string;
  author: string;
  websiteUrl: string | null;
  notes: string;
}

export type UpdateItemType = "mod";
export type UpdateStatus = "updateAvailable" | "upToDate" | "unknown" | "error";
export type UpdateMatchConfidence = "exact" | "candidate" | "unknown";

export interface UpdateFile {
  fileName: string;
  url: string;
  sha256: string | null;
}

export interface UpdateCandidate {
  projectId: string;
  slug: string;
  title: string;
  projectUrl: string;
  source: string;
}

export interface UpdateRow {
  itemId: string;
  itemType: UpdateItemType;
  fileName: string;
  filePath: string;
  currentVersion: string | null;
  latestVersion: string | null;
  latestVersionId: string | null;
  source: string;
  projectId: string | null;
  projectUrl: string | null;
  releaseDate: string | null;
  status: UpdateStatus;
  matchConfidence: UpdateMatchConfidence;
  confirmed: boolean;
  candidates: UpdateCandidate[];
  latestFile: UpdateFile | null;
  changelog: string | null;
  message: string | null;
}

export interface SavedUpdateCheck {
  instanceId: string;
  checkedAt: string;
  rows: UpdateRow[];
}

export interface UpdateTarget {
  itemId: string;
  itemType: UpdateItemType;
  fileName: string;
}

export interface CheckUpdateTargetInput {
  instanceId: string;
  itemId: string;
}

export interface ConfirmUpdateMatchInput {
  itemId: string;
  projectId: string;
  projectUrl: string;
}

export interface UpdateModFromModrinthInput {
  modId: string;
  versionId: string;
  downloadUrl: string;
  fileName: string;
  expectedSha256: string | null;
}

export interface SuggestionVersionOption {
  versionId: string;
  versionNumber: string;
  downloadUrl: string;
  fileName: string;
  expectedSha256: string | null;
  releaseDate: string;
}

export interface InstallSuggestionFromModrinthInput {
  suggestionId: string;
  versionId: string;
  downloadUrl: string;
  fileName: string;
  expectedSha256: string | null;
}

export interface ConfigTreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: ConfigTreeNode[];
}

export interface CreateInstanceInput {
  name: string;
  gameDir: string;
  loader: LoaderType;
  mcVersion?: string | null;
}

export interface UpdateInstanceInput {
  id: string;
  name?: string | null;
  gameDir?: string | null;
  loader?: LoaderType | null;
  mcVersion?: string | null;
  resourcePacksPath?: string | null;
  shaderPacksPath?: string | null;
  dataPacksPath?: string | null;
  configPath?: string | null;
}

export interface ExportInstanceZipInput {
  instanceId: string;
  outputPath: string;
  includeMods: boolean;
  includeConfigs: boolean;
  includeResourcePacks: boolean;
  includeShaderPacks: boolean;
  includeDatapacks: boolean;
  includeManifest: boolean;
}
