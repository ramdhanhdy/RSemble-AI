// =============================================================================
// experiment-roster-extension.test.ts — pure planner + rotator contracts
// (plan 001, B4).
//
// Covers exact per-task planning, fallback selection, identity guards, cost
// math, fingerprint rotation, snapshot immutability, and input non-mutation.
// =============================================================================

import { describe, expect, it } from "vitest";
import type {
  EvaluationTask,
  ExperimentRecord,
  ExperimentRosterExtension,
  ExperimentTaskAttempt,
} from "./evaluation-types";
import type { ModelSlot } from "../../studio-data";
import type { PersistedCandidate, RunRecordV2, RunSource } from "../persistence/run-types";
import {
  modelKeyOf,
  planRosterExtension,
  rotateExperimentRoster,
  takenModelKeys,
} from "./experiment-roster-extension";

// --- Fixtures ------------------------------------------------------------------

const OLD_SLOTS: ModelSlot[] = [
  { id: "s1", providerId: "openrouter", provider: "OpenRouter", model: "m1", slug: "org/m1", enabled: true },
  { id: "s2", providerId: "gemini", provider: "Gemini", model: "m2", slug: "m2", enabled: true },
];

const NEW_SLOT: ModelSlot = {
  id: "slot-new",
  providerId: "deepseek",
  provider: "DeepSeek",
  model: "deepseek-chat",
  slug: "deepseek-chat",
  enabled: true,
};

function makeTask(id: string, order: number): EvaluationTask {
  return {
    id,
    title: `Task ${id}`,
    prompt: `prompt-${id}`,
    systemPrompt: "",
    evaluation: { kind: "inherit" },
    judgeInstructionOverride: "",
    order,
  };
}

function makeCandidate(modelKey: string, candidateId: string): PersistedCandidate {
  return {
    candidateId,
    slotId: `slot-${modelKey}`,
    modelKey,
    providerId: modelKey.split(":")[0],
    model: modelKey.split(":")[1],
    slug: modelKey.split(":")[1],
    acceptedAttemptId: `att-cand-${modelKey}`,
    attempts: [
      {
        attemptId: `att-cand-${modelKey}`,
        messages: [{ role: "user", content: "hi" }],
        startedAt: 10,
        finishedAt: 20,
        status: "completed",
        output: `output-${modelKey}`,
        tokensIn: 5,
        tokensOut: 5,
        error: null,
      },
    ],
  };
}

function makeSelectedRun(input: {
  runId: string;
  experimentId: string;
  suiteId: string;
  suiteVersion: number;
  taskId: string;
  attemptId: string;
  fingerprint: string;
  candidates?: PersistedCandidate[];
}): RunRecordV2 {
  const source: RunSource = {
    kind: "experiment",
    experimentId: input.experimentId,
    suiteId: input.suiteId,
    suiteVersion: input.suiteVersion,
    protocolFingerprint: input.fingerprint,
    taskId: input.taskId,
    experimentTaskAttemptId: input.attemptId,
    trial: 0,
  };
  return {
    schemaVersion: 2,
    id: input.runId,
    revision: 1,
    execution: { ownerId: "tab", fence: 1 },
    createdAt: 100,
    updatedAt: 200,
    completedAt: 200,
    status: "completed",
    mode: "rank",
    source,
    task: { title: "t", prompt: "p", systemPrompt: "", temperature: 0.7 },
    evaluation: { profile: null, candidateMessages: [] },
    candidates: input.candidates ?? [
      makeCandidate("openrouter:org/m1", "cand-1"),
      makeCandidate("gemini:m2", "cand-2"),
    ],
    judge: { status: "done", acceptedAttemptId: "j1", report: null, consensus: null, attempts: [] },
    fusion: { status: "idle", acceptedAttemptId: null, attempts: [] },
    winnerKeys: [],
  };
}

function makeAttempt(id: string, runId: string | null, status: ExperimentTaskAttempt["status"]): ExperimentTaskAttempt {
  return {
    id,
    runId,
    trial: 0,
    status,
    startedAt: 100,
    finishedAt: 200,
    error: null,
  };
}

function makeExperiment(input: {
  taskIds?: string[];
  status?: ExperimentRecord["status"];
  withRuns?: boolean;
  selectedStatus?: ExperimentTaskAttempt["status"];
  rosterExtensions?: ExperimentRosterExtension[];
} = {}): ExperimentRecord {
  const status = input.status ?? "completed";
  const taskIds = input.taskIds ?? ["t1", "t2", "t3"];
  const tasks = taskIds.map((id, i) => makeTask(id, i));
  const taskStates = taskIds.map((taskId) => {
    if (input.withRuns === false) {
      return { taskId, selectedAttemptId: null, attempts: [] };
    }
    const attemptId = `att-${taskId}`;
    const attempt = makeAttempt(attemptId, `run-${taskId}`, input.selectedStatus ?? "completed");
    return { taskId, selectedAttemptId: attemptId, attempts: [attempt] };
  });
  const record: ExperimentRecord = {
    id: "exp-1",
    revision: 5,
    suiteId: "suite-1",
    suiteVersion: 3,
    protocolFingerprint: "sha256:orig",
    status,
    execution: null,
    snapshot: {
      suiteId: "suite-1",
      suiteVersion: 3,
      tasks,
      modelSlots: [...OLD_SLOTS],
      defaultJudge: { providerId: "openrouter", model: "org/judge" },
      defaultEvaluation: { kind: "holistic" },
      profiles: [],
      protocolFingerprint: "sha256:orig",
      createdAt: 1000,
    },
    tasks: taskStates,
    createdAt: 1000,
    updatedAt: 2000,
    ...(input.rosterExtensions ? { rosterExtensions: input.rosterExtensions } : {}),
  };
  return record;
}

function makeResolver(runs: Map<string, RunRecordV2>) {
  return (runId: string): RunRecordV2 | null => runs.get(runId) ?? null;
}

function resolverForExperiment(exp: ExperimentRecord): Map<string, RunRecordV2> {
  const runs = new Map<string, RunRecordV2>();
  for (const ts of exp.tasks) {
    for (const a of ts.attempts) {
      if (!a.runId) continue;
      runs.set(
        a.runId,
        makeSelectedRun({
          runId: a.runId,
          experimentId: exp.id,
          suiteId: exp.suiteId,
          suiteVersion: exp.suiteVersion,
          taskId: ts.taskId,
          attemptId: a.id,
          fingerprint: exp.protocolFingerprint,
        }),
      );
    }
  }
  return runs;
}

const COMPOUND = "compound";
const FULL = "full-roster";

// --- planRosterExtension -------------------------------------------------------

describe("planRosterExtension", () => {
  it("rejects a non-terminal experiment", () => {
    const exp = makeExperiment({ status: "running" });
    const result = planRosterExtension({ experiment: exp, slot: NEW_SLOT, resolveRunRecord: () => null });
    expect(result.ok).toBe(false);
  });

  it("rejects a disabled slot", () => {
    const exp = makeExperiment();
    const result = planRosterExtension({
      experiment: exp,
      slot: { ...NEW_SLOT, enabled: false },
      resolveRunRecord: () => null,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a duplicate key in the current roster", () => {
    const exp = makeExperiment();
    const dup = { ...NEW_SLOT, providerId: OLD_SLOTS[0].providerId, slug: OLD_SLOTS[0].slug, model: OLD_SLOTS[0].model };
    const result = planRosterExtension({ experiment: exp, slot: dup, resolveRunRecord: () => null });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/already/i);
  });

  it("rejects a duplicate key in extension history", () => {
    const historyEntry: ExperimentRosterExtension = {
      addedModelKey: modelKeyOf(NEW_SLOT),
      addedSlot: NEW_SLOT,
      priorFingerprint: "sha256:orig",
      extendedAt: 1500,
    };
    const exp = makeExperiment({ rosterExtensions: [historyEntry] });
    const result = planRosterExtension({ experiment: exp, slot: NEW_SLOT, resolveRunRecord: () => null });
    expect(result.ok).toBe(false);
  });

  it("keeps the same slug distinct under a different provider", () => {
    const exp = makeExperiment();
    // OLD_SLOTS has gemini:m2; same slug under deepseek must be allowed.
    const sameSlug = { ...NEW_SLOT, slug: "m2", model: "m2" };
    const runs = resolverForExperiment(exp);
    const result = planRosterExtension({ experiment: exp, slot: sameSlug, resolveRunRecord: makeResolver(runs) });
    expect(result.ok).toBe(true);
  });

  it("plans all tasks compound when every selected run has accepted outputs", () => {
    const exp = makeExperiment();
    const runs = resolverForExperiment(exp);
    const result = planRosterExtension({ experiment: exp, slot: NEW_SLOT, resolveRunRecord: makeResolver(runs) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.taskCount).toBe(3);
    expect(result.plan.taskPlans.every((p) => p.mode === COMPOUND)).toBe(true);
    expect(result.plan.candidateCalls).toBe(3);
    expect(result.plan.judgeCalls).toBe(3);
    expect(result.plan.reusedOutputCount).toBe(6); // 2 reused per task
    expect(result.plan.fullRosterFallbackCount).toBe(0);
    for (const p of result.plan.taskPlans) {
      expect(p.executionPlan.kind).toBe("roster-extension");
      expect(p.executionPlan.addedModelKey).toBe(modelKeyOf(NEW_SLOT));
      expect(p.executionPlan.baseRunId).toBe(`run-${p.taskId}`);
      expect(p.candidateCalls).toBe(1);
      expect(p.judgeCalls).toBe(1);
      expect(p.reusedModelKeys).toEqual(["openrouter:org/m1", "gemini:m2"]);
    }
  });

  it("uses full-roster fallback when a task has no attempts", () => {
    const exp = makeExperiment();
    exp.tasks[1] = { taskId: "t2", selectedAttemptId: null, attempts: [] };
    const runs = resolverForExperiment(exp);
    const result = planRosterExtension({ experiment: exp, slot: NEW_SLOT, resolveRunRecord: makeResolver(runs) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const fallback = result.plan.taskPlans.find((p) => p.taskId === "t2")!;
    expect(fallback.mode).toBe(FULL);
    expect(fallback.executionPlan.baseRunId).toBeUndefined();
    expect(fallback.candidateCalls).toBe(3); // rotated roster: 2 old + 1 new
    expect(fallback.reusedModelKeys).toEqual([]);
    expect(result.plan.fullRosterFallbackCount).toBe(1);
  });

  it("uses full-roster fallback when the run record is unavailable", () => {
    const exp = makeExperiment();
    const empty = new Map<string, RunRecordV2>();
    const result = planRosterExtension({ experiment: exp, slot: NEW_SLOT, resolveRunRecord: makeResolver(empty) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.fullRosterFallbackCount).toBe(3);
    expect(result.plan.candidateCalls).toBe(9); // 3 tasks × 3 candidates
    expect(result.plan.reusedOutputCount).toBe(0);
  });

  it("uses full-roster fallback when no candidate has an accepted output", () => {
    const exp = makeExperiment();
    const runs = resolverForExperiment(exp);
    // Replace t1's run with one whose candidates have no accepted attempt.
    runs.set("run-t1", {
      ...makeSelectedRun({
        runId: "run-t1",
        experimentId: exp.id,
        suiteId: exp.suiteId,
        suiteVersion: exp.suiteVersion,
        taskId: "t1",
        attemptId: "att-t1",
        fingerprint: exp.protocolFingerprint,
      }),
      candidates: [
        { ...makeCandidate("openrouter:org/m1", "cand-1"), acceptedAttemptId: null },
        { ...makeCandidate("gemini:m2", "cand-2"), acceptedAttemptId: null },
      ],
    });
    const result = planRosterExtension({ experiment: exp, slot: NEW_SLOT, resolveRunRecord: makeResolver(runs) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const t1 = result.plan.taskPlans.find((p) => p.taskId === "t1")!;
    expect(t1.mode).toBe(FULL);
    expect(result.plan.fullRosterFallbackCount).toBe(1);
  });

  it("uses full-roster fallback when the run source identity mismatches", () => {
    const exp = makeExperiment();
    const runs = resolverForExperiment(exp);
    // Mismatch: run claims a different experiment.
    const bad = makeSelectedRun({
      runId: "run-t1",
      experimentId: "exp-OTHER",
      suiteId: exp.suiteId,
      suiteVersion: exp.suiteVersion,
      taskId: "t1",
      attemptId: "att-t1",
      fingerprint: exp.protocolFingerprint,
    });
    runs.set("run-t1", bad);
    const result = planRosterExtension({ experiment: exp, slot: NEW_SLOT, resolveRunRecord: makeResolver(runs) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.taskPlans.find((p) => p.taskId === "t1")!.mode).toBe(FULL);
  });

  it("computes exact counts with three tasks and one fallback", () => {
    const exp = makeExperiment();
    exp.tasks[2] = { taskId: "t3", selectedAttemptId: null, attempts: [] };
    const runs = resolverForExperiment(exp);
    const result = planRosterExtension({ experiment: exp, slot: NEW_SLOT, resolveRunRecord: makeResolver(runs) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const plan = result.plan;
    expect(plan.taskCount).toBe(3);
    expect(plan.candidateCalls).toBe(2 + 3); // 2 compound + 3 full
    expect(plan.judgeCalls).toBe(3);
    expect(plan.reusedOutputCount).toBe(4); // 2 reused × 2 compound tasks
    expect(plan.fullRosterFallbackCount).toBe(1);
    expect(plan.fullRosterCandidateCount).toBe(3);
    // Cost identity from the plan document.
    expect(plan.candidateCalls).toBe(
      (plan.taskCount - plan.fullRosterFallbackCount) +
        plan.fullRosterFallbackCount * plan.fullRosterCandidateCount,
    );
    expect(plan.judgeCalls).toBe(plan.taskCount);
  });

  it("does not mutate the experiment or slot inputs", () => {
    const exp = makeExperiment();
    const expBefore = JSON.parse(JSON.stringify(exp));
    const slotBefore = JSON.parse(JSON.stringify(NEW_SLOT));
    const runs = resolverForExperiment(exp);
    planRosterExtension({ experiment: exp, slot: NEW_SLOT, resolveRunRecord: makeResolver(runs) });
    expect(exp).toEqual(expBefore);
    expect(NEW_SLOT).toEqual(slotBefore);
  });
});

describe("takenModelKeys", () => {
  it("includes snapshot roster and extension history keys", () => {
    const historyEntry: ExperimentRosterExtension = {
      addedModelKey: "deepseek:deepseek-chat",
      addedSlot: NEW_SLOT,
      priorFingerprint: "sha256:orig",
      extendedAt: 1500,
    };
    const exp = makeExperiment({ rosterExtensions: [historyEntry] });
    const keys = takenModelKeys(exp);
    expect(keys.has("openrouter:org/m1")).toBe(true);
    expect(keys.has("gemini:m2")).toBe(true);
    expect(keys.has("deepseek:deepseek-chat")).toBe(true);
  });
});

// --- rotateExperimentRoster ----------------------------------------------------

describe("rotateExperimentRoster", () => {
  it("appends the slot, rotates the fingerprint, and records history", () => {
    const exp = makeExperiment();
    const result = rotateExperimentRoster({ experiment: exp, slot: NEW_SLOT, extendedAt: 2000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rec = result.record;

    // Roster gains exactly one slot; the added slot identity is preserved.
    expect(rec.snapshot.modelSlots).toHaveLength(3);
    const added = rec.snapshot.modelSlots[2];
    expect(added.id).toBe(NEW_SLOT.id);
    expect(modelKeyOf(added)).toBe(modelKeyOf(NEW_SLOT));

    // Fingerprints rotated and copied to the record.
    expect(rec.snapshot.protocolFingerprint).not.toBe(exp.snapshot.protocolFingerprint);
    expect(rec.protocolFingerprint).toBe(rec.snapshot.protocolFingerprint);
    expect(rec.protocolFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);

    // History entry.
    expect(rec.rosterExtensions).toHaveLength(1);
    const entry = rec.rosterExtensions![0];
    expect(entry.addedModelKey).toBe(modelKeyOf(NEW_SLOT));
    expect(entry.priorFingerprint).toBe("sha256:orig");
    expect(entry.extendedAt).toBe(2000);
    expect(entry.addedSlot.id).toBe(NEW_SLOT.id);

    // Record stays terminal — the engine owns `running`.
    expect(rec.status).toBe("completed");
  });

  it("leaves every other snapshot field byte-identical", () => {
    const exp = makeExperiment();
    const result = rotateExperimentRoster({ experiment: exp, slot: NEW_SLOT, extendedAt: 2000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const before = exp.snapshot;
    const after = result.record.snapshot;
    expect(after.suiteId).toBe(before.suiteId);
    expect(after.suiteVersion).toBe(before.suiteVersion);
    expect(after.tasks).toEqual(before.tasks);
    expect(after.defaultJudge).toEqual(before.defaultJudge);
    expect(after.defaultEvaluation).toEqual(before.defaultEvaluation);
    expect(after.profiles).toEqual(before.profiles);
    expect(after.createdAt).toBe(before.createdAt);
    // Only modelSlots and protocolFingerprint differ.
    expect(after.modelSlots).not.toEqual(before.modelSlots);
    expect(after.protocolFingerprint).not.toBe(before.protocolFingerprint);
    // Suite identity unchanged on the record.
    expect(result.record.suiteId).toBe(exp.suiteId);
    expect(result.record.suiteVersion).toBe(exp.suiteVersion);
  });

  it("produces a different fingerprint when roster semantics change", () => {
    const exp = makeExperiment();
    const a = rotateExperimentRoster({ experiment: exp, slot: NEW_SLOT, extendedAt: 2000 });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    // Rotating a different model yields a different fingerprint.
    const other: ModelSlot = { ...NEW_SLOT, id: "slot-other", slug: "deepseek-reasoner", model: "deepseek-reasoner" };
    const b = rotateExperimentRoster({ experiment: exp, slot: other, extendedAt: 2000 });
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    expect(a.record.protocolFingerprint).not.toBe(b.record.protocolFingerprint);
  });

  it("rejects a duplicate key and does not mutate the input", () => {
    const exp = makeExperiment();
    const before = JSON.parse(JSON.stringify(exp));
    const dup = { ...NEW_SLOT, providerId: "openrouter", slug: "org/m1", model: "m1" };
    const result = rotateExperimentRoster({ experiment: exp, slot: dup, extendedAt: 2000 });
    expect(result.ok).toBe(false);
    expect(exp).toEqual(before);
  });

  it("rejects a disabled slot", () => {
    const exp = makeExperiment();
    const result = rotateExperimentRoster({ experiment: exp, slot: { ...NEW_SLOT, enabled: false }, extendedAt: 2000 });
    expect(result.ok).toBe(false);
  });

  it("rejects an invalid extendedAt", () => {
    const exp = makeExperiment();
    expect(rotateExperimentRoster({ experiment: exp, slot: NEW_SLOT, extendedAt: Number.NaN }).ok).toBe(false);
    expect(rotateExperimentRoster({ experiment: exp, slot: NEW_SLOT, extendedAt: -1 }).ok).toBe(false);
  });

  it("does not mutate the experiment, slot, or run fixtures", () => {
    const exp = makeExperiment();
    const expBefore = JSON.parse(JSON.stringify(exp));
    const slotBefore = JSON.parse(JSON.stringify(NEW_SLOT));
    rotateExperimentRoster({ experiment: exp, slot: NEW_SLOT, extendedAt: 2000 });
    expect(exp).toEqual(expBefore);
    expect(NEW_SLOT).toEqual(slotBefore);
  });
});
