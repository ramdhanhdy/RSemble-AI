// =============================================================================
// RSemble AI — Canonical Task Set domain validator + Suite compat tests
//
// Child 03 (Task Sets and Context-Owned Evaluation Results) Milestone A —
// Task 1. RED → GREEN.
//
// Covers (spec §3, §5.3, §8.2, §8.3, acceptance):
//  - TaskSetRecord structural validity + malformed records
//  - immutable TaskSetVersion structural validity + malformed versions
//  - TaskSetMember exact TaskVersion refs, order, role, stratum, positive weight
//  - Rubric refs (defaultRubricRef) and per-member rubricOverrideRef
//  - roster (defaultModelSlots), judge (defaultJudge JudgeSnapshot)
//  - repeat / missingness / protocol defaults
//  - malformed refs and unresolved refs (validateTaskSetVersionRefs)
//  - legacy EvaluationSuite compatibility adapter preserves current serialized
//    semantics without making Suite canonical or mutating source values
//
// Reuses the project's confirmed validation idioms (probe-P1-task-domain-
// patterns): PROHIBITED_KEYS deep scan, CREDENTIAL_LIKE_VALUE, {valid, errors}
// validators, and boolean is* guards at the persistence boundary.
// =============================================================================

import { describe, expect, it } from "vitest";

import type { EvaluationSuite, EvaluationTask } from "./evaluation-types";
import type { ModelSlot } from "../../studio-data";

import {
  CREDENTIAL_LIKE_VALUE,
  ID_PATTERN,
  PROHIBITED_KEYS,
  hasProhibitedKeys,
  isJudgeSnapshot,
  isMissingnessPolicy,
  isProtocolDefaults,
  isRepeatPolicy,
  isTaskExecutionOverrides,
  isTaskSetMember,
  isTaskSetMemberRole,
  isTaskSetOrigin,
  isTaskSetRecord,
  isTaskSetVersion,
  isTaskVersionRef,
  validateTaskSetMember,
  validateTaskSetRecord,
  validateTaskSetVersion,
  validateTaskSetVersionRefs,
  type JudgeSnapshot,
  type TaskSetMember,
  type TaskSetMemberRole,
  type TaskSetOrigin,
  type TaskSetRecord,
  type TaskSetVersion,
  type TaskVersionRef,
} from "./task-set-types";

import { suiteToTaskSetRecord, suiteToTaskSetVersion, type TaskCrosswalk } from "./suite-compat";

// --- fixtures ----------------------------------------------------------------

function makeSlot(
  id: string,
  slug: string,
  providerId: ModelSlot["providerId"] = "openrouter",
  enabled = true,
): ModelSlot {
  return {
    id,
    providerId,
    provider: providerId,
    model: `org/${slug}`,
    slug,
    enabled,
  };
}

function makeJudge(): JudgeSnapshot {
  return { providerId: "openrouter", model: "org/judge" };
}

function makeMember(overrides: Partial<TaskSetMember> = {}): TaskSetMember {
  return {
    id: "m1",
    taskVersionRef: { taskId: "task-1", version: 1 },
    order: 0,
    role: "organic",
    stratum: null,
    weight: 1,
    rubricOverrideRef: null,
    executionOverrides: null,
    unresolved: null,
    ...overrides,
  };
}

function makeVersion(overrides: Partial<TaskSetVersion> = {}): TaskSetVersion {
  return {
    taskSetId: "set-1",
    version: 1,
    members: [makeMember()],
    defaultRubricRef: { id: "rubric-1", version: 1 },
    defaultModelSlots: [makeSlot("s1", "m1"), makeSlot("s2", "m2")],
    defaultJudge: makeJudge(),
    repeatPolicy: { kind: "none" },
    missingnessPolicy: { kind: "allow-repair" },
    protocolDefaults: {},
    createdAt: 1_000,
    ...overrides,
  };
}

function makeRecord(overrides: Partial<TaskSetRecord> = {}): TaskSetRecord {
  return {
    id: "set-1",
    latestVersion: 1,
    name: "My Task Set",
    description: "A canonical task set.",
    createdAt: 1_000,
    updatedAt: 1_000,
    archivedAt: null,
    revision: 0,
    origin: "authored",
    ...overrides,
  };
}

function makeLegacyTask(id: string, overrides: Partial<EvaluationTask> = {}): EvaluationTask {
  return {
    id,
    title: `Task ${id}`,
    prompt: "Do the thing.",
    systemPrompt: "",
    evaluation: { kind: "inherit" },
    judgeInstructionOverride: "",
    order: 0,
    ...overrides,
  };
}

function makeLegacySuite(overrides: Partial<EvaluationSuite> = {}): EvaluationSuite {
  return {
    id: "suite-1",
    revision: 0,
    version: 1,
    name: "Legacy Suite",
    description: "A legacy evaluation suite.",
    tasks: [makeLegacyTask("t1", { order: 0 }), makeLegacyTask("t2", { order: 1 })],
    modelSlots: [makeSlot("s1", "m1"), makeSlot("s2", "m2")],
    defaultJudge: { providerId: "openrouter", model: "org/judge" },
    defaultEvaluation: { kind: "holistic" },
    createdAt: 1_000,
    updatedAt: 1_000,
    archivedAt: null,
    ...overrides,
  };
}

// --- TaskSetOrigin / role ----------------------------------------------------

describe("isTaskSetOrigin", () => {
  it("accepts authored, legacy-suite, imported", () => {
    expect(isTaskSetOrigin("authored")).toBe(true);
    expect(isTaskSetOrigin("legacy-suite")).toBe(true);
    expect(isTaskSetOrigin("imported")).toBe(true);
  });
  it("rejects unknown and non-string values", () => {
    expect(isTaskSetOrigin("suite")).toBe(false);
    expect(isTaskSetOrigin(null)).toBe(false);
    expect(isTaskSetOrigin(1)).toBe(false);
  });
});

describe("isTaskSetMemberRole", () => {
  const roles: TaskSetMemberRole[] = ["organic", "anchor", "calibration", "holdout"];
  it("accepts the four canonical roles", () => {
    for (const r of roles) expect(isTaskSetMemberRole(r)).toBe(true);
  });
  it("rejects unknown roles", () => {
    expect(isTaskSetMemberRole("seed")).toBe(false);
    expect(isTaskSetMemberRole(null)).toBe(false);
  });
});

// --- TaskVersionRef ----------------------------------------------------------

describe("isTaskVersionRef", () => {
  it("accepts a well-formed exact task version ref", () => {
    expect(isTaskVersionRef({ taskId: "task-1", version: 1 })).toBe(true);
  });
  it("rejects missing/zero version, bad taskId, and prohibited keys", () => {
    expect(isTaskVersionRef({ taskId: "task-1" })).toBe(false);
    expect(isTaskVersionRef({ taskId: "task-1", version: 0 })).toBe(false);
    expect(isTaskVersionRef({ taskId: "bad id!", version: 1 })).toBe(false);
    expect(isTaskVersionRef({ taskId: "task-1", version: 1, apiKey: "x" })).toBe(false);
  });
});

// --- JudgeSnapshot -----------------------------------------------------------

describe("isJudgeSnapshot", () => {
  it("accepts a critic-shaped snapshot with optional reasoning policy", () => {
    expect(isJudgeSnapshot({ providerId: "openrouter", model: "org/judge" })).toBe(true);
    expect(
      isJudgeSnapshot({
        providerId: "gemini",
        model: "org/judge",
        reasoningPolicy: { candidates: "high", judge: "high" },
      }),
    ).toBe(true);
  });
  it("rejects missing provider/model, bad reasoning policy, prohibited keys", () => {
    expect(isJudgeSnapshot({ providerId: "openrouter" })).toBe(false);
    expect(isJudgeSnapshot({ providerId: "openrouter", model: "" })).toBe(false);
    expect(isJudgeSnapshot({ providerId: "openrouter", model: "x", reasoningPolicy: {} })).toBe(
      false,
    );
    expect(isJudgeSnapshot({ providerId: "openrouter", model: "x", secret: "v" })).toBe(false);
  });
});

// --- RepeatPolicy / MissingnessPolicy / ProtocolDefaults ---------------------

describe("isRepeatPolicy", () => {
  it("accepts none and declared-replicate with positive count", () => {
    expect(isRepeatPolicy({ kind: "none" })).toBe(true);
    expect(isRepeatPolicy({ kind: "declared-replicate", count: 3 })).toBe(true);
  });
  it("rejects unknown kind, non-positive count, and prohibited keys", () => {
    expect(isRepeatPolicy({ kind: "always" })).toBe(false);
    expect(isRepeatPolicy({ kind: "declared-replicate", count: 0 })).toBe(false);
    expect(isRepeatPolicy({ kind: "declared-replicate", count: -1 })).toBe(false);
    expect(isRepeatPolicy({ kind: "none", apiKey: "x" })).toBe(false);
  });
});

describe("isMissingnessPolicy", () => {
  it("accepts strict and allow-repair", () => {
    expect(isMissingnessPolicy({ kind: "strict" })).toBe(true);
    expect(isMissingnessPolicy({ kind: "allow-repair" })).toBe(true);
  });
  it("rejects unknown kind and prohibited keys", () => {
    expect(isMissingnessPolicy({ kind: "skip" })).toBe(false);
    expect(isMissingnessPolicy({ kind: "strict", token: "x" })).toBe(false);
  });
});

describe("isProtocolDefaults", () => {
  it("accepts empty and valid reasoning policy", () => {
    expect(isProtocolDefaults({})).toBe(true);
    expect(isProtocolDefaults({ reasoningPolicy: { candidates: "low", judge: "low" } })).toBe(true);
  });
  it("rejects bad reasoning policy and prohibited keys", () => {
    expect(isProtocolDefaults({ reasoningPolicy: { candidates: "low" } })).toBe(false);
    expect(isProtocolDefaults({ env: "X" })).toBe(false);
  });
});

// --- TaskExecutionOverrides --------------------------------------------------

describe("isTaskExecutionOverrides", () => {
  it("accepts null and a populated override object", () => {
    expect(isTaskExecutionOverrides(null)).toBe(true);
    expect(
      isTaskExecutionOverrides({
        evaluation: { kind: "inherit" },
        judgeInstructionOverride: "be strict",
        verification: { kind: "exact_match" },
      }),
    ).toBe(true);
  });
  it("rejects malformed evaluation, verification, and prohibited keys", () => {
    expect(isTaskExecutionOverrides({ evaluation: { kind: "nope" } })).toBe(false);
    expect(isTaskExecutionOverrides({ verification: { kind: "nope" } })).toBe(false);
    expect(isTaskExecutionOverrides({ apiKey: "x" })).toBe(false);
  });
});

// --- TaskSetMember guard -----------------------------------------------------

describe("isTaskSetMember", () => {
  it("accepts a well-formed resolved member", () => {
    expect(isTaskSetMember(makeMember())).toBe(true);
  });
  it("accepts an unresolved member carrying a reason", () => {
    expect(
      isTaskSetMember(
        makeMember({
          taskVersionRef: { taskId: "", version: 0 },
          unresolved: "no-crosswalk",
        }),
      ),
    ).toBe(true);
  });
  it("rejects bad role, non-positive weight, bad order, malformed ref, prohibited keys", () => {
    expect(isTaskSetMember(makeMember({ role: "seed" as TaskSetMemberRole }))).toBe(false);
    expect(isTaskSetMember(makeMember({ weight: 0 }))).toBe(false);
    expect(isTaskSetMember(makeMember({ weight: -1 }))).toBe(false);
    expect(isTaskSetMember(makeMember({ order: -1 }))).toBe(false);
    expect(isTaskSetMember(makeMember({ taskVersionRef: { taskId: "", version: 1 } }))).toBe(false);
    expect(isTaskSetMember(makeMember({ rubricOverrideRef: { id: "x", version: 0 } }))).toBe(false);
    expect(isTaskSetMember(makeMember({ stratum: 5 as unknown as string }))).toBe(false);
    expect(isTaskSetMember(makeMember({ apiKey: "x" } as unknown as Partial<TaskSetMember>))).toBe(
      false,
    );
  });
});

// --- TaskSetVersion guard ----------------------------------------------------

describe("isTaskSetVersion (immutable)", () => {
  it("accepts a well-formed version with a holistic (null) default rubric", () => {
    expect(isTaskSetVersion(makeVersion({ defaultRubricRef: null }))).toBe(true);
  });
  it("accepts a well-formed version with a pinned default rubric", () => {
    expect(
      isTaskSetVersion(makeVersion({ defaultRubricRef: { id: "rubric-1", version: 2 } })),
    ).toBe(true);
  });
  it("rejects empty members, bad taskSetId, non-positive version, malformed defaults", () => {
    expect(isTaskSetVersion(makeVersion({ members: [] }))).toBe(false);
    expect(isTaskSetVersion(makeVersion({ taskSetId: "bad id!" }))).toBe(false);
    expect(isTaskSetVersion(makeVersion({ version: 0 }))).toBe(false);
    expect(
      isTaskSetVersion(
        makeVersion({
          defaultJudge: { providerId: "openrouter" },
        } as unknown as Partial<TaskSetVersion>),
      ),
    ).toBe(false);
    expect(
      isTaskSetVersion(
        makeVersion({ defaultModelSlots: "x" } as unknown as Partial<TaskSetVersion>),
      ),
    ).toBe(false);
    expect(
      isTaskSetVersion(
        makeVersion({ repeatPolicy: { kind: "always" } } as unknown as Partial<TaskSetVersion>),
      ),
    ).toBe(false);
    expect(
      isTaskSetVersion(
        makeVersion({ missingnessPolicy: { kind: "skip" } } as unknown as Partial<TaskSetVersion>),
      ),
    ).toBe(false);
    expect(
      isTaskSetVersion(
        makeVersion({
          protocolDefaults: { reasoningPolicy: {} },
        } as unknown as Partial<TaskSetVersion>),
      ),
    ).toBe(false);
    expect(isTaskSetVersion(makeVersion({ defaultRubricRef: { id: "x", version: 0 } }))).toBe(
      false,
    );
  });
  it("rejects duplicate member ids and duplicate/non-negative orders", () => {
    expect(
      isTaskSetVersion(
        makeVersion({
          members: [makeMember({ id: "m1", order: 0 }), makeMember({ id: "m1", order: 1 })],
        }),
      ),
    ).toBe(false);
    expect(
      isTaskSetVersion(
        makeVersion({
          members: [makeMember({ id: "m1", order: 0 }), makeMember({ id: "m2", order: 0 })],
        }),
      ),
    ).toBe(false);
  });
  it("rejects prohibited keys anywhere in the version", () => {
    const v = makeVersion();
    (v as unknown as Record<string, unknown>).apiKey = "leak";
    expect(isTaskSetVersion(v)).toBe(false);
  });
});

// --- TaskSetRecord guard -----------------------------------------------------

describe("isTaskSetRecord", () => {
  it("accepts a well-formed record", () => {
    expect(isTaskSetRecord(makeRecord())).toBe(true);
  });
  it("rejects bad id, non-positive latestVersion, empty name, bad origin/revision, prohibited keys", () => {
    expect(isTaskSetRecord(makeRecord({ id: "bad id!" }))).toBe(false);
    expect(isTaskSetRecord(makeRecord({ latestVersion: 0 }))).toBe(false);
    expect(isTaskSetRecord(makeRecord({ name: "" }))).toBe(false);
    expect(isTaskSetRecord(makeRecord({ origin: "suite" as TaskSetOrigin }))).toBe(false);
    expect(isTaskSetRecord(makeRecord({ revision: -1 }))).toBe(false);
    expect(isTaskSetRecord(makeRecord({ archivedAt: "x" as unknown as number }))).toBe(false);
    const r = makeRecord();
    (r as unknown as Record<string, unknown>).token = "leak";
    expect(isTaskSetRecord(r)).toBe(false);
  });
});

// --- {valid, errors} validators ---------------------------------------------

describe("validateTaskSetRecord", () => {
  it("returns valid with no errors for a well-formed record", () => {
    const out = validateTaskSetRecord(makeRecord());
    expect(out.valid).toBe(true);
    expect(out.errors).toEqual([]);
  });
  it("accumulates field-specific errors for a malformed record", () => {
    const out = validateTaskSetRecord({
      id: "bad id!",
      latestVersion: 0,
      name: "",
      description: 1,
      createdAt: "x",
      updatedAt: null,
      archivedAt: "y",
      revision: -1,
      origin: "suite",
    });
    expect(out.valid).toBe(false);
    expect(out.errors.length).toBeGreaterThan(5);
    expect(out.errors.some((e) => e.field === "id")).toBe(true);
    expect(out.errors.some((e) => e.field === "latestVersion")).toBe(true);
    expect(out.errors.some((e) => e.field === "name")).toBe(true);
    expect(out.errors.some((e) => e.field === "origin")).toBe(true);
    expect(out.errors.some((e) => e.field === "revision")).toBe(true);
  });
});

describe("validateTaskSetVersion", () => {
  it("returns valid for a well-formed version", () => {
    const out = validateTaskSetVersion(makeVersion());
    expect(out.valid).toBe(true);
    expect(out.errors).toEqual([]);
  });
  it("reports empty members, bad defaults, and malformed members by index", () => {
    const out = validateTaskSetVersion(
      makeVersion({
        members: [
          makeMember({ id: "m1", order: 0, weight: 0 }),
          makeMember({ id: "m1", order: 0 }),
        ],
        defaultRubricRef: { id: "x", version: 0 },
        defaultJudge: { providerId: "openrouter" } as unknown as JudgeSnapshot,
      }),
    );
    expect(out.valid).toBe(false);
    expect(out.errors.some((e) => e.field === "members")).toBe(true);
    expect(out.errors.some((e) => e.field === "defaultRubricRef")).toBe(true);
    expect(out.errors.some((e) => e.field === "defaultJudge")).toBe(true);
  });
});

describe("validateTaskSetMember", () => {
  it("returns valid for a well-formed member", () => {
    expect(validateTaskSetMember(makeMember()).valid).toBe(true);
  });
  it("reports weight, role, order, and ref errors", () => {
    const out = validateTaskSetMember(
      makeMember({ weight: 0, role: "seed" as TaskSetMemberRole, order: -1 }),
    );
    expect(out.valid).toBe(false);
    expect(out.errors.some((e) => e.field === "weight")).toBe(true);
    expect(out.errors.some((e) => e.field === "role")).toBe(true);
    expect(out.errors.some((e) => e.field === "order")).toBe(true);
  });
});

// --- ref resolution: malformed + unresolved refs -----------------------------

describe("validateTaskSetVersionRefs", () => {
  const resolvers = {
    taskVersionExists: (ref: TaskVersionRef) => ref.taskId === "task-1" && ref.version === 1,
    rubricVersionExists: (ref: { id: string; version: number }) =>
      ref.id === "rubric-1" && ref.version === 1,
  };

  it("returns no unresolved refs when everything resolves", () => {
    const out = validateTaskSetVersionRefs(makeVersion(), resolvers);
    expect(out.unresolved).toEqual([]);
  });

  it("reports unresolved task version refs and rubric override refs", () => {
    const version = makeVersion({
      members: [
        makeMember({ id: "m1", taskVersionRef: { taskId: "task-1", version: 1 }, order: 0 }),
        makeMember({
          id: "m2",
          taskVersionRef: { taskId: "task-2", version: 1 },
          order: 1,
          rubricOverrideRef: { id: "rubric-2", version: 1 },
        }),
      ],
      defaultRubricRef: { id: "rubric-1", version: 1 },
    });
    const out = validateTaskSetVersionRefs(version, resolvers);
    expect(out.unresolved.length).toBe(2);
    expect(
      out.unresolved.some(
        (u) => u.field === "members[1].taskVersionRef" && u.reason.includes("task"),
      ),
    ).toBe(true);
    expect(
      out.unresolved.some(
        (u) => u.field === "members[1].rubricOverrideRef" && u.reason.includes("rubric"),
      ),
    ).toBe(true);
  });

  it("reports an unresolved default rubric ref", () => {
    const out = validateTaskSetVersionRefs(
      makeVersion({ defaultRubricRef: { id: "rubric-9", version: 1 } }),
      resolvers,
    );
    expect(out.unresolved.some((u) => u.field === "defaultRubricRef")).toBe(true);
  });

  it("treats unresolved-flagged members as unresolved regardless of resolver", () => {
    const version = makeVersion({
      members: [
        makeMember({
          id: "m1",
          taskVersionRef: { taskId: "task-1", version: 1 },
          order: 0,
          unresolved: "no-crosswalk",
        }),
      ],
    });
    const out = validateTaskSetVersionRefs(version, resolvers);
    expect(
      out.unresolved.some((u) => u.field === "members[0]" && u.reason.includes("no-crosswalk")),
    ).toBe(true);
  });

  it("skips null rubric refs (holistic) without reporting them unresolved", () => {
    const out = validateTaskSetVersionRefs(makeVersion({ defaultRubricRef: null }), resolvers);
    expect(out.unresolved).toEqual([]);
  });
});

// --- prohibited-key / credential idioms --------------------------------------

describe("PROHIBITED_KEYS / hasProhibitedKeys / CREDENTIAL_LIKE_VALUE / ID_PATTERN", () => {
  it("exposes the canonical 6-key prohibited set", () => {
    expect(PROHIBITED_KEYS.has("apiKey")).toBe(true);
    expect(PROHIBITED_KEYS.has("authorization")).toBe(true);
    expect(PROHIBITED_KEYS.has("token")).toBe(true);
    expect(PROHIBITED_KEYS.has("secret")).toBe(true);
    expect(PROHIBITED_KEYS.has("password")).toBe(true);
    expect(PROHIBITED_KEYS.has("env")).toBe(true);
    expect(PROHIBITED_KEYS.size).toBe(6);
  });
  it("deep-scans arrays and nested records", () => {
    expect(hasProhibitedKeys({ a: [{ b: { token: "x" } }] })).toBe(true);
    expect(hasProhibitedKeys({ a: [{ b: { ok: "x" } }] })).toBe(false);
  });
  it("credential-like value regex matches secret-shaped identifiers", () => {
    expect(CREDENTIAL_LIKE_VALUE.test("sk-abc")).toBe(true);
    expect(CREDENTIAL_LIKE_VALUE.test("AIzaXYZ")).toBe(true);
    expect(CREDENTIAL_LIKE_VALUE.test("Bearer xyz")).toBe(true);
    expect(CREDENTIAL_LIKE_VALUE.test("org/model")).toBe(false);
  });
  it("ID_PATTERN accepts opaque ids and rejects spaces", () => {
    expect(ID_PATTERN.test("set-1")).toBe(true);
    expect(ID_PATTERN.test("bad id!")).toBe(false);
  });
});

// --- Suite compatibility adapter --------------------------------------------

describe("suiteToTaskSetRecord (deprecated adapter)", () => {
  it("projects a legacy suite to a TaskSetRecord with origin legacy-suite", () => {
    const suite = makeLegacySuite();
    const record = suiteToTaskSetRecord(suite);
    expect(isTaskSetRecord(record)).toBe(true);
    expect(record.origin).toBe("legacy-suite");
    expect(record.id).toBe(suite.id);
    expect(record.name).toBe(suite.name);
    expect(record.description).toBe(suite.description);
    expect(record.latestVersion).toBe(suite.version);
    expect(record.revision).toBe(suite.revision);
    expect(record.createdAt).toBe(suite.createdAt);
    expect(record.updatedAt).toBe(suite.updatedAt);
    expect(record.archivedAt).toBe(suite.archivedAt);
  });

  it("does not mutate the source suite", () => {
    const suite = makeLegacySuite();
    const snapshot = JSON.stringify(suite);
    suiteToTaskSetRecord(suite);
    expect(JSON.stringify(suite)).toBe(snapshot);
  });
});

describe("suiteToTaskSetVersion (deprecated adapter)", () => {
  it("produces a structurally valid TaskSetVersion from a legacy suite", () => {
    const suite = makeLegacySuite();
    const { version, unresolvedMemberIds } = suiteToTaskSetVersion(suite);
    expect(isTaskSetVersion(version)).toBe(true);
    expect(version.taskSetId).toBe(suite.id);
    expect(version.version).toBe(suite.version);
    expect(version.members.length).toBe(suite.tasks.length);
    // Without a crosswalk, every embedded task is unresolved.
    expect(unresolvedMemberIds).toEqual(["t1", "t2"]);
    expect(version.members.every((m) => m.unresolved !== null)).toBe(true);
  });

  it("preserves order, roster, judge, and protocol semantics from the source", () => {
    const suite = makeLegacySuite({
      reasoningPolicy: { candidates: "high", judge: "high" },
      defaultEvaluation: { kind: "profile", profile: { id: "rubric-1", version: 1 } },
    });
    const { version } = suiteToTaskSetVersion(suite);
    expect(version.members.map((m) => m.order)).toEqual([0, 1]);
    expect(version.defaultModelSlots).toEqual(suite.modelSlots);
    expect(version.defaultJudge.providerId).toBe(suite.defaultJudge.providerId);
    expect(version.defaultJudge.model).toBe(suite.defaultJudge.model);
    // reasoningPolicy is preserved on protocolDefaults, not on the judge snapshot.
    expect(version.protocolDefaults.reasoningPolicy).toEqual(suite.reasoningPolicy);
    expect(version.defaultJudge.reasoningPolicy).toBeUndefined();
    // A pinned default rubric is projected to defaultRubricRef.
    expect(version.defaultRubricRef).toEqual({ id: "rubric-1", version: 1 });
    // Legacy missing-cell repair semantics map to allow-repair; no repeat concept.
    expect(version.missingnessPolicy).toEqual({ kind: "allow-repair" });
    expect(version.repeatPolicy).toEqual({ kind: "none" });
  });

  it("projects holistic default evaluation to a null default rubric ref", () => {
    const suite = makeLegacySuite({ defaultEvaluation: { kind: "holistic" } });
    const { version } = suiteToTaskSetVersion(suite);
    expect(version.defaultRubricRef).toBeNull();
  });

  it("resolves members through a provided crosswalk and reports the rest unresolved", () => {
    const suite = makeLegacySuite();
    const crosswalk: TaskCrosswalk = (task) =>
      task.id === "t1" ? { taskId: "task-1", version: 1 } : null;
    const { version, unresolvedMemberIds } = suiteToTaskSetVersion(suite, crosswalk);
    expect(version.members[0].unresolved).toBeNull();
    expect(version.members[0].taskVersionRef).toEqual({ taskId: "task-1", version: 1 });
    expect(unresolvedMemberIds).toEqual(["t2"]);
    expect(version.members[1].unresolved).not.toBeNull();
  });

  it("projects per-task evaluation overrides and rubric override refs", () => {
    const suite = makeLegacySuite({
      tasks: [
        makeLegacyTask("t1", {
          order: 0,
          evaluation: { kind: "profile", profile: { id: "rubric-2", version: 1 } },
          judgeInstructionOverride: "be strict",
          verification: { kind: "exact_match" },
        }),
        makeLegacyTask("t2", { order: 1, evaluation: { kind: "inherit" } }),
      ],
    });
    const crosswalk: TaskCrosswalk = () => ({ taskId: "task-1", version: 1 });
    const { version } = suiteToTaskSetVersion(suite, crosswalk);
    const m1 = version.members[0];
    expect(m1.rubricOverrideRef).toEqual({ id: "rubric-2", version: 1 });
    expect(m1.executionOverrides?.evaluation).toEqual({
      kind: "profile",
      profile: { id: "rubric-2", version: 1 },
    });
    expect(m1.executionOverrides?.judgeInstructionOverride).toBe("be strict");
    expect(m1.executionOverrides?.verification).toEqual({ kind: "exact_match" });
    const m2 = version.members[1];
    expect(m2.rubricOverrideRef).toBeNull();
    expect(m2.executionOverrides?.evaluation).toEqual({ kind: "inherit" });
  });

  it("does not mutate the source suite", () => {
    const suite = makeLegacySuite();
    const snapshot = JSON.stringify(suite);
    suiteToTaskSetVersion(suite);
    expect(JSON.stringify(suite)).toBe(snapshot);
  });

  it("F3: projection returns fresh evaluation/verification objects — mutating them leaves the source suite unchanged", () => {
    const suite = makeLegacySuite({
      tasks: [
        makeLegacyTask("t1", {
          order: 0,
          evaluation: { kind: "profile", profile: { id: "rubric-2", version: 1 } },
          judgeInstructionOverride: "be strict",
          verification: { kind: "exact_match" },
        }),
        makeLegacyTask("t2", { order: 1, evaluation: { kind: "inherit" } }),
      ],
    });
    const snapshot = JSON.stringify(suite);
    const crosswalk: TaskCrosswalk = () => ({ taskId: "task-1", version: 1 });
    const { version } = suiteToTaskSetVersion(suite, crosswalk);

    const overrides = version.members[0].executionOverrides;
    expect(overrides).not.toBeNull();
    if (overrides?.evaluation?.kind === "profile") {
      overrides.evaluation.profile = { id: "corrupted", version: 999 };
    }
    if (overrides?.verification) {
      overrides.verification.kind = "numeric";
    }
    overrides!.judgeInstructionOverride = "corrupted";

    expect(JSON.stringify(suite)).toBe(snapshot);
  });

  it("does not make Suite canonical: members stay unresolved without a crosswalk", () => {
    const suite = makeLegacySuite();
    const { version } = suiteToTaskSetVersion(suite);
    // No synthetic task ids are invented; unresolved members carry a reason.
    expect(version.members.every((m) => m.unresolved !== null)).toBe(true);
    expect(version.members.every((m) => m.unresolved === "no-crosswalk")).toBe(true);
  });
});
