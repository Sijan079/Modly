import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { proposedTruth, changeFindings } from "../src/lib/change-plan.ts";

const base = JSON.parse(readFileSync(new URL("./fixtures/phase2/pack.json", import.meta.url), "utf8"));
const instance = { loader: "fabric", mcVersion: "1.20.1" };
const plan = (kind, oldFilePath, newFilePath, candidate = null) => ({
  id: "test", kind, instanceId: "pack", oldFilePath, newFilePath,
  sourceSha256: newFilePath ? "candidate-hash" : null, candidate,
  truth: structuredClone(base), directDependents: [], transitiveDependents: [], backupPath: null,
});

test("removing a required library exposes dependent failure before apply", () => {
  const change = plan("remove", "mods/library.jar", null);
  assert.equal(proposedTruth(change).mods.length, 1);
  assert.ok(changeFindings(change, instance).some((finding) => finding.code === "missingDependency"));
});

test("candidate loader, Minecraft and conflict declarations are reviewed", () => {
  const candidate = {
    name: "Candidate", version: "1.0.0", modId: "candidate", providedModIds: [],
    loader: "forge", dependencies: [
      { modId: "minecraft", kind: "required", versionRange: "[1.19,1.20)", side: null },
      { modId: "app", kind: "incompatible", versionRange: "*", side: null },
    ],
  };
  const change = plan("add", null, "mods/candidate.jar", candidate);
  const codes = changeFindings(change, instance).map((finding) => finding.code);
  assert.ok(codes.includes("loaderMismatch"));
  assert.ok(codes.includes("minecraftMismatch"));
  assert.ok(codes.includes("declaredConflict"));
});

test("updating a library reports dependent version break", () => {
  const candidate = { ...base.mods[1].observed, version: "3.0.0" };
  const change = plan("update", "mods/library.jar", "mods/library.jar", candidate);
  assert.ok(changeFindings(change, instance).some((finding) => finding.code === "dependencyVersion"));
});
