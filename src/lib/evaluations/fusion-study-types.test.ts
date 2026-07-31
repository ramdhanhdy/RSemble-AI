// =============================================================================
// RSemble AI — Fusion Study type guard tests
//
// Round-trips for every persisted record, prohibited-key rejection, and the
// task-level verification field (spec required tests 1 and 9, type half).
// =============================================================================

import { describe, expect, it } from "vitest";
import type { ModelSlot } from "../../studio-data";
import {
  isEvaluationObservation,
  isFusionAttempt,
  isFusionPlaybook,
  isFusionRecipeVersion,
  isFusionStudy,
  isFusionTrial,
  isPoolManifestVersion,
  isVerifierOutcome,
  type EvaluationObservation,
  type FusionAttempt,
  type FusionPlaybook,
  type FusionRecipeVersion,
  type FusionStudy,
  type FusionTrial,
  type PoolManifestVersion,
} from "./fusion-study-types";
import { isEvaluationTask, type EvaluationTask } from "./evaluation-types";

function slot(id: string, slug: string): ModelSlot {
  return {
    id,
    providerId: "openrouter",
    provider: "Test",
    model: `Model ${id}`,
    slug,
    enabled: true,
  };
}

function makeRecipe(): FusionRecipeVersion {
  return {
    id: "recipe-blind-raw",
    version: 1,
    recipeFamily: "BlindRaw",
    promptVersion: "blind-raw-v1",
    judgeAnalysisMode: "none",
    rubricAccess: false,
    verification: false,
    synthesizer: { providerId: "openrouter", model: "acme/synth-1" },
  };
}

function makeManifest(): PoolManifestVersion {
  return {
    id: "core-pool",
    version: 3,
    core: [
      slot("s1", "a/m1"),
      slot("s2", "a/m2"),
      slot("s3", "b/m3"),
      slot("s4", "c/m4"),
      slot("s5", "d/m5"),
      slot("s6", "e/m6"),
    ],
    challengers: [slot("s7", "f/m7")],
    diversityChecklist: ["independent families", "cost tiers"],
    rationale: "Diverse failure modes across families and tiers.",
    supersedesVersion: 2,
    createdAt: 1000,
  };
}

function makeTrial(): FusionTrial {
  return {
    id: "trial-1",
    revision: 0,
    studyId: "study-1",
    suiteRef: { suiteId: "suite-1", suiteVersion: 4, protocolFingerprint: "sha256:abc" },
    poolRef: { id: "core-pool", version: 3 },
    candidateConfig: { slots: [slot("s1", "a/m1"), slot("s3", "b/m3")] },
    judge1: { providerId: "openrouter", model: "acme/judge-1" },
    judge2: { providerId: "gemini", model: "acme/judge-2" },
    recipe: { id: "recipe-blind-raw", version: 1 },
    stage: "B",
    sampleIndex: 0,
    children: {
      candidateRunId: "run-cand",
      devJudgeRunId: "run-judge",
      synthesisArtifact: { runId: "run-fuse", fusionAttemptId: "fa-1", contentHash: "sha256:def" },
    },
    observationIds: ["obs-1"],
    cost: {
      policy: { tokensIn: 1000, tokensOut: 500 },
      experimental: { tokensIn: 1400, tokensOut: 650 },
    },
    status: "in_progress",
    sealedAt: null,
    createdAt: 1000,
    updatedAt: 1000,
  };
}

function makeAttempt(): FusionAttempt {
  return {
    id: "attempt-1",
    studyId: "study-1",
    fromTrialId: "trial-1",
    toTrialId: "trial-2",
    reason: "synthesis_rerun",
    createdAt: 1000,
  };
}

function makeObservation(): EvaluationObservation {
  return {
    id: "obs-1",
    trialId: "trial-1",
    judge: { providerId: "gemini", model: "acme/judge-2" },
    runId: "run-holdout",
    status: "completed",
    overallScore: 4.25,
    tokensIn: 300,
    tokensOut: 120,
    error: null,
    startedAt: 1000,
    finishedAt: 1100,
  };
}

function makeStudy(): FusionStudy {
  return {
    id: "study-1",
    revision: 0,
    kind: "exploration",
    suiteRef: { suiteId: "suite-1", suiteVersion: 4, protocolFingerprint: "sha256:abc" },
    poolRef: { id: "core-pool", version: 3 },
    judge1: { providerId: "openrouter", model: "acme/judge-1" },
    judge2: { providerId: "gemini", model: "acme/judge-2" },
    recipeRefs: [{ id: "recipe-blind-raw", version: 1 }],
    stageResults: { stageA: null, stageB: null, stageC: null },
    playbookRef: null,
    claimLevel: "exploratory",
    confirmationOf: null,
    status: "in_progress",
    createdAt: 1000,
    updatedAt: 1000,
  };
}

function makePlaybook(): FusionPlaybook {
  return {
    id: "playbook-1",
    studyId: "study-1",
    suiteRef: { suiteId: "suite-1", suiteVersion: 4, protocolFingerprint: "sha256:abc" },
    rows: [
      {
        policy: "best_fixed",
        configuration: "Model A",
        score: 4.18,
        lift: 0,
        costMultiplier: 1,
        confidence: "high",
      },
      {
        policy: "fuse",
        configuration: "B + C → Synth X",
        score: 4.52,
        lift: 0.34,
        costMultiplier: 3.2,
        confidence: "medium",
      },
    ],
    recommendation: { kind: "do_not_fuse", rationale: "Rank matches Fuse within MPID at lower cost." },
    poolAdequacy: { probed: true, outcome: "confirmed", challengerKeys: ["g/m8"], note: "Challenger failed on the same instances." },
    claimLevel: "exploratory",
    conclusion: "Rank A+C when cost matters; do not use fusion for routine runs.",
    createdAt: 1000,
  };
}

describe("fusion-study type guards — round trips", () => {
  it("accepts well-formed records", () => {
    expect(isFusionRecipeVersion(makeRecipe())).toBe(true);
    expect(isPoolManifestVersion(makeManifest())).toBe(true);
    expect(isFusionTrial(makeTrial())).toBe(true);
    expect(isFusionAttempt(makeAttempt())).toBe(true);
    expect(isEvaluationObservation(makeObservation())).toBe(true);
    expect(isFusionStudy(makeStudy())).toBe(true);
    expect(isFusionPlaybook(makePlaybook())).toBe(true);
    expect(
      isVerifierOutcome({ taskId: "t1", modelKey: "a/m1", passed: true, executedAt: 1000 }),
    ).toBe(true);
  });

  it("round-trips through JSON serialization (persistence shape)", () => {
    const trial = makeTrial();
    expect(isFusionTrial(JSON.parse(JSON.stringify(trial)))).toBe(true);
    const study = makeStudy();
    expect(isFusionStudy(JSON.parse(JSON.stringify(study)))).toBe(true);
  });

  it("rejects tampered sealed-trial provenance", () => {
    const trial = makeTrial();
    const tampered = { ...trial, judge2: { providerId: "openrouter" } };
    expect(isFusionTrial(tampered)).toBe(false);
    expect(isFusionTrial({ ...trial, sampleIndex: 1.5 })).toBe(false);
    expect(isFusionTrial({ ...trial, stage: "D" })).toBe(false);
  });
});

describe("fusion-study type guards — prohibited keys", () => {
  it("rejects records carrying credential-shaped keys at any depth", () => {
    const recipe = {
      ...makeRecipe(),
      synthesizer: { providerId: "openrouter", model: "acme/synth-1", apiKey: "sk-…" },
    };
    expect(isFusionRecipeVersion(recipe)).toBe(false);

    const manifest = { ...makeManifest(), meta: { nested: { secret: "x" } } };
    expect(isPoolManifestVersion(manifest)).toBe(false);

    const trial = { ...makeTrial(), authorization: "Bearer …" };
    expect(isFusionTrial(trial)).toBe(false);

    const playbook = { ...makePlaybook(), rows: [...makePlaybook().rows, { policy: "rank", configuration: "A+C", score: 4.3, lift: 0.1, costMultiplier: 2.4, confidence: "high", token: "t" }] };
    expect(isFusionPlaybook(playbook)).toBe(false);
  });
});

describe("EvaluationTask verification field", () => {
  const baseTask: EvaluationTask = {
    id: "task-1",
    title: "Task",
    prompt: "Do the thing",
    systemPrompt: "",
    evaluation: { kind: "inherit" },
    judgeInstructionOverride: "",
    order: 0,
  };

  it("accepts tasks without verification and with a valid verifier kind", () => {
    expect(isEvaluationTask(baseTask)).toBe(true);
    expect(isEvaluationTask({ ...baseTask, verification: { kind: "none" } })).toBe(true);
    expect(isEvaluationTask({ ...baseTask, verification: { kind: "unit_tests" } })).toBe(true);
  });

  it("rejects unknown verifier kinds", () => {
    expect(isEvaluationTask({ ...baseTask, verification: { kind: "vibes" } })).toBe(false);
  });
});

describe("blindness invariant", () => {
  it("the recipe record carries no blindness field — blindness is not a variable", () => {
    const recipe = makeRecipe() as unknown as Record<string, unknown>;
    expect("blind" in recipe).toBe(false);
    expect("blindness" in recipe).toBe(false);
    expect("blindMode" in recipe).toBe(false);
  });
});
