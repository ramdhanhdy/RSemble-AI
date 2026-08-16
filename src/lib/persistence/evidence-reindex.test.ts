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
import {
  REINDEX_LEASE_KEY,
  createDexieReindexEnumerator,
  createDexieReindexMetaStore,
  createEvidenceIndexingRuntime,
  isLeaseRecord,
  reindexEvidence,
  type ReindexDeps,
  type ReindexMetaStore,
  type ReindexSource,
  type ReindexSourceEnumerator,
} from "./evidence-reindex";
import { RSembleEvaluationDB } from "./database";
import { InMemoryEvidenceRepository, type EvidenceRepository } from "./evidence-repository";
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
    if (isLeaseRecord(held) && held.expiresAt > now) {
      // Any unexpired lease blocks acquisition — including the same owner.
      return "foreign-held";
    }
    this.values.set(key, { ownerId, expiresAt });
    return "acquired";
  }
  async renewLease(key: string, ownerId: string, expiresAt: number): Promise<"renewed" | "lost"> {
    const held = this.values.get(key) ?? null;
    if (!isLeaseRecord(held) || held.ownerId !== ownerId) return "lost";
    this.values.set(key, { ownerId, expiresAt });
    return "renewed";
  }
  async releaseLease(key: string, ownerId: string): Promise<"released" | "not-owned"> {
    const held = this.values.get(key) ?? null;
    if (!isLeaseRecord(held) || held.ownerId !== ownerId) return "not-owned";
    this.values.delete(key);
    return "released";
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
/** Poll a predicate until truthy (real timers; used to sequence concurrent
 *  passes deterministically). */
async function until(predicate: () => boolean | Promise<boolean>, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error("until: condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
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
  it("an expired owner cannot delete a successor's lease on exit (owner-checked release)", async () => {
    const world = makeWorld();
    seedCleanEvaluation(world, "run-a");
    // Park A's pass at source enumeration: A holds the lease while blocked.
    let releaseA!: () => void;
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    const depsA = depsFor(world, { ownerId: "tab-a", leaseTtlMs: 100 });
    depsA.enumerator = {
      listSources: async () => {
        await gateA;
        return world.sources.map((s) => ({ ...s }));
      },
    };
    const passA = reindexEvidence(depsA);
    await until(async () => (await world.meta.get(REINDEX_LEASE_KEY)) !== null);

    // A's lease (acquired at t=0, ttl 100) lapses; B acquires the expired
    // lease and parks mid-pass holding it.
    world.nowMs = 200;
    let releaseB!: () => void;
    const gateB = new Promise<void>((resolve) => {
      releaseB = resolve;
    });
    const depsB = depsFor(world, { ownerId: "tab-b", leaseTtlMs: 1_000 });
    depsB.enumerator = {
      listSources: async () => {
        await gateB;
        return world.sources.map((s) => ({ ...s }));
      },
    };
    const passB = reindexEvidence(depsB);
    await until(async () => {
      const held = (await world.meta.get(REINDEX_LEASE_KEY)) as { ownerId?: string } | null;
      return held?.ownerId === "tab-b";
    });

    // A resumes after losing ownership: it must fail closed and must never
    // delete B's lease.
    releaseA();
    const resultA = await passA;
    expect(resultA).toEqual({ skipped: true, reason: "lease-lost" });
    expect(
      ((await world.meta.get(REINDEX_LEASE_KEY)) as { ownerId?: string } | null)?.ownerId,
    ).toBe("tab-b");

    // B still owns the lease and completes its own pass before releasing it.
    releaseB();
    const resultB = await passB;
    expect(resultB).toMatchObject({ skipped: false, sourcesProcessed: 1 });
    expect(await world.meta.get(REINDEX_LEASE_KEY)).toBeNull();
    expect(await world.repo.countObservations()).toBe(1);
  });

  it("an active pass renews its lease per source so a concurrent owner stays excluded", async () => {
    const world = makeWorld();
    seedCleanEvaluation(world, "run-s1");
    seedCleanEvaluation(world, "run-s2");
    seedCleanEvaluation(world, "run-s3");
    const experimentsSeen: string[] = [];
    let releaseAfterSecond!: () => void;
    const afterSecond = new Promise<void>((resolve) => {
      releaseAfterSecond = resolve;
    });
    const depsA = depsFor(world, { ownerId: "tab-a", leaseTtlMs: 1_000 });
    depsA.resolver = {
      getExperiment: async (id) => {
        experimentsSeen.push(id);
        // Park A right after its second source: clock at t=1000, lease
        // renewed to t=1500 — B must still be excluded.
        if (experimentsSeen.length === 2) await afterSecond;
        return world.experiments.get(id) ?? null;
      },
      getRun: async (id) => {
        // Each source derivation advances the wall clock 500ms past the
        // acquisition — without per-source renewal the 1000ms TTL would lapse
        // mid-pass and a second owner could acquire.
        world.nowMs += 500;
        return world.runs.get(id) ?? null;
      },
    };
    const passA = reindexEvidence(depsA);
    // A has derived two sources (clock at t=1000) and holds a live lease;
    // a second owner attempts the pass now.
    await until(() => experimentsSeen.length === 2);
    const depsB = depsFor(world, { ownerId: "tab-b", leaseTtlMs: 1_000 });
    const resultB = await reindexEvidence(depsB);
    releaseAfterSecond();
    const resultA = await passA;
    expect(resultA).toMatchObject({ skipped: false, sourcesProcessed: 3 });
    expect(resultB).toEqual({ skipped: true, reason: "lease-held" });
    expect(await world.repo.countObservations()).toBe(3);
  });

  it("renews the lease while one source is blocked past the TTL so a second owner stays excluded", async () => {
    const world = makeWorld();
    seedCleanEvaluation(world, "run-a");
    seedCleanEvaluation(world, "run-b");
    // A parks inside its FIRST source derivation; the wall clock then leaps
    // far past the 100ms lease TTL while A is still blocked there. Exclusivity
    // must not depend on source boundaries.
    let releaseA!: () => void;
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    let entered = false;
    const depsA = depsFor(world, { ownerId: "tab-a", leaseTtlMs: 100, leaseHeartbeatMs: 10 });
    depsA.resolver = {
      getExperiment: async (id) => {
        if (!entered) {
          entered = true;
          await gateA;
        }
        return world.experiments.get(id) ?? null;
      },
      getRun: async (id) => world.runs.get(id) ?? null,
    };
    const passA = reindexEvidence(depsA);
    await until(() => entered);

    // A is still blocked inside its single source; wall-clock time advances
    // far beyond the TTL while the derivation is in flight.
    world.nowMs = 10_000;
    // Give the periodic renewal a few ticks at the advanced clock.
    await new Promise((resolve) => setTimeout(resolve, 50));

    // A second owner attempts the pass while A is still blocked: excluded
    // because A's lease is kept fresh by the owner-checked heartbeat.
    const depsB = depsFor(world, { ownerId: "tab-b", leaseTtlMs: 1_000 });
    const resultB = await reindexEvidence(depsB);
    expect(resultB).toEqual({ skipped: true, reason: "lease-held" });

    releaseA();
    const resultA = await passA;
    expect(resultA).toMatchObject({ skipped: false, sourcesProcessed: 2, sourcesFailed: 0 });
    expect(await world.repo.countObservations()).toBe(2);
  });

  it("a heartbeat-reported loss stops the pass without deleting the successor's lease or marking later sources", async () => {
    const world = makeWorld();
    seedCleanEvaluation(world, "run-a");
    seedCleanEvaluation(world, "run-b");
    // A parks right before its completion-marker commit for run-a: the
    // (idempotent) derivation write has landed, the verification read is
    // gated so the heartbeat has time to observe a loss mid-source.
    let releaseVerifyA!: () => void;
    const verifyGateA = new Promise<void>((resolve) => {
      releaseVerifyA = resolve;
    });
    let verifyCalls = 0;
    const repoA: EvidenceRepository = new Proxy(world.repo, {
      get(target, prop) {
        const value = Reflect.get(target, prop);
        if (prop === "listObservationsBySource") {
          const fn = (value as (...args: unknown[]) => Promise<unknown>).bind(target);
          return async (...args: unknown[]) => {
            verifyCalls += 1;
            if (verifyCalls === 1) await verifyGateA;
            return fn(...args);
          };
        }
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const depsA = depsFor(world, {
      ownerId: "tab-a",
      leaseTtlMs: 100,
      leaseHeartbeatMs: 10,
      evidenceRepo: repoA,
    });
    const passA = reindexEvidence(depsA);
    await until(() => verifyCalls === 1);

    // A's lease (last heartbeat extension) has lapsed at the advanced clock;
    // B acquires inside this wall-clock instant — the read-check-and-write
    // runs synchronously, before A's next tick can renew.
    const held = (await world.meta.get(REINDEX_LEASE_KEY)) as { expiresAt?: number } | null;
    world.nowMs = (held?.expiresAt ?? 0) + 1;
    const depsB = depsFor(world, { ownerId: "tab-b", leaseTtlMs: 1_000 });
    let releaseB!: () => void;
    const gateB = new Promise<void>((resolve) => {
      releaseB = resolve;
    });
    let enteredB = false;
    depsB.resolver = {
      getExperiment: async (id) => {
        if (!enteredB) {
          enteredB = true;
          await gateB;
        }
        return world.experiments.get(id) ?? null;
      },
      getRun: async (id) => world.runs.get(id) ?? null,
    };
    const passB = reindexEvidence(depsB);
    await until(async () => {
      const nowHeld = (await world.meta.get(REINDEX_LEASE_KEY)) as { ownerId?: string } | null;
      return nowHeld?.ownerId === "tab-b";
    });

    // The successor holds the lease while A is still blocked: A's next
    // heartbeat tick reports "lost" and the pass must fail closed.
    await new Promise((resolve) => setTimeout(resolve, 50));
    releaseVerifyA();
    const resultA = await passA;
    expect(resultA).toEqual({ skipped: true, reason: "lease-lost" });
    // A never deleted the successor's lease…
    expect(
      ((await world.meta.get(REINDEX_LEASE_KEY)) as { ownerId?: string } | null)?.ownerId,
    ).toBe("tab-b");
    // …and never marked the in-flight source complete nor touched later ones.
    expect((await world.repo.getIndexJob("run-a"))?.status).not.toBe("complete");
    expect((await world.repo.getIndexJob("run-b"))?.status).not.toBe("complete");

    // B still owns the lease and completes its own pass before releasing it.
    releaseB();
    const resultB = await passB;
    expect(resultB).toMatchObject({ skipped: false, sourcesProcessed: 2 });
    expect(await world.meta.get(REINDEX_LEASE_KEY)).toBeNull();
    expect(await world.repo.countObservations()).toBe(2);
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
  it("never lets the same owner re-acquire an unexpired lease", async () => {
    db = new RSembleEvaluationDB(`reindex-lease-same-${Math.random().toString(36).slice(2)}`);
    await db.open();
    const meta = createDexieReindexMetaStore(db);
    await expect(meta.tryAcquireLease(REINDEX_LEASE_KEY, "tab-a", 100, 0)).resolves.toBe(
      "acquired",
    );
    // Same owner, unexpired lease: still held — two runtimes sharing an owner
    // id must never both run the pass.
    await expect(meta.tryAcquireLease(REINDEX_LEASE_KEY, "tab-a", 500, 50)).resolves.toBe(
      "foreign-held",
    );
    expect(await meta.get(REINDEX_LEASE_KEY)).toEqual({ ownerId: "tab-a", expiresAt: 100 });
  });

  it("renews only the current owner and releases only the owner's lease", async () => {
    db = new RSembleEvaluationDB(`reindex-lease-owner-${Math.random().toString(36).slice(2)}`);
    await db.open();
    const meta = createDexieReindexMetaStore(db);
    await meta.tryAcquireLease(REINDEX_LEASE_KEY, "tab-a", 100, 0);
    // A non-owner cannot renew (fail closed) and cannot extend the lease.
    await expect(meta.renewLease(REINDEX_LEASE_KEY, "tab-b", 500)).resolves.toBe("lost");
    expect(await meta.get(REINDEX_LEASE_KEY)).toEqual({ ownerId: "tab-a", expiresAt: 100 });
    await expect(meta.renewLease(REINDEX_LEASE_KEY, "tab-a", 500)).resolves.toBe("renewed");
    expect(await meta.get(REINDEX_LEASE_KEY)).toEqual({ ownerId: "tab-a", expiresAt: 500 });
    // A's lease expires; B acquires; A's release must not delete B's lease.
    await expect(meta.tryAcquireLease(REINDEX_LEASE_KEY, "tab-b", 900, 600)).resolves.toBe(
      "acquired",
    );
    await expect(meta.releaseLease(REINDEX_LEASE_KEY, "tab-a")).resolves.toBe("not-owned");
    expect(await meta.get(REINDEX_LEASE_KEY)).toEqual({ ownerId: "tab-b", expiresAt: 900 });
    await expect(meta.releaseLease(REINDEX_LEASE_KEY, "tab-b")).resolves.toBe("released");
    expect(await meta.get(REINDEX_LEASE_KEY)).toBeNull();
  });
});

// --- Production indexing runtime ------------------------------------------------

describe("createEvidenceIndexingRuntime", () => {
  let db: RSembleEvaluationDB;
  afterEach(async () => {
    if (db) db.close();
  });

  async function openDb(): Promise<RSembleEvaluationDB> {
    db = new RSembleEvaluationDB(`evidence-runtime-${Math.random().toString(36).slice(2)}`);
    await db.open();
    return db;
  }

  function summaryRowFor(run: RunRecordV2): {
    kind: "full";
    summary: FullRunSummaryV2;
    id: string;
    revision: number;
    createdAt: number;
    completedAt: number | null;
    status: string;
    mode: string;
    sourceKind: string;
    sourceProtocolFingerprint: string | null;
    sourceExperimentTaskAttemptId: string | null;
    modelKeys: string[];
  } {
    return {
      kind: "full",
      summary: {
        kind: "full",
        schemaVersion: 2,
        id: run.id,
        revision: run.revision,
        createdAt: run.createdAt,
        completedAt: run.completedAt,
        status: run.status,
        mode: run.mode,
        source: run.source,
        taskTitle: run.task.title,
        taskExcerpt: run.task.prompt,
        modelKeys: run.candidates.map((c) => c.modelKey),
        winnerKeys: [],
        scoresByModelKey: {},
        judgeModelKey: null,
        evaluationProfileId: null,
        evaluationProfileVersion: null,
        detailAvailable: true,
        searchText: "probe",
      },
      id: run.id,
      revision: run.revision,
      createdAt: run.createdAt,
      completedAt: run.completedAt,
      status: run.status,
      mode: run.mode,
      sourceKind: run.source.kind,
      sourceProtocolFingerprint:
        run.source.kind === "experiment" ? run.source.protocolFingerprint : null,
      sourceExperimentTaskAttemptId:
        run.source.kind === "experiment" ? run.source.experimentTaskAttemptId : null,
      modelKeys: run.candidates.map((c) => c.modelKey),
    };
  }

  async function seedSource(
    d: RSembleEvaluationDB,
    id = "run-a",
  ): Promise<{ run: RunRecordV2; experiment: ExperimentRecord }> {
    const run = makeRun(id, {}, `exp-${id}`);
    const experiment = makeExperiment(`exp-${id}`, id);
    await d.runDetails.put({
      id: run.id,
      record: run,
      revision: run.revision,
      createdAt: run.createdAt,
      status: run.status,
    });
    await d.runSummaries.put(summaryRowFor(run));
    await d.experiments.put({
      id: experiment.id,
      experiment,
      revision: experiment.revision,
      suiteId: experiment.suiteId,
      suiteVersion: experiment.suiteVersion,
      protocolFingerprint: experiment.protocolFingerprint,
      createdAt: experiment.createdAt,
      status: experiment.status,
    });
    return { run, experiment };
  }

  function runtimeFor(d: RSembleEvaluationDB, overrides: Record<string, unknown> = {}) {
    const resolver: EvaluationSourceResolver = {
      getExperiment: async (id) => {
        const row = await d.experiments.get(id);
        return row ? (row.experiment as ExperimentRecord) : null;
      },
      getRun: async (id) => {
        const row = await d.runDetails.get(id);
        return row ? (row.record as RunRecordV2) : null;
      },
    };
    return createEvidenceIndexingRuntime({
      db: d,
      resolver,
      reindexOwnerId: "startup-evidence-reindex",
      ...overrides,
    });
  }

  it("reindexes a seeded source silently, idempotently, and touches nothing when empty", async () => {
    const d = await openDb();
    const { run } = await seedSource(d);
    const runtime = runtimeFor(d);

    const first = await runtime.reindex();
    expect(first).toMatchObject({ skipped: false, sourcesProcessed: 1, sourcesFailed: 0 });
    expect((await runtime.evidenceRepo.getIndexJob(run.id))?.status).toBe("complete");
    expect(await runtime.evidenceRepo.countObservations()).toBe(1);
    // The exact run record is untouched.
    expect(((await d.runDetails.get(run.id))?.record as RunRecordV2).status).toBe("completed");

    const idsBefore = (await runtime.evidenceRepo.listObservations({})).items.map((o) => o.id);
    const second = await runtime.reindex();
    expect(second).toMatchObject({ skipped: false, sourcesProcessed: 0, sourcesSkipped: 1 });
    const idsAfter = (await runtime.evidenceRepo.listObservations({})).items.map((o) => o.id);
    expect(idsAfter).toEqual(idsBefore);

    // An empty database: silent, no work, no job rows.
    const empty = await openDb();
    const emptyRuntime = runtimeFor(empty);
    const result = await emptyRuntime.reindex();
    expect(result).toMatchObject({ skipped: false, sourcesProcessed: 0 });
    expect(await emptyRuntime.evidenceRepo.listIndexJobs({})).toHaveLength(0);
    expect(await emptyRuntime.evidenceRepo.countObservations()).toBe(0);
  });

  it("plumbs persisted verifier outcomes into both reindex and the post-commit queue", async () => {
    const d = await openDb();
    const { run } = await seedSource(d);
    await d.verifierOutcomes.put({
      id: `run-a::task-1::openrouter:model-m1::5`,
      taskId: "task-1",
      modelKey: "openrouter:model-m1",
      runId: run.id,
      kind: "exact_match",
      configurationDigest: `sha256:${"7".repeat(64)}`,
      verifierRef: { id: "ver-1", version: 2 },
      passed: true,
      executedAt: 5,
    });
    const runtime = runtimeFor(d, {
      resolveModelConfiguration: () => ({
        resolvedModel: "org/model-m1",
        resolvedVersion: "2025-06-01",
      }),
    });

    const reindexed = await runtime.reindex();
    expect(reindexed).toMatchObject({ skipped: false, sourcesProcessed: 1 });
    const observations = await runtime.evidenceRepo.listObservationsBySource("evaluation", run.id);
    expect(observations).toHaveLength(1);
    const decision = await runtime.evidenceRepo.getActiveDecision(observations[0].id);
    expect(decision?.evidenceClass).toBe("verified");

    // The post-commit queue resolves the same persisted store: a revision
    // bump re-triggers derivation with the outcome wired in.
    const bumped = makeRun("run-a", { revision: 2 }, "exp-run-a");
    await d.runDetails.put({
      id: bumped.id,
      record: bumped,
      revision: bumped.revision,
      createdAt: bumped.createdAt,
      status: bumped.status,
    });
    await d.runSummaries.put(summaryRowFor(bumped));
    await runtime.derivationQueue.enqueue({
      sourceKind: "evaluation",
      sourceResultId: bumped.id,
      sourceRevision: bumped.revision,
    });
    await runtime.derivationQueue.drain();
    expect((await runtime.evidenceRepo.getIndexJob(bumped.id))?.status).toBe("complete");
    const queueObservations = await runtime.evidenceRepo.listObservationsBySource(
      "evaluation",
      bumped.id,
    );
    const queueDecision = await runtime.evidenceRepo.getActiveDecision(queueObservations[0].id);
    expect(queueDecision?.evidenceClass).toBe("verified");
    runtime.derivationQueue.dispose();
  });

  it("records an owning error job when a source cannot be derived, without touching the run", async () => {
    const d = await openDb();
    const { run } = await seedSource(d);
    // Break the lineage: the experiment record disappears after the run committed.
    await d.experiments.delete("exp-run-a");
    const runtime = runtimeFor(d);
    const result = await runtime.reindex();
    expect(result).toMatchObject({ skipped: false, sourcesProcessed: 1, sourcesFailed: 1 });
    const job = await runtime.evidenceRepo.getIndexJob(run.id);
    expect(job?.status).toBe("error");
    expect(job?.errorKind).toBe("source-unresolvable");
    expect(await runtime.evidenceRepo.countObservations()).toBe(0);
    // The exact source records are unchanged.
    expect(((await d.runDetails.get(run.id))?.record as RunRecordV2).status).toBe("completed");
    expect((await d.runSummaries.get(run.id))?.status).toBe("completed");
  });

  it("skips when another owner holds the unexpired storage-work lease", async () => {
    const d = await openDb();
    await seedSource(d);
    const meta = createDexieReindexMetaStore(d);
    await meta.tryAcquireLease(REINDEX_LEASE_KEY, "other-tab", Number.MAX_SAFE_INTEGER, 0);
    const runtime = runtimeFor(d);
    const result = await runtime.reindex();
    expect(result).toMatchObject({ skipped: true, reason: "lease-held" });
    expect(await runtime.evidenceRepo.countObservations()).toBe(0);
  });
  async function gatedResolver(d: RSembleEvaluationDB): Promise<{
    resolver: EvaluationSourceResolver;
    release: () => void;
  }> {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const resolver: EvaluationSourceResolver = {
      getExperiment: async (id) => {
        await gate;
        const row = await d.experiments.get(id);
        return row ? (row.experiment as ExperimentRecord) : null;
      },
      getRun: async (id) => {
        const row = await d.runDetails.get(id);
        return row ? (row.record as RunRecordV2) : null;
      },
    };
    return { resolver, release };
  }

  it("serializes concurrent reindex passes even when two runtimes share an owner id", async () => {
    const d = await openDb();
    await seedSource(d);
    const { resolver, release } = await gatedResolver(d);
    const meta = createDexieReindexMetaStore(d);
    // Mirrors the production bug: every tab passed the same constant owner id,
    // so an unexpired lease looked re-acquirable.
    const runtimeA = createEvidenceIndexingRuntime({
      db: d,
      resolver,
      reindexOwnerId: "startup-evidence-reindex",
    });
    const runtimeB = createEvidenceIndexingRuntime({
      db: d,
      resolver,
      reindexOwnerId: "startup-evidence-reindex",
    });
    const passA = runtimeA.reindex();
    // A holds the lease and is parked mid-derivation; B attempts to acquire.
    await until(async () => (await meta.get(REINDEX_LEASE_KEY)) !== null);
    const passB = runtimeB.reindex();
    release();
    const [resultA, resultB] = await Promise.all([passA, passB]);
    expect(resultA).toMatchObject({ skipped: false, sourcesProcessed: 1 });
    expect(resultB).toEqual({ skipped: true, reason: "lease-held" });
    expect(await runtimeA.evidenceRepo.countObservations()).toBe(1);
    expect(await meta.get(REINDEX_LEASE_KEY)).toBeNull();
  });

  it("assigns a unique owner to every runtime so unlabeled concurrent passes serialize", async () => {
    const d = await openDb();
    await seedSource(d);
    const { resolver, release } = await gatedResolver(d);
    const meta = createDexieReindexMetaStore(d);
    // No explicit owner ids: each runtime must mint its own identity.
    const runtimeA = createEvidenceIndexingRuntime({ db: d, resolver });
    const runtimeB = createEvidenceIndexingRuntime({ db: d, resolver });
    const passA = runtimeA.reindex();
    await until(async () => (await meta.get(REINDEX_LEASE_KEY)) !== null);
    const passB = runtimeB.reindex();
    release();
    const [resultA, resultB] = await Promise.all([passA, passB]);
    expect(resultA).toMatchObject({ skipped: false, sourcesProcessed: 1 });
    expect(resultB).toEqual({ skipped: true, reason: "lease-held" });
    expect(await runtimeA.evidenceRepo.countObservations()).toBe(1);
    expect(await meta.get(REINDEX_LEASE_KEY)).toBeNull();
  });
});
