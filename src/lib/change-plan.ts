import { analyzePackHealth, type HealthFinding } from "./pack-health.ts";
import type { ChangePlan, DeclaredRelationship, Instance, ObservedMod, PackTruth } from "./types.ts";

const externalIds = new Set(["minecraft", "fabricloader", "forge", "neoforge", "java"]);

export function proposedTruth(plan: ChangePlan): PackTruth {
  const mods = plan.truth.mods.filter((mod) => mod.filePath !== plan.oldFilePath);
  if (plan.candidate && plan.newFilePath) {
    const filename = plan.newFilePath.split(/[\\/]/).pop() ?? plan.newFilePath;
    const candidate: ObservedMod = {
      fileName: filename,
      filePath: plan.newFilePath,
      enabled: true,
      hashSha256: plan.sourceSha256,
      manifestPath: "candidate manifest",
      parseStatus: "parsed",
      parseError: null,
      observed: plan.candidate,
      minecraftConstraints: plan.candidate.dependencies
        .filter((dependency) => dependency.modId.toLowerCase() === "minecraft" && dependency.versionRange)
        .map((dependency) => dependency.versionRange!),
      providerEnrichment: null,
      userAnnotation: null,
    };
    mods.push(candidate);
  }
  const ids = new Map<string, string[]>();
  for (const mod of mods) {
    for (const id of [mod.observed?.modId, ...(mod.observed?.providedModIds ?? [])]) {
      if (id) ids.set(id.toLowerCase(), [...new Set([...(ids.get(id.toLowerCase()) ?? []), mod.filePath])]);
    }
  }
  const existing = plan.truth.relationships.filter((edge) => edge.sourceFilePath !== plan.oldFilePath);
  const candidateEdges: DeclaredRelationship[] = plan.candidate && plan.newFilePath
    ? plan.candidate.dependencies.filter((dependency) => dependency.modId.trim()).map((dependency) => ({
        sourceFilePath: plan.newFilePath!,
        targetModId: dependency.modId,
        targetFilePath: null,
        kind: dependency.kind,
        versionRange: dependency.versionRange,
        side: dependency.side ?? null,
        manifestPath: "candidate manifest",
        resolution: "missing" as const,
      }))
    : [];
  const relationships = [...existing, ...candidateEdges].map((edge): DeclaredRelationship => {
    const id = edge.targetModId.toLowerCase();
    if (edge.kind === "embedded") return { ...edge, targetFilePath: null, resolution: "embedded" };
    if (externalIds.has(id)) return { ...edge, targetFilePath: null, resolution: "external" };
    const targets = ids.get(id) ?? [];
    return { ...edge, targetFilePath: targets.length === 1 ? targets[0] : null,
      resolution: targets.length === 1 ? "installed" : targets.length ? "ambiguous" : "missing" };
  });
  return { instanceId: plan.instanceId, mods, relationships };
}

export function changeFindings(plan: ChangePlan, instance: Pick<Instance, "loader" | "mcVersion">): HealthFinding[] {
  const before = analyzePackHealth(plan.truth, instance, null).findings;
  const after = analyzePackHealth(proposedTruth(plan), instance, null).findings;
  const old = new Set(before.map((finding) => `${finding.code}:${finding.title}:${finding.detail}`));
  return after.filter((finding) =>
    (plan.newFilePath !== null && finding.filePaths.includes(plan.newFilePath)) ||
    !old.has(`${finding.code}:${finding.title}:${finding.detail}`));
}
