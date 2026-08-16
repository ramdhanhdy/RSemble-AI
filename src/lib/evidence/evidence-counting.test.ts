// =============================================================================
// evidence-counting.test.ts — counting invariants (spec §6, §17)
//
// Locks the no-inflation invariants: ten retries with one selected success is
// one active observation; same-instance repeats never raise coverage counts;
// versions count separately from Task identity; only planned (declared)
// replicates are replicates; missing paired cells break pair coverage; roster
// extension reuse never inflates response samples; multiple judge events on
// one output never inflate observations; the active assessment can change
// without changing counts; and one active observation exists per lineage cell.
// =============================================================================

import { describe, expect, it } from "vitest";
import {
  countEvidence,
  type EvidenceCountInput,
  type EvidenceLedgerRow,
} from "./evidence-counting";

const CFG_A = `mc:sha256:${"a".repeat(64)}`;
const CFG_B = `mc:sha256:${"b".repeat(64)}`;
const CFG_C = `mc:sha256:${"c".repeat(64)}`;

let counter = 0;
function row(overrides: Partial<EvidenceLedgerRow> = {}): EvidenceLedgerRow {
  counter += 1;
  return {
    lineageCellKey: `cell-${counter}`,
    taskId: "task-1",
    taskVersion: 1,
    taskInstanceId: "inst-1",
    modelConfigurationId: CFG_A,
    sequence: 1,
    candidateAttemptId: `att-${counter}`,
    reusedCandidateOutput: false,
    declaredReplicate: false,
    assessmentEventId: `judge-${counter}`,
    attemptIds: [`att-${counter}`],
    ...overrides,
  };
}

function count(rows: EvidenceLedgerRow[], declaredPairs: EvidenceCountInput["declaredPairs"] = []) {
  return countEvidence({ rows, declaredPairs });
}

describe("attempts and retries", () => {
  it("counts ten retries with one selected success as one active observation", () => {
    const attempts = Array.from({ length: 10 }, (_, i) => `att-${i + 1}`);
    const r = row({ attemptIds: attempts, candidateAttemptId: "att-10" });
    const c = count([r]);
    expect(c.activeObservationCount).toBe(1);
    expect(c.attemptCount).toBe(10);
    expect(c.taskCount).toBe(1);
  });

  it("reports attempt counts separately from observation counts", () => {
    const r1 = row({ attemptIds: ["a1", "a2", "a3"], candidateAttemptId: "a3" });
    const r2 = row({ attemptIds: ["a2", "a3"] });
    const c = count([r1, r2]);
    expect(c.attemptCount).toBe(3); // union of a1, a2, a3
    expect(c.activeObservationCount).toBe(2);
  });
});

describe("same-instance repeats", () => {
  it("raises the observation count but never task/instance coverage", () => {
    const r1 = row({
      lineageCellKey: "cell-1",
      taskInstanceId: "inst-1",
      candidateAttemptId: "x1",
    });
    const r2 = row({
      lineageCellKey: "cell-2",
      taskInstanceId: "inst-1",
      candidateAttemptId: "x2",
    });
    const c = count([r1, r2]);
    expect(c.activeObservationCount).toBe(2);
    expect(c.taskCount).toBe(1);
    expect(c.versionCountByTask).toEqual({ "task-1": 1 });
    expect(c.instanceCountByTask).toEqual({ "task-1": 1 });
  });

  it("counts Task identity once regardless of versions", () => {
    const r1 = row({ lineageCellKey: "cell-1", taskVersion: 1, taskInstanceId: "i1" });
    const r2 = row({ lineageCellKey: "cell-2", taskVersion: 2, taskInstanceId: "i2" });
    const c = count([r1, r2]);
    expect(c.taskCount).toBe(1);
    expect(c.versionCountByTask).toEqual({ "task-1": 2 });
    expect(c.instanceCountByTask).toEqual({ "task-1": 2 });
  });
});

describe("planned vs undeclared replicates", () => {
  it("counts only declared replicates as replicates", () => {
    const planned = row({
      lineageCellKey: "cell-1",
      declaredReplicate: true,
      candidateAttemptId: "r1",
    });
    const undeclared = row({ lineageCellKey: "cell-2", candidateAttemptId: "r2" });
    const c = count([planned, undeclared]);
    expect(c.activeObservationCount).toBe(2);
    expect(c.replicateCount).toBe(1);
  });

  it("does not count superseded rows as active replicates", () => {
    const old = row({
      lineageCellKey: "cell-1",
      sequence: 1,
      declaredReplicate: true,
      candidateAttemptId: "r1",
      assessmentEventId: "judge-1",
      attemptIds: ["r1"],
    });
    const active = row({
      lineageCellKey: "cell-1",
      sequence: 2,
      declaredReplicate: false,
      candidateAttemptId: "r1",
      assessmentEventId: "judge-2",
      attemptIds: ["r1"],
    });
    const c = count([old, active]);
    expect(c.activeObservationCount).toBe(1);
    expect(c.replicateCount).toBe(0);
  });
});

describe("missing paired cell", () => {
  it("breaks pair coverage when one side has no active observation", () => {
    const onlyA = row({ modelConfigurationId: CFG_A });
    const c = count([onlyA], [{ taskId: "task-1", a: CFG_A, b: CFG_B }]);
    expect(c.pairedCoverage).toEqual({
      declaredPairCount: 1,
      completePairCount: 0,
      complete: false,
    });
  });

  it("reports complete pair coverage when both sides are active", () => {
    const a = row({ modelConfigurationId: CFG_A });
    const b = row({ modelConfigurationId: CFG_B });
    const c = count([a, b], [{ taskId: "task-1", a: CFG_A, b: CFG_B }]);
    expect(c.pairedCoverage).toEqual({
      declaredPairCount: 1,
      completePairCount: 1,
      complete: true,
    });
  });
});

describe("roster extension reuse", () => {
  it("never inflates existing-model response samples", () => {
    const baseA = row({
      lineageCellKey: "cell-a",
      modelConfigurationId: CFG_A,
      sequence: 1,
      candidateAttemptId: "a-base",
      assessmentEventId: "judge-base",
      attemptIds: ["a-base"],
    });
    const baseB = row({
      lineageCellKey: "cell-b",
      modelConfigurationId: CFG_B,
      sequence: 1,
      candidateAttemptId: "b-base",
      assessmentEventId: "judge-base",
      attemptIds: ["b-base"],
    });
    const reuseA = row({
      lineageCellKey: "cell-a",
      modelConfigurationId: CFG_A,
      sequence: 2,
      candidateAttemptId: "a-base",
      reusedCandidateOutput: true,
      assessmentEventId: "judge-ext",
      attemptIds: ["a-base", "a-copy"],
    });
    const reuseB = row({
      lineageCellKey: "cell-b",
      modelConfigurationId: CFG_B,
      sequence: 2,
      candidateAttemptId: "b-base",
      reusedCandidateOutput: true,
      assessmentEventId: "judge-ext",
      attemptIds: ["b-base", "b-copy"],
    });
    const addedC = row({
      lineageCellKey: "cell-c",
      modelConfigurationId: CFG_C,
      sequence: 1,
      candidateAttemptId: "c-fresh",
      assessmentEventId: "judge-ext",
      attemptIds: ["c-fresh"],
    });
    const c = count([baseA, baseB, reuseA, reuseB, addedC]);
    expect(c.activeObservationCount).toBe(3); // one per lineage cell
    expect(c.responseSampleCount).toBe(3); // a-base, b-base, c-fresh
    expect(c.responseSampleCountByConfiguration).toEqual({
      [CFG_A]: 1,
      [CFG_B]: 1,
      [CFG_C]: 1,
    });
    expect(c.reusedAssessmentEventCount).toBe(2); // cell-a and cell-b reuse events
    expect(c.assessmentEventCount).toBe(2); // judge-base + judge-ext
    expect(c.attemptCount).toBe(5); // a-base, b-base, a-copy, b-copy, c-fresh
  });
});

describe("multiple judge events on one output", () => {
  it("changes the active assessment without changing observation counts", () => {
    const first = row({
      lineageCellKey: "cell-1",
      sequence: 1,
      candidateAttemptId: "att-1",
      assessmentEventId: "judge-1",
      attemptIds: ["att-1"],
    });
    const second = row({
      lineageCellKey: "cell-1",
      sequence: 2,
      candidateAttemptId: "att-1",
      assessmentEventId: "judge-2",
      attemptIds: ["att-1"],
    });
    const c = count([first, second]);
    expect(c.activeObservationCount).toBe(1);
    expect(c.assessmentEventCount).toBe(2);
  });
});

describe("one active observation per lineage cell", () => {
  it("flags a cell with multiple active rows as a violation", () => {
    const a = row({ lineageCellKey: "cell-1", sequence: 2, assessmentEventId: "j-1" });
    const b = row({ lineageCellKey: "cell-1", sequence: 2, assessmentEventId: "j-2" });
    const c = count([a, b]);
    expect(c.lineageCellViolations).toHaveLength(1);
    expect(c.lineageCellViolations[0]).toContain("cell-1");
  });
  it("deflates a violated cell to one representative row so counts never inflate", () => {
    const a = row({
      lineageCellKey: "cell-1",
      sequence: 2,
      candidateAttemptId: "x1",
      declaredReplicate: true,
      assessmentEventId: "j-1",
      modelConfigurationId: CFG_A,
      attemptIds: ["x1"],
    });
    const b = row({
      lineageCellKey: "cell-1",
      sequence: 2,
      candidateAttemptId: "x2",
      declaredReplicate: true,
      assessmentEventId: "j-2",
      modelConfigurationId: CFG_A,
      attemptIds: ["x2"],
    });
    const c = count([a, b]);
    expect(c.lineageCellViolations).toHaveLength(1);
    expect(c.activeObservationCount).toBe(1);
    expect(c.replicateCount).toBe(1);
    expect(c.responseSampleCount).toBe(1);
    expect(c.responseSampleCountByConfiguration).toEqual({ [CFG_A]: 1 });
  });

  it("has no violations for clean ledgers", () => {
    const c = count([row({ lineageCellKey: "cell-1" })]);
    expect(c.lineageCellViolations).toEqual([]);
  });
});

describe("response sample attribution", () => {
  it("surfaces a divergence when one output is attributed to multiple configurations", () => {
    const r1 = row({
      lineageCellKey: "cell-a",
      modelConfigurationId: CFG_A,
      candidateAttemptId: "shared",
      attemptIds: ["shared"],
    });
    const r2 = row({
      lineageCellKey: "cell-b",
      modelConfigurationId: CFG_B,
      candidateAttemptId: "shared",
      attemptIds: ["shared"],
    });
    const c = count([r1, r2]);
    expect(c.responseSampleCount).toBe(1);
    expect(c.responseSampleCountByConfiguration).toEqual({ [CFG_A]: 1, [CFG_B]: 1 });
    expect(c.responseSampleDivergence).toHaveLength(1);
    expect(c.responseSampleDivergence[0]).toContain("shared");
  });
});
