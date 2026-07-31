// =============================================================================
// RSemble AI — Fusion Study validation tests
//
// Pool bounds, recipe required-fields, judge-pair anti-circularity, and study
// confirmation-linkage validation.
// =============================================================================

import { describe, expect, it } from "vitest";
import type { ModelSlot } from "../../studio-data";
import type { CriticRef } from "../providers/types";
import type { FusionRecipeVersion, FusionStudy, PoolManifestVersion } from "./fusion-study-types";
import {
  findJudgeCircularityConflict,
  validateJudgePair,
  validatePoolManifest,
  validateRecipe,
  validateStudy,
} from "./fusion-study-validation";

function slot(id: string, slug: string, enabled = true): ModelSlot {
  return { id, providerId: "openrouter", provider: "Test", model: id, slug, enabled };
}

function poolOf(coreCount: number, challengerCount: number): PoolManifestVersion {
  const core = Array.from({ length: coreCount }, (_, i) => slot(`c${i}`, `fam${i}/m${i}`));
  const challengers = Array.from({ length: challengerCount }, (_, i) =>
    slot(`x${i}`, `challenger${i}/m`),
  );
  return {
    id: "core-pool",
    version: 1,
    core,
    challengers,
    diversityChecklist: ["independent families"],
    rationale: "Failure-mode diversity.",
    supersedesVersion: null,
    createdAt: 1000,
  };
}

const judge1: CriticRef = { providerId: "openrouter", model: "acme/judge-1" };
const judge2: CriticRef = { providerId: "gemini", model: "acme/judge-2" };
const synthesizer: CriticRef = { providerId: "openrouter", model: "acme/synth-1" };

describe("validatePoolManifest", () => {
  it("accepts 6–8 core models with 0–2 challengers", () => {
    expect(validatePoolManifest(poolOf(6, 0)).valid).toBe(true);
    expect(validatePoolManifest(poolOf(8, 2)).valid).toBe(true);
  });

  it("rejects core pools outside 6–8", () => {
    expect(validatePoolManifest(poolOf(5, 0)).valid).toBe(false);
    expect(validatePoolManifest(poolOf(9, 0)).valid).toBe(false);
  });

  it("rejects more than 2 challengers and pools over 10", () => {
    const threeChallengers = poolOf(7, 3);
    const result = validatePoolManifest(threeChallengers);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "challengers")).toBe(true);
  });

  it("rejects duplicate enabled providerId:slug keys across core and challengers", () => {
    const manifest = poolOf(6, 1);
    manifest.challengers[0] = slot("dup", "fam0/m0");
    const result = validatePoolManifest(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("fam0/m0"))).toBe(true);
  });

  it("requires a diversity checklist entry and a rationale", () => {
    const manifest = poolOf(6, 0);
    expect(validatePoolManifest({ ...manifest, diversityChecklist: [] }).valid).toBe(false);
    expect(validatePoolManifest({ ...manifest, rationale: "  " }).valid).toBe(false);
  });

  it("requires supersedesVersion to be a lower positive version", () => {
    const manifest = poolOf(6, 0);
    expect(validatePoolManifest({ ...manifest, version: 3, supersedesVersion: 2 }).valid).toBe(true);
    expect(validatePoolManifest({ ...manifest, version: 3, supersedesVersion: 3 }).valid).toBe(false);
    expect(validatePoolManifest({ ...manifest, version: 3, supersedesVersion: 0 }).valid).toBe(false);
  });
});

describe("validateRecipe", () => {
  const base: FusionRecipeVersion = {
    id: "r1",
    version: 1,
    recipeFamily: "AnalysisScores",
    promptVersion: "as-v1",
    judgeAnalysisMode: "scores",
    rubricAccess: true,
    verification: true,
    synthesizer: { providerId: "openrouter", model: "acme/synth-1" },
  };

  it("accepts a consistent recipe", () => {
    expect(validateRecipe(base).valid).toBe(true);
  });

  it("rejects a family/mode mismatch — the family is the ablation", () => {
    const result = validateRecipe({ ...base, recipeFamily: "BlindRaw" });
    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toBe("judgeAnalysisMode");
  });

  it("requires id, version, promptVersion, and synthesizer", () => {
    expect(validateRecipe({ ...base, id: "" }).valid).toBe(false);
    expect(validateRecipe({ ...base, version: 0 }).valid).toBe(false);
    expect(validateRecipe({ ...base, promptVersion: "" }).valid).toBe(false);
    expect(
      validateRecipe({ ...base, synthesizer: { providerId: "openrouter", model: "" } }).valid,
    ).toBe(false);
  });
});

describe("anti-circularity (spec §5.3)", () => {
  it("accepts a sound judge configuration", () => {
    expect(findJudgeCircularityConflict(judge1, judge2, synthesizer)).toBeNull();
    expect(validateJudgePair(judge1, judge2, synthesizer).valid).toBe(true);
  });

  it("rejects Judge 2 = Judge 1, naming the conflict", () => {
    const conflict = findJudgeCircularityConflict(judge1, judge1, synthesizer);
    expect(conflict).toContain("openrouter:acme/judge-1");
    expect(conflict).toContain("development judge");
  });

  it("rejects Judge 2 = synthesizer, naming the conflict", () => {
    const conflict = findJudgeCircularityConflict(judge1, synthesizer, synthesizer);
    expect(conflict).toContain("synthesizer");
    expect(validateJudgePair(judge1, synthesizer, synthesizer).valid).toBe(false);
  });
});

describe("validateStudy", () => {
  const base: FusionStudy = {
    id: "study-1",
    revision: 0,
    kind: "exploration",
    suiteRef: { suiteId: "s1", suiteVersion: 4, protocolFingerprint: "sha256:abc" },
    poolRef: { id: "core-pool", version: 1 },
    judge1,
    judge2,
    recipeRefs: [{ id: "r1", version: 1 }],
    stageResults: { stageA: null, stageB: null, stageC: null },
    playbookRef: null,
    claimLevel: "exploratory",
    confirmationOf: null,
    status: "in_progress",
    createdAt: 1000,
    updatedAt: 1000,
  };

  it("accepts a well-formed exploration study", () => {
    expect(validateStudy(base).valid).toBe(true);
  });

  it("requires at least one recipe and distinct judges", () => {
    expect(validateStudy({ ...base, recipeRefs: [] }).valid).toBe(false);
    expect(validateStudy({ ...base, judge2: judge1 }).valid).toBe(false);
  });

  it("enforces confirmation linkage rules (spec §7.5)", () => {
    const confirmation: FusionStudy = {
      ...base,
      kind: "confirmation",
      confirmationOf: "study-0",
      claimLevel: "confirmed",
    };
    expect(validateStudy(confirmation).valid).toBe(true);
    expect(validateStudy({ ...base, kind: "confirmation" }).valid).toBe(false);
    expect(validateStudy({ ...base, confirmationOf: "study-0" }).valid).toBe(false);
    expect(validateStudy({ ...base, claimLevel: "confirmed" }).valid).toBe(false);
  });
});
