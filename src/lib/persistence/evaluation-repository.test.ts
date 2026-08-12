// =============================================================================
// RSemble AI — Evaluation repository tests
//
// Exercises the Dexie-backed and in-memory evaluation repositories through the
// canonical Rubric repository API (listRubrics, getRubricRecord,
// getRubricVersion, createRubric, appendRubricVersion, archiveRubric,
// restoreRubric, duplicateRubric) plus suite/experiment CRUD, revision checks,
// archiving, and the experiment task lifecycle. Also verifies that manually
// seeded legacy `profiles` / `profileVersions` rows load through the canonical
// API, and that the deprecated `*Profile*` adapter methods forward correctly.
// =============================================================================

import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RSembleEvaluationDB } from "./database";
import { InMemoryRunRepository } from "./run-repository";
import {
  createEvaluationRepository,
  InMemoryEvaluationRepository,
  type EvaluationRepository,
} from "./evaluation-repository";
import type {
  EvaluationRubric,
  EvaluationSuite,
  ExperimentRecord,
  RubricRecord,
} from "../evaluations/evaluation-types";
import { validateSuiteForExecution } from "../evaluations/suite-validation";
import type { FullRunSummaryV2, RunRecordV2 } from "./run-types";

// --- Valid baselines ----------------------------------------------------------

function makeRubric(id: string, version = 1): EvaluationRubric {
  return {
    id,
    version,
    name: `Rubric ${id}`,
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

function makeRubricRecord(id: string): RubricRecord {
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
  let evalRepo: EvaluationRepository;

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

  describe("Rubric repository API", () => {
    it("creates a rubric with version 1 and retrieves it", async () => {
      await evalRepo.createRubric(makeRubricRecord("r1"), makeRubric("r1"));
      const record = await evalRepo.getRubricRecord("r1");
      expect(record).not.toBeNull();
      expect(record!.latestVersion).toBe(1);
      const rubric = await evalRepo.getRubricVersion("r1", 1);
      expect(rubric).not.toBeNull();
      expect(rubric!.version).toBe(1);
    });

    it("rejects creating a rubric whose first version is not 1", async () => {
      await expect(
        evalRepo.createRubric(makeRubricRecord("r1"), makeRubric("r1", 2)),
      ).rejects.toThrow(/first version/i);
    });

    it("rejects creating a rubric when the id already exists", async () => {
      await evalRepo.createRubric(makeRubricRecord("r1"), makeRubric("r1"));
      await expect(evalRepo.createRubric(makeRubricRecord("r1"), makeRubric("r1"))).rejects.toThrow(
        /already exists/i,
      );
    });

    it("appends a new version and advances latestVersion", async () => {
      await evalRepo.createRubric(makeRubricRecord("r1"), makeRubric("r1"));
      const rev = await evalRepo.appendRubricVersion(
        makeRubricRecord("r1"),
        makeRubric("r1", 2),
        0,
      );
      expect(rev).toBe(1);
      const record = await evalRepo.getRubricRecord("r1");
      expect(record!.latestVersion).toBe(2);
      const v1 = await evalRepo.getRubricVersion("r1", 1);
      const v2 = await evalRepo.getRubricVersion("r1", 2);
      expect(v1).not.toBeNull();
      expect(v2).not.toBeNull();
    });

    it("rejects stale revision on appendRubricVersion (CAS)", async () => {
      await evalRepo.createRubric(makeRubricRecord("r1"), makeRubric("r1"));
      await expect(
        evalRepo.appendRubricVersion(makeRubricRecord("r1"), makeRubric("r1", 2), 99),
      ).rejects.toThrow(/stale/i);
    });

    it("immutable history: prior versions remain retrievable after append", async () => {
      await evalRepo.createRubric(makeRubricRecord("r1"), makeRubric("r1", 1));
      await evalRepo.appendRubricVersion(makeRubricRecord("r1"), makeRubric("r1", 2), 0);
      await evalRepo.appendRubricVersion(makeRubricRecord("r1"), makeRubric("r1", 3), 1);
      const v1 = await evalRepo.getRubricVersion("r1", 1);
      const v2 = await evalRepo.getRubricVersion("r1", 2);
      const v3 = await evalRepo.getRubricVersion("r1", 3);
      expect(v1).not.toBeNull();
      expect(v2).not.toBeNull();
      expect(v3).not.toBeNull();
      expect(v1!.version).toBe(1);
      expect(v3!.version).toBe(3);
    });

    it("archival cycle: archive then restore clears archivedAt without a new version", async () => {
      await evalRepo.createRubric(makeRubricRecord("r1"), makeRubric("r1"));
      const archiveRev = await evalRepo.archiveRubric("r1", 0);
      expect(archiveRev).toBe(1);
      const archived = await evalRepo.getRubricRecord("r1");
      expect(archived!.archivedAt).not.toBeNull();
      expect(archived!.latestVersion).toBe(1);
      // Version is still retrievable while archived.
      const rubric = await evalRepo.getRubricVersion("r1", 1);
      expect(rubric).not.toBeNull();
      // Archived rubric is hidden from listRubrics by default.
      const visible = await evalRepo.listRubrics();
      expect(visible).toHaveLength(0);
      const all = await evalRepo.listRubrics(true);
      expect(all).toHaveLength(1);
      // Restore clears archivedAt.
      const restoreRev = await evalRepo.restoreRubric("r1", 1);
      expect(restoreRev).toBe(2);
      const restored = await evalRepo.getRubricRecord("r1");
      expect(restored!.archivedAt).toBeNull();
      expect(restored!.latestVersion).toBe(1);
      const visibleAfter = await evalRepo.listRubrics();
      expect(visibleAfter).toHaveLength(1);
    });

    it("archiveRubric rejects stale revision", async () => {
      await evalRepo.createRubric(makeRubricRecord("r1"), makeRubric("r1"));
      await expect(evalRepo.archiveRubric("r1", 99)).rejects.toThrow(/stale/i);
    });

    it("restoreRubric rejects stale revision", async () => {
      await evalRepo.createRubric(makeRubricRecord("r1"), makeRubric("r1"));
      await evalRepo.archiveRubric("r1", 0);
      await expect(evalRepo.restoreRubric("r1", 99)).rejects.toThrow(/stale/i);
    });

    it("duplicateRubric creates a new identity with version 1 and copied content", async () => {
      await evalRepo.createRubric(makeRubricRecord("r1"), makeRubric("r1"));
      // Append a second version so we verify duplicate copies the latest.
      await evalRepo.appendRubricVersion(
        { ...makeRubricRecord("r1"), latestVersion: 2 },
        { ...makeRubric("r1", 2), name: "Rubric r1 v2" },
        0,
      );
      await evalRepo.duplicateRubric("r1", "r2");
      const newRecord = await evalRepo.getRubricRecord("r2");
      expect(newRecord).not.toBeNull();
      expect(newRecord!.latestVersion).toBe(1);
      expect(newRecord!.archivedAt).toBeNull();
      const newRubric = await evalRepo.getRubricVersion("r2", 1);
      expect(newRubric).not.toBeNull();
      expect(newRubric!.version).toBe(1);
      // Content copied from the source's latest version (v2).
      expect(newRubric!.name).toBe("Rubric r1 v2");
      // The new identity is independent — appending to it does not affect the source.
      await evalRepo.appendRubricVersion(
        { ...makeRubricRecord("r2"), latestVersion: 1 },
        makeRubric("r2", 2),
        0,
      );
      const sourceRecord = await evalRepo.getRubricRecord("r1");
      expect(sourceRecord!.latestVersion).toBe(2);
      const dupRecord = await evalRepo.getRubricRecord("r2");
      expect(dupRecord!.latestVersion).toBe(2);
    });

    it("duplicateRubric rejects an unknown source id", async () => {
      await expect(evalRepo.duplicateRubric("missing", "r2")).rejects.toThrow(/not found/i);
    });

    it("duplicateRubric rejects when the new id already exists", async () => {
      await evalRepo.createRubric(makeRubricRecord("r1"), makeRubric("r1"));
      await evalRepo.createRubric(makeRubricRecord("r2"), makeRubric("r2"));
      await expect(evalRepo.duplicateRubric("r1", "r2")).rejects.toThrow(/already exists/i);
    });

    it("listRubrics returns newest first and hides archived by default", async () => {
      await evalRepo.createRubric(makeRubricRecord("r1"), makeRubric("r1"));
      await evalRepo.archiveRubric("r1", 0);
      await evalRepo.createRubric(makeRubricRecord("r2"), makeRubric("r2"));
      const visible = await evalRepo.listRubrics();
      expect(visible).toHaveLength(1);
      expect(visible[0].id).toBe("r2");
      const all = await evalRepo.listRubrics(true);
      expect(all).toHaveLength(2);
    });

    it("loads a manually seeded legacy profile/profileVersion row via canonical API", async () => {
      // Seed the physical `profiles` / `profileVersions` stores directly,
      // simulating a row written by the pre-canonical code path. The canonical
      // API must read it without migration or copies.
      const legacyRecord: RubricRecord = {
        id: "legacy-1",
        revision: 3,
        latestVersion: 2,
        createdAt: 500,
        updatedAt: 900,
        archivedAt: null,
      };
      const legacyV1: EvaluationRubric = {
        ...makeRubric("legacy-1", 1),
        name: "Legacy v1",
        createdAt: 500,
        updatedAt: 600,
      };
      const legacyV2: EvaluationRubric = {
        ...makeRubric("legacy-1", 2),
        name: "Legacy v2",
        createdAt: 700,
        updatedAt: 900,
      };
      await db.profiles.put({
        id: "legacy-1",
        record: legacyRecord,
        revision: legacyRecord.revision,
        latestVersion: legacyRecord.latestVersion,
        updatedAt: legacyRecord.updatedAt,
        archivedAt: legacyRecord.archivedAt,
      });
      await db.profileVersions.put({
        id: "legacy-1",
        version: 1,
        profile: legacyV1,
        updatedAt: legacyV1.updatedAt,
      });
      await db.profileVersions.put({
        id: "legacy-1",
        version: 2,
        profile: legacyV2,
        updatedAt: legacyV2.updatedAt,
      });

      // Canonical reads.
      const record = await evalRepo.getRubricRecord("legacy-1");
      expect(record).not.toBeNull();
      expect(record!.revision).toBe(3);
      expect(record!.latestVersion).toBe(2);
      const v1 = await evalRepo.getRubricVersion("legacy-1", 1);
      const v2 = await evalRepo.getRubricVersion("legacy-1", 2);
      expect(v1).not.toBeNull();
      expect(v1!.name).toBe("Legacy v1");
      expect(v2).not.toBeNull();
      expect(v2!.name).toBe("Legacy v2");
      const listed = await evalRepo.listRubrics();
      expect(listed.some((r) => r.id === "legacy-1")).toBe(true);
      // Append a new version over the legacy row using CAS at revision 3.
      const rev = await evalRepo.appendRubricVersion(
        { ...legacyRecord, latestVersion: 2 },
        makeRubric("legacy-1", 3),
        3,
      );
      expect(rev).toBe(4);
      const after = await evalRepo.getRubricRecord("legacy-1");
      expect(after!.latestVersion).toBe(3);
      expect(after!.revision).toBe(4);
      // Prior legacy versions are still immutable and retrievable.
      expect((await evalRepo.getRubricVersion("legacy-1", 1))!.name).toBe("Legacy v1");
    });
  });

  describe("Deprecated Profile adapter surface", () => {
    it("listProfiles forwards to listRubrics", async () => {
      await evalRepo.createRubric(makeRubricRecord("r1"), makeRubric("r1"));
      const viaLegacy = await evalRepo.listProfiles();
      const viaCanonical = await evalRepo.listRubrics();
      expect(viaLegacy).toEqual(viaCanonical);
      expect(viaLegacy[0].id).toBe("r1");
    });

    it("getProfileRecord / getProfile forward to canonical getters", async () => {
      await evalRepo.createRubric(makeRubricRecord("r1"), makeRubric("r1"));
      const record = await evalRepo.getProfileRecord("r1");
      expect(record).toEqual(await evalRepo.getRubricRecord("r1"));
      const rubric = await evalRepo.getProfile("r1", 1);
      expect(rubric).toEqual(await evalRepo.getRubricVersion("r1", 1));
    });

    it("createProfile / appendProfileVersion forward to canonical writers", async () => {
      await evalRepo.createProfile(makeRubricRecord("r1"), makeRubric("r1"));
      const rev = await evalRepo.appendProfileVersion(
        makeRubricRecord("r1"),
        makeRubric("r1", 2),
        0,
      );
      expect(rev).toBe(1);
      const record = await evalRepo.getRubricRecord("r1");
      expect(record!.latestVersion).toBe(2);
    });

    it("setProfileArchived forwards to archiveRubric / restoreRubric", async () => {
      await evalRepo.createRubric(makeRubricRecord("r1"), makeRubric("r1"));
      await evalRepo.setProfileArchived("r1", true, 0);
      expect((await evalRepo.getRubricRecord("r1"))!.archivedAt).not.toBeNull();
      await evalRepo.setProfileArchived("r1", false, 1);
      expect((await evalRepo.getRubricRecord("r1"))!.archivedAt).toBeNull();
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

  describe("Rubric repository API", () => {
    it("creates a rubric with version 1 and retrieves it", async () => {
      await evalRepo.createRubric(makeRubricRecord("r1"), makeRubric("r1"));
      const record = await evalRepo.getRubricRecord("r1");
      expect(record).not.toBeNull();
      expect(record!.latestVersion).toBe(1);
      const rubric = await evalRepo.getRubricVersion("r1", 1);
      expect(rubric).not.toBeNull();
      expect(rubric!.version).toBe(1);
    });

    it("rubric create + append version + archival cycle", async () => {
      await evalRepo.createRubric(makeRubricRecord("r1"), makeRubric("r1"));
      await evalRepo.appendRubricVersion(makeRubricRecord("r1"), makeRubric("r1", 2), 0);
      const record = await evalRepo.getRubricRecord("r1");
      expect(record!.latestVersion).toBe(2);
      await evalRepo.archiveRubric("r1", 1);
      const visible = await evalRepo.listRubrics();
      expect(visible).toHaveLength(0);
      await evalRepo.restoreRubric("r1", 2);
      const restored = await evalRepo.getRubricRecord("r1");
      expect(restored!.archivedAt).toBeNull();
      const visibleAfter = await evalRepo.listRubrics();
      expect(visibleAfter).toHaveLength(1);
    });

    it("rubric version immutability: prior versions remain retrievable after append", async () => {
      await evalRepo.createRubric(makeRubricRecord("r1"), makeRubric("r1", 1));
      await evalRepo.appendRubricVersion(makeRubricRecord("r1"), makeRubric("r1", 2), 0);
      await evalRepo.appendRubricVersion(makeRubricRecord("r1"), makeRubric("r1", 3), 1);
      const v1 = await evalRepo.getRubricVersion("r1", 1);
      const v2 = await evalRepo.getRubricVersion("r1", 2);
      const v3 = await evalRepo.getRubricVersion("r1", 3);
      expect(v1).not.toBeNull();
      expect(v2).not.toBeNull();
      expect(v3).not.toBeNull();
      expect(v1!.version).toBe(1);
      expect(v3!.version).toBe(3);
    });

    it("archive/restore does not create a new rubric version", async () => {
      await evalRepo.createRubric(makeRubricRecord("r1"), makeRubric("r1", 1));
      await evalRepo.archiveRubric("r1", 0);
      const record = await evalRepo.getRubricRecord("r1");
      expect(record!.latestVersion).toBe(1);
      expect(record!.archivedAt).not.toBeNull();
      await evalRepo.restoreRubric("r1", 1);
      const restored = await evalRepo.getRubricRecord("r1");
      expect(restored!.latestVersion).toBe(1);
      expect(restored!.archivedAt).toBeNull();
    });

    it("rejects stale revision on appendRubricVersion (CAS)", async () => {
      await evalRepo.createRubric(makeRubricRecord("r1"), makeRubric("r1"));
      await expect(
        evalRepo.appendRubricVersion(makeRubricRecord("r1"), makeRubric("r1", 2), 99),
      ).rejects.toThrow(/stale/i);
    });

    it("duplicateRubric creates a new identity with copied content", async () => {
      await evalRepo.createRubric(makeRubricRecord("r1"), makeRubric("r1"));
      await evalRepo.duplicateRubric("r1", "r2");
      const newRecord = await evalRepo.getRubricRecord("r2");
      expect(newRecord).not.toBeNull();
      expect(newRecord!.latestVersion).toBe(1);
      const newRubric = await evalRepo.getRubricVersion("r2", 1);
      expect(newRubric).not.toBeNull();
      expect(newRubric!.version).toBe(1);
      expect(newRubric!.name).toBe("Rubric r1");
    });

    it("duplicateRubric rejects an unknown source id", async () => {
      await expect(evalRepo.duplicateRubric("missing", "r2")).rejects.toThrow(/not found/i);
    });

    it("duplicateRubric rejects when the new id already exists", async () => {
      await evalRepo.createRubric(makeRubricRecord("r1"), makeRubric("r1"));
      await evalRepo.createRubric(makeRubricRecord("r2"), makeRubric("r2"));
      await expect(evalRepo.duplicateRubric("r1", "r2")).rejects.toThrow(/already exists/i);
    });
  });

  describe("Deprecated Profile adapter surface", () => {
    it("legacy methods forward to canonical Rubric methods", async () => {
      await evalRepo.createProfile(makeRubricRecord("r1"), makeRubric("r1"));
      await evalRepo.appendProfileVersion(makeRubricRecord("r1"), makeRubric("r1", 2), 0);
      expect((await evalRepo.getProfileRecord("r1"))!.latestVersion).toBe(2);
      await evalRepo.setProfileArchived("r1", true, 1);
      expect(await evalRepo.listProfiles()).toHaveLength(0);
      await evalRepo.setProfileArchived("r1", false, 2);
      expect(await evalRepo.listProfiles()).toHaveLength(1);
      // Canonical and legacy reads agree.
      expect(await evalRepo.getProfile("r1", 1)).toEqual(await evalRepo.getRubricVersion("r1", 1));
    });
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
