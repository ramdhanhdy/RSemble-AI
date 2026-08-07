// =============================================================================
// RSemble AI — Evaluation repository tests
//
// Exercises the Dexie-backed evaluation repository: suite/profile/experiment
// CRUD, revision checks, archiving, and experiment task lifecycle.
// =============================================================================

import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RSembleEvaluationDB } from "./database";
import { InMemoryRunRepository } from "./run-repository";
import { createEvaluationRepository, InMemoryEvaluationRepository } from "./evaluation-repository";
import type {
  EvaluationProfile,
  EvaluationSuite,
  ExperimentRecord,
  ProfileRecord,
} from "../evaluations/evaluation-types";
import { validateSuiteForExecution } from "../evaluations/suite-validation";
import type { FullRunSummaryV2, RunRecordV2 } from "./run-types";

// --- Valid baselines ----------------------------------------------------------

function makeProfile(id: string, version = 1): EvaluationProfile {
  return {
    id,
    version,
    name: `Profile ${id}`,
    description: "test",
    judgeInstruction: "judge fairly",
    criteria: [
      {
        id: "c1",
        name: "Quality",
        description: "Overall quality",
        weight: 1,
        anchors: { one: "bad", three: "ok", five: "great" },
      },
    ],
    createdAt: 1000,
    updatedAt: 1000,
  };
}

function makeProfileRecord(id: string): ProfileRecord {
  return {
    id,
    revision: 0,
    latestVersion: 1,
    createdAt: 1000,
    updatedAt: 1000,
    archivedAt: null,
  };
}

function makeSuite(id: string, revision = 0): EvaluationSuite {
  return {
    id,
    revision,
    version: 1,
    name: `Suite ${id}`,
    description: "test suite",
    tasks: [
      {
        id: "task-1",
        title: "Task 1",
        prompt: "Do something",
        systemPrompt: "",
        evaluation: { kind: "holistic" },
        judgeInstructionOverride: "",
        order: 0,
      },
    ],
    modelSlots: [
      {
        id: "s1",
        providerId: "openrouter",
        provider: "OpenRouter",
        model: "m1",
        slug: "m1",
        enabled: true,
      },
      {
        id: "s2",
        providerId: "gemini",
        provider: "Gemini",
        model: "m2",
        slug: "m2",
        enabled: true,
      },
    ],
    defaultJudge: { providerId: "openrouter", model: "judge" },
    defaultEvaluation: { kind: "holistic" },
    createdAt: 1000,
    updatedAt: 1000,
    archivedAt: null,
  };
}

function makeExperiment(id: string, suiteId: string): ExperimentRecord {
  return {
    id,
    revision: 0,
    suiteId,
    suiteVersion: 1,
    protocolFingerprint: "sha256:abc",
    status: "queued",
    execution: null,
    snapshot: {
      suiteId,
      suiteVersion: 1,
      tasks: makeSuite(suiteId).tasks,
      modelSlots: makeSuite(suiteId).modelSlots,
      defaultJudge: { providerId: "openrouter", model: "judge" },
      defaultEvaluation: { kind: "holistic" },
      profiles: [],
      protocolFingerprint: "sha256:abc",
      createdAt: 1000,
    },
    tasks: [
      {
        taskId: "task-1",
        selectedAttemptId: null,
        attempts: [],
      },
    ],
    createdAt: 1000,
    updatedAt: 1000,
  };
}

function makeRun(id: string): RunRecordV2 {
  return {
    schemaVersion: 2,
    id,
    revision: 0,
    execution: { ownerId: "owner", fence: 1 },
    createdAt: 1000,
    updatedAt: 1000,
    completedAt: null,
    status: "running",
    mode: "rank",
    source: {
      kind: "experiment",
      experimentId: "exp-1",
      suiteId: "suite-1",
      suiteVersion: 1,
      protocolFingerprint: "sha256:abc",
      taskId: "task-1",
      experimentTaskAttemptId: "att-1",
      trial: 0,
    },
    task: { title: "Task 1", prompt: "Do something", systemPrompt: "", temperature: 0.7 },
    evaluation: { profile: null, candidateMessages: [] },
    candidates: [],
    judge: { status: "idle", acceptedAttemptId: null, report: null, consensus: null, attempts: [] },
    fusion: { status: "idle", acceptedAttemptId: null, attempts: [] },
    winnerKeys: [],
  };
}

function makeSummary(id: string): FullRunSummaryV2 {
  return {
    kind: "full",
    schemaVersion: 2,
    id,
    revision: 0,
    createdAt: 1000,
    completedAt: null,
    status: "running",
    mode: "rank",
    source: {
      kind: "experiment",
      experimentId: "exp-1",
      suiteId: "suite-1",
      suiteVersion: 1,
      protocolFingerprint: "sha256:abc",
      taskId: "task-1",
      experimentTaskAttemptId: "att-1",
      trial: 0,
    },
    taskTitle: "Task 1",
    taskExcerpt: "Do something",
    modelKeys: ["openrouter:m1", "gemini:m2"],
    winnerKeys: [],
    scoresByModelKey: {},
    judgeModelKey: "openrouter:judge",
    evaluationProfileId: null,
    evaluationProfileVersion: null,
    detailAvailable: true,
    searchText: "task 1 openrouter:m1 gemini:m2",
  };
}

// --- Tests --------------------------------------------------------------------

describe("EvaluationRepository (Dexie-backed)", () => {
  let db: RSembleEvaluationDB;
  let runRepo: InMemoryRunRepository;
  let evalRepo: ReturnType<typeof createEvaluationRepository>;

  beforeEach(() => {
    db = new RSembleEvaluationDB("test-eval-" + Math.random().toString(36).slice(2));
    runRepo = new InMemoryRunRepository();
    evalRepo = createEvaluationRepository(db, runRepo);
  });

  afterEach(async () => {
    db.close();
  });

  describe("Suite CRUD", () => {
    it("saves and retrieves a suite", async () => {
      const suite = makeSuite("s1");
      const rev = await evalRepo.saveSuite(suite, 0);
      expect(rev).toBe(1);
      const retrieved = await evalRepo.getSuite("s1");
      expect(retrieved).not.toBeNull();
      expect(retrieved!.name).toBe("Suite s1");
      expect(retrieved!.revision).toBe(1);
    });

    it("rejects stale revision on save", async () => {
      await evalRepo.saveSuite(makeSuite("s1"), 0);
      await expect(evalRepo.saveSuite(makeSuite("s1"), 0)).rejects.toThrow(/stale/i);
    });

    it("persists a non-executable draft and reads it back (execution is gated separately)", async () => {
      const draft: EvaluationSuite = { ...makeSuite("draft"), tasks: [], modelSlots: [] };
      await evalRepo.saveSuite(draft, 0);
      const retrieved = await evalRepo.getSuite("draft");
      expect(retrieved).not.toBeNull();
      expect(retrieved!.tasks).toHaveLength(0);
      const listed = await evalRepo.listSuites();
      expect(listed.some((s) => s.id === "draft")).toBe(true);
      // The draft is not runnable — that decision belongs to the execution gate.
      expect(validateSuiteForExecution(retrieved!).valid).toBe(false);
    });

    it("still rejects structurally invalid records", async () => {
      const bad = makeSuite("bad");
      (bad.tasks[0] as unknown as Record<string, unknown>).order = "zero";
      await expect(evalRepo.saveSuite(bad, 0)).rejects.toThrow(/invalid suite/i);
    });

    it("listSuites returns newest first and hides archived by default", async () => {
      await evalRepo.saveSuite(makeSuite("s1"), 0);
      await evalRepo.archiveSuite("s1");
      await evalRepo.saveSuite(makeSuite("s2"), 0);
      const suites = await evalRepo.listSuites();
      expect(suites).toHaveLength(1);
      expect(suites[0].id).toBe("s2");
      const all = await evalRepo.listSuites(true);
      expect(all).toHaveLength(2);
    });
  });

  describe("Profile CRUD", () => {
    it("creates a profile with version 1 and retrieves it", async () => {
      await evalRepo.createProfile(makeProfileRecord("p1"), makeProfile("p1"));
      const record = await evalRepo.getProfileRecord("p1");
      expect(record).not.toBeNull();
      expect(record!.latestVersion).toBe(1);
      const profile = await evalRepo.getProfile("p1", 1);
      expect(profile).not.toBeNull();
      expect(profile!.version).toBe(1);
    });

    it("appends a new version and advances latestVersion", async () => {
      await evalRepo.createProfile(makeProfileRecord("p1"), makeProfile("p1"));
      const rev = await evalRepo.appendProfileVersion(
        makeProfileRecord("p1"),
        makeProfile("p1", 2),
        0,
      );
      expect(rev).toBe(1);
      const record = await evalRepo.getProfileRecord("p1");
      expect(record!.latestVersion).toBe(2);
      const v1 = await evalRepo.getProfile("p1", 1);
      const v2 = await evalRepo.getProfile("p1", 2);
      expect(v1).not.toBeNull();
      expect(v2).not.toBeNull();
    });

    it("archive/restore mutates only ProfileRecord, not versions", async () => {
      await evalRepo.createProfile(makeProfileRecord("p1"), makeProfile("p1"));
      await evalRepo.setProfileArchived("p1", true, 0);
      const record = await evalRepo.getProfileRecord("p1");
      expect(record!.archivedAt).not.toBeNull();
      // Version is still retrievable.
      const profile = await evalRepo.getProfile("p1", 1);
      expect(profile).not.toBeNull();
      // No new version was created.
      expect(record!.latestVersion).toBe(1);
      // Archived profile is hidden from listProfiles by default.
      const visible = await evalRepo.listProfiles();
      expect(visible).toHaveLength(0);
      const all = await evalRepo.listProfiles(true);
      expect(all).toHaveLength(1);
    });

    it("rejects stale revision on appendProfileVersion", async () => {
      await evalRepo.createProfile(makeProfileRecord("p1"), makeProfile("p1"));
      await expect(
        evalRepo.appendProfileVersion(makeProfileRecord("p1"), makeProfile("p1", 2), 99),
      ).rejects.toThrow(/stale/i);
    });
  });

  describe("Experiment CRUD", () => {
    it("creates and retrieves an experiment", async () => {
      await evalRepo.saveSuite(makeSuite("s1"), 0);
      await evalRepo.createExperiment(makeExperiment("e1", "s1"));
      const exp = await evalRepo.getExperiment("e1");
      expect(exp).not.toBeNull();
      expect(exp!.suiteId).toBe("s1");
    });

    it("listExperiments filters by suiteId", async () => {
      await evalRepo.saveSuite(makeSuite("s1"), 0);
      await evalRepo.saveSuite(makeSuite("s2"), 0);
      await evalRepo.createExperiment(makeExperiment("e1", "s1"));
      await evalRepo.createExperiment(makeExperiment("e2", "s2"));
      const s1Exps = await evalRepo.listExperiments("s1");
      expect(s1Exps).toHaveLength(1);
      expect(s1Exps[0].id).toBe("e1");
    });

    it("updateExperiment rejects stale revision", async () => {
      await evalRepo.saveSuite(makeSuite("s1"), 0);
      const exp = makeExperiment("e1", "s1");
      await evalRepo.createExperiment(exp);
      await expect(evalRepo.updateExperiment(exp, 99)).rejects.toThrow(/stale/i);
    });
  });

  describe("Experiment task lifecycle", () => {
    it("beginExperimentTask atomically creates run and transitions attempt to running", async () => {
      await evalRepo.saveSuite(makeSuite("s1"), 0);
      await evalRepo.createExperiment(makeExperiment("e1", "s1"));
      const run = makeRun("r1");
      const summary = makeSummary("r1");
      const result = await evalRepo.beginExperimentTask({
        experimentId: "e1",
        taskId: "task-1",
        attemptId: "att-1",
        run,
        summary,
        expectedExperimentRevision: 0,
      });
      expect(result.experimentRevision).toBe(1);
      const exp = await evalRepo.getExperiment("e1");
      const task = exp!.tasks.find((t) => t.taskId === "task-1");
      expect(task!.attempts).toHaveLength(1);
      expect(task!.attempts[0].status).toBe("running");
      expect(task!.attempts[0].runId).toBe("r1");
    });

    it("commitExperimentTaskTerminal finalizes attempt and recomputes selectedAttemptId", async () => {
      await evalRepo.saveSuite(makeSuite("s1"), 0);
      await evalRepo.createExperiment(makeExperiment("e1", "s1"));
      const run = makeRun("r1");
      const summary = makeSummary("r1");
      await evalRepo.beginExperimentTask({
        experimentId: "e1",
        taskId: "task-1",
        attemptId: "att-1",
        run,
        summary,
        expectedExperimentRevision: 0,
      });
      const terminalRun: RunRecordV2 = { ...run, status: "completed", completedAt: 2000 };
      const terminalSummary: FullRunSummaryV2 = {
        ...summary,
        status: "completed",
        completedAt: 2000,
      };
      const result = await evalRepo.commitExperimentTaskTerminal({
        experimentId: "e1",
        taskId: "task-1",
        attemptId: "att-1",
        run: terminalRun,
        summary: terminalSummary,
        expectedRunRevision: 0,
        expectedExperimentRevision: 1,
      });
      expect(result.runRevision).toBe(1);
      expect(result.experimentRevision).toBe(2);
      const exp = await evalRepo.getExperiment("e1");
      const task = exp!.tasks.find((t) => t.taskId === "task-1");
      expect(task!.attempts[0].status).toBe("completed");
      expect(task!.selectedAttemptId).toBe("att-1");
    });

    it("re-committing an identical terminal payload is idempotent; conflicting reuse is rejected", async () => {
      await evalRepo.saveSuite(makeSuite("s1"), 0);
      await evalRepo.createExperiment(makeExperiment("e1", "s1"));
      const run = makeRun("r1");
      const summary = makeSummary("r1");
      await evalRepo.beginExperimentTask({
        experimentId: "e1",
        taskId: "task-1",
        attemptId: "att-1",
        run,
        summary,
        expectedExperimentRevision: 0,
      });
      const terminalRun: RunRecordV2 = { ...run, status: "completed", completedAt: 2000 };
      const terminalSummary: FullRunSummaryV2 = {
        ...summary,
        status: "completed",
        completedAt: 2000,
      };
      const first = await evalRepo.commitExperimentTaskTerminal({
        experimentId: "e1",
        taskId: "task-1",
        attemptId: "att-1",
        run: terminalRun,
        summary: terminalSummary,
        expectedRunRevision: 0,
        expectedExperimentRevision: 1,
      });
      // Idempotent replay with the identical IDs/payload returns current
      // revisions without another write (spec §11.3).
      const second = await evalRepo.commitExperimentTaskTerminal({
        experimentId: "e1",
        taskId: "task-1",
        attemptId: "att-1",
        run: terminalRun,
        summary: terminalSummary,
        expectedRunRevision: 0,
        expectedExperimentRevision: 1,
      });
      expect(second).toEqual(first);

      // Conflicting reuse of the terminal attempt ID is still rejected.
      const conflictingRun: RunRecordV2 = { ...run, status: "failed", completedAt: 2000 };
      const conflictingSummary: FullRunSummaryV2 = {
        ...summary,
        status: "failed",
        completedAt: 2000,
      };
      await expect(
        evalRepo.commitExperimentTaskTerminal({
          experimentId: "e1",
          taskId: "task-1",
          attemptId: "att-1",
          run: conflictingRun,
          summary: conflictingSummary,
          expectedRunRevision: 1,
          expectedExperimentRevision: 2,
        }),
      ).rejects.toThrow(/terminal|conflict|already/i);
    });
  });
});

describe("EvaluationRepository (In-memory)", () => {
  let evalRepo: InMemoryEvaluationRepository;

  beforeEach(() => {
    evalRepo = new InMemoryEvaluationRepository();
  });

  it("suite round-trip with revision check", async () => {
    const rev = await evalRepo.saveSuite(makeSuite("s1"), 0);
    expect(rev).toBe(1);
    const retrieved = await evalRepo.getSuite("s1");
    expect(retrieved!.revision).toBe(1);
    await expect(evalRepo.saveSuite(makeSuite("s1"), 0)).rejects.toThrow(/stale/i);
  });

  it("profile create + append version + archive", async () => {
    await evalRepo.createProfile(makeProfileRecord("p1"), makeProfile("p1"));
    await evalRepo.appendProfileVersion(makeProfileRecord("p1"), makeProfile("p1", 2), 0);
    const record = await evalRepo.getProfileRecord("p1");
    expect(record!.latestVersion).toBe(2);
    await evalRepo.setProfileArchived("p1", true, 1);
    const visible = await evalRepo.listProfiles();
    expect(visible).toHaveLength(0);
  });

  it("profile version immutability: prior versions remain retrievable after append", async () => {
    await evalRepo.createProfile(makeProfileRecord("p1"), makeProfile("p1", 1));
    await evalRepo.appendProfileVersion(makeProfileRecord("p1"), makeProfile("p1", 2), 0);
    await evalRepo.appendProfileVersion(makeProfileRecord("p1"), makeProfile("p1", 3), 1);
    const v1 = await evalRepo.getProfile("p1", 1);
    const v2 = await evalRepo.getProfile("p1", 2);
    const v3 = await evalRepo.getProfile("p1", 3);
    expect(v1).not.toBeNull();
    expect(v2).not.toBeNull();
    expect(v3).not.toBeNull();
    expect(v1!.version).toBe(1);
    expect(v3!.version).toBe(3);
  });

  it("archive/restore does not create a new profile version", async () => {
    await evalRepo.createProfile(makeProfileRecord("p1"), makeProfile("p1", 1));
    await evalRepo.setProfileArchived("p1", true, 0);
    const record = await evalRepo.getProfileRecord("p1");
    expect(record!.latestVersion).toBe(1);
    expect(record!.archivedAt).not.toBeNull();
    await evalRepo.setProfileArchived("p1", false, 1);
    const restored = await evalRepo.getProfileRecord("p1");
    expect(restored!.latestVersion).toBe(1);
    expect(restored!.archivedAt).toBeNull();
  });

  it("persists a non-executable draft, matching the Dexie contract", async () => {
    const draft: EvaluationSuite = { ...makeSuite("draft"), tasks: [], modelSlots: [] };
    await evalRepo.saveSuite(draft, 0);
    expect((await evalRepo.getSuite("draft"))!.tasks).toHaveLength(0);
    const bad = makeSuite("bad");
    (bad.tasks[0] as unknown as Record<string, unknown>).order = "zero";
    await expect(evalRepo.saveSuite(bad, 0)).rejects.toThrow(/invalid suite/i);
  });
});
