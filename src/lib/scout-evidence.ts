import { analyzePackHealth, type PackHealthResult } from "./pack-health.ts";
import type { Instance, PackTruth, Recommendation, ScoutAnalysis } from "./types.ts";

export type EvidenceStatus = "compatible" | "blocked" | "needsReview" | "unknown";
export interface EvidenceDimension { status: EvidenceStatus; detail: string }
export interface ScoutAssessment {
  minecraft: EvidenceDimension;
  loader: EvidenceDimension;
  dependencies: EvidenceDimension;
  conflicts: EvidenceDimension;
  blocked: boolean;
  reason: string;
  maintenance: string;
  performance: "Unknown";
}

const normalizedPath = (path: string) => path.replace(/\\/g, "/").toLowerCase();

export function scoutPackHealth(truth: PackTruth, instance: Pick<Instance, "loader" | "mcVersion">): PackHealthResult {
  return analyzePackHealth(truth, instance, null);
}

export function isScoutAnalysisCurrent(truth: PackTruth, analysis: ScoutAnalysis): boolean {
  if (truth.mods.length !== analysis.totalJars || truth.mods.filter((mod) => mod.parseStatus !== "parseFailed").length !== analysis.mods.length) return false;
  const byPath = new Map(truth.mods.map((mod) => [normalizedPath(mod.filePath), mod]));
  return analysis.mods.every((mod) => {
    const observed = byPath.get(normalizedPath(mod.filePath));
    return !!mod.hashSha256 && observed?.hashSha256 === mod.hashSha256;
  });
}

export function assessRecommendation(
  recommendation: Recommendation,
  truth: PackTruth,
  analysis: ScoutAnalysis,
  instance: Pick<Instance, "loader" | "mcVersion">,
): ScoutAssessment {
  const version = recommendation.versionEvidence;
  const activePaths = new Set(truth.mods.filter((mod) => mod.enabled).map((mod) => normalizedPath(mod.filePath)));
  const installedByProject = new Map(analysis.mods
    .filter((mod) => activePaths.has(normalizedPath(mod.filePath)) && mod.providerMetadata?.projectId)
    .map((mod) => [mod.providerMetadata!.projectId, mod]));

  const minecraft: EvidenceDimension = !instance.mcVersion || !version
    ? { status: "unknown", detail: version ? "Instance Minecraft version is unknown." : "No compatible release details were returned." }
    : version.gameVersions.includes(instance.mcVersion)
      ? { status: "compatible", detail: `${version.versionNumber} lists Minecraft ${instance.mcVersion}.` }
      : { status: "blocked", detail: `${version.versionNumber} does not list Minecraft ${instance.mcVersion}.` };
  const loader: EvidenceDimension = instance.loader === "unknown" || !version
    ? { status: "unknown", detail: version ? "Instance loader is unknown." : "Release loader details are unavailable." }
    : version.loaders.some((value) => value.toLowerCase() === instance.loader.toLowerCase())
      ? { status: "compatible", detail: `${version.versionNumber} lists ${instance.loader}.` }
      : { status: "blocked", detail: `${version.versionNumber} does not list ${instance.loader}.` };

  const missing: string[] = [];
  const uncertain: string[] = [];
  const conflicts: string[] = [];
  for (const dependency of version?.dependencies ?? []) {
    if (dependency.dependencyType !== "required" && dependency.dependencyType !== "incompatible") continue;
    const installed = dependency.projectId ? installedByProject.get(dependency.projectId) : undefined;
    const label = dependency.projectId ?? dependency.fileName ?? dependency.versionId ?? "unidentified dependency";
    if (dependency.dependencyType === "incompatible") {
      if (installed) conflicts.push(`${installed.metadata.name} (${label})`);
    } else if (!dependency.projectId) {
      uncertain.push(`${label}: provider did not identify a project`);
    } else if (!installed) {
      missing.push(label);
    } else if (dependency.versionId && installed.metadata.installedModrinthVersionId !== dependency.versionId) {
      uncertain.push(`${installed.metadata.name}: exact required version cannot be confirmed locally`);
    }
  }
  const dependencies: EvidenceDimension = !version
    ? { status: "unknown", detail: "Required dependencies cannot be checked without release details." }
    : missing.length
      ? { status: "needsReview", detail: `Requires additional projects: ${missing.join(", ")}.` }
      : uncertain.length
        ? { status: "needsReview", detail: uncertain.join("; ") }
        : { status: "compatible", detail: "No unmet required projects in this provider release among exact hash matches. The JAR manifest is checked during install review." };
  const conflictDimension: EvidenceDimension = !version
    ? { status: "unknown", detail: "Declared conflicts cannot be checked without release details." }
    : conflicts.length
      ? { status: "blocked", detail: `Provider release declares incompatibility with installed ${conflicts.join(", ")}.` }
      : { status: "needsReview", detail: "No provider release conflict matched an installed project. Local JAR manifest conflicts remain unverified until staging." };

  return {
    minecraft, loader, dependencies, conflicts: conflictDimension,
    blocked: recommendation.availability === "none" || [minecraft, loader, dependencies, conflictDimension].some((item) => item.status === "blocked"),
    reason: recommendation.fit.reason,
    maintenance: recommendation.candidate.dateModified
      ? `Modrinth project last changed ${recommendation.candidate.dateModified.slice(0, 10)}; activity is not a quality guarantee.`
      : "Modrinth activity date unavailable; maintenance quality is unknown.",
    performance: "Unknown",
  };
}
