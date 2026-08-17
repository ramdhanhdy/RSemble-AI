import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import {
  buildComparisonInputSnapshot,
  validatePreCallPersistence,
  buildPreCallPersistencePlan,
  executePreCallPersistence,
  type PreCallPersistenceInput,
  type PreCallPersistenceDeps,
} from "./pre-call-persistence";
import type { ModelSlot } from "../../studio-data";
import type { CriticRef } from "../providers/types";
import { HOLISTIC_EVALUATION } from "../evaluations/evaluation-profile-adhoc";
import type { RunRecorder } from "../persistence/run-recorder";
import type { ComparisonRepository } from "../persistence/comparison-repository";
import type { TaskRepository } from "../persistence/task-repository";
import type { RunRecordV2 } from "../persistence/run-types";
import { StorageError } from "../persistence/database";

const VALID_SLOTS: ModelSlot[] = [
  {
    id: "slot-1",
    provider: "OpenRouter",
    providerId: "openrouter",
    model: "Model Alpha",
    slug: "alpha",
    enabled: true,
  },
  {
    id: "slot-2",
    provider: "OpenRouter",
    providerId: "openrouter",
    model: "Model Beta",
    slug: "beta",
    enabled: true,
  },
];

const VALID_CRITIC: CriticRef = {
  provider: "OpenRouter",
  providerId: "openrouter",
  model: "Judge Prime",
  slug: "judge-prime",
};

function makeValidInput(overrides: Partial<PreCallPersistenceInput> = {}): PreCallPersistenceInput {
  return {
    mode: "rank",
    prompt: "Compare these two models on clarity and conciseness.",
    systemPrompt: "You are a helpful assistant.",
    temperature: 0.7,
    slots: VALID_SLOTS.map((s) => ({ ...s })),
    critic: { ...VALID_CRITIC },
    judgeInstruction: "Be strict and objective.",
    evaluation: { ...HOLISTIC_EVALUATION },
    attachments: [],
    attachmentsToJudge: false,
    ...overrides,
  };
}

function makeMockRecord(runId: string, overrides: Partial<RunRecordV2> = {}): RunRecordV2 {
  return {
    id: runId,
    createdAt: 1000,
    updatedAt: 1000,
    source: { kind: "adhoc" },
    status: "running",
    mode: "rank",
    task: {
      prompt: "Compare these two models on clarity and conciseness.",
      systemPrompt: "You are a helpful assistant.",
      temperature: 0.7,
      title: "Compare these two models on clarity and conciseness.",
      family: "general",
    },
    evaluation: { ...HOLISTIC_EVALUATION },
    critic: { ...VALID_CRITIC },
    judgeInstruction: "Be strict and objective.",
    candidates: [],
    judge: {
      candidateOrder: [],
      status: "idle",
      attempts: [],
      acceptedAttemptId: null,
      error: null,
    },
    fusion: {
      status: "idle",
      attempts: [],
      acceptedAttemptId: null,
      error: null,
    },
    revision: 0,
    ...overrides,
  };
}

interface MockDepsHarness {
  deps: PreCallPersistenceDeps;
  recorder: RunRecorder;
  comparisonRepo: ComparisonRepository;
  taskRepo: TaskRepository;
  spies: {
    recorderBegin: Mock;
    recorderMarkAborted: Mock;
    recorderGetRecord: Mock;
    createComparisonEnvelope: Mock;
    getTaskVersion: Mock;
    getOrCreateTaskInstance: Mock;
  };
}

function makeMockDeps(overrides: Partial<PreCallPersistenceDeps> = {}): MockDepsHarness {
  let createdRecord: RunRecordV2 = makeMockRecord("run-100");

  const recorderBegin = vi.fn().mockImplementation(async (input) => {
    createdRecord = makeMockRecord(input.runId || "run-100", {
      mode: input.mode,
      task: {
        prompt: input.task.prompt,
        systemPrompt: input.task.systemPrompt,
        temperature: input.task.temperature,
        title: input.task.prompt.slice(0, 40),
        family: "general",
      },
    });
    return createdRecord.id;
  });
  const recorderMarkAborted = vi.fn().mockResolvedValue(undefined);
  const recorderGetRecord = vi.fn().mockImplementation(async (id: string) => {
    return { ...createdRecord, id };
  });

  const recorder: RunRecorder = {
    begin: recorderBegin,
    saveFanout: vi.fn().mockResolvedValue(undefined),
    beginCandidateAttempt: vi.fn().mockResolvedValue(undefined),
    finishCandidateAttempt: vi.fn().mockResolvedValue(undefined),
    beginJudgeAttempt: vi.fn().mockResolvedValue(undefined),
    finishJudgeAttempt: vi.fn().mockResolvedValue(undefined),
    beginFusionAttempt: vi.fn().mockResolvedValue(undefined),
    finishFusionAttempt: vi.fn().mockResolvedValue(undefined),
    rebindExecution: vi.fn().mockResolvedValue(undefined),
    markAborted: recorderMarkAborted,
    getRecord: recorderGetRecord,
  };

  const createComparisonEnvelope = vi.fn().mockImplementation(async (rec, taskBinding, opts) => {
    return {
      id: rec.id,
      runId: rec.id,
      createdAt: rec.createdAt,
      updatedAt: rec.updatedAt,
      status: rec.status,
      mode: rec.mode,
      title: rec.task.title,
      taskBinding,
      taskInstanceId: opts?.taskInstanceId ?? null,
      activeObservationIds: opts?.activeObservationIds ?? [],
      evidenceReceiptRevision: opts?.evidenceReceiptRevision ?? 0,
      lineage: { repeatedFrom: opts?.repeatedFrom ?? null },
      revision: 0,
    };
  });

  const comparisonRepo: ComparisonRepository = {
    listComparisonResults: vi.fn().mockResolvedValue([]),
    getComparisonResult: vi.fn().mockResolvedValue(null),
    createComparisonEnvelope,
    bindComparisonToTask: vi.fn(),
    recordComparisonLineage: vi.fn(),
    rebuildComparisonIndex: vi.fn().mockResolvedValue(null),
    subscribe: vi.fn().mockReturnValue(() => undefined),
  };

  const getTaskVersion = vi.fn().mockImplementation(async (taskId: string, version: number) => {
    if (taskId === "task-42" && version === 1) {
      return {
        taskId,
        version,
        title: "Canonical Task 42",
        objective: "Test objective",
        candidateInstruction: "Test instruction",
        defaultContextManifest: [],
        responseContract: null,
        taskVerifierRef: null,
        source: { kind: "authored", legacyScopeKey: null, note: null },
        createdAt: 500,
      };
    }
    return null;
  });

  const getOrCreateTaskInstance = vi.fn().mockImplementation(async (candidate) => {
    return {
      instance: { ...candidate, id: `inst-${candidate.taskId}-v${candidate.taskVersion}` },
      reused: false,
    };
  });

  const taskRepo: TaskRepository = {
    createTask: vi.fn().mockResolvedValue(undefined),
    appendTaskVersion: vi.fn().mockResolvedValue(1),
    archiveTask: vi.fn().mockResolvedValue(1),
    restoreTask: vi.fn().mockResolvedValue(1),
    getTaskRecord: vi.fn().mockResolvedValue(null),
    getTaskVersion,
    listTasks: vi.fn().mockResolvedValue([]),
    putTaskArtifact: vi.fn().mockResolvedValue(undefined),
    getTaskArtifact: vi.fn().mockResolvedValue(null),
    getTaskArtifactBytes: vi.fn().mockResolvedValue(null),
    getOrCreateTaskInstance,
    getTaskInstance: vi.fn().mockResolvedValue(null),
    listTaskInstances: vi.fn().mockResolvedValue([]),
    listTaskVersions: vi.fn().mockResolvedValue([]),
    listTaskMigrationCrosswalks: vi.fn().mockResolvedValue([]),
    putTaskMigrationCrosswalk: vi.fn().mockResolvedValue(undefined),
    getCanonicalTaskMigrationMarker: vi.fn().mockResolvedValue(null),
    putCanonicalTaskMigrationMarker: vi.fn().mockResolvedValue(undefined),
    createTaskFamily: vi.fn().mockResolvedValue(undefined),
    updateTaskFamily: vi.fn().mockResolvedValue(1),
    archiveTaskFamily: vi.fn().mockResolvedValue(1),
    restoreTaskFamily: vi.fn().mockResolvedValue(1),
    getTaskFamily: vi.fn().mockResolvedValue(null),
    listTaskFamilies: vi.fn().mockResolvedValue([]),
    assignTaskFamily: vi.fn().mockResolvedValue(undefined),
    archiveTaskFamilyAssignment: vi.fn().mockResolvedValue(1),
    listTaskFamilyAssignments: vi.fn().mockResolvedValue([]),
    annotateTaskFacet: vi.fn().mockResolvedValue(undefined),
    listTaskFacetAnnotations: vi.fn().mockResolvedValue([]),
  };

  const deps: PreCallPersistenceDeps = {
    recorder,
    comparisonRepo,
    taskRepo,
    now: () => 1000,
    mintRunId: () => "cmp-100",
    ...overrides,
  };

  return {
    deps,
    recorder,
    comparisonRepo,
    taskRepo,
    spies: {
      recorderBegin,
      recorderMarkAborted,
      recorderGetRecord,
      createComparisonEnvelope,
      getTaskVersion,
      getOrCreateTaskInstance,
    },
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("pre-call-persistence: pure snapshot builder", () => {
  it("builds a deterministic ComparisonInputSnapshot from valid input", () => {
    const input = makeValidInput();
    const snap1 = buildComparisonInputSnapshot(input, { now: () => 1000 });
    const snap2 = buildComparisonInputSnapshot(input, { now: () => 1000 });

    expect(snap1).toEqual(snap2);
    expect(snap1.schemaVersion).toBe(1);
    expect(snap1.mode).toBe("rank");
    expect(snap1.prompt).toBe(input.prompt);
    expect(snap1.systemPrompt).toBe(input.systemPrompt);
    expect(snap1.temperature).toBe(0.7);
    expect(snap1.inputDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(snap1.inputSnapshotRef).toMatch(/^snap:sha256:[0-9a-f]{64}$/);
    expect(snap1.normalizedInput.text).toBe(input.prompt);
    expect(snap1.normalizedInput.artifactIds).toEqual([]);
    expect(snap1.contextManifest).toEqual([]);
  });

  it("sanitizes attachment metadata without raw bytes and maps into context manifest", () => {
    const input = makeValidInput({
      attachments: [
        {
          id: "att-1",
          name: "data.csv",
          mediaType: "text/csv",
          byteCount: 1024,
          status: "ready",
          extractedText: "secret-csv-content-that-must-not-appear-in-summary",
        } as never,
      ],
    });
    const snapshot = buildComparisonInputSnapshot(input, { now: () => 1000 });

    expect(snapshot.attachments).toEqual([
      {
        id: "att-1",
        name: "data.csv",
        mediaType: "text/csv",
        byteCount: 1024,
        digest: null,
      },
    ]);
    expect(snapshot.normalizedInput.artifactIds).toEqual(["att-1"]);
    expect(snapshot.contextManifest.length).toBe(1);
    expect(snapshot.contextManifest[0].role).toBe("attachment");
    expect(snapshot.contextManifest[0].artifactId).toBe("att-1");
    // Ensure raw extracted text is never in the snapshot object
    expect(JSON.stringify(snapshot)).not.toContain("secret-csv-content");
  });

  it("rejects credential-like values in prompt, system prompt, or judge instruction", () => {
    expect(() =>
      buildComparisonInputSnapshot(makeValidInput({ prompt: "Bearer secret-token-abc" })),
    ).toThrow(/credential/i);

    expect(() =>
      buildComparisonInputSnapshot(makeValidInput({ systemPrompt: "sk-live-1234567890abcdef" })),
    ).toThrow(/credential/i);

    expect(() =>
      buildComparisonInputSnapshot(makeValidInput({ judgeInstruction: "AIza12345678901234567890123456789012345" })),
    ).toThrow(/credential/i);
  });
});

describe("pre-call-persistence: pure validation", () => {
  it("passes for valid input", () => {
    const res = validatePreCallPersistence(makeValidInput());
    expect(res.ok).toBe(true);
  });

  it("rejects empty prompt", () => {
    const res = validatePreCallPersistence(makeValidInput({ prompt: "   " }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.some((e) => e.field === "prompt")).toBe(true);
  });

  it("rejects fewer than 2 enabled slots", () => {
    const res = validatePreCallPersistence(
      makeValidInput({
        slots: [{ ...VALID_SLOTS[0], enabled: true }, { ...VALID_SLOTS[1], enabled: false }],
      }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.some((e) => e.field === "slots")).toBe(true);
  });

  it("rejects invalid mode", () => {
    const res = validatePreCallPersistence(makeValidInput({ mode: "invalid" as never }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.some((e) => e.field === "mode")).toBe(true);
  });

  it("validates canonical task binding", () => {
    const validCanonical = validatePreCallPersistence(
      makeValidInput({ taskBinding: { kind: "canonical", taskId: "task-42", taskVersion: 1 } }),
    );
    expect(validCanonical.ok).toBe(true);

    const invalidVersion = validatePreCallPersistence(
      makeValidInput({ taskBinding: { kind: "canonical", taskId: "task-42", taskVersion: 0 } }),
    );
    expect(invalidVersion.ok).toBe(false);

    const invalidId = validatePreCallPersistence(
      makeValidInput({ taskBinding: { kind: "canonical", taskId: "sk-live-secret", taskVersion: 1 } }),
    );
    expect(invalidId.ok).toBe(false);
  });

  it("validates ad_hoc task binding", () => {
    const validAdHoc = validatePreCallPersistence(
      makeValidInput({ taskBinding: { kind: "ad_hoc", inputSnapshotRef: `snap:sha256:${"a".repeat(64)}` } }),
    );
    expect(validAdHoc.ok).toBe(true);

    const credentialRef = validatePreCallPersistence(
      makeValidInput({ taskBinding: { kind: "ad_hoc", inputSnapshotRef: "Bearer token" } }),
    );
    expect(credentialRef.ok).toBe(false);
  });
});

describe("pre-call-persistence: plan builder", () => {
  it("builds an ad_hoc persistence plan by default", () => {
    const input = makeValidInput();
    const plan = buildPreCallPersistencePlan(input, { now: () => 1000 });

    expect(plan.resolvedBinding.kind).toBe("ad_hoc");
    expect(plan.resolvedBinding).toEqual({
      kind: "ad_hoc",
      inputSnapshotRef: plan.snapshot.inputSnapshotRef,
    });
    expect(plan.candidateInstance).toBeNull();
    expect(plan.envelopeOptions.taskInstanceId).toBeNull();
    expect(plan.envelopeOptions.repeatedFrom).toBeNull();
    expect(plan.beginRunInput.mode).toBe("rank");
    expect(plan.beginRunInput.task.prompt).toBe(input.prompt);
  });

  it("builds a canonical persistence plan when task is bound", () => {
    const input = makeValidInput({
      taskBinding: { kind: "canonical", taskId: "task-42", taskVersion: 1 },
      repeatedFrom: "cmp-prev-99",
    });
    const plan = buildPreCallPersistencePlan(input, { now: () => 1000 });

    expect(plan.resolvedBinding).toEqual({
      kind: "canonical",
      taskId: "task-42",
      taskVersion: 1,
    });
    expect(plan.candidateInstance).not.toBeNull();
    expect(plan.candidateInstance?.taskId).toBe("task-42");
    expect(plan.candidateInstance?.taskVersion).toBe(1);
    expect(plan.envelopeOptions.repeatedFrom).toBe("cmp-prev-99");
  });
});

describe("pre-call-persistence: atomic execution and failure boundaries (spec §5)", () => {
  let harness: MockDepsHarness;

  beforeEach(() => {
    harness = makeMockDeps();
  });

  it("Boundary 1: validation failure aborts before run creation (zero provider calls)", async () => {
    const input = makeValidInput({ prompt: "" }); // invalid prompt
    await expect(executePreCallPersistence(harness.deps, input)).rejects.toThrow(/prompt/i);

    // No run created in recorder
    expect(harness.spies.recorderBegin).not.toHaveBeenCalled();
    // No comparison index created
    expect(harness.spies.createComparisonEnvelope).not.toHaveBeenCalled();
  });

  it("Boundary 2: run creation failure aborts before index creation (zero provider calls)", async () => {
    harness.spies.recorderBegin.mockRejectedValueOnce(new StorageError("blocked", "Disk locked"));
    const input = makeValidInput();

    await expect(executePreCallPersistence(harness.deps, input)).rejects.toThrow(/Disk locked/i);

    expect(harness.spies.recorderBegin).toHaveBeenCalledTimes(1);
    expect(harness.spies.createComparisonEnvelope).not.toHaveBeenCalled();
  });

  it("Boundary 3: canonical Task version lookup failure compensates and aborts before envelope creation", async () => {
    const input = makeValidInput({
      taskBinding: { kind: "canonical", taskId: "task-42", taskVersion: 99 }, // version 99 does not exist
    });

    await expect(executePreCallPersistence(harness.deps, input)).rejects.toThrow(/Task version.*not found/i);

    // Run was created
    expect(harness.spies.recorderBegin).toHaveBeenCalledTimes(1);
    // Compensation occurred: run marked aborted
    expect(harness.spies.recorderMarkAborted).toHaveBeenCalledTimes(1);
    // Envelope creation was NOT attempted
    expect(harness.spies.createComparisonEnvelope).not.toHaveBeenCalled();
  });

  it("Boundary 4: canonical Task instance creation failure compensates and aborts before envelope creation", async () => {
    harness.spies.getOrCreateTaskInstance.mockRejectedValueOnce(
      new StorageError("quota", "Task instance storage quota exceeded"),
    );
    const input = makeValidInput({
      taskBinding: { kind: "canonical", taskId: "task-42", taskVersion: 1 },
    });

    await expect(executePreCallPersistence(harness.deps, input)).rejects.toThrow(/quota/i);

    // Run was created
    expect(harness.spies.recorderBegin).toHaveBeenCalledTimes(1);
    // Compensation occurred: run marked aborted
    expect(harness.spies.recorderMarkAborted).toHaveBeenCalledTimes(1);
    // Envelope was NOT created
    expect(harness.spies.createComparisonEnvelope).not.toHaveBeenCalled();
  });

  it("Boundary 5: comparison envelope creation failure compensates and aborts before execution", async () => {
    harness.spies.createComparisonEnvelope.mockRejectedValueOnce(
      new StorageError("conflict", "ComparisonResultIndex conflict"),
    );
    const input = makeValidInput();

    await expect(executePreCallPersistence(harness.deps, input)).rejects.toThrow(/conflict/i);

    expect(harness.spies.recorderBegin).toHaveBeenCalledTimes(1);
    expect(harness.spies.createComparisonEnvelope).toHaveBeenCalledTimes(1);
    // Compensation occurred: run marked aborted
    expect(harness.spies.recorderMarkAborted).toHaveBeenCalledTimes(1);
  });

  it("Success path: ad_hoc comparison creates RunRecordV2 and ComparisonResultIndex atomically", async () => {
    const input = makeValidInput();
    const result = await executePreCallPersistence(harness.deps, input);

    expect(result.ok).toBe(true);
    expect(result.runId).toBe("run-100");
    expect(result.taskBinding.kind).toBe("ad_hoc");
    expect(result.taskBinding).toEqual({
      kind: "ad_hoc",
      inputSnapshotRef: result.snapshot.inputSnapshotRef,
    });
    expect(result.taskInstanceId).toBeNull();
    expect(harness.spies.recorderBegin).toHaveBeenCalledTimes(1);
    expect(harness.spies.createComparisonEnvelope).toHaveBeenCalledTimes(1);
    expect(harness.spies.recorderMarkAborted).not.toHaveBeenCalled();
  });

  it("Success path: canonical comparison resolves version, creates TaskInstance, and creates envelope", async () => {
    const input = makeValidInput({
      taskBinding: { kind: "canonical", taskId: "task-42", taskVersion: 1 },
    });
    const result = await executePreCallPersistence(harness.deps, input);

    expect(result.ok).toBe(true);
    expect(result.runId).toBe("run-100");
    expect(result.taskBinding).toEqual({
      kind: "canonical",
      taskId: "task-42",
      taskVersion: 1,
    });
    expect(result.taskInstanceId).toBe("inst-task-42-v1");
    expect(harness.spies.getTaskVersion).toHaveBeenCalledWith("task-42", 1);
    expect(harness.spies.getOrCreateTaskInstance).toHaveBeenCalledTimes(1);
    expect(harness.spies.createComparisonEnvelope).toHaveBeenCalledWith(
      expect.objectContaining({ id: "run-100" }),
      { kind: "canonical", taskId: "task-42", taskVersion: 1 },
      expect.objectContaining({ taskInstanceId: "inst-task-42-v1" }),
    );
    expect(harness.spies.recorderMarkAborted).not.toHaveBeenCalled();
  });

  it("State recoverability: a clean run succeeds after a prior failure", async () => {
    // 1st run fails on comparison envelope creation
    harness.spies.createComparisonEnvelope.mockRejectedValueOnce(
      new StorageError("unavailable", "Storage locked"),
    );
    await expect(executePreCallPersistence(harness.deps, makeValidInput())).rejects.toThrow(/Storage locked/i);
    expect(harness.spies.recorderMarkAborted).toHaveBeenCalledTimes(1);

    // 2nd run succeeds cleanly
    const result = await executePreCallPersistence(harness.deps, makeValidInput());
    expect(result.ok).toBe(true);
    expect(result.runId).toBe("run-100");
    expect(result.taskBinding.kind).toBe("ad_hoc");
  });
});
