// =============================================================================
// RSemble AI — Comparison Result index domain tests (Child 05 — Task 1)
//
// Specifies the summary-only ComparisonResultIndex contract before any
// implementation exists (spec §3, §7, §9):
//
//  - comparisonId == runId: the index is keyed one-to-one by the source run;
//  - ad hoc bindings reference an immutable input snapshot; canonical
//    bindings pin an exact Task Version;
//  - lineage links a deliberate "Run again" source and never claims
//    replicate status;
//  - active observation ids, receipt/index revisions, status, and mode are
//    validated exactly;
//  - malformed bindings, secret-shaped keys/values, and raw candidate
//    outputs or judge rationale are rejected — the index never copies exact
//    result content; RunRecordV2 remains the exact result authority.
// =============================================================================

import { describe, expect, it } from "vitest";
import type { ComparisonResultIndex } from "./comparison-result-types";
import {
  isComparisonLineage,
  isComparisonMode,
  isComparisonResultIndex,
  isComparisonTaskBinding,
  validateComparisonLineage,
  validateComparisonResultIndex,
  validateComparisonTaskBinding,
} from "./comparison-result-validation";

const SNAPSHOT_REF = `snap:sha256:${"a".repeat(64)}`;

/** Canonical valid ad-hoc index fixture; overrides replace whole fields. */
function makeIndex(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "run-compare-1",
    runId: "run-compare-1",
    createdAt: 1_755_000_000_000,
    updatedAt: 1_755_000_001_000,
    status: "completed",
    mode: "rank",
    title: "Baseline rubric check",
    taskBinding: { kind: "ad_hoc", inputSnapshotRef: SNAPSHOT_REF },
    taskInstanceId: null,
    activeObservationIds: ["obs:one", "obs:two"],
    evidenceReceiptRevision: 0,
    lineage: { repeatedFrom: null },
    revision: 1,
    ...overrides,
  };
}

function indexErrors(v: unknown): string[] {
  const result = validateComparisonResultIndex(v);
  return result.ok ? [] : result.errors.map((e) => `${e.field}: ${e.message}`);
}

/** Detailed-validator errors as a single searchable text block. */
function joinedErrors(result: {
  ok: false;
  errors: Array<{ field: string; message: string }>;
}): string {
  return result.errors.map((e) => `${e.field}: ${e.message}`).join("\n");
}

describe("id / run id equality", () => {
  it("accepts a valid ad-hoc index", () => {
    const result = validateComparisonResultIndex(makeIndex());
    expect(result.ok).toBe(true);
    expect(isComparisonResultIndex(makeIndex())).toBe(true);
  });

  it("accepts a valid canonical index", () => {
    const index = makeIndex({
      taskBinding: { kind: "canonical", taskId: "task-42", taskVersion: 3 },
      taskInstanceId: "task-inst-7",
    });
    expect(validateComparisonResultIndex(index).ok).toBe(true);
  });

  it("returns the validated value with the canonical shape", () => {
    const result = validateComparisonResultIndex(makeIndex());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBe("run-compare-1");
    expect(result.value.runId).toBe("run-compare-1");
    expect(result.value.lineage.repeatedFrom).toBeNull();
  });

  it("rejects an index whose id differs from its runId", () => {
    const errors = indexErrors(makeIndex({ id: "run-compare-9" }));
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join("\n")).toContain("id must equal runId");
  });

  it("rejects a missing or non-string id", () => {
    expect(indexErrors(makeIndex({ id: undefined })).join("\n")).toContain("id");
    expect(indexErrors(makeIndex({ id: 42 })).join("\n")).toContain("id");
  });

  it("rejects a missing or non-string runId", () => {
    expect(indexErrors(makeIndex({ runId: undefined })).join("\n")).toContain("runId");
    expect(indexErrors(makeIndex({ runId: null })).join("\n")).toContain("runId");
  });
});

describe("task binding", () => {
  it("accepts an ad-hoc binding with a safe input snapshot ref", () => {
    const binding = { kind: "ad_hoc", inputSnapshotRef: SNAPSHOT_REF };
    const result = validateComparisonTaskBinding(binding);
    expect(result.ok).toBe(true);
    expect(isComparisonTaskBinding(binding)).toBe(true);
  });

  it("accepts a canonical binding with an exact task version", () => {
    const binding = { kind: "canonical", taskId: "task-42", taskVersion: 3 };
    expect(validateComparisonTaskBinding(binding).ok).toBe(true);
    expect(isComparisonTaskBinding(binding)).toBe(true);
  });

  it("rejects unknown binding kinds", () => {
    const result = validateComparisonTaskBinding({ kind: "fancy", inputSnapshotRef: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(joinedErrors(result)).toContain('kind must be "ad_hoc" or "canonical"');
  });

  it("rejects a non-object binding", () => {
    const result = validateComparisonTaskBinding("ad_hoc");
    expect(result.ok).toBe(false);
    expect(isComparisonTaskBinding("ad_hoc")).toBe(false);
  });

  it("rejects an ad-hoc binding without an inputSnapshotRef", () => {
    const result = validateComparisonTaskBinding({ kind: "ad_hoc" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(joinedErrors(result)).toContain("inputSnapshotRef");
  });

  it("rejects a canonical binding without a taskId", () => {
    const result = validateComparisonTaskBinding({ kind: "canonical", taskVersion: 3 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(joinedErrors(result)).toContain("taskId");
  });

  it("rejects a canonical binding whose taskVersion is not a positive integer", () => {
    for (const taskVersion of [0, -1, 1.5, Number.NaN, "3"]) {
      const result = validateComparisonTaskBinding({
        kind: "canonical",
        taskId: "task-42",
        taskVersion,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(joinedErrors(result)).toContain("taskVersion");
    }
  });

  it("rejects ad-hoc bindings carrying canonical fields", () => {
    const result = validateComparisonTaskBinding({
      kind: "ad_hoc",
      inputSnapshotRef: SNAPSHOT_REF,
      taskId: "task-42",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(joinedErrors(result)).toContain('unknown field "taskId"');
  });

  it("rejects canonical bindings carrying ad-hoc fields", () => {
    const result = validateComparisonTaskBinding({
      kind: "canonical",
      taskId: "task-42",
      taskVersion: 3,
      inputSnapshotRef: SNAPSHOT_REF,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(joinedErrors(result)).toContain('unknown field "inputSnapshotRef"');
  });

  it("rejects credential-shaped identifiers in either binding kind", () => {
    const adHoc = validateComparisonTaskBinding({
      kind: "ad_hoc",
      inputSnapshotRef: "sk-live-abc",
    });
    expect(adHoc.ok).toBe(false);
    const canonical = validateComparisonTaskBinding({
      kind: "canonical",
      taskId: "Bearer xyz",
      taskVersion: 1,
    });
    expect(canonical.ok).toBe(false);
  });
});

describe("ad hoc / canonical invariants", () => {
  it("rejects an ad-hoc index carrying a task instance id", () => {
    const errors = indexErrors(makeIndex({ taskInstanceId: "task-inst-7" }));
    expect(errors.join("\n")).toContain("ad_hoc comparisons must not carry a taskInstanceId");
  });

  it("allows a canonical index with a null task instance id", () => {
    const index = makeIndex({
      taskBinding: { kind: "canonical", taskId: "task-42", taskVersion: 3 },
    });
    expect(validateComparisonResultIndex(index).ok).toBe(true);
  });

  it("allows a canonical index with a task instance id", () => {
    const index = makeIndex({
      taskBinding: { kind: "canonical", taskId: "task-42", taskVersion: 3 },
      taskInstanceId: "task-inst-7",
    });
    expect(validateComparisonResultIndex(index).ok).toBe(true);
  });
});

describe("lineage", () => {
  it("accepts a null repeatedFrom", () => {
    const lineage = { repeatedFrom: null };
    expect(validateComparisonLineage(lineage).ok).toBe(true);
    expect(isComparisonLineage(lineage)).toBe(true);
  });

  it("accepts a repeatedFrom link to another comparison", () => {
    const lineage = { repeatedFrom: "run-compare-0" };
    expect(validateComparisonLineage(lineage).ok).toBe(true);
  });

  it("accepts an index whose lineage links another comparison", () => {
    const index = makeIndex({ lineage: { repeatedFrom: "run-compare-0" } });
    expect(validateComparisonResultIndex(index).ok).toBe(true);
  });

  it("rejects a comparison that repeats from itself", () => {
    const errors = indexErrors(makeIndex({ lineage: { repeatedFrom: "run-compare-1" } }));
    expect(errors.join("\n")).toContain("cannot repeat from itself");
  });

  it("rejects a missing repeatedFrom field", () => {
    const result = validateComparisonLineage({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(joinedErrors(result)).toContain("repeatedFrom");
  });

  it("rejects non-null non-string repeatedFrom values", () => {
    expect(validateComparisonLineage({ repeatedFrom: 7 }).ok).toBe(false);
    expect(isComparisonLineage({ repeatedFrom: 7 })).toBe(false);
  });

  it("rejects credential-shaped repeatedFrom values", () => {
    const result = validateComparisonLineage({ repeatedFrom: "AIzaSYNDICATE" });
    expect(result.ok).toBe(false);
  });

  it("rejects unknown lineage fields", () => {
    const result = validateComparisonLineage({ repeatedFrom: null, declaredReplicate: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(joinedErrors(result)).toContain('unknown field "declaredReplicate"');
  });

  it("rejects a non-object lineage", () => {
    expect(validateComparisonLineage("run-compare-0").ok).toBe(false);
  });
});

describe("active observations", () => {
  it("accepts an empty or unique safe observation id list", () => {
    expect(validateComparisonResultIndex(makeIndex({ activeObservationIds: [] })).ok).toBe(true);
    const index = makeIndex({ activeObservationIds: ["obs:one", "obs:two", "obs:three"] });
    expect(validateComparisonResultIndex(index).ok).toBe(true);
  });

  it("rejects a non-array observation id list", () => {
    const errors = indexErrors(makeIndex({ activeObservationIds: "obs:one" }));
    expect(errors.join("\n")).toContain("activeObservationIds must be an array");
  });

  it("rejects non-string observation ids", () => {
    const errors = indexErrors(makeIndex({ activeObservationIds: [1] }));
    expect(errors.join("\n")).toContain("activeObservationIds[0]");
  });

  it("rejects credential-shaped observation ids", () => {
    const errors = indexErrors(makeIndex({ activeObservationIds: ["sk-obs"] }));
    expect(errors.join("\n")).toContain("activeObservationIds[0]");
  });

  it("rejects duplicate observation ids", () => {
    const errors = indexErrors(makeIndex({ activeObservationIds: ["obs:one", "obs:one"] }));
    expect(errors.join("\n")).toContain('duplicate observation id "obs:one"');
  });
});

describe("revisions and timestamps", () => {
  it("accepts zero-based revisions and receipt revisions", () => {
    const index = makeIndex({ revision: 0, evidenceReceiptRevision: 0 });
    expect(validateComparisonResultIndex(index).ok).toBe(true);
  });

  it("rejects negative, fractional, or NaN index revisions", () => {
    for (const revision of [-1, 0.5, Number.NaN]) {
      const errors = indexErrors(makeIndex({ revision }));
      expect(errors.join("\n")).toContain("revision must be a non-negative integer");
    }
  });

  it("rejects negative, fractional, or NaN evidence receipt revisions", () => {
    for (const evidenceReceiptRevision of [-1, 0.5, Number.NaN]) {
      const errors = indexErrors(makeIndex({ evidenceReceiptRevision }));
      expect(errors.join("\n")).toContain("evidenceReceiptRevision must be a non-negative integer");
    }
  });

  it("rejects missing or non-number timestamps", () => {
    expect(indexErrors(makeIndex({ createdAt: undefined })).join("\n")).toContain("createdAt");
    expect(indexErrors(makeIndex({ updatedAt: Number.NaN })).join("\n")).toContain("updatedAt");
  });
});

describe("status and mode", () => {
  it("accepts every persisted run status", () => {
    for (const status of ["running", "completed", "partial", "failed", "aborted", "interrupted"]) {
      expect(validateComparisonResultIndex(makeIndex({ status })).ok).toBe(true);
    }
  });

  it("rejects unknown status values", () => {
    const errors = indexErrors(makeIndex({ status: "finished" }));
    expect(errors.join("\n")).toContain("status");
  });

  it("accepts rank and fuse modes only", () => {
    expect(isComparisonMode("rank")).toBe(true);
    expect(isComparisonMode("fuse")).toBe(true);
    expect(isComparisonMode("merge")).toBe(false);
    expect(validateComparisonResultIndex(makeIndex({ mode: "fuse" })).ok).toBe(true);
    const errors = indexErrors(makeIndex({ mode: "merge" }));
    expect(errors.join("\n")).toContain("mode");
  });
});

describe("title", () => {
  it("accepts a string title", () => {
    expect(validateComparisonResultIndex(makeIndex({ title: "A short task" })).ok).toBe(true);
  });

  it("rejects non-string titles", () => {
    const errors = indexErrors(makeIndex({ title: 42 }));
    expect(errors.join("\n")).toContain("title must be a string");
  });
});

describe("secret-shaped data", () => {
  it("rejects canonical prohibited keys anywhere in the index", () => {
    for (const key of ["apiKey", "authorization", "token", "secret", "password", "env"]) {
      const errors = indexErrors(makeIndex({ [key]: "x" }));
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.join("\n")).toContain(`prohibited key "${key}"`);
    }
  });

  it("rejects the extended evidence prohibited keys", () => {
    for (const key of [
      "bearer",
      "cookie",
      "cookies",
      "credential",
      "credentials",
      "headers",
      "proxyUrl",
    ]) {
      const errors = indexErrors(makeIndex({ [key]: "x" }));
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.join("\n")).toContain(`prohibited key "${key}"`);
    }
  });

  it("rejects credential-shaped id, runId, and taskInstanceId values", () => {
    expect(indexErrors(makeIndex({ id: "sk-live-abc" })).length).toBeGreaterThan(0);
    expect(indexErrors(makeIndex({ runId: "AIzaXYZ" })).length).toBeGreaterThan(0);
    expect(indexErrors(makeIndex({ taskInstanceId: "Bearer xyz" })).length).toBeGreaterThan(0);
  });
});

describe("raw outputs and judge rationale", () => {
  it("rejects indexes carrying raw output fields", () => {
    for (const key of [
      "output",
      "outputs",
      "candidateOutput",
      "candidateOutputs",
      "rawOutput",
      "streamingText",
    ]) {
      const errors = indexErrors(makeIndex({ [key]: "candidate text" }));
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.join("\n")).toContain(`unknown field "${key}"`);
    }
  });

  it("rejects indexes carrying judge rationale or report fields", () => {
    for (const key of [
      "rationale",
      "fullRationale",
      "judgeRationale",
      "report",
      "messages",
      "comparisons",
    ]) {
      const errors = indexErrors(makeIndex({ [key]: "judge reasoning" }));
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.join("\n")).toContain(`unknown field "${key}"`);
    }
  });

  it("flags content-shaped fields as raw content when scanned", () => {
    const errors = indexErrors(makeIndex({ output: "candidate text" }));
    expect(errors.join("\n")).toContain("raw content field");
  });

  it("rejects an index with unknown extra fields even when every known field is valid", () => {
    const errors = indexErrors(makeIndex({ candidateCount: 3 }));
    expect(errors.join("\n")).toContain('unknown field "candidateCount"');
  });
});

describe("type-level contract", () => {
  it("stays summary-only: no output or rationale fields exist on the index type", () => {
    const index = makeIndex() as unknown as ComparisonResultIndex;
    const record = index as unknown as Record<string, unknown>;
    expect(record.output).toBeUndefined();
    expect(record.rationale).toBeUndefined();
    expect(record.candidateOutput).toBeUndefined();
  });
});
