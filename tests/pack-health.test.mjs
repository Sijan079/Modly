import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { analyzePackHealth, satisfiesVersion } from "../src/lib/pack-health.ts";

const base = JSON.parse(readFileSync(new URL("./fixtures/phase2/pack.json", import.meta.url), "utf8"));
const instance = { loader: "fabric", mcVersion: "1.20.1" };
const pack = () => structuredClone(base);
const codes = (snapshot, config = instance, updates = null) => analyzePackHealth(snapshot, config, updates).findings.map((finding) => finding.code);
const edge = (source, target, kind = "required", range = "*") => ({ sourceFilePath: source, targetModId: target, targetFilePath: null, kind, versionRange: range, side: null, manifestPath: "fabric.mod.json", resolution: "missing" });

test("baseline fixture has no findings or claim of safety", () => {
  const result = analyzePackHealth(pack(), instance, null);
  assert.deepEqual(result.findings, []);
  assert.equal(result.checkedMods, 2);
  assert.equal("safe" in result, false);
});

test("missing and disabled required dependencies, while optional and external dependencies do not trigger", () => {
  const p = pack();
  p.relationships.push(edge("mods/app.jar", "absent"), edge("mods/app.jar", "optional", "optional"), edge("mods/app.jar", "minecraft"));
  p.relationships.at(-1).resolution = "external";
  p.mods[1].enabled = false;
  assert.equal(codes(p).filter((code) => code === "missingDependency").length, 2);
  p.mods[1].enabled = true;
  p.relationships = base.relationships;
  assert.deepEqual(codes(p), []);
});

test("dependency ranges detect mismatch and avoid unsupported-syntax guesses", () => {
  const p = pack();
  p.mods[1].observed.version = "3.0.0";
  assert.ok(codes(p).includes("dependencyVersion"));
  p.relationships[0].versionRange = "${file.jar}";
  assert.ok(codes(p).includes("unknownDependencyVersion"));
  assert.ok(!codes(p).includes("dependencyVersion"));
  assert.equal(satisfiesVersion("2.1.0", "[2.0,3.0)"), true);
  assert.equal(satisfiesVersion("3.0.0", "[2.0,3.0)"), false);
  assert.equal(satisfiesVersion("2.1.0", ">=2.0 <3.0"), true);
  assert.equal(satisfiesVersion("2.1.0-beta", ">=2.0"), null);
  assert.equal(satisfiesVersion("?", "*"), true);
});

test("Minecraft and loader mismatches require a known version and loader", () => {
  const p = pack();
  p.mods[0].minecraftConstraints = ["[1.19,1.20)"];
  p.mods[1].observed.loader = "forge";
  assert.ok(codes(p).includes("minecraftMismatch"));
  assert.ok(codes(p).includes("loaderMismatch"));
  assert.ok(!codes(p, {loader: "unknown", mcVersion: null}).includes("loaderMismatch"));
  assert.ok(codes(p, {loader: "unknown", mcVersion: null}).includes("unknownMinecraftVersion"));
  assert.ok(codes(p, {loader: "vanilla", mcVersion: "1.20.1"}).includes("loaderMismatch"));
  p.mods[1].observed.loader = "fabric";
  assert.equal(analyzePackHealth(p, {loader: "quilt", mcVersion: "1.20.1"}, null).findings.find((finding) => finding.code === "loaderMismatch")?.certainty, "possible");
});

test("duplicate IDs and identical archives are distinct evidence", () => {
  const p = pack();
  p.mods[1].observed.providedModIds = ["app"];
  p.mods[1].hashSha256 = p.mods[0].hashSha256;
  assert.ok(codes(p).includes("duplicateId"));
  assert.ok(codes(p).includes("duplicateArchive"));
  p.mods[1].enabled = false;
  assert.ok(!codes(p).includes("duplicateId"));
  assert.ok(!codes(p).includes("duplicateArchive"));
});

test("unreadable archives and incomplete metadata remain separate", () => {
  const p = pack();
  p.mods[0].parseStatus = "parseFailed";
  p.mods[0].parseError = "invalid zip";
  p.mods[0].observed = null;
  p.mods[1].observed.modId = null;
  assert.ok(codes(p).includes("unreadableMetadata"));
  assert.ok(codes(p).includes("incompleteMetadata"));
  p.mods[0].parseStatus = "missingManifest";
  assert.ok(!codes(p).includes("unreadableMetadata"));
});

test("declared conflicts apply only to installed versions within the range", () => {
  const p = pack();
  p.relationships.push({ ...edge("mods/app.jar", "library", "incompatible", "[2.0,3.0)"), targetFilePath: "mods/library.jar", resolution: "installed" });
  assert.ok(codes(p).includes("declaredConflict"));
  p.mods[1].observed.version = "3.0.0";
  p.relationships[0].versionRange = "*";
  assert.ok(!codes(p).includes("declaredConflict"));
});

test("orphan library is possible, not confirmed, and required dependents suppress it", () => {
  const p = pack();
  p.relationships = [];
  const orphan = analyzePackHealth(p, instance, null).findings.find((finding) => finding.code === "possibleOrphan");
  assert.equal(orphan?.certainty, "possible");
  assert.ok(!codes(pack()).includes("possibleOrphan"));
  p.relationships = [{ ...base.relationships[0], kind: "optional" }];
  assert.ok(!codes(p).includes("possibleOrphan"));
});

test("updates require exact confirmed match and matching installed version", () => {
  const p = pack();
  const update = { checkedAt: "2026-09-27", rows: [{ filePath: "mods/app.jar", status: "updateAvailable", matchConfidence: "exact", confirmed: true, latestVersion: "1.1.0", currentVersion: "1.0.0", source: "Modrinth", projectUrl: "https://modrinth.com/mod/app" }] };
  assert.ok(codes(p, instance, update).includes("compatibleUpdate"));
  update.rows[0].matchConfidence = "candidate";
  assert.ok(!codes(p, instance, update).includes("compatibleUpdate"));
  update.rows[0].matchConfidence = "exact";
  update.rows[0].currentVersion = "0.9.0";
  assert.ok(!codes(p, instance, update).includes("compatibleUpdate"));
  update.rows[0].currentVersion = null;
  assert.ok(!codes(p, instance, update).includes("compatibleUpdate"));
});

test("ambiguous dependency and unsupported conflict ranges remain uncertain", () => {
  const p = pack();
  p.relationships.push(edge("mods/app.jar", "ambiguous"));
  p.relationships.at(-1).resolution = "ambiguous";
  p.relationships.push({ ...edge("mods/app.jar", "library", "conflicting", "${unknown}"), targetFilePath: "mods/library.jar", resolution: "installed" });
  const findings = analyzePackHealth(p, instance, null).findings;
  assert.equal(findings.find((finding) => finding.code === "ambiguousDependency")?.certainty, "possible");
  assert.equal(findings.find((finding) => finding.code === "unknownConflictRange")?.certainty, "unknown");
  assert.ok(!findings.some((finding) => finding.code === "declaredConflict"));
});

test("full archive integrity reports override metadata parse errors and ignore disabled files", () => {
  const p = pack();
  p.mods[0].parseStatus = "parseFailed";
  p.mods[0].parseError = "bad archive";
  const issues = [{ filePath: "mods/app.jar", message: "CRC mismatch" }];
  assert.ok(analyzePackHealth(p, instance, null, issues).findings.some((finding) => finding.code === "corruptArchive"));
  assert.ok(!analyzePackHealth(p, instance, null, issues).findings.some((finding) => finding.code === "unreadableMetadata"));
  p.mods[0].enabled = false;
  assert.ok(!analyzePackHealth(p, instance, null, issues).findings.some((finding) => finding.code === "corruptArchive"));
});

test("side-scoped declarations and provided IDs do not create definitive incompatibilities", () => {
  const p = pack();
  p.relationships[0].side = "server";
  p.mods[1].observed.version = "3.0.0";
  assert.equal(analyzePackHealth(p, instance, null).findings.find((finding) => finding.code === "possibleDependencyVersion")?.certainty, "possible");
  p.relationships[0].side = null;
  p.relationships[0].targetModId = "library_alias";
  p.mods[1].observed.providedModIds = ["library_alias"];
  assert.ok(codes(p).includes("unknownDependencyVersion"));
  assert.ok(!codes(p).includes("dependencyVersion"));
  p.relationships.push({ ...edge("mods/app.jar", "library_alias", "conflicting", "[2,4)"), targetFilePath: "mods/library.jar", resolution: "installed" });
  assert.ok(codes(p).includes("unknownConflictRange"));
  assert.ok(!codes(p).includes("declaredConflict"));
});

test("side-scoped missing dependency is a warning until instance side is known", () => {
  const p = pack();
  p.relationships = [edge("mods/app.jar", "serverlib")];
  p.relationships[0].side = "server";
  const finding = analyzePackHealth(p, instance, null).findings.find((item) => item.code === "sideScopedDependency");
  assert.equal(finding?.certainty, "possible");
  assert.equal(finding?.severity, "warning");
  assert.ok(!codes(p).includes("missingDependency"));
});
