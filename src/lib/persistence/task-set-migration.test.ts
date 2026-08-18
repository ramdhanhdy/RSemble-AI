// =============================================================================
// RSemble AI — Suite → Task Set migration tests (Child 03 Milestone B, Task 4)
//
// Strict RED matrix for the deterministic reconstruction of legacy Task Set
// versions and Suite/Experiment/Fusion ownership crosswalks. Covers every
// fixture required by the spec §13 migration validation plan and the Sol map
// redFixtureMatrix: changed/unchanged Suites, historical snapshots, latest
// unexecuted edits, legacy Rubric refs, identical manifests, roster
// extensions, incomplete/interrupted executions, all seven Fusion collections
// + claim levels, unresolved owners, partial migration + repeat startup, and
// unresolved child-02 crosswalk.
//
// Source evidence (suites, experiments, Rubric records/versions, child-02
// Task stores, every Fusion collection) is never mutated by the migration.
// =============================================================================

import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import Dexie from "dexie";
import type { ModelSlot } from "../../studio-data";
import type {
  EvaluationRubric,
  EvaluationSuite,
  EvaluationTask,
  ExperimentRecord,
  ExperimentSnapshot,
  ExperimentTaskState,
} from "../evaluations/evaluation-types";
import type {
  EvaluationObservation,
  FusionAttempt,
  FusionPlaybook,
  FusionRecipeVersion,
  FusionStudy,
  FusionTrial,
  PoolManifestVersion,
  SuiteSnapshotRef,
} from "../evaluations/fusion-study-types";
import type { TaskVersion } from "../tasks/task-types";
import { RSembleEvaluationDB, type TaskSetOwnershipCrosswalkRow } from "./database";
import { legacyTaskCrosswalkKey } from "./canonical-task-migration";
import { computeLegacyExecutableDefinitionDigest } from "../tasks/legacy-task-inventory";
import {
  canonicalJsonString,
  computeProtocolFingerprint,
} from "../evaluations/protocol-fingerprint";
import { migrateSuitesToTaskSets, taskSetMigrationMarkerKey } from "./task-set-migration";
import type { TaskSetVersion } from "../evaluations/task-set-types";
import {
  materializeWorkloadManifest,
  UnresolvedWorkloadRefError,
  type WorkloadCatalogResolvers,
} from "../evaluations/workload-manifest";

// --- shared DB lifecycle -----------------------------------------------------

const dbs: RSembleEvaluationDB[] = [];
afterEach(async () => {
  while (dbs.length > 0) {
    const db = dbs.pop()!;
    try {
      db.close();
    } catch {
      // best-effort
    }
    try {
      await db.delete();
    } catch {
      // best-effort
    }
  }
});

async function makeDb(): Promise<RSembleEvaluationDB> {
  const db = new Dexie(`task-set-migration-${crypto.randomUUID()}`) as unknown as RSembleEvaluationDB;
  db.version(1).stores({
    runSummaries: "id",
    runDetails: "id",
    profiles: "id",
    profileVersions: "[id+version]",
    suites: "id",
    experiments: "id",
    storageMeta: "key",
  });
  db.version(2).stores({
    fusionRecipes: "[id+version], id, version",
    poolManifests: "[id+version], id, version",
    fusionStudies: "id, revision, suiteId, suiteVersion, status, updatedAt",
    fusionTrials: "id, revision, studyId, stage, status, createdAt",
    fusionAttempts: "id, studyId, createdAt",
    fusionObservations: "id, trialId, createdAt",
    fusionPlaybooks: "id, studyId, createdAt",
  });
  db.version(3).stores({
    tasks: "id",
    taskVersions: "[taskId+version]",
    taskArtifacts: "id",
    taskArtifactBytes: "id",
    taskInstances: "id",
    taskFamilies: "id",
    taskFamilyAssignments: "id",
    taskFacetAnnotations: "id",
    taskMigrationCrosswalk: "legacyScopeKey",
  });
  db.version(4).stores({ taskFamilyRelations: "id" });
  db.version(5).stores({ taskSets: "id", taskSetVersions: "[taskSetId+version]" });
  db.version(6).stores({ taskSetOwnershipCrosswalk: "key, kind, taskSetId" });
  (db as any).assertWritable = () => {};
  dbs.push(db);
  await db.open();
  return db;
}

// --- fixtures ----------------------------------------------------------------

function slot(id: string, slug: string, model = `org/${slug}`): ModelSlot {
  return { id, providerId: "openrouter", provider: "openrouter", model, slug, enabled: true };
}

function task(overrides: Partial<EvaluationTask> = {}): EvaluationTask {
  return {
    id: "task-1",
    title: "Summarize",
    prompt: "Summarize the passage.",
    systemPrompt: "Use three bullets.",
    evaluation: { kind: "inherit" },
    judgeInstructionOverride: "Judge clarity.",
    order: 0,
    ...overrides,
  };
}

function suite(overrides: Partial<EvaluationSuite> = {}): EvaluationSuite {
  return {
    id: "suite-1",
    revision: 1,
    version: 2,
    name: "Suite One",
    description: "A legacy suite.",
    tasks: [task()],
    modelSlots: [slot("s1", "m1"), slot("s2", "m2")],
    defaultJudge: { providerId: "openrouter", model: "org/judge" },
    defaultEvaluation: { kind: "holistic" },
    createdAt: 10,
    updatedAt: 20,
    archivedAt: null,
    ...overrides,
  };
}

function snapshot(
  overrides: Partial<ExperimentSnapshot> & { suiteId?: string; suiteVersion?: number } = {},
): ExperimentSnapshot {
  const baseSuite = suite();
  return {
    suiteId: overrides.suiteId ?? baseSuite.id,
    suiteVersion: overrides.suiteVersion ?? 1,
    tasks: overrides.tasks ?? [task()],
    modelSlots: overrides.modelSlots ?? baseSuite.modelSlots,
    defaultJudge: overrides.defaultJudge ?? baseSuite.defaultJudge,
    defaultEvaluation: overrides.defaultEvaluation ?? baseSuite.defaultEvaluation,
    reasoningPolicy: overrides.reasoningPolicy,
    profiles: overrides.profiles ?? [],
    protocolFingerprint: overrides.protocolFingerprint ?? "sha256:fp",
    createdAt: overrides.createdAt ?? 15,
  };
}

function experiment(
  overrides: Partial<ExperimentRecord> & { snapshot?: Partial<ExperimentSnapshot> } = {},
): ExperimentRecord {
  const snap = snapshot({
    suiteId: overrides.suiteId ?? overrides.snapshot?.suiteId ?? "suite-1",
    suiteVersion: overrides.suiteVersion ?? overrides.snapshot?.suiteVersion ?? 1,
    ...overrides.snapshot,
  });
  return {
    id: overrides.id ?? "exp-1",
    revision: overrides.revision ?? 1,
    suiteId: overrides.suiteId ?? snap.suiteId,
    suiteVersion: overrides.suiteVersion ?? snap.suiteVersion,
    protocolFingerprint: overrides.protocolFingerprint ?? snap.protocolFingerprint,
    status: overrides.status ?? "completed",
    execution: overrides.execution ?? null,
    snapshot: snap,
    tasks: overrides.tasks ?? [],
    createdAt: overrides.createdAt ?? snap.createdAt,
    updatedAt: overrides.updatedAt ?? snap.createdAt,
    rosterExtensions: overrides.rosterExtensions,
  };
}

function rubric(overrides: Partial<EvaluationRubric> = {}): EvaluationRubric {
  return {
    id: "rubric-1",
    version: 1,
    name: "Standard Rubric",
    description: "Evaluates standard criteria",
    judgeInstruction: "Grade according to the criteria below.",
    criteria: [
      {
        id: "c1",
        kind: "graded",
        name: "Accuracy",
        description: "Factual correctness",
        weight: 1,
        anchors: {
          one: "Inaccurate",
          two: "Mostly inaccurate",
          three: "Partially accurate",
          four: "Mostly accurate",
          five: "Fully accurate",
        },
      },
    ],
    createdAt: 5,
    updatedAt: 5,
    ...overrides,
  };
}

function canonicalTaskVersion(taskId: string, version: number): TaskVersion {
  return {
    taskId,
    version,
    title: "Canonical",
    objective: "objective",
    candidateInstruction: "instruction",
    defaultContextManifest: [],
    responseContract: null,
    taskVerifierRef: null,
    source: { kind: "legacy-task-set", legacyScopeKey: null, note: null },
    createdAt: 1,
  };
}

// --- seed helpers ------------------------------------------------------------

async function seedSuite(db: RSembleEvaluationDB, s: EvaluationSuite): Promise<void> {
  await db.suites.put({
    id: s.id,
    suite: s,
    revision: s.revision,
    version: s.version,
    updatedAt: s.updatedAt,
    archivedAt: s.archivedAt,
  });
}

async function seedExperiment(db: RSembleEvaluationDB, e: ExperimentRecord): Promise<void> {
  await db.experiments.put({
    id: e.id,
    experiment: e,
    revision: e.revision,
    suiteId: e.suiteId,
    suiteVersion: e.suiteVersion,
    protocolFingerprint: e.protocolFingerprint,
    createdAt: e.createdAt,
    status: e.status,
  });
}

async function seedRubric(db: RSembleEvaluationDB, r: EvaluationRubric): Promise<void> {
  await db.profiles.put({
    id: r.id,
    record: {
      id: r.id,
      revision: 0,
      latestVersion: r.version,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      archivedAt: null,
    },
    revision: 0,
    latestVersion: r.version,
    updatedAt: r.updatedAt,
    archivedAt: null,
  });
  await db.profileVersions.put({
    id: r.id,
    version: r.version,
    profile: r,
    updatedAt: r.updatedAt,
  });
}

/** Seed a child-02 crosswalk + canonical Task Version so a legacy member resolves. */
async function seedTaskCrosswalk(
  db: RSembleEvaluationDB,
  suiteId: string,
  suiteVersion: number,
  t: EvaluationTask,
  canonicalTaskId: string,
  canonicalVersion: number,
): Promise<void> {
  const definition = {
    title: t.title,
    objective: t.prompt,
    candidateInstruction: t.systemPrompt,
    defaultContextManifest: [] as never[],
    responseContract: null,
    taskVerifierRef: t.verification ?? null,
    evaluation: t.evaluation,
  };
  const digest = computeLegacyExecutableDefinitionDigest(definition);
  const key = legacyTaskCrosswalkKey(suiteId, suiteVersion, t.id, digest);
  await db.taskMigrationCrosswalk.put({
    legacyScopeKey: key,
    taskId: canonicalTaskId,
    taskVersion: canonicalVersion,
  });
  await db.tasks.put({
    id: canonicalTaskId,
    record: {
      id: canonicalTaskId,
      latestVersion: canonicalVersion,
      createdAt: 1,
      updatedAt: 1,
      archivedAt: null,
      origin: "legacy-task-set",
      revision: 0,
    },
    latestVersion: canonicalVersion,
    createdAt: 1,
    updatedAt: 1,
    archivedAt: null,
    origin: "legacy-task-set",
    revision: 0,
  });
  await db.taskVersions.put({
    taskId: canonicalTaskId,
    version: canonicalVersion,
    version_: canonicalTaskVersion(canonicalTaskId, canonicalVersion),
    createdAt: 1,
  });
}

// --- Fusion seed helpers -----------------------------------------------------

function recipe(id = "recipe-1", version = 1): FusionRecipeVersion {
  return {
    id,
    version,
    recipeFamily: "BlindRaw",
    promptVersion: "blind-raw-v1",
    judgeAnalysisMode: "none",
    rubricAccess: false,
    verification: false,
    synthesizer: { providerId: "openrouter", model: "acme/synth-1" },
  };
}

function manifest(id = "pool-1", version = 1): PoolManifestVersion {
  return {
    id,
    version,
    core: [slot("s1", "a/m1"), slot("s2", "b/m2"), slot("s3", "c/m3")],
    challengers: [],
    diversityChecklist: ["independent families"],
    rationale: "test",
    supersedesVersion: null,
    createdAt: 1000,
  };
}

function study(
  id = "study-1",
  suiteRef: SuiteSnapshotRef,
  claimLevel: "exploratory" | "confirmed" = "exploratory",
): FusionStudy {
  return {
    id,
    revision: 0,
    kind: claimLevel === "confirmed" ? "confirmation" : "exploration",
    suiteRef,
    poolRef: { id: "pool-1", version: 1 },
    judge1: { providerId: "openrouter", model: "acme/judge-1" },
    judge2: { providerId: "gemini", model: "acme/judge-2" },
    recipeRefs: [{ id: "recipe-1", version: 1 }],
    stageResults: { stageA: null, stageB: null, stageC: null },
    playbookRef: null,
    claimLevel,
    confirmationOf: claimLevel === "confirmed" ? "study-1" : null,
    status: "in_progress",
    createdAt: 1000,
    updatedAt: 1000,
  };
}

function trial(id: string, studyId: string, suiteRef: SuiteSnapshotRef): FusionTrial {
  return {
    id,
    revision: 0,
    studyId,
    suiteRef,
    poolRef: { id: "pool-1", version: 1 },
    candidateConfig: { slots: [slot("s1", "a/m1")] },
    judge1: { providerId: "openrouter", model: "acme/judge-1" },
    judge2: { providerId: "gemini", model: "acme/judge-2" },
    policy: "fuse",
    recipe: { id: "recipe-1", version: 1 },
    synthesizer: { providerId: "openrouter", model: "acme/synth-1" },
    stage: "B",
    sampleIndex: 0,
    children: { candidateRunId: null, devJudgeRunId: null, synthesisArtifact: null },
    observationIds: [],
    cost: { policy: { tokensIn: 0, tokensOut: 0 }, experimental: { tokensIn: 0, tokensOut: 0 } },
    status: "in_progress",
    sealedAt: null,
    createdAt: 1000,
    updatedAt: 1000,
  };
}

function attempt(id: string, studyId: string): FusionAttempt {
  return {
    id,
    studyId,
    fromTrialId: "trial-1",
    toTrialId: "trial-2",
    reason: "synthesis_rerun",
    createdAt: 1100,
  };
}

function observation(id: string, trialId: string): EvaluationObservation {
  return {
    id,
    trialId,
    judge: { providerId: "gemini", model: "acme/judge-2" },
    runId: null,
    status: "completed",
    overallScore: 4,
    tokensIn: 10,
    tokensOut: 20,
    error: null,
    startedAt: 1000,
    finishedAt: 1100,
  };
}

function playbook(
  id: string,
  studyId: string,
  suiteRef: SuiteSnapshotRef,
  claimLevel: "exploratory" | "confirmed" = "exploratory",
): FusionPlaybook {
  return {
    id,
    studyId,
    suiteRef,
    rows: [
      {
        policy: "fuse",
        configuration: "B + C",
        score: 4,
        lift: 1.2,
        costMultiplier: 1.5,
        confidence: "high",
      },
    ],
    recommendation: {
      kind: "adopt",
      policy: "fuse",
      configuration: "B + C",
      rationale: "Clear lift.",
    },
    poolAdequacy: { probed: true, outcome: "confirmed", challengerKeys: [], note: "" },
    claimLevel,
    conclusion: "Adopt fuse.",
    createdAt: 1200,
  };
}

async function seedFusionFull(
  db: RSembleEvaluationDB,
  suiteRef: SuiteSnapshotRef,
  claimLevel: "exploratory" | "confirmed" = "exploratory",
): Promise<void> {
  await (db as any).fusionRecipes.put({ id: "recipe-1", version: 1, recipe: recipe(), createdAt: 1000 });
  await (db as any).poolManifests.put({ id: "pool-1", version: 1, manifest: manifest(), createdAt: 1000 });
  const s = study("study-1", suiteRef, claimLevel);
  await (db as any).fusionStudies.put({
    id: s.id,
    study: s,
    revision: s.revision,
    suiteId: s.suiteRef.suiteId,
    suiteVersion: s.suiteRef.suiteVersion,
    status: s.status,
    updatedAt: s.updatedAt,
  });
  const t1 = trial("trial-1", "study-1", suiteRef);
  const t2 = trial("trial-2", "study-1", suiteRef);
  await (db as any).fusionTrials.put({
    id: t1.id,
    trial: t1,
    revision: t1.revision,
    studyId: t1.studyId,
    stage: t1.stage,
    status: t1.status,
    createdAt: t1.createdAt,
  });
  await (db as any).fusionTrials.put({
    id: t2.id,
    trial: t2,
    revision: t2.revision,
    studyId: t2.studyId,
    stage: t2.stage,
    status: t2.status,
    createdAt: t2.createdAt,
  });
  const att = attempt("attempt-1", "study-1");
  await (db as any).fusionAttempts.put({
    id: att.id,
    attempt: att,
    studyId: att.studyId,
    createdAt: att.createdAt,
  });
  const obs = observation("obs-1", "trial-1");
  await (db as any).fusionObservations.put({
    id: obs.id,
    observation: obs,
    trialId: obs.trialId,
    createdAt: obs.startedAt,
  });
  const pb = playbook("playbook-1", "study-1", suiteRef, claimLevel);
  await (db as any).fusionPlaybooks.put({
    id: pb.id,
    playbook: pb,
    studyId: pb.studyId,
    createdAt: pb.createdAt,
  });
}

// --- source-preservation snapshot -------------------------------------------

async function snapshotAllSources(db: RSembleEvaluationDB): Promise<string> {
  const [
    suites,
    experiments,
    rubrics,
    profileVersions,
    tasks,
    taskVersions,
    taskMigrationCrosswalk,
    fusionRecipes,
    poolManifests,
    fusionStudies,
    fusionTrials,
    fusionAttempts,
    fusionObservations,
    fusionPlaybooks,
  ] = await Promise.all([
    db.suites.toArray(),
    db.experiments.toArray(),
    db.profiles.toArray(),
    db.profileVersions.toArray(),
    db.tasks.toArray(),
    db.taskVersions.toArray(),
    db.taskMigrationCrosswalk.toArray(),
    (db as any).fusionRecipes ? (db as any).fusionRecipes.toArray() : Promise.resolve([]),
    (db as any).poolManifests ? (db as any).poolManifests.toArray() : Promise.resolve([]),
    (db as any).fusionStudies ? (db as any).fusionStudies.toArray() : Promise.resolve([]),
    (db as any).fusionTrials ? (db as any).fusionTrials.toArray() : Promise.resolve([]),
    (db as any).fusionAttempts ? (db as any).fusionAttempts.toArray() : Promise.resolve([]),
    (db as any).fusionObservations ? (db as any).fusionObservations.toArray() : Promise.resolve([]),
    (db as any).fusionPlaybooks ? (db as any).fusionPlaybooks.toArray() : Promise.resolve([]),
  ]);
  return canonicalJsonString({
    suites,
    experiments,
    rubrics,
    profileVersions,
    tasks,
    taskVersions,
    taskMigrationCrosswalk,
    fusionRecipes,
    poolManifests,
    fusionStudies,
    fusionTrials,
    fusionAttempts,
    fusionObservations,
    fusionPlaybooks,
  });
}

async function xwalks(
  db: RSembleEvaluationDB,
  kind: TaskSetOwnershipCrosswalkRow["kind"],
): Promise<TaskSetOwnershipCrosswalkRow[]> {
  return db.taskSetOwnershipCrosswalk.where("kind").equals(kind).toArray();
}

/** Narrows an unresolved-ref payload to a `{ id, version }` VersionRef. */
function isVersionRef(ref: unknown): ref is { id: string; version: number } {
  if (ref === null || typeof ref !== "object") return false;
  const r = ref as Record<string, unknown>;
  return typeof r.id === "string" && typeof r.version === "number";
}

// =============================================================================
// Tests
// =============================================================================

describe("migrateSuitesToTaskSets", () => {
  // --- unchanged-suite -------------------------------------------------------

  it("unchanged-suite: one Task Set Version; historical + current map to it; source deep-equal; repeat writes nothing", async () => {
    const db = await makeDb();
    const current = suite({ version: 2 }); // current suite at v2, same workload as the v1 snapshot
    const hist = experiment({
      id: "exp-1",
      suiteId: "suite-1",
      suiteVersion: 1,
      snapshot: snapshot({ suiteVersion: 1, createdAt: 15, tasks: [task()] }),
      createdAt: 15,
    });
    await seedSuite(db, current);
    await seedExperiment(db, hist);
    // Resolve the same canonical task version for both suiteVersions.
    await seedTaskCrosswalk(db, "suite-1", 1, task(), "ctask-1", 1);
    await seedTaskCrosswalk(db, "suite-1", 2, task(), "ctask-1", 1);
    const before = await snapshotAllSources(db);

    const result = await migrateSuitesToTaskSets(db);

    expect(result.complete).toBe(true);
    expect(result.migratedSuites).toBe(1);
    expect(result.createdVersions).toBe(1);
    const record = await db.taskSets.get("suite-1");
    expect(record?.origin).toBe("legacy-suite");
    expect(record?.latestVersion).toBe(1);
    const versions = await db.taskSetVersions
      .where("taskSetId")
      .equals("suite-1")
      .sortBy("version");
    expect(versions).toHaveLength(1);
    expect(versions[0].version).toBe(1);
    // Both source coordinates map to version 1.
    const expXwalk = (await xwalks(db, "experiment-owner")).find((r) => r.experimentId === "exp-1");
    expect(expXwalk?.version).toBe(1);
    expect(expXwalk?.status).toBe("resolved");
    // Source unchanged.
    expect(await snapshotAllSources(db)).toBe(before);
    // Repeat startup writes nothing.
    const versionsBefore = await db.taskSetVersions.count();
    const xwalksBefore = await db.taskSetOwnershipCrosswalk.count();
    const again = await migrateSuitesToTaskSets(db);
    expect(again.complete).toBe(true);
    expect(await db.taskSetVersions.count()).toBe(versionsBefore);
    expect(await db.taskSetOwnershipCrosswalk.count()).toBe(xwalksBefore);
    expect(await snapshotAllSources(db)).toBe(before);
  });

  // --- changed-suite ---------------------------------------------------------

  it("changed-suite: distinct digests create contiguous immutable versions; each Experiment/current maps exactly", async () => {
    const db = await makeDb();
    const current = suite({
      version: 2,
      tasks: [task({ prompt: "Newer prompt.", systemPrompt: "Two bullets." })],
    });
    const hist = experiment({
      id: "exp-1",
      suiteId: "suite-1",
      suiteVersion: 1,
      snapshot: snapshot({
        suiteVersion: 1,
        tasks: [task({ prompt: "Older prompt.", systemPrompt: "Three bullets." })],
        createdAt: 15,
      }),
      createdAt: 15,
    });
    await seedSuite(db, current);
    await seedExperiment(db, hist);
    await seedTaskCrosswalk(db, "suite-1", 1, hist.snapshot.tasks[0], "ctask-1", 1);
    await seedTaskCrosswalk(db, "suite-1", 2, current.tasks[0], "ctask-1", 2);
    const before = await snapshotAllSources(db);

    const result = await migrateSuitesToTaskSets(db);

    expect(result.complete).toBe(true);
    expect(result.createdVersions).toBe(2);
    const versions = await db.taskSetVersions
      .where("taskSetId")
      .equals("suite-1")
      .sortBy("version");
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
    expect((await db.taskSets.get("suite-1"))?.latestVersion).toBe(2);
    // Historical maps to v1, current suite's coordinate maps to v2.
    const expXwalk = (await xwalks(db, "experiment-owner")).find((r) => r.experimentId === "exp-1");
    expect(expXwalk?.version).toBe(1);
    const suiteXwalks = await xwalks(db, "suite-manifest");
    const v2 = suiteXwalks.find((r) => r.version === 2);
    expect(v2).toBeDefined();
    // No legacy version-number gap is copied: canonical versions are 1..2 contiguous.
    expect(await snapshotAllSources(db)).toBe(before);
  });

  // --- historical-snapshots --------------------------------------------------

  it("historical-snapshots: every historical definition reconstructed from its own frozen snapshot; current cannot erase history", async () => {
    const db = await makeDb();
    const current = suite({ version: 3, tasks: [task({ prompt: "v3 prompt." })] });
    const e1 = experiment({
      id: "exp-1",
      suiteId: "suite-1",
      suiteVersion: 1,
      snapshot: snapshot({
        suiteVersion: 1,
        tasks: [task({ prompt: "v1 prompt." })],
        createdAt: 10,
      }),
      createdAt: 10,
    });
    const e2 = experiment({
      id: "exp-2",
      suiteId: "suite-1",
      suiteVersion: 2,
      snapshot: snapshot({
        suiteVersion: 2,
        tasks: [task({ prompt: "v2 prompt." })],
        createdAt: 20,
      }),
      createdAt: 20,
    });
    await seedSuite(db, current);
    await seedExperiment(db, e1);
    await seedExperiment(db, e2);
    await seedTaskCrosswalk(db, "suite-1", 1, e1.snapshot.tasks[0], "ctask-1", 1);
    await seedTaskCrosswalk(db, "suite-1", 2, e2.snapshot.tasks[0], "ctask-1", 2);
    await seedTaskCrosswalk(db, "suite-1", 3, current.tasks[0], "ctask-1", 3);
    const before = await snapshotAllSources(db);

    const result = await migrateSuitesToTaskSets(db);

    expect(result.createdVersions).toBe(3);
    const versions = await db.taskSetVersions
      .where("taskSetId")
      .equals("suite-1")
      .sortBy("version");
    expect(versions.map((v) => v.version)).toEqual([1, 2, 3]);
    expect(
      (await xwalks(db, "experiment-owner")).find((r) => r.experimentId === "exp-1")?.version,
    ).toBe(1);
    expect(
      (await xwalks(db, "experiment-owner")).find((r) => r.experimentId === "exp-2")?.version,
    ).toBe(2);
    expect(await snapshotAllSources(db)).toBe(before);
  });

  // --- latest-unexecuted-edit ------------------------------------------------

  it("latest-unexecuted-edit: current Suite contributes a final new version with no Experiment; historical mappings unchanged", async () => {
    const db = await makeDb();
    const current = suite({ version: 5, tasks: [task({ prompt: "Unexecuted latest." })] });
    const hist = experiment({
      id: "exp-1",
      suiteId: "suite-1",
      suiteVersion: 4,
      snapshot: snapshot({
        suiteVersion: 4,
        tasks: [task({ prompt: "Executed older." })],
        createdAt: 50,
      }),
      createdAt: 50,
    });
    await seedSuite(db, current);
    await seedExperiment(db, hist);
    await seedTaskCrosswalk(db, "suite-1", 4, hist.snapshot.tasks[0], "ctask-1", 1);
    await seedTaskCrosswalk(db, "suite-1", 5, current.tasks[0], "ctask-1", 2);
    const before = await snapshotAllSources(db);

    const result = await migrateSuitesToTaskSets(db);

    expect(result.createdVersions).toBe(2);
    expect((await db.taskSets.get("suite-1"))?.latestVersion).toBe(2);
    const versions = await db.taskSetVersions
      .where("taskSetId")
      .equals("suite-1")
      .sortBy("version");
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
    // Historical mapping stays at v1.
    expect(
      (await xwalks(db, "experiment-owner")).find((r) => r.experimentId === "exp-1")?.version,
    ).toBe(1);
    expect(await snapshotAllSources(db)).toBe(before);
  });

  // --- legacy-rubric-refs ---------------------------------------------------

  it("legacy-rubric-refs: exact refs and embedded Rubric meaning preserved; missing exact Rubric is unresolved and blocks execution", async () => {
    const db = await makeDb();
    const r1 = rubric({ id: "rubric-1", version: 1 });
    const r2 = rubric({ id: "rubric-2", version: 1, name: "Other" });
    await seedRubric(db, r1);
    await seedRubric(db, r2);
    const current = suite({
      version: 2,
      defaultEvaluation: { kind: "profile", profile: { id: "rubric-1", version: 1 } },
      tasks: [task({ evaluation: { kind: "profile", profile: { id: "rubric-2", version: 1 } } })],
    });
    const hist = experiment({
      id: "exp-1",
      suiteId: "suite-1",
      suiteVersion: 1,
      snapshot: snapshot({
        suiteVersion: 1,
        defaultEvaluation: { kind: "profile", profile: { id: "rubric-1", version: 1 } },
        tasks: [task({ evaluation: { kind: "profile", profile: { id: "rubric-2", version: 1 } } })],
        profiles: [r1, r2],
        createdAt: 15,
      }),
      createdAt: 15,
    });
    await seedSuite(db, current);
    await seedExperiment(db, hist);
    await seedTaskCrosswalk(db, "suite-1", 1, hist.snapshot.tasks[0], "ctask-1", 1);
    await seedTaskCrosswalk(db, "suite-1", 2, current.tasks[0], "ctask-1", 1);
    const before = await snapshotAllSources(db);

    const result = await migrateSuitesToTaskSets(db);

    expect(result.complete).toBe(true);
    expect(result.createdVersions).toBe(1);
    const v1 = (await db.taskSetVersions.where("taskSetId").equals("suite-1").toArray())[0];
    const version = v1.version_ as {
      defaultRubricRef: unknown;
      members: Array<{ rubricOverrideRef: unknown }>;
    };
    expect(version.defaultRubricRef).toEqual({ id: "rubric-1", version: 1 });
    expect(version.members[0].rubricOverrideRef).toEqual({ id: "rubric-2", version: 1 });
    expect(await snapshotAllSources(db)).toBe(before);

    // Missing exact Rubric ref → unresolved member that blocks new execution.
    const db2 = await makeDb();
    const current2 = suite({
      id: "suite-2",
      version: 1,
      defaultEvaluation: { kind: "profile", profile: { id: "rubric-missing", version: 1 } },
      tasks: [task()],
    });
    await seedSuite(db2, current2);
    await seedTaskCrosswalk(db2, "suite-2", 1, current2.tasks[0], "ctask-2", 1);
    // No profileVersions for rubric-missing.
    const res2 = await migrateSuitesToTaskSets(db2);
    expect(res2.complete).toBe(true);
    const v2 = (await db2.taskSetVersions.where("taskSetId").equals("suite-2").toArray())[0];
    const version2 = v2.version_ as TaskSetVersion;
    // The default rubric ref is preserved exactly (not substituted); resolution is a read-time concern.
    expect(version2.defaultRubricRef).toEqual({ id: "rubric-missing", version: 1 });

    // Resolve the migrated version against the exact Rubric catalog (the only
    // pinned Rubric versions that exist: rubric-1 and rubric-2) and exercise
    // the execution/materialization guard. The missing pinned ref must be
    // reported unresolved and execution rejected without latest-version
    // substitution.
    const exactRubricCatalog: WorkloadCatalogResolvers = {
      getTaskVersion: (ref) =>
        ref.taskId === "ctask-2" && ref.version === 1 ? canonicalTaskVersion("ctask-2", 1) : null,
      getRubricVersion: (ref) =>
        ref.id === "rubric-1" && ref.version === 1
          ? r1
          : ref.id === "rubric-2" && ref.version === 1
            ? r2
            : null,
    };
    let materializeError: unknown;
    try {
      materializeWorkloadManifest(version2, exactRubricCatalog);
    } catch (err) {
      materializeError = err;
    }
    expect(materializeError).toBeInstanceOf(UnresolvedWorkloadRefError);
    const unresolved = (materializeError as UnresolvedWorkloadRefError).unresolved;
    expect(
      unresolved.some(
        (u) =>
          u.field === "defaultRubricRef" && isVersionRef(u.ref) && u.ref.id === "rubric-missing",
      ),
    ).toBe(true);
    // No substitution: the pinned ref on the migrated version is still the missing one.
    expect(version2.defaultRubricRef).toEqual({ id: "rubric-missing", version: 1 });
  });

  // --- identical-manifests ---------------------------------------------------

  it("identical-manifests: identical semantic digests coalesce within a Suite; across Suites Task Sets stay separate 1:1", async () => {
    const db = await makeDb();
    const sameTask = task();
    const a = suite({ id: "suite-a", version: 2, tasks: [sameTask] });
    const b = suite({ id: "suite-b", version: 3, tasks: [sameTask] });
    const aExp = experiment({
      id: "exp-a",
      suiteId: "suite-a",
      suiteVersion: 1,
      snapshot: snapshot({ suiteId: "suite-a", suiteVersion: 1, tasks: [sameTask], createdAt: 10 }),
      createdAt: 10,
    });
    const bExp1 = experiment({
      id: "exp-b1",
      suiteId: "suite-b",
      suiteVersion: 1,
      snapshot: snapshot({ suiteId: "suite-b", suiteVersion: 1, tasks: [sameTask], createdAt: 10 }),
      createdAt: 10,
    });
    const bExp2 = experiment({
      id: "exp-b2",
      suiteId: "suite-b",
      suiteVersion: 2,
      snapshot: snapshot({ suiteId: "suite-b", suiteVersion: 2, tasks: [sameTask], createdAt: 20 }),
      createdAt: 20,
    });
    await seedSuite(db, a);
    await seedSuite(db, b);
    await seedExperiment(db, aExp);
    await seedExperiment(db, bExp1);
    await seedExperiment(db, bExp2);
    await seedTaskCrosswalk(db, "suite-a", 1, sameTask, "ctask-a", 1);
    await seedTaskCrosswalk(db, "suite-a", 2, sameTask, "ctask-a", 1);
    await seedTaskCrosswalk(db, "suite-b", 1, sameTask, "ctask-b", 1);
    await seedTaskCrosswalk(db, "suite-b", 2, sameTask, "ctask-b", 1);
    await seedTaskCrosswalk(db, "suite-b", 3, sameTask, "ctask-b", 1);
    const before = await snapshotAllSources(db);

    const result = await migrateSuitesToTaskSets(db);

    expect(result.complete).toBe(true);
    // Each Suite coalesces to one version despite multiple identical snapshots.
    expect((await db.taskSets.get("suite-a"))?.latestVersion).toBe(1);
    expect((await db.taskSets.get("suite-b"))?.latestVersion).toBe(1);
    expect(await db.taskSets.count()).toBe(2);
    // Timestamp/id differences did not change the digest: one version each.
    expect(await db.taskSetVersions.where("taskSetId").equals("suite-b").count()).toBe(1);
    expect(await snapshotAllSources(db)).toBe(before);
  });

  // --- roster-extension ------------------------------------------------------

  it("roster-extension: extended frozen manifest maps independently when its digest differs; extension history deep-equal before/after", async () => {
    const db = await makeDb();
    const baseSlots = [slot("s1", "m1"), slot("s2", "m2")];
    const extendedSlots = [slot("s1", "m1"), slot("s2", "m2"), slot("s3", "m3")];
    const current = suite({ version: 1, modelSlots: extendedSlots, tasks: [task()] });
    const original = experiment({
      id: "exp-1",
      suiteId: "suite-1",
      suiteVersion: 1,
      snapshot: snapshot({
        suiteVersion: 1,
        modelSlots: baseSlots,
        tasks: [task()],
        createdAt: 10,
        protocolFingerprint: "sha256:orig",
      }),
      createdAt: 10,
    });
    const extended = experiment({
      id: "exp-2",
      suiteId: "suite-1",
      suiteVersion: 1,
      snapshot: snapshot({
        suiteVersion: 1,
        modelSlots: extendedSlots,
        tasks: [task()],
        createdAt: 20,
        protocolFingerprint: "sha256:ext",
      }),
      createdAt: 20,
      rosterExtensions: [
        {
          addedModelKey: "openrouter:m3",
          addedSlot: slot("s3", "m3"),
          priorFingerprint: "sha256:orig",
          extendedAt: 20,
        },
      ],
    });
    await seedSuite(db, current);
    await seedExperiment(db, original);
    await seedExperiment(db, extended);
    await seedTaskCrosswalk(db, "suite-1", 1, task(), "ctask-1", 1);
    const before = await snapshotAllSources(db);

    const result = await migrateSuitesToTaskSets(db);

    expect(result.complete).toBe(true);
    // Two distinct rosters → two distinct digests → two versions (orig + extended/current).
    expect((await db.taskSets.get("suite-1"))?.latestVersion).toBe(2);
    const expOrig = (await xwalks(db, "experiment-owner")).find((r) => r.experimentId === "exp-1");
    const expExt = (await xwalks(db, "experiment-owner")).find((r) => r.experimentId === "exp-2");
    expect(expOrig?.version).not.toBe(expExt?.version);
    // Roster extension provenance preserved unchanged.
    const stored = (await db.experiments.get("exp-2"))?.experiment as ExperimentRecord;
    expect(stored.rosterExtensions).toEqual(extended.rosterExtensions);
    expect(await snapshotAllSources(db)).toBe(before);
  });

  // --- incomplete-interrupted-executions ------------------------------------

  it("incomplete-interrupted-executions: every snapshot maps regardless of status; statuses/attempts unchanged", async () => {
    const db = await makeDb();
    const current = suite({ version: 1, tasks: [task()] });
    const statuses: ExperimentRecord["status"][] = [
      "draft",
      "queued",
      "running",
      "paused",
      "completed",
      "completed_with_failures",
      "aborted",
      "interrupted",
    ];
    const taskState: ExperimentTaskState = {
      taskId: "task-1",
      selectedAttemptId: "att-1",
      attempts: [
        {
          id: "att-1",
          runId: null,
          trial: 1,
          status: "interrupted",
          startedAt: 10,
          finishedAt: null,
          error: { message: "boom" },
        },
      ],
    };
    let i = 0;
    for (const status of statuses) {
      i += 1;
      const e = experiment({
        id: `exp-${i}`,
        suiteId: "suite-1",
        suiteVersion: 1,
        status,
        snapshot: snapshot({
          suiteVersion: 1,
          tasks: [task()],
          createdAt: 100 + i,
          protocolFingerprint: `sha256:f${i}`,
        }),
        createdAt: 100 + i,
        tasks: [taskState],
      });
      await seedExperiment(db, e);
    }
    await seedSuite(db, current);
    await seedTaskCrosswalk(db, "suite-1", 1, task(), "ctask-1", 1);
    const before = await snapshotAllSources(db);

    const result = await migrateSuitesToTaskSets(db);

    expect(result.complete).toBe(true);
    const expXwalks = await xwalks(db, "experiment-owner");
    expect(expXwalks).toHaveLength(statuses.length);
    for (const x of expXwalks) expect(x.status).toBe("resolved");
    // Statuses and attempts unchanged.
    expect(await snapshotAllSources(db)).toBe(before);
  });

  // --- all-seven-fusion-payloads-and-claim-levels ---------------------------

  it("all-seven-fusion-payloads-and-claim-levels: only owner crosswalks added; all seven collections deep-equal before/after and after repeat", async () => {
    const db = await makeDb();
    const current = suite({ version: 4, tasks: [task()] });
    await seedSuite(db, current);
    await seedTaskCrosswalk(db, "suite-1", 4, task(), "ctask-1", 1);
    const suiteRef: SuiteSnapshotRef = {
      suiteId: "suite-1",
      suiteVersion: 4,
      protocolFingerprint: computeProtocolFingerprint(current, []),
    };
    await seedFusionFull(db, suiteRef, "exploratory");
    // Add a confirmed study + playbook too.
    const confirmedRef = suiteRef;
    await seedFusionConfirmed(db, confirmedRef);
    const before = await snapshotAllSources(db);

    const result = await migrateSuitesToTaskSets(db);

    expect(result.complete).toBe(true);
    expect(result.unresolvedFusionOwners).toBe(0);
    const fusionXwalks = await xwalks(db, "fusion-owner");
    expect(fusionXwalks.length).toBeGreaterThanOrEqual(2);
    for (const x of fusionXwalks) expect(x.status).toBe("resolved");
    // All seven source collections unchanged.
    expect(await snapshotAllSources(db)).toBe(before);
    // Repeat startup: still unchanged, no new rows.
    const xwalksBefore = await db.taskSetOwnershipCrosswalk.count();
    await migrateSuitesToTaskSets(db);
    expect(await db.taskSetOwnershipCrosswalk.count()).toBe(xwalksBefore);
    expect(await snapshotAllSources(db)).toBe(before);
  });

  // --- unresolved-fusion-owner ----------------------------------------------

  it("unresolved-fusion-owner: explicit unresolved owner state; no Fusion entity reparented; legacy read remains possible", async () => {
    const db = await makeDb();
    const current = suite({ version: 4, tasks: [task()] });
    await seedSuite(db, current);
    await seedTaskCrosswalk(db, "suite-1", 4, task(), "ctask-1", 1);
    // Study references a suiteVersion/protocolFingerprint that was never reconstructed.
    const suiteRef: SuiteSnapshotRef = {
      suiteId: "suite-1",
      suiteVersion: 9,
      protocolFingerprint: "sha256:never",
    };
    await seedFusionFull(db, suiteRef, "exploratory");
    const before = await snapshotAllSources(db);

    const result = await migrateSuitesToTaskSets(db);

    expect(result.complete).toBe(true);
    expect(result.unresolvedFusionOwners).toBe(1);
    const fusionXwalk = (await xwalks(db, "fusion-owner"))[0];
    expect(fusionXwalk).toBeDefined();
    expect(fusionXwalk.status).toBe("unresolved");
    expect(fusionXwalk.version).toBeNull();
    // No Fusion entity reparented.
    expect(await snapshotAllSources(db)).toBe(before);
  });

  // --- partial-migration-and-repeat-startup --------------------------------

  it("partial-migration-and-repeat-startup: exact rows reused, missing completed once, marker only after verification, repeat is no-op", async () => {
    const db = await makeDb();
    const a = suite({ id: "suite-a", version: 1, tasks: [task()] });
    const b = suite({ id: "suite-b", version: 1, tasks: [task({ prompt: "Different." })] });
    await seedSuite(db, a);
    await seedSuite(db, b);
    await seedTaskCrosswalk(db, "suite-a", 1, task(), "ctask-a", 1);
    await seedTaskCrosswalk(db, "suite-b", 1, b.tasks[0], "ctask-b", 1);
    // Run once to establish exact rows.
    await migrateSuitesToTaskSets(db);
    const aRows = await db.taskSetVersions.where("taskSetId").equals("suite-a").toArray();
    const aXwalks = await db.taskSetOwnershipCrosswalk
      .where("taskSetId")
      .equals("suite-a")
      .toArray();
    const marker = await db.storageMeta.get(taskSetMigrationMarkerKey);
    expect(marker).toBeDefined();

    // Simulate interruption: drop suite-b's rows + marker, keep suite-a's exact rows.
    await db.taskSetVersions.where("taskSetId").equals("suite-b").delete();
    await db.taskSetOwnershipCrosswalk.where("taskSetId").equals("suite-b").delete();
    await db.taskSets.delete("suite-b");
    await db.storageMeta.delete(taskSetMigrationMarkerKey);
    const before = await snapshotAllSources(db);

    // Resume: suite-a exact rows reused, suite-b completed, marker re-written.
    const result = await migrateSuitesToTaskSets(db);
    expect(result.complete).toBe(true);
    const aRowsAfter = await db.taskSetVersions.where("taskSetId").equals("suite-a").toArray();
    const aXwalksAfter = await db.taskSetOwnershipCrosswalk
      .where("taskSetId")
      .equals("suite-a")
      .toArray();
    expect(aRowsAfter).toEqual(aRows);
    expect(aXwalksAfter).toEqual(aXwalks);
    expect(await db.taskSets.get("suite-b")).toBeDefined();
    expect(await db.storageMeta.get(taskSetMigrationMarkerKey)).toBeDefined();
    expect(await snapshotAllSources(db)).toBe(before);

    // Repeat startup is a no-op.
    const countBefore = await db.taskSetVersions.count();
    const xwalksBefore = await db.taskSetOwnershipCrosswalk.count();
    await migrateSuitesToTaskSets(db);
    expect(await db.taskSetVersions.count()).toBe(countBefore);
    expect(await db.taskSetOwnershipCrosswalk.count()).toBe(xwalksBefore);
  });

  it("partial-migration-and-repeat-startup: non-identical collision aborts without source writes or marker", async () => {
    const db = await makeDb();
    const a = suite({ id: "suite-a", version: 1, tasks: [task()] });
    await seedSuite(db, a);
    await seedTaskCrosswalk(db, "suite-a", 1, task(), "ctask-a", 1);
    // Preseed a non-identical collision for suite-a's version 1.
    await db.taskSets.put({
      id: "suite-a",
      record: {
        id: "suite-a",
        latestVersion: 99,
        name: "Tampered",
        description: "",
        createdAt: 1,
        updatedAt: 1,
        archivedAt: null,
        revision: 0,
        origin: "legacy-suite",
      },
      latestVersion: 99,
      createdAt: 1,
      updatedAt: 1,
      archivedAt: null,
      origin: "legacy-suite",
      revision: 0,
    });
    const before = await snapshotAllSources(db);

    await expect(migrateSuitesToTaskSets(db)).rejects.toThrow();
    // No marker written.
    expect(await db.storageMeta.get(taskSetMigrationMarkerKey)).toBeUndefined();
    // Source payloads unchanged.
    expect(await snapshotAllSources(db)).toBe(before);
  });

  // --- unresolved-child-02-crosswalk ----------------------------------------

  it("unresolved-child-02-crosswalk: member preserved as explicitly unresolved; partial history readable; blocks new paid execution", async () => {
    const db = await makeDb();
    const resolvedTask = task({ id: "task-1" });
    const unresolvedTask = task({ id: "task-2", title: "Other", prompt: "Other prompt." });
    const current = suite({ version: 1, tasks: [resolvedTask, unresolvedTask] });
    await seedSuite(db, current);
    // Only task-1 has a crosswalk; task-2 does not.
    await seedTaskCrosswalk(db, "suite-1", 1, resolvedTask, "ctask-1", 1);
    const before = await snapshotAllSources(db);

    const result = await migrateSuitesToTaskSets(db);

    expect(result.complete).toBe(true);
    expect(result.unresolvedMembers).toBeGreaterThanOrEqual(1);
    const v1 = (await db.taskSetVersions.where("taskSetId").equals("suite-1").toArray())[0];
    const version = v1.version_ as {
      members: Array<{
        id: string;
        unresolved: string | null;
        taskVersionRef: { taskId: string; version: number };
      }>;
    };
    const unresolvedMember = version.members.find((m) => m.id === "task-2");
    expect(unresolvedMember).toBeDefined();
    expect(unresolvedMember?.unresolved).not.toBeNull();
    expect(unresolvedMember?.taskVersionRef).toEqual({ taskId: "", version: 0 });
    // Member order/overrides preserved.
    expect(version.members.map((m) => m.id)).toEqual(["task-1", "task-2"]);
    // Source unchanged.
    expect(await snapshotAllSources(db)).toBe(before);
  });

  // --- F1: repeat-startup terminal marker (review repair) -------------------

  it("F1 repeat-startup: valid terminal marker makes repeat a no-write (storageMeta byte-for-byte unchanged)", async () => {
    const db = await makeDb();
    const current = suite({ version: 2 });
    const hist = experiment({
      id: "exp-1",
      suiteId: "suite-1",
      suiteVersion: 1,
      snapshot: snapshot({ suiteVersion: 1, createdAt: 15, tasks: [task()] }),
      createdAt: 15,
    });
    await seedSuite(db, current);
    await seedExperiment(db, hist);
    await seedTaskCrosswalk(db, "suite-1", 1, task(), "ctask-1", 1);
    await seedTaskCrosswalk(db, "suite-1", 2, task(), "ctask-1", 1);

    await migrateSuitesToTaskSets(db);
    const markerBefore = await db.storageMeta.get(taskSetMigrationMarkerKey);
    expect(markerBefore).toBeDefined();
    const storageMetaBefore = canonicalJsonString(await db.storageMeta.toArray());
    const completedAtBefore = (markerBefore!.value as { completedAt: number }).completedAt;

    // Repeat startup must perform no writes: storageMeta byte-for-byte identical.
    await migrateSuitesToTaskSets(db);
    const markerAfter = await db.storageMeta.get(taskSetMigrationMarkerKey);
    expect(canonicalJsonString(await db.storageMeta.toArray())).toBe(storageMetaBefore);
    // The completion timestamp must not advance on repeat.
    expect((markerAfter!.value as { completedAt: number }).completedAt).toBe(completedAtBefore);
  });

  it("F1 repeat-startup: pre-existing valid terminal marker short-circuits before planning even when a collision would abort", async () => {
    const db = await makeDb();
    const current = suite({ version: 1, tasks: [task()] });
    await seedSuite(db, current);
    await seedTaskCrosswalk(db, "suite-1", 1, task(), "ctask-1", 1);
    // Pre-seed a valid terminal marker.
    await db.storageMeta.put({
      key: taskSetMigrationMarkerKey,
      value: {
        kind: "task-set-migration",
        version: 1,
        completedAt: 12345,
        migratedSuites: 1,
        unresolvedMembers: 0,
        unresolvedExperiments: 0,
        unresolvedFusionOwners: 0,
      },
    });
    // Introduce a non-identical collision that would abort if the plan ran.
    await db.taskSets.put({
      id: "suite-1",
      record: {
        id: "suite-1",
        latestVersion: 99,
        name: "Tampered",
        description: "",
        createdAt: 1,
        updatedAt: 1,
        archivedAt: null,
        revision: 0,
        origin: "legacy-suite",
      },
      latestVersion: 99,
      createdAt: 1,
      updatedAt: 1,
      archivedAt: null,
      origin: "legacy-suite",
      revision: 0,
    });
    const storageMetaBefore = canonicalJsonString(await db.storageMeta.toArray());
    const versionsBefore = await db.taskSetVersions.count();
    const xwalksBefore = await db.taskSetOwnershipCrosswalk.count();

    const result = await migrateSuitesToTaskSets(db);

    expect(result.complete).toBe(true);
    expect(await db.taskSetVersions.count()).toBe(versionsBefore);
    expect(await db.taskSetOwnershipCrosswalk.count()).toBe(xwalksBefore);
    expect(canonicalJsonString(await db.storageMeta.toArray())).toBe(storageMetaBefore);
  });

  // --- F2: Fusion coordinate ambiguity / Trial-Playbook disagreement ---------

  it("F2 fusion-owner: duplicate-coordinate ambiguity (same suiteRef, distinct digests) stays unresolved", async () => {
    const db = await makeDb();
    // Two experiments share the same (suiteId, suiteVersion, protocolFingerprint)
    // coordinate but carry distinct workload digests — possible because the
    // migration digest includes fields the legacy protocol fingerprint omits
    // (here: judgeInstructionOverride). judgeInstructionOverride is NOT part of
    // the legacy definition digest, so both tasks share one crosswalk entry.
    const tA = task({ judgeInstructionOverride: "Judge A." });
    const tB = task({ judgeInstructionOverride: "Judge B." });
    const eA = experiment({
      id: "exp-a",
      suiteId: "suite-1",
      suiteVersion: 1,
      snapshot: snapshot({
        suiteVersion: 1,
        protocolFingerprint: "sha256:shared",
        tasks: [tA],
        createdAt: 10,
      }),
      createdAt: 10,
    });
    const eB = experiment({
      id: "exp-b",
      suiteId: "suite-1",
      suiteVersion: 1,
      snapshot: snapshot({
        suiteVersion: 1,
        protocolFingerprint: "sha256:shared",
        tasks: [tB],
        createdAt: 20,
      }),
      createdAt: 20,
    });
    await seedExperiment(db, eA);
    await seedExperiment(db, eB);
    // Current suite at a different version so its coordinate differs.
    const current = suite({ version: 2, tasks: [task({ judgeInstructionOverride: "Current." })] });
    await seedSuite(db, current);
    await seedTaskCrosswalk(db, "suite-1", 1, tA, "ctask-1", 1);
    await seedTaskCrosswalk(db, "suite-1", 2, current.tasks[0], "ctask-1", 1);
    // Fusion Study references the ambiguous shared coordinate.
    const suiteRef: SuiteSnapshotRef = {
      suiteId: "suite-1",
      suiteVersion: 1,
      protocolFingerprint: "sha256:shared",
    };
    await seedFusionFull(db, suiteRef, "exploratory");
    const before = await snapshotAllSources(db);

    const result = await migrateSuitesToTaskSets(db);

    expect(result.complete).toBe(true);
    expect(result.unresolvedFusionOwners).toBe(1);
    const fusionXwalk = (await xwalks(db, "fusion-owner"))[0];
    expect(fusionXwalk).toBeDefined();
    expect(fusionXwalk.status).toBe("unresolved");
    expect(fusionXwalk.version).toBeNull();
    expect(fusionXwalk.note).toBe("ambiguous-suiteRef");
    // No Fusion entity reparented.
    expect(await snapshotAllSources(db)).toBe(before);
  });

  it("F2 fusion-owner: Trial/Playbook suiteRef disagreement with an otherwise unique coordinate stays unresolved", async () => {
    const db = await makeDb();
    const current = suite({ version: 1, tasks: [task()] });
    await seedSuite(db, current);
    await seedTaskCrosswalk(db, "suite-1", 1, task(), "ctask-1", 1);
    const suiteRef: SuiteSnapshotRef = {
      suiteId: "suite-1",
      suiteVersion: 1,
      protocolFingerprint: computeProtocolFingerprint(current, []),
    };
    await seedFusionFull(db, suiteRef, "exploratory");
    // Overwrite one Trial so its suiteRef disagrees with the Study's.
    const disagreeing = trial("trial-1", "study-1", {
      suiteId: "suite-1",
      suiteVersion: 1,
      protocolFingerprint: "sha256:different",
    });
    await (db as any).fusionTrials.put({
      id: disagreeing.id,
      trial: disagreeing,
      revision: disagreeing.revision,
      studyId: disagreeing.studyId,
      stage: disagreeing.stage,
      status: disagreeing.status,
      createdAt: disagreeing.createdAt,
    });
    const before = await snapshotAllSources(db);

    const result = await migrateSuitesToTaskSets(db);

    expect(result.complete).toBe(true);
    expect(result.unresolvedFusionOwners).toBe(1);
    const fusionXwalk = (await xwalks(db, "fusion-owner"))[0];
    expect(fusionXwalk.status).toBe("unresolved");
    expect(fusionXwalk.version).toBeNull();
    expect(fusionXwalk.note).toBe("trial-or-playbook-suiteRef-disagreement");
    expect(await snapshotAllSources(db)).toBe(before);
  });

  // --- F3: locale-independent ordinal ordering (review repair) ---------------

  it("F3 locale-independent ordering: equal suiteVersion/createdAt with locale-differing experiment ids yields ordinal digest order and version assignment", async () => {
    const db = await makeDb();
    // Two experiments tied on suiteVersion AND executedAt; their ids ("exp-a"
    // vs "exp-B") collate differently under a case-insensitive host locale
    // (en-US: "exp-a" < "exp-B") than under code-unit ordinal ("exp-B" < "exp-a"
    // because 0x42 < 0x61). Canonical version assignment must follow the
    // locale-independent ordinal order, not the host collation.
    const tLower = task({ judgeInstructionOverride: "Lower id digest." });
    const tUpper = task({ judgeInstructionOverride: "Upper id digest." });
    const eLower = experiment({
      id: "exp-a",
      suiteId: "suite-1",
      suiteVersion: 1,
      snapshot: snapshot({
        suiteVersion: 1,
        protocolFingerprint: "sha256:lower",
        tasks: [tLower],
        createdAt: 100,
      }),
      createdAt: 100,
    });
    const eUpper = experiment({
      id: "exp-B",
      suiteId: "suite-1",
      suiteVersion: 1,
      snapshot: snapshot({
        suiteVersion: 1,
        protocolFingerprint: "sha256:upper",
        tasks: [tUpper],
        createdAt: 100,
      }),
      createdAt: 100,
    });
    await seedExperiment(db, eLower);
    await seedExperiment(db, eUpper);
    const current = suite({ version: 2, tasks: [task({ judgeInstructionOverride: "Current." })] });
    await seedSuite(db, current);
    await seedTaskCrosswalk(db, "suite-1", 1, tLower, "ctask-1", 1);
    await seedTaskCrosswalk(db, "suite-1", 2, current.tasks[0], "ctask-1", 1);
    const before = await snapshotAllSources(db);

    const result = await migrateSuitesToTaskSets(db);

    expect(result.complete).toBe(true);
    expect(result.createdVersions).toBe(3);
    // Ordinal tie-break: "exp-B" (0x42) < "exp-a" (0x61), so exp-B is the
    // chronologically first observation → canonical version 1.
    const upperXwalk = (await xwalks(db, "experiment-owner")).find(
      (r) => r.experimentId === "exp-B",
    );
    const lowerXwalk = (await xwalks(db, "experiment-owner")).find(
      (r) => r.experimentId === "exp-a",
    );
    expect(upperXwalk?.version).toBe(1);
    expect(lowerXwalk?.version).toBe(2);
    expect(await snapshotAllSources(db)).toBe(before);
  });

  // --- marker ordering + completion -----------------------------------------

  it("writes the completion marker only after verification and exposes a versioned marker", async () => {
    const db = await makeDb();
    const current = suite({ version: 1, tasks: [task()] });
    await seedSuite(db, current);
    await seedTaskCrosswalk(db, "suite-1", 1, task(), "ctask-1", 1);

    const result = await migrateSuitesToTaskSets(db);
    expect(result.complete).toBe(true);

    const marker = await db.storageMeta.get(taskSetMigrationMarkerKey);
    expect(marker).toBeDefined();
    const value = marker!.value as { kind: string; version: number; completedAt: number };
    expect(value.kind).toBe("task-set-migration");
    expect(value.version).toBe(1);
  });
});

// Helper used by the fusion fixture to add a confirmed study + playbook.
async function seedFusionConfirmed(
  db: RSembleEvaluationDB,
  suiteRef: SuiteSnapshotRef,
): Promise<void> {
  const s = study("study-2", suiteRef, "confirmed");
  await (db as any).fusionStudies.put({
    id: s.id,
    study: s,
    revision: s.revision,
    suiteId: s.suiteRef.suiteId,
    suiteVersion: s.suiteRef.suiteVersion,
    status: s.status,
    updatedAt: s.updatedAt,
  });
  const t = trial("trial-c", "study-2", suiteRef);
  await (db as any).fusionTrials.put({
    id: t.id,
    trial: t,
    revision: t.revision,
    studyId: t.studyId,
    stage: t.stage,
    status: t.status,
    createdAt: t.createdAt,
  });
  const pb = playbook("playbook-2", "study-2", suiteRef, "confirmed");
  await (db as any).fusionPlaybooks.put({
    id: pb.id,
    playbook: pb,
    studyId: pb.studyId,
    createdAt: pb.createdAt,
  });
}
