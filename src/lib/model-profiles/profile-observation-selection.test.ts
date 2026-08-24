// =============================================================================
// RSemble AI — profile-observation-selection.test.ts (Child 07 Task 3, RED)
//
// Active observation selection: one accepted assessment per
// execution-lineage / task / model cell. Only evidence authorized for
// `within_model_profile` under the requested eligibility rule version
// participates in profile metrics. Retries and reused outputs do not inflate
// independent evidence. Declared replicates stay identifiable; undeclared
// repeats stay visible but are not labeled independent replicates.
//
// Contract under test (Child 07 spec §6.1, plan Task 3):
//  - Resolve the requested exact ModelConfigurationSnapshot.
//  - Resolve EligibilityDecision under the requested rule version — never
//    silently use a different version or invent a decision.
//  - Only `within_model_profile` evidence participates in profile metrics.
//  - Preserve evidence-class, comparability-cohort, Rubric, evaluator, and
//    protocol boundaries (filters restrict; they never pool).
//  - One active assessment per executionLineageId × taskId × model cell.
//  - Retries / reused outputs do not inflate independent evidence.
//  - Declared replicates remain identifiable inside a Task Instance.
//  - Undeclared repeats stay visible and are not labeled independent
//    replicates.
//  - Selection is deterministic and permutation-invariant.
//  - Pure: never mutate source Observations, decisions, or ledger rows.
//  - Do not reuse countEvidence as the profile selector (Child 07 cell key
//    is execution lineage × task × model, not source-task-cell × config).
//  - Model Rollups stay stratified_only — never a pooled synthetic
//    respondent.
// =============================================================================

import { describe, expect, it } from "vitest";

import {
  MILESTONE_A_GOLDEN,
  milestoneADecisions,
  milestoneALedgerRows,
  milestoneAObservations,
} from "./__fixtures__/milestone-a-golden";
import type { EvidenceLedgerRow } from "../evidence/evidence-counting";
import type {
  EligibilityDecision,
  ModelConfigurationSnapshot,
  Observation,
} from "../evidence/evidence-types";
import {
  QUERY_AGGREGATION_RULE_VERSION,
  QUERY_ELIGIBILITY_RULE_VERSION,
  QUERY_UNCERTAINTY_RULE_VERSION,
  serializeModelEvidenceQuery,
  type ModelEvidenceQuery,
  type ResolvedRollupManifest,
  type RollupVersionResolver,
} from "./model-evidence-query";
import {
  selectProfileObservations,
  type ProfileEvidenceCorpus,
  type ProfileExactSelection,
  type ProfileObservationSelection,
} from "./profile-observation-selection";

// --- Fixtures ------------------------------------------------------------------

const CFG = MILESTONE_A_GOLDEN.configurations;
const EXACT_ALPHA = CFG.exactAlpha;
const EXACT_BETA = CFG.exactBeta;
const ROLLING_ALPHA = CFG.rollingAlpha;
const PARTIAL_LEGACY = CFG.partialLegacy;

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

function row(key: string) {
  const found = MILESTONE_A_GOLDEN.rows.find((r) => r.key === key);
  if (!found) throw new Error(`missing golden row ${key}`);
  return found;
}

function expectExact(result: ProfileObservationSelection): ProfileExactSelection {
  expect(result.kind).toBe("exact");
  if (result.kind !== "exact") throw new Error(`expected exact, got ${result.kind}`);
  return result;
}

function activeKeys(selection: ProfileExactSelection): string[] {
  const byId = new Map(MILESTONE_A_GOLDEN.rows.map((r) => [r.observation.id, r.key]));
  return selection.cells
    .map((cell) => byId.get(cell.active.observation.id) ?? cell.active.observation.id)
    .sort((a, b) => a.localeCompare(b));
}

function activeObservationIds(selection: ProfileExactSelection): string[] {
  return selection.cells
    .map((cell) => cell.active.observation.id)
    .sort((a, b) => a.localeCompare(b));
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

const EXPECTED_EXACT_ALPHA_ACTIVE_KEYS = [
  "exact-alpha-math-rejudge",
  "exact-alpha-orphan-first",
  "exact-alpha-orphan-undeclared",
  "exact-alpha-transform-v1-a",
  "exact-alpha-transform-v1-b",
  "exact-alpha-transform-v2",
  "exact-alpha-verify-pass",
  "exact-alpha-write-rep-1",
  "exact-alpha-write-rep-2",
];

// --- Exact configuration resolution -------------------------------------------

describe("selectProfileObservations — exact configuration resolution", () => {
  it("resolves the requested exact ModelConfigurationSnapshot and ignores other configs", () => {
    const selection = expectExact(selectProfileObservations(baseQuery(), goldenCorpus()));
    expect(selection.modelConfiguration).toBe(EXACT_ALPHA);
    expect(selection.modelConfiguration.id).toBe(EXACT_ALPHA.id);
    for (const cell of selection.cells) {
      expect(cell.modelConfigurationId).toBe(EXACT_ALPHA.id);
      expect(cell.active.observation.modelConfigurationId).toBe(EXACT_ALPHA.id);
    }
    const foreign = selection.cells.some(
      (cell) => cell.active.observation.modelConfigurationId !== EXACT_ALPHA.id,
    );
    expect(foreign).toBe(false);
  });

  it("returns unresolved when the requested configuration is not in the corpus", () => {
    const missingId = `mc:sha256:${"f".repeat(64)}`;
    const result = selectProfileObservations(
      baseQuery({ respondent: { kind: "model_configuration", modelConfigurationId: missingId } }),
      goldenCorpus(),
    );
    expect(result.kind).toBe("unresolved");
    if (result.kind !== "unresolved") return;
    expect(result.reason).toBe("configuration_not_found");
  });

  it("returns unresolved for an invalid query instead of inventing a selection", () => {
    const invalid = baseQuery({ observedFrom: 200, observedTo: 100 });
    const result = selectProfileObservations(invalid, goldenCorpus());
    expect(result.kind).toBe("unresolved");
    if (result.kind !== "unresolved") return;
    expect(result.reason).toBe("invalid_query");
  });

  it("keeps reasoning / tool / provider variants as distinct respondents", () => {
    const alpha = expectExact(selectProfileObservations(baseQuery(), goldenCorpus()));
    const tools = expectExact(
      selectProfileObservations(
        baseQuery({
          respondent: {
            kind: "model_configuration",
            modelConfigurationId: CFG.exactAlphaTools.id,
          },
        }),
        goldenCorpus(),
      ),
    );
    expect(alpha.modelConfiguration.id).not.toBe(tools.modelConfiguration.id);
    expect(tools.cells).toHaveLength(1);
    expect(tools.cells[0].active.observation.modelConfigurationId).toBe(CFG.exactAlphaTools.id);
  });
});

// --- Eligibility / use authorization ------------------------------------------

describe("selectProfileObservations — eligibility and within_model_profile", () => {
  it("selects only observations authorized for within_model_profile", () => {
    const selection = expectExact(selectProfileObservations(baseQuery(), goldenCorpus()));
    expect(activeKeys(selection)).toEqual(EXPECTED_EXACT_ALPHA_ACTIVE_KEYS);
    for (const cell of selection.cells) {
      expect(cell.active.decision.allowedUses).toContain("within_model_profile");
      expect(cell.active.decision.ruleVersion).toBe(QUERY_ELIGIBILITY_RULE_VERSION);
    }
  });

  it("keeps excluded and exploratory-without-profile-use visible but out of metrics", () => {
    const selection = expectExact(selectProfileObservations(baseQuery(), goldenCorpus()));
    const unauthorizedIds = new Set(selection.unauthorized.map((u) => u.observation.id));
    expect(unauthorizedIds.has(row("exact-alpha-transform-corrupt").observation.id)).toBe(true);
    expect(activeObservationIds(selection)).not.toContain(
      row("exact-alpha-transform-corrupt").observation.id,
    );
    const corrupt = selection.unauthorized.find(
      (u) => u.observation.id === row("exact-alpha-transform-corrupt").observation.id,
    );
    expect(corrupt?.reason).toBe("use_not_authorized");
    expect(corrupt?.decision?.status).toBe("excluded");

    const partial = expectExact(
      selectProfileObservations(
        baseQuery({
          respondent: {
            kind: "model_configuration",
            modelConfigurationId: PARTIAL_LEGACY.id,
          },
        }),
        goldenCorpus(),
      ),
    );
    expect(partial.cells).toHaveLength(0);
    expect(partial.unauthorized).toHaveLength(1);
    expect(partial.unauthorized[0].reason).toBe("use_not_authorized");
    expect(partial.unauthorized[0].decision?.allowedUses).not.toContain("within_model_profile");
  });

  it("resolves EligibilityDecision only under the requested rule version", () => {
    const shifted: EligibilityDecision[] = milestoneADecisions().map((d) => ({
      ...d,
      ruleVersion: 99,
    }));
    const selection = expectExact(
      selectProfileObservations(baseQuery(), goldenCorpus({ decisions: shifted })),
    );
    expect(selection.cells).toHaveLength(0);
    expect(selection.unauthorized.length).toBeGreaterThan(0);
    expect(selection.unauthorized.every((u) => u.reason === "no_decision_for_rule_version")).toBe(
      true,
    );
    expect(selection.unauthorized.every((u) => u.decision === null)).toBe(true);
  });

  it("does not treat get-active-highest-version semantics as the profile rule pin", () => {
    const extra: EligibilityDecision[] = [
      ...milestoneADecisions(),
      ...milestoneADecisions().map((d) => ({
        ...d,
        ruleVersion: 99,
        allowedUses: [] as EligibilityDecision["allowedUses"],
        status: "excluded" as const,
      })),
    ];
    const selection = expectExact(
      selectProfileObservations(baseQuery(), goldenCorpus({ decisions: extra })),
    );
    expect(activeKeys(selection)).toEqual(EXPECTED_EXACT_ALPHA_ACTIVE_KEYS);
  });

  it("excludes a rolling-alias respondent when includeUnknownVersion is false", () => {
    const hidden = expectExact(
      selectProfileObservations(
        baseQuery({
          respondent: {
            kind: "model_configuration",
            modelConfigurationId: ROLLING_ALPHA.id,
          },
          includeUnknownVersion: false,
        }),
        goldenCorpus(),
      ),
    );
    expect(hidden.cells).toHaveLength(0);
    expect(hidden.unauthorized.some((u) => u.reason === "unknown_version_excluded")).toBe(true);

    const shown = expectExact(
      selectProfileObservations(
        baseQuery({
          respondent: {
            kind: "model_configuration",
            modelConfigurationId: ROLLING_ALPHA.id,
          },
          includeUnknownVersion: true,
        }),
        goldenCorpus(),
      ),
    );
    expect(shown.cells).toHaveLength(1);
    expect(shown.cells[0].active.decision.allowedUses).toContain("within_model_profile");
    expect(shown.cells[0].active.decision.status).toBe("provisional");
  });
});

// --- One active assessment per lineage cell -----------------------------------

describe("selectProfileObservations — one active assessment per lineage cell", () => {
  it("chooses the latest accepted assessment in an execution-lineage/task/model cell", () => {
    const selection = expectExact(selectProfileObservations(baseQuery(), goldenCorpus()));
    const retry = row("exact-alpha-math-retry");
    const rejudge = row("exact-alpha-math-rejudge");
    expect(retry.observation.executionLineageId).toBe(rejudge.observation.executionLineageId);
    expect(retry.observation.taskId).toBe(rejudge.observation.taskId);
    expect(retry.observation.modelConfigurationId).toBe(rejudge.observation.modelConfigurationId);

    const keys = activeKeys(selection);
    expect(keys).toContain("exact-alpha-math-rejudge");
    expect(keys).not.toContain("exact-alpha-math-retry");

    const mathCell = selection.cells.find(
      (cell) => cell.active.observation.id === rejudge.observation.id,
    );
    expect(mathCell).toBeDefined();
    expect(mathCell!.supersededAssessments.map((s) => s.observation.id)).toEqual([
      retry.observation.id,
    ]);
    expect(mathCell!.active.ledger?.sequence).toBe(2);
    expect(mathCell!.active.ledger?.reusedCandidateOutput).toBe(true);
  });

  it("does not let retries or reused outputs become extra independent cells", () => {
    const selection = expectExact(selectProfileObservations(baseQuery(), goldenCorpus()));
    const mathCells = selection.cells.filter((cell) => cell.taskId === "task-math");
    expect(mathCells).toHaveLength(1);
    expect(mathCells[0].active.observation.candidateAttemptId).toBe("att-math-ok");
  });

  it("uses executionLineageId × task × model as the cell — not countEvidence lineageCellKey", () => {
    const selection = expectExact(selectProfileObservations(baseQuery(), goldenCorpus()));
    const write = selection.cells.filter((cell) => cell.taskId === "task-write");
    expect(write).toHaveLength(2);
    expect(new Set(write.map((cell) => cell.executionLineageId)).size).toBe(2);
    expect(new Set(write.map((cell) => cell.taskInstanceId)).size).toBe(1);
    expect(new Set(write.map((cell) => cell.cellKey)).size).toBe(2);
  });
});

// --- Declared replicates vs undeclared repeats --------------------------------

describe("selectProfileObservations — declared replicates and undeclared repeats", () => {
  it("keeps declared replicates identifiable and grouped inside the Task Instance", () => {
    const selection = expectExact(selectProfileObservations(baseQuery(), goldenCorpus()));
    expect(selection.declaredReplicateGroups).toHaveLength(1);
    const group = selection.declaredReplicateGroups[0];
    expect(group.taskId).toBe("task-write");
    expect(group.taskInstanceId).toBe("inst-write-a");
    expect(group.records).toHaveLength(2);
    expect(group.records.every((r) => r.ledger?.declaredReplicate === true)).toBe(true);
    expect(new Set(group.records.map((r) => r.observation.executionLineageId)).size).toBe(2);
    expect(activeKeys(selection)).toEqual(
      expect.arrayContaining(["exact-alpha-write-rep-1", "exact-alpha-write-rep-2"]),
    );
  });

  it("keeps undeclared repeats visible and does not label them independent replicates", () => {
    const selection = expectExact(selectProfileObservations(baseQuery(), goldenCorpus()));
    const undeclaredIds = selection.undeclaredRepeats.map((r) => r.observation.id);
    expect(undeclaredIds).toContain(row("exact-alpha-orphan-undeclared").observation.id);
    expect(undeclaredIds).not.toContain(row("exact-alpha-orphan-first").observation.id);
    expect(
      selection.undeclaredRepeats.every((r) =>
        r.decision.reasonCodes.includes("undeclared_repeat"),
      ),
    ).toBe(true);
    expect(selection.undeclaredRepeats.every((r) => r.ledger?.declaredReplicate !== true)).toBe(
      true,
    );
    const declaredIds = new Set(
      selection.declaredReplicateGroups.flatMap((g) => g.records.map((r) => r.observation.id)),
    );
    expect(declaredIds.has(row("exact-alpha-orphan-undeclared").observation.id)).toBe(false);
    expect(activeKeys(selection)).toEqual(
      expect.arrayContaining(["exact-alpha-orphan-first", "exact-alpha-orphan-undeclared"]),
    );
  });
});

// --- Query filters preserve boundaries ----------------------------------------

describe("selectProfileObservations — filters preserve boundaries", () => {
  it("filters by observation window without inventing cells", () => {
    const selection = expectExact(
      selectProfileObservations(
        baseQuery({ observedFrom: T0 + 55_000, observedTo: T0 + 65_000 }),
        goldenCorpus(),
      ),
    );
    expect(activeKeys(selection)).toEqual(["exact-alpha-verify-pass"]);
  });

  it("filters by task family using the denormalized family id", () => {
    const selection = expectExact(
      selectProfileObservations(baseQuery({ taskFamilyIds: ["family-write"] }), goldenCorpus()),
    );
    expect(activeKeys(selection)).toEqual(["exact-alpha-write-rep-1", "exact-alpha-write-rep-2"]);
    expect(
      selection.cells.every((cell) => cell.active.observation.taskFamilyId === "family-write"),
    ).toBe(true);
  });

  it("joins facet filters by taskId (and optional taskVersion)", () => {
    const rewrite = expectExact(
      selectProfileObservations(
        baseQuery({ facetFilters: [{ facetId: "task-form", valueIds: ["rewrite"] }] }),
        goldenCorpus(),
      ),
    );
    expect(rewrite.cells.every((cell) => cell.taskId === "task-transform")).toBe(true);
    expect(activeKeys(rewrite)).toEqual([
      "exact-alpha-transform-v1-a",
      "exact-alpha-transform-v1-b",
      "exact-alpha-transform-v2",
    ]);

    const membership = expectExact(
      selectProfileObservations(
        baseQuery({ facetFilters: [{ facetId: "domain", valueIds: [] }] }),
        goldenCorpus(),
      ),
    );
    expect(membership.cells.every((cell) => cell.taskId === "task-write")).toBe(true);
  });

  it("filters by evidence class, cohort, rubric, evaluator, and source without pooling", () => {
    const verified = expectExact(
      selectProfileObservations(baseQuery({ evidenceClasses: ["verified"] }), goldenCorpus()),
    );
    expect(activeKeys(verified)).toEqual(["exact-alpha-verify-pass"]);

    const style = expectExact(
      selectProfileObservations(
        baseQuery({ rubricRefs: [{ id: "rub-style", version: 1 }] }),
        goldenCorpus(),
      ),
    );
    expect(activeKeys(style)).toEqual(["exact-alpha-math-rejudge"]);

    const human = expectExact(
      selectProfileObservations(
        baseQuery({
          evaluatorFilters: [
            {
              evaluatorKind: "human_authorized",
              providerId: null,
              model: null,
              instructionDigest: null,
            },
          ],
        }),
        goldenCorpus(),
      ),
    );
    expect(activeKeys(human)).toEqual(["exact-alpha-math-rejudge"]);

    const transformCohort = row("exact-alpha-transform-v1-a").decision.comparabilityCohortId;
    const cohort = expectExact(
      selectProfileObservations(
        baseQuery({ comparabilityCohortIds: [transformCohort] }),
        goldenCorpus(),
      ),
    );
    expect(
      cohort.cells.every((cell) => cell.active.decision.comparabilityCohortId === transformCohort),
    ).toBe(true);
    expect(activeKeys(cohort)).toContain("exact-alpha-transform-v1-a");
    expect(activeKeys(cohort)).not.toContain("exact-alpha-math-rejudge");
  });

  it("does not admit profile metrics when allowedUses omits within_model_profile", () => {
    const selection = expectExact(
      selectProfileObservations(baseQuery({ allowedUses: ["task_descriptive"] }), goldenCorpus()),
    );
    expect(selection.cells).toHaveLength(0);
  });
});

// --- Purity -------------------------------------------------------------------

describe("selectProfileObservations — pure selector", () => {
  it("never mutates source observations, decisions, or ledger rows", () => {
    const observations = milestoneAObservations();
    const decisions = milestoneADecisions();
    const ledgerRows = milestoneALedgerRows();
    const configurations = Object.values(MILESTONE_A_GOLDEN.configurations);

    for (const item of observations) Object.freeze(item);
    for (const item of decisions) Object.freeze(item);
    for (const item of ledgerRows) Object.freeze(item);
    for (const item of configurations) Object.freeze(item);

    const obsBefore = observations.map((o) => o.id);
    const decisionBefore = decisions.map((d) => `${d.observationId}:${d.ruleVersion}:${d.status}`);
    const ledgerBefore = ledgerRows.map((r) => `${r.assessmentEventId}:${r.sequence}`);

    const selection = expectExact(
      selectProfileObservations(
        baseQuery(),
        goldenCorpus({ observations, decisions, ledgerRows, configurations }),
      ),
    );

    expect(observations.map((o) => o.id)).toEqual(obsBefore);
    expect(decisions.map((d) => `${d.observationId}:${d.ruleVersion}:${d.status}`)).toEqual(
      decisionBefore,
    );
    expect(ledgerRows.map((r) => `${r.assessmentEventId}:${r.sequence}`)).toEqual(ledgerBefore);

    const original = observations.find((o) => o.id === selection.cells[0].active.observation.id);
    expect(selection.cells[0].active.observation).toBe(original);
  });
});

// --- Permutation invariance ---------------------------------------------------

describe("selectProfileObservations — permutation invariance", () => {
  it("selects the same active cells under shuffled observations, decisions, and ledger rows", () => {
    const baseline = expectExact(selectProfileObservations(baseQuery(), goldenCorpus()));
    const baselineIds = activeObservationIds(baseline);
    const baselineCells = baseline.cells.map((c) => c.cellKey);
    const seeds = [1, 2, 3, 99, 12345, 7_001_003];

    for (const seed of seeds) {
      const corpus = goldenCorpus({
        observations: permute(milestoneAObservations(), seed),
        decisions: permute(milestoneADecisions(), seed + 1),
        ledgerRows: permute(milestoneALedgerRows(), seed + 2),
        configurations: permute(Object.values(MILESTONE_A_GOLDEN.configurations), seed + 3),
      });
      const next = expectExact(selectProfileObservations(baseQuery(), corpus));
      expect(activeObservationIds(next), `seed ${seed}`).toEqual(baselineIds);
      expect(
        next.cells.map((c) => c.cellKey),
        `cell order seed ${seed}`,
      ).toEqual(baselineCells);
      expect(activeKeys(next)).toEqual(EXPECTED_EXACT_ALPHA_ACTIVE_KEYS);
    }
  });
});

// --- Stratified rollup: never pool --------------------------------------------

describe("selectProfileObservations — stratified rollup is not pooled", () => {
  it("returns per-member exact selections and never a pooled cell list", () => {
    const result = selectProfileObservations(
      baseQuery({
        respondent: {
          kind: "model_rollup",
          rollupId: ROLLUP_MANIFEST.rollupId,
          version: ROLLUP_MANIFEST.version,
          aggregationPolicy: "stratified_only",
        },
        includeUnknownVersion: true,
      }),
      goldenCorpus(),
      rollupResolver,
    );
    expect(result.kind).toBe("stratified_only");
    if (result.kind !== "stratified_only") return;
    expect(result.memberConfigurationIds).toEqual([EXACT_ALPHA.id, EXACT_BETA.id]);
    expect(result.members).toHaveLength(2);
    expect(result.members.map((m) => m.modelConfiguration.id).sort()).toEqual(
      [EXACT_ALPHA.id, EXACT_BETA.id].sort(),
    );
    expect(result.members.every((m) => m.kind === "exact")).toBe(true);
    const allConfigIds = new Set(
      result.members.flatMap((m) => m.cells.map((c) => c.modelConfigurationId)),
    );
    expect(allConfigIds.has(EXACT_ALPHA.id)).toBe(true);
    expect(allConfigIds.has(EXACT_BETA.id)).toBe(true);
    for (const member of result.members) {
      expect(
        member.cells.every((c) => c.modelConfigurationId === member.modelConfiguration.id),
      ).toBe(true);
    }
  });

  it("returns unresolved when a rollup version cannot be resolved", () => {
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
    );
    expect(result.kind).toBe("unresolved");
    if (result.kind !== "unresolved") return;
    expect(result.reason).toBe("rollup_unresolved");
  });

  it("consumes the validated manifest exactly once — receipt and executed member set cannot diverge", () => {
    let calls = 0;
    const onceResolver: RollupVersionResolver = (rollupId, version) => {
      calls += 1;
      if (rollupId === ROLLUP_MANIFEST.rollupId && version === ROLLUP_MANIFEST.version) {
        // First resolution: alpha + beta. Any second call would return a
        // different member set — a divergence a stale re-resolve would ingest.
        return calls === 1
          ? { ...ROLLUP_MANIFEST, memberConfigurationIds: [EXACT_ALPHA.id, EXACT_BETA.id] }
          : { ...ROLLUP_MANIFEST, memberConfigurationIds: [EXACT_ALPHA.id] };
      }
      return null;
    };
    const q = baseQuery({
      respondent: {
        kind: "model_rollup",
        rollupId: ROLLUP_MANIFEST.rollupId,
        version: ROLLUP_MANIFEST.version,
        aggregationPolicy: "stratified_only",
      },
      includeUnknownVersion: true,
    });

    const receipt = serializeModelEvidenceQuery(q, onceResolver);
    const receiptMembers =
      receipt.resolvedRespondent.kind === "model_rollup"
        ? receipt.resolvedRespondent.manifest.memberConfigurationIds
        : [];

    calls = 0;
    const result = selectProfileObservations(q, goldenCorpus(), onceResolver);
    expect(calls).toBe(1);
    expect(result.kind).toBe("stratified_only");
    if (result.kind !== "stratified_only") return;
    expect(result.memberConfigurationIds).toEqual(receiptMembers);
    expect(result.memberConfigurationIds).toEqual([EXACT_ALPHA.id, EXACT_BETA.id]);
    expect(result.members.map((m) => m.modelConfiguration.id).sort()).toEqual(
      receiptMembers.slice().sort(),
    );
  });
});

// Type-only references so the RED suite names the live Child 04 records it
// must not mutate and the corpus fields it consumes.
export type _SelectionPurityRefs = {
  observation: Observation;
  decision: EligibilityDecision;
  ledger: EvidenceLedgerRow;
  configuration: ModelConfigurationSnapshot;
};
