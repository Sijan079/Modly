import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { assessRecommendation, isScoutAnalysisCurrent, scoutPackHealth } from "../src/lib/scout-evidence.ts";

const truth = JSON.parse(readFileSync(new URL("./fixtures/phase2/pack.json", import.meta.url), "utf8"));
const instance = { loader: "fabric", mcVersion: "1.20.1" };
const analysis = {
  mods: [{ filePath: "mods/library.jar", metadata: { name: "Library", installedModrinthVersionId: "installed-version" }, providerMetadata: { projectId: "library-project" } }],
};
const recommendation = (dependencies = [], overrides = {}) => ({
  candidate: { title: "Candidate", dateModified: "2026-09-01T00:00:00Z" },
  fit: { label: "Goal match", reason: "Matches requested farming topic.", matchingCategories: [], matchingGoalTerms: ["farming"] },
  availability: "matched", evidenceWarning: null,
  versionEvidence: { versionId: "version", versionNumber: "1.0.0", publishedAt: "2026-09-01T00:00:00Z", gameVersions: ["1.20.1"], loaders: ["fabric"], dependencies },
  ...overrides,
});

test("Scout uses canonical health findings separately from recommendations", () => {
  assert.deepEqual(scoutPackHealth(truth, instance).findings, []);
  const result = assessRecommendation(recommendation(), truth, analysis, instance);
  assert.equal(result.performance, "Unknown");
  assert.equal(result.minecraft.status, "compatible");
  assert.equal(result.loader.status, "compatible");
  assert.equal(result.blocked, false);
});

test("required project without exact installed hash match needs review", () => {
  const result = assessRecommendation(recommendation([{ projectId: "missing-project", versionId: null, fileName: null, dependencyType: "required" }]), truth, analysis, instance);
  assert.equal(result.dependencies.status, "needsReview");
  assert.match(result.dependencies.detail, /missing-project/);
});

test("known provider conflict and unavailable release block saving", () => {
  const conflict = assessRecommendation(recommendation([{ projectId: "library-project", versionId: null, fileName: null, dependencyType: "incompatible" }]), truth, analysis, instance);
  assert.equal(conflict.conflicts.status, "blocked");
  assert.equal(conflict.blocked, true);
  const unavailable = assessRecommendation(recommendation([], { availability: "none", versionEvidence: null }), truth, analysis, instance);
  assert.equal(unavailable.blocked, true);
});

test("Minecraft and loader mismatches are blocked by release evidence", () => {
  const mismatch = recommendation([], { versionEvidence: { ...recommendation().versionEvidence, gameVersions: ["1.19.4"], loaders: ["forge"] } });
  const result = assessRecommendation(mismatch, truth, analysis, instance);
  assert.equal(result.minecraft.status, "blocked");
  assert.equal(result.loader.status, "blocked");
  assert.equal(result.blocked, true);
});

test("disabled installed project does not satisfy a requirement", () => {
  const disabled = structuredClone(truth);
  disabled.mods[1].enabled = false;
  const result = assessRecommendation(recommendation([{ projectId: "library-project", versionId: null, fileName: null, dependencyType: "required" }]), disabled, analysis, instance);
  assert.equal(result.dependencies.status, "needsReview");
});

test("saved Scout analysis is invalidated by a changed local JAR", () => {
  const snapshot = { totalJars: 2, mods: truth.mods.map((mod) => ({ filePath: mod.filePath, hashSha256: mod.hashSha256 })) };
  assert.equal(isScoutAnalysisCurrent(truth, snapshot), true);
  const changed = structuredClone(truth);
  changed.mods[0].hashSha256 = "new-content";
  assert.equal(isScoutAnalysisCurrent(changed, snapshot), false);
});
