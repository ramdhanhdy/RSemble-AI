// @vitest-environment node
// =============================================================================
// RSemble AI — T13b adversarial QA: security scan + fuzz probes
//
// Independent of the T13a author. Probes, not product code.
//
// Covers the plan Task 13 security/fuzz surface:
//   - recursive secret scan of every study/asset/report/error/config/archive
//     field for prohibited credential keys (repositories reject, validators
//     reject, exported archives never carry them);
//   - fuzz unknown kind/schema discriminants;
//   - malicious text (oversized strings, deep nesting, oversized arrays)
//     against the centralized v1 import limits;
//   - broken references (missing study/trial/playbook/parent refs) rejected
//     both at validator level and at repository level;
//   - cancellation boundaries (export/import abort before and during work).
// =============================================================================

import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { RSembleEvaluationDB, StorageError } from "./database";
import { createStudyRepository } from "./study-repository";
import { createLabAssetRepository } from "./lab-asset-repository";
import {
  ArchiveExportCancelledError,
  ArchiveImportCancelledError,
  exportWorkbenchArchiveV3,
  importWorkbenchArchiveAuto,
  parseWorkbenchArchive,
} from "./archive";
import { validateArchiveV3, type WorkbenchArchiveV3 } from "./archive-v3-types";
import { hasProhibitedStudyKeys, isStudyRecordEnvelope } from "../studies/study-types";
import { isPolicyStudyRecord } from "../studies/policy/policy-study-types";
import {
  buildValidArchiveV3Fixture,
  makeLabRecipeRecord,
  makeLabRecipeVersion,
  makeModelPoolRecord,
  makeModelPoolVersion,
  makePolicyStudyRecord,
  makePolicyStudyTrial,
  makePolicyStudyObservation,
  makePolicyReportPayload,
} from "./archive-v3-fixtures";
import * as v2fx from "./archive-v2-fixtures";

const testDbs: RSembleEvaluationDB[] = [];
afterEach(async () => {
  while (testDbs.length > 0) {
    const db = testDbs.pop();
    try {
      db?.close();
    } catch {
      // best-effort close
    }
  }
});

function freshDb(tag: string): RSembleEvaluationDB {
  const db = new RSembleEvaluationDB(
    `revsec-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  testDbs.push(db);
  return db;
}

/** Iterative recursive walk collecting every object key (any depth). */
function collectKeys(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, out);
  } else if (typeof value === "object" && value !== null) {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      collectKeys(v, out);
    }
  }
  return out;
}

const PROHIBITED_KEY_NAMES = ["apiKey", "authorization", "token", "secret", "password", "env"];

describe("security — recursive prohibited-secret scan", () => {
  it("study validators reject prohibited credential keys at any depth", () => {
    const record = makePolicyStudyRecord("study-secret");
    // Deeply nested prohibited key (3+ levels below the definition).
    record.definition = {
      ...record.definition,
      nested: { config: { transport: { apiKey: "sk-proj-SUPERSECRET" } } },
    } as never;
    expect(hasProhibitedStudyKeys(record)).toBe(true);
    expect(isPolicyStudyRecord(record)).toBe(false);
    expect(isStudyRecordEnvelope(record)).toBe(false);
  });

  it("repositories reject records/reports carrying prohibited keys (study, playbook, asset)", async () => {
    const db = freshDb("secret-repo");
    await db.open();
    const studies = createStudyRepository(db);
    const assets = createLabAssetRepository(db);

    const badStudy = makePolicyStudyRecord("study-secret-2");
    badStudy.definition = {
      ...badStudy.definition,
      judge1: { id: "x", password: "hunter2" },
    } as never;
    await expect(studies.createStudy(badStudy)).rejects.toThrow(StorageError);

    const goodStudy = makePolicyStudyRecord("study-ok");
    goodStudy.status = "draft";
    goodStudy.reportRef = null;
    await studies.createStudy(goodStudy);
    const badReport = makePolicyReportPayload("study-ok");
    const rowWithSecret = { ...badReport.rows[0] } as unknown as Record<string, unknown>;
    rowWithSecret.config = { apiKey: "sk-proj-X" };
    badReport.rows = [rowWithSecret] as never[];
    await expect(studies.createPlaybook("pb-bad", badReport)).rejects.toThrow(StorageError);

    const badRecipe = makeLabRecipeRecord("recipe-secret");
    badRecipe.kind = "fusion";
    badRecipe.description = "ok";
    (badRecipe as unknown as { meta?: unknown }).meta = { credentials: { token: "abc" } };
    await expect(
      assets.createRecipeRecord(badRecipe, makeLabRecipeVersion("recipe-secret", 1)),
    ).rejects.toThrow(StorageError);
  });

  it("a populated v3 export carries zero prohibited key names in any field", async () => {
    const db = freshDb("secret-export");
    await db.open();
    const studies = createStudyRepository(db);
    const assets = createLabAssetRepository(db);
    const record = makePolicyStudyRecord("study-clean");
    record.status = "draft";
    record.reportRef = null;
    await studies.createStudy(record);
    const recipeRecord = makeLabRecipeRecord("recipe-clean");
    const recipeVersion = makeLabRecipeVersion("recipe-clean", 1);
    (recipeVersion as unknown as Record<string, unknown>).description =
      "A recipe whose configuration is entirely benign";
    await assets.createRecipeRecord(recipeRecord, recipeVersion);
    // The study definition pins pool-1@1 and recipe-1@1; the export's
    // reference-graph validation requires them to exist.
    await assets.createPoolRecord(makeModelPoolRecord("pool-1"), makeModelPoolVersion("pool-1", 1));
    await assets.createRecipeRecord(
      makeLabRecipeRecord("recipe-1"),
      makeLabRecipeVersion("recipe-1", 1),
    );

    const exported = await exportWorkbenchArchiveV3(db, { now: 1_700_000_000_000 });
    const keys = collectKeys(exported);
    for (const key of keys) {
      expect(PROHIBITED_KEY_NAMES.includes(key), `prohibited key ${key} in export`).toBe(false);
    }
  });

  it("validateArchiveV3 rejects payloads carrying prohibited content", () => {
    const archive = buildValidArchiveV3Fixture();
    // Inject a credential-shaped key deep inside a Lab asset.
    (archive.lab.recipeRecords[0] as unknown as { meta?: unknown }).meta = { apiKey: "k" };
    const result = validateArchiveV3(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field.includes("lab.recipeRecords"))).toBe(true);
  });
});

describe("fuzz — unknown kind/schema discriminants", () => {
  it("unregistered study kinds and unknown schema versions are rejected", () => {
    for (const kind of ["routing", "judge", "workflow", "brainstorm", ""]) {
      const record = makePolicyStudyRecord("study-kind");
      record.definition = { ...record.definition } as never;
      (record as { kind: string }).kind = kind;
      expect(isPolicyStudyRecord(record), `kind ${kind} must be rejected`).toBe(false);
    }
    const badSchema = makePolicyStudyRecord("study-schema");
    (badSchema as { definitionSchemaVersion: number }).definitionSchemaVersion = 99;
    expect(isPolicyStudyRecord(badSchema)).toBe(false);

    const badStatus = makePolicyStudyRecord("study-status");
    (badStatus as { status: string }).status = "exploded";
    expect(isPolicyStudyRecord(badStatus)).toBe(false);

    const badClaim = makePolicyStudyRecord("study-claim");
    (badClaim as { claimLevel: string }).claimLevel = "proven";
    expect(isPolicyStudyRecord(badClaim)).toBe(false);
  });

  it("unknown archive format/storage versions and legacy fusion shapes are rejected", () => {
    const base = {
      manifest: {
        formatVersion: 3,
        storageVersion: 1,
        exportedAt: 1000,
        producer: "rsemble-ai",
        counts: {},
        payloadDigest: "x",
        disclosure: { scope: "local", notes: "" },
      },
      runs: { summaries: [], details: [] },
      rubrics: { identities: [], versions: [] },
      suites: [],
      experiments: [],
      tasks: {
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
      },
      taskSets: { records: [], versions: [], materializations: [], ownershipCrosswalks: [] },
      evidence: {
        modelConfigurations: [],
        observations: [],
        evidenceDecisions: [],
        evidenceIndexJobs: [],
        verifierOutcomes: [],
      },
      comparisons: { indexes: [], inputSnapshots: [], limitations: [] },
      lab: {
        recipeRecords: [],
        recipeVersions: [],
        poolRecords: [],
        poolVersions: [],
        studies: [],
        trials: [],
        attempts: [],
        observations: [],
        playbooks: [],
      },
    };

    expect(
      validateArchiveV3({ ...base, manifest: { ...base.manifest, formatVersion: 4 } }).valid,
    ).toBe(false);
    expect(
      validateArchiveV3({ ...base, manifest: { ...base.manifest, storageVersion: 2 } }).valid,
    ).toBe(false);
    expect(
      validateArchiveV3({ ...base, manifest: { ...base.manifest, payloadDigest: "" } }).valid,
    ).toBe(false);
    // REV-2: a legacy fusion key anywhere in the envelope is rejected outright.
    expect(validateArchiveV3({ ...base, fusion: { studies: [] } }).valid).toBe(false);
  });
});

describe("fuzz — malicious text and oversized inputs against import limits", () => {
  function minimalV1Archive(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      schemaVersion: 1,
      exportedAt: 1000,
      runs: { summaries: [], details: [] },
      profiles: { identities: [], versions: [] },
      suites: [],
      experiments: [],
      ...overrides,
    };
  }

  it("rejects an 8 MiB+ string anywhere in the payload", () => {
    const huge = "x".repeat(8 * 1024 * 1024 + 1);
    const archive = minimalV1Archive({ notes: huge });
    const check = parseWorkbenchArchive(archive);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.errors.join(" ")).toMatch(/exceeds the 8 MiB UTF-8 limit/i);
    }
  });

  it("rejects nesting beyond the depth limit", () => {
    let deep: Record<string, unknown> = { leaf: "x" };
    for (let i = 0; i < 40; i++) deep = { nested: deep };
    const archive = minimalV1Archive({ extra: deep });
    const check = parseWorkbenchArchive(archive);
    expect(check.ok).toBe(false);
  });

  it("rejects oversized arrays over the centralized limits", () => {
    const summaries = Array.from({ length: 25_001 }, (_, i) => ({
      id: `run-${i}`,
      kind: "adhoc",
      revision: 0,
      createdAt: 1000,
      completedAt: 1000,
      status: "done",
      mode: "rank",
      sourceKind: "adhoc",
      sourceProtocolFingerprint: "fp",
      sourceExperimentTaskAttemptId: null,
      modelKeys: [],
    }));
    const archive = minimalV1Archive({ runs: { summaries, details: [] } });
    const check = parseWorkbenchArchive(archive);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.errors.join(" ")).toMatch(/the limit is 25000/);
    }
  });

  it("control characters in user text survive import without breaking the envelope (no crash, deterministic)", () => {
    // User-authored prose is not a credential field: control characters must
    // not crash or corrupt the round trip.
    const summary = v2fx.makeRunSummary("run-ctrl");
    summary.taskExcerpt = "excerpt with \u0000 null byte and \u001f control char";
    const archive = minimalV1Archive({
      runs: { summaries: [summary], details: [v2fx.makeRunDetail("run-ctrl")] },
    });
    const check = parseWorkbenchArchive(archive);
    expect(check.ok).toBe(true);
  });
});

describe("fuzz — broken references", () => {
  it("v3 validator rejects trial/attempt/observation/playbook refs to missing studies or trials", () => {
    const base = {
      manifest: {
        formatVersion: 3,
        storageVersion: 1,
        exportedAt: 1000,
        producer: "rsemble-ai",
        counts: {
          studies: 1,
          studyTrials: 1,
          studyAttempts: 1,
          studyObservations: 1,
          policyPlaybooks: 1,
        },
        payloadDigest: "x",
        disclosure: { scope: "local", notes: "" },
      },
      runs: { summaries: [], details: [] },
      rubrics: { identities: [], versions: [] },
      suites: [],
      experiments: [],
      tasks: {
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
      },
      taskSets: { records: [], versions: [], materializations: [], ownershipCrosswalks: [] },
      evidence: {
        modelConfigurations: [],
        observations: [],
        evidenceDecisions: [],
        evidenceIndexJobs: [],
        verifierOutcomes: [],
      },
      comparisons: { indexes: [], inputSnapshots: [], limitations: [] },
      lab: {
        recipeRecords: [],
        recipeVersions: [],
        poolRecords: [],
        poolVersions: [],
        studies: [],
        trials: [],
        attempts: [],
        observations: [],
        playbooks: [],
      },
    };

    // Trial referencing a missing study.
    const trial = makePolicyStudyTrial("trial-orphan", "study-missing");
    const withOrphanTrial = structuredClone(base) as unknown as WorkbenchArchiveV3;
    withOrphanTrial.manifest.counts.studyTrials = 1;
    withOrphanTrial.lab.trials = [trial as never];
    const r1 = validateArchiveV3(withOrphanTrial);
    expect(r1.valid).toBe(false);
    expect(r1.errors.some((e) => /studyId study-missing not found/.test(e.message))).toBe(true);

    // Observation referencing a missing trial.
    const obs = makePolicyStudyObservation("obs-orphan", "study-missing", "trial-missing");
    const withOrphanObs = structuredClone(base) as unknown as WorkbenchArchiveV3;
    withOrphanObs.manifest.counts.studyObservations = 1;
    withOrphanObs.lab.observations = [obs as never];
    const r2 = validateArchiveV3(withOrphanObs);
    expect(r2.valid).toBe(false);
    expect(r2.errors.some((e) => /trialId trial-missing not found/.test(e.message))).toBe(true);

    // Playbook referencing a missing study.
    const report = makePolicyReportPayload("study-missing");
    const withOrphanPlaybook = structuredClone(base) as unknown as WorkbenchArchiveV3;
    withOrphanPlaybook.manifest.counts.policyPlaybooks = 1;
    withOrphanPlaybook.lab.playbooks = [report as never];
    const r3 = validateArchiveV3(withOrphanPlaybook);
    expect(r3.valid).toBe(false);
    expect(r3.errors.some((e) => /studyId study-missing not found/.test(e.message))).toBe(true);
  });

  it("repository APIs reject broken references with classified StorageErrors", async () => {
    const db = freshDb("broken-refs");
    await db.open();
    const studies = createStudyRepository(db);

    // Confirmation parent must exist.
    const confirmed = makePolicyStudyRecord("study-conf-orphan");
    confirmed.status = "completed";
    confirmed.claimLevel = "confirmed";
    confirmed.confirmationOf = "study-never-created";
    await expect(studies.createStudy(confirmed)).rejects.toThrow(StorageError);

    // Trials require an existing study.
    const orphanTrial = makePolicyStudyTrial("trial-orphan-2", "study-never-created");
    await expect(studies.createTrial(orphanTrial)).rejects.toThrow(StorageError);

    // Observations require an existing sealed trial.
    const orphanObs = makePolicyStudyObservation(
      "obs-orphan-2",
      "study-never-created",
      "trial-never",
    );
    await expect(studies.appendObservation(orphanObs)).rejects.toThrow(StorageError);
  });
});

describe("fuzz — oversized arrays and counts in v3", () => {
  it("v3 validator rejects a manifest count that contradicts the array", () => {
    const archive = buildValidArchiveV3Fixture();
    // Declare one more recipe than the payload actually carries.
    archive.manifest.counts.labRecipeRecords += 1;
    const result = validateArchiveV3(archive);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "manifest.counts.labRecipeRecords")).toBe(true);
  });
});

describe("fuzz — cancellation boundaries", () => {
  it("archive v3 export with an already-aborted signal throws ArchiveExportCancelledError and delivers nothing", async () => {
    const db = freshDb("cancel-export");
    await db.open();
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      exportWorkbenchArchiveV3(db, { now: 1_700_000_000_000, signal: aborted.signal }),
    ).rejects.toThrow(ArchiveExportCancelledError);
  });

  it("archive v3 export aborted mid-run throws ArchiveExportCancelledError (no partial archive)", async () => {
    const db = freshDb("cancel-export-mid");
    await db.open();
    const controller = new AbortController();
    const pending = exportWorkbenchArchiveV3(db, {
      now: 1_700_000_000_000,
      signal: controller.signal,
    });
    // Abort while the export is iterating tables.
    setTimeout(() => controller.abort(), 0);
    await expect(pending).rejects.toThrow(ArchiveExportCancelledError);
  });

  it("auto-import with an already-aborted signal throws ArchiveImportCancelledError", async () => {
    const db = freshDb("cancel-import");
    await db.open();
    // A fully valid v3 archive: the cancellation must fire before any work.
    const archive = buildValidArchiveV3Fixture();
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      importWorkbenchArchiveAuto(db, archive, { signal: aborted.signal }),
    ).rejects.toThrow(ArchiveImportCancelledError);
    // Nothing was written (no partial import on the cancelled boundary).
    expect(await db.runSummaries.count()).toBe(0);
    expect(await db.studies.count()).toBe(0);
  });
});
