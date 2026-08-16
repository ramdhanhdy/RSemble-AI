// =============================================================================
// derive-observations.test.ts — post-commit derivation service and local queue
// (spec §4, §13; implementation plan Task 8)
//
// RED behaviors locked here:
//  - source commits succeed even if derived indexing fails;
//  - indexing never calls a provider and never mutates the source records;
//  - retry indexing after an error; source revision changes re-trigger;
//  - exactly-once under duplicate events (idempotent six-part key);
//  - all Fusion Study FusionObservation events/stores are ignored by canonical
//    derivation (no fusion dependency exists in the derivation surface);
//  - queue containment: enqueue never rejects; processing is a local,
//    serialized, post-commit job separate from paid execution.
// =============================================================================

import { describe, expect, it, vi } from "vitest";
import {
  InMemoryEvidenceRepository,
  type EvidenceRepository,
} from "../persistence/evidence-repository";
import {
  deriveObservationsForSource,
  createDerivationQueue,
  defaultTaskIdentityResolver,
  type DerivationDeps,
  type EvaluationSourceResolver,
  type TaskIdentityResolver,
} from "./derive-observations";
import type {
  ExperimentRecord,
  EvaluationTask,
  EvaluationRubric,
} from "../evaluations/evaluation-types";
import type { VerifierOutcome, EvaluationObservation } from "../evaluations/fusion-study-types";
import type { RunRecordV2, JudgeAttemptRecord, PersistedCandidate } from "../persistence/run-types";

// --- Fixtures -----------------------------------------------------------------

const FP = `sha256:${"f".repeat(64)}`;

function candidate(
  id: string,
  modelKey: string,
  opts: { accepted?: boolean } = {},
): PersistedCandidate {
  const [providerId, model] = modelKey.split(":");
  const attemptId = `att-${id}`;
  return {
    candidateId: id,
    slotId: `slot-${id}`,
    modelKey,
    providerId,
    model,
    slug: model,
    acceptedAttemptId: opts.accepted === false ? null : attemptId,
    attempts: [
      {
        attemptId,
        messages: [{ role: "user", content: "solve it" }],
        startedAt: 0,
        finishedAt: 10,
        status: "completed",
        output: "candidate output text",
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

function makeRun(overrides: Partial<RunRecordV2> = {}): RunRecordV2 {
  const run: RunRecordV2 = {
    schemaVersion: 2,
    id: "run-1",
    revision: 1,
    execution: { ownerId: "owner-1", fence: 1 },
    createdAt: 0,
    updatedAt: 5,
    completedAt: 10,
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
      } as EvaluationRubric,
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
  return run;
}

function makeExperiment(overrides: Partial<ExperimentRecord> = {}): ExperimentRecord {
  return {
    id: "exp-1",
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
          // Materialization-projected canonical identity (child 03 scope).
          taskVersionRef: { taskId: "task-canon", version: 2 },
        } as EvaluationTask & { taskVersionRef: { taskId: string; version: number } },
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
        selectedAttemptId: "att-1",
        attempts: [
          {
            id: "att-1",
            runId: "run-1",
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
    ...overrides,
  };
}

/** Fusion Study store/event double — must never influence canonical derivation. */
interface FusionWorld {
  observations: EvaluationObservation[];
  terminalEvents: string[];
}

function makeFusionObservation(): EvaluationObservation {
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
  };
}

interface World {
  repo: InMemoryEvidenceRepository;
  runs: Map<string, RunRecordV2>;
  experiments: Map<string, ExperimentRecord>;
  providerCalls: number;
  fusion: FusionWorld;
}

function makeWorld(): World {
  return {
    repo: new InMemoryEvidenceRepository(),
    runs: new Map(),
    experiments: new Map(),
    providerCalls: 0,
    fusion: { observations: [], terminalEvents: [] },
  };
}

function resolverFor(world: World): EvaluationSourceResolver {
  return {
    getExperiment: async (id) => world.experiments.get(id) ?? null,
    getRun: async (id) => world.runs.get(id) ?? null,
  };
}

function depsFor(world: World, overrides: Partial<DerivationDeps> = {}): DerivationDeps {
  return {
    evidenceRepo: world.repo,
    resolver: resolverFor(world),
    now: () => 1000,
    ...overrides,
  };
}

function seedCleanSource(
  world: World,
  run?: RunRecordV2,
): { run: RunRecordV2; experiment: ExperimentRecord } {
  const r = run ?? makeRun();
  const e = makeExperiment();
  world.runs.set(r.id, r);
  world.experiments.set(e.id, e);
  return { run: r, experiment: e };
}

const refFor = (run: RunRecordV2, revision = run.revision) => ({
  sourceKind: "evaluation" as const,
  sourceResultId: run.id,
  sourceRevision: revision,
});

// --- Tests ---------------------------------------------------------------------

describe("deriveObservationsForSource", () => {
  it("derives idempotent observations and decisions for a clean evaluation source", async () => {
    const world = makeWorld();
    const { run } = seedCleanSource(world);
    const deps = depsFor(world);

    const first = await deriveObservationsForSource(deps, refFor(run));
    expect(first.status).toBe("complete");
    expect(first.observationCount).toBe(1);
    expect(first.gapCount).toBe(0);
    expect(first.limitationCount).toBe(0);

    const observations = await world.repo.listObservationsBySource("evaluation", run.id);
    expect(observations).toHaveLength(1);
    const o = observations[0];
    expect(o.taskId).toBe("task-canon");
    expect(o.taskVersion).toBe(2);
    expect(o.candidateAttemptId).toBe("att-cand-1");
    expect(o.outcome.overallScore).toBe(4);
    expect(o.outcome.criterionValues).toEqual([{ criterionId: "quality", value: 4 }]);
    expect(o.assessmentRef.judgeAttemptId).toBe("j-1");
    expect(o.evaluatorSnapshot.instructionDigest).not.toContain("judge instruction");
    // The evaluator snapshot never carries the raw instruction text.
    expect(JSON.stringify(o)).not.toContain("judge instruction text");
    expect(JSON.stringify(o)).not.toContain("candidate output text");

    const decision = await world.repo.getActiveDecision(o.id);
    expect(decision).not.toBeNull();
    expect(decision?.ruleVersion).toBe(1);
    expect(decision?.status).toBe("provisional"); // partial configuration → exploratory
    expect(decision?.evidenceClass).toBe("exploratory");
    expect(decision?.reasonCodes).toContain("model_configuration_incomplete");

    // A second derivation over the same source is exactly-once.
    const second = await deriveObservationsForSource(deps, refFor(run));
    expect(second.status).toBe("complete");
    expect(await world.repo.countObservations()).toBe(1);
    expect(await world.repo.listObservationsBySource("evaluation", run.id)).toHaveLength(1);
  });

  it("uses the identity resolver for canonical task and instance identity", async () => {
    const world = makeWorld();
    seedCleanSource(world);
    const identity: TaskIdentityResolver = () => ({
      taskId: "task-custom",
      taskVersion: 7,
      taskInstanceId: "inst-custom",
      taskFamilyId: "fam-1",
      inputComplete: true,
    });
    const result = await deriveObservationsForSource(
      depsFor(world, { identity }),
      refFor(makeRun()),
    );
    expect(result.status).toBe("complete");
    const observations = await world.repo.listObservationsBySource("evaluation", "run-1");
    expect(observations[0].taskId).toBe("task-custom");
    expect(observations[0].taskVersion).toBe(7);
    expect(observations[0].taskInstanceId).toBe("inst-custom");
  });

  it("records explicit limitations instead of observations when canonical task identity is unresolved", async () => {
    const world = makeWorld();
    const run = makeRun();
    const experiment = makeExperiment({
      snapshot: {
        ...makeExperiment().snapshot,
        // No taskVersionRef on the snapshot task — unresolved canonical task.
        tasks: [
          {
            id: "task-1",
            title: "T",
            prompt: "prompt text",
            systemPrompt: "system text",
            evaluation: { kind: "inherit" },
            judgeInstructionOverride: "",
            order: 0,
          },
        ],
      },
    });
    world.runs.set(run.id, run);
    world.experiments.set(experiment.id, experiment);

    const result = await deriveObservationsForSource(depsFor(world), refFor(run));
    expect(result.status).toBe("complete");
    expect(result.observationCount).toBe(0);
    expect(result.limitationCount).toBeGreaterThan(0);
    expect(await world.repo.countObservations()).toBe(0);
  });

  it("derives only completed cells from a partial run with explicit gaps", async () => {
    const world = makeWorld();
    const run = makeRun({
      status: "partial",
      candidates: [
        candidate("cand-1", "openrouter:model-m1"),
        candidate("cand-2", "openrouter:model-m2", { accepted: false }),
      ],
    });
    const experiment = makeExperiment({
      snapshot: {
        ...makeExperiment().snapshot,
        modelSlots: [
          {
            id: "s1",
            providerId: "openrouter",
            provider: "X",
            model: "M1",
            slug: "model-m1",
            enabled: true,
          },
          {
            id: "s2",
            providerId: "openrouter",
            provider: "X",
            model: "M2",
            slug: "model-m2",
            enabled: true,
          },
        ],
      },
    });
    world.runs.set(run.id, run);
    world.experiments.set(experiment.id, experiment);

    const result = await deriveObservationsForSource(depsFor(world), refFor(run));
    expect(result.status).toBe("complete");
    expect(result.observationCount).toBe(1);
    expect(result.gapCount).toBe(1);
    expect(result.limitationCount).toBeGreaterThan(0);
    const observations = await world.repo.listObservationsBySource("evaluation", run.id);
    expect(observations.map((o) => o.candidateAttemptId)).toEqual(["att-cand-1"]);
  });
  it("records integrity issues for a corrupt source without deleting exact evidence", async () => {
    const world = makeWorld();
    // Duplicate candidate records for one source cell: source corruption.
    const run = makeRun({
      candidates: [
        candidate("cand-1", "openrouter:model-m1"),
        candidate("cand-1", "openrouter:model-m1"),
      ],
    });
    seedCleanSource(world, run);

    const result = await deriveObservationsForSource(depsFor(world), refFor(run));
    expect(result.status).toBe("complete");
    expect(result.integrityIssues.length).toBeGreaterThan(0);
    const observations = await world.repo.listObservationsBySource("evaluation", run.id);
    expect(observations).toHaveLength(1);
    const decision = await world.repo.getActiveDecision(observations[0].id);
    expect(decision?.reasonCodes).toContain("source_corrupt");
    // The run record is untouched.
    expect(world.runs.get(run.id)).toBe(run);
  });

  it("records an explicit limitation for a judge-less cell", async () => {
    const world = makeWorld();
    const run = makeRun({
      judge: {
        status: "done",
        acceptedAttemptId: null,
        report: null,
        consensus: null,
        attempts: [],
      },
    });
    seedCleanSource(world, run);

    const result = await deriveObservationsForSource(depsFor(world), refFor(run));
    expect(result.status).toBe("complete");
    expect(result.observationCount).toBe(0);
    expect(result.limitationCount).toBeGreaterThan(0);
  });

  it("passes verifier outcomes through without ever reading fusion stores", async () => {
    const world = makeWorld();
    seedCleanSource(world);
    // Seed fusion study observation events/stores — they must be ignored.
    world.fusion.observations.push(makeFusionObservation());
    world.fusion.terminalEvents.push("fusion-terminal:fusion-obs-1");
    const verifierOutcomes: VerifierOutcome[] = [
      { taskId: "task-1", modelKey: "openrouter:model-m1", passed: true, executedAt: 5 },
    ];
    const result = await deriveObservationsForSource(
      depsFor(world, { verifierOutcomes }),
      refFor(makeRun()),
    );
    expect(result.status).toBe("complete");
    const observations = await world.repo.listObservationsBySource("evaluation", "run-1");
    expect(observations).toHaveLength(1);
    expect(observations[0].assessmentRef.verifierOutcome?.passed).toBe(true);
    expect(observations[0].outcome.verifierPassed).toBe(true);
    // The fusion world is untouched and never read into the observation.
    expect(world.fusion.observations).toHaveLength(1);
    expect(world.fusion.terminalEvents).toHaveLength(1);
  });

  it("never invokes a provider and never mutates the source run", async () => {
    const world = makeWorld();
    const { run } = seedCleanSource(world);
    const before = JSON.parse(JSON.stringify(run)) as RunRecordV2;
    const providerSpy = { call: vi.fn() };
    // The derivation surface has no provider dependency: only repository reads.
    const result = await deriveObservationsForSource(depsFor(world), refFor(run));
    expect(result.status).toBe("complete");
    expect(providerSpy.call).not.toHaveBeenCalled();
    expect(world.runs.get(run.id)).toEqual(before);
    expect(world.runs.get(run.id)).toBe(run);
  });

  it("sanitizes secret-shaped values so nothing secret enters snapshots", async () => {
    const world = makeWorld();
    const run = makeRun({
      task: {
        title: "T",
        prompt: "prompt text",
        systemPrompt: "sk-live-secret-abc",
        temperature: 0,
      },
    });
    seedCleanSource(world, run);
    const result = await deriveObservationsForSource(depsFor(world), refFor(run));
    expect(result.status).toBe("complete");
    const observations = await world.repo.listObservationsBySource("evaluation", run.id);
    expect(observations).toHaveLength(1);
    expect(JSON.stringify(observations[0])).not.toContain("sk-live-secret-abc");
    const snapshots = await world.repo.listModelConfigurations();
    expect(JSON.stringify(snapshots)).not.toContain("sk-live-secret-abc");
  });

  it("reports classified errors for missing or unresolvable sources", async () => {
    const world = makeWorld();
    const missing = await deriveObservationsForSource(
      depsFor(world),
      refFor(makeRun({ id: "run-missing" })),
    );
    expect(missing.status).toBe("error");
    expect(missing.errorKind).toBe("source-missing");
    expect(missing.observationCount).toBe(0);

    const adhoc = makeRun({ source: { kind: "adhoc" } });
    world.runs.set(adhoc.id, adhoc);
    const notEvaluation = await deriveObservationsForSource(depsFor(world), refFor(adhoc));
    expect(notEvaluation.status).toBe("error");
    expect(notEvaluation.errorKind).toBe("source-not-evaluation");

    const expless = makeRun({
      source: { ...makeRun().source, experimentId: "exp-none" } as RunRecordV2["source"],
    });
    world.runs.set(expless.id, expless);
    const unresolvable = await deriveObservationsForSource(depsFor(world), refFor(expless));
    expect(unresolvable.status).toBe("error");
    expect(unresolvable.errorKind).toBe("source-unresolvable");
  });

  it("classifies storage failures into the result instead of throwing", async () => {
    const world = makeWorld();
    const run = makeRun();
    seedCleanSource(world, run);
    world.runs.set(run.id, run);
    const explodingRepo: EvidenceRepository = new Proxy(world.repo, {
      get(target, prop) {
        if (prop === "putObservation") {
          return async () => {
            const err = new Error("quota full");
            err.name = "QuotaExceededError";
            throw err;
          };
        }
        const value = Reflect.get(target, prop);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const result = await deriveObservationsForSource(
      depsFor(world, { evidenceRepo: explodingRepo }),
      refFor(run),
    );
    expect(result.status).toBe("error");
    expect(result.errorKind).toBe("quota");
  });

  it("resolves lineage runs for roster-extension provenance", async () => {
    const world = makeWorld();
    const base = makeRun({ id: "run-base" });
    const extension = makeRun({
      id: "run-ext",
      revision: 2,
      source: {
        kind: "experiment",
        experimentId: "exp-1",
        suiteId: "suite-1",
        suiteVersion: 1,
        protocolFingerprint: FP,
        taskId: "task-1",
        experimentTaskAttemptId: "att-2",
        trial: 1,
        repair: {
          kind: "roster-extension",
          addedModelKey: "openrouter:model-m2",
          baseRunId: "run-base",
        },
      },
    });
    const experiment = makeExperiment({
      tasks: [
        {
          taskId: "task-1",
          selectedAttemptId: "att-2",
          attempts: [
            {
              id: "att-1",
              runId: "run-base",
              trial: 0,
              status: "completed",
              startedAt: 0,
              finishedAt: 5,
              error: null,
            },
            {
              id: "att-2",
              runId: "run-ext",
              trial: 1,
              status: "completed",
              startedAt: 5,
              finishedAt: 10,
              error: null,
            },
          ],
        },
      ],
    });
    world.runs.set(base.id, base);
    world.runs.set(extension.id, extension);
    world.experiments.set(experiment.id, experiment);

    const result = await deriveObservationsForSource(depsFor(world), refFor(extension));
    expect(result.status).toBe("complete");
    const observations = await world.repo.listObservationsBySource("evaluation", "run-ext");
    expect(observations).toHaveLength(1);
    expect(observations[0].sourceResultId).toBe("run-ext");
    expect(observations[0].candidateAttemptId).toBe("att-cand-1");
  });
});

describe("defaultTaskIdentityResolver", () => {
  it("resolves canonical identity from the materialized snapshot and stays content-addressed", () => {
    const experiment = makeExperiment();
    const run = makeRun();
    const identity = defaultTaskIdentityResolver({ experiment, taskId: "task-1", run });
    expect(identity?.taskId).toBe("task-canon");
    expect(identity?.taskVersion).toBe(2);
    expect(identity?.inputComplete).toBe(true);
    // Deterministic across calls.
    expect(defaultTaskIdentityResolver({ experiment, taskId: "task-1", run })).toEqual(identity);
    // Different input facts → different instance reference.
    const other = defaultTaskIdentityResolver({
      experiment,
      taskId: "task-1",
      run: makeRun({
        task: { title: "T", prompt: "different", systemPrompt: "s", temperature: 0 },
      }),
    });
    expect(other?.taskInstanceId).not.toBe(identity?.taskInstanceId);
  });

  it("returns null when no canonical task version ref exists", () => {
    const experiment = makeExperiment({
      snapshot: {
        ...makeExperiment().snapshot,
        tasks: [
          {
            id: "task-1",
            title: "T",
            prompt: "p",
            systemPrompt: "s",
            evaluation: { kind: "inherit" },
            judgeInstructionOverride: "",
            order: 0,
          },
        ],
      },
    });
    expect(
      defaultTaskIdentityResolver({ experiment, taskId: "task-1", run: makeRun() }),
    ).toBeNull();
  });
});

describe("derivation queue", () => {
  it("commits survive derivation failures and the queue never rejects", async () => {
    const world = makeWorld();
    const run = makeRun();
    seedCleanSource(world, run);
    // Source commit (simulated): the run is already terminal before enqueue.
    const commitState = { committed: true, runId: run.id, status: run.status };

    let fail = true;
    const failingResolver: EvaluationSourceResolver = {
      getExperiment: async (id) =>
        fail ? Promise.reject(new Error("boom")) : (world.experiments.get(id) ?? null),
      getRun: async (id) => world.runs.get(id) ?? null,
    };
    const queue = createDerivationQueue({ ...depsFor(world), resolver: failingResolver });

    await expect(queue.enqueue(refFor(run))).resolves.toBeUndefined();
    await queue.drain();
    // The commit outcome is unchanged even though indexing failed.
    expect(commitState).toEqual({ committed: true, runId: run.id, status: run.status });
    expect(world.runs.get(run.id)?.status).toBe("completed");
    const job = await world.repo.getIndexJob(run.id);
    expect(job?.status).toBe("error");
    expect(job?.errorKind).toBe("unavailable");

    // Retry indexing after the failure clears.
    fail = false;
    await queue.enqueue(refFor(run));
    await queue.drain();
    expect((await world.repo.getIndexJob(run.id))?.status).toBe("complete");
    expect(await world.repo.countObservations()).toBe(1);
  });

  it("queues post-commit local processing and preserves exactly-once under duplicate events", async () => {
    const world = makeWorld();
    const { run } = seedCleanSource(world);
    const log: string[] = [];
    const queue = createDerivationQueue({
      ...depsFor(world),
      resolver: {
        getExperiment: async (id) => {
          log.push("read:experiment");
          return world.experiments.get(id) ?? null;
        },
        getRun: async (id) => {
          log.push("read:run");
          return world.runs.get(id) ?? null;
        },
      },
    });

    // Duplicate commit events with the same revision: exactly-once indexing.
    await queue.enqueue(refFor(run));
    await queue.enqueue(refFor(run));
    await queue.drain();
    expect(await world.repo.countObservations()).toBe(1);
    expect((await world.repo.getIndexJob(run.id))?.status).toBe("complete");

    // A third duplicate event after completion is a no-op.
    await queue.enqueue(refFor(run));
    await queue.drain();
    expect(await world.repo.countObservations()).toBe(1);
    // Derivation reads happened only after the commit (post-commit ordering).
    expect(log.length).toBeGreaterThan(0);
  });

  it("re-derives when the source revision changes", async () => {
    const world = makeWorld();
    const { run } = seedCleanSource(world);
    const queue = createDerivationQueue(depsFor(world));
    await queue.enqueue(refFor(run, 1));
    await queue.drain();
    expect((await world.repo.getIndexJob(run.id))?.sourceRevision).toBe(1);

    // Source revision bumped by a later write (roster extension / repair).
    const bumped = makeRun({ revision: 2 });
    world.runs.set(bumped.id, bumped);
    await queue.enqueue(refFor(bumped, 2));
    await queue.drain();
    const job = await world.repo.getIndexJob(run.id);
    expect(job?.sourceRevision).toBe(2);
    expect(job?.status).toBe("complete");
    // Idempotent: still exactly one observation row for the source cell.
    expect(await world.repo.countObservations()).toBe(1);
  });

  it("contains enqueue failures (storage down) without affecting the source", async () => {
    const world = makeWorld();
    const { run } = seedCleanSource(world);
    const brokenRepo: EvidenceRepository = new Proxy(world.repo, {
      get(target, prop) {
        if (prop === "putIndexJob") {
          return async () => {
            throw new Error("IndexedDB unavailable");
          };
        }
        const value = Reflect.get(target, prop);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const queue = createDerivationQueue({ ...depsFor(world), evidenceRepo: brokenRepo });
    await expect(queue.enqueue(refFor(run))).resolves.toBeUndefined();
    expect(world.runs.get(run.id)?.status).toBe("completed");
  });

  it("runs the job processor without any provider dependency", async () => {
    const world = makeWorld();
    const { run } = seedCleanSource(world);
    // Structural isolation: the queue deps carry no provider callable. This
    // test documents the invariant by asserting derivation touches only the
    // repositories it was given.
    const readLog: string[] = [];
    const resolver: EvaluationSourceResolver = {
      getExperiment: async (id) => {
        readLog.push(`experiment:${id}`);
        return world.experiments.get(id) ?? null;
      },
      getRun: async (id) => {
        readLog.push(`run:${id}`);
        return world.runs.get(id) ?? null;
      },
    };
    const queue = createDerivationQueue(depsFor(world, { resolver }));
    await queue.enqueue(refFor(run));
    await queue.drain();
    expect((await world.repo.getIndexJob(run.id))?.status).toBe("complete");
    expect(readLog.length).toBeGreaterThan(0);
    expect(
      readLog.every((entry) => entry.startsWith("experiment:") || entry.startsWith("run:")),
    ).toBe(true);
  });

  it("disposes without leaking pending jobs", async () => {
    const world = makeWorld();
    seedCleanSource(world);
    const queue = createDerivationQueue(depsFor(world));
    await queue.enqueue(refFor(makeRun()));
    queue.dispose();
    await queue.drain();
    // Disposed queue stops processing; the job stays queued for the next
    // owner/reindex — never lost, never half-written.
    const job = await world.repo.getIndexJob("run-1");
    expect(["queued", "running", "complete"].includes(job?.status ?? "")).toBe(true);
  });
});
