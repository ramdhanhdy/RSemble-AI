// =============================================================================
// RSemble AI — coverage-summary.test.ts (Child 07 Task 3, RED)
//
// Honest coverage: separate quantities, never one misleading n. If a requested
// count cannot be derived from existing canonical records, it is unavailable
// or limited — never estimated. Attempt count is never sample size.
// Uncertainty units are not assigned in Milestone A.
//
// Contract under test (Child 07 spec §5.1–5.2, plan Task 3):
//  - unique Tasks, Task Versions, Task Instances
//  - active Observations
//  - accepted candidate responses where canonically resolvable
//  - attempts where canonically resolvable (audit; never sample size)
//  - declared/planned replicates where canonically resolvable
//  - comparability cohorts, Rubric versions, evaluator configurations
//  - earliest / latest observation
//  - evidence-class / eligibility-status / source split
//  - missing cells stay gaps when supplied; unavailable when not supplied
//  - resolved independent uncertainty units + unit kind/assumption unavailable
//  - permutation-invariant; never mutates the selection or source records
//  - no pooled rollup coverage
// =============================================================================

import { describe, expect, it } from "vitest";

import {
  MILESTONE_A_GOLDEN,
  milestoneADecisions,
  milestoneALedgerRows,
  milestoneAObservations,
} from "./__fixtures__/milestone-a-golden";
import {
  QUERY_AGGREGATION_RULE_VERSION,
  QUERY_ELIGIBILITY_RULE_VERSION,
  QUERY_UNCERTAINTY_RULE_VERSION,
  type ModelEvidenceQuery,
  type ResolvedRollupManifest,
  type RollupVersionResolver,
} from "./model-evidence-query";
import {
  selectProfileObservations,
  type ProfileEvidenceCorpus,
  type ProfileExactSelection,
} from "./profile-observation-selection";
import {
  buildCoverageSummary,
  type HonestQuantity,
  type ProfileCoverageSummary,
} from "./coverage-summary";

const CFG = MILESTONE_A_GOLDEN.configurations;
const EXACT_ALPHA = CFG.exactAlpha;
const EXACT_BETA = CFG.exactBeta;
const T0 = 1_704_067_200_000;

const ROLLUP_MANIFEST: ResolvedRollupManifest = {
  rollupId: "rollup-alpha-beta",
  version: 2,
  aggregationPolicy: "stratified_only",
  name: "Alpha + Beta stratified",
  memberConfigurationIds: [EXACT_ALPHA.id, EXACT_BETA.id],
  createdAt: T0,
};

const rollupResolver: RollupVersionResolver = (rollupId, version) => {
  if (rollupId === ROLLUP_MANIFEST.rollupId && version === ROLLUP_MANIFEST.version) {
    return {
      ...ROLLUP_MANIFEST,
      memberConfigurationIds: [...ROLLUP_MANIFEST.memberConfigurationIds],
    };
  }
  return null;
};

function baseQuery(overrides: Partial<ModelEvidenceQuery> = {}): ModelEvidenceQuery {
  return {
    respondent: { kind: "model_configuration", modelConfigurationId: EXACT_ALPHA.id },
    observedFrom: null,
    observedTo: null,
    taskFamilyIds: [],
    facetFilters: [],
    evidenceClasses: [],
    allowedUses: ["within_model_profile"],
    comparabilityCohortIds: [],
    sourceKinds: [],
    rubricRefs: [],
    evaluatorFilters: [],
    includeUnknownVersion: false,
    eligibilityRuleVersion: QUERY_ELIGIBILITY_RULE_VERSION,
    aggregationRuleVersion: QUERY_AGGREGATION_RULE_VERSION,
    uncertaintyRuleVersion: QUERY_UNCERTAINTY_RULE_VERSION,
    ...overrides,
  };
}

function goldenCorpus(overrides: Partial<ProfileEvidenceCorpus> = {}): ProfileEvidenceCorpus {
  return {
    configurations: Object.values(MILESTONE_A_GOLDEN.configurations),
    observations: milestoneAObservations(),
    decisions: milestoneADecisions(),
    ledgerRows: milestoneALedgerRows(),
    facets: MILESTONE_A_GOLDEN.facets,
    missingCells: MILESTONE_A_GOLDEN.missingCells,
    ...overrides,
  };
}

function exactAlphaSelection(
  overrides: Partial<ModelEvidenceQuery> = {},
  corpusOverrides: Partial<ProfileEvidenceCorpus> = {},
): { selection: ProfileExactSelection; corpus: ProfileEvidenceCorpus } {
  const corpus = goldenCorpus(corpusOverrides);
  const result = selectProfileObservations(baseQuery(overrides), corpus);
  expect(result.kind).toBe("exact");
  if (result.kind !== "exact") throw new Error("expected exact selection");
  return { selection: result, corpus };
}

function available(quantity: HonestQuantity): number {
  expect(quantity.state).toBe("available");
  if (quantity.state !== "available") throw new Error("expected available quantity");
  return quantity.value;
}

function permute<T>(items: readonly T[], seed: number): T[] {
  const arr = [...items];
  let s = seed >>> 0;
  for (let i = arr.length - 1; i > 0; i -= 1) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

function snapshotQuantities(summary: ProfileCoverageSummary) {
  return {
    uniqueTasks: summary.uniqueTasks,
    taskVersions: summary.taskVersions,
    taskInstances: summary.taskInstances,
    activeObservations: summary.activeObservations,
    acceptedCandidateResponses: summary.acceptedCandidateResponses,
    attempts: summary.attempts,
    plannedReplicates: summary.plannedReplicates,
    resolvedIndependentUncertaintyUnits: summary.resolvedIndependentUncertaintyUnits,
    uncertaintyUnitKind: summary.uncertaintyUnitKind,
    uncertaintyAssumption: summary.uncertaintyAssumption,
    comparabilityCohorts: summary.comparabilityCohorts,
    rubricVersions: summary.rubricVersions,
    evaluatorConfigurations: summary.evaluatorConfigurations,
    earliestObservation: summary.earliestObservation,
    latestObservation: summary.latestObservation,
    missingCells: summary.missingCells,
    inMetricsEvidenceClassSplit: summary.inMetricsEvidenceClassSplit,
    consideredEvidenceClassSplit: summary.consideredEvidenceClassSplit,
    inMetricsEligibilityStatusSplit: summary.inMetricsEligibilityStatusSplit,
    consideredEligibilityStatusSplit: summary.consideredEligibilityStatusSplit,
    sourceKindSplit: summary.sourceKindSplit,
    identityCompleteness: summary.identityCompleteness,
    limitationReasons: summary.limitationReasons,
  };
}

// --- Separate quantities, never one n -----------------------------------------

describe("buildCoverageSummary — separate honest quantities", () => {
  it("reports Task / version / instance / observation counts separately for exact-alpha", () => {
    const { selection, corpus } = exactAlphaSelection();
    const summary = buildCoverageSummary(selection, corpus);

    expect(available(summary.uniqueTasks)).toBe(5);
    expect(available(summary.taskVersions)).toBe(6);
    expect(available(summary.taskInstances)).toBe(7);
    expect(available(summary.activeObservations)).toBe(9);
    expect(available(summary.acceptedCandidateResponses)).toBe(9);
    expect(available(summary.plannedReplicates)).toBe(2);

    expect(summary.uniqueTasks).not.toEqual(summary.taskVersions);
    expect(summary.taskVersions).not.toEqual(summary.taskInstances);
    expect(summary.activeObservations).not.toEqual(summary.uniqueTasks);
  });

  it("never exposes a single sample-size n", () => {
    const { selection, corpus } = exactAlphaSelection();
    const summary = buildCoverageSummary(selection, corpus);
    expect("n" in summary).toBe(false);
    expect("sampleSize" in summary).toBe(false);
    expect("totalN" in summary).toBe(false);
    expect("nEffective" in summary).toBe(false);
  });

  it("reports attempts as a separate audit quantity, never as sample size", () => {
    const { selection, corpus } = exactAlphaSelection();
    const summary = buildCoverageSummary(selection, corpus);
    const attempts = available(summary.attempts);
    const active = available(summary.activeObservations);
    const tasks = available(summary.uniqueTasks);
    expect(attempts).toBe(12);
    expect(attempts).toBeGreaterThan(active);
    expect(attempts).not.toBe(active);
    expect(attempts).not.toBe(tasks);
  });

  it("does not let a reused re-judge inflate accepted candidate responses", () => {
    const { selection, corpus } = exactAlphaSelection();
    const summary = buildCoverageSummary(selection, corpus);
    expect(available(summary.acceptedCandidateResponses)).toBe(
      available(summary.activeObservations),
    );
    const math = selection.cells.find((cell) => cell.taskId === "task-math");
    expect(math?.active.observation.candidateAttemptId).toBe("att-math-ok");
    expect(math?.supersededAssessments).toHaveLength(1);
  });

  it("reports recency, cohorts, Rubric versions, and evaluator configurations separately", () => {
    const { selection, corpus } = exactAlphaSelection();
    const summary = buildCoverageSummary(selection, corpus);
    expect(available(summary.earliestObservation)).toBe(T0);
    expect(available(summary.latestObservation)).toBe(T0 + 60_000);
    expect(available(summary.comparabilityCohorts)).toBeGreaterThan(1);
    expect(available(summary.rubricVersions)).toBe(2);
    expect(available(summary.evaluatorConfigurations)).toBe(2);
  });

  it("splits evidence class, eligibility status, and source without collapsing them into n", () => {
    const { selection, corpus } = exactAlphaSelection();
    const summary = buildCoverageSummary(selection, corpus);

    expect(summary.inMetricsEvidenceClassSplit.verified).toBe(1);
    expect(summary.inMetricsEvidenceClassSplit.comparable).toBe(8);
    expect(summary.inMetricsEvidenceClassSplit.exploratory).toBe(0);
    expect(summary.inMetricsEvidenceClassSplit.benchmark_anchor).toBe(0);

    expect(summary.consideredEvidenceClassSplit.exploratory).toBeGreaterThanOrEqual(1);
    expect(summary.consideredEligibilityStatusSplit.excluded).toBeGreaterThanOrEqual(1);
    expect(summary.inMetricsEligibilityStatusSplit.excluded).toBe(0);
    expect(summary.sourceKindSplit.evaluation).toBe(9);
    expect(summary.sourceKindSplit.comparison).toBe(0);
    expect(summary.identityCompleteness).toBe("exact");
    expect(summary.limitationReasons.source_corrupt).toBeGreaterThanOrEqual(1);
  });
});

// --- Unavailable / limited rather than estimated ------------------------------

describe("buildCoverageSummary — unavailable and limited quantities", () => {
  it("marks uncertainty units unavailable in Milestone A (no assignment invented)", () => {
    const { selection, corpus } = exactAlphaSelection();
    const summary = buildCoverageSummary(selection, corpus);
    expect(summary.resolvedIndependentUncertaintyUnits.state).toBe("unavailable");
    expect(summary.uncertaintyUnitKind.state).toBe("unavailable");
    expect(summary.uncertaintyAssumption.state).toBe("unavailable");
    if (summary.resolvedIndependentUncertaintyUnits.state === "unavailable") {
      expect(summary.resolvedIndependentUncertaintyUnits.reason.length).toBeGreaterThan(0);
    }
  });

  it("does not invent missing-cell counts when gaps are not supplied", () => {
    const { selection } = exactAlphaSelection();
    const summary = buildCoverageSummary(selection);
    expect(summary.missingCells.state).toBe("unavailable");
  });

  it("counts supplied missing cells for the exact configuration and does not invent Observations", () => {
    const { selection, corpus } = exactAlphaSelection({
      respondent: { kind: "model_configuration", modelConfigurationId: EXACT_BETA.id },
    });
    const summary = buildCoverageSummary(selection, corpus);
    expect(available(summary.missingCells)).toBe(1);
    expect(available(summary.activeObservations)).toBe(2);
    expect(
      corpus.observations.some(
        (obs) => obs.taskId === "task-math" && obs.modelConfigurationId === EXACT_BETA.id,
      ),
    ).toBe(false);
  });

  it("reports a zero missing-cell count when the gap list is supplied and none apply", () => {
    const { selection, corpus } = exactAlphaSelection();
    const summary = buildCoverageSummary(selection, corpus);
    expect(available(summary.missingCells)).toBe(0);
  });

  it("marks attempts and planned replicates unavailable when the ledger is absent", () => {
    const { selection } = exactAlphaSelection({}, { ledgerRows: undefined });
    const summary = buildCoverageSummary({
      ...selection,
      cells: selection.cells.map((cell) => ({
        ...cell,
        active: { ...cell.active, ledger: null },
        supersededAssessments: cell.supersededAssessments.map((s) => ({ ...s, ledger: null })),
      })),
      unauthorized: selection.unauthorized.map((u) => ({ ...u, ledger: null })),
      declaredReplicateGroups: [],
      undeclaredRepeats: selection.undeclaredRepeats.map((r) => ({ ...r, ledger: null })),
    });
    expect(summary.attempts.state).toBe("unavailable");
    expect(summary.plannedReplicates.state).toBe("unavailable");
    expect(summary.acceptedCandidateResponses.state).toBe("available");
    expect(summary.activeObservations.state).toBe("available");
  });

  it("marks attempts limited when only some in-scope rows have ledger attempt ids", () => {
    const { selection, corpus } = exactAlphaSelection();
    const stripped: ProfileExactSelection = {
      ...selection,
      cells: selection.cells.map((cell, index) =>
        index === 0
          ? {
              ...cell,
              active: { ...cell.active, ledger: null },
              supersededAssessments: cell.supersededAssessments.map((s) => ({
                ...s,
                ledger: null,
              })),
            }
          : cell,
      ),
    };
    const summary = buildCoverageSummary(stripped, { ...corpus, ledgerRows: undefined });
    expect(summary.attempts.state).toBe("limited");
    if (summary.attempts.state === "limited") {
      expect(summary.attempts.value).toBeGreaterThan(0);
      expect(summary.attempts.unresolved).toBeGreaterThan(0);
      expect(summary.attempts.reason.length).toBeGreaterThan(0);
    }
  });
});

// --- Purity and permutation ---------------------------------------------------

describe("buildCoverageSummary — purity and permutation invariance", () => {
  it("does not mutate the selection or source observations", () => {
    const { selection, corpus } = exactAlphaSelection();
    const idsBefore = selection.cells.map((c) => c.active.observation.id);
    const obsBefore = corpus.observations.map((o) => o.id);
    Object.freeze(selection);
    for (const cell of selection.cells) {
      Object.freeze(cell);
      Object.freeze(cell.active);
    }
    const summary = buildCoverageSummary(selection, corpus);
    expect(available(summary.activeObservations)).toBe(9);
    expect(selection.cells.map((c) => c.active.observation.id)).toEqual(idsBefore);
    expect(corpus.observations.map((o) => o.id)).toEqual(obsBefore);
  });

  it("is permutation-invariant across shuffled corpus inputs", () => {
    const baseline = exactAlphaSelection();
    const expected = snapshotQuantities(buildCoverageSummary(baseline.selection, baseline.corpus));
    const seeds = [1, 2, 3, 99, 12345];
    for (const seed of seeds) {
      const { selection, corpus } = exactAlphaSelection(
        {},
        {
          observations: permute(milestoneAObservations(), seed),
          decisions: permute(milestoneADecisions(), seed + 11),
          ledgerRows: permute(milestoneALedgerRows(), seed + 23),
          configurations: permute(Object.values(MILESTONE_A_GOLDEN.configurations), seed + 31),
        },
      );
      expect(snapshotQuantities(buildCoverageSummary(selection, corpus)), `seed ${seed}`).toEqual(
        expected,
      );
    }
  });
});

// --- No pooled rollup coverage ------------------------------------------------

describe("buildCoverageSummary — no cross-configuration pooling", () => {
  it("does not accept a stratified rollup as a pooled coverage input", () => {
    const result = selectProfileObservations(
      baseQuery({
        respondent: {
          kind: "model_rollup",
          rollupId: ROLLUP_MANIFEST.rollupId,
          version: ROLLUP_MANIFEST.version,
          aggregationPolicy: "stratified_only",
        },
      }),
      goldenCorpus(),
      rollupResolver,
    );
    expect(result.kind).toBe("stratified_only");
    expect(() => buildCoverageSummary(result as unknown as ProfileExactSelection)).toThrow(
      /exact|stratified|pool/i,
    );
  });
});
