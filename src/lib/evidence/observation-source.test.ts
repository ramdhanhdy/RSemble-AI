// =============================================================================
// observation-source.test.ts — canonical observation source selection
// (observations-and-evidence spec §3.4, §6).
//
// Covers: fresh success, retry success, rejected/failed attempts, missing-cell
// repair, interrupted partial, re-judge, roster-extension reused output, added
// model, full-roster fallback, multiple extension events, verifier-only,
// judge+verifier, and source-integrity rejection. The selector is pure: no
// writes, no providers — it only classifies immutable source records.
// =============================================================================

import { describe, expect, it } from "vitest";
import type {
  ExperimentRecord,
  ExperimentRosterExtension,
  ExperimentTaskAttempt,
  ExperimentTaskExecutionPlan,
} from "../evaluations/evaluation-types";
import type {
  AttemptStatus,
  CandidateAttemptRecord,
  JudgeAttemptRecord,
  PersistedCandidate,
  RunRecordV2,
  RunStatus,
} from "../persistence/run-types";
import type { ProviderId } from "../providers/types";
import type { ModelSlot } from "../../studio-data";
import {
  selectObservationSources,
  type ObservationSourceCell,
  type ObservationSourceSelection,
} from "./observation-source";

// --- Fixtures -------------------------------------------------------------------

const FP = `sha256:${"f".repeat(64)}`;
const M1 = "openrouter:org/m1";
const M2 = "openrouter:org/m2";
const M3 = "openrouter:org/m3";
const M4 = "openrouter:org/m4";

function slot(id: string, key: string): ModelSlot {
  const [providerId, slug] = key.split(":");
  return {
    id,
    providerId: providerId as ProviderId,
    provider: "Org",
    model: key,
    slug,
    enabled: true,
  };
}

function attemptRec(
  attemptId: string,
  status: AttemptStatus,
  reusedFrom?: { sourceRunId: string; sourceCandidateId: string; sourceAttemptId: string },
): CandidateAttemptRecord {
  return {
    attemptId,
    messages: [],
    startedAt: 0,
    finishedAt: 0,
    status,
    output: null,
    tokensIn: null,
    tokensOut: null,
    error: null,
    ...(reusedFrom ? { reusedFrom } : {}),
  };
}

function candidate(
  id: string,
  modelKey: string,
  accepted: string | null,
  attempts: CandidateAttemptRecord[],
): PersistedCandidate {
  const [providerId, slug] = modelKey.split(":");
  return {
    candidateId: id,
    slotId: `slot-${id}`,
    modelKey,
    providerId,
    model: modelKey,
    slug,
    acceptedAttemptId: accepted,
    attempts,
  };
}

function judgeAttempt(
  attemptId: string,
  status: AttemptStatus,
  opts: {
    report?: boolean;
    blind?: Record<string, string>;
    candidateAttempts?: Record<string, string>;
  } = {},
): JudgeAttemptRecord {
  return {
    attemptId,
    providerId: "openrouter",
    model: "org/judge",
    instruction: "",
    messages: [],
    blindLabelToCandidateId: opts.blind ?? {},
    candidateAttemptIdsByCandidateId: opts.candidateAttempts ?? {},
    startedAt: 0,
    finishedAt: 0,
    status,
    error: null,
    report: opts.report ? { labelMap: [], evaluationsById: {}, comparisons: [] } : null,
    consensus: null,
  };
}

function makeRun(spec: {
  id: string;
  attemptId: string;
  trial: number;
  status: RunStatus;
  candidates: PersistedCandidate[];
  judgeAccepted: string | null;
  judgeAttempts: JudgeAttemptRecord[];
  repair?: ExperimentTaskExecutionPlan;
}): RunRecordV2 {
  return {
    schemaVersion: 2,
    id: spec.id,
    revision: 1,
    execution: { ownerId: "owner-1", fence: 1 },
    createdAt: 0,
    updatedAt: 0,
    completedAt: 0,
    status: spec.status,
    mode: "rank",
    source: {
      kind: "experiment",
      experimentId: "exp-1",
      suiteId: "suite-1",
      suiteVersion: 1,
      protocolFingerprint: FP,
      taskId: "task-1",
      experimentTaskAttemptId: spec.attemptId,
      trial: spec.trial,
      ...(spec.repair ? { repair: spec.repair } : {}),
    },
    task: { title: "T", prompt: "p", systemPrompt: "s", temperature: 0 },
    evaluation: { profile: null, candidateMessages: [] },
    candidates: spec.candidates,
    judge: {
      status: "done",
      acceptedAttemptId: spec.judgeAccepted,
      report: null,
      consensus: null,
      attempts: spec.judgeAttempts,
    },
    fusion: { status: "idle", acceptedAttemptId: null, attempts: [] },
    winnerKeys: [],
  };
}

function taskAttempt(spec: {
  id: string;
  runId: string | null;
  trial: number;
  status: ExperimentTaskAttempt["status"];
  repair?: ExperimentTaskExecutionPlan;
}): ExperimentTaskAttempt {
  return {
    id: spec.id,
    runId: spec.runId,
    trial: spec.trial,
    status: spec.status,
    startedAt: 0,
    finishedAt: 0,
    error: null,
    ...(spec.repair ? { repair: spec.repair } : {}),
  };
}

function makeExperiment(opts: {
  attempts: ExperimentTaskAttempt[];
  selected?: string | null;
  slots?: ModelSlot[];
  extensions?: ExperimentRosterExtension[];
}): ExperimentRecord {
  const slots = opts.slots ?? [slot("s1", M1), slot("s2", M2)];
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
          prompt: "p",
          systemPrompt: "s",
          evaluation: { kind: "inherit" },
          judgeInstructionOverride: "",
          order: 0,
        },
      ],
      modelSlots: slots,
      defaultJudge: { providerId: "openrouter", model: "org/judge" },
      defaultEvaluation: { kind: "holistic" },
      profiles: [],
      protocolFingerprint: FP,
      createdAt: 0,
    },
    tasks: [
      { taskId: "task-1", selectedAttemptId: opts.selected ?? null, attempts: opts.attempts },
    ],
    createdAt: 0,
    updatedAt: 0,
    ...(opts.extensions ? { rosterExtensions: opts.extensions } : {}),
  };
}

function resolver(runs: RunRecordV2[]): (runId: string) => RunRecordV2 | null {
  return (runId) => runs.find((r) => r.id === runId) ?? null;
}

function vo(
  modelKey: string,
  opts: { passed: boolean; executedAt: number },
): {
  taskId: string;
  modelKey: string;
  runId: string;
  kind: "exact_match";
  configurationDigest: string;
  verifierRef: { id: string; version: number } | null;
  passed: boolean;
  executedAt: number;
} {
  return {
    taskId: "task-1",
    modelKey,
    runId: "run-1",
    kind: "exact_match",
    configurationDigest: `sha256:${"7".repeat(64)}`,
    verifierRef: null,
    ...opts,
  };
}

function select(opts: {
  experiment: ExperimentRecord;
  runs: RunRecordV2[];
  verifierOutcomes?: Array<{
    taskId: string;
    modelKey: string;
    runId: string;
    kind: "exact_match";
    configurationDigest: string;
    verifierRef: { id: string; version: number } | null;
    passed: boolean;
    executedAt: number;
  }>;
}): ObservationSourceSelection {
  const result = selectObservationSources({
    experiment: opts.experiment,
    taskId: "task-1",
    resolveRunRecord: resolver(opts.runs),
    verifierOutcomes: opts.verifierOutcomes ?? [],
  });
  if (!result.ok) throw new Error(`unexpected selection failure: ${result.reason}`);
  return result.selection;
}

function cellFor(selection: ObservationSourceSelection, modelKey: string): ObservationSourceCell {
  const cell = selection.cells.find((c) => c.modelKey === modelKey);
  if (!cell) throw new Error(`no cell for ${modelKey}`);
  return cell;
}

function gapReasonFor(selection: ObservationSourceSelection, modelKey: string): string | undefined {
  return selection.gaps.find((g) => g.modelKey === modelKey)?.reason;
}

// --- Tests ----------------------------------------------------------------------

describe("fresh success", () => {
  it("selects the completed attempt with fresh accepted cells", () => {
    const run = makeRun({
      id: "run-1",
      attemptId: "att-1",
      trial: 0,
      status: "completed",
      candidates: [
        candidate("cand-m1", M1, "m1-a1", [attemptRec("m1-a1", "completed")]),
        candidate("cand-m2", M2, "m2-a1", [attemptRec("m2-a1", "completed")]),
      ],
      judgeAccepted: "j-1",
      judgeAttempts: [
        judgeAttempt("j-1", "completed", {
          report: true,
          blind: { A: "cand-m1", B: "cand-m2" },
          candidateAttempts: { "cand-m1": "m1-a1", "cand-m2": "m2-a1" },
        }),
      ],
    });
    const experiment = makeExperiment({
      attempts: [taskAttempt({ id: "att-1", runId: "run-1", trial: 0, status: "completed" })],
      selected: "att-1",
    });
    const selection = select({ experiment, runs: [run] });

    expect(selection.selectedAttemptId).toBe("att-1");
    expect(selection.selectedRunId).toBe("run-1");
    expect(selection.executionLineageId).toBe("eval:exp-1:task-1");
    expect(selection.auditOnlyAttempts).toEqual([]);
    expect(selection.gaps).toEqual([]);

    const m1 = cellFor(selection, M1);
    expect(m1.provenance).toBe("fresh");
    expect(m1.candidateAttemptId).toBe("m1-a1");
    expect(m1.reusedOutput).toBe(false);
    expect(m1.sourceTaskCellId).toBe("exp-1:task-1:openrouter:org/m1");
    expect(m1.judgeAssessment).not.toBeNull();
    expect(m1.judgeAssessment?.judgeAttemptId).toBe("j-1");
    expect(m1.judgeAssessment?.blindLabelMapping).toEqual({ A: "cand-m1", B: "cand-m2" });
    expect(m1.judgeAssessment?.priorJudgeAttemptIds).toEqual([]);
  });
});

describe("retry success", () => {
  it("selects the retry; the failed attempt stays audit-only", () => {
    const failed = makeRun({
      id: "run-1",
      attemptId: "att-1",
      trial: 0,
      status: "failed",
      candidates: [],
      judgeAccepted: null,
      judgeAttempts: [],
    });
    const retry = makeRun({
      id: "run-2",
      attemptId: "att-2",
      trial: 1,
      status: "completed",
      candidates: [candidate("cand-m1", M1, "m1-a2", [attemptRec("m1-a2", "completed")])],
      judgeAccepted: "j-2",
      judgeAttempts: [judgeAttempt("j-2", "completed", { report: true })],
    });
    const experiment = makeExperiment({
      attempts: [
        taskAttempt({ id: "att-1", runId: "run-1", trial: 0, status: "failed" }),
        taskAttempt({ id: "att-2", runId: "run-2", trial: 1, status: "completed" }),
      ],
      selected: "att-2",
    });
    const selection = select({ experiment, runs: [failed, retry] });

    expect(selection.selectedAttemptId).toBe("att-2");
    expect(cellFor(selection, M1).provenance).toBe("retry_success");
    expect(selection.auditOnlyAttempts).toEqual([
      { attemptId: "att-1", runId: "run-1", status: "failed", superseded: false },
    ]);
    expect(gapReasonFor(selection, M2)).toBe("missing_cell");
  });
});

describe("rejected / failed candidates", () => {
  it("produces gaps, not cells, when no candidate is accepted", () => {
    const run = makeRun({
      id: "run-1",
      attemptId: "att-1",
      trial: 0,
      status: "completed",
      candidates: [
        candidate("cand-m1", M1, null, [attemptRec("m1-a1", "failed")]),
        candidate("cand-m2", M2, null, [attemptRec("m2-a1", "failed")]),
      ],
      judgeAccepted: "j-1",
      judgeAttempts: [judgeAttempt("j-1", "completed", { report: true })],
    });
    const experiment = makeExperiment({
      attempts: [taskAttempt({ id: "att-1", runId: "run-1", trial: 0, status: "completed" })],
      selected: "att-1",
    });
    const selection = select({ experiment, runs: [run] });
    expect(selection.cells).toEqual([]);
    expect(gapReasonFor(selection, M1)).toBe("candidate_failed");
    expect(gapReasonFor(selection, M2)).toBe("candidate_failed");
  });
});

describe("missing-cell repair", () => {
  it("keeps the original attempt id for reused outputs and marks repaired cells", () => {
    const base = makeRun({
      id: "run-base",
      attemptId: "att-0",
      trial: 0,
      status: "partial",
      candidates: [
        candidate("cand-m1", M1, null, [attemptRec("m1-base", "failed")]),
        candidate("cand-m2", M2, "m2-base", [attemptRec("m2-base", "completed")]),
      ],
      judgeAccepted: "j-base",
      judgeAttempts: [judgeAttempt("j-base", "completed", { report: true })],
    });
    const repair = makeRun({
      id: "run-repair",
      attemptId: "att-1",
      trial: 1,
      status: "completed",
      candidates: [
        candidate("cand-m1", M1, "m1-repair", [attemptRec("m1-repair", "completed")]),
        candidate("cand-m2", M2, "m2-repair-copy", [
          attemptRec("m2-repair-copy", "completed", {
            sourceRunId: "run-base",
            sourceCandidateId: "cand-m2",
            sourceAttemptId: "m2-base",
          }),
        ]),
      ],
      judgeAccepted: "j-repair",
      judgeAttempts: [judgeAttempt("j-repair", "completed", { report: true })],
      repair: { kind: "missing-cells", baseRunId: "run-base", requestedModelKeys: [M1] },
    });
    const experiment = makeExperiment({
      attempts: [
        taskAttempt({ id: "att-0", runId: "run-base", trial: 0, status: "partial" }),
        taskAttempt({
          id: "att-1",
          runId: "run-repair",
          trial: 1,
          status: "completed",
          repair: { kind: "missing-cells", baseRunId: "run-base", requestedModelKeys: [M1] },
        }),
      ],
      selected: "att-1",
    });
    const selection = select({ experiment, runs: [base, repair] });

    const m1 = cellFor(selection, M1);
    expect(m1.provenance).toBe("repair_new");
    expect(m1.candidateAttemptId).toBe("m1-repair");
    expect(m1.reusedOutput).toBe(false);

    const m2 = cellFor(selection, M2);
    expect(m2.provenance).toBe("repair_reused");
    expect(m2.candidateAttemptId).toBe("m2-base");
    expect(m2.reusedOutput).toBe(true);

    expect(selection.auditOnlyAttempts).toEqual([
      { attemptId: "att-0", runId: "run-base", status: "partial", superseded: true },
    ]);
  });
});

describe("interrupted partial", () => {
  it("selects the partial attempt and exposes explicit gaps", () => {
    const run = makeRun({
      id: "run-1",
      attemptId: "att-1",
      trial: 0,
      status: "partial",
      candidates: [
        candidate("cand-m1", M1, "m1-a1", [attemptRec("m1-a1", "completed")]),
        candidate("cand-m2", M2, null, [attemptRec("m2-a1", "interrupted")]),
      ],
      judgeAccepted: "j-1",
      judgeAttempts: [judgeAttempt("j-1", "completed", { report: true })],
    });
    const experiment = makeExperiment({
      attempts: [taskAttempt({ id: "att-1", runId: "run-1", trial: 0, status: "partial" })],
      selected: "att-1",
    });
    const selection = select({ experiment, runs: [run] });
    expect(selection.selectedAttemptId).toBe("att-1");
    expect(selection.cells).toHaveLength(1);
    expect(cellFor(selection, M1).provenance).toBe("fresh");
    expect(gapReasonFor(selection, M2)).toBe("candidate_failed");
  });
});

describe("re-judge", () => {
  it("selects the accepted judge event and lists prior events", () => {
    const run = makeRun({
      id: "run-1",
      attemptId: "att-1",
      trial: 0,
      status: "completed",
      candidates: [candidate("cand-m1", M1, "m1-a1", [attemptRec("m1-a1", "completed")])],
      judgeAccepted: "j-2",
      judgeAttempts: [
        judgeAttempt("j-1", "completed", { report: true }),
        judgeAttempt("j-2", "completed", {
          report: true,
          blind: { A: "cand-m1" },
          candidateAttempts: { "cand-m1": "m1-a1" },
        }),
      ],
    });
    const experiment = makeExperiment({
      attempts: [taskAttempt({ id: "att-1", runId: "run-1", trial: 0, status: "completed" })],
      selected: "att-1",
    });
    const selection = select({ experiment, runs: [run] });
    const m1 = cellFor(selection, M1);
    expect(m1.judgeAssessment?.judgeAttemptId).toBe("j-2");
    expect(m1.judgeAssessment?.priorJudgeAttemptIds).toEqual(["j-1"]);
  });
});

describe("roster extension with reused output", () => {
  it("keeps original candidate attempt ids and marks the added model", () => {
    const base = makeRun({
      id: "run-base",
      attemptId: "att-0",
      trial: 0,
      status: "completed",
      candidates: [
        candidate("cand-m1", M1, "m1-base", [attemptRec("m1-base", "completed")]),
        candidate("cand-m2", M2, "m2-base", [attemptRec("m2-base", "completed")]),
      ],
      judgeAccepted: "j-base",
      judgeAttempts: [judgeAttempt("j-base", "completed", { report: true })],
    });
    const extension = makeRun({
      id: "run-ext",
      attemptId: "att-1",
      trial: 1,
      status: "completed",
      candidates: [
        candidate("cand-m1", M1, "m1-copy", [
          attemptRec("m1-copy", "completed", {
            sourceRunId: "run-base",
            sourceCandidateId: "cand-m1",
            sourceAttemptId: "m1-base",
          }),
        ]),
        candidate("cand-m2", M2, "m2-copy", [
          attemptRec("m2-copy", "completed", {
            sourceRunId: "run-base",
            sourceCandidateId: "cand-m2",
            sourceAttemptId: "m2-base",
          }),
        ]),
        candidate("cand-m3", M3, "m3-fresh", [attemptRec("m3-fresh", "completed")]),
      ],
      judgeAccepted: "j-ext",
      judgeAttempts: [judgeAttempt("j-ext", "completed", { report: true })],
      repair: { kind: "roster-extension", addedModelKey: M3, baseRunId: "run-base" },
    });
    const experiment = makeExperiment({
      attempts: [
        taskAttempt({ id: "att-0", runId: "run-base", trial: 0, status: "completed" }),
        taskAttempt({
          id: "att-1",
          runId: "run-ext",
          trial: 1,
          status: "completed",
          repair: { kind: "roster-extension", addedModelKey: M3, baseRunId: "run-base" },
        }),
      ],
      selected: "att-1",
      slots: [slot("s1", M1), slot("s2", M2), slot("s3", M3)],
      extensions: [
        {
          addedModelKey: M3,
          addedSlot: slot("s3", M3),
          priorFingerprint: `sha256:${"a".repeat(64)}`,
          extendedAt: 10,
        },
      ],
    });
    const selection = select({ experiment, runs: [base, extension] });

    const m1 = cellFor(selection, M1);
    expect(m1.provenance).toBe("roster_extension_reused");
    expect(m1.candidateAttemptId).toBe("m1-base");
    expect(m1.reusedOutput).toBe(true);
    expect(m1.judgeAssessment?.judgeAttemptId).toBe("j-ext");

    const m2 = cellFor(selection, M2);
    expect(m2.provenance).toBe("roster_extension_reused");
    expect(m2.candidateAttemptId).toBe("m2-base");

    const m3 = cellFor(selection, M3);
    expect(m3.provenance).toBe("roster_extension_added");
    expect(m3.candidateAttemptId).toBe("m3-fresh");
    expect(m3.reusedOutput).toBe(false);

    expect(selection.gaps).toEqual([]);
  });
  it("lists the base run's judge assessment as a drillable prior assessment", () => {
    const base = makeRun({
      id: "run-base",
      attemptId: "att-0",
      trial: 0,
      status: "completed",
      candidates: [candidate("cand-m1", M1, "m1-base", [attemptRec("m1-base", "completed")])],
      judgeAccepted: "j-base",
      judgeAttempts: [judgeAttempt("j-base", "completed", { report: true })],
    });
    const extension = makeRun({
      id: "run-ext",
      attemptId: "att-1",
      trial: 1,
      status: "completed",
      candidates: [
        candidate("cand-m1", M1, "m1-copy", [
          attemptRec("m1-copy", "completed", {
            sourceRunId: "run-base",
            sourceCandidateId: "cand-m1",
            sourceAttemptId: "m1-base",
          }),
        ]),
      ],
      judgeAccepted: "j-ext",
      judgeAttempts: [judgeAttempt("j-ext", "completed", { report: true })],
      repair: { kind: "roster-extension", addedModelKey: M3, baseRunId: "run-base" },
    });
    const experiment = makeExperiment({
      attempts: [
        taskAttempt({ id: "att-0", runId: "run-base", trial: 0, status: "completed" }),
        taskAttempt({
          id: "att-1",
          runId: "run-ext",
          trial: 1,
          status: "completed",
          repair: { kind: "roster-extension", addedModelKey: M3, baseRunId: "run-base" },
        }),
      ],
      selected: "att-1",
      slots: [slot("s1", M1)],
    });
    const selection = select({ experiment, runs: [base, extension] });
    const m1 = cellFor(selection, M1);
    expect(m1.judgeAssessment?.judgeAttemptId).toBe("j-ext");
    expect(m1.judgeAssessment?.priorJudgeAttemptIds).toEqual(["j-base"]);
  });
});

describe("full-roster fallback", () => {
  it("marks every re-executed model fresh; the added model stays an extension addition", () => {
    const extension = makeRun({
      id: "run-ext",
      attemptId: "att-1",
      trial: 1,
      status: "completed",
      candidates: [
        candidate("cand-m1", M1, "m1-fresh", [attemptRec("m1-fresh", "completed")]),
        candidate("cand-m2", M2, "m2-fresh", [attemptRec("m2-fresh", "completed")]),
        candidate("cand-m3", M3, "m3-fresh", [attemptRec("m3-fresh", "completed")]),
      ],
      judgeAccepted: "j-ext",
      judgeAttempts: [judgeAttempt("j-ext", "completed", { report: true })],
      repair: { kind: "roster-extension", addedModelKey: M3 },
    });
    const experiment = makeExperiment({
      attempts: [
        taskAttempt({
          id: "att-1",
          runId: "run-ext",
          trial: 1,
          status: "completed",
          repair: { kind: "roster-extension", addedModelKey: M3 },
        }),
      ],
      selected: "att-1",
      slots: [slot("s1", M1), slot("s2", M2), slot("s3", M3)],
    });
    const selection = select({ experiment, runs: [extension] });
    expect(cellFor(selection, M1).provenance).toBe("fresh");
    expect(cellFor(selection, M2).provenance).toBe("fresh");
    expect(cellFor(selection, M3).provenance).toBe("roster_extension_added");
  });
});

describe("multiple extension events", () => {
  it("resolves reuse chains to the original attempt across events", () => {
    const base = makeRun({
      id: "run-base",
      attemptId: "att-0",
      trial: 0,
      status: "completed",
      candidates: [
        candidate("cand-m1", M1, "m1-base", [attemptRec("m1-base", "completed")]),
        candidate("cand-m2", M2, "m2-base", [attemptRec("m2-base", "completed")]),
      ],
      judgeAccepted: "j-base",
      judgeAttempts: [judgeAttempt("j-base", "completed", { report: true })],
    });
    const ext1 = makeRun({
      id: "run-ext1",
      attemptId: "att-1",
      trial: 1,
      status: "completed",
      candidates: [
        candidate("cand-m1", M1, "m1-ext1", [
          attemptRec("m1-ext1", "completed", {
            sourceRunId: "run-base",
            sourceCandidateId: "cand-m1",
            sourceAttemptId: "m1-base",
          }),
        ]),
        candidate("cand-m3", M3, "m3-ext1", [attemptRec("m3-ext1", "completed")]),
      ],
      judgeAccepted: "j-ext1",
      judgeAttempts: [judgeAttempt("j-ext1", "completed", { report: true })],
      repair: { kind: "roster-extension", addedModelKey: M3, baseRunId: "run-base" },
    });
    const ext2 = makeRun({
      id: "run-ext2",
      attemptId: "att-2",
      trial: 2,
      status: "completed",
      candidates: [
        candidate("cand-m1", M1, "m1-ext2", [
          attemptRec("m1-ext2", "completed", {
            sourceRunId: "run-ext1",
            sourceCandidateId: "cand-m1",
            sourceAttemptId: "m1-ext1",
          }),
        ]),
        candidate("cand-m3", M3, "m3-ext2", [
          attemptRec("m3-ext2", "completed", {
            sourceRunId: "run-ext1",
            sourceCandidateId: "cand-m3",
            sourceAttemptId: "m3-ext1",
          }),
        ]),
        candidate("cand-m4", M4, "m4-ext2", [attemptRec("m4-ext2", "completed")]),
      ],
      judgeAccepted: "j-ext2",
      judgeAttempts: [judgeAttempt("j-ext2", "completed", { report: true })],
      repair: { kind: "roster-extension", addedModelKey: M4, baseRunId: "run-ext1" },
    });
    const experiment = makeExperiment({
      attempts: [
        taskAttempt({ id: "att-0", runId: "run-base", trial: 0, status: "completed" }),
        taskAttempt({
          id: "att-1",
          runId: "run-ext1",
          trial: 1,
          status: "completed",
          repair: { kind: "roster-extension", addedModelKey: M3, baseRunId: "run-base" },
        }),
        taskAttempt({
          id: "att-2",
          runId: "run-ext2",
          trial: 2,
          status: "completed",
          repair: { kind: "roster-extension", addedModelKey: M4, baseRunId: "run-ext1" },
        }),
      ],
      selected: "att-2",
      slots: [slot("s1", M1), slot("s2", M2), slot("s3", M3), slot("s4", M4)],
    });
    const selection = select({ experiment, runs: [base, ext1, ext2] });

    // m1's output was generated in run-base and reused across both extensions.
    expect(cellFor(selection, M1).candidateAttemptId).toBe("m1-base");
    expect(cellFor(selection, M1).provenance).toBe("roster_extension_reused");
    // Prior lineage assessments stay drillable across every extension event.
    expect(cellFor(selection, M1).judgeAssessment?.priorJudgeAttemptIds).toEqual([
      "j-base",
      "j-ext1",
    ]);
    // m3 was generated in ext1 and reused in ext2.
    expect(cellFor(selection, M3).candidateAttemptId).toBe("m3-ext1");
    expect(cellFor(selection, M3).provenance).toBe("roster_extension_reused");
    // m4 is the fresh addition of ext2.
    expect(cellFor(selection, M4).candidateAttemptId).toBe("m4-ext2");
    expect(cellFor(selection, M4).provenance).toBe("roster_extension_added");
    // m2 was dropped from the extension lineage: explicit gap.
    expect(gapReasonFor(selection, M2)).toBe("missing_cell");

    expect(selection.auditOnlyAttempts).toEqual([
      { attemptId: "att-0", runId: "run-base", status: "completed", superseded: true },
      { attemptId: "att-1", runId: "run-ext1", status: "completed", superseded: true },
    ]);
  });
});

describe("verifier-only and judge+verifier", () => {
  it("selects a verifier-only cell without a judge assessment", () => {
    const run = makeRun({
      id: "run-1",
      attemptId: "att-1",
      trial: 0,
      status: "completed",
      candidates: [candidate("cand-m1", M1, "m1-a1", [attemptRec("m1-a1", "completed")])],
      judgeAccepted: null,
      judgeAttempts: [],
    });
    const experiment = makeExperiment({
      attempts: [taskAttempt({ id: "att-1", runId: "run-1", trial: 0, status: "completed" })],
      selected: "att-1",
    });
    const selection = select({
      experiment,
      runs: [run],
      verifierOutcomes: [vo(M1, { passed: true, executedAt: 5 })],
    });
    const m1 = cellFor(selection, M1);
    expect(m1.judgeAssessment).toBeNull();
    expect(m1.verifier).toEqual(vo(M1, { passed: true, executedAt: 5 }));
  });

  it("selects both judge assessment and verifier outcome", () => {
    const run = makeRun({
      id: "run-1",
      attemptId: "att-1",
      trial: 0,
      status: "completed",
      candidates: [
        candidate("cand-m1", M1, "m1-a1", [attemptRec("m1-a1", "completed")]),
        candidate("cand-m2", M2, "m2-a1", [attemptRec("m2-a1", "completed")]),
      ],
      judgeAccepted: "j-1",
      judgeAttempts: [judgeAttempt("j-1", "completed", { report: true })],
    });
    const experiment = makeExperiment({
      attempts: [taskAttempt({ id: "att-1", runId: "run-1", trial: 0, status: "completed" })],
      selected: "att-1",
    });
    const selection = select({
      experiment,
      runs: [run],
      verifierOutcomes: [vo(M1, { passed: false, executedAt: 5 })],
    });
    expect(cellFor(selection, M1).judgeAssessment?.judgeAttemptId).toBe("j-1");
    expect(cellFor(selection, M1).verifier?.passed).toBe(false);
    expect(cellFor(selection, M2).judgeAssessment).not.toBeNull();
    expect(cellFor(selection, M2).verifier).toBeNull();
  });

  it("selects the latest verifier outcome by executedAt, not the first array match", () => {
    const run = makeRun({
      id: "run-1",
      attemptId: "att-1",
      trial: 0,
      status: "completed",
      candidates: [candidate("cand-m1", M1, "m1-a1", [attemptRec("m1-a1", "completed")])],
      judgeAccepted: null,
      judgeAttempts: [],
    });
    const experiment = makeExperiment({
      attempts: [taskAttempt({ id: "att-1", runId: "run-1", trial: 0, status: "completed" })],
      selected: "att-1",
    });
    const selection = select({
      experiment,
      runs: [run],
      verifierOutcomes: [
        vo(M1, { passed: true, executedAt: 5 }),
        vo(M1, { passed: false, executedAt: 10 }),
      ],
    });
    expect(cellFor(selection, M1).verifier?.passed).toBe(false);
  });
});
describe("duplicate source cells", () => {
  it("flags duplicate candidates for one source cell instead of emitting both", () => {
    const run = makeRun({
      id: "run-1",
      attemptId: "att-1",
      trial: 0,
      status: "completed",
      candidates: [
        candidate("c1", M1, "a1", [attemptRec("a1", "completed")]),
        candidate("c2", M1, "a2", [attemptRec("a2", "completed")]),
      ],
      judgeAccepted: "j-1",
      judgeAttempts: [judgeAttempt("j-1", "completed", { report: true })],
    });
    const experiment = makeExperiment({
      attempts: [taskAttempt({ id: "att-1", runId: "run-1", trial: 0, status: "completed" })],
      selected: "att-1",
    });
    const selection = select({ experiment, runs: [run] });
    expect(selection.integrityIssues.some((issue) => issue.includes("duplicate"))).toBe(true);
    expect(selection.cells.filter((c) => c.modelKey === M1)).toHaveLength(1);
  });
});

describe("source integrity", () => {
  it("rejects a selected run from a different experiment", () => {
    const other = makeRun({
      id: "run-other",
      attemptId: "att-1",
      trial: 0,
      status: "completed",
      candidates: [candidate("cand-m1", M1, "m1-a1", [attemptRec("m1-a1", "completed")])],
      judgeAccepted: "j-1",
      judgeAttempts: [judgeAttempt("j-1", "completed", { report: true })],
    });
    if (other.source.kind === "experiment") {
      other.source.experimentId = "exp-other";
    }
    const experiment = makeExperiment({
      attempts: [taskAttempt({ id: "att-1", runId: "run-other", trial: 0, status: "completed" })],
      selected: "att-1",
    });
    const selection = select({ experiment, runs: [other] });
    expect(selection.integrityIssues.length).toBeGreaterThan(0);
    expect(selection.cells).toEqual([]);
    expect(gapReasonFor(selection, M1)).toBe("no_accepted_output");
  });

  it("fails cleanly for an unknown task id", () => {
    const experiment = makeExperiment({ attempts: [], selected: null });
    const result = selectObservationSources({
      experiment,
      taskId: "task-missing",
      resolveRunRecord: resolver([]),
      verifierOutcomes: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/task-missing/);
  });
});
