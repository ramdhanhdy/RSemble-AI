// =============================================================================
// persist-executed-evidence.test.ts — production write path for executed
// verifier outcomes and stored model-identity facts (Wave A leftover).
//
// Production must persist executed facts after the exact result commits and
// before derivation. It must never invent a pass from a declared contract,
// never infer resolved identity from the requested model, and never call a
// provider.
// =============================================================================

import { describe, expect, it } from "vitest";
import { InMemoryEvidenceRepository } from "../persistence/evidence-repository";
import type {
  ExperimentRecord,
  EvaluationTask,
  EvaluationRubric,
} from "../evaluations/evaluation-types";
import type { RunRecordV2, JudgeAttemptRecord, PersistedCandidate } from "../persistence/run-types";
import {
  createRepositoryVerifierResolver,
  createStoredModelConfigurationResolver,
  deriveObservationsForSource,
  type DerivationDeps,
} from "./derive-observations";
import {
  persistExecutedEvidenceForCommittedSource,
  persistExecutedVerifierOutcomes,
} from "./persist-executed-evidence";
import type { ExecutedVerifierOutcome } from "./evidence-types";

const FP = `sha256:${"f".repeat(64)}`;
const DIGEST = `sha256:${"7".repeat(64)}`;

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
  return {
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
}

function makeExperiment(taskExtra: Partial<EvaluationTask> = {}): ExperimentRecord {
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
          taskVersionRef: { taskId: "task-canon", version: 2 },
          ...taskExtra,
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
  };
}

function outcome(overrides: Partial<ExecutedVerifierOutcome> = {}): ExecutedVerifierOutcome {
  return {
    taskId: "task-1",
    modelKey: "openrouter:model-m1",
    runId: "run-1",
    kind: "exact_match",
    configurationDigest: DIGEST,
    verifierRef: { id: "ver-1", version: 2 },
    passed: true,
    executedAt: 20,
    ...overrides,
  };
}

function depsFor(
  repo: InMemoryEvidenceRepository,
  run: RunRecordV2,
  experiment: ExperimentRecord,
  extras: Partial<DerivationDeps> = {},
): DerivationDeps {
  return {
    evidenceRepo: repo,
    resolver: {
      getExperiment: async (id) => (id === experiment.id ? experiment : null),
      getRun: async (id) => (id === run.id ? run : null),
    },
    now: () => 1000,
    resolveVerifierOutcomes: createRepositoryVerifierResolver(repo),
    ...extras,
  };
}

describe("persistExecutedVerifierOutcomes", () => {
  it("is the production writer: persisted pass + stored model facts reach Verified", async () => {
    const repo = new InMemoryEvidenceRepository();
    const run = makeRun();
    const experiment = makeExperiment();
    const written = await persistExecutedVerifierOutcomes(repo, [outcome()]);
    expect(written).toEqual({ created: 1, existing: 0 });

    const listed = await repo.listVerifierOutcomes({ runIds: [run.id] });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.passed).toBe(true);

    const result = await deriveObservationsForSource(
      depsFor(repo, run, experiment, {
        resolveModelConfiguration: () => ({
          resolvedModel: "org/model-m1",
          resolvedVersion: "2025-06-01",
        }),
      }),
      { sourceKind: "evaluation", sourceResultId: run.id, sourceRevision: run.revision },
    );
    expect(result.status).toBe("complete");
    const observations = await repo.listObservationsBySource("evaluation", run.id);
    expect(observations).toHaveLength(1);
    const decision = await repo.getActiveDecision(observations[0]!.id);
    expect(decision?.evidenceClass).toBe("verified");
    expect(decision?.reasonCodes).toContain("verifier_passed");
  });

  it("is idempotent for an identical replay and refuses conflicting same-identity data", async () => {
    const repo = new InMemoryEvidenceRepository();
    const first = await persistExecutedVerifierOutcomes(repo, [outcome()]);
    const second = await persistExecutedVerifierOutcomes(repo, [outcome()]);
    expect(first).toEqual({ created: 1, existing: 0 });
    expect(second).toEqual({ created: 0, existing: 1 });
    await expect(
      persistExecutedVerifierOutcomes(repo, [outcome({ passed: false })]),
    ).rejects.toThrow(/corrupt/i);
    expect(await repo.listVerifierOutcomes({ runIds: ["run-1"] })).toHaveLength(1);
  });

  it("persists a verifier failure as honest negative evidence, never Verified", async () => {
    const repo = new InMemoryEvidenceRepository();
    const run = makeRun();
    const experiment = makeExperiment();
    await persistExecutedVerifierOutcomes(repo, [outcome({ passed: false })]);
    await deriveObservationsForSource(
      depsFor(repo, run, experiment, {
        resolveModelConfiguration: () => ({
          resolvedModel: "org/model-m1",
          resolvedVersion: "2025-06-01",
        }),
      }),
      { sourceKind: "evaluation", sourceResultId: run.id, sourceRevision: run.revision },
    );
    const observations = await repo.listObservationsBySource("evaluation", run.id);
    const decision = await repo.getActiveDecision(observations[0]!.id);
    expect(observations[0]?.outcome.verifierPassed).toBe(false);
    expect(decision?.evidenceClass).not.toBe("verified");
    expect(decision?.reasonCodes).toContain("verifier_failed");
  });
});

describe("persistExecutedEvidenceForCommittedSource", () => {
  it("does not invent a pass from a declared verification contract alone", async () => {
    const repo = new InMemoryEvidenceRepository();
    const run = makeRun();
    const experiment = makeExperiment({ verification: { kind: "exact_match" } });
    const result = await persistExecutedEvidenceForCommittedSource({
      evidenceRepo: repo,
      run,
      experiment,
    });
    expect(result).toEqual({ created: 0, existing: 0 });
    expect(await repo.listVerifierOutcomes({ runIds: [run.id] })).toEqual([]);
  });

  it("persists executed outcomes supplied with the committed source and does not mutate the source", async () => {
    const repo = new InMemoryEvidenceRepository();
    const run = makeRun();
    const before = structuredClone(run);
    const experiment = makeExperiment({ verification: { kind: "exact_match" } });
    const result = await persistExecutedEvidenceForCommittedSource({
      evidenceRepo: repo,
      run,
      experiment,
      executedOutcomes: [outcome()],
    });
    expect(result).toEqual({ created: 1, existing: 0 });
    expect(run).toEqual(before);
    expect((await repo.listVerifierOutcomes({ runIds: [run.id] }))[0]?.runId).toBe(run.id);
  });

  it("ignores outcomes that belong to a different run lineage", async () => {
    const repo = new InMemoryEvidenceRepository();
    const run = makeRun();
    const experiment = makeExperiment();
    await persistExecutedEvidenceForCommittedSource({
      evidenceRepo: repo,
      run,
      experiment,
      executedOutcomes: [outcome({ runId: "other-run" })],
    });
    expect(await repo.listVerifierOutcomes({ runIds: [run.id] })).toEqual([]);
    expect(await repo.listVerifierOutcomes({ runIds: ["other-run"] })).toEqual([]);
  });
});

describe("createStoredModelConfigurationResolver", () => {
  const resolve = createStoredModelConfigurationResolver();

  it("stays unknown when the candidate carries no stored identity", () => {
    expect(
      resolve({ run: makeRun(), candidate: candidate("cand-1", "openrouter:model-m1") }),
    ).toEqual({
      resolvedModel: null,
      resolvedVersion: null,
    });
  });

  it("never infers resolved identity from the requested model slug", () => {
    const cand = candidate("cand-1", "openrouter:model-m1");
    expect(resolve({ run: makeRun(), candidate: cand }).resolvedModel).not.toBe(cand.model);
    expect(resolve({ run: makeRun(), candidate: cand }).resolvedModel).toBeNull();
  });

  it("reads only stored provider-confirmed identity facts", () => {
    const cand = {
      ...candidate("cand-1", "openrouter:model-m1"),
      resolvedIdentity: { resolvedModel: "org/model-m1", resolvedVersion: "2025-06-01" },
    } as PersistedCandidate;
    expect(resolve({ run: makeRun(), candidate: cand })).toEqual({
      resolvedModel: "org/model-m1",
      resolvedVersion: "2025-06-01",
    });
  });

  it("refuses a version without a model instead of inventing one", () => {
    const cand = {
      ...candidate("cand-1", "openrouter:model-m1"),
      resolvedIdentity: { resolvedModel: null, resolvedVersion: "2025-06-01" },
    } as PersistedCandidate;
    expect(resolve({ run: makeRun(), candidate: cand })).toEqual({
      resolvedModel: null,
      resolvedVersion: null,
    });
  });
});
