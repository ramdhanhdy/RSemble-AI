// =============================================================================
// RSemble AI — Fusion corpus characterization (Child 06 Milestone A, T0)
//
// Pins the LIVE Fusion corpus on baseline `0bab030e` (Dexie v11, seven Fusion
// stores from schema v2) so the later hard-migration (Milestone B) can fail
// against it. The suite has four characterization surfaces:
//
//   1. Source inventory — the seven stores, repository methods, controller
//      methods, route branches, and UI actions are all present on the current
//      baseline.
//   2. Fixture type guards — every record in FUSION_CORPUS_FIXTURE passes its
//      live type guard, and prohibited keys are rejected.
//   3. Repository round-trip — the live InMemoryFusionStudyRepository
//      reproduces the sealed-trial + observation + attempt + immutability
//      semantics using fixture data.
//   4. STOP classification — every study maps via the Suite→Task Set
//      crosswalk (resolved or explicitly unresolved), and every provenance
//      ref (recipe, pool, playbook, attempt trials) reconstructs from the
//      fixture. This is the gate Milestone B must clear.
//
// This is CHARACTERIZATION ONLY. It does not migrate, add Lab stores, or
// change the Fusion runtime.
// =============================================================================

import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RSembleEvaluationDB } from "../persistence/database";
import {
  InMemoryFusionStudyRepository,
  type FusionStudyRepository,
} from "../persistence/fusion-study-repository";
import { createFusionStudyController } from "../evaluations/fusion-study-controller";
import {
  isEvaluationObservation,
  isFusionAttempt,
  isFusionPlaybook,
  isFusionRecipeVersion,
  isFusionStudy,
  isFusionTrial,
  isPoolManifestVersion,
} from "../evaluations/fusion-study-types";
import {
  FUSION_CONTROLLER_METHODS,
  FUSION_CORPUS_FIXTURE,
  FUSION_RECIPE_FAMILIES_IN_FIXTURE,
  FUSION_REPOSITORY_METHODS,
  FUSION_ROUTE_BRANCHES,
  FUSION_STAGES_IN_FIXTURE,
  FUSION_STORE_NAMES,
  FUSION_UI_ACTIONS,
} from "./fusion-corpus-fixture";

// --- 1. Source inventory ------------------------------------------------------

describe("Fusion source inventory (baseline 0bab030e)", () => {
  it("exposes exactly the seven Fusion stores on the live Dexie schema", () => {
    const db = new RSembleEvaluationDB("fusion-corpus-inventory");
    for (const name of FUSION_STORE_NAMES) {
      const table = (db as unknown as Record<string, unknown>)[name];
      expect(table, `store ${name} must be declared on RSembleEvaluationDB`).toBeDefined();
      // Dexie Table instances expose a `.schema` property once stores() ran.
      expect(typeof (table as { schema?: unknown }).schema, `${name} must be a Dexie Table`).toBe(
        "object",
      );
    }
    // No eighth Fusion store exists on the live schema.
    const fusionish = Object.keys(db).filter((k) => /fusion|poolManifest/i.test(k));
    expect(fusionish.sort()).toEqual([...FUSION_STORE_NAMES].sort());
    db.close();
  });

  it("exposes every FusionStudyRepository method on the live in-memory repository", () => {
    const repo = new InMemoryFusionStudyRepository();
    for (const method of FUSION_REPOSITORY_METHODS) {
      expect(typeof (repo as unknown as Record<string, unknown>)[method], `${method} present`).toBe(
        "function",
      );
    }
  });

  it("exposes every FusionStudyController method on the live controller factory", () => {
    const controller = createFusionStudyController({
      repo: new InMemoryFusionStudyRepository(),
      generateId: () => "generated-id",
      now: () => 12345,
    });
    for (const method of FUSION_CONTROLLER_METHODS) {
      expect(
        typeof (controller as unknown as Record<string, unknown>)[method],
        `${method} present`,
      ).toBe("function");
    }
  });

  it("registers the two live Fusion route branches in app-router.tsx", () => {
    const source = readFileSync("src/app-router.tsx", "utf8");
    for (const branch of FUSION_ROUTE_BRANCHES) {
      // The literal path template appears verbatim in the route definition.
      expect(source, `route branch ${branch} present`).toContain(branch);
    }
    // The legacy redirect resolves via the Suite→Task Set crosswalk key.
    expect(source).toContain("ts-xwalk:fusion:");
    expect(source).toContain("LegacyFusionRedirect");
  });

  it("registers the three live Fusion UI actions in FusionStudyPanel.tsx", () => {
    const source = readFileSync("src/workspaces/evaluations/FusionStudyPanel.tsx", "utf8");
    for (const action of FUSION_UI_ACTIONS) {
      expect(source, `UI action ${action} present`).toContain(action);
    }
  });
});

// --- 2. Fixture type guards ---------------------------------------------------

describe("Fusion corpus fixture — live type guards", () => {
  it("accepts every recipe, pool, study, trial, attempt, observation, and playbook", () => {
    for (const r of FUSION_CORPUS_FIXTURE.recipes) {
      expect(isFusionRecipeVersion(r)).toBe(true);
    }
    for (const p of FUSION_CORPUS_FIXTURE.pools) {
      expect(isPoolManifestVersion(p)).toBe(true);
    }
    for (const s of FUSION_CORPUS_FIXTURE.studies) {
      expect(isFusionStudy(s)).toBe(true);
    }
    for (const t of FUSION_CORPUS_FIXTURE.trials) {
      expect(isFusionTrial(t)).toBe(true);
    }
    for (const a of FUSION_CORPUS_FIXTURE.attempts) {
      expect(isFusionAttempt(a)).toBe(true);
    }
    for (const o of FUSION_CORPUS_FIXTURE.observations) {
      expect(isEvaluationObservation(o)).toBe(true);
    }
    for (const pb of FUSION_CORPUS_FIXTURE.playbooks) {
      expect(isFusionPlaybook(pb)).toBe(true);
    }
  });

  it("covers every recipe family, policy, stage, claim level, and lifecycle state", () => {
    const families = new Set(FUSION_CORPUS_FIXTURE.recipes.map((r) => r.recipeFamily));
    expect([...families].sort()).toEqual([...FUSION_RECIPE_FAMILIES_IN_FIXTURE].sort());

    const policies = new Set(FUSION_CORPUS_FIXTURE.trials.map((t) => t.policy));
    expect([...policies].sort()).toEqual(["best_fixed", "fuse", "rank", "refine"]);

    const stages = new Set(FUSION_CORPUS_FIXTURE.trials.map((t) => t.stage));
    expect([...stages].sort()).toEqual([...FUSION_STAGES_IN_FIXTURE].sort());

    const claimLevels = new Set(FUSION_CORPUS_FIXTURE.studies.map((s) => s.claimLevel));
    expect([...claimLevels].sort()).toEqual(["confirmed", "exploratory"]);

    const studyStatuses = new Set(FUSION_CORPUS_FIXTURE.studies.map((s) => s.status));
    expect([...studyStatuses].sort()).toEqual(["completed", "in_progress"]);

    const trialStatuses = new Set(FUSION_CORPUS_FIXTURE.trials.map((t) => t.status));
    expect([...trialStatuses].sort()).toEqual(["in_progress", "sealed"]);

    const obsStatuses = new Set(FUSION_CORPUS_FIXTURE.observations.map((o) => o.status));
    expect([...obsStatuses].sort()).toEqual(["completed", "failed"]);
  });

  it("includes exploration, confirmation, do_not_fuse, and an unresolved-owner study", () => {
    const kinds = new Set(FUSION_CORPUS_FIXTURE.studies.map((s) => s.kind));
    expect(kinds).toContain("exploration");
    expect(kinds).toContain("confirmation");

    const dnf = FUSION_CORPUS_FIXTURE.playbooks.find(
      (p) => p.recommendation.kind === "do_not_fuse",
    );
    expect(dnf, "do_not_fuse playbook present").toBeDefined();
    expect(dnf?.studyId).toBe("study-do-not-fuse");

    const confirm = FUSION_CORPUS_FIXTURE.studies.find((s) => s.kind === "confirmation");
    expect(confirm?.confirmationOf).toBe("study-exploration-completed");
    expect(confirm?.claimLevel).toBe("confirmed");

    expect(FUSION_CORPUS_FIXTURE.unresolvedOwnerStudyIds).toEqual(["study-unresolved-owner"]);
  });

  it("includes a treatment-changing retry (attempt) and measurement-only observations", () => {
    const attemptRow = FUSION_CORPUS_FIXTURE.attempts[0];
    expect(attemptRow.reason).toBe("synthesis_rerun");
    const from = FUSION_CORPUS_FIXTURE.trials.find((t) => t.id === attemptRow.fromTrialId);
    const to = FUSION_CORPUS_FIXTURE.trials.find((t) => t.id === attemptRow.toTrialId);
    expect(from?.sampleIndex).toBe(0);
    expect(to?.sampleIndex).toBe(1);
    expect(to?.studyId).toBe(from?.studyId);

    const failed = FUSION_CORPUS_FIXTURE.observations.find((o) => o.status === "failed");
    expect(failed?.error).not.toBeNull();
    expect(failed?.overallScore).toBeNull();
  });

  it("includes policy vs experimental cost, artifacts, pool adequacy, and recipe sensitivity", () => {
    const sealedFuse = FUSION_CORPUS_FIXTURE.trials.find((t) => t.id === "trial-ec-fuse-B-0")!;
    expect(sealedFuse.cost.policy.tokensIn).toBeGreaterThan(0);
    expect(sealedFuse.cost.experimental.tokensIn).toBeGreaterThanOrEqual(
      sealedFuse.cost.policy.tokensIn,
    );
    expect(sealedFuse.children.synthesisArtifact).not.toBeNull();
    expect(sealedFuse.children.synthesisArtifact?.contentHash).toMatch(/^sha256:/);

    const completed = FUSION_CORPUS_FIXTURE.studies.find(
      (s) => s.id === "study-exploration-completed",
    )!;
    expect(completed.stageResults.stageB).not.toBeNull();
    expect(completed.stageResults.stageB!.poolAdequacy.outcome).toBe("confirmed");
    expect(completed.stageResults.stageB!.policyResults.map((p) => p.policy).sort()).toEqual([
      "best_fixed",
      "fuse",
      "rank",
      "refine",
    ]);
    expect(completed.stageResults.stageC!.spotChecks.some((s) => s.recipeSensitive)).toBe(true);
  });

  it("rejects records carrying prohibited keys", () => {
    const badRecipe = {
      ...FUSION_CORPUS_FIXTURE.recipes[0],
      apiKey: "leak",
    };
    expect(isFusionRecipeVersion(badRecipe)).toBe(false);

    const badStudy = {
      ...FUSION_CORPUS_FIXTURE.studies[0],
      secret: "leak",
    };
    expect(isFusionStudy(badStudy)).toBe(false);

    const badTrial = {
      ...FUSION_CORPUS_FIXTURE.trials[0],
      password: "leak",
    };
    expect(isFusionTrial(badTrial)).toBe(false);

    const badPlaybook = {
      ...FUSION_CORPUS_FIXTURE.playbooks[0],
      token: "leak",
    };
    expect(isFusionPlaybook(badPlaybook)).toBe(false);
  });

  it("enforces policy/ref consistency on trials (fuse requires recipe+synthesizer; rank/best_fixed carry neither)", () => {
    const fuse = FUSION_CORPUS_FIXTURE.trials.find((t) => t.policy === "fuse")!;
    expect(fuse.recipe).not.toBeNull();
    expect(fuse.synthesizer).not.toBeNull();

    const refine = FUSION_CORPUS_FIXTURE.trials.find((t) => t.policy === "refine")!;
    expect(refine.synthesizer).not.toBeNull();

    for (const t of FUSION_CORPUS_FIXTURE.trials) {
      if (t.policy === "rank" || t.policy === "best_fixed") {
        expect(t.recipe).toBeNull();
        expect(t.synthesizer).toBeNull();
      }
    }
  });
});

// --- 3. Repository round-trip (live InMemory semantics with fixture data) ----

describe("Fusion corpus fixture — live repository round-trip", () => {
  async function loadFixture(): Promise<FusionStudyRepository> {
    const repo = new InMemoryFusionStudyRepository();
    for (const r of FUSION_CORPUS_FIXTURE.recipes) await repo.createRecipe(r);
    for (const p of FUSION_CORPUS_FIXTURE.pools) await repo.createPoolManifest(p);
    for (const s of FUSION_CORPUS_FIXTURE.studies) await repo.createStudy(s);
    for (const pb of FUSION_CORPUS_FIXTURE.playbooks) await repo.createPlaybook(pb);
    return repo;
  }

  it("reads back every recipe, pool, study, and playbook", async () => {
    const repo = await loadFixture();
    expect(await repo.listRecipes()).toHaveLength(FUSION_CORPUS_FIXTURE.recipes.length);
    expect(await repo.listPoolManifests()).toHaveLength(FUSION_CORPUS_FIXTURE.pools.length);
    expect(await repo.listStudies()).toHaveLength(FUSION_CORPUS_FIXTURE.studies.length);
    expect(await repo.getPlaybook("playbook-adopt")).not.toBeNull();
    expect(await repo.getPlaybook("playbook-do-not-fuse")).not.toBeNull();
  });

  it("reproduces the sealed-trial + observation + attempt lifecycle from fixture data", async () => {
    const repo = await loadFixture();
    // Two in_progress fuse trials forming a retry pair, plus an unsealed trial.
    const b0Base = FUSION_CORPUS_FIXTURE.trials.find((t) => t.id === "trial-ec-fuse-B-0")!;
    const b1Base = FUSION_CORPUS_FIXTURE.trials.find((t) => t.id === "trial-ec-fuse-B-1")!;
    const inprogBase = FUSION_CORPUS_FIXTURE.trials.find(
      (t) => t.id === "trial-ec-fuse-B-inprogress",
    )!;
    const b0 = {
      ...b0Base,
      revision: 0,
      status: "in_progress" as const,
      sealedAt: null,
      observationIds: [],
    };
    const b1 = { ...b1Base, revision: 0, status: "in_progress" as const, sealedAt: null };
    const inprog = { ...inprogBase, revision: 0, observationIds: [] };

    await repo.createTrial(b0);
    await repo.createTrial(b1);
    await repo.createTrial(inprog);

    // Measurement-only observation attaches while in_progress and bumps revision.
    const obs = FUSION_CORPUS_FIXTURE.observations.find((o) => o.id === "obs-completed")!;
    const revAfterObs = await repo.addObservation({ ...obs, trialId: b0.id }, 0);
    expect(revAfterObs).toBe(1);
    expect((await repo.getTrial(b0.id))!.observationIds).toContain("obs-completed");

    // Sealing is terminal and runs the anti-circularity check (recipe resolves).
    const revAfterSeal = await repo.sealTrial(b0.id, revAfterObs, 4000);
    expect(revAfterSeal).toBe(2);
    const sealed = await repo.getTrial(b0.id);
    expect(sealed!.status).toBe("sealed");
    expect(sealed!.sealedAt).toBe(4000);

    // Treatment-changing attempt links the sealed predecessor to its successor.
    await repo.recordTrialAttempt(FUSION_CORPUS_FIXTURE.attempts[0]);
    expect(await repo.listTrialAttempts("study-exploration-completed")).toHaveLength(1);

    // A second observation attaches to the still-in_progress trial.
    const obsInp = FUSION_CORPUS_FIXTURE.observations.find((o) => o.id === "obs-inprogress-1")!;
    await repo.addObservation({ ...obsInp, trialId: inprog.id }, 0);
    expect(await repo.listObservations(inprog.id)).toHaveLength(1);
  });

  it("enforces immutability conflicts matching the live repository", async () => {
    const repo = await loadFixture();
    await expect(repo.createRecipe(FUSION_CORPUS_FIXTURE.recipes[0])).rejects.toThrow(/immutable/);
    await expect(repo.createPoolManifest(FUSION_CORPUS_FIXTURE.pools[0])).rejects.toThrow(
      /immutable/,
    );
    await expect(repo.createStudy(FUSION_CORPUS_FIXTURE.studies[0])).rejects.toThrow(
      /already exists/,
    );
    await expect(repo.createPlaybook(FUSION_CORPUS_FIXTURE.playbooks[0])).rejects.toThrow(
      /immutable/,
    );
  });

  it("guards study updates by revision", async () => {
    const repo = await loadFixture();
    const study = (await repo.getStudy("study-exploration-inprogress"))!;
    const next = await repo.updateStudy({ ...study, updatedAt: 9999 }, study.revision);
    expect(next).toBe(study.revision + 1);
    await expect(repo.updateStudy({ ...study, updatedAt: 1111 }, study.revision)).rejects.toThrow(
      /Stale/,
    );
  });

  it("rejects sealing a fuse trial whose recipe version is missing", async () => {
    const repo = await loadFixture();
    const orphan = {
      ...FUSION_CORPUS_FIXTURE.trials.find((t) => t.id === "trial-ec-fuse-B-0")!,
      id: "trial-orphan-recipe",
      revision: 0,
      status: "in_progress" as const,
      sealedAt: null,
      observationIds: [],
      recipe: { id: "recipe-does-not-exist", version: 9 },
    };
    await repo.createTrial(orphan);
    await expect(repo.sealTrial("trial-orphan-recipe", 0, 5000)).rejects.toThrow(/not found/);
  });
});

// --- 4. STOP classification ---------------------------------------------------

describe("Fusion corpus STOP classification", () => {
  it("maps every study to a Suite→Task Set crosswalk row (resolved or explicitly unresolved)", () => {
    const crosswalkByKey = new Map(FUSION_CORPUS_FIXTURE.crosswalk.map((r) => [r.key, r]));
    for (const study of FUSION_CORPUS_FIXTURE.studies) {
      const key = `ts-xwalk:fusion:${study.id}`;
      const row = crosswalkByKey.get(key);
      expect(row, `crosswalk row for ${study.id}`).toBeDefined();
      expect(row!.kind).toBe("fusion-owner");
      // The frozen suiteRef on the crosswalk row must match the study's suiteRef.
      expect(row!.suiteRef).toEqual({
        suiteId: study.suiteRef.suiteId,
        suiteVersion: study.suiteRef.suiteVersion,
        protocolFingerprint: study.suiteRef.protocolFingerprint,
      });
      if (FUSION_CORPUS_FIXTURE.unresolvedOwnerStudyIds.includes(study.id)) {
        expect(row!.status).toBe("unresolved");
        expect(row!.version).toBeNull();
      } else {
        expect(row!.status).toBe("resolved");
        expect(typeof row!.taskSetId).toBe("string");
        expect(row!.taskSetId.length).toBeGreaterThan(0);
        expect(typeof row!.version).toBe("number");
      }
    }
  });

  it("reconstructs every provenance ref from the fixture (recipes, pools, playbooks, attempt trials)", () => {
    const recipeByKey = new Map(
      FUSION_CORPUS_FIXTURE.recipes.map((r) => [`${r.id}@${r.version}`, r]),
    );
    const poolByKey = new Map(FUSION_CORPUS_FIXTURE.pools.map((p) => [`${p.id}@${p.version}`, p]));
    const studyById = new Map(FUSION_CORPUS_FIXTURE.studies.map((s) => [s.id, s]));
    const trialById = new Map(FUSION_CORPUS_FIXTURE.trials.map((t) => [t.id, t]));
    const playbookById = new Map(FUSION_CORPUS_FIXTURE.playbooks.map((p) => [p.id, p]));

    // Study recipe refs resolve.
    for (const study of FUSION_CORPUS_FIXTURE.studies) {
      for (const ref of study.recipeRefs) {
        expect(
          recipeByKey.get(`${ref.id}@${ref.version}`),
          `study ${study.id} recipe ref`,
        ).toBeDefined();
      }
      expect(
        poolByKey.get(`${study.poolRef.id}@${study.poolRef.version}`),
        `study ${study.id} pool ref`,
      ).toBeDefined();
      if (study.playbookRef) {
        expect(playbookById.get(study.playbookRef), `study ${study.id} playbook ref`).toBeDefined();
      }
    }

    // Confirmation studies point at a real predecessor.
    for (const study of FUSION_CORPUS_FIXTURE.studies) {
      if (study.kind === "confirmation") {
        expect(study.confirmationOf, `confirmation ${study.id} predecessor`).not.toBeNull();
        expect(studyById.get(study.confirmationOf!), "predecessor exists").toBeDefined();
      }
    }

    // Fuse trials reference a real recipe; every trial's study exists.
    for (const trial of FUSION_CORPUS_FIXTURE.trials) {
      expect(studyById.get(trial.studyId), `trial ${trial.id} study`).toBeDefined();
      if (trial.recipe) {
        expect(
          recipeByKey.get(`${trial.recipe.id}@${trial.recipe.version}`),
          `trial ${trial.id} recipe`,
        ).toBeDefined();
      }
    }

    // Attempt links point at real trials with the sampleIndex increment.
    for (const att of FUSION_CORPUS_FIXTURE.attempts) {
      const from = trialById.get(att.fromTrialId);
      const to = trialById.get(att.toTrialId);
      expect(from, `attempt ${att.id} fromTrial`).toBeDefined();
      expect(to, `attempt ${att.id} toTrial`).toBeDefined();
      expect(to!.sampleIndex).toBe(from!.sampleIndex + 1);
      expect(to!.studyId).toBe(from!.studyId);
    }

    // Observations point at real trials.
    for (const obs of FUSION_CORPUS_FIXTURE.observations) {
      expect(trialById.get(obs.trialId), `observation ${obs.id} trial`).toBeDefined();
    }

    // Playbooks point at real studies.
    for (const pb of FUSION_CORPUS_FIXTURE.playbooks) {
      expect(studyById.get(pb.studyId), `playbook ${pb.id} study`).toBeDefined();
    }
  });

  it("does not flag non-STOP conditions (pending spec folders and protected files are out of scope)", () => {
    // Children 03–05 spec folders remain under pending/ — this is NOT a STOP.
    // The five protected untracked files are NOT a STOP. This test documents
    // that the characterization suite ignores both, per the batch brief.
    expect(FUSION_CORPUS_FIXTURE.unresolvedOwnerStudyIds).toEqual(["study-unresolved-owner"]);
    // The unresolved owner is an explicitly-modeled provenance gap, not a
    // missing crosswalk — every study has a row.
    expect(FUSION_CORPUS_FIXTURE.crosswalk.length).toBe(FUSION_CORPUS_FIXTURE.studies.length);
  });
});
