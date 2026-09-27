import type { Instance, ObservedMod, PackArchiveIssue, PackTruth, SavedUpdateCheck } from "@/lib/types";

export type HealthCategory = "Compatibility" | "Dependencies" | "Integrity" | "Updates" | "Orphans" | "Metadata";
export type HealthCertainty = "confirmed" | "knownIncompatibility" | "possible" | "unknown";
export type HealthSeverity = "error" | "warning" | "info";

export interface HealthFinding {
  id: string;
  category: HealthCategory;
  code: string;
  severity: HealthSeverity;
  certainty: HealthCertainty;
  title: string;
  detail: string;
  evidence: string[];
  remediation: string;
  filePaths: string[];
}

export interface PackHealthResult {
  instanceId: string;
  checkedMods: number;
  findings: HealthFinding[];
}

// A null result means the declared syntax or installed version is not understood.
export function satisfiesVersion(version: string, range: string): boolean | null {
  if (range.trim() === "*") return true;
  const value = numericVersion(version);
  if (!value) return null;
  const alternatives = range.split("||").map((part) => part.trim());
  let unknown = false;
  for (const alternative of alternatives) {
    if (!alternative) { unknown = true; continue; }
    if (alternative === "*") return true;
    const interval = alternative.match(/^([[(])\s*([^,]*)\s*,\s*([^,]*)\s*([)\]])$/);
    if (interval) {
      const lower = interval[2] ? numericVersion(interval[2]) : null;
      const upper = interval[3] ? numericVersion(interval[3]) : null;
      if ((interval[2] && !lower) || (interval[3] && !upper)) { unknown = true; continue; }
      if ((!lower || compare(value, lower) >= (interval[1] === "[" ? 0 : 1)) &&
          (!upper || compare(value, upper) <= (interval[4] === "]" ? 0 : -1))) return true;
      continue;
    }
    const parts = alternative.split(/\s*,\s*|\s+/).filter(Boolean);
    let matched = true;
    for (const part of parts) {
      const parsed = part.match(/^(>=|<=|>|<|=|\^|~)?(\d+(?:\.\d+)*)$/);
      if (!parsed) { unknown = true; matched = false; break; }
      const target = numericVersion(parsed[2])!;
      const relation = compare(value, target);
      const op = parsed[1] ?? "=";
      if (op === "^" || op === "~") {
        const upper = [...target];
        const index = op === "~" ? Math.min(1, upper.length - 1) : (target.findIndex((n) => n !== 0) + target.length) % target.length;
        upper[index] += 1;
        upper.splice(index + 1);
        if (relation < 0 || compare(value, upper) >= 0) matched = false;
      } else if (!(op === ">=" ? relation >= 0 : op === ">" ? relation > 0 : op === "<=" ? relation <= 0 : op === "<" ? relation < 0 : relation === 0)) matched = false;
    }
    if (matched) return true;
  }
  return unknown ? null : false;
}

function numericVersion(value: string): number[] | null {
  if (!/^\d+(?:\.\d+)*$/.test(value.trim())) return null;
  return value.trim().split(".").map(Number);
}

function compare(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
  }
  return 0;
}

export function analyzePackHealth(truth: PackTruth, instance: Pick<Instance, "loader" | "mcVersion">, updates: SavedUpdateCheck | null, archiveIssues: PackArchiveIssue[] = []): PackHealthResult {
  const active = truth.mods.filter((mod) => mod.enabled);
  const byPath = new Map(active.map((mod) => [mod.filePath, mod]));
  const findings: HealthFinding[] = [];
  const add = (code: string, category: HealthCategory, severity: HealthSeverity, certainty: HealthCertainty, title: string, detail: string, evidence: string[], remediation: string, filePaths: string[]) => {
    findings.push({ id: `${code}:${filePaths.join("|")}:${title}`, code, category, severity, certainty, title, detail, evidence, remediation, filePaths });
  };
  const name = (mod: ObservedMod) => mod.observed?.name || mod.fileName;
  const source = (mod: ObservedMod) => `${mod.fileName} / ${mod.manifestPath ?? "no supported manifest"}`;
  const relationships = truth.relationships.filter((edge) => byPath.has(edge.sourceFilePath));

  for (const mod of active) {
    const archiveIssue = archiveIssues.find((issue) => issue.filePath === mod.filePath);
    if (archiveIssue) {
      add("corruptArchive", "Integrity", "error", "confirmed", `Unreadable archive: ${mod.fileName}`, archiveIssue.message, [mod.filePath, archiveIssue.message], "Replace or remove the file, then rescan.", [mod.filePath]);
      continue;
    }
    if (mod.parseStatus === "parseFailed") {
      add("unreadableMetadata", "Integrity", "error", "confirmed", `Cannot read ${mod.fileName}`, mod.parseError ?? "The archive or manifest could not be parsed.", [mod.filePath, mod.parseError ?? "Parse failed"], "Replace or remove the file, then rescan.", [mod.filePath]);
      continue;
    }
    if (mod.parseStatus === "missingManifest" || !mod.observed?.modId || mod.observed.version === "?" || mod.observed.nameIsFallback) {
      add("incompleteMetadata", "Metadata", "info", "unknown", `Incomplete metadata: ${mod.fileName}`, "Modly cannot fully identify this mod from its local manifest.", [source(mod)], "Inspect the JAR or identify it manually; compatibility checks may be incomplete.", [mod.filePath]);
    }
    if (!mod.observed) continue;
    if (instance.loader !== "unknown" && mod.observed.loader !== "unknown" && mod.observed.loader !== instance.loader) {
      const fabricOnQuilt = instance.loader === "quilt" && mod.observed.loader === "fabric";
      add("loaderMismatch", "Compatibility", fabricOnQuilt ? "warning" : "error", fabricOnQuilt ? "possible" : "knownIncompatibility", `${name(mod)} targets ${mod.observed.loader}`, `This instance is configured for ${instance.loader}.`, [source(mod), `Instance loader: ${instance.loader}`], fabricOnQuilt ? "Check whether this Fabric mod supports Quilt." : "Install a build for this instance's loader or change the instance loader.", [mod.filePath]);
    }
    for (const constraint of mod.minecraftConstraints) {
      if (!instance.mcVersion) {
        add("unknownMinecraftVersion", "Compatibility", "info", "unknown", `Cannot check Minecraft version for ${name(mod)}`, "The instance has no Minecraft version set.", [source(mod), `Declared range: ${constraint}`], "Set the instance Minecraft version, then rescan.", [mod.filePath]);
      } else {
        const result = satisfiesVersion(instance.mcVersion, constraint);
        if (result === false) add("minecraftMismatch", "Compatibility", "error", "knownIncompatibility", `${name(mod)} targets another Minecraft version`, `${instance.mcVersion} is outside ${constraint}.`, [source(mod), `Instance version: ${instance.mcVersion}`, `Declared range: ${constraint}`], "Use a compatible mod build or instance version.", [mod.filePath]);
        if (result === null) add("unknownMinecraftRange", "Compatibility", "info", "unknown", `Cannot evaluate ${name(mod)} Minecraft range`, "The declared version syntax is unsupported or the instance version is not numeric.", [source(mod), `Instance version: ${instance.mcVersion}`, `Declared range: ${constraint}`], "Review the declared range manually.", [mod.filePath]);
      }
    }
  }

  const ids = new Map<string, ObservedMod[]>();
  for (const mod of active) {
    if (!mod.observed) continue;
    for (const id of new Set([mod.observed.modId, ...(mod.observed.providedModIds ?? [])].filter((id): id is string => !!id))) {
      const key = id.toLowerCase();
      ids.set(key, [...(ids.get(key) ?? []), mod]);
    }
  }
  for (const [id, mods] of ids) if (mods.length > 1) {
    add("duplicateId", "Compatibility", "error", "confirmed", `Duplicate mod ID: ${id}`, "Multiple enabled JARs declare the same ID.", mods.map(source), "Keep one compatible version of the mod.", mods.map((mod) => mod.filePath));
  }
  const hashes = new Map<string, ObservedMod[]>();
  for (const mod of active) if (mod.hashSha256) hashes.set(mod.hashSha256, [...(hashes.get(mod.hashSha256) ?? []), mod]);
  for (const [hash, mods] of hashes) if (mods.length > 1) {
    add("duplicateArchive", "Integrity", "warning", "possible", "Identical JAR files installed", "These files have the same SHA-256 hash; they may be duplicate libraries.", [`SHA-256: ${hash}`, ...mods.map((mod) => mod.fileName)], "Review these files and remove an unnecessary copy.", mods.map((mod) => mod.filePath));
  }

  for (const edge of relationships) {
    const mod = byPath.get(edge.sourceFilePath)!;
    const target = edge.targetFilePath ? byPath.get(edge.targetFilePath) : undefined;
    const evidence = [`${source(mod)} declares ${edge.kind} ${edge.targetModId}${edge.versionRange ? ` ${edge.versionRange}` : ""}`, `Resolution: ${edge.resolution}`, ...(edge.side ? [`Side: ${edge.side}`] : [])];
    const sideScoped = edge.side === "client" || edge.side === "server";
    if (edge.kind === "required" && edge.resolution !== "external" && edge.resolution !== "embedded" && !target) {
      const ambiguous = edge.resolution === "ambiguous";
      const uncertain = ambiguous || sideScoped;
      add(ambiguous ? "ambiguousDependency" : sideScoped ? "sideScopedDependency" : "missingDependency", "Dependencies", uncertain ? "warning" : "error", uncertain ? "possible" : "confirmed", `${name(mod)} requires ${edge.targetModId}`, ambiguous ? "Multiple installed files provide this ID; the dependency cannot be resolved uniquely." : sideScoped ? `This dependency applies to the ${edge.side} side; the instance side is unknown.` : edge.targetFilePath ? "The matching JAR is disabled." : "No enabled JAR provides this ID.", evidence, "Inspect the dependency and install or enable one compatible copy.", [mod.filePath, ...(edge.targetFilePath ? [edge.targetFilePath] : [])]);
    }
    if (target && edge.versionRange && edge.kind === "required") {
      const primaryIdMatches = target.observed?.modId?.toLowerCase() === edge.targetModId.toLowerCase();
      const actual = target.observed?.version;
      const result = actual && primaryIdMatches ? satisfiesVersion(actual, edge.versionRange) : null;
      if (result === false) add(sideScoped ? "possibleDependencyVersion" : "dependencyVersion", "Dependencies", sideScoped ? "warning" : "error", sideScoped ? "possible" : "knownIncompatibility", `${name(mod)} needs another ${edge.targetModId} version`, `Installed version ${actual} is outside ${edge.versionRange}.`, [...evidence, `${target.fileName} declares version ${actual}`], "Install a dependency version within the declared range.", [mod.filePath, target.filePath]);
      if (result === null) add("unknownDependencyVersion", "Dependencies", "info", "unknown", `Cannot check ${edge.targetModId} version`, "The dependency version or declared range cannot be compared reliably.", [...evidence, `${target.fileName} version: ${actual ?? "unknown"}`], "Review the dependency versions manually.", [mod.filePath, target.filePath]);
    }
    if (target && (edge.kind === "incompatible" || edge.kind === "conflicting")) {
      const actual = target.observed?.version;
      const primaryIdMatches = target.observed?.modId?.toLowerCase() === edge.targetModId.toLowerCase();
      const result = edge.versionRange ? (actual && primaryIdMatches ? satisfiesVersion(actual, edge.versionRange) : null) : true;
      if (result === true) add(sideScoped ? "possibleConflict" : "declaredConflict", "Compatibility", sideScoped ? "warning" : "error", sideScoped ? "possible" : "knownIncompatibility", `${name(mod)} conflicts with ${name(target)}`, "Both mods are enabled and the declared incompatibility applies.", [...evidence, `${target.fileName} version: ${actual ?? "unknown"}`], "Remove one mod or install versions that do not conflict.", [mod.filePath, target.filePath]);
      if (result === null) add("unknownConflictRange", "Compatibility", "info", "unknown", `Cannot check conflict with ${name(target)}`, "The declared conflict range or installed version cannot be compared reliably.", evidence, "Review the declared conflict manually.", [mod.filePath, target.filePath]);
    }
  }

  for (const mod of active) {
    if (!mod.observed?.modId || !/(?:lib|library|api|core)$/i.test(mod.observed.modId)) continue;
    const dependents = relationships.filter((edge) => edge.targetFilePath === mod.filePath && !["incompatible", "conflicting"].includes(edge.kind));
    if (!dependents.length) add("possibleOrphan", "Orphans", "info", "possible", `${name(mod)} may be unused`, "Its ID suggests a library, but no enabled mod declares a dependency on it.", [source(mod), "No incoming dependency relationship in this scan"], "Review optional uses and configs before removing it.", [mod.filePath]);
  }

  for (const row of updates?.rows ?? []) {
    const mod = byPath.get(row.filePath);
    if (!mod || row.status !== "updateAvailable" || row.matchConfidence !== "exact" || !row.confirmed || !row.latestVersion) continue;
    if (!row.currentVersion || mod.observed?.version !== row.currentVersion) continue;
    add("compatibleUpdate", "Updates", "info", "possible", `Update available for ${name(mod)}`, `Provider reported ${row.latestVersion} as compatible when last checked. Availability may have changed.`, [`${row.source}: ${row.projectUrl ?? row.projectId ?? "matched project"}`, `Checked: ${updates!.checkedAt}`, `Installed: ${row.currentVersion ?? "unknown"}`], "Open Updates to review and confirm before applying.", [mod.filePath]);
  }
  findings.sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  return { instanceId: truth.instanceId, checkedMods: active.length, findings };
}
