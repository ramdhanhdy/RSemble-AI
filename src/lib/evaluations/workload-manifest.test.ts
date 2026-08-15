// =============================================================================
// workload-manifest.test.ts — Task Set Workload Materialization & Deterministic
// Semantic Protocol Fingerprints (Child 03 Milestone A Task 2).
// =============================================================================

import { describe, expect, it } from "vitest";
import type { ModelSlot } from "../../studio-data";
import type { EvaluationRubric, EvaluationSelection, GradedEvaluationCriterion } from "./evaluation-types";
import type {
  JudgeSnapshot,
  MissingnessPolicy,
  ProtocolDefaults,
  RepeatPolicy,
  TaskExecutionOverrides,
  TaskSetMember,
  TaskSetRecord,
  TaskSetVersion,
  TaskVersionRef,
} from "./task-set-types";
import type {
  ContextManifestEntry,
  ResponseContract,
  TaskRecord,
  TaskVersion,
  VersionRef,
} from "../tasks/task-types";
import {
  ArchivedTaskExecutionError,
  DirtyDraftExecutionError,
  UnresolvedWorkloadRefError,
  buildWorkloadFingerprintInput,
  computeWorkloadManifestFingerprint,
  materializeWorkloadManifest,
  validateWorkloadForExecution,
  type MaterializedTask,
  type MaterializedWorkloadSnapshot,
  type WorkloadCatalogResolvers,
} from "./workload-manifest";

// --- Fixtures & Helpers ------------------------------------------------------

function makeTaskRecord(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: "task-1",
    latestVersion: 1,
    createdAt: 1000,
    updatedAt: 1000,
    archivedAt: null,
    origin: "authored",
    revision: 1,
    ...overrides,
  };
}

function makeTaskVersion(overrides: Partial<TaskVersion> = {}): TaskVersion {
  return {
    taskId: "task-1",
    version: 1,
    title: "Task One Title",
    objective: "Task One Objective",
    candidateInstruction: "Solve problem X using method Y.",
    defaultContextManifest: [],
    responseContract: null,
    taskVerifierRef: null,
    source: { kind: "authored", legacyScopeKey: null, note: null },
    createdAt: 1000,
    ...overrides,
  };
}

function makeRubric(overrides: Partial<EvaluationRubric> = {}): EvaluationRubric {
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
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

const DEFAULT_SLOTS: ModelSlot[] = [
  {
    id: "slot-1",
    providerId: "openai",
    provider: "OpenAI",
    model: "gpt-4o",
    slug: "gpt-4o",
    enabled: true,
  },
  {
    id: "slot-2",
    providerId: "anthropic",
    provider: "Anthropic",
    model: "claude-3-5-sonnet",
    slug: "claude-3-5-sonnet",
    enabled: true,
  },
];

const DEFAULT_JUDGE: JudgeSnapshot = {
  providerId: "openai",
  model: "gpt-4o",
};

const DEFAULT_REPEAT_POLICY: RepeatPolicy = { kind: "none" };
const DEFAULT_MISSINGNESS_POLICY: MissingnessPolicy = { kind: "allow-repair" };
const DEFAULT_PROTOCOL_DEFAULTS: ProtocolDefaults = {
  reasoningPolicy: {
    candidate: { effort: "none" },
    judge: { effort: "low" },
  },
};

function makeTaskSetMember(overrides: Partial<TaskSetMember> = {}): TaskSetMember {
  return {
    id: "mem-1",
    taskVersionRef: { taskId: "task-1", version: 1 },
    order: 0,
    role: "organic",
    stratum: null,
    weight: 1.0,
    rubricOverrideRef: null,
    executionOverrides: null,
    unresolved: null,
    ...overrides,
  };
}

function makeTaskSetVersion(overrides: Partial<TaskSetVersion> = {}): TaskSetVersion {
  return {
    taskSetId: "task-set-1",
    version: 1,
    members: [makeTaskSetMember()],
    defaultRubricRef: { id: "rubric-1", version: 1 },
    defaultModelSlots: DEFAULT_SLOTS,
    defaultJudge: DEFAULT_JUDGE,
    repeatPolicy: DEFAULT_REPEAT_POLICY,
    missingnessPolicy: DEFAULT_MISSINGNESS_POLICY,
    protocolDefaults: DEFAULT_PROTOCOL_DEFAULTS,
    createdAt: 2000,
    ...overrides,
  };
}

function makeCatalogResolvers(
  tasks: TaskVersion[] = [makeTaskVersion()],
  rubrics: EvaluationRubric[] = [makeRubric()],
  archivedTaskIds: Set<string> = new Set(),
  archivedRubricIds: Set<string> = new Set(),
): WorkloadCatalogResolvers {
  const taskMap = new Map<string, TaskVersion>();
  for (const t of tasks) {
    taskMap.set(`${t.taskId}::v${t.version}`, t);
  }

  const rubricMap = new Map<string, EvaluationRubric>();
  for (const r of rubrics) {
    rubricMap.set(`${r.id}::v${r.version}`, r);
  }

  return {
    getTaskVersion: (ref: TaskVersionRef) => taskMap.get(`${ref.taskId}::v${ref.version}`) ?? null,
    getRubricVersion: (ref: VersionRef) => rubricMap.get(`${ref.id}::v${ref.version}`) ?? null,
    isTaskArchived: (taskId: string) => archivedTaskIds.has(taskId),
    isRubricArchived: (rubricId: string) => archivedRubricIds.has(rubricId),
  };
}

// =============================================================================
// 1. Exact Task & Rubric Resolution
// =============================================================================

describe("Workload Manifest Materialization: Exact Reference Resolution", () => {
  it("resolves exact Task Version and default Rubric Version refs into a complete snapshot", () => {
    const taskA = makeTaskVersion({
      taskId: "task-A",
      version: 2,
      title: "Task A v2",
      objective: "Objective A v2",
      candidateInstruction: "Instruction A v2",
    });
    const taskB = makeTaskVersion({
      taskId: "task-B",
      version: 1,
      title: "Task B v1",
      objective: "Objective B v1",
      candidateInstruction: "Instruction B v1",
    });
    const rubricDefault = makeRubric({ id: "rubric-default", version: 1 });
    const rubricCustom = makeRubric({
      id: "rubric-custom",
      version: 3,
      name: "Custom Rubric v3",
    });

    const resolvers = makeCatalogResolvers([taskA, taskB], [rubricDefault, rubricCustom]);

    const taskSetVersion = makeTaskSetVersion({
      members: [
        makeTaskSetMember({
          id: "m1",
          taskVersionRef: { taskId: "task-A", version: 2 },
          order: 0,
          role: "organic",
          stratum: null,
          weight: 1.0,
          rubricOverrideRef: null,
        }),
        makeTaskSetMember({
          id: "m2",
          taskVersionRef: { taskId: "task-B", version: 1 },
          order: 1,
          role: "anchor",
          stratum: "code",
          weight: 2.5,
          rubricOverrideRef: { id: "rubric-custom", version: 3 },
        }),
      ],
      defaultRubricRef: { id: "rubric-default", version: 1 },
    });

    const snapshot = materializeWorkloadManifest(taskSetVersion, resolvers, { now: 5000 });

    expect(snapshot.taskSetId).toBe("task-set-1");
    expect(snapshot.taskSetVersion).toBe(1);
    expect(snapshot.createdAt).toBe(5000);
    expect(snapshot.tasks).toHaveLength(2);

    // Member 1: inherits default rubric
    const m1 = snapshot.tasks[0];
    expect(m1.memberId).toBe("m1");
    expect(m1.taskVersionRef).toEqual({ taskId: "task-A", version: 2 });
    expect(m1.task.title).toBe("Task A v2");
    expect(m1.task.objective).toBe("Objective A v2");
    expect(m1.task.candidateInstruction).toBe("Instruction A v2");
    expect(m1.effectiveRubricRef).toEqual({ id: "rubric-default", version: 1 });
    expect(m1.effectiveRubric?.id).toBe("rubric-default");
    expect(m1.evaluation).toEqual({
      kind: "profile",
      profile: { id: "rubric-default", version: 1 },
    });

    // Member 2: has custom rubric override
    const m2 = snapshot.tasks[1];
    expect(m2.memberId).toBe("m2");
    expect(m2.taskVersionRef).toEqual({ taskId: "task-B", version: 1 });
    expect(m2.task.title).toBe("Task B v1");
    expect(m2.role).toBe("anchor");
    expect(m2.stratum).toBe("code");
    expect(m2.weight).toBe(2.5);
    expect(m2.effectiveRubricRef).toEqual({ id: "rubric-custom", version: 3 });
    expect(m2.effectiveRubric?.id).toBe("rubric-custom");
    expect(m2.effectiveRubric?.name).toBe("Custom Rubric v3");
    expect(m2.evaluation).toEqual({
      kind: "profile",
      profile: { id: "rubric-custom", version: 3 },
    });

    // Deduplicated rubrics array contains both rubrics
    expect(snapshot.rubrics).toHaveLength(2);
    expect(snapshot.rubrics.map((r) => r.id).sort()).toEqual(["rubric-custom", "rubric-default"]);
  });

  it("handles holistic evaluation when defaultRubricRef is null", () => {
    const task = makeTaskVersion({ taskId: "task-1", version: 1 });
    const resolvers = makeCatalogResolvers([task], []);

    const taskSetVersion = makeTaskSetVersion({
      defaultRubricRef: null,
      members: [makeTaskSetMember({ rubricOverrideRef: null })],
    });

    const snapshot = materializeWorkloadManifest(taskSetVersion, resolvers);

    expect(snapshot.defaultRubricRef).toBeNull();
    expect(snapshot.defaultRubric).toBeNull();
    expect(snapshot.rubrics).toHaveLength(0);
    expect(snapshot.tasks[0].effectiveRubricRef).toBeNull();
    expect(snapshot.tasks[0].effectiveRubric).toBeNull();
    expect(snapshot.tasks[0].evaluation).toEqual({ kind: "holistic" });
  });

  it("preserves task execution overrides (judge instruction, verification, evaluation)", () => {
    const task = makeTaskVersion({
      taskId: "task-1",
      version: 1,
      taskVerifierRef: { id: "verifier-default", version: 1 },
    });
    const rubric = makeRubric();
    const resolvers = makeCatalogResolvers([task], [rubric]);

    const overrides: TaskExecutionOverrides = {
      judgeInstructionOverride: "Special judge criteria for this task",
      verification: { kind: "exact_match" },
      evaluation: { kind: "holistic" },
    };

    const taskSetVersion = makeTaskSetVersion({
      members: [
        makeTaskSetMember({
          executionOverrides: overrides,
        }),
      ],
    });

    const snapshot = materializeWorkloadManifest(taskSetVersion, resolvers);
    const m = snapshot.tasks[0];

    expect(m.judgeInstructionOverride).toBe("Special judge criteria for this task");
    expect(m.verification).toEqual({ kind: "exact_match" });
    expect(m.evaluation).toEqual({ kind: "holistic" });
    expect(m.executionOverrides).toEqual(overrides);
  });
});

// =============================================================================
// 2. Deterministic Member Order
// =============================================================================

describe("Workload Manifest Materialization: Deterministic Member Order", () => {
  it("sorts members deterministically by member.order ascending regardless of input array order", () => {
    const task1 = makeTaskVersion({ taskId: "t1", version: 1 });
    const task2 = makeTaskVersion({ taskId: "t2", version: 1 });
    const task3 = makeTaskVersion({ taskId: "t3", version: 1 });
    const rubric = makeRubric();
    const resolvers = makeCatalogResolvers([task1, task2, task3], [rubric]);

    const m1 = makeTaskSetMember({ id: "m1", order: 0, taskVersionRef: { taskId: "t1", version: 1 } });
    const m2 = makeTaskSetMember({ id: "m2", order: 1, taskVersionRef: { taskId: "t2", version: 1 } });
    const m3 = makeTaskSetMember({ id: "m3", order: 2, taskVersionRef: { taskId: "t3", version: 1 } });

    // Permuted array [m3, m1, m2]
    const versionA = makeTaskSetVersion({ members: [m3, m1, m2] });
    // Permuted array [m2, m3, m1]
    const versionB = makeTaskSetVersion({ members: [m2, m3, m1] });

    const snapA = materializeWorkloadManifest(versionA, resolvers);
    const snapB = materializeWorkloadManifest(versionB, resolvers);

    expect(snapA.tasks.map((t) => t.taskVersionRef.taskId)).toEqual(["t1", "t2", "t3"]);
    expect(snapB.tasks.map((t) => t.taskVersionRef.taskId)).toEqual(["t1", "t2", "t3"]);
    expect(snapA.protocolFingerprint).toBe(snapB.protocolFingerprint);
  });

  it("uses stable secondary tie-breaker when member order is equal", () => {
    const taskA = makeTaskVersion({ taskId: "tA", version: 1 });
    const taskB = makeTaskVersion({ taskId: "tB", version: 1 });
    const rubric = makeRubric();
    const resolvers = makeCatalogResolvers([taskA, taskB], [rubric]);

    const m1 = makeTaskSetMember({ id: "m1", order: 0, taskVersionRef: { taskId: "tA", version: 1 } });
    const m2 = makeTaskSetMember({ id: "m2", order: 0, taskVersionRef: { taskId: "tB", version: 1 } });

    const snapA = materializeWorkloadManifest(makeTaskSetVersion({ members: [m1, m2] }), resolvers);
    const snapB = materializeWorkloadManifest(makeTaskSetVersion({ members: [m2, m1] }), resolvers);

    expect(snapA.tasks.map((t) => t.memberId)).toEqual(snapB.tasks.map((t) => t.memberId));
    expect(snapA.protocolFingerprint).toBe(snapB.protocolFingerprint);
  });
});

// =============================================================================
// 3. Immutability & Deep Cloning
// =============================================================================

describe("Workload Manifest Materialization: Immutable Snapshot", () => {
  it("deep clones all task, rubric, and slot entities so source mutations do not affect snapshot", () => {
    const task = makeTaskVersion({
      taskId: "task-1",
      version: 1,
      title: "Original Task Title",
      defaultContextManifest: [{ role: "doc", artifactId: "art-1", externalRef: null, metadataDigest: null, mediaType: "text/plain", byteCount: 100 }],
      responseContract: { format: "json", constraints: ["c1"], maxLength: 500 },
    });
    const rubric = makeRubric({
      id: "rubric-1",
      name: "Original Rubric Name",
      criteria: [
        {
          id: "c1",
          kind: "graded",
          name: "Original Crit",
          description: "desc",
          weight: 1.0,
          anchors: { one: "1", two: "2", three: "3", four: "4", five: "5" },
        },
      ],
    });
    const slot: ModelSlot = {
      id: "s1",
      providerId: "openai",
      provider: "OpenAI",
      model: "gpt-4o",
      slug: "gpt-4o",
      enabled: true,
    };

    const resolvers = makeCatalogResolvers([task], [rubric]);
    const taskSetVersion = makeTaskSetVersion({
      defaultModelSlots: [slot],
      members: [makeTaskSetMember()],
    });

    const snapshot = materializeWorkloadManifest(taskSetVersion, resolvers);
    const initialFingerprint = snapshot.protocolFingerprint;

    // Mutate source task object in-place
    task.title = "MUTATED TASK TITLE";
    task.defaultContextManifest.push({ role: "extra", artifactId: null, externalRef: null, metadataDigest: null, mediaType: null, byteCount: null });
    task.responseContract!.maxLength = 9999;

    // Mutate source rubric object in-place
    rubric.name = "MUTATED RUBRIC NAME";
    (rubric.criteria[0] as GradedEvaluationCriterion).weight = 99;

    // Mutate source slot object in-place
    slot.model = "MUTATED MODEL";

    // Snapshot remains untouched
    expect(snapshot.tasks[0].task.title).toBe("Original Task Title");
    expect(snapshot.tasks[0].task.defaultContextManifest).toHaveLength(1);
    expect(snapshot.tasks[0].task.responseContract?.maxLength).toBe(500);
    expect(snapshot.rubrics[0].name).toBe("Original Rubric Name");
    expect((snapshot.rubrics[0].criteria[0] as GradedEvaluationCriterion).weight).toBe(1.0);
    expect(snapshot.defaultModelSlots[0].model).toBe("gpt-4o");

    // Fingerprint remains identical
    expect(snapshot.protocolFingerprint).toBe(initialFingerprint);
  });
});

// =============================================================================
// 4. Archived Reference Handling
// =============================================================================

describe("Workload Manifest Materialization: Archived References", () => {
  it("allows materialization for historical replay with isArchived: true when allowArchived is true", () => {
    const task = makeTaskVersion({ taskId: "archived-task", version: 1 });
    const rubric = makeRubric({ id: "archived-rubric", version: 1 });
    const resolvers = makeCatalogResolvers(
      [task],
      [rubric],
      new Set(["archived-task"]),
      new Set(["archived-rubric"]),
    );

    const taskSetVersion = makeTaskSetVersion({
      defaultRubricRef: { id: "archived-rubric", version: 1 },
      members: [makeTaskSetMember({ taskVersionRef: { taskId: "archived-task", version: 1 } })],
    });

    const snapshot = materializeWorkloadManifest(taskSetVersion, resolvers, { allowArchived: true });

    expect(snapshot.tasks[0].isArchived).toBe(true);
    expect(snapshot.tasks).toHaveLength(1);
  });

  it("throws ArchivedTaskExecutionError when allowArchived is false", () => {
    const task = makeTaskVersion({ taskId: "archived-task", version: 1 });
    const rubric = makeRubric();
    const resolvers = makeCatalogResolvers([task], [rubric], new Set(["archived-task"]));

    const taskSetVersion = makeTaskSetVersion({
      members: [makeTaskSetMember({ taskVersionRef: { taskId: "archived-task", version: 1 } })],
    });

    expect(() =>
      materializeWorkloadManifest(taskSetVersion, resolvers, { allowArchived: false }),
    ).toThrow(ArchivedTaskExecutionError);
  });

  it("validateWorkloadForExecution reports archived status and warnings", () => {
    const task = makeTaskVersion({ taskId: "archived-task", version: 1 });
    const rubric = makeRubric();
    const resolvers = makeCatalogResolvers([task], [rubric], new Set(["archived-task"]));

    const taskSetVersion = makeTaskSetVersion({
      members: [makeTaskSetMember({ taskVersionRef: { taskId: "archived-task", version: 1 } })],
    });

    const result = validateWorkloadForExecution({
      version: taskSetVersion,
      resolvers,
      allowArchived: true,
    });

    expect(result.valid).toBe(true);
    expect(result.hasArchivedRefs).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toMatch(/archived/i);
  });

  it("validateWorkloadForExecution fails if allowArchived is false", () => {
    const task = makeTaskVersion({ taskId: "archived-task", version: 1 });
    const rubric = makeRubric();
    const resolvers = makeCatalogResolvers([task], [rubric], new Set(["archived-task"]));

    const taskSetVersion = makeTaskSetVersion({
      members: [makeTaskSetMember({ taskVersionRef: { taskId: "archived-task", version: 1 } })],
    });

    const result = validateWorkloadForExecution({
      version: taskSetVersion,
      resolvers,
      allowArchived: false,
    });

    expect(result.valid).toBe(false);
    expect(result.hasArchivedRefs).toBe(true);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/archived/i);
  });
});

// =============================================================================
// 5. Unresolved & Malformed Reference Handling
// =============================================================================

describe("Workload Manifest Materialization: Unresolved References", () => {
  it("throws UnresolvedWorkloadRefError if a Task Version ref does not resolve in the catalog", () => {
    const resolvers = makeCatalogResolvers([], [makeRubric()]);
    const taskSetVersion = makeTaskSetVersion({
      members: [makeTaskSetMember({ taskVersionRef: { taskId: "missing-task", version: 99 } })],
    });

    expect(() => materializeWorkloadManifest(taskSetVersion, resolvers)).toThrow(
      UnresolvedWorkloadRefError,
    );
  });

  it("throws UnresolvedWorkloadRefError if defaultRubricRef does not resolve in the catalog", () => {
    const resolvers = makeCatalogResolvers([makeTaskVersion()], []);
    const taskSetVersion = makeTaskSetVersion({
      defaultRubricRef: { id: "missing-rubric", version: 5 },
    });

    expect(() => materializeWorkloadManifest(taskSetVersion, resolvers)).toThrow(
      UnresolvedWorkloadRefError,
    );
  });

  it("throws UnresolvedWorkloadRefError if member.rubricOverrideRef does not resolve in the catalog", () => {
    const resolvers = makeCatalogResolvers([makeTaskVersion()], [makeRubric()]);
    const taskSetVersion = makeTaskSetVersion({
      members: [
        makeTaskSetMember({
          rubricOverrideRef: { id: "missing-override-rubric", version: 2 },
        }),
      ],
    });

    expect(() => materializeWorkloadManifest(taskSetVersion, resolvers)).toThrow(
      UnresolvedWorkloadRefError,
    );
  });

  it("throws UnresolvedWorkloadRefError if a member has unresolved property set", () => {
    const resolvers = makeCatalogResolvers([makeTaskVersion()], [makeRubric()]);
    const taskSetVersion = makeTaskSetVersion({
      members: [
        makeTaskSetMember({
          unresolved: "unmapped",
        }),
      ],
    });

    expect(() => materializeWorkloadManifest(taskSetVersion, resolvers)).toThrow(
      UnresolvedWorkloadRefError,
    );
  });

  it("validateWorkloadForExecution returns structured unresolved diagnostics", () => {
    const resolvers = makeCatalogResolvers([], []);
    const taskSetVersion = makeTaskSetVersion({
      defaultRubricRef: { id: "missing-rubric", version: 1 },
      members: [
        makeTaskSetMember({
          taskVersionRef: { taskId: "missing-task", version: 2 },
          unresolved: "no-crosswalk",
        }),
      ],
    });

    const result = validateWorkloadForExecution({ version: taskSetVersion, resolvers });

    expect(result.valid).toBe(false);
    expect(result.unresolved.length).toBeGreaterThanOrEqual(1);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// 6. Dirty Draft Rejection
// =============================================================================

describe("Workload Manifest Materialization: Dirty Draft Rejection", () => {
  it("validateWorkloadForExecution rejects execution when isDirty is true", () => {
    const resolvers = makeCatalogResolvers([makeTaskVersion()], [makeRubric()]);
    const taskSetVersion = makeTaskSetVersion();

    const result = validateWorkloadForExecution({
      version: taskSetVersion,
      resolvers,
      isDirty: true,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "Cannot execute dirty Task Set draft without saving or discarding changes.",
    );
  });

  it("materializeWorkloadManifest rejects execution if isDirty is true in options", () => {
    const resolvers = makeCatalogResolvers([makeTaskVersion()], [makeRubric()]);
    const taskSetVersion = makeTaskSetVersion();

    expect(() =>
      materializeWorkloadManifest(taskSetVersion, resolvers, { isDirty: true }),
    ).toThrow(DirtyDraftExecutionError);
  });
});

// =============================================================================
// 7. Roles, Strata, Weights, Policies & Defaults Preservation
// =============================================================================

describe("Workload Manifest Materialization: Policies & Metadata", () => {
  it("preserves member roles, strata, and positive weights in the materialized snapshot", () => {
    const taskA = makeTaskVersion({ taskId: "tA", version: 1 });
    const taskB = makeTaskVersion({ taskId: "tB", version: 1 });
    const taskC = makeTaskVersion({ taskId: "tC", version: 1 });
    const taskD = makeTaskVersion({ taskId: "tD", version: 1 });
    const resolvers = makeCatalogResolvers([taskA, taskB, taskC, taskD], [makeRubric()]);

    const taskSetVersion = makeTaskSetVersion({
      members: [
        makeTaskSetMember({ id: "m1", taskVersionRef: { taskId: "tA", version: 1 }, order: 0, role: "organic", stratum: "strat-1", weight: 1.0 }),
        makeTaskSetMember({ id: "m2", taskVersionRef: { taskId: "tB", version: 1 }, order: 1, role: "anchor", stratum: null, weight: 3.5 }),
        makeTaskSetMember({ id: "m3", taskVersionRef: { taskId: "tC", version: 1 }, order: 2, role: "calibration", stratum: "strat-2", weight: 0.5 }),
        makeTaskSetMember({ id: "m4", taskVersionRef: { taskId: "tD", version: 1 }, order: 3, role: "holdout", stratum: "strat-2", weight: 2.0 }),
      ],
    });

    const snapshot = materializeWorkloadManifest(taskSetVersion, resolvers);

    expect(snapshot.tasks[0].role).toBe("organic");
    expect(snapshot.tasks[0].stratum).toBe("strat-1");
    expect(snapshot.tasks[0].weight).toBe(1.0);

    expect(snapshot.tasks[1].role).toBe("anchor");
    expect(snapshot.tasks[1].stratum).toBeNull();
    expect(snapshot.tasks[1].weight).toBe(3.5);

    expect(snapshot.tasks[2].role).toBe("calibration");
    expect(snapshot.tasks[2].stratum).toBe("strat-2");
    expect(snapshot.tasks[2].weight).toBe(0.5);

    expect(snapshot.tasks[3].role).toBe("holdout");
    expect(snapshot.tasks[3].stratum).toBe("strat-2");
    expect(snapshot.tasks[3].weight).toBe(2.0);
  });

  it("preserves repeat policy and missingness policy in snapshot", () => {
    const resolvers = makeCatalogResolvers([makeTaskVersion()], [makeRubric()]);

    const taskSetVersion = makeTaskSetVersion({
      repeatPolicy: { kind: "declared-replicate", count: 5 },
      missingnessPolicy: { kind: "strict" },
    });

    const snapshot = materializeWorkloadManifest(taskSetVersion, resolvers);

    expect(snapshot.repeatPolicy).toEqual({ kind: "declared-replicate", count: 5 });
    expect(snapshot.missingnessPolicy).toEqual({ kind: "strict" });
  });

  it("preserves protocol defaults including reasoning policy", () => {
    const resolvers = makeCatalogResolvers([makeTaskVersion()], [makeRubric()]);

    const protocolDefaults: ProtocolDefaults = {
      reasoningPolicy: {
        candidate: { effort: "high" },
        judge: { effort: "medium" },
      },
    };

    const taskSetVersion = makeTaskSetVersion({ protocolDefaults });
    const snapshot = materializeWorkloadManifest(taskSetVersion, resolvers);

    expect(snapshot.protocolDefaults).toEqual(protocolDefaults);
  });
});

// =============================================================================
// 8. Deterministic Semantic Protocol Fingerprints & Sensitivity Matrix
// =============================================================================

describe("Workload Manifest Fingerprint: Semantic Sensitivity & Invariance", () => {
  it("produces canonical sha256:<hex> shape", () => {
    const resolvers = makeCatalogResolvers([makeTaskVersion()], [makeRubric()]);
    const snapshot = materializeWorkloadManifest(makeTaskSetVersion(), resolvers);

    expect(snapshot.protocolFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("changes when task candidateInstruction changes", () => {
    const taskA = makeTaskVersion({ candidateInstruction: "Instruction A" });
    const taskB = makeTaskVersion({ candidateInstruction: "Instruction B" });
    const rubric = makeRubric();

    const snapA = materializeWorkloadManifest(
      makeTaskSetVersion(),
      makeCatalogResolvers([taskA], [rubric]),
    );
    const snapB = materializeWorkloadManifest(
      makeTaskSetVersion(),
      makeCatalogResolvers([taskB], [rubric]),
    );

    expect(snapA.protocolFingerprint).not.toBe(snapB.protocolFingerprint);
  });

  it("changes when task title or objective changes", () => {
    const taskA = makeTaskVersion({ title: "Title A", objective: "Obj A" });
    const taskB = makeTaskVersion({ title: "Title B", objective: "Obj A" });
    const rubric = makeRubric();

    const snapA = materializeWorkloadManifest(
      makeTaskSetVersion(),
      makeCatalogResolvers([taskA], [rubric]),
    );
    const snapB = materializeWorkloadManifest(
      makeTaskSetVersion(),
      makeCatalogResolvers([taskB], [rubric]),
    );

    expect(snapA.protocolFingerprint).not.toBe(snapB.protocolFingerprint);
  });

  it("changes when member order, role, stratum, or weight changes", () => {
    const task = makeTaskVersion();
    const rubric = makeRubric();
    const resolvers = makeCatalogResolvers([task], [rubric]);

    const base = materializeWorkloadManifest(
      makeTaskSetVersion({
        members: [makeTaskSetMember({ role: "organic", stratum: null, weight: 1.0 })],
      }),
      resolvers,
    );

    const changedRole = materializeWorkloadManifest(
      makeTaskSetVersion({
        members: [makeTaskSetMember({ role: "anchor", stratum: null, weight: 1.0 })],
      }),
      resolvers,
    );

    const changedStratum = materializeWorkloadManifest(
      makeTaskSetVersion({
        members: [makeTaskSetMember({ role: "organic", stratum: "code", weight: 1.0 })],
      }),
      resolvers,
    );

    const changedWeight = materializeWorkloadManifest(
      makeTaskSetVersion({
        members: [makeTaskSetMember({ role: "organic", stratum: null, weight: 2.0 })],
      }),
      resolvers,
    );

    expect(base.protocolFingerprint).not.toBe(changedRole.protocolFingerprint);
    expect(base.protocolFingerprint).not.toBe(changedStratum.protocolFingerprint);
    expect(base.protocolFingerprint).not.toBe(changedWeight.protocolFingerprint);
  });

  it("changes when rubric criteria or requirement groups change", () => {
    const task = makeTaskVersion();
    const rubricA = makeRubric();
    const rubricB = makeRubric({
      criteria: [
        {
          id: "c1",
          kind: "graded",
          name: "Accuracy",
          description: "Factual correctness - MODIFIED",
          weight: 1,
          anchors: {
            one: "1",
            two: "2",
            three: "3",
            four: "4",
            five: "5",
          },
        },
      ],
    });

    const snapA = materializeWorkloadManifest(
      makeTaskSetVersion(),
      makeCatalogResolvers([task], [rubricA]),
    );
    const snapB = materializeWorkloadManifest(
      makeTaskSetVersion(),
      makeCatalogResolvers([task], [rubricB]),
    );

    expect(snapA.protocolFingerprint).not.toBe(snapB.protocolFingerprint);
  });

  it("changes when model roster (provider, model, enabled) changes", () => {
    const task = makeTaskVersion();
    const rubric = makeRubric();
    const resolvers = makeCatalogResolvers([task], [rubric]);

    const snapA = materializeWorkloadManifest(makeTaskSetVersion(), resolvers);
    const snapB = materializeWorkloadManifest(
      makeTaskSetVersion({
        defaultModelSlots: [
          DEFAULT_SLOTS[0],
          { ...DEFAULT_SLOTS[1], enabled: false },
        ],
      }),
      resolvers,
    );

    expect(snapA.protocolFingerprint).not.toBe(snapB.protocolFingerprint);
  });

  it("changes when judge or reasoning policy changes", () => {
    const task = makeTaskVersion();
    const rubric = makeRubric();
    const resolvers = makeCatalogResolvers([task], [rubric]);

    const snapA = materializeWorkloadManifest(makeTaskSetVersion(), resolvers);
    const snapB = materializeWorkloadManifest(
      makeTaskSetVersion({
        defaultJudge: { providerId: "anthropic", model: "claude-3-5-sonnet" },
      }),
      resolvers,
    );

    const snapC = materializeWorkloadManifest(
      makeTaskSetVersion({
        protocolDefaults: {
          reasoningPolicy: {
            candidate: { effort: "high" },
            judge: { effort: "high" },
          },
        },
      }),
      resolvers,
    );

    expect(snapA.protocolFingerprint).not.toBe(snapB.protocolFingerprint);
    expect(snapA.protocolFingerprint).not.toBe(snapC.protocolFingerprint);
  });

  it("changes when repeat policy or missingness policy changes", () => {
    const task = makeTaskVersion();
    const rubric = makeRubric();
    const resolvers = makeCatalogResolvers([task], [rubric]);

    const base = materializeWorkloadManifest(makeTaskSetVersion(), resolvers);
    const withReplicate = materializeWorkloadManifest(
      makeTaskSetVersion({ repeatPolicy: { kind: "declared-replicate", count: 3 } }),
      resolvers,
    );
    const withStrictMissingness = materializeWorkloadManifest(
      makeTaskSetVersion({ missingnessPolicy: { kind: "strict" } }),
      resolvers,
    );

    expect(base.protocolFingerprint).not.toBe(withReplicate.protocolFingerprint);
    expect(base.protocolFingerprint).not.toBe(withStrictMissingness.protocolFingerprint);
  });

  it("ignores cosmetic/non-semantic fields (taskSetId, createdAt, slot.id, slot.provider display, member.id)", () => {
    const task = makeTaskVersion();
    const rubric = makeRubric();
    const resolvers = makeCatalogResolvers([task], [rubric]);

    const base = materializeWorkloadManifest(
      makeTaskSetVersion({
        taskSetId: "set-1",
        createdAt: 1000,
        defaultModelSlots: [
          { id: "slot-A", providerId: "openai", provider: "OpenAI Display", model: "gpt-4o", slug: "gpt-4o", enabled: true },
        ],
        members: [
          makeTaskSetMember({ id: "mem-uuid-1", order: 0 }),
        ],
      }),
      resolvers,
      { now: 1000 },
    );

    const cosmeticVariant = materializeWorkloadManifest(
      makeTaskSetVersion({
        taskSetId: "set-DIFFERENT-ID",
        createdAt: 99999,
        defaultModelSlots: [
          { id: "slot-DIFFERENT-ID", providerId: "openai", provider: "Custom Label", model: "gpt-4o", slug: "gpt-4o", enabled: true },
        ],
        members: [
          makeTaskSetMember({ id: "mem-uuid-DIFFERENT", order: 0 }),
        ],
      }),
      resolvers,
      { now: 99999 },
    );

    expect(base.protocolFingerprint).toBe(cosmeticVariant.protocolFingerprint);
  });
});
