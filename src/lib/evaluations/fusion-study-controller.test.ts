// =============================================================================
// RSemble AI — Fusion Study controller tests
//
// The Trial/Attempt semantics matrix (spec test 3), anti-circularity seal
// enforcement (spec test 2), and cost accounting (spec test 10).
// =============================================================================

import { describe, expect, it } from "vitest";
import { InMemoryFusionStudyRepository } from "../persistence/fusion-study-repository";
import {
  createFusionStudyController,
  rollCostInto,
  zeroTrialCost,
  type FusionStudyController,
} from "./fusion-study-controller";
import type { ModelSlot } from "../../studio-data";
import type { CriticRef } from "../providers/types";
import type {
  FusionRecipeVersion,
  FusionStudy,
  FusionTrial,
} from "./fusion-study-types";

const judge1: CriticRef = { providerId: "openrouter", model: "acme/judge-1" };
const judge2: CriticRef = { providerId: "gemini", model: "acme/judge-2" };
const synthesizer: CriticRef = { providerId: "openrouter", model: "acme/synth-1" };

function slot(id: string, slug: string): ModelSlot {
  return { id, providerId: "openrouter", provider: "Test", model: id, slug, enabled: true };
}

const RECIPE: FusionRecipeVersion = {
  id: "recipe-1",
  version: 1,
  recipeFamily: "BlindRaw",
  promptVersion: "br-v1",
  judgeAnalysisMode: "none",
  rubricAccess: true,
  verification: false,
  synthesizer,
};

function makeStudy(id = "study-1", overrides: Partial<FusionStudy> = {}): FusionStudy {
  return {
    id,
    revision: 0,
    kind: "exploration",
    suiteRef: { suiteId: "suite-1", suiteVersion: 4, protocolFingerprint: "sha256:abc" },
    poolRef: { id: "pool-1", version: 1 },
    judge1,
    judge2,
    recipeRefs: [{ id: "recipe-1", version: 1 }],
    stageResults: { stageA: null, stageB: null, stageC: null },
    playbookRef: null,
    claimLevel: "exploratory",
    confirmationOf: null,
    status: "in_progress",
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

async function setup(overrides: Partial<FusionStudy> = {}) {
  const repo = new InMemoryFusionStudyRepository();
  await repo.createRecipe(RECIPE);
  const study = makeStudy("study-1", overrides);
  await repo.createStudy(study);
  let counter = 0;
  let clock = 1000;
  const controller = createFusionStudyController({
    repo,
    generateId: () => `id-${++counter}`,
    now: () => ++clock,
  });
  return { repo, study, controller };
}

function fuseTrialInput(study: FusionStudy): Parameters<FusionStudyController["createTrial"]>[0] {
  return {
    study,
    poolRef: study.poolRef,
    candidateConfig: { slots: [slot("s1", "a/m1"), slot("s2", "b/m2")] },
    policy: "fuse",
    recipe: { id: RECIPE.id, version: RECIPE.version },
    synthesizer,
    stage: "B",
    sampleIndex: 0,
  };
}

function observation(overrides = {}) {
  return {
    judge: judge2,
    runId: null,
    status: "failed" as const,
    overallScore: null,
    tokensIn: null,
    tokensOut: null,
    error: { message: "holdout timeout" },
    startedAt: 1000,
    finishedAt: 1100,
    ...overrides,
  };
}

describe("Trial/Attempt semantics matrix (spec §6.2, test 3)", () => {
  it("holdout failure → new observation on the SAME trial (artifact preserved)", async () => {
    const { controller } = await setup();
    const trial = await controller.createTrial(fuseTrialInput(makeStudy()));
    const { observation: obs1 } = await controller.addHoldoutObservation(trial.id, observation());
    expect(obs1.status).toBe("failed");

    const after = await controller.addHoldoutObservation(
      trial.id,
      observation({ status: "completed", overallScore: 4.2, error: null }),
    );
    const reloaded = after.trial;
    expect(reloaded.id).toBe(trial.id);
    expect(reloaded.sampleIndex).toBe(0);
    expect(reloaded.observationIds).toHaveLength(2);
  });

  it("regrade with another judge family → new observation, same trial", async () => {
    const { controller } = await setup();
    const trial = await controller.createTrial(fuseTrialInput(makeStudy()));
    await controller.addHoldoutObservation(
      trial.id,
      observation({ status: "completed", overallScore: 4.0, error: null }),
    );
    const secondJudge: CriticRef = { providerId: "commandcode", model: "acme/judge-3" };
    const { trial: after } = await controller.addHoldoutObservation(
      trial.id,
      observation({ judge: secondJudge, status: "completed", overallScore: 4.1, error: null }),
    );
    expect(after.sampleIndex).toBe(0);
    expect(after.observationIds).toHaveLength(2);
  });

  it("retry storms never inflate sample counts", async () => {
    const { repo, controller } = await setup();
    const trial = await controller.createTrial(fuseTrialInput(makeStudy()));
    let current = trial;
    for (let i = 0; i < 7; i++) {
      const result = await controller.addHoldoutObservation(current.id, observation());
      current = result.trial;
    }
    expect(current.sampleIndex).toBe(0);
    expect(current.observationIds).toHaveLength(7);
    expect((await repo.listTrials("study-1")).filter((t) => t.id === trial.id)).toHaveLength(1);
  });

  it("synthesis rerun → new trial attempt (sampleIndex + 1) with an immutable link", async () => {
    const { repo, controller } = await setup();
    const trial = await controller.createTrial(fuseTrialInput(makeStudy()));
    const successor = await controller.rerunTreatment(trial.id, "synthesis_rerun");
    expect(successor.id).not.toBe(trial.id);
    expect(successor.sampleIndex).toBe(1);
    expect(successor.recipe).toEqual(trial.recipe);
    const attempts = await repo.listTrialAttempts("study-1");
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      fromTrialId: trial.id,
      toTrialId: successor.id,
      reason: "synthesis_rerun",
    });
  });

  it("candidate regeneration → new trial attempt", async () => {
    const { repo, controller } = await setup();
    const trial = await controller.createTrial(fuseTrialInput(makeStudy()));
    const successor = await controller.rerunTreatment(trial.id, "candidate_regeneration");
    expect(successor.sampleIndex).toBe(1);
    const attempts = await repo.listTrialAttempts("study-1");
    expect(attempts[0].reason).toBe("candidate_regeneration");
  });

  it("recipe change → new trial (no attempt link, sampleIndex restarts)", async () => {
    const { repo, controller } = await setup();
    const trial = await controller.createTrial(fuseTrialInput(makeStudy()));
    const fresh = await controller.changeRecipe(
      trial.id,
      { id: "recipe-1", version: 2 },
      synthesizer,
    );
    expect(fresh.id).not.toBe(trial.id);
    expect(fresh.sampleIndex).toBe(0);
    expect(fresh.recipe).toEqual({ id: "recipe-1", version: 2 });
    expect(await repo.listTrialAttempts("study-1")).toHaveLength(0);
  });

  it("observations cannot attach to a sealed trial", async () => {
    const { controller } = await setup();
    const trial = await controller.createTrial(fuseTrialInput(makeStudy()));
    await controller.seal(trial.id);
    await expect(controller.addHoldoutObservation(trial.id, observation())).rejects.toThrow(
      /sealed/,
    );
  });
});

describe("anti-circularity seal check (spec test 2)", () => {
  it("rejects Judge 2 = Judge 1 at seal, naming the conflict", async () => {
    const { controller } = await setup({ judge2: judge1 });
    const trial = await controller.createTrial(fuseTrialInput(makeStudy("study-1", { judge2: judge1 })));
    await expect(controller.seal(trial.id)).rejects.toThrow(/development judge openrouter:acme\/judge-1/);
  });

  it("rejects Judge 2 = synthesizer at seal, naming the conflict", async () => {
    const { controller } = await setup({ judge2: synthesizer });
    const trial = await controller.createTrial(
      fuseTrialInput(makeStudy("study-1", { judge2: synthesizer })),
    );
    await expect(controller.seal(trial.id)).rejects.toThrow(/synthesizer/);
  });

  it("rank trials (no synthesizer) seal with distinct judges and reject judge equality", async () => {
    const { repo, controller } = await setup();
    const study = makeStudy();
    const rankTrial = await controller.createTrial({
      study,
      poolRef: study.poolRef,
      candidateConfig: { slots: [slot("s1", "a/m1"), slot("s2", "b/m2")] },
      policy: "rank",
      recipe: null,
      synthesizer: null,
      stage: "B",
      sampleIndex: 0,
    });
    const sealed = await controller.seal(rankTrial.id);
    expect(sealed.status).toBe("sealed");

    // Judge equality still blocks rank-trial sealing even without a synthesizer.
    const badStudy = makeStudy("study-2", { judge2: judge1 });
    await repo.createStudy(badStudy);
    const badTrial = await controller.createTrial({
      study: badStudy,
      poolRef: badStudy.poolRef,
      candidateConfig: { slots: [slot("s1", "a/m1"), slot("s2", "b/m2")] },
      policy: "rank",
      recipe: null,
      synthesizer: null,
      stage: "B",
      sampleIndex: 0,
    });
    await expect(controller.seal(badTrial.id)).rejects.toThrow(/development judge/);
  });
});

describe("cost accounting (spec §6.4, test 10)", () => {
  it("edge costs roll up to trial observed cost; policy and experimental reported separately", () => {
    let cost = zeroTrialCost();
    cost = rollCostInto(cost, { tokensIn: 100, tokensOut: 50, countsTowardPolicy: true });
    cost = rollCostInto(cost, { tokensIn: 40, tokensOut: 20, countsTowardPolicy: false });
    expect(cost.policy).toEqual({ tokensIn: 100, tokensOut: 50 });
    expect(cost.experimental).toEqual({ tokensIn: 140, tokensOut: 70 });
  });

  it("trial cost accumulates clean edges as policy and retries as experimental-only", async () => {
    const { controller } = await setup();
    const trial: FusionTrial = await controller.createTrial(fuseTrialInput(makeStudy()));
    await controller.addCostEdge(trial.id, { tokensIn: 1000, tokensOut: 500, countsTowardPolicy: true });
    const after = await controller.addCostEdge(trial.id, {
      tokensIn: 300,
      tokensOut: 120,
      countsTowardPolicy: false,
    });
    expect(after.cost.policy).toEqual({ tokensIn: 1000, tokensOut: 500 });
    expect(after.cost.experimental).toEqual({ tokensIn: 1300, tokensOut: 620 });
  });
});

describe("child links and seal finality", () => {
  it("assembles children then seals with full provenance", async () => {
    const { controller } = await setup();
    const trial = await controller.createTrial(fuseTrialInput(makeStudy()));
    await controller.attachChildren(trial.id, {
      candidateRunId: "run-cand",
      devJudgeRunId: "run-judge",
      synthesisArtifact: { runId: "run-fuse", fusionAttemptId: "fa-1", contentHash: "sha256:xyz" },
    });
    const sealed = await controller.seal(trial.id);
    expect(sealed.children.candidateRunId).toBe("run-cand");
    expect(sealed.children.synthesisArtifact?.contentHash).toBe("sha256:xyz");
    expect(sealed.sealedAt).not.toBeNull();
    await expect(controller.seal(trial.id)).rejects.toThrow(/final/);
  });
});
