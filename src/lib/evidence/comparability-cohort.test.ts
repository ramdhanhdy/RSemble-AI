// =============================================================================
// comparability-cohort.test.ts — comparability cohort fingerprints
// (observations-and-evidence spec §9).
//
// Cohort identity is a canonical fingerprint over task relation, rubric or
// verifier contract, protocol fingerprint and response mode, evaluator
// kind/model/version/configuration, tool/scaffold and reasoning policy, and
// material provider/model-version identity. Tests cover every split
// dimension, permutation stability, readable split reasons, and the
// never-pool rule.
// =============================================================================

import { describe, expect, it } from "vitest";
import {
  buildComparabilityCohort,
  canonicalCohortJson,
  cohortSplitReasons,
  cohortsComparable,
  type ComparabilityCohortInput,
} from "./comparability-cohort";

const FP = `sha256:${"f".repeat(64)}`;
const DIGEST = `sha256:${"a".repeat(64)}`;

function cohortInput(overrides: Partial<ComparabilityCohortInput> = {}): ComparabilityCohortInput {
  return {
    taskId: "task-1",
    taskVersion: 2,
    taskInstanceId: "inst-1",
    rubricRef: { id: "rub-1", version: 3 },
    verifierRef: null,
    protocolFingerprint: FP,
    responseMode: "json",
    evaluator: {
      kind: "model_judge",
      providerId: "openrouter",
      model: "org/judge",
      resolvedVersion: "2025-03",
      instructionDigest: DIGEST,
      reasoningEffort: "high",
      toolScaffoldSignature: null,
    },
    reasoningRequested: "high",
    reasoningEffective: "medium",
    toolScaffoldSignature: null,
    providerId: "openrouter",
    resolvedModel: "org/gpt-x-2025-06",
    resolvedVersion: "2025-06-01",
    ...overrides,
  };
}

describe("cohort fingerprint", () => {
  it("is a canonical sha256 fingerprint", () => {
    const cohort = buildComparabilityCohort(cohortInput());
    expect(cohort.id).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(cohort.versionKnown).toBe(true);
  });

  it("discloses an unknown resolved version", () => {
    const cohort = buildComparabilityCohort(cohortInput({ resolvedVersion: null }));
    expect(cohort.versionKnown).toBe(false);
  });

  it("is deterministic for identical input", () => {
    expect(buildComparabilityCohort(cohortInput()).id).toBe(buildComparabilityCohort(cohortInput()).id);
  });

  it("is stable across key-order permutations", () => {
    const a = cohortInput();
    const b: ComparabilityCohortInput = {
      resolvedVersion: a.resolvedVersion,
      resolvedModel: a.resolvedModel,
      providerId: a.providerId,
      toolScaffoldSignature: a.toolScaffoldSignature,
      reasoningEffective: a.reasoningEffective,
      reasoningRequested: a.reasoningRequested,
      evaluator: {
        toolScaffoldSignature: a.evaluator.toolScaffoldSignature,
        reasoningEffort: a.evaluator.reasoningEffort,
        instructionDigest: a.evaluator.instructionDigest,
        resolvedVersion: a.evaluator.resolvedVersion,
        model: a.evaluator.model,
        providerId: a.evaluator.providerId,
        kind: a.evaluator.kind,
      },
      responseMode: a.responseMode,
      protocolFingerprint: a.protocolFingerprint,
      verifierRef: a.verifierRef,
      rubricRef: a.rubricRef,
      taskInstanceId: a.taskInstanceId,
      taskVersion: a.taskVersion,
      taskId: a.taskId,
    };
    expect(buildComparabilityCohort(b).id).toBe(buildComparabilityCohort(a).id);
    expect(canonicalCohortJson(b)).toBe(canonicalCohortJson(a));
  });
});

describe("split dimensions", () => {
  const cases: Array<{ name: string; override: Partial<ComparabilityCohortInput> }> = [
    { name: "task identity", override: { taskId: "task-2" } },
    { name: "task version", override: { taskVersion: 3 } },
    { name: "task instance", override: { taskInstanceId: "inst-2" } },
    { name: "rubric", override: { rubricRef: { id: "rub-2", version: 1 } } },
    { name: "rubric absence", override: { rubricRef: null } },
    { name: "verifier contract", override: { verifierRef: { id: "ver-1", version: 1 } } },
    { name: "protocol fingerprint", override: { protocolFingerprint: `sha256:${"b".repeat(64)}` } },
    { name: "response mode", override: { responseMode: "text" } },
    {
      name: "evaluator provider",
      override: { evaluator: { ...cohortInput().evaluator, providerId: "gemini" } },
    },
    {
      name: "evaluator model",
      override: { evaluator: { ...cohortInput().evaluator, model: "other/judge" } },
    },
    {
      name: "evaluator version",
      override: { evaluator: { ...cohortInput().evaluator, resolvedVersion: "2025-04" } },
    },
    {
      name: "evaluator configuration",
      override: { evaluator: { ...cohortInput().evaluator, instructionDigest: `sha256:${"c".repeat(64)}` } },
    },
    {
      name: "evaluator reasoning",
      override: { evaluator: { ...cohortInput().evaluator, reasoningEffort: "low" } },
    },
    { name: "reasoning policy requested", override: { reasoningRequested: "low" } },
    { name: "reasoning policy effective", override: { reasoningEffective: "low" } },
    { name: "tool scaffold", override: { toolScaffoldSignature: `sha256:${"d".repeat(64)}` } },
    { name: "provider", override: { providerId: "gemini" } },
    { name: "resolved model", override: { resolvedModel: "org/other" } },
    { name: "resolved version", override: { resolvedVersion: "2025-07-01" } },
    { name: "resolved version unknown on one side", override: { resolvedVersion: null } },
  ];

  it.each(cases)("splits on %s", ({ override }) => {
    const a = cohortInput();
    const b = cohortInput(override);
    expect(buildComparabilityCohort(a).id).not.toBe(buildComparabilityCohort(b).id);
    expect(cohortSplitReasons(a, b).length).toBeGreaterThan(0);
  });

  it("produces no split reasons for identical inputs", () => {
    expect(cohortSplitReasons(cohortInput(), cohortInput())).toEqual([]);
  });

  it("produces readable reasons", () => {
    const a = cohortInput();
    expect(cohortSplitReasons(a, cohortInput({ taskVersion: 3 }))).toEqual([
      "Task version differs (v2 vs v3)",
    ]);
    expect(cohortSplitReasons(a, cohortInput({ protocolFingerprint: `sha256:${"b".repeat(64)}` }))).toEqual([
      "Protocol fingerprint differs",
    ]);
    expect(cohortSplitReasons(a, cohortInput({ rubricRef: null }))).toEqual([
      "Rubric differs (rub-1@3 vs none)",
    ]);
    expect(cohortSplitReasons(a, cohortInput({ resolvedVersion: null }))).toEqual([
      'Resolved model version differs ("2025-06-01" vs unknown)',
    ]);
  });
});

describe("never pool", () => {
  it("treats only equal fingerprints as comparable", () => {
    const a = buildComparabilityCohort(cohortInput()).id;
    const b = buildComparabilityCohort(cohortInput({ taskInstanceId: "inst-2" })).id;
    expect(cohortsComparable(a, a)).toBe(true);
    expect(cohortsComparable(a, b)).toBe(false);
  });
});
