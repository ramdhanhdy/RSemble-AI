// =============================================================================
// RSemble AI — Fusion Study repository tests
//
// Exercises both the Dexie-backed and in-memory repositories: versioned
// recipe/manifest immutability, study revision guards, the sealTrial
// anti-circularity transaction, trial-attempt linkage rules, and observation
// attach semantics (spec required tests 1, 2, and 9).
// =============================================================================

import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { RSembleEvaluationDB } from "./database";
import {
  createFusionStudyRepository,
  InMemoryFusionStudyRepository,
  type FusionStudyRepository,
} from "./fusion-study-repository";
import type { ModelSlot } from "../../studio-data";
import type {
  EvaluationObservation,
  FusionAttempt,
  FusionPlaybook,
  FusionRecipeVersion,
  FusionStudy,
  FusionTrial,
  PoolManifestVersion,
} from "../evaluations/fusion-study-types";

function slot(id: string, slug: string): ModelSlot {
  return { id, providerId: "openrouter", provider: "Test", model: id, slug, enabled: true };
}

function makeRecipe(id = "recipe-1", version = 1): FusionRecipeVersion {
  return {
    id,
    version,
    recipeFamily: "BlindRaw",
    promptVersion: "blind-raw-v1",
    judgeAnalysisMode: "none",
    rubricAccess: false,
    verification: false,
    synthesizer: { providerId: "openrouter", model: "acme/synth-1" },
  };
}

function makeManifest(id = "pool-1", version = 1): PoolManifestVersion {
  return {
    id,
    version,
    core: [
      slot("s1", "a/m1"),
      slot("s2", "a/m2"),
      slot("s3", "b/m3"),
      slot("s4", "c/m4"),
      slot("s5", "d/m5"),
      slot("s6", "e/m6"),
    ],
    challengers: [],
    diversityChecklist: ["independent families"],
    rationale: "test",
    supersedesVersion: null,
    createdAt: 1000,
  };
}

function makeStudy(id = "study-1"): FusionStudy {
  return {
    id,
    revision: 0,
    kind: "exploration",
    suiteRef: { suiteId: "suite-1", suiteVersion: 4, protocolFingerprint: "sha256:abc" },
    poolRef: { id: "pool-1", version: 1 },
    judge1: { providerId: "openrouter", model: "acme/judge-1" },
    judge2: { providerId: "gemini", model: "acme/judge-2" },
    recipeRefs: [{ id: "recipe-1", version: 1 }],
    stageResults: { stageA: null, stageB: null, stageC: null },
    playbookRef: null,
    claimLevel: "exploratory",
    confirmationOf: null,
    status: "in_progress",
    createdAt: 1000,
    updatedAt: 1000,
  };
}

function makeTrial(id: string, overrides: Partial<FusionTrial> = {}): FusionTrial {
  return {
    id,
    revision: 0,
    studyId: "study-1",
    suiteRef: { suiteId: "suite-1", suiteVersion: 4, protocolFingerprint: "sha256:abc" },
    poolRef: { id: "pool-1", version: 1 },
    candidateConfig: { slots: [slot("s1", "a/m1"), slot("s3", "b/m3")] },
    judge1: { providerId: "openrouter", model: "acme/judge-1" },
    judge2: { providerId: "gemini", model: "acme/judge-2" },
    recipe: { id: "recipe-1", version: 1 },
    stage: "B",
    sampleIndex: 0,
    children: { candidateRunId: null, devJudgeRunId: null, synthesisArtifact: null },
    observationIds: [],
    cost: {
      policy: { tokensIn: 0, tokensOut: 0 },
      experimental: { tokensIn: 0, tokensOut: 0 },
    },
    status: "in_progress",
    sealedAt: null,
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

function makeObservation(id: string, trialId: string): EvaluationObservation {
  return {
    id,
    trialId,
    judge: { providerId: "gemini", model: "acme/judge-2" },
    runId: null,
    status: "failed",
    overallScore: null,
    tokensIn: null,
    tokensOut: null,
    error: { message: "holdout timeout" },
    startedAt: 1000,
    finishedAt: 1100,
  };
}

function makePlaybook(id = "playbook-1"): FusionPlaybook {
  return {
    id,
    studyId: "study-1",
    suiteRef: { suiteId: "suite-1", suiteVersion: 4, protocolFingerprint: "sha256:abc" },
    rows: [],
    recommendation: { kind: "do_not_fuse", rationale: "No pair clears the MPID." },
    poolAdequacy: { probed: false, outcome: null, challengerKeys: [], note: "" },
    claimLevel: "exploratory",
    conclusion: "Do not fuse for this suite.",
    createdAt: 1000,
  };
}

/** Runs the same suite against a repository factory. */
function repositorySuite(name: string, makeRepo: () => FusionStudyRepository & object) {
  describe(name, () => {
    it("creates and reads back versioned recipes; duplicates are rejected", async () => {
      const repo = makeRepo();
      await repo.createRecipe(makeRecipe("recipe-1", 1));
      await repo.createRecipe(makeRecipe("recipe-1", 2));
      expect(await repo.getRecipe("recipe-1", 1)).toMatchObject({ version: 1 });
      expect((await repo.getLatestRecipe("recipe-1"))?.version).toBe(2);
      await expect(repo.createRecipe(makeRecipe("recipe-1", 1))).rejects.toThrow(/immutable/);
    });

    it("creates pool manifests with immutable versions", async () => {
      const repo = makeRepo();
      await repo.createPoolManifest(makeManifest("pool-1", 1));
      expect(await repo.getPoolManifest("pool-1", 1)).toMatchObject({ id: "pool-1" });
      await expect(repo.createPoolManifest(makeManifest("pool-1", 1))).rejects.toThrow(/immutable/);
    });

    it("guards study updates by revision", async () => {
      const repo = makeRepo();
      await repo.createStudy(makeStudy());
      const study = (await repo.getStudy("study-1"))!;
      const rev = await repo.updateStudy({ ...study, updatedAt: 2000 }, study.revision);
      expect(rev).toBe(1);
      await expect(repo.updateStudy({ ...study, updatedAt: 3000 }, 0)).rejects.toThrow(/Stale/);
    });

    it("seals a trial and the seal is final", async () => {
      const repo = makeRepo();
      await repo.createRecipe(makeRecipe());
      await repo.createTrial(makeTrial("trial-1"));
      const rev = await repo.sealTrial("trial-1", 0, 5000);
      expect(rev).toBe(1);
      const sealed = (await repo.getTrial("trial-1"))!;
      expect(sealed.status).toBe("sealed");
      expect(sealed.sealedAt).toBe(5000);
      // Seal is final: no second seal, no link updates.
      await expect(repo.sealTrial("trial-1", 1, 6000)).rejects.toThrow(/final/);
      await expect(repo.updateTrialLinks({ ...sealed, updatedAt: 6000 }, 1)).rejects.toThrow(/final/);
    });

    it("rejects sealing when Judge 2 = Judge 1, naming the conflict", async () => {
      const repo = makeRepo();
      await repo.createRecipe(makeRecipe());
      await repo.createTrial(
        makeTrial("trial-bad", { judge2: { providerId: "openrouter", model: "acme/judge-1" } }),
      );
      await expect(repo.sealTrial("trial-bad", 0, 5000)).rejects.toThrow(
        /development judge openrouter:acme\/judge-1/,
      );
    });

    it("rejects sealing when Judge 2 = synthesizer, naming the conflict", async () => {
      const repo = makeRepo();
      await repo.createRecipe(makeRecipe());
      await repo.createTrial(
        makeTrial("trial-bad2", { judge2: { providerId: "openrouter", model: "acme/synth-1" } }),
      );
      await expect(repo.sealTrial("trial-bad2", 0, 5000)).rejects.toThrow(/synthesizer/);
    });

    it("rejects sealing a trial whose recipe version is missing", async () => {
      const repo = makeRepo();
      await repo.createTrial(makeTrial("trial-norecipe"));
      await expect(repo.sealTrial("trial-norecipe", 0, 5000)).rejects.toThrow(/not found/);
    });

    it("assembles child links only while in_progress", async () => {
      const repo = makeRepo();
      await repo.createRecipe(makeRecipe());
      await repo.createTrial(makeTrial("trial-1"));
      const trial = (await repo.getTrial("trial-1"))!;
      const linked: FusionTrial = {
        ...trial,
        children: { candidateRunId: "run-1", devJudgeRunId: "run-2", synthesisArtifact: null },
      };
      const rev = await repo.updateTrialLinks(linked, trial.revision);
      expect((await repo.getTrial("trial-1"))!.children.candidateRunId).toBe("run-1");
      await repo.sealTrial("trial-1", rev, 5000);
    });

    it("records treatment-changing attempts with sampleIndex increments", async () => {
      const repo = makeRepo();
      await repo.createTrial(makeTrial("trial-1"));
      await repo.createTrial(makeTrial("trial-2", { sampleIndex: 1 }));
      const attempt: FusionAttempt = {
        id: "attempt-1",
        studyId: "study-1",
        fromTrialId: "trial-1",
        toTrialId: "trial-2",
        reason: "synthesis_rerun",
        createdAt: 2000,
      };
      await repo.recordTrialAttempt(attempt);
      expect(await repo.listTrialAttempts("study-1")).toHaveLength(1);
      // Attempts are immutable.
      await expect(repo.recordTrialAttempt(attempt)).rejects.toThrow(/immutable/);
    });

    it("rejects attempt links that skip sampleIndex or change the treatment", async () => {
      const repo = makeRepo();
      await repo.createTrial(makeTrial("trial-1"));
      await repo.createTrial(makeTrial("trial-3", { sampleIndex: 2 }));
      await expect(
        repo.recordTrialAttempt({
          id: "a-skip",
          studyId: "study-1",
          fromTrialId: "trial-1",
          toTrialId: "trial-3",
          reason: "candidate_regeneration",
          createdAt: 2000,
        }),
      ).rejects.toThrow(/sampleIndex/);

      await repo.createTrial(
        makeTrial("trial-other-recipe", {
          sampleIndex: 1,
          recipe: { id: "recipe-1", version: 2 },
        }),
      );
      await expect(
        repo.recordTrialAttempt({
          id: "a-recipe",
          studyId: "study-1",
          fromTrialId: "trial-1",
          toTrialId: "trial-other-recipe",
          reason: "synthesis_rerun",
          createdAt: 2000,
        }),
      ).rejects.toThrow(/new trial/);
    });

    it("attaches observations to the same trial — retry storms never inflate samples", async () => {
      const repo = makeRepo();
      await repo.createTrial(makeTrial("trial-1"));
      let trial = (await repo.getTrial("trial-1"))!;
      for (let i = 0; i < 3; i++) {
        await repo.addObservation(makeObservation(`obs-${i}`, "trial-1"), trial.revision);
        trial = (await repo.getTrial("trial-1"))!;
      }
      // Three holdout retries: same trial, same sampleIndex, three observations.
      expect(trial.sampleIndex).toBe(0);
      expect(trial.observationIds).toEqual(["obs-0", "obs-1", "obs-2"]);
      expect(await repo.listObservations("trial-1")).toHaveLength(3);
      // Observations are immutable.
      await expect(repo.addObservation(makeObservation("obs-0", "trial-1"), 3)).rejects.toThrow(
        /immutable/,
      );
    });

    it("creates playbooks as immutable deliverables", async () => {
      const repo = makeRepo();
      await repo.createPlaybook(makePlaybook());
      expect(await repo.getPlaybook("playbook-1")).toMatchObject({ claimLevel: "exploratory" });
      await expect(repo.createPlaybook(makePlaybook())).rejects.toThrow(/immutable/);
    });
  });
}

repositorySuite("InMemoryFusionStudyRepository", () => new InMemoryFusionStudyRepository());

const dbs: RSembleEvaluationDB[] = [];
afterEach(async () => {
  while (dbs.length > 0) {
    const db = dbs.pop()!;
    db.close();
    await db.delete();
  }
});

repositorySuite("Dexie fusion-study repository", () => {
  const db = new RSembleEvaluationDB(`fusion-test-${crypto.randomUUID()}`);
  dbs.push(db);
  return createFusionStudyRepository(db);
});
