// =============================================================================
// suite-validation.ts + protocol-fingerprint.ts — tests
// =============================================================================

import { describe, it, expect } from "vitest";
import { validateSuiteForExecution, validateSuiteForSave, isSuiteDirty } from "./suite-validation";
import {
  computeProtocolFingerprint,
  canonicalJsonString,
  createExperimentSnapshot,
} from "./protocol-fingerprint";
import type { EvaluationSuite, EvaluationTask, EvaluationRubric } from "./evaluation-types";
import type { ModelSlot } from "../../studio-data";

function makeSlot(id: string, slug: string, providerId = "openrouter", enabled = true): ModelSlot {
  return {
    id,
    providerId: providerId as ModelSlot["providerId"],
    provider: "OR",
    model: `Model ${slug}`,
    slug,
    enabled,
  };
}

function makeTask(id: string, overrides: Partial<EvaluationTask> = {}): EvaluationTask {
  return {
    id,
    title: `Task ${id}`,
    prompt: "Do something",
    systemPrompt: "",
    evaluation: { kind: "holistic" },
    judgeInstructionOverride: "",
    order: 0,
    ...overrides,
  };
}

function makeSuite(overrides: Partial<EvaluationSuite> = {}): EvaluationSuite {
  return {
    id: "s1",
    revision: 0,
    version: 1,
    name: "Test Suite",
    description: "test",
    tasks: [makeTask("t1")],
    modelSlots: [makeSlot("s1", "m1", "openrouter"), makeSlot("s2", "m2", "gemini")],
    defaultJudge: { providerId: "openrouter", model: "judge" },
    defaultEvaluation: { kind: "holistic" },
    createdAt: 1000,
    updatedAt: 1000,
    archivedAt: null,
    ...overrides,
  };
}

function makeRubric(id: string): EvaluationRubric {
  return {
    id,
    version: 1,
    name: `Rubric ${id}`,
    description: "test",
    judgeInstruction: "",
    criteria: [],
    createdAt: 1000,
    updatedAt: 1000,
  };
}

// --- Suite validation --------------------------------------------------------

describe("validateSuiteForExecution", () => {
  it("passes for a valid suite", () => {
    const result = validateSuiteForExecution(makeSuite());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("blocks an explicit candidate effort unavailable on enabled models", () => {
    const result = validateSuiteForExecution(
      makeSuite({
        reasoningPolicy: { candidates: "xhigh", judge: "provider-default" },
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.field === "reasoningPolicy.candidates")).toBe(true);
    expect(result.errors.some((error) => error.message.includes("openrouter:m1"))).toBe(true);
  });

  it("allows provider-default without claiming compute equivalence", () => {
    const result = validateSuiteForExecution(
      makeSuite({
        reasoningPolicy: { candidates: "provider-default", judge: "provider-default" },
      }),
    );
    expect(result.valid).toBe(true);
  });

  it("rejects empty name", () => {
    const result = validateSuiteForExecution(makeSuite({ name: "" }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "name")).toBe(true);
  });

  it("rejects fewer than 2 enabled models", () => {
    const result = validateSuiteForExecution(
      makeSuite({
        modelSlots: [makeSlot("s1", "m1")],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "modelSlots")).toBe(true);
  });

  it("rejects duplicate model keys before provider calls", () => {
    const result = validateSuiteForExecution(
      makeSuite({
        modelSlots: [makeSlot("s1", "same-slug"), makeSlot("s2", "same-slug")],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("Duplicate"))).toBe(true);
  });

  it("rejects task with empty title", () => {
    const result = validateSuiteForExecution(
      makeSuite({
        tasks: [makeTask("t1", { title: "" })],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field.includes("title"))).toBe(true);
  });

  it("rejects task with empty prompt", () => {
    const result = validateSuiteForExecution(
      makeSuite({
        tasks: [makeTask("t1", { prompt: "" })],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field.includes("prompt"))).toBe(true);
  });

  it("rejects empty tasks array", () => {
    const result = validateSuiteForExecution(makeSuite({ tasks: [] }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "tasks")).toBe(true);
  });
});

describe("validateSuiteForSave", () => {
  it("passes for a valid suite", () => {
    const result = validateSuiteForSave(makeSuite());
    expect(result.valid).toBe(true);
  });

  it("allows incomplete draft (fewer than 2 models)", () => {
    const result = validateSuiteForSave(makeSuite({ modelSlots: [] }));
    expect(result.valid).toBe(true);
  });

  it("rejects duplicate model keys even on save", () => {
    const result = validateSuiteForSave(
      makeSuite({
        modelSlots: [makeSlot("s1", "dup"), makeSlot("s2", "dup")],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("Duplicate"))).toBe(true);
  });
});

describe("isSuiteDirty", () => {
  it("returns false for identical suites", () => {
    const suite = makeSuite();
    expect(isSuiteDirty(suite, { ...suite })).toBe(false);
  });

  it("returns true when name differs", () => {
    const suite = makeSuite();
    const draft = { ...suite, name: "Changed" };
    expect(isSuiteDirty(suite, draft)).toBe(true);
  });

  it("returns false when only revision/timestamps differ", () => {
    const suite = makeSuite();
    const draft = { ...suite, revision: 99, updatedAt: 9999 };
    expect(isSuiteDirty(suite, draft)).toBe(false);
  });
});

// --- Protocol fingerprint ----------------------------------------------------

describe("canonicalJsonString", () => {
  it("sorts object keys recursively", () => {
    const result = canonicalJsonString({ b: 1, a: { d: 2, c: 3 } });
    expect(result).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it("preserves array order", () => {
    const result = canonicalJsonString({
      items: [
        { b: 1, a: 2 },
        { d: 3, c: 4 },
      ],
    });
    expect(result).toBe('{"items":[{"a":2,"b":1},{"c":4,"d":3}]}');
  });

  it("produces same output regardless of insertion order", () => {
    const a = canonicalJsonString({ z: 1, a: 2, m: { y: 3, b: 4 } });
    const b = canonicalJsonString({ a: 2, m: { b: 4, y: 3 }, z: 1 });
    expect(a).toBe(b);
  });
});

describe("computeProtocolFingerprint", () => {
  it("returns sha256: prefixed hex string", () => {
    const fp = computeProtocolFingerprint(makeSuite(), []);
    expect(fp).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("produces same fingerprint for equivalent suites with different insertion order", () => {
    const suite1 = makeSuite();
    const suite2 = { ...suite1, createdAt: 9999, updatedAt: 9999 };
    expect(computeProtocolFingerprint(suite1, [])).toBe(computeProtocolFingerprint(suite2, []));
  });

  it("changes when task content changes", () => {
    const suite1 = makeSuite();
    const suite2 = makeSuite({ tasks: [makeTask("t1", { prompt: "Different" })] });
    expect(computeProtocolFingerprint(suite1, [])).not.toBe(computeProtocolFingerprint(suite2, []));
  });

  it("changes when rubric criteria change", () => {
    const suite = makeSuite();
    const rubric1 = makeRubric("p1");
    const rubric2: EvaluationRubric = {
      ...rubric1,
      criteria: [
        {
          id: "c1",
          name: "Quality",
          description: "Overall quality",
          weight: 1,
          anchors: { one: "bad", three: "ok", five: "great" },
        },
      ],
    };
    expect(computeProtocolFingerprint(suite, [rubric1])).not.toBe(
      computeProtocolFingerprint(suite, [rubric2]),
    );
  });

  it("does not change when suite ID or timestamps change", () => {
    const suite1 = makeSuite({ id: "s1", createdAt: 1000 });
    const suite2 = makeSuite({ id: "s2", createdAt: 2000 });
    expect(computeProtocolFingerprint(suite1, [])).toBe(computeProtocolFingerprint(suite2, []));
  });
});

describe("createExperimentSnapshot", () => {
  it("deep-copies suite, rubrics, and Judge", () => {
    const suite = makeSuite();
    const rubric = makeRubric("p1");
    const snapshot = createExperimentSnapshot(suite, [rubric], 5000);

    // Mutating originals should not affect snapshot
    suite.name = "Changed";
    rubric.name = "Changed";
    suite.modelSlots[0].model = "Changed";

    expect(snapshot.suiteId).toBe("s1");
    expect(snapshot.tasks[0].title).toBe("Task t1");
    expect(snapshot.modelSlots[0].model).toBe("Model m1");
    expect(snapshot.profiles[0].name).toBe("Rubric p1");
  });

  it("includes protocol fingerprint", () => {
    const snapshot = createExperimentSnapshot(makeSuite(), [], 5000);
    expect(snapshot.protocolFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("includes creation timestamp", () => {
    const snapshot = createExperimentSnapshot(makeSuite(), [], 5000);
    expect(snapshot.createdAt).toBe(5000);
  });
});
