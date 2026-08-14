// =============================================================================
// RSemble AI — Workbench archive tests (plan 8.1, spec §13/§18/§20)
//
// Covers export completeness, allowlisted construction, centralized import
// limits, skip/conflict/rollback import semantics, run Markdown export from the
// persisted record, and classified failure guidance. Child 02 Task 10C adds
// the preview-first, collision-safe, cancellation-safe, atomic v1/v2 import:
// preview classifies every entity (create/reuse/collision) BEFORE any write,
// invalid/corrupt archives are committed as preview "invalid" entities rather
// than aborting the read-only preview, any non-identical ID collision aborts
// commit before writes, and injected failure/quota/cancellation leaves source
// and target unchanged.
// =============================================================================

import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RSembleEvaluationDB,
  StorageError,
  type ExperimentRow,
  type ProfileRow,
  type ProfileVersionRow,
  type RunDetailRow,
  type RunSummaryRow,
  type SuiteRow,
} from "./database";
import { createRunRepository } from "./run-repository";
import {
  ArchiveImportCancelledError,
  archiveFailureGuidance,
  ArchiveExportCancelledError,
  buildRunExportMarkdown,
  commitPreviewWorkbenchArchiveV2,
  exportWorkbenchArchive,
  exportWorkbenchArchiveV2,
  IMPORT_LIMITS,
  importWorkbenchArchive,
  importWorkbenchArchiveAuto,
  parseWorkbenchArchive,
  previewWorkbenchArchive,
  validateArchiveBytes,
  type ArchiveExportProgress,
  type WorkbenchArchiveV1,
} from "./archive";
import {
  computeArchiveV2PayloadDigest,
  validateArchiveV2,
  type WorkbenchArchiveV2,
} from "./archive-v2-types";
import * as fx from "./archive-v2-fixtures";
import type { FullRunSummaryV2, LegacyRunSummary, RunRecordV2, RunSummary } from "./run-types";
import type {
  EvaluationRubric,
  EvaluationSuite,
  ExperimentRecord,
  RubricRecord,
} from "../evaluations/evaluation-types";

// --- Valid baselines ----------------------------------------------------------

function makeRun(id: string, prompt = "Do something"): RunRecordV2 {
  return {
    schemaVersion: 2,
    id,
    revision: 1,
    execution: { ownerId: "owner", fence: 1 },
    createdAt: 1000,
    updatedAt: 1000,
    completedAt: 2000,
    status: "completed",
    mode: "rank",
    source: { kind: "adhoc" },
    task: { title: `Task ${id}`, prompt, systemPrompt: "", temperature: 0.7 },
    evaluation: { profile: null, candidateMessages: [] },
    candidates: [
      {
        candidateId: "c-1",
        slotId: "s-1",
        modelKey: "openrouter:foo",
        providerId: "openrouter",
        model: "Foo",
        slug: "foo",
        acceptedAttemptId: "att-1",
        attempts: [
          {
            attemptId: "att-1",
            messages: [{ role: "user", content: prompt }],
            startedAt: 1000,
            finishedAt: 2000,
            status: "completed",
            output: `Answer for ${id}`,
            tokensIn: 10,
            tokensOut: 20,
            error: null,
          },
        ],
      },
    ],
    judge: { status: "idle", acceptedAttemptId: null, report: null, consensus: null, attempts: [] },
    fusion: { status: "idle", acceptedAttemptId: null, attempts: [] },
    winnerKeys: ["openrouter:foo"],
  };
}

function makeFullSummary(id: string): FullRunSummaryV2 {
  return {
    kind: "full",
    schemaVersion: 2,
    id,
    revision: 1,
    createdAt: 1000,
    completedAt: 2000,
    status: "completed",
    mode: "rank",
    source: { kind: "adhoc" },
    taskTitle: `Task ${id}`,
    taskExcerpt: "excerpt",
    modelKeys: ["openrouter:foo"],
    winnerKeys: ["openrouter:foo"],
    scoresByModelKey: { "openrouter:foo": 4 },
    judgeModelKey: null,
    evaluationProfileId: null,
    evaluationProfileVersion: null,
    detailAvailable: true,
    searchText: "excerpt",
  };
}

function makeLegacySummary(id: string): LegacyRunSummary {
  return {
    kind: "legacy",
    schemaVersion: "1-import",
    id,
    createdAt: 1000,
    taskExcerpt: "legacy excerpt",
    modelKeys: ["openrouter:foo"],
    winnerKeys: ["openrouter:foo"],
    scoresByModelKey: { "openrouter:foo": 3 },
    detailAvailable: false,
    searchText: "legacy excerpt",
  };
}

function makeRubric(id: string, version = 1, name = `Rubric ${id}`): EvaluationRubric {
  return {
    id,
    version,
    name,
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
    revision: 1,
    latestVersion: 1,
    createdAt: 1000,
    updatedAt: 1000,
    archivedAt: null,
  };
}

function makeSuite(id: string, name = `Suite ${id}`): EvaluationSuite {
  return {
    id,
    revision: 1,
    version: 1,
    name,
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
  const suite = makeSuite(suiteId);
  return {
    id,
    revision: 1,
    suiteId,
    suiteVersion: 1,
    protocolFingerprint: "sha256:abc",
    status: "queued",
    execution: null,
    snapshot: {
      suiteId,
      suiteVersion: 1,
      tasks: suite.tasks,
      modelSlots: suite.modelSlots,
      defaultJudge: suite.defaultJudge,
      defaultEvaluation: suite.defaultEvaluation,
      profiles: [],
      protocolFingerprint: "sha256:abc",
      createdAt: 1000,
    },
    tasks: [{ taskId: "task-1", selectedAttemptId: null, attempts: [] }],
    createdAt: 1000,
    updatedAt: 1000,
  };
}

// --- Row builders (mirror repository row mapping) ------------------------------

function summaryRow(summary: RunSummary): RunSummaryRow {
  const full = summary.kind === "full" ? summary : null;
  return {
    kind: summary.kind,
    summary,
    id: summary.id,
    revision: full ? full.revision : 0,
    createdAt: summary.createdAt,
    completedAt: full ? full.completedAt : null,
    status: full ? full.status : null,
    mode: full ? full.mode : null,
    sourceKind: "adhoc",
    sourceProtocolFingerprint: null,
    sourceExperimentTaskAttemptId: null,
    modelKeys: summary.modelKeys,
  };
}

function detailRow(record: RunRecordV2): RunDetailRow {
  return {
    id: record.id,
    record,
    revision: record.revision,
    createdAt: record.createdAt,
    status: record.status,
  };
}

function profileRow(record: RubricRecord): ProfileRow {
  return {
    id: record.id,
    record,
    revision: record.revision,
    latestVersion: record.latestVersion,
    updatedAt: record.updatedAt,
    archivedAt: record.archivedAt,
  };
}

function profileVersionRow(rubric: EvaluationRubric): ProfileVersionRow {
  return { id: rubric.id, version: rubric.version, profile: rubric, updatedAt: rubric.updatedAt };
}

function suiteRow(suite: EvaluationSuite): SuiteRow {
  return {
    id: suite.id,
    suite,
    revision: suite.revision,
    version: suite.version,
    updatedAt: suite.updatedAt,
    archivedAt: suite.archivedAt,
  };
}

function experimentRow(experiment: ExperimentRecord): ExperimentRow {
  return {
    id: experiment.id,
    experiment,
    revision: experiment.revision,
    suiteId: experiment.suiteId,
    suiteVersion: experiment.suiteVersion,
    protocolFingerprint: experiment.protocolFingerprint,
    createdAt: experiment.createdAt,
    status: experiment.status,
  };
}

function emptyArchive(): WorkbenchArchiveV1 {
  return {
    schemaVersion: 1,
    exportedAt: 1000,
    runs: { summaries: [], details: [] },
    profiles: { identities: [], versions: [] },
    suites: [],
    experiments: [],
  };
}

function populatedArchive(): WorkbenchArchiveV1 {
  const archive = emptyArchive();
  archive.runs.summaries.push(makeFullSummary("run-1"), makeLegacySummary("legacy-1"));
  archive.runs.details.push(makeRun("run-1"));
  archive.profiles.identities.push(makeRubricRecord("prof-1"));
  archive.profiles.versions.push(makeRubric("prof-1"));
  archive.suites.push(makeSuite("suite-1"));
  archive.experiments.push(makeExperiment("exp-1", "suite-1"));
  return archive;
}

// --- Dexie setup ---------------------------------------------------------------

let db: RSembleEvaluationDB;

beforeEach(async () => {
  db = new RSembleEvaluationDB("test-archive-" + Math.random());
  await db.open();
});

afterEach(async () => {
  db.close();
  await db.delete();
});

// --- 1. Export completeness ----------------------------------------------------

describe("exportWorkbenchArchive", () => {
  it("includes schema version, summaries, details, profiles: rubrics, suites, and experiments", async () => {
    await db.runSummaries.put(summaryRow(makeFullSummary("run-1")));
    await db.runSummaries.put(summaryRow(makeLegacySummary("legacy-1")));
    await db.runDetails.put(detailRow(makeRun("run-1")));
    await db.profiles.put(profileRow(makeRubricRecord("prof-1")));
    await db.profileVersions.put(profileVersionRow(makeRubric("prof-1")));
    await db.profileVersions.put(profileVersionRow(makeRubric("prof-1", 2)));
    await db.suites.put(suiteRow(makeSuite("suite-1")));
    await db.experiments.put(experimentRow(makeExperiment("exp-1", "suite-1")));

    const archive = await exportWorkbenchArchive(db);

    expect(archive.schemaVersion).toBe(1);
    expect(typeof archive.exportedAt).toBe("number");
    expect(archive.runs.summaries.map((s) => s.id).sort()).toEqual(["legacy-1", "run-1"]);
    expect(archive.runs.details.map((r) => r.id)).toEqual(["run-1"]);
    expect(archive.profiles.identities.map((p) => p.id)).toEqual(["prof-1"]);
    expect(archive.profiles.versions.map((p) => p.version).sort()).toEqual([1, 2]);
    expect(archive.suites.map((s) => s.id)).toEqual(["suite-1"]);
    expect(archive.experiments.map((e) => e.id)).toEqual(["exp-1"]);

    // The export itself satisfies the import validator (round-trip shape).
    const check = parseWorkbenchArchive(JSON.parse(JSON.stringify(archive)));
    expect(check.ok).toBe(true);
  });

  it("excludes guard-failing rows and keeps ordinary prose about tokens/passwords", async () => {
    const prosePrompt =
      "Explain the token bucket algorithm and why a password manager keeps a secret.";
    await db.runDetails.put(detailRow(makeRun("run-good", prosePrompt)));
    // Smuggled credential key — written directly, bypassing repository validation.
    const smuggled = makeRun("run-bad") as unknown as Record<string, unknown>;
    smuggled.authorization = "super-secret-credential-value";
    await db.runDetails.put({
      id: "run-bad",
      record: smuggled,
      revision: 1,
      createdAt: 1000,
      status: "completed",
    });

    const archive = await exportWorkbenchArchive(db);
    expect(archive.runs.details.map((r) => r.id)).toEqual(["run-good"]);

    // Ordinary prose round-trips through parse.
    const proseCheck = parseWorkbenchArchive(JSON.parse(JSON.stringify(archive)));
    expect(proseCheck.ok).toBe(true);

    // The smuggled record fails at import validation and the error redacts the
    // credential value while naming the offending key.
    const bad = emptyArchive();
    bad.runs.details.push(smuggled as unknown as RunRecordV2);
    const badCheck = parseWorkbenchArchive(JSON.parse(JSON.stringify(bad)));
    expect(badCheck.ok).toBe(false);
    if (!badCheck.ok) {
      const joined = badCheck.errors.join("\n");
      expect(joined).toContain("authorization");
      expect(joined).toContain("[REDACTED]");
      expect(joined).not.toContain("super-secret-credential-value");
    }
  });
});

// --- 3. Centralized limits ------------------------------------------------------

describe("IMPORT_LIMITS constants", () => {
  it("pins the v1 limit values from spec §18", () => {
    expect(IMPORT_LIMITS.ARCHIVE_BYTES).toBe(268435456);
    expect(IMPORT_LIMITS.RUN_SUMMARIES).toBe(25000);
    expect(IMPORT_LIMITS.RUN_DETAILS).toBe(25000);
    expect(IMPORT_LIMITS.RUBRIC_IDENTITIES).toBe(5000);
    expect(IMPORT_LIMITS.RUBRIC_REVISIONS).toBe(10000);
    expect(IMPORT_LIMITS.SUITES).toBe(5000);
    expect(IMPORT_LIMITS.EXPERIMENTS).toBe(25000);
    expect(IMPORT_LIMITS.STRING_BYTES).toBe(8388608);
    expect(IMPORT_LIMITS.DEPTH).toBe(32);
    expect(IMPORT_LIMITS.ID_PATTERN.test("abc-DEF_123.x:y")).toBe(true);
    expect(IMPORT_LIMITS.ID_PATTERN.test("")).toBe(false);
    expect(IMPORT_LIMITS.ID_PATTERN.test("a".repeat(129))).toBe(false);
    expect(IMPORT_LIMITS.ID_PATTERN.test("bad id!")).toBe(false);
  });
});

describe("validateArchiveBytes", () => {
  it("rejects files over 256 MiB before decoding", () => {
    expect(validateArchiveBytes(268435457)).not.toBeNull();
    expect(validateArchiveBytes(268435456)).toBeNull();
    expect(validateArchiveBytes(10)).toBeNull();
  });
});

describe("parseWorkbenchArchive limits", () => {
  it("rejects a non-1 schema version and non-record input", () => {
    expect(parseWorkbenchArchive(null).ok).toBe(false);
    expect(parseWorkbenchArchive({ schemaVersion: 2 }).ok).toBe(false);
    const wrongVersion = parseWorkbenchArchive({ ...emptyArchive(), schemaVersion: 2 });
    expect(wrongVersion.ok).toBe(false);
    if (!wrongVersion.ok) {
      expect(wrongVersion.errors.join(" ")).toMatch(/schema/i);
    }
  });

  it("accepts a well-formed empty archive", () => {
    const check = parseWorkbenchArchive(emptyArchive());
    expect(check.ok).toBe(true);
  });

  it("rejects more than 25,000 run summaries", () => {
    const archive = emptyArchive() as unknown as {
      runs: { summaries: LegacyRunSummary[]; details: RunRecordV2[] };
    };
    for (let i = 0; i < IMPORT_LIMITS.RUN_SUMMARIES + 1; i++) {
      archive.runs.summaries.push(makeLegacySummary(`legacy-${i}`));
    }
    const check = parseWorkbenchArchive(archive);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.errors.join(" ")).toMatch(/summar/i);
    }
  });

  it("rejects more than 5,000 suites", () => {
    const archive = emptyArchive();
    for (let i = 0; i < IMPORT_LIMITS.SUITES + 1; i++) {
      archive.suites.push(makeSuite(`suite-${i}`));
    }
    const check = parseWorkbenchArchive(archive);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.errors.join(" ")).toMatch(/suite/i);
    }
  });

  it("rejects a string over 8 MiB UTF-8", () => {
    const archive = emptyArchive();
    archive.runs.details.push(makeRun("run-big", "a".repeat(IMPORT_LIMITS.STRING_BYTES + 1)));
    const check = parseWorkbenchArchive(archive);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.errors.join(" ")).toMatch(/string|8 MiB/i);
    }
  });

  it("rejects nesting deeper than 32 levels", () => {
    let deep: Record<string, unknown> = { leaf: "x" };
    for (let i = 0; i < 40; i++) deep = { nested: deep };
    const archive = emptyArchive() as unknown as Record<string, unknown>;
    (archive.runs as Record<string, unknown>).summaries = [
      { ...makeLegacySummary("legacy-1"), extra: deep },
    ];
    const check = parseWorkbenchArchive(archive);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.errors.join(" ")).toMatch(/depth/i);
    }
  });

  it("rejects unsafe record IDs", () => {
    for (const badId of ["", "a".repeat(129), "bad id!"]) {
      const archive = emptyArchive();
      archive.suites.push(makeSuite(badId));
      const check = parseWorkbenchArchive(archive);
      expect(check.ok).toBe(false);
      if (!check.ok) {
        expect(check.errors.join(" ")).toMatch(/id/i);
      }
    }
  });
});

// --- 4/5/6. Import semantics ----------------------------------------------------

describe("importWorkbenchArchive", () => {
  it("creates all records into an empty database", async () => {
    const result = await importWorkbenchArchive(db, populatedArchive());
    expect(result.created.sort()).toEqual([
      "exp-1",
      "legacy-1",
      "prof-1",
      "prof-1@1",
      "run-1",
      "suite-1",
    ]);
    expect(result.skipped).toEqual([]);
    expect(result.conflicting).toEqual([]);
    expect(await db.runDetails.count()).toBe(1);
    expect(await db.runSummaries.count()).toBe(2);
    expect(await db.profiles.count()).toBe(1);
    expect(await db.profileVersions.count()).toBe(1);
    expect(await db.suites.count()).toBe(1);
    expect(await db.experiments.count()).toBe(1);
  });

  it("skips identical IDs/content on a second import", async () => {
    await importWorkbenchArchive(db, populatedArchive());
    const second = await importWorkbenchArchive(db, populatedArchive());
    expect(second.created).toEqual([]);
    expect(second.conflicting).toEqual([]);
    expect(second.skipped.sort()).toEqual([
      "exp-1",
      "legacy-1",
      "prof-1",
      "prof-1@1",
      "run-1",
      "suite-1",
    ]);
  });

  it("reports conflicting same-ID content and does NOT overwrite it", async () => {
    await importWorkbenchArchive(db, populatedArchive());
    const changed = emptyArchive();
    changed.suites.push(makeSuite("suite-1", "Renamed suite"));
    const result = await importWorkbenchArchive(db, changed);
    expect(result.conflicting).toEqual(["suite-1"]);
    expect(result.created).toEqual([]);
    const row = await db.suites.get("suite-1");
    expect((row?.suite as EvaluationSuite).name).toBe("Suite suite-1");
  });

  it("conflicts at the profileVersions [id+version] composite key", async () => {
    await importWorkbenchArchive(db, populatedArchive());
    const changed = emptyArchive();
    changed.profiles.versions.push(makeRubric("prof-1", 1, "Renamed rubric"));
    const result = await importWorkbenchArchive(db, changed);
    expect(result.conflicting).toEqual(["prof-1@1"]);
    const row = await db.profileVersions.get(["prof-1", 1]);
    expect((row?.profile as EvaluationRubric).name).toBe("Rubric prof-1");
  });

  it("writes nothing when a record in a multi-record archive is corrupt", async () => {
    const archive = populatedArchive();
    (archive.suites[0] as unknown as Record<string, unknown>).apiKey = "leak";
    await expect(importWorkbenchArchive(db, archive)).rejects.toBeInstanceOf(StorageError);
    expect(await db.runDetails.count()).toBe(0);
    expect(await db.runSummaries.count()).toBe(0);
    expect(await db.suites.count()).toBe(0);
    expect(await db.experiments.count()).toBe(0);
  });

  it("rolls back earlier writes when the transaction fails mid-import", async () => {
    vi.spyOn(db.suites, "put").mockRejectedValueOnce(new Error("boom"));
    await expect(importWorkbenchArchive(db, populatedArchive())).rejects.toBeTruthy();
    expect(await db.runDetails.count()).toBe(0);
    expect(await db.runSummaries.count()).toBe(0);
    expect(await db.suites.count()).toBe(0);
    expect(await db.experiments.count()).toBe(0);
  });
});

// --- 6.5 Accounting provenance round-trip --------------------------------------

describe("archive accounting provenance", () => {
  it("round-trips usage, cost, pricing, and reasoning fields; old v2 stays readable", async () => {
    const rich = makeRun("run-accounting");
    rich.candidates[0].attempts[0].usage = {
      inputTokens: 12,
      outputTokens: 34,
      reasoningTokens: 5,
      cacheReadTokens: 2,
      cacheWriteTokens: null,
    };
    rich.candidates[0].attempts[0].cost = {
      usd: 0.000456,
      source: "provider-reported",
    };
    rich.judge = {
      status: "done",
      acceptedAttemptId: "j-1",
      report: {
        labelMap: [{ label: "A", candidateId: "c-1" }],
        evaluationsById: {
          "c-1": {
            candidateId: "c-1",
            blindLabel: "A",
            overallScore: 4,
            position: "p",
            rationale: "r",
            strengths: [],
            deductions: [],
            missedRequirements: [],
            criterionScores: [],
          },
        },
        comparisons: [],
      },
      consensus: null,
      attempts: [
        {
          attemptId: "j-1",
          providerId: "openrouter",
          model: "judge",
          instruction: "",
          messages: [],
          blindLabelToCandidateId: { A: "c-1" },
          candidateAttemptIdsByCandidateId: { "c-1": "att-1" },
          startedAt: 1000,
          finishedAt: 2000,
          status: "completed",
          error: null,
          report: null,
          consensus: null,
          usage: {
            inputTokens: 40,
            outputTokens: 10,
            reasoningTokens: null,
            cacheReadTokens: null,
            cacheWriteTokens: null,
          },
          cost: { usd: 0.0002, source: "catalog-estimate" },
        },
      ],
    };
    rich.reasoning = {
      candidates: {
        "openrouter:foo": { requested: "high", effective: "high", source: "catalog" },
      },
      judge: { requested: "medium", effective: "high", source: "provider-docs" },
    };

    await db.runSummaries.put(summaryRow(makeFullSummary("run-accounting")));
    await db.runDetails.put(detailRow(rich));

    const archive = await exportWorkbenchArchive(db);
    const check = parseWorkbenchArchive(JSON.parse(JSON.stringify(archive)));
    expect(check.ok).toBe(true);
    const restored = archive.runs.details.find((r) => r.id === "run-accounting")!;
    expect(restored.candidates[0].attempts[0].usage).toEqual(rich.candidates[0].attempts[0].usage);
    expect(restored.candidates[0].attempts[0].cost).toEqual(rich.candidates[0].attempts[0].cost);
    expect(restored.judge.attempts[0].cost).toEqual(rich.judge.attempts[0].cost);
    expect(restored.reasoning).toEqual(rich.reasoning);

    // Old v2 records without the new fields remain valid and readable.
    const legacy = makeRun("run-legacy");
    const legacyCheck = parseWorkbenchArchive(
      JSON.parse(
        JSON.stringify({
          ...emptyArchive(),
          runs: { summaries: [makeFullSummary("run-legacy")], details: [legacy] },
        }),
      ),
    );
    expect(legacyCheck.ok).toBe(true);
  });

  it("rejects negative or non-finite token/cost values", () => {
    const bad = makeRun("run-bad");
    bad.candidates[0].attempts[0].usage = {
      inputTokens: -1,
      outputTokens: 10,
      reasoningTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
    };
    const check = parseWorkbenchArchive(
      JSON.parse(
        JSON.stringify({
          ...emptyArchive(),
          runs: { summaries: [], details: [bad] },
        }),
      ),
    );
    expect(check.ok).toBe(false);
  });
});

// --- 7. Run Markdown export from the persisted record ---------------------------

describe("buildRunExportMarkdown", () => {
  it("is built from the record only: task, config, candidates, scores, rationale", () => {
    const record = makeRun("run-md");
    record.judge = {
      status: "done",
      acceptedAttemptId: null,
      report: {
        labelMap: [{ label: "A", candidateId: "c-1" }],
        evaluationsById: {
          "c-1": {
            candidateId: "c-1",
            blindLabel: "A",
            overallScore: 4,
            position: "Solid answer",
            rationale: "Strong coverage of the prompt",
            strengths: ["Clear structure"],
            deductions: [{ severity: "minor", reason: "Minor typos" }],
            missedRequirements: [],
            criterionScores: [],
          },
        },
        comparisons: [],
      },
      consensus: null,
      attempts: [],
    };
    record.fusion = {
      status: "done",
      acceptedAttemptId: "f-1",
      attempts: [
        {
          attemptId: "f-1",
          providerId: "openrouter",
          model: "fuse-model",
          messages: [],
          sourceJudgeAttemptId: "j-1",
          candidateAttemptIdsByCandidateId: {},
          startedAt: 1,
          finishedAt: 2,
          status: "completed",
          error: null,
          result: "Fused answer text",
        },
      ],
    };

    const md = buildRunExportMarkdown(record);
    expect(md).toContain("Task run-md");
    expect(md).toContain("Do something");
    expect(md).toContain("Answer for run-md");
    expect(md).toContain("Strong coverage of the prompt");
    expect(md).toContain("Fused answer text");
    expect(md).toContain("openrouter:foo");

    // Pure function of the record: identical input, identical output; different
    // record, different output (no ambient Compare state leaks in).
    expect(buildRunExportMarkdown(record)).toBe(md);
    const other = makeRun("run-other", "A different prompt entirely");
    expect(buildRunExportMarkdown(other)).not.toBe(md);
    expect(buildRunExportMarkdown(other)).toContain("A different prompt entirely");
  });
});

// --- 10. Classified failure guidance --------------------------------------------

describe("archiveFailureGuidance", () => {
  it("maps every StorageErrorKind to its recovery guidance", () => {
    expect(archiveFailureGuidance(new StorageError("quota", "full"))).toBe(
      "Storage is full — free space and retry the import.",
    );
    expect(archiveFailureGuidance(new StorageError("blocked", "b"))).toBe(
      "Close other RSemble tabs to finish the storage upgrade, then retry.",
    );
    expect(archiveFailureGuidance(new StorageError("versionchange", "v"))).toBe(
      "Close other RSemble tabs to finish the storage upgrade, then retry.",
    );
    expect(archiveFailureGuidance(new StorageError("unavailable", "u"))).toBe(
      "Storage is unavailable — retry; your existing data was not modified.",
    );
    expect(archiveFailureGuidance(new StorageError("validation", "bad"))).toBe(
      "The archive is invalid — nothing was imported.",
    );
    expect(archiveFailureGuidance(new StorageError("conflict", "c"))).toBe(
      "Import conflicted with existing data — review the conflicting IDs.",
    );
  });

  it("falls back for non-StorageError failures", () => {
    expect(archiveFailureGuidance(new Error("weird"))).toBe(
      "Import failed — nothing was imported.",
    );
    expect(archiveFailureGuidance("weird")).toBe("Import failed — nothing was imported.");
  });
});

// --- §18 export completeness: hybrid scoring derivation ------------------------

function makeHybridRun(
  rubric: EvaluationRubric | null,
  criterionScores: Array<{
    criterionId: string;
    label: string;
    kind: "graded" | "binary";
    score?: number;
    value?: boolean;
    rationale: string;
  }>,
  overallScore = 4,
  id = "run-hybrid",
): RunRecordV2 {
  const record = makeRun(id);
  record.evaluation.profile = rubric;
  record.judge = {
    status: "done",
    acceptedAttemptId: null,
    report: {
      labelMap: [{ label: "A", candidateId: "c-1" }],
      evaluationsById: {
        "c-1": {
          candidateId: "c-1",
          blindLabel: "A",
          overallScore,
          position: "p",
          rationale: "r",
          strengths: [],
          deductions: [],
          missedRequirements: [],
          criterionScores,
        },
      },
      comparisons: [],
    },
    consensus: null,
    attempts: [],
  };
  return record;
}

const gradedCriterion = {
  id: "quality",
  kind: "graded" as const,
  name: "Quality",
  description: "d",
  weight: 1,
  anchors: { one: "1", two: "2", three: "3", four: "4", five: "5" },
};
const binaryA = {
  id: "check-a",
  kind: "binary" as const,
  name: "Check A",
  description: "d",
  trueWhen: "yes",
  falseWhen: "no",
};
const binaryB = {
  id: "check-b",
  kind: "binary" as const,
  name: "Check B",
  description: "d",
  trueWhen: "yes",
  falseWhen: "no",
};
const mixedRubric: EvaluationRubric = {
  id: "p-mix",
  version: 1,
  name: "Mixed",
  description: "",
  judgeInstruction: "",
  criteria: [gradedCriterion, binaryA, binaryB],
  requirementGroups: [
    { id: "g1", name: "Core", checkIds: ["check-a", "check-b"], weight: 1, mode: "ALL" },
  ],
  complianceInfluence: 0.5,
  createdAt: 100,
  updatedAt: 100,
};

describe("buildRunExportMarkdown — hybrid scoring derivation (spec §18)", () => {
  it("ordinary mixed profile: Q, C, λ, rankValue, rankScore, derivation, binary PASS/FAIL", () => {
    const record = makeHybridRun(mixedRubric, [
      { criterionId: "quality", label: "Quality", kind: "graded", score: 4, rationale: "r" },
      { criterionId: "check-a", label: "Check A", kind: "binary", value: true, rationale: "r" },
      { criterionId: "check-b", label: "Check B", kind: "binary", value: true, rationale: "r" },
    ]);
    const md = buildRunExportMarkdown(record);
    // Scoring fields present.
    expect(md).toContain("Quality (Q):");
    expect(md).toContain("Compliance (C):");
    expect(md).toContain("Compliance influence (λ):");
    expect(md).toContain("Rank Value:");
    expect(md).toContain("Rank Score:");
    // Derivation formula.
    expect(md).toContain("rankValue = Q − λ·(1 − C)");
    // Binary results as PASS/FAIL, never 1/5.
    expect(md).toContain("Check A: PASS");
    expect(md).toContain("Check B: PASS");
    expect(md).not.toMatch(/Check A: [0-5]\/5/);
    // Group context on binary rows.
    expect(md).toContain("(Group: Core)");
  });

  it("uneven group weights: derivation reflects weighted compliance", () => {
    const rubric: EvaluationRubric = {
      ...mixedRubric,
      requirementGroups: [
        { id: "g1", name: "Core", checkIds: ["check-a"], weight: 2, mode: "ALL" },
        { id: "g2", name: "Extra", checkIds: ["check-b"], weight: 1, mode: "ALL" },
      ],
    };
    const record = makeHybridRun(rubric, [
      { criterionId: "quality", label: "Quality", kind: "graded", score: 3, rationale: "r" },
      { criterionId: "check-a", label: "Check A", kind: "binary", value: true, rationale: "r" },
      { criterionId: "check-b", label: "Check B", kind: "binary", value: false, rationale: "r" },
    ]);
    const md = buildRunExportMarkdown(record);
    // C = (2*1 + 1*0) / 3 = 0.667
    expect(md).toContain("rankValue = Q − λ·(1 − C)");
    expect(md).toContain("Check A: PASS");
    expect(md).toContain("Check B: FAIL");
    expect(md).toContain("(Group: Core)");
    expect(md).toContain("(Group: Extra)");
  });

  it("floored candidate: floor marker and raw rankValue shown", () => {
    // Q = 1 (valid graded score 1), C = 0 (group fails), λ = 1
    // → rv = 1 - 1*(1-0) = 0 < 1 → floored.
    const rubric: EvaluationRubric = {
      ...mixedRubric,
      complianceInfluence: 1.0,
    };
    const record = makeHybridRun(
      rubric,
      [
        { criterionId: "quality", label: "Quality", kind: "graded", score: 1, rationale: "r" },
        { criterionId: "check-a", label: "Check A", kind: "binary", value: false, rationale: "r" },
        { criterionId: "check-b", label: "Check B", kind: "binary", value: false, rationale: "r" },
      ],
      1,
    );
    const md = buildRunExportMarkdown(record);
    expect(md).toContain("(floored)");
    expect(md).toContain("Floor applied");
    expect(md).toContain("raw rankValue");
    // rankScore = max(1, 0) = 1.0, with floor marker.
    expect(md).toContain("1.0*");
  });

  it("binary group labels shown on binary criterion rows", () => {
    const record = makeHybridRun(mixedRubric, [
      { criterionId: "quality", label: "Quality", kind: "graded", score: 4, rationale: "r" },
      { criterionId: "check-a", label: "Check A", kind: "binary", value: true, rationale: "r" },
      { criterionId: "check-b", label: "Check B", kind: "binary", value: false, rationale: "r" },
    ]);
    const md = buildRunExportMarkdown(record);
    expect(md).toContain("(Group: Core)");
    expect(md).toContain("Check A: PASS");
    expect(md).toContain("Check B: FAIL");
  });

  it("legacy rubric (null): falls back to overallScore headline, no derivation", () => {
    const record = makeHybridRun(
      null,
      [{ criterionId: "quality", label: "Quality", kind: "graded", score: 4, rationale: "r" }],
      3.5,
    );
    const md = buildRunExportMarkdown(record);
    // No rubric → no scoring derivation section.
    expect(md).not.toContain("rankValue = Q");
    expect(md).not.toContain("Compliance influence (λ)");
    // Headline uses overallScore.
    expect(md).toContain("3.5/5");
    // Graded criterion still shown.
    expect(md).toContain("Quality: 4.0/5");
  });
});

// --- Archive integrity: accepted-evidence pointers -----------------------------

describe("buildRunExportMarkdown — accepted-evidence pointers", () => {
  it("uses the accepted candidate attempt only; never falls back to a rejected/historical attempt", () => {
    const record = makeRun("run-accepted");
    // acceptedAttemptId points to a missing attempt — must NOT fall back to the
    // last attempt (which here is a stale rejected output).
    record.candidates[0].acceptedAttemptId = "att-missing";
    record.candidates[0].attempts[0].attemptId = "att-rejected";
    record.candidates[0].attempts[0].status = "failed";
    record.candidates[0].attempts[0].output = null;
    record.candidates[0].attempts[0].error = { message: "provider 500", category: "provider" };

    const md = buildRunExportMarkdown(record);
    // The rejected attempt's error text and the stale output must not appear.
    expect(md).not.toContain("provider 500");
    expect(md).not.toContain("Answer for run-accepted");
    // The established no-output wording is rendered for the missing accepted pointer.
    expect(md).toContain("_No output._");
  });

  it("omits fusion usage/result when the accepted fusion attempt is missing", () => {
    const record = makeRun("run-fusion-missing");
    record.fusion.acceptedAttemptId = "f-missing";
    // A stale, non-accepted fusion attempt with a result must not be exported.
    record.fusion.attempts = [
      {
        attemptId: "f-stale",
        providerId: "openrouter",
        model: "fuse-model",
        messages: [],
        sourceJudgeAttemptId: "j-1",
        candidateAttemptIdsByCandidateId: {},
        startedAt: 1,
        finishedAt: 2,
        status: "completed",
        error: null,
        result: "STALE FUSED ANSWER",
      },
    ];

    const md = buildRunExportMarkdown(record);
    expect(md).not.toContain("STALE FUSED ANSWER");
    expect(md).not.toContain("## Fusion Usage");
    expect(md).not.toContain("## Fused Answer");
  });
});

// --- Archive integrity: malformed nested JudgeReport rejection -----------------

describe("parseWorkbenchArchive — malformed nested JudgeReport rejection", () => {
  function archiveWithJudgeReport(report: unknown): WorkbenchArchiveV1 {
    const record = makeRun("run-judge");
    // The accepted Judge attempt must exist in the attempts array with a
    // candidateAttemptIdsByCandidateId that matches the candidate's current
    // acceptedAttemptId (cross-reference validation).
    record.judge = {
      status: "done",
      acceptedAttemptId: "j-1",
      report: report as never,
      consensus: null,
      attempts: [
        {
          attemptId: "j-1",
          providerId: "openrouter",
          model: "judge",
          instruction: "",
          messages: [],
          blindLabelToCandidateId: { A: "c-1" },
          candidateAttemptIdsByCandidateId: { "c-1": "att-1" },
          startedAt: 1000,
          finishedAt: 2000,
          status: "completed",
          error: null,
          report: report as never,
          consensus: null,
        },
      ],
    };
    const archive = emptyArchive();
    archive.runs.summaries.push(makeFullSummary("run-judge"));
    archive.runs.details.push(record);
    return JSON.parse(JSON.stringify(archive)) as WorkbenchArchiveV1;
  }

  it("rejects an evaluation missing required fields (rationale)", () => {
    const archive = archiveWithJudgeReport({
      labelMap: [{ label: "A", candidateId: "c-1" }],
      evaluationsById: {
        "c-1": {
          candidateId: "c-1",
          blindLabel: "A",
          overallScore: 4,
          position: "p",
          // rationale omitted
          strengths: [],
          deductions: [],
          missedRequirements: [],
          criterionScores: [],
        },
      },
      comparisons: [],
    });
    const check = parseWorkbenchArchive(archive);
    expect(check.ok).toBe(false);
  });

  it("rejects a deduction with an invalid severity", () => {
    const archive = archiveWithJudgeReport({
      labelMap: [{ label: "A", candidateId: "c-1" }],
      evaluationsById: {
        "c-1": {
          candidateId: "c-1",
          blindLabel: "A",
          overallScore: 4,
          position: "p",
          rationale: "r",
          strengths: [],
          deductions: [{ severity: "critical", reason: "bad" }],
          missedRequirements: [],
          criterionScores: [],
        },
      },
      comparisons: [],
    });
    const check = parseWorkbenchArchive(archive);
    expect(check.ok).toBe(false);
  });

  it("rejects a criterion score with a non-numeric score", () => {
    const archive = archiveWithJudgeReport({
      labelMap: [{ label: "A", candidateId: "c-1" }],
      evaluationsById: {
        "c-1": {
          candidateId: "c-1",
          blindLabel: "A",
          overallScore: 4,
          position: "p",
          rationale: "r",
          strengths: [],
          deductions: [],
          missedRequirements: [],
          criterionScores: [
            { criterionId: "q", label: "Quality", kind: "graded", score: "high", rationale: "r" },
          ],
        },
      },
      comparisons: [],
    });
    const check = parseWorkbenchArchive(archive);
    expect(check.ok).toBe(false);
  });

  it("rejects a comparison with a non-string reason", () => {
    const archive = archiveWithJudgeReport({
      labelMap: [{ label: "A", candidateId: "c-1" }],
      evaluationsById: {
        "c-1": {
          candidateId: "c-1",
          blindLabel: "A",
          overallScore: 4,
          position: "p",
          rationale: "r",
          strengths: [],
          deductions: [],
          missedRequirements: [],
          criterionScores: [],
        },
      },
      comparisons: [{ candidateIds: ["c-1", "c-2"], blindLabels: ["A", "B"], reason: 42 }],
    });
    const check = parseWorkbenchArchive(archive);
    expect(check.ok).toBe(false);
  });

  it("rejects a consensus insight missing the insight field", () => {
    const record = makeRun("run-consensus");
    record.judge = {
      status: "done",
      acceptedAttemptId: "j-1",
      report: null,
      consensus: {
        consensus: [],
        contradictions: [],
        uniqueInsights: [{ source: "A" }] as never,
      },
      attempts: [],
    };
    const archive = emptyArchive();
    archive.runs.summaries.push(makeFullSummary("run-consensus"));
    archive.runs.details.push(record);
    const check = parseWorkbenchArchive(JSON.parse(JSON.stringify(archive)));
    expect(check.ok).toBe(false);
  });

  it("accepts a well-formed nested JudgeReport", () => {
    const archive = archiveWithJudgeReport({
      labelMap: [{ label: "A", candidateId: "c-1" }],
      evaluationsById: {
        "c-1": {
          candidateId: "c-1",
          blindLabel: "A",
          overallScore: 4,
          position: "Solid",
          rationale: "r",
          strengths: ["s"],
          deductions: [{ severity: "minor", reason: "typo" }],
          missedRequirements: [],
          criterionScores: [
            { criterionId: "q", label: "Quality", kind: "graded", score: 4, rationale: "r" },
          ],
        },
      },
      comparisons: [{ candidateIds: ["c-1", "c-2"], blindLabels: ["A", "B"], reason: "similar" }],
    });
    const check = parseWorkbenchArchive(archive);
    expect(check.ok).toBe(true);
  });
});

// --- Archive integrity: imported revision followed by a CAS update -------------

describe("importWorkbenchArchive — preserves revision for subsequent CAS update", () => {
  it("imports a record with revision > 1 and a repository update at that revision succeeds", async () => {
    const record = makeRun("run-rev");
    record.revision = 7;
    const summary = makeFullSummary("run-rev");
    summary.revision = 7;

    const archive = emptyArchive();
    archive.runs.summaries.push(summary);
    archive.runs.details.push(record);

    const result = await importWorkbenchArchive(db, archive);
    expect(result.created).toEqual(["run-rev"]);

    const detailRow = await db.runDetails.get("run-rev");
    expect(detailRow?.revision).toBe(7);
    const summaryRow = await db.runSummaries.get("run-rev");
    expect(summaryRow?.revision).toBe(7);

    // A repository update keyed to the imported revision must succeed (CAS).
    const repo = createRunRepository(db);
    const updated = { ...record, status: "failed" as const, revision: 7 };
    const updatedSummary = { ...summary, status: "failed" as const, revision: 7 };
    const newRev = await repo.update(updated, updatedSummary, 7);
    expect(newRev).toBe(8);
    const got = await repo.get("run-rev");
    expect(got?.revision).toBe(8);
    expect(got?.status).toBe("failed");
  });
});

// --- Task 10B: complete deterministic secret-safe v2 export -------------------

/** Seed every canonical Dexie store with one representative entity each (IDs
 *  ordered so deterministic-ordering assertions are meaningful). Mirrors the
 *  repository row mapping via the shared fixture builders. */
async function seedCompleteCorpus(): Promise<void> {
  const bytes = new TextEncoder().encode("candidate-visible artifact text");

  await db.runSummaries.put(fx.runSummaryRow(fx.makeRunSummary("run-1")));
  await db.runSummaries.put(fx.runSummaryRow(fx.makeRunSummary("run-2")));
  await db.runDetails.put(fx.runDetailRow(fx.makeRunDetail("run-1")));
  await db.runDetails.put(fx.runDetailRow(fx.makeRunDetail("run-2")));
  await db.profiles.put(fx.profileRow(fx.makeRubricRecord("rubric-1")));
  await db.profileVersions.put(fx.profileVersionRow(fx.makeRubricVersion("rubric-1", 1)));
  await db.suites.put(fx.suiteRow(fx.makeSuite("suite-1")));
  await db.experiments.put(fx.experimentRow(fx.makeExperiment("exp-1", "suite-1")));

  await db.fusionRecipes.put(fx.fusionRecipeRow(fx.makeRecipe("recipe-1", 1)));
  await db.poolManifests.put(fx.poolManifestRow(fx.makePoolManifest("pool-1", 1)));
  await db.fusionStudies.put(fx.fusionStudyRow(fx.makeStudy("study-1")));
  await db.fusionTrials.put(fx.fusionTrialRow(fx.makeTrial("trial-1", "study-1")));
  await db.fusionAttempts.put(fx.fusionAttemptRow(fx.makeAttempt("attempt-1", "study-1")));
  await db.fusionObservations.put(
    fx.fusionObservationRow(fx.makeObservation("obs-1", "trial-1")),
  );
  await db.fusionPlaybooks.put(fx.fusionPlaybookRow(fx.makePlaybook("playbook-1", "study-1")));

  await db.tasks.put(fx.taskRecordRow(fx.makeTaskRecord("task-1")));
  await db.taskVersions.put(fx.taskVersionRow(fx.makeTaskVersion("task-1", 1, "art-1")));
  await db.taskArtifacts.put(fx.taskArtifactRow(fx.makeTaskArtifact("art-1", bytes)));
  await db.taskArtifactBytes.put(fx.taskArtifactBytesRow("art-1", bytes));
  await db.taskInstances.put(
    fx.taskInstanceRow(fx.makeTaskInstance("inst-1", "task-1", 1, "art-1")),
  );
  await db.taskFamilies.put(fx.taskFamilyRow(fx.makeTaskFamily("fam-1")));
  await db.taskFamilyAssignments.put(
    fx.taskFamilyAssignmentRow(fx.makeTaskFamilyAssignment("fa-1", "task-1", 1, "fam-1")),
  );
  await db.taskFamilyRelations.put(
    fx.taskFamilyRelationRow(fx.makeTaskFamilyRelation("rel-1", "fam-1", "fam-1")),
  );
  await db.taskFacetAnnotations.put(
    fx.taskFacetAnnotationRow(fx.makeTaskFacetAnnotation("ann-1", "task-1")),
  );
  await db.taskMigrationCrosswalk.put(fx.taskMigrationCrosswalkRow(fx.makeCrosswalk("task-1", 1)));

  // Unrestricted storage metadata must never cross the archive boundary.
  await db.storageMeta.put({ key: "execution-lease", value: { ownerId: "owner-1" } });
}

describe("exportWorkbenchArchiveV2 — complete task-first export", () => {
  it("round-trips every canonical collection through the v2 validator", async () => {
    await seedCompleteCorpus();

    const archive = await exportWorkbenchArchiveV2(db);

    // Manifest identity.
    expect(archive.manifest.formatVersion).toBe(2);
    expect(archive.manifest.storageVersion).toBe(1);
    expect(typeof archive.manifest.exportedAt).toBe("number");
    expect(archive.manifest.producer).toBe("rsemble-ai");
    expect(archive.manifest.disclosure).toEqual({
      scope: "local",
      notes: "Local workbench export. No remote transport metadata.",
    });

    // Every entity exported — exact equality with the seeded source records.
    expect(archive.runs.summaries.map((s) => s.id)).toEqual(["run-1", "run-2"]);
    expect(archive.runs.details.map((r) => r.id)).toEqual(["run-1", "run-2"]);
    expect(archive.rubrics.identities.map((r) => r.id)).toEqual(["rubric-1"]);
    expect(archive.rubrics.versions.map((r) => r.version)).toEqual([1]);
    expect(archive.suites.map((s) => s.id)).toEqual(["suite-1"]);
    expect(archive.experiments.map((e) => e.id)).toEqual(["exp-1"]);
    expect(archive.fusion.recipes.map((r) => r.id)).toEqual(["recipe-1"]);
    expect(archive.fusion.poolManifests.map((p) => p.id)).toEqual(["pool-1"]);
    expect(archive.fusion.studies.map((s) => s.id)).toEqual(["study-1"]);
    expect(archive.fusion.trials.map((t) => t.id)).toEqual(["trial-1"]);
    expect(archive.fusion.attempts.map((a) => a.id)).toEqual(["attempt-1"]);
    expect(archive.fusion.observations.map((o) => o.id)).toEqual(["obs-1"]);
    expect(archive.fusion.playbooks.map((p) => p.id)).toEqual(["playbook-1"]);
    expect(archive.tasks.tasks.map((t) => t.id)).toEqual(["task-1"]);
    expect(archive.tasks.taskVersions.map((v) => v.version)).toEqual([1]);
    expect(archive.tasks.taskArtifacts.map((a) => a.id)).toEqual(["art-1"]);
    expect(archive.tasks.taskArtifactBytes.map((b) => b.id)).toEqual(["art-1"]);
    expect(archive.tasks.taskInstances.map((i) => i.id)).toEqual(["inst-1"]);
    expect(archive.tasks.taskFamilies.map((f) => f.id)).toEqual(["fam-1"]);
    expect(archive.tasks.taskFamilyAssignments.map((a) => a.id)).toEqual(["fa-1"]);
    expect(archive.tasks.taskFamilyRelations.map((r) => r.id)).toEqual(["rel-1"]);
    expect(archive.tasks.taskFacetAnnotations.map((a) => a.id)).toEqual(["ann-1"]);
    expect(archive.tasks.taskMigrationCrosswalks.map((c) => c.legacyScopeKey)).toEqual([
      "legacy:task-1",
    ]);

    // Source evidence is semantically unchanged: deep equality with the seeded
    // domain records, and artifact bytes decode byte-equal.
    expect(archive.tasks.tasks[0]).toEqual(fx.makeTaskRecord("task-1"));
    expect(archive.fusion.studies[0]).toEqual(fx.makeStudy("study-1"));
    const decoded = atob(archive.tasks.taskArtifactBytes[0].bytesBase64);
    expect(new TextDecoder().decode(Uint8Array.from(decoded, (c) => c.charCodeAt(0)))).toBe(
      "candidate-visible artifact text",
    );

    // The complete envelope passes the pure v2 validator end-to-end.
    const check = validateArchiveV2(JSON.parse(JSON.stringify(archive)));
    expect(check.errors).toEqual([]);
    expect(check.valid).toBe(true);

    // Fusion claim levels and artifact refs survive the round trip.
    expect(archive.fusion.studies[0].claimLevel).toBe("exploratory");
    expect(archive.fusion.playbooks[0].claimLevel).toBe("exploratory");
    expect(archive.fusion.trials[0].children.synthesisArtifact).toBeNull();
  });

  it("exports an empty workbench as a valid, count-zero v2 envelope", async () => {
    const archive = await exportWorkbenchArchiveV2(db);
    expect(Object.values(archive.manifest.counts)).toEqual(new Array(23).fill(0));
    const check = validateArchiveV2(JSON.parse(JSON.stringify(archive)));
    expect(check.valid).toBe(true);
  });

  it("carries exact per-collection counts and a recomputable integrity digest", async () => {
    await seedCompleteCorpus();
    const archive = await exportWorkbenchArchiveV2(db);

    expect(archive.manifest.counts.runSummaries).toBe(2);
    expect(archive.manifest.counts.runDetails).toBe(2);
    expect(archive.manifest.counts.rubricIdentities).toBe(1);
    expect(archive.manifest.counts.rubricVersions).toBe(1);
    expect(archive.manifest.counts.suites).toBe(1);
    expect(archive.manifest.counts.experiments).toBe(1);
    expect(archive.manifest.counts.fusionRecipes).toBe(1);
    expect(archive.manifest.counts.poolManifests).toBe(1);
    expect(archive.manifest.counts.fusionStudies).toBe(1);
    expect(archive.manifest.counts.fusionTrials).toBe(1);
    expect(archive.manifest.counts.fusionAttempts).toBe(1);
    expect(archive.manifest.counts.fusionObservations).toBe(1);
    expect(archive.manifest.counts.fusionPlaybooks).toBe(1);
    expect(archive.manifest.counts.tasks).toBe(1);
    expect(archive.manifest.counts.taskVersions).toBe(1);
    expect(archive.manifest.counts.taskArtifacts).toBe(1);
    expect(archive.manifest.counts.taskArtifactBytes).toBe(1);
    expect(archive.manifest.counts.taskInstances).toBe(1);
    expect(archive.manifest.counts.taskFamilies).toBe(1);
    expect(archive.manifest.counts.taskFamilyAssignments).toBe(1);
    expect(archive.manifest.counts.taskFamilyRelations).toBe(1);
    expect(archive.manifest.counts.taskFacetAnnotations).toBe(1);
    expect(archive.manifest.counts.taskMigrationCrosswalks).toBe(1);

    expect(archive.manifest.payloadDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(archive.manifest.payloadDigest).toBe(computeArchiveV2PayloadDigest(archive));
  });

  it("is deterministic: serialization, collection order, and digest are identical across exports", async () => {
    await seedCompleteCorpus();
    // Insert in descending ID order so only an explicit deterministic sort
    // can produce ascending output.
    await db.suites.put(fx.suiteRow(fx.makeSuite("suite-b")));
    await db.suites.put(fx.suiteRow(fx.makeSuite("suite-a")));

    const a = await exportWorkbenchArchiveV2(db, { now: () => 7777 });
    const b = await exportWorkbenchArchiveV2(db, { now: () => 7777 });

    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.manifest.payloadDigest).toBe(b.manifest.payloadDigest);
    // Descending insertion still yields deterministic ascending order.
    expect(a.suites.map((s) => s.id)).toEqual(["suite-1", "suite-a", "suite-b"]);
  });

  it("its versioned collections sort unambiguously under prefix IDs and the emitted archive self-validates (F5)", async () => {
    // Seed task versions under prefix IDs "a" and "a0" whose composite sort
    // key must separate id from version. A naive `id + paddedVersion`
    // concatenation conflates the two (naive sorts a-v1 after a0-v1 because
    // "a0..." < "a..."), so the exporter and validator must share a NUL-
    // separated composite key and the delivered envelope must clear
    // `validateArchiveV2` (self-validation determinism).
    const base = fx.makeTaskRecord("a0");
    await db.tasks.put(fx.taskRecordRow({ ...base, id: "a", latestVersion: 1 }));
    await db.tasks.put(fx.taskRecordRow({ ...base }));
    const v = fx.makeTaskVersion("_", 1, "art-1");
    await db.taskVersions.put(
      fx.taskVersionRow({ ...v, taskId: "a0", version: 1, defaultContextManifest: [] }),
    );
    await db.taskVersions.put(
      fx.taskVersionRow({ ...v, taskId: "a", version: 1, defaultContextManifest: [] }),
    );

    const archive = await exportWorkbenchArchiveV2(db);
    // Tasks: plain id sort ("a" before "a0").
    expect(archive.tasks.tasks.map((t) => t.id)).toEqual(["a", "a0"]);
    // Versions: composite NUL-separated sort → "a@1" before "a0@1".
    expect(archive.tasks.taskVersions.map((t) => t.taskId)).toEqual(["a", "a0"]);
    // The delivered envelope self-validates.
    const check = validateArchiveV2(JSON.parse(JSON.stringify(archive)));
    expect(check.errors).toEqual([]);
    expect(check.valid).toBe(true);
  });

  it("omits disposable storage metadata and never reads storageMeta", async () => {
    await seedCompleteCorpus();
    const envelope = JSON.stringify(await exportWorkbenchArchiveV2(db));
    expect(envelope).not.toContain("execution-lease");
    expect(envelope).not.toContain("owner-1");
    // No storageMeta-derived collection key exists in the envelope.
    expect(JSON.parse(envelope)).not.toHaveProperty("storageMeta");
  });

  it("aborts the export with redacted validation diagnostics when a guard-failing row is persisted, delivering no archive (F3)", async () => {
    await db.taskFamilies.put(fx.taskFamilyRow(fx.makeTaskFamily("fam-good")));
    const corrupt = fx.makeTaskFamily("fam-bad") as unknown as Record<string, unknown>;
    corrupt.apiKey = "smuggled-credential-value";
    await db.taskFamilies.put({
      id: "fam-bad",
      family: corrupt,
      parentFamilyId: null,
      updatedAt: 1000,
      archivedAt: null,
      revision: 1,
    });

    // A guard-failing/corrupt persisted row must ABORT the export (exact store
    // coverage + unsafe-content-aborts) instead of being silently filtered out
    // and the trimmed result presented as a complete archive.
    await expect(exportWorkbenchArchiveV2(db)).rejects.toMatchObject({
      name: "StorageError",
      kind: "validation",
    });
    // Nothing was delivered; the diagnostic names the entity/collection but
    // never echoes the secret-shaped value.
  });
});

describe("exportWorkbenchArchiveV2 — secret safety", () => {
  it("blocks an export whose artifact bytes carry credential-shaped material, naming the artifact without echoing the value", async () => {
    const secretBytes = new TextEncoder().encode("prefix sk-live-1234567890abcdef suffix");
    await db.tasks.put(fx.taskRecordRow(fx.makeTaskRecord("task-secret")));
    await db.taskVersions.put(
      fx.taskVersionRow(fx.makeTaskVersion("task-secret", 1, "art-secret")),
    );
    await db.taskArtifacts.put(
      fx.taskArtifactRow(fx.makeTaskArtifact("art-secret", secretBytes)),
    );
    await db.taskArtifactBytes.put(fx.taskArtifactBytesRow("art-secret", secretBytes));

    await expect(exportWorkbenchArchiveV2(db)).rejects.toMatchObject({
      name: "StorageError",
      kind: "validation",
    });
    try {
      await exportWorkbenchArchiveV2(db);
      expect.unreachable("export must be blocked");
    } catch (err) {
      const message = (err as Error).message;
      // Entity/type diagnostics: names the artifact + byte scan, never the value.
      expect(message).toContain("tasks.taskArtifactBytes");
      expect(message).toContain("art-secret");
      expect(message).not.toContain("sk-live-1234567890abcdef");
    }
  });

  it("blocks an export whose structured collection carries a credential-like value, with redacted diagnostics", async () => {
    const smuggled = fx.makeStudy("study-secret") as unknown as Record<string, unknown>;
    smuggled.conclusion = "contact: sk-live-1234567890abcdef";
    await db.fusionStudies.put({
      id: "study-secret",
      study: smuggled,
      revision: 1,
      suiteId: "suite-1",
      suiteVersion: 1,
      status: "in_progress",
      updatedAt: 1000,
    });

    try {
      await exportWorkbenchArchiveV2(db);
      expect.unreachable("export must be blocked");
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain("fusion.studies");
      expect(message).toContain("study-secret");
      expect(message).toContain("[REDACTED]");
      expect(message).not.toContain("sk-live-1234567890abcdef");
    }
  });

  it("blocks a credential-like value smuggled inside artifact metadata text", async () => {
    // Structured fields that pass their entity guard but still carry a
    // credential-shaped string must be caught by the pre-export value scan.
    const run = fx.makeRunDetail("run-secret");
    run.task.prompt = "Bearer abc123def456 is the header to use";
    await db.runDetails.put(fx.runDetailRow(run));

    try {
      await exportWorkbenchArchiveV2(db);
      expect.unreachable("export must be blocked");
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain("runs.details");
      expect(message).toContain("run-secret");
      expect(message).toContain("[REDACTED]");
      expect(message).not.toContain("Bearer abc123def456");
    }
  });
});

describe("exportWorkbenchArchiveV2 — progress and cancellation", () => {
  it("reports monotonic per-stage progress covering every collection phase", async () => {
    await seedCompleteCorpus();
    const updates: ArchiveExportProgress[] = [];
    await exportWorkbenchArchiveV2(db, {
      onProgress: (p) => updates.push({ stage: p.stage, done: p.done, total: p.total }),
    });

    expect(updates.length).toBeGreaterThan(3);
    expect(updates[0].done).toBe(0);
    expect(updates[updates.length - 1]).toEqual(
      expect.objectContaining({ stage: "finalize", done: expect.any(Number) }),
    );
    const total = updates[updates.length - 1].total;
    expect(total).toBeGreaterThan(0);
    expect(updates[updates.length - 1].done).toBe(total);
    // Monotonic completion.
    for (let i = 1; i < updates.length; i++) {
      expect(updates[i].done).toBeGreaterThanOrEqual(updates[i - 1].done);
    }
    // Every collection phase is named at least once.
    const stages = new Set(updates.map((u) => u.stage));
    for (const stage of [
      "runs",
      "rubrics",
      "suites",
      "experiments",
      "fusion",
      "tasks",
      "artifact-bytes",
      "scan",
      "finalize",
    ]) {
      expect(stages.has(stage)).toBe(true);
    }
  });

  it("cancels before delivery when the signal is aborted mid-export, delivering no archive", async () => {
    await seedCompleteCorpus();
    const controller = new AbortController();
    let sawScanStage = false;
    const attempt = exportWorkbenchArchiveV2(db, {
      signal: controller.signal,
      onProgress: (p) => {
        if (p.stage === "scan" && !sawScanStage) {
          sawScanStage = true;
          controller.abort();
        }
      },
    });
    await expect(attempt).rejects.toBeInstanceOf(ArchiveExportCancelledError);
  });

  it("rejects immediately for an already-aborted signal without reading collections", async () => {
    await seedCompleteCorpus();
    const controller = new AbortController();
    controller.abort();
    const stages: string[] = [];
    await expect(
      exportWorkbenchArchiveV2(db, {
        signal: controller.signal,
        onProgress: (p) => stages.push(p.stage),
      }),
    ).rejects.toBeInstanceOf(ArchiveExportCancelledError);
    expect(stages).toEqual([]);
  });

  it("cancellation is classified as a cancellable export failure", () => {
    expect(archiveFailureGuidance(new ArchiveExportCancelledError())).toBe(
      "Export was cancelled — no archive was delivered.",
    );
  });
});

// --- Task 10B: v1 adapter stays readable and behaviorally identical ------------

describe("v1 adapter behavior after the v1/v2 refactor", () => {
  it("v1 export still produces the schemaVersion-1 shape from the same stores", async () => {
    await seedCompleteCorpus();
    const v1 = await exportWorkbenchArchive(db);
    expect(v1.schemaVersion).toBe(1);
    expect(v1.runs.summaries.map((s) => s.id)).toEqual(["run-1", "run-2"]);
    expect(v1.runs.details.map((r) => r.id)).toEqual(["run-1", "run-2"]);
    expect(v1.profiles.identities.map((r) => r.id)).toEqual(["rubric-1"]);
    expect(v1.suites.map((s) => s.id)).toEqual(["suite-1"]);
    expect(v1.experiments.map((e) => e.id)).toEqual(["exp-1"]);
    // v1 never carries Fusion/Task collections.
    expect(Object.keys(v1).sort()).toEqual([
      "experiments",
      "exportedAt",
      "profiles",
      "runs",
      "schemaVersion",
      "suites",
    ]);
    expect(parseWorkbenchArchive(JSON.parse(JSON.stringify(v1))).ok).toBe(true);
  });
});

// --- Task 10C: preview-first, collision-safe, cancellation-safe atomic import -----

function makeEmptyV2(exportedAt = 1000): WorkbenchArchiveV2 {
  const archive = fx.buildValidArchiveV2Fixture();
  archive.manifest.exportedAt = exportedAt;
  archive.runs = { summaries: [], details: [] };
  archive.rubrics = { identities: [], versions: [] };
  archive.suites = [];
  archive.experiments = [];
  archive.fusion = {
    recipes: [],
    poolManifests: [],
    studies: [],
    trials: [],
    attempts: [],
    observations: [],
    playbooks: [],
  };
  archive.tasks = {
    tasks: [],
    taskVersions: [],
    taskArtifacts: [],
    taskArtifactBytes: [],
    taskInstances: [],
    taskFamilies: [],
    taskFamilyAssignments: [],
    taskFamilyRelations: [],
    taskFacetAnnotations: [],
    taskMigrationCrosswalks: [],
  };
  archive.manifest.counts = {
    runSummaries: 0,
    runDetails: 0,
    rubricIdentities: 0,
    rubricVersions: 0,
    suites: 0,
    experiments: 0,
    fusionRecipes: 0,
    poolManifests: 0,
    fusionStudies: 0,
    fusionTrials: 0,
    fusionAttempts: 0,
    fusionObservations: 0,
    fusionPlaybooks: 0,
    tasks: 0,
    taskVersions: 0,
    taskArtifacts: 0,
    taskArtifactBytes: 0,
    taskInstances: 0,
    taskFamilies: 0,
    taskFamilyAssignments: 0,
    taskFamilyRelations: 0,
    taskFacetAnnotations: 0,
    taskMigrationCrosswalks: 0,
  };
  archive.manifest.payloadDigest = computeArchiveV2PayloadDigest(archive);
  return archive;
}

describe("previewWorkbenchArchive — deterministic preview, no writes", () => {
  it("classifies every v2 entity as create/reuse/collision/invalid with deterministic counts and no writes", async () => {
    const artifactBytes = new TextEncoder().encode("reuse-me");
    // Pre-seed ONE canonically identical suite so the preview exercises reuse.
    await db.suites.put(fx.suiteRow(fx.makeSuite("suite-1")));

    const archive = makeEmptyV2();
    archive.runs.summaries = [fx.makeRunSummary("run-pre")];
    archive.runs.details = [fx.makeRunDetail("run-pre")];
    archive.rubrics.identities = [fx.makeRubricRecord("rubric-1")];
    archive.rubrics.versions = [fx.makeRubricVersion("rubric-1", 1)];
    archive.suites = [fx.makeSuite("suite-1")]; // canonically identical → reuse
    archive.experiments = [fx.makeExperiment("exp-1", "suite-1")];
    archive.fusion.recipes = [fx.makeRecipe("recipe-1", 1)];
    archive.fusion.poolManifests = [fx.makePoolManifest("pool-1", 1)];
    archive.fusion.studies = [fx.makeStudy("study-1")];
    archive.fusion.trials = [fx.makeTrial("trial-1", "study-1")];
    archive.fusion.attempts = [fx.makeAttempt("attempt-1", "study-1")];
    archive.fusion.observations = [fx.makeObservation("obs-1", "trial-1")];
    archive.fusion.playbooks = [fx.makePlaybook("playbook-1", "study-1")];
    archive.tasks.tasks = [fx.makeTaskRecord("task-1")];
    archive.tasks.taskVersions = [fx.makeTaskVersion("task-1", 1, "art-1")];
    archive.tasks.taskArtifacts = [fx.makeTaskArtifact("art-1", artifactBytes)];
    archive.tasks.taskArtifactBytes = [fx.makeArtifactBytes("art-1", artifactBytes)];
    archive.tasks.taskInstances = [fx.makeTaskInstance("inst-1", "task-1", 1, "art-1")];
    archive.tasks.taskFamilies = [fx.makeTaskFamily("fam-1")];
    archive.tasks.taskFamilyAssignments = [
      fx.makeTaskFamilyAssignment("fa-1", "task-1", 1, "fam-1"),
    ];
    archive.tasks.taskFamilyRelations = [fx.makeTaskFamilyRelation("rel-1", "fam-1", "fam-1")];
    archive.tasks.taskFacetAnnotations = [fx.makeTaskFacetAnnotation("ann-1", "task-1")];
    archive.tasks.taskMigrationCrosswalks = [fx.makeCrosswalk("task-1", 1)];
    archive.manifest.counts = {
      runSummaries: 1,
      runDetails: 1,
      rubricIdentities: 1,
      rubricVersions: 1,
      suites: 1,
      experiments: 1,
      fusionRecipes: 1,
      poolManifests: 1,
      fusionStudies: 1,
      fusionTrials: 1,
      fusionAttempts: 1,
      fusionObservations: 1,
      fusionPlaybooks: 1,
      tasks: 1,
      taskVersions: 1,
      taskArtifacts: 1,
      taskArtifactBytes: 1,
      taskInstances: 1,
      taskFamilies: 1,
      taskFamilyAssignments: 1,
      taskFamilyRelations: 1,
      taskFacetAnnotations: 1,
      taskMigrationCrosswalks: 1,
    };
    archive.manifest.payloadDigest = computeArchiveV2PayloadDigest(archive);

    const preview = await previewWorkbenchArchive(db, archive, { sourceLabel: "memory" });

    expect(preview.format).toBe("v2");
    // 21 importable collections carry exactly one entity.
    expect(preview.totalEntities).toBe(21);
    expect(preview.invalid.length).toBe(0);
    expect(preview.collisions.map((c) => c.key)).toEqual([]);
    // Exactly the pre-existing suite is reusable.
    expect(preview.reuse.map((e) => `${e.collection}/${e.key}`)).toEqual(["suites/suite-1"]);
    expect(preview.create.length).toBe(20);
    // One artifact is pre-materialized so the commit can verify bytes.
    expect(preview.artifactBytes.length).toBe(1);
    expect(preview.artifactBytes[0].id).toBe("art-1");
    expect([...preview.artifactBytes[0].bytes]).toEqual([...artifactBytes]);
    // Deterministic collection order + sorted counts.
    expect(preview.counts[0]).toEqual({ collection: "experiments", total: 1, create: 1, reuse: 0, collision: 0, invalid: 0 });
    expect(preview.counts.map((c) => c.collection)).toEqual([...preview.counts.map((c) => c.collection)].sort());
    expect(preview.counts.find((c) => c.collection === "suites")).toEqual({ collection: "suites", total: 1, create: 0, reuse: 1, collision: 0, invalid: 0 });
    // Preview is read-only.
    expect(await db.suites.count()).toBe(1);
    expect(await db.runDetails.count()).toBe(0);
  });

  it("reports guard-failing/corrupt entities without aborting the preview", async () => {
    const validBytes = new TextEncoder().encode("valid artifact text");
    const artifactSummary = fx.makeTaskArtifact("art-1", validBytes);

    const archive = makeEmptyV2();
    archive.runs.details = [fx.makeRunDetail("run-corrupt")];
    const detail = archive.runs.details[0] as unknown as Record<string, unknown>;
    detail.status = "not-a-real-status"; // guard-failing → invalid entity
    archive.suites = [fx.makeSuite("suite-1") as unknown as EvaluationSuite];
    delete (archive.suites[0] as unknown as Record<string, unknown>).id; // corrupt → invalid
    // A consistent artifact pair keeps the envelope validator satisfied; only
    // the corrupt structured entities exercise the preview invalid bucket.
    archive.tasks.taskArtifacts = [artifactSummary];
    archive.tasks.taskArtifactBytes = [{ id: "art-1", bytesBase64: fx.bytesToBase64(validBytes) }];
    archive.manifest.counts.runDetails = 1;
    archive.manifest.counts.suites = 1;
    archive.manifest.counts.taskArtifacts = 1;
    archive.manifest.counts.taskArtifactBytes = 1;
    archive.manifest.counts.tasks = 0;
    archive.manifest.counts.taskVersions = 0;
    archive.manifest.counts.taskInstances = 0;
    archive.manifest.counts.taskFamilies = 0;
    archive.manifest.counts.taskFamilyAssignments = 0;
    archive.manifest.counts.taskFamilyRelations = 0;
    archive.manifest.counts.taskFacetAnnotations = 0;
    archive.manifest.counts.taskMigrationCrosswalks = 0;
    archive.manifest.payloadDigest = computeArchiveV2PayloadDigest(archive);

    const preview = await previewWorkbenchArchive(db, archive, { sourceLabel: "memory" });

    expect(preview.format).toBe("v2");
    expect(preview.invalid.map((e) => `${e.collection}/${e.key}`).sort()).toEqual([
      "runs.details/run-corrupt",
      "suites/",
    ]);
    // The consistent artifact pair is still classified normally.
    expect(preview.create.map((e) => `${e.collection}/${e.key}`)).toEqual([
      "tasks.taskArtifacts/art-1",
    ]);
    expect(await db.suites.count()).toBe(0);
  });

  it("rejects a digest/byte-mismatched artifact at envelope validation before any classification", async () => {
    const validBytes = new TextEncoder().encode("valid artifact text");
    const tamperedBytes = new TextEncoder().encode("tampered artifact text");
    const archive = makeEmptyV2();
    archive.tasks.taskArtifacts = [fx.makeTaskArtifact("art-1", validBytes)];
    archive.tasks.taskArtifactBytes = [{ id: "art-1", bytesBase64: fx.bytesToBase64(tamperedBytes) }];
    archive.manifest.counts.taskArtifacts = 1;
    archive.manifest.counts.taskArtifactBytes = 1;
    archive.manifest.payloadDigest = computeArchiveV2PayloadDigest(archive);

    await expect(
      previewWorkbenchArchive(db, archive, { sourceLabel: "memory" }),
    ).rejects.toMatchObject({
      name: "StorageError",
      kind: "validation",
    });
    expect(await db.taskArtifacts.count()).toBe(0);
  });
});

describe("commitPreviewWorkbenchArchiveV2 — atomic commit, collision-safety, cancellation", () => {
  it("imports the complete fixture into an empty database atomically with exact source Run/Experiment/Fusion evidence", async () => {
    const archive = fx.buildValidArchiveV2Fixture();
    const preview = await previewWorkbenchArchive(db, archive, { sourceLabel: "memory" });
    expect(preview.format).toBe("v2");
    expect(preview.collisions).toEqual([]);
    expect(preview.invalid).toEqual([]);

    const result = await commitPreviewWorkbenchArchiveV2(db, preview);

    expect(result.created.length).toBe(preview.create.length);
    expect(result.reused).toEqual([]);
    expect(result.skipped).toEqual([]);
    // Every imported entity appears exactly once across the whole store README.
    expect(await db.runSummaries.count()).toBe(1);
    expect(await db.runDetails.count()).toBe(1);
    expect(await db.profiles.count()).toBe(1);
    expect(await db.profileVersions.count()).toBe(1);
    expect(await db.suites.count()).toBe(1);
    expect(await db.experiments.count()).toBe(1);
    expect(await db.fusionRecipes.count()).toBe(1);
    expect(await db.poolManifests.count()).toBe(1);
    expect(await db.fusionStudies.count()).toBe(1);
    expect(await db.fusionTrials.count()).toBe(1);
    expect(await db.fusionAttempts.count()).toBe(1);
    expect(await db.fusionObservations.count()).toBe(1);
    expect(await db.fusionPlaybooks.count()).toBe(1);
    expect(await db.tasks.count()).toBe(1);
    expect(await db.taskVersions.count()).toBe(1);
    expect(await db.taskArtifacts.count()).toBe(1);
    expect(await db.taskArtifactBytes.count()).toBe(1);
    expect(await db.taskInstances.count()).toBe(1);
    expect(await db.taskFamilies.count()).toBe(1);
    expect(await db.taskFamilyAssignments.count()).toBe(1);
    expect(await db.taskFamilyRelations.count()).toBe(1);
    expect(await db.taskFacetAnnotations.count()).toBe(1);
    expect(await db.taskMigrationCrosswalk.count()).toBe(1);
    // Exact source evidence is semantically unchanged.
    const importedStudy = await db.fusionStudies.get("study-1");
    expect((importedStudy?.study as Record<string, unknown>).claimLevel).toBe("exploratory");
    const importedRun = await db.runDetails.get("run-1");
    expect((importedRun?.record as RunRecordV2).status).toBe("completed");
    const importedExperiment = await db.experiments.get("exp-1");
    expect((importedExperiment?.experiment as ExperimentRecord).protocolFingerprint).toBe(
      "sha256:abc",
    );
    // Round-trip: re-export the imported database and compare canonically.
    const reexported = await exportWorkbenchArchiveV2(db);
    expect(reexported.manifest.counts).toEqual(archive.manifest.counts);
  });

  it("a non-identical ID collision aborts the whole commit BEFORE any write (no remap, no overwrite)", async () => {
    await db.suites.put(fx.suiteRow(fx.makeSuite("suite-1")));
    // Rewrite the incoming suite content so the same ID is NOT canonically identical.
    const archive = fx.buildValidArchiveV2Fixture();
    archive.suites[0] = { ...archive.suites[0], name: "suite-1 — renamed" };
    archive.manifest.payloadDigest = computeArchiveV2PayloadDigest(archive);

    const preview = await previewWorkbenchArchive(db, archive, { sourceLabel: "memory" });
    expect(preview.collisions.map((c) => `${c.collection}/${c.key}`)).toEqual(["suites/suite-1"]);

    await expect(commitPreviewWorkbenchArchiveV2(db, preview)).rejects.toMatchObject({
      name: "StorageError",
      kind: "conflict",
    });
    // Nothing was written: the pre-existing suite is untouched, and no new
    // entity leaked into any other store.
    const kept = await db.suites.get("suite-1");
    expect((kept?.suite as EvaluationSuite).name).toBe("Suite suite-1");
    expect(await db.runDetails.count()).toBe(0);
    expect(await db.fusionStudies.count()).toBe(0);
    expect(await db.tasks.count()).toBe(0);
  });

  it("repeated import is idempotent: second commit reuses/skips everything and writes nothing", async () => {
    const archive = fx.buildValidArchiveV2Fixture();
    const first = await commitPreviewWorkbenchArchiveV2(
      db,
      await previewWorkbenchArchive(db, archive, { sourceLabel: "memory" }),
    );
    expect(first.created.length).toBeGreaterThan(0);

    const secondPreview = await previewWorkbenchArchive(db, archive, { sourceLabel: "memory" });
    expect(secondPreview.create).toEqual([]);
    expect(secondPreview.collisions).toEqual([]);
    expect(secondPreview.invalid).toEqual([]);
    expect(secondPreview.totalEntities).toBe(21);

    const second = await commitPreviewWorkbenchArchiveV2(db, secondPreview);
    expect(second.created).toEqual([]);
    expect(second.reused.length).toBe(21);
    expect(second.skipped).toEqual([]);
    // No duplicate rows from a second pass.
    expect(await db.suites.count()).toBe(1);
    expect(await db.tasks.count()).toBe(1);
  });

  it("cancellation before commit leaves source and target unchanged and throws the cancellation error", async () => {
    const archive = fx.buildValidArchiveV2Fixture();
    const preview = await previewWorkbenchArchive(db, archive, { sourceLabel: "memory" });
    const controller = new AbortController();
    controller.abort();

    await expect(
      commitPreviewWorkbenchArchiveV2(db, preview, { signal: controller.signal }),
    ).rejects.toBeInstanceOf(ArchiveImportCancelledError);
    // Target unchanged.
    expect(await db.suites.count()).toBe(0);
    expect(await db.tasks.count()).toBe(0);
  });

  it("an injected mid-commit failure rolls the transaction back — nothing is written", async () => {
    const archive = fx.buildValidArchiveV2Fixture();
    const preview = await previewWorkbenchArchive(db, archive, { sourceLabel: "memory" });
    vi.spyOn(db.experiments, "put").mockRejectedValueOnce(new Error("boom"));

    await expect(commitPreviewWorkbenchArchiveV2(db, preview)).rejects.toMatchObject({
      name: "StorageError",
    });
    // Rollback: zero entities in every touched store.
    expect(await db.runSummaries.count()).toBe(0);
    expect(await db.experiments.count()).toBe(0);
    expect(await db.suites.count()).toBe(0);
    expect(await db.tasks.count()).toBe(0);
    expect(await db.fusionStudies.count()).toBe(0);
  });

  it("a preview carrying invalid entities never commits them — commit raises a validation StorageError", async () => {
    const artifactBytes = new TextEncoder().encode("valid artifact text");
    const archive = makeEmptyV2();
    const detail = fx.makeRunDetail("run-bad") as unknown as Record<string, unknown>;
    detail.status = "corrupt";
    archive.runs.details = [detail as unknown as RunRecordV2];
    const artifact = fx.makeTaskArtifact("art-1", artifactBytes);
    archive.tasks.taskArtifacts = [artifact];
    archive.tasks.taskArtifactBytes = [{ id: "art-1", bytesBase64: fx.bytesToBase64(artifactBytes) }];
    archive.manifest.counts.runDetails = 1;
    archive.manifest.counts.taskArtifacts = 1;
    archive.manifest.counts.taskArtifactBytes = 1;
    archive.manifest.payloadDigest = computeArchiveV2PayloadDigest(archive);

    const preview = await previewWorkbenchArchive(db, archive, { sourceLabel: "memory" });
    expect(preview.invalid.map((e) => `${e.collection}/${e.key}`)).toEqual(["runs.details/run-bad"]);

    await expect(commitPreviewWorkbenchArchiveV2(db, preview)).rejects.toMatchObject({
      name: "StorageError",
      kind: "validation",
    });
    expect(await db.runDetails.count()).toBe(0);
    expect(await db.taskArtifacts.count()).toBe(0);
  });

  it("a preview-to-commit race inserting a non-identical same-key row aborts inside the transaction and never overwrites (F1)", async () => {
    const archive = fx.buildValidArchiveV2Fixture();
    // Preview against an EMPTY DB → suites.suite-1 is classified as create.
    const preview = await previewWorkbenchArchive(db, archive, { sourceLabel: "memory" });
    expect(preview.create.some((c) => c.collection === "suites" && c.key === "suite-1")).toBe(
      true,
    );
    expect(preview.collisions).toEqual([]);

    // RACE: a different-content suite with the same ID lands AFTER the preview
    // but BEFORE the commit. The commit MUST re-read the destination row and
    // abort (no-overwrite contract) rather than blindly put() over it.
    await db.suites.put(fx.suiteRow({ ...fx.makeSuite("suite-1"), name: "raced different suite" }));

    await expect(commitPreviewWorkbenchArchiveV2(db, preview)).rejects.toMatchObject({
      name: "StorageError",
      kind: "conflict",
    });
    // The raced row is never overwritten.
    expect((await db.suites.get("suite-1"))?.suite).toEqual({
      ...fx.makeSuite("suite-1"),
      name: "raced different suite",
    });
    // No unrelated write leaked from the aborted commit.
    expect(await db.tasks.count()).toBe(0);
    expect(await db.runDetails.count()).toBe(0);
  });

  it("mutating preview.payload after preview aborts the commit with zero writes and a validation StorageError (F2)", async () => {
    const archive = fx.buildValidArchiveV2Fixture();
    const preview = await previewWorkbenchArchive(db, archive, { sourceLabel: "memory" });
    expect(preview.collisions).toEqual([]);
    expect(preview.invalid).toEqual([]);

    // An external caller mutates a previewed payload record after validation.
    // The commit must re-validate the complete payload (digest + guards) so a
    // stale/mutated payload is never written.
    (preview.payload as WorkbenchArchiveV2).suites[0] = {
      ...fx.makeSuite("suite-1"),
      name: "mutated after preview",
    };

    await expect(commitPreviewWorkbenchArchiveV2(db, preview)).rejects.toMatchObject({
      name: "StorageError",
      kind: "validation",
    });
    // Zero writes across the whole corpus.
    expect(await db.suites.count()).toBe(0);
    expect(await db.tasks.count()).toBe(0);
    expect(await db.runDetails.count()).toBe(0);
    expect(await db.taskMigrationCrosswalk.count()).toBe(0);
  });
});

describe("importWorkbenchArchiveAuto — adapter dispatch", () => {
  it("dispatches a v1 payload through the preserved v1 adapter (no v2 validation required)", async () => {
    const v1 = populatedArchive();
    // A v1 payload has no manifest; the auto path must not force v2 validation.
    const result = await importWorkbenchArchiveAuto(db, v1 as unknown as never);
    expect(result.format).toBe("v1");
    if (result.format !== "v1") throw new Error("expected v1 dispatch");
    expect(result.v1.created.length).toBeGreaterThan(0);
    expect(await db.suites.count()).toBe(1);
  });

  it("dispatches a v2 payload through the v2 adapter and validates the complete payload BEFORE any write", async () => {
    const archive = fx.buildValidArchiveV2Fixture();
    // Break the digest AFTER building: payload mutated, digest stale.
    archive.suites[0] = { ...archive.suites[0], name: "digest-broken" };

    await expect(importWorkbenchArchiveAuto(db, archive)).rejects.toMatchObject({
      name: "StorageError",
      kind: "validation",
    });
    // Nothing written.
    expect(await db.suites.count()).toBe(0);
    expect(await db.runDetails.count()).toBe(0);
  });

  it("rejects an unknown payload shape", async () => {
    await expect(importWorkbenchArchiveAuto(db, { hello: "world" })).rejects.toMatchObject({
      name: "StorageError",
      kind: "validation",
    });
  });
});

describe("archiveFailureGuidance — import cancellation", () => {
  it("classifies ArchiveImportCancelledError without leaking content", () => {
    const guidance = archiveFailureGuidance(new ArchiveImportCancelledError());
    expect(guidance).toContain("cancel");
  });
});

