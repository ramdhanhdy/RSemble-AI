// =============================================================================
// Milestone A golden corpus — shape and live-type characterization
//
// Proves the reviewed fixture is valid against Child 04 validators and covers
// every required Milestone A scenario. Does not implement profile queries.
// =============================================================================

import { describe, expect, it } from "vitest";
import { countEvidence } from "../../evidence/evidence-counting";
import { classifyEligibility, type EligibilityInput } from "../../evidence/evidence-eligibility";
import { computeModelConfigurationId } from "../../evidence/model-configuration";
import {
  EVIDENCE_PROHIBITED_KEYS,
  collectProhibitedFieldPaths,
  isEligibilityDecision,
  isModelConfigurationSnapshot,
  observationIdFor,
  validateEligibilityDecision,
  validateObservation,
} from "../../evidence/evidence-validation";
import {
  isTaskFacetAnnotation,
  isTaskFamily,
  isTaskFamilyAssignment,
  isTaskInstance,
  isTaskRecord,
  isTaskVersion,
} from "../../tasks/task-validation";
import {
  MILESTONE_A_COVERAGE_INDEX,
  MILESTONE_A_EVIDENCE_RULE_VERSION,
  MILESTONE_A_GOLDEN,
  MILESTONE_A_REQUIRED_COVERAGE,
  milestoneADecisions,
  milestoneALedgerRows,
  milestoneAObservations,
} from "./milestone-a-golden";

describe("Milestone A golden corpus coverage", () => {
  it("names every required scenario and points at least one fixture", () => {
    expect([...MILESTONE_A_REQUIRED_COVERAGE]).toEqual([
      "exact_configuration",
      "rolling_alias_unknown_resolved_version",
      "partial_identity",
      "reasoning_policy_difference",
      "tool_scaffold_difference",
      "provider_runtime_identity_difference",
      "multiple_task_versions",
      "multiple_task_instances",
      "declared_replicates",
      "undeclared_repeats",
      "candidate_retry_reuse",
      "multiple_assessments_one_cell",
      "eligible_decision",
      "provisional_decision",
      "excluded_decision",
      "within_model_profile_allowed",
      "within_model_profile_not_allowed",
      "mixed_comparability_cohorts",
      "mixed_rubric_evaluator_protocol",
      "verified_pass",
      "verified_fail",
      "missing_cells",
      "unequal_attempt_counts_across_tasks",
    ]);
    for (const key of MILESTONE_A_REQUIRED_COVERAGE) {
      expect(MILESTONE_A_COVERAGE_INDEX[key].length, key).toBeGreaterThan(0);
    }
  });
});

describe("live Child 04 type guards", () => {
  it("every configuration is a valid ModelConfigurationSnapshot with a derived id", () => {
    const snapshots = Object.values(MILESTONE_A_GOLDEN.configurations);
    expect(snapshots.length).toBe(6);
    for (const snapshot of snapshots) {
      expect(isModelConfigurationSnapshot(snapshot), snapshot.id).toBe(true);
      expect(snapshot.id).toBe(computeModelConfigurationId(snapshot));
    }
    const kinds = new Set(snapshots.map((s) => s.identityCompleteness));
    expect(kinds).toEqual(new Set(["exact", "rolling_alias", "partial"]));
  });

  it("keeps exact / rolling / partial / reasoning / tools / provider identities distinct", () => {
    const ids = Object.values(MILESTONE_A_GOLDEN.configurations).map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every Observation passes validateObservation and matches its derived id", () => {
    for (const row of MILESTONE_A_GOLDEN.rows) {
      const result = validateObservation(row.observation);
      expect(result, row.key).toEqual({ ok: true, value: row.observation });
      expect(row.observation.id).toBe(observationIdFor(row.observation));
    }
  });

  it("every EligibilityDecision matches classifyEligibility on the stored facts", () => {
    expect(MILESTONE_A_EVIDENCE_RULE_VERSION).toBe(1);
    for (const row of MILESTONE_A_GOLDEN.rows) {
      const check = validateEligibilityDecision(row.decision);
      expect(check.ok, row.key).toBe(true);
      expect(isEligibilityDecision(row.decision), row.key).toBe(true);
      const input: EligibilityInput = {
        observation: row.observation,
        ...row.classification,
        comparabilityCohortId: row.decision.comparabilityCohortId,
        decidedAt: row.decision.decidedAt,
      };
      expect(classifyEligibility(input), row.key).toEqual(row.decision);
      expect(row.decision.observationId).toBe(row.observation.id);
      expect(row.decision.ruleVersion).toBe(MILESTONE_A_EVIDENCE_RULE_VERSION);
    }
  });

  it("Task / Version / Instance / Family / Facet records pass live guards", () => {
    expect(MILESTONE_A_GOLDEN.tasks.every(isTaskRecord)).toBe(true);
    expect(MILESTONE_A_GOLDEN.versions.every(isTaskVersion)).toBe(true);
    expect(MILESTONE_A_GOLDEN.instances.every(isTaskInstance)).toBe(true);
    expect(MILESTONE_A_GOLDEN.families.every(isTaskFamily)).toBe(true);
    expect(MILESTONE_A_GOLDEN.familyAssignments.every(isTaskFamilyAssignment)).toBe(true);
    expect(MILESTONE_A_GOLDEN.facets.every(isTaskFacetAnnotation)).toBe(true);
  });

  it("carries no secret-shaped keys on observations or decisions", () => {
    for (const row of MILESTONE_A_GOLDEN.rows) {
      const paths: string[] = [];
      collectProhibitedFieldPaths(row.observation, "", paths);
      collectProhibitedFieldPaths(row.decision, "", paths);
      expect(paths, row.key).toEqual([]);
    }
    for (const key of EVIDENCE_PROHIBITED_KEYS) {
      const blob = JSON.stringify(MILESTONE_A_GOLDEN);
      expect(blob.includes(`"${key}"`)).toBe(false);
    }
  });
});

describe("Milestone A selection and coverage facts", () => {
  it("exposes eligible, provisional, and excluded decisions plus profile-use split", () => {
    const statuses = new Set(milestoneADecisions().map((d) => d.status));
    expect(statuses).toEqual(new Set(["eligible", "provisional", "excluded"]));
    const allowed = milestoneADecisions().filter((d) =>
      d.allowedUses.includes("within_model_profile"),
    );
    const denied = milestoneADecisions().filter(
      (d) => !d.allowedUses.includes("within_model_profile"),
    );
    expect(allowed.length).toBeGreaterThan(0);
    expect(denied.length).toBeGreaterThan(0);
    expect(denied.some((d) => d.status === "excluded")).toBe(true);
    expect(denied.some((d) => d.evidenceClass === "exploratory")).toBe(true);
  });

  it("keeps mixed comparability cohorts and mixed rubric/evaluator/protocol rows", () => {
    const cohortIds = new Set(milestoneADecisions().map((d) => d.comparabilityCohortId));
    expect(cohortIds.size).toBeGreaterThan(1);
    const mixed = MILESTONE_A_GOLDEN.rows.filter((row) =>
      row.coverage.includes("mixed_rubric_evaluator_protocol"),
    );
    const rubrics = new Set(mixed.map((row) => JSON.stringify(row.observation.rubricRef)));
    const protocols = new Set(mixed.map((row) => row.observation.protocolFingerprint));
    const evaluators = new Set(mixed.map((row) => row.observation.evaluatorSnapshot.kind));
    expect(rubrics.size).toBeGreaterThan(1);
    expect(protocols.size).toBeGreaterThan(1);
    expect(evaluators.size).toBeGreaterThan(1);
  });

  it("records declared replicates separately from undeclared repeats", () => {
    const declared = MILESTONE_A_GOLDEN.rows.filter((row) => row.ledger.declaredReplicate);
    expect(declared).toHaveLength(2);
    expect(new Set(declared.map((row) => row.observation.taskInstanceId)).size).toBe(1);
    expect(new Set(declared.map((row) => row.observation.executionLineageId)).size).toBe(2);
    const undeclared = MILESTONE_A_GOLDEN.rows.filter((row) =>
      row.decision.reasonCodes.includes("undeclared_repeat"),
    );
    expect(undeclared.length).toBeGreaterThan(0);
    expect(undeclared.every((row) => row.ledger.declaredReplicate === false)).toBe(true);
  });

  it("keeps multiple assessments in one lineage/task/model cell as two observations", () => {
    const multi = MILESTONE_A_GOLDEN.rows.filter((row) =>
      row.coverage.includes("multiple_assessments_one_cell"),
    );
    expect(multi.length).toBeGreaterThan(0);
    const cell = multi[0];
    const siblings = MILESTONE_A_GOLDEN.rows.filter(
      (row) =>
        row.observation.executionLineageId === cell.observation.executionLineageId &&
        row.observation.taskId === cell.observation.taskId &&
        row.observation.modelConfigurationId === cell.observation.modelConfigurationId,
    );
    expect(siblings.length).toBeGreaterThan(1);
    expect(new Set(siblings.map((row) => row.observation.id)).size).toBe(siblings.length);
    expect(new Set(siblings.map((row) => row.observation.assessmentRef.judgeAttemptId)).size).toBe(
      siblings.length,
    );
    expect(new Set(siblings.map((row) => row.ledger.sequence)).size).toBe(siblings.length);
  });

  it("reports missing cells as gaps, not Observations", () => {
    expect(MILESTONE_A_GOLDEN.missingCells.length).toBeGreaterThan(0);
    for (const gap of MILESTONE_A_GOLDEN.missingCells) {
      const invented = milestoneAObservations().some(
        (obs) =>
          obs.taskId === gap.taskId &&
          obs.taskInstanceId === gap.taskInstanceId &&
          obs.modelConfigurationId === gap.modelConfigurationId,
      );
      expect(invented, `${gap.taskId} x ${gap.modelConfigurationId}`).toBe(false);
    }
  });

  it("keeps attempt counts separate and unequal across Tasks", () => {
    const counts = countEvidence({
      rows: milestoneALedgerRows(),
      declaredPairs: MILESTONE_A_GOLDEN.declaredPairs,
    });
    expect(counts.taskCount).toBeGreaterThan(1);
    expect(counts.attemptCount).toBeGreaterThan(counts.activeObservationCount);
    expect(counts.replicateCount).toBe(2);
    const attemptsByTask = new Map<string, number>();
    for (const row of milestoneALedgerRows()) {
      attemptsByTask.set(row.taskId, (attemptsByTask.get(row.taskId) ?? 0) + row.attemptIds.length);
    }
    expect(new Set(attemptsByTask.values()).size).toBeGreaterThan(1);
    // countEvidence pair completeness is configuration-global (both IDs
    // appear somewhere), not per-task. Per-task missingness lives on
    // missingCells — T3 must not treat pairedCoverage.complete as cell coverage.
    expect(counts.pairedCoverage.declaredPairCount).toBe(3);
    expect(counts.pairedCoverage.complete).toBe(true);
    expect(
      MILESTONE_A_GOLDEN.missingCells.some(
        (gap) => gap.taskId === "task-math" && gap.reason === "missing_cell",
      ),
    ).toBe(true);
  });

  it("covers multiple Task Versions and Instances on one Task", () => {
    const transform = milestoneAObservations().filter((obs) => obs.taskId === "task-transform");
    expect(new Set(transform.map((obs) => obs.taskVersion)).size).toBeGreaterThan(1);
    const v1 = transform.filter((obs) => obs.taskVersion === 1);
    expect(new Set(v1.map((obs) => obs.taskInstanceId)).size).toBeGreaterThan(1);
  });

  it("records verified pass as verified class and verifier fail as comparable negative evidence", () => {
    const pass = MILESTONE_A_GOLDEN.rows.find((row) => row.key === "exact-alpha-verify-pass");
    const fail = MILESTONE_A_GOLDEN.rows.find((row) => row.key === "exact-beta-verify-fail");
    expect(pass?.decision.evidenceClass).toBe("verified");
    expect(pass?.observation.outcome.verifierPassed).toBe(true);
    expect(fail?.decision.evidenceClass).toBe("comparable");
    expect(fail?.decision.status).toBe("provisional");
    expect(fail?.observation.outcome.verifierPassed).toBe(false);
    expect(fail?.decision.reasonCodes).toContain("verifier_failed");
  });
});
