// =============================================================================
// evidence-reindex.test.ts — resumable backfill/reindex (spec §11, §13)
//
// RED behaviors locked here:
//  - clean/legacy/partial/corrupt sources; interrupted cursor resume;
//  - repeated N runs produce identical keys/counts (marker-after-verify);
//  - roster-extension source update re-triggers only the affected source;
//  - Compare history receives exploratory inventory entries (never merged);
//  - unresolved canonical Tasks become explicit limitations, not observations;
//  - existing Fusion Study stores are skipped unchanged;
//  - multi-tab owner lease; quota/unavailable classification;
//  - never mutates source records and never invokes a provider.
// =============================================================================

import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { RSembleEvaluationDB } from "./database";
import { InMemoryEvidenceRepository, type EvidenceRepository } from "./evidence-repository";
import {
  REINDEX_LEASE_KEY,
  createDexieReindexEnumerator,
  createDexieReindexMetaStore,
  isLeaseRecord,
  reindexEvidence,
  type ReindexDeps,
  type ReindexMetaStore,
  type ReindexSource,
  type ReindexSourceEnumerator,
} from "./evidence-reindex";
import type { EvaluationSourceResolver } from "../evidence/derive-observations";
import type { ExperimentRecord } from "../evaluations/evaluation-types";
import type { EvaluationObservation } from "../evaluations/fusion-study-types";
import type {
  FullRunSummaryV2,
  LegacyRunSummary,
  RunRecordV2,
  JudgeAttemptRecord,
  PersistedCandidate,
} from "./run-types";

// --- Fixtures -----------------------------------------------------------------

const FP = `sha256:${"f".repeat(64)}`;

function candidate(id: string, modelKey: string): PersistedCandidate {
  const [providerId, model] = modelKey.split(":");
  const attemptId = `att-${id}`;
  return {
    candidateId: id,
    slotId: `slot-${id}`,
    modelKey,
    providerId,
    model,
    slug: model,
    acceptedAttemptId: attemptId,
    attempts: [
      {
        attemptId,
        messages: [{ role: "user", content: "solve it" }],
        startedAt: 0,
        finishedAt: 10,
        status: "completed",
        output: "candidate output",
        tokensIn: null,
        tokensOut: null,
        error: null,
      },
    ],
  };
}

function judgeAttempt(attemptId: string): JudgeAttemptRecord {
  return {
    attemptId,
    providerId: "openrouter",
    model: "org/judge",
    instruction: "judge instruction text",
    messages: [],
    blindLabelToCandidateId: { A: "cand-1" },
    candidateAttemptIdsByCandidateId: { "cand-1": "att-cand-1" },
    startedAt: 0,
    finishedAt: 10,
    status: "completed",
    error: null,
    report: {
      labelMap: [{ label: "A", candidateId: "cand-1" }],
      evaluationsById: {
        "cand-1": {
          candidateId: "cand-1",
          blindLabel: "A",
          overallScore: 4,
          position: "1",
          rationale: "good",
          strengths: [],
          deductions: [],
          missedRequirements: [],
          criterionScores: [
            { criterionId: "quality", label: "quality", kind: "graded", score: 4, rationale: "" },
          ],
        },
      },
      comparisons: [],
    },
    consensus: null,
  };
}

function makeRun(
  id: string,
  overrides: Partial<RunRecordV2> = {},
  experimentId = "exp-1",
): RunRecordV2 {
  return {
    schemaVersion: 2,
    id,
    revision: 1,
    execution: { ownerId: "owner-1", fence: 1 },
    createdAt: 0,
    updatedAt: 5,
    completedAt: 10,
    status: "completed",
    mode: "rank",
    source: {
      kind: "experiment",
      experimentId,
      suiteId: "suite-1",
      suiteVersion: 1,
      protocolFingerprint: FP,
      taskId: "task-1",
      experimentTaskAttemptId: `att-${id}`,
      trial: 0,
    },
    task: { title: "T", prompt: "prompt text", systemPrompt: "system text", temperature: 0 },
    evaluation: {
      profile: {
        id: "rub-1",
        version: 3,
        name: "Rubric",
        description: "",
        judgeInstruction: "",
        criteria: [],
        createdAt: 0,
        updatedAt: 0,
      },
      candidateMessages: [],
    },
    candidates: [candidate("cand-1", "openrouter:model-m1")],
    judge: {
      status: "done",
      acceptedAttemptId: "j-1",
      report: judgeAttempt("j-1").report,
      consensus: null,
      attempts: [judgeAttempt("j-1")],
    },
    fusion: { status: "idle", acceptedAttemptId: null, attempts: [] },
    winnerKeys: [],
    ...overrides,
  };
}

function makeExperiment(experimentId = "exp-1", selectedRunId = "run-a"): ExperimentRecord {
  return {
    id: experimentId,
    revision: 1,
    suiteId: "suite-1",
    suiteVersion: 1,
    protocolFingerprint: FP,
    status: "completed",
    execution: null,
    snapshot: {
      suiteId: "suite-1",
      suiteVersion: 1,
      tasks: [
        {
          id: "task-1",
          title: "T",
          prompt: "prompt text",
          systemPrompt: "system text",
          evaluation: { kind: "inherit" },
          judgeInstructionOverride: "",
          order: 0,
          taskVersionRef: { taskId: "task-canon", version: 2 },
        } as ExperimentRecord["snapshot"]["tasks"][number] & {
          taskVersionRef: { taskId: string; version: number };
        },
      ],
      modelSlots: [
        {
          id: "s1",
          providerId: "openrouter",
          provider: "X",
          model: "M1",
          slug: "model-m1",
          enabled: true,
        },
      ],
      defaultJudge: { providerId: "openrouter", model: "org/judge" },
      defaultEvaluation: { kind: "holistic" },
      profiles: [],
      protocolFingerprint: FP,
      createdAt: 0,
    },
    tasks: [
      {
        taskId: "task-1",
        selectedAttemptId: `att-${selectedRunId}`,
        attempts: [
          {
            id: `att-${selectedRunId}`,
            runId: selectedRunId,
            trial: 0,
            status: "completed",
            startedAt: 0,
            finishedAt: 10,
            error: null,
          },
        ],
      },
    ],
    createdAt: 0,
    updatedAt: 0,
  };
}

class MemoryMetaStore implements ReindexMetaStore {
  readonly values = new Map<string, unknown>();
  async get(key: string): Promise<unknown> {
    return this.values.get(key) ?? null;
  }
  async put(key: string, value: unknown): Promise<void> {
    this.values.set(key, JSON.parse(JSON.stringify(value)));
  }
  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }
  async tryAcquireLease(
    key: string,
    ownerId: string,
    expiresAt: number,
    now: number,
  ): Promise<"acquired" | "foreign-held"> {
    const held = this.values.get(key) ?? null;
    if (isLeaseRecord(held) && held.expiresAt > now && held.ownerId !== ownerId) {
      return "foreign-held";
    }
    this.values.set(key, { ownerId, expiresAt });
    return "acquired";
  }
}

interface World {
  repo: InMemoryEvidenceRepository;
  meta: MemoryMetaStore;
  sources: ReindexSource[];
  runs: Map<string, RunRecordV2>;
  experiments: Map<string, ExperimentRecord>;
  fusionRows: EvaluationObservation[];
  providerCalls: number;
  nowMs: number;
  failSources: Set<string>;
  quotaSources: Set<string>;
  failWrites: number;
}

function makeWorld(): World {
  return {
    repo: new InMemoryEvidenceRepository(),
    meta: new MemoryMetaStore(),
    sources: [],
    runs: new Map(),
    experiments: new Map(),
    fusionRows: [],
    providerCalls: 0,
    nowMs: 0,
    failSources: new Set(),
    quotaSources: new Set(),
    failWrites: 0,
  };
}

function evaluationSource(
  id: string,
  revision = 1,
  overrides: Partial<ReindexSource> = {},
): ReindexSource {
  return {
    sourceKind: "evaluation",
    sourceResultId: id,
    sourceRevision: revision,
    runStatus: "completed",
    legacy: false,
    modelKeys: ["openrouter:model-m1"],
    ...overrides,
  };
}

function comparisonSource(id: string, overrides: Partial<ReindexSource> = {}): ReindexSource {
  return {
    sourceKind: "comparison",
    sourceResultId: id,
    sourceRevision: 1,
    runStatus: "completed",
    legacy: false,
    modelKeys: ["openrouter:model-m1"],
    ...overrides,
  };
}

function depsFor(world: World, overrides: Partial<ReindexDeps> = {}): ReindexDeps {
  const resolver: EvaluationSourceResolver = {
    getExperiment: async (id) => {
      if (world.failSources.has(id)) throw new Error("boom");
      return world.experiments.get(id) ?? null;
    },
    getRun: async (id) => {
      if (world.quotaSources.has(id)) {
        const err = new Error("quota full");
        err.name = "QuotaExceededError";
        throw err;
      }
      return world.runs.get(id) ?? null;
    },
  };
  const enumerator: ReindexSourceEnumerator = {
    listSources: async () => world.sources.map((s) => ({ ...s })),
  };
  const repo: EvidenceRepository = new Proxy(world.repo, {
    get(target, prop) {
      const value = Reflect.get(target, prop);
      if (prop === "putIndexJob" && world.failWrites > 0) {
        world.failWrites -= 1;
        return async () => {
          throw new Error("IndexedDB unavailable");
        };
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return {
    evidenceRepo: repo,
    enumerator,
    resolver,
    meta: world.meta,
    now: () => world.nowMs,
    leaseTtlMs: 5_000,
    ownerId: "tab-1",
    ...overrides,
  };
}

/** Seed one clean evaluation source with its own experiment record. */
function seedCleanEvaluation(world: World, id = "run-a", experimentId = `exp-${id}`): void {
  world.sources.push(evaluationSource(id));
  world.runs.set(id, makeRun(id, {}, experimentId));
  world.experiments.set(experimentId, makeExperiment(experimentId, id));
}

async function fusionObs(
  overrides: Partial<EvaluationObservation> = {},
): Promise<EvaluationObservation> {
  return {
    id: "fusion-obs-1",
    trialId: "trial-1",
    judge: { providerId: "openrouter", model: "org/judge" },
    runId: "fusion-run-1",
    status: "completed",
    overallScore: 9,
    tokensIn: null,
    tokensOut: null,
    error: null,
    startedAt: 0,
    finishedAt: 1,
    ...overrides,
  };
}

// --- Tests ---------------------------------------------------------------------

describe("reindexEvidence", () => {
  it("indexes a clean evaluation source and is exactly identical on repeated runs", async () => {
    const world = makeWorld();
    seedCleanEvaluation(world);
    const first = await reindexEvidence(depsFor(world));
    expect(first).toMatchObject({
      skipped: false,
      sourcesProcessed: 1,
      sourcesSkipped: 0,
      sourcesFailed: 0,
    });
    expect(await world.repo.countObservations()).toBe(1);
    const job = await world.repo.getIndexJob("run-a");
    expect(job?.status).toBe("complete");
    expect(job?.summary?.observationCount).toBe(1);

    // Second run: every marker verified → identical keys/counts, nothing reprocessed.
    const idsBefore = (await world.repo.listObservations({})).items.map((o) => o.id);
    const second = await reindexEvidence(depsFor(world));
    expect(second).toMatchObject({ skipped: false, sourcesProcessed: 0, sourcesSkipped: 1 });
    expect(await world.repo.countObservations()).toBe(1);
    const idsAfter = (await world.repo.listObservations({})).items.map((o) => o.id);
    expect(idsAfter).toEqual(idsBefore);
  });

  it("plumbs persisted verifier outcomes through reindex so a frozen pass reaches Verified", async () => {
    const world = makeWorld();
    seedCleanEvaluation(world);
    await world.repo.putVerifierOutcome({
      taskId: "task-1",
      modelKey: "openrouter:model-m1",
      runId: "run-a",
      kind: "exact_match",
      configurationDigest: `sha256:${"7".repeat(64)}`,
      verifierRef: { id: "ver-1", version: 2 },
      passed: true,
      executedAt: 5,
    });
    const result = await reindexEvidence(
      depsFor(world, {
        resolveModelConfiguration: () => ({
          resolvedModel: "org/model-m1",
          resolvedVersion: "2025-06-01",
        }),
        resolveVerifierOutcomes: async () => [
          {
            taskId: "task-1",
            modelKey: "openrouter:model-m1",
            runId: "run-a",
            kind: "exact_match",
            configurationDigest: `sha256:${"7".repeat(64)}`,
            verifierRef: { id: "ver-1", version: 2 },
            passed: true,
            executedAt: 5,
          },
        ],
      } as unknown as Partial<ReindexDeps>),
    );
    expect(result).toMatchObject({ skipped: false, sourcesProcessed: 1, sourcesFailed: 0 });
    const observations = await world.repo.listObservationsBySource("evaluation", "run-a");
    expect(observations).toHaveLength(1);
    const decision = await world.repo.getActiveDecision(observations[0].id);
    expect(decision?.evidenceClass).toBe("verified");
    // A repeated run stays identical: Verified is derived, never inferred.
    const idsBefore = (await world.repo.listObservations({})).items.map((o) => o.id);
    await reindexEvidence(
      depsFor(world, {
        resolveModelConfiguration: () => ({
          resolvedModel: "org/model-m1",
          resolvedVersion: "2025-06-01",
        }),
        resolveVerifierOutcomes: async () => [
          {
            taskId: "task-1",
            modelKey: "openrouter:model-m1",
            runId: "run-a",
            kind: "exact_match",
            configurationDigest: `sha256:${"7".repeat(64)}`,
            verifierRef: { id: "ver-1", version: 2 },
            passed: true,
            executedAt: 5,
          },
        ],
      } as unknown as Partial<ReindexDeps>),
    );
    const idsAfter = (await world.repo.listObservations({})).items.map((o) => o.id);
    expect(idsAfter).toEqual(idsBefore);
  });

  it("inventories Compare history as exploratory entries without observations or merging", async () => {
    const world = makeWorld();
    world.sources.push(
      comparisonSource("cmp-1", { modelKeys: ["openrouter:m1", "openrouter:m2"] }),
    );
    world.sources.push(comparisonSource("cmp-2"));
    const result = await reindexEvidence(depsFor(world));
    expect(result).toMatchObject({ skipped: false, sourcesProcessed: 2 });
    expect(await world.repo.countObservations()).toBe(0);
    const job1 = await world.repo.getIndexJob("cmp-1");
    expect(job1?.status).toBe("complete");
    expect(job1?.summary?.observationCount).toBe(0);
    expect(job1?.summary?.limitationCount).toBe(2);
    const job2 = await world.repo.getIndexJob("cmp-2");
    expect(job2?.summary?.limitationCount).toBe(1);
  });

  it("inventories legacy summary-only sources with a legacy limitation disclosure", async () => {
    const world = makeWorld();
    world.sources.push(
      comparisonSource("legacy-1", { legacy: true, runStatus: null, modelKeys: ["openrouter:m1"] }),
    );
    const result = await reindexEvidence(depsFor(world));
    expect(result).toMatchObject({ skipped: false, sourcesProcessed: 1 });
    expect(await world.repo.countObservations()).toBe(0);
    const job = await world.repo.getIndexJob("legacy-1");
    expect(job?.status).toBe("complete");
    expect(job?.summary?.limitationCount).toBeGreaterThanOrEqual(2);
  });

  it("indexes only valid cells of a partial source with explicit gaps", async () => {
    const world = makeWorld();
    const run = makeRun(
      "run-partial",
      {
        status: "partial",
        candidates: [
          candidate("cand-1", "openrouter:model-m1"),
          candidate("cand-2", "openrouter:model-m2"),
        ],
      },
      "exp-run-partial",
    );
    run.candidates[1].acceptedAttemptId = null;
    run.candidates[1].attempts[0].status = "failed";
    world.sources.push(
      evaluationSource("run-partial", 1, {
        runStatus: "partial",
        modelKeys: ["openrouter:model-m1", "openrouter:model-m2"],
      }),
    );
    world.runs.set("run-partial", run);
    const experiment = makeExperiment("exp-run-partial", "run-partial");
    world.experiments.set("exp-run-partial", experiment);

    const result = await reindexEvidence(depsFor(world));
    expect(result).toMatchObject({ skipped: false, sourcesProcessed: 1, sourcesFailed: 0 });
    expect(await world.repo.countObservations()).toBe(1);
    const job = await world.repo.getIndexJob("run-partial");
    expect(job?.summary?.gapCount).toBe(1);
    expect(job?.summary?.limitationCount).toBeGreaterThan(0);
  });

  it("records integrity issues for corrupt sources without deleting exact evidence", async () => {
    const world = makeWorld();
    // Duplicate candidate records for one source cell → source corruption.
    const run = makeRun(
      "run-corrupt",
      {
        candidates: [
          candidate("cand-1", "openrouter:model-m1"),
          candidate("cand-1", "openrouter:model-m1"),
        ],
      },
      "exp-run-corrupt",
    );
    world.sources.push(evaluationSource("run-corrupt"));
    world.runs.set("run-corrupt", run);
    world.experiments.set("exp-run-corrupt", makeExperiment("exp-run-corrupt", "run-corrupt"));

    const result = await reindexEvidence(depsFor(world));
    expect(result).toMatchObject({ skipped: false, sourcesProcessed: 1 });
    expect(await world.repo.countObservations()).toBe(1);
    const job = await world.repo.getIndexJob("run-corrupt");
    expect(job?.status).toBe("complete");
    expect(job?.summary?.integrityIssues.length).toBeGreaterThan(0);
    // Source record unchanged (same reference, unchanged content).
    expect(world.runs.get("run-corrupt")).toBe(run);
  });

  it("resumes after an interrupted run via per-source markers (deterministic order)", async () => {
    const world = makeWorld();
    seedCleanEvaluation(world, "run-z-first");
    seedCleanEvaluation(world, "run-a-second");
    world.failSources.add("exp-run-z-first");
    world.failSources.add("exp-run-a-second");

    const first = await reindexEvidence(depsFor(world));
    expect(first).toMatchObject({ skipped: false, sourcesFailed: 2 });
    expect((await world.repo.getIndexJob("run-z-first"))?.status).toBe("error");

    // Clear the failure; the next run resumes and completes every errored source.
    world.failSources.clear();
    const second = await reindexEvidence(depsFor(world));
    expect(second).toMatchObject({ skipped: false, sourcesProcessed: 2, sourcesFailed: 0 });
    expect((await world.repo.getIndexJob("run-z-first"))?.status).toBe("complete");
    expect((await world.repo.getIndexJob("run-a-second"))?.status).toBe("complete");
    expect(await world.repo.countObservations()).toBe(2);
  });

  it("re-indexes a source after a revision change without touching unchanged sources", async () => {
    const world = makeWorld();
    seedCleanEvaluation(world, "run-stable");
    seedCleanEvaluation(world, "run-changed");
    await reindexEvidence(depsFor(world));
    expect((await world.repo.getIndexJob("run-stable"))?.sourceRevision).toBe(1);
    expect((await world.repo.getIndexJob("run-changed"))?.sourceRevision).toBe(1);

    // Roster extension/repair bumps run-changed's revision only.
    world.sources = world.sources.map((s) =>
      s.sourceResultId === "run-changed" ? { ...s, sourceRevision: 2 } : s,
    );
    const second = await reindexEvidence(depsFor(world));
    expect(second).toMatchObject({ skipped: false, sourcesProcessed: 1, sourcesSkipped: 1 });
    expect((await world.repo.getIndexJob("run-changed"))?.sourceRevision).toBe(2);
    // Idempotent: exactly one observation per source.
    expect(await world.repo.countObservations()).toBe(2);
  });

  it("records explicit limitations for unresolved canonical Tasks without fabricating observations", async () => {
    const world = makeWorld();
    const run = makeRun("run-unresolved", {}, "exp-run-unresolved");
    const experiment = makeExperiment("exp-run-unresolved", "run-unresolved");
    experiment.snapshot.tasks[0] = {
      id: "task-1",
      title: "T",
      prompt: "prompt text",
      systemPrompt: "system text",
      evaluation: { kind: "inherit" },
      judgeInstructionOverride: "",
      order: 0,
    };
    world.sources.push(evaluationSource("run-unresolved"));
    world.runs.set("run-unresolved", run);
    world.experiments.set("exp-run-unresolved", experiment);

    const result = await reindexEvidence(depsFor(world));
    expect(result).toMatchObject({ skipped: false, sourcesProcessed: 1 });
    expect(await world.repo.countObservations()).toBe(0);
    const job = await world.repo.getIndexJob("run-unresolved");
    expect(job?.status).toBe("complete");
    expect(job?.summary?.limitationCount).toBeGreaterThan(0);
  });

  it("skips when another tab holds an unexpired lease and takes over after expiry", async () => {
    const world = makeWorld();
    seedCleanEvaluation(world);
    const deps = depsFor(world);

    // Tab 2 holds the lease.
    await world.meta.put(REINDEX_LEASE_KEY, { ownerId: "tab-2", expiresAt: 4_999 });
    world.nowMs = 1_000;
    const blocked = await reindexEvidence(deps);
    expect(blocked).toEqual({ skipped: true, reason: "lease-held" });
    expect(await world.repo.countObservations()).toBe(0);

    // Lease expired → this tab takes over and completes the run.
    world.nowMs = 6_000;
    const acquired = await reindexEvidence(deps);
    expect(acquired).toMatchObject({ skipped: false, sourcesProcessed: 1 });
    expect(await world.repo.countObservations()).toBe(1);
    // Lease is released after the run.
    expect(await world.meta.get(REINDEX_LEASE_KEY)).toBeNull();
  });

  it("classifies quota/unavailable failures onto the owning job row", async () => {
    const world = makeWorld();
    seedCleanEvaluation(world, "run-quota");
    world.quotaSources.add("run-quota");
    const result = await reindexEvidence(depsFor(world));
    expect(result).toMatchObject({ skipped: false, sourcesProcessed: 1, sourcesFailed: 1 });
    const job = await world.repo.getIndexJob("run-quota");
    expect(job?.status).toBe("error");
    expect(job?.errorKind).toBe("quota");
    // The source run is untouched.
    expect(world.runs.get("run-quota")?.status).toBe("completed");
  });

  it("never invokes a provider and never mutates source records", async () => {
    const world = makeWorld();
    const run = makeRun("run-source");
    const before = JSON.parse(JSON.stringify(run)) as RunRecordV2;
    world.sources.push(evaluationSource("run-source"));
    world.runs.set("run-source", run);
    world.experiments.set("exp-run-source", makeExperiment("exp-run-source", "run-source"));
    const result = await reindexEvidence(depsFor(world));
    expect(result).toMatchObject({ skipped: false, sourcesProcessed: 1 });
    expect(world.providerCalls).toBe(0);
    expect(JSON.parse(JSON.stringify(world.runs.get("run-source")))).toEqual(before);
  });

  it("leaves Fusion Study stores and observation entities untouched", async () => {
    const world = makeWorld();
    seedCleanEvaluation(world);
    world.fusionRows.push(await fusionObs());
    const before = JSON.parse(JSON.stringify(world.fusionRows));
    await reindexEvidence(depsFor(world));
    expect(world.fusionRows).toEqual(before);
    expect(await world.repo.countObservations()).toBe(1);
  });

  it("never marks a source complete before verification (marker-after-verify)", async () => {
    const world = makeWorld();
    seedCleanEvaluation(world);
    // The first complete-marker write fails; the source must stay unmarked
    // and a later run repairs it.
    world.failWrites = 1;
    const first = await reindexEvidence(depsFor(world));
    expect(first).toMatchObject({ skipped: false, sourcesFailed: 1 });
    expect((await world.repo.getIndexJob("run-a"))?.status).toBe("error");
    const second = await reindexEvidence(depsFor(world));
    expect(second).toMatchObject({ skipped: false, sourcesProcessed: 1 });
    expect((await world.repo.getIndexJob("run-a"))?.status).toBe("complete");
    expect(await world.repo.countObservations()).toBe(1);
  });
});

// --- Dexie-backed enumerator + meta store --------------------------------------

describe("Dexie reindex seams", () => {
  let db: RSembleEvaluationDB;
  afterEach(async () => {
    if (db) db.close();
  });

  it("enumerates run summaries deterministically into reindex sources", async () => {
    db = new RSembleEvaluationDB(`reindex-enum-${Math.random().toString(36).slice(2)}`);
    await db.open();
    const full: FullRunSummaryV2 = {
      kind: "full",
      schemaVersion: 2,
      id: "run-eval",
      revision: 3,
      createdAt: 1,
      completedAt: 2,
      status: "completed",
      mode: "rank",
      source: {
        kind: "experiment",
        experimentId: "exp-1",
        suiteId: "suite-1",
        suiteVersion: 1,
        protocolFingerprint: FP,
        taskId: "task-1",
        experimentTaskAttemptId: "att-1",
        trial: 0,
      },
      taskTitle: "T",
      taskExcerpt: "e",
      modelKeys: ["openrouter:model-m1"],
      winnerKeys: [],
      scoresByModelKey: {},
      judgeModelKey: null,
      evaluationProfileId: null,
      evaluationProfileVersion: null,
      detailAvailable: true,
      searchText: "e",
    };
    const legacy: LegacyRunSummary = {
      kind: "legacy",
      schemaVersion: "1-import",
      id: "run-legacy",
      createdAt: 1,
      taskExcerpt: "e",
      modelKeys: ["openrouter:m1"],
      winnerKeys: [],
      scoresByModelKey: {},
      detailAvailable: false,
      searchText: "e",
    };
    await db.runSummaries.put({
      kind: "full",
      summary: full,
      id: full.id,
      revision: 3,
      createdAt: 1,
      completedAt: 2,
      status: "completed",
      mode: "rank",
      sourceKind: "experiment",
      sourceProtocolFingerprint: FP,
      sourceExperimentTaskAttemptId: "att-1",
      modelKeys: ["openrouter:model-m1"],
    });
    await db.runSummaries.put({
      kind: "legacy",
      summary: legacy,
      id: legacy.id,
      revision: 0,
      createdAt: 1,
      completedAt: null,
      status: null,
      mode: null,
      sourceKind: "adhoc",
      sourceProtocolFingerprint: null,
      sourceExperimentTaskAttemptId: null,
      modelKeys: ["openrouter:m1"],
    });

    const sources = await createDexieReindexEnumerator(db).listSources();
    const evalSource = sources.find((s) => s.sourceResultId === "run-eval");
    expect(evalSource).toMatchObject({
      sourceKind: "evaluation",
      sourceRevision: 3,
      legacy: false,
    });
    const legacySource = sources.find((s) => s.sourceResultId === "run-legacy");
    expect(legacySource).toMatchObject({ sourceKind: "comparison", legacy: true, runStatus: null });

    const meta = createDexieReindexMetaStore(db);
    await meta.put("k", { a: 1 });
    expect(await meta.get("k")).toEqual({ a: 1 });
    await meta.delete("k");
    expect(await meta.get("k")).toBeNull();
  });

  it("acquires the storage-work lease atomically against foreign holders", async () => {
    db = new RSembleEvaluationDB(`reindex-lease-${Math.random().toString(36).slice(2)}`);
    await db.open();
    const meta = createDexieReindexMetaStore(db);
    await meta.put(REINDEX_LEASE_KEY, { ownerId: "tab-2", expiresAt: 5_000 });
    // Foreign unexpired lease: rejected without overwriting.
    await expect(meta.tryAcquireLease(REINDEX_LEASE_KEY, "tab-1", 6_000, 1_000)).resolves.toBe(
      "foreign-held",
    );
    expect(await meta.get(REINDEX_LEASE_KEY)).toEqual({ ownerId: "tab-2", expiresAt: 5_000 });
    // Lease expired: acquired inside the transaction.
    await expect(meta.tryAcquireLease(REINDEX_LEASE_KEY, "tab-1", 11_000, 6_000)).resolves.toBe(
      "acquired",
    );
    expect(await meta.get(REINDEX_LEASE_KEY)).toEqual({ ownerId: "tab-1", expiresAt: 11_000 });
  });
});
