// =============================================================================
// RSemble AI — paired-comparison.test.ts (Child 07 Task 6, RED)
//
// Paired shared-task comparison over explicitly selected exact configurations.
// Shared Tasks only (intersection of task identity); compatible assessment
// cohorts only; wins/ties/losses with an epsilon/tie rule; paired Task-level
// deltas; missing cells handled and disclosed; no shared Tasks -> explicit
// empty state. Changed task versions: known-related Tasks never treated as
// independent (dependency-aware bootstrap assignment via T5 units). Bootstraps
// paired deltas with the same disclosed dependency-aware resampling units.
// Never compares unrelated task mixes.
//
// Contract under test (Child 07 spec §6.5, plan Task 6):
//  - intersection only: tasks present in both selections
//  - only observations eligible for paired_model_comparison participate
//  - compatible assessment cohorts only (same rubric/verifier + protocol +
//    evaluator); incompatible cohorts disclosed, never pooled
//  - wins/ties/losses per shared task with an epsilon/tie rule
//  - paired Task-level deltas (A metric - B metric)
//  - missing cells handled and disclosed (instance asymmetry, missing-in-A,
//    missing-in-B)
//  - no shared Tasks -> explicit empty state with reason
//  - changed task versions: same task identity is shared; version mismatch
//    disclosed; never treated as independent resampling units
//  - known-related Tasks (same family / declared relation) grouped into one
//    dependency-aware resampling unit, never independent
//  - bootstrap of paired deltas uses the disclosed dependency-aware units;
//    below five units -> insufficient coverage, no fake interval
//  - deterministic, permutation-invariant; never mutates inputs
//  - never compares unrelated task mixes
// =============================================================================

import { describe, expect, it } from "vitest";

import type { EvidenceLedgerRow } from "../evidence/evidence-counting";
import {
  OBSERVATION_SCHEMA_VERSION,
  type EligibilityDecision,
  type EvaluatorSnapshot,
  type EvidenceUse,
  type ModelConfigurationSnapshot,
  type Observation,
  type ObservationOutcome,
  type VerifierSnapshot,
} from "../evidence/evidence-types";
import type { TaskFamilyRelation, VersionRef } from "../tasks/task-types";
import {
  MILESTONE_A_GOLDEN,
  milestoneADecisions,
  milestoneALedgerRows,
  milestoneAObservations,
} from "./__fixtures__/milestone-a-golden";
import type { CommensurateRubricMapping, CompatibleVerifierDefinition } from "./family-aggregation";
import {
  QUERY_AGGREGATION_RULE_VERSION,
  QUERY_ELIGIBILITY_RULE_VERSION,
  QUERY_UNCERTAINTY_RULE_VERSION,
  type ModelEvidenceQuery,
} from "./model-evidence-query";
import {
  profileLineageCellKey,
  selectProfileObservations,
  type ProfileEvidenceCorpus,
  type ProfileExactSelection,
  type ProfileSelectedCell,
  type ProfileSelectedRecord,
} from "./profile-observation-selection";
import {
  computePairedEvidence,
  PAIRED_COMPARISON_RULE_VERSION,
  type PairedComparisonInput,
  type PairedComparisonOptions,
  type PairedComparisonResult,
  type PairedMetricKind,
  type PairedOutcome,
  type PairedTaskDelta,
  type PairedTaskState,
} from "./paired-comparison";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CFG = MILESTONE_A_GOLDEN.configurations;
const EXACT_ALPHA = CFG.exactAlpha;
const EXACT_BETA = CFG.exactBeta;
const T0 = 1_704_067_200_000;

const RUBRIC_QUALITY: VersionRef = { id: "rub-quality", version: 3 };
const RUBRIC_QUALITY_V4: VersionRef = { id: "rub-quality", version: 4 };
const RUBRIC_STYLE: VersionRef = { id: "rub-style", version: 1 };

const PROTOCOL_A = `sha256:${"a".repeat(64)}`;
const PROTOCOL_B = `sha256:${"b".repeat(64)}`;

const JUDGE_A: EvaluatorSnapshot = {
  kind: "model_judge",
  providerId: "openrouter",
  model: "org/judge",
  resolvedVersion: "2026-01-01",
  instructionDigest: `sha256:${"3".repeat(64)}`,
  reasoningEffort: "high",
  toolScaffoldSignature: null,
};

const JUDGE_B: EvaluatorSnapshot = {
  kind: "model_judge",
  providerId: "openrouter",
  model: "org/judge-holdout",
  resolvedVersion: "2026-03-01",
  instructionDigest: `sha256:${"4".repeat(64)}`,
  reasoningEffort: "medium",
  toolScaffoldSignature: "eval-tools:v1",
};

const VERIFIER_A: VerifierSnapshot = {
  verifierRef: { id: "ver-exact-match", version: 2 },
  kind: "exact_match",
  configurationDigest: `sha256:${"7".repeat(64)}`,
};

const VERIFIER_B: VerifierSnapshot = {
  verifierRef: { id: "ver-numeric", version: 1 },
  kind: "numeric",
  configurationDigest: `sha256:${"8".repeat(64)}`,
};

const QUERY_FP = `sha256:${"q".repeat(64)}`;

// ---------------------------------------------------------------------------
// Cell / selection builders
// ---------------------------------------------------------------------------

let recordSeq = 0;

interface CellSpec {
  taskId: string;
  taskVersion?: number;
  taskInstanceId: string;
  familyId?: string | null;
  score?: number | null;
  verifierPassed?: boolean | null;
  rubric?: VersionRef | null;
  protocol?: string;
  evaluator?: EvaluatorSnapshot;
  verifier?: VerifierSnapshot | null;
  configuration: ModelConfigurationSnapshot;
  allowedUses?: readonly EvidenceUse[];
  observationId?: string;
  lineage?: string;
  sourceResultId?: string;
  evidenceClass?: EligibilityDecision["evidenceClass"];
}

function makeRecord(spec: CellSpec): ProfileSelectedRecord {
  recordSeq += 1;
  const n = recordSeq;
  const configuration = spec.configuration;
  const observationId = spec.observationId ?? `obs-${n}`;
  const lineage = spec.lineage ?? `lin-${n}`;
  const rubricRef = spec.rubric === undefined ? RUBRIC_QUALITY : spec.rubric;
  const evaluator = spec.evaluator ?? JUDGE_A;
  const verifier = spec.verifier === undefined ? null : spec.verifier;
  const score = spec.score === undefined ? 4 : spec.score;
  const verifierPassed = spec.verifierPassed === undefined ? null : spec.verifierPassed;
  const outcome: ObservationOutcome = {
    judgeAccepted: true,
    overallScore: score,
    criterionValues: [],
    verifierPassed,
  };
  const observation: Observation = {
    id: observationId,
    sourceKind: "evaluation",
    sourceResultId: spec.sourceResultId ?? `src-${n}`,
    executionLineageId: lineage,
    runId: `run-${n}`,
    sourceTaskCellId: `cell-${n}`,
    taskId: spec.taskId,
    taskVersion: spec.taskVersion ?? 1,
    taskInstanceId: spec.taskInstanceId,
    taskFamilyId: spec.familyId ?? null,
    modelConfigurationId: configuration.id,
    candidateAttemptId: `att-${n}`,
    assessmentRef: {
      judgeAttemptId: `j-${n}`,
      judgeProviderId: evaluator.providerId,
      judgeModel: evaluator.model,
      blindLabelMapping: {},
      candidateAttemptIdsByCandidateId: {},
      rubricRef,
      verifierRef: verifier?.verifierRef ?? null,
      verifierOutcome:
        verifierPassed === null
          ? null
          : {
              taskId: spec.taskId,
              modelKey: `${configuration.providerId}:${configuration.requestedModel}`,
              passed: verifierPassed,
              executedAt: T0 + n,
            },
    },
    protocolFingerprint: spec.protocol ?? PROTOCOL_A,
    rubricRef,
    evaluatorSnapshot: evaluator,
    verifierSnapshot: verifier,
    outcome,
    observedAt: T0 + n,
    observationSchemaVersion: OBSERVATION_SCHEMA_VERSION,
  };
  const allowedUses: readonly EvidenceUse[] = spec.allowedUses ?? [
    "task_descriptive",
    "within_model_profile",
    "paired_model_comparison",
  ];
  const decision: EligibilityDecision = {
    observationId,
    ruleVersion: QUERY_ELIGIBILITY_RULE_VERSION,
    status: "eligible",
    evidenceClass: spec.evidenceClass ?? (verifierPassed === true ? "verified" : "comparable"),
    allowedUses: [...allowedUses],
    reasonCodes: ["assessment_selected_completed"],
    comparabilityCohortId: `sha256:${n.toString(16).padStart(64, "c")}`,
    decidedAt: T0 + n + 1,
  };
  const ledger: EvidenceLedgerRow = {
    lineageCellKey: `${observation.sourceTaskCellId}::${configuration.id}`,
    taskId: observation.taskId,
    taskVersion: observation.taskVersion,
    taskInstanceId: observation.taskInstanceId,
    modelConfigurationId: configuration.id,
    sequence: 1,
    candidateAttemptId: observation.candidateAttemptId,
    reusedCandidateOutput: false,
    declaredReplicate: false,
    assessmentEventId: observation.assessmentRef.judgeAttemptId,
    attemptIds: [observation.candidateAttemptId],
  };
  return { observation, decision, ledger };
}

function makeCell(spec: CellSpec): ProfileSelectedCell {
  const record = makeRecord(spec);
  const configuration = spec.configuration;
  return {
    cellKey: profileLineageCellKey(
      record.observation.executionLineageId,
      record.observation.taskId,
      configuration.id,
    ),
    executionLineageId: record.observation.executionLineageId,
    taskId: record.observation.taskId,
    taskVersion: record.observation.taskVersion,
    taskInstanceId: record.observation.taskInstanceId,
    modelConfigurationId: configuration.id,
    active: record,
    supersededAssessments: [],
  };
}

function makeSelection(
  cells: ProfileSelectedCell[],
  configuration: ModelConfigurationSnapshot,
): ProfileExactSelection {
  return {
    kind: "exact",
    modelConfiguration: configuration,
    eligibilityRuleVersion: QUERY_ELIGIBILITY_RULE_VERSION,
    cells,
    unauthorized: [],
    declaredReplicateGroups: [],
    undeclaredRepeats: [],
  };
}

function pairedInput(
  selectionA: ProfileExactSelection,
  selectionB: ProfileExactSelection,
  options: PairedComparisonOptions,
  overrides: Partial<PairedComparisonInput["uncertainty"]> = {},
): PairedComparisonInput {
  return {
    selectionA,
    selectionB,
    options,
    uncertainty: {
      taskFamilyRelations: [],
      taskFamilyAssignments: [],
      queryFingerprint: QUERY_FP,
      ...overrides,
    },
  };
}

function permute<T>(items: readonly T[], seed: number): T[] {
  const arr = [...items];
  let s = seed | 0;
  for (let i = arr.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) | 0;
    const j = ((s >>> 0) % (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

function findDelta(result: PairedComparisonResult, taskId: string): PairedTaskDelta {
  const d = result.taskDeltas.find((t) => t.taskId === taskId);
  if (!d) throw new Error(`no task delta for ${taskId}`);
  return d;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("computePairedEvidence — intersection only", () => {
  it("returns an explicit empty state when there are no shared tasks", () => {
    const a = makeSelection(
      [
        makeCell({ taskId: "task-a", taskInstanceId: "inst-a", configuration: EXACT_ALPHA }),
        makeCell({ taskId: "task-b", taskInstanceId: "inst-b", configuration: EXACT_ALPHA }),
      ],
      EXACT_ALPHA,
    );
    const b = makeSelection(
      [
        makeCell({ taskId: "task-c", taskInstanceId: "inst-c", configuration: EXACT_BETA }),
        makeCell({ taskId: "task-d", taskInstanceId: "inst-d", configuration: EXACT_BETA }),
      ],
      EXACT_BETA,
    );

    const result = computePairedEvidence(pairedInput(a, b, { metric: "judged_score" }));

    expect(result.empty).toBe(true);
    expect(result.emptyReason).toBeTruthy();
    expect(result.coverage.sharedTaskCount).toBe(0);
    expect(result.coverage.comparableTaskCount).toBe(0);
    expect(result.coverage.wins).toBe(0);
    expect(result.coverage.ties).toBe(0);
    expect(result.coverage.losses).toBe(0);
    expect(result.taskDeltas).toHaveLength(4);
    expect(result.meanDelta).toBeNull();
    expect(result.bootstrap).toBeNull();
    expect(result.uncertaintyResolution).toBeNull();
    for (const delta of result.taskDeltas) {
      expect(delta.state === "missing_in_a" || delta.state === "missing_in_b").toBe(true);
      expect(delta.delta).toBeNull();
      expect(delta.outcome).toBeNull();
    }
  });

  it("never compares unrelated task mixes: tasks only in one side are missing, not compared", () => {
    const a = makeSelection(
      [
        makeCell({
          taskId: "task-shared",
          taskInstanceId: "inst-s",
          score: 5,
          configuration: EXACT_ALPHA,
        }),
        makeCell({
          taskId: "task-only-a",
          taskInstanceId: "inst-a",
          score: 3,
          configuration: EXACT_ALPHA,
        }),
      ],
      EXACT_ALPHA,
    );
    const b = makeSelection(
      [
        makeCell({
          taskId: "task-shared",
          taskInstanceId: "inst-s",
          score: 2,
          configuration: EXACT_BETA,
        }),
        makeCell({
          taskId: "task-only-b",
          taskInstanceId: "inst-b",
          score: 1,
          configuration: EXACT_BETA,
        }),
      ],
      EXACT_BETA,
    );

    const result = computePairedEvidence(pairedInput(a, b, { metric: "judged_score" }));

    expect(result.empty).toBe(false);
    expect(result.coverage.sharedTaskCount).toBe(1);
    expect(findDelta(result, "task-only-a").state).toBe("missing_in_b");
    expect(findDelta(result, "task-only-b").state).toBe("missing_in_a");
    expect(findDelta(result, "task-only-a").delta).toBeNull();
    expect(findDelta(result, "task-only-b").delta).toBeNull();
    expect(findDelta(result, "task-shared").state).toBe("comparable");
    expect(findDelta(result, "task-shared").delta).toBe(3);
  });

  it("only observations eligible for paired_model_comparison participate", () => {
    // task-eligible: both sides have paired_model_comparison -> shared & compared.
    // task-skipped: both sides have within_model_profile only -> not paired.
    const a = makeSelection(
      [
        makeCell({
          taskId: "task-eligible",
          taskInstanceId: "inst-1",
          score: 5,
          configuration: EXACT_ALPHA,
          allowedUses: ["task_descriptive", "within_model_profile", "paired_model_comparison"],
        }),
        makeCell({
          taskId: "task-skipped",
          taskInstanceId: "inst-2",
          score: 5,
          configuration: EXACT_ALPHA,
          allowedUses: ["task_descriptive", "within_model_profile"],
        }),
      ],
      EXACT_ALPHA,
    );
    const b = makeSelection(
      [
        makeCell({
          taskId: "task-eligible",
          taskInstanceId: "inst-1",
          score: 1,
          configuration: EXACT_BETA,
          allowedUses: ["task_descriptive", "within_model_profile", "paired_model_comparison"],
        }),
        makeCell({
          taskId: "task-skipped",
          taskInstanceId: "inst-2",
          score: 1,
          configuration: EXACT_BETA,
          allowedUses: ["task_descriptive", "within_model_profile"],
        }),
      ],
      EXACT_BETA,
    );

    const result = computePairedEvidence(pairedInput(a, b, { metric: "judged_score" }));

    // task-skipped is not paired-eligible on either side, so it is NOT shared.
    expect(result.coverage.sharedTaskCount).toBe(1);
    expect(findDelta(result, "task-eligible").state).toBe("comparable");
    const skipped = result.taskDeltas.find((t) => t.taskId === "task-skipped");
    expect(skipped).toBeUndefined();
    expect(result.coverage.wins).toBe(1);
  });
});

describe("computePairedEvidence — compatible cohorts only", () => {
  it("compares when both sides share rubric + protocol + evaluator", () => {
    const a = makeSelection(
      [
        makeCell({
          taskId: "task-x",
          taskInstanceId: "inst-x",
          score: 5,
          rubric: RUBRIC_QUALITY,
          protocol: PROTOCOL_A,
          evaluator: JUDGE_A,
          configuration: EXACT_ALPHA,
        }),
      ],
      EXACT_ALPHA,
    );
    const b = makeSelection(
      [
        makeCell({
          taskId: "task-x",
          taskInstanceId: "inst-x",
          score: 2,
          rubric: RUBRIC_QUALITY,
          protocol: PROTOCOL_A,
          evaluator: JUDGE_A,
          configuration: EXACT_BETA,
        }),
      ],
      EXACT_BETA,
    );

    const result = computePairedEvidence(pairedInput(a, b, { metric: "judged_score" }));

    expect(findDelta(result, "task-x").state).toBe("comparable");
    expect(findDelta(result, "task-x").delta).toBe(3);
    expect(findDelta(result, "task-x").cohortId).toBeTruthy();
  });

  it("marks incompatible and discloses when rubrics differ and no commensurate mapping", () => {
    const a = makeSelection(
      [
        makeCell({
          taskId: "task-x",
          taskInstanceId: "inst-x",
          score: 5,
          rubric: RUBRIC_QUALITY,
          protocol: PROTOCOL_A,
          evaluator: JUDGE_A,
          configuration: EXACT_ALPHA,
        }),
      ],
      EXACT_ALPHA,
    );
    const b = makeSelection(
      [
        makeCell({
          taskId: "task-x",
          taskInstanceId: "inst-x",
          score: 2,
          rubric: RUBRIC_STYLE,
          protocol: PROTOCOL_A,
          evaluator: JUDGE_A,
          configuration: EXACT_BETA,
        }),
      ],
      EXACT_BETA,
    );

    const result = computePairedEvidence(pairedInput(a, b, { metric: "judged_score" }));

    const delta = findDelta(result, "task-x");
    expect(delta.state).toBe("incompatible_cohort");
    expect(delta.delta).toBeNull();
    expect(delta.outcome).toBeNull();
    expect(delta.disclosure).toBeTruthy();
    expect(result.coverage.incompatibleTaskCount).toBe(1);
    expect(result.coverage.comparableTaskCount).toBe(0);
    expect(result.coverage.wins).toBe(0);
    expect(result.disclosures.some((d) => d.toLowerCase().includes("incompatible"))).toBe(true);
  });

  it("treats rubrics as compatible when a commensurate mapping groups them", () => {
    const mappings: CommensurateRubricMapping[] = [
      { groupId: "quality-family", rubricRef: RUBRIC_QUALITY },
      { groupId: "quality-family", rubricRef: RUBRIC_QUALITY_V4 },
    ];
    const a = makeSelection(
      [
        makeCell({
          taskId: "task-x",
          taskInstanceId: "inst-x",
          score: 5,
          rubric: RUBRIC_QUALITY,
          configuration: EXACT_ALPHA,
        }),
      ],
      EXACT_ALPHA,
    );
    const b = makeSelection(
      [
        makeCell({
          taskId: "task-x",
          taskInstanceId: "inst-x",
          score: 2,
          rubric: RUBRIC_QUALITY_V4,
          configuration: EXACT_BETA,
        }),
      ],
      EXACT_BETA,
    );

    const result = computePairedEvidence(
      pairedInput(a, b, { metric: "judged_score", commensurateRubricMappings: mappings }),
    );

    expect(findDelta(result, "task-x").state).toBe("comparable");
    expect(findDelta(result, "task-x").delta).toBe(3);
  });

  it("marks incompatible when protocols differ", () => {
    const a = makeSelection(
      [
        makeCell({
          taskId: "task-x",
          taskInstanceId: "inst-x",
          score: 5,
          protocol: PROTOCOL_A,
          configuration: EXACT_ALPHA,
        }),
      ],
      EXACT_ALPHA,
    );
    const b = makeSelection(
      [
        makeCell({
          taskId: "task-x",
          taskInstanceId: "inst-x",
          score: 2,
          protocol: PROTOCOL_B,
          configuration: EXACT_BETA,
        }),
      ],
      EXACT_BETA,
    );

    const result = computePairedEvidence(pairedInput(a, b, { metric: "judged_score" }));

    expect(findDelta(result, "task-x").state).toBe("incompatible_cohort");
    expect(result.coverage.incompatibleTaskCount).toBe(1);
  });

  it("marks incompatible when evaluators differ", () => {
    const a = makeSelection(
      [
        makeCell({
          taskId: "task-x",
          taskInstanceId: "inst-x",
          score: 5,
          evaluator: JUDGE_A,
          configuration: EXACT_ALPHA,
        }),
      ],
      EXACT_ALPHA,
    );
    const b = makeSelection(
      [
        makeCell({
          taskId: "task-x",
          taskInstanceId: "inst-x",
          score: 2,
          evaluator: JUDGE_B,
          configuration: EXACT_BETA,
        }),
      ],
      EXACT_BETA,
    );

    const result = computePairedEvidence(pairedInput(a, b, { metric: "judged_score" }));

    expect(findDelta(result, "task-x").state).toBe("incompatible_cohort");
  });

  it("compares pass_rate only within a compatible verifier definition", () => {
    const a = makeSelection(
      [
        makeCell({
          taskId: "task-v",
          taskInstanceId: "inst-v",
          score: 5,
          verifierPassed: true,
          verifier: VERIFIER_A,
          configuration: EXACT_ALPHA,
        }),
      ],
      EXACT_ALPHA,
    );
    const b = makeSelection(
      [
        makeCell({
          taskId: "task-v",
          taskInstanceId: "inst-v",
          score: 1,
          verifierPassed: false,
          verifier: VERIFIER_A,
          configuration: EXACT_BETA,
        }),
      ],
      EXACT_BETA,
    );

    const result = computePairedEvidence(pairedInput(a, b, { metric: "pass_rate" }));

    const delta = findDelta(result, "task-v");
    expect(delta.state).toBe("comparable");
    expect(delta.valueA).toBe(1);
    expect(delta.valueB).toBe(0);
    expect(delta.delta).toBe(1);
    expect(delta.outcome).toBe("win");
  });

  it("marks pass_rate incompatible when verifier definitions differ", () => {
    const a = makeSelection(
      [
        makeCell({
          taskId: "task-v",
          taskInstanceId: "inst-v",
          verifierPassed: true,
          verifier: VERIFIER_A,
          configuration: EXACT_ALPHA,
        }),
      ],
      EXACT_ALPHA,
    );
    const b = makeSelection(
      [
        makeCell({
          taskId: "task-v",
          taskInstanceId: "inst-v",
          verifierPassed: false,
          verifier: VERIFIER_B,
          configuration: EXACT_BETA,
        }),
      ],
      EXACT_BETA,
    );

    const result = computePairedEvidence(pairedInput(a, b, { metric: "pass_rate" }));

    expect(findDelta(result, "task-v").state).toBe("incompatible_cohort");
  });

  it("treats verifier definitions as compatible when a mapping groups them", () => {
    const mappings: CompatibleVerifierDefinition[] = [
      {
        groupId: "verifier-family",
        verifierRef: VERIFIER_A.verifierRef,
        kind: VERIFIER_A.kind,
        configurationDigest: VERIFIER_A.configurationDigest,
      },
      {
        groupId: "verifier-family",
        verifierRef: VERIFIER_B.verifierRef,
        kind: VERIFIER_B.kind,
        configurationDigest: VERIFIER_B.configurationDigest,
      },
    ];
    const a = makeSelection(
      [
        makeCell({
          taskId: "task-v",
          taskInstanceId: "inst-v",
          verifierPassed: true,
          verifier: VERIFIER_A,
          configuration: EXACT_ALPHA,
        }),
      ],
      EXACT_ALPHA,
    );
    const b = makeSelection(
      [
        makeCell({
          taskId: "task-v",
          taskInstanceId: "inst-v",
          verifierPassed: false,
          verifier: VERIFIER_B,
          configuration: EXACT_BETA,
        }),
      ],
      EXACT_BETA,
    );

    const result = computePairedEvidence(
      pairedInput(a, b, { metric: "pass_rate", compatibleVerifierDefinitions: mappings }),
    );

    expect(findDelta(result, "task-v").state).toBe("comparable");
  });
});

describe("computePairedEvidence — wins / ties / losses and epsilon", () => {
  function buildBoth(scoreA: number, scoreB: number, taskId = "task-x"): PairedComparisonResult {
    const a = makeSelection(
      [makeCell({ taskId, taskInstanceId: "inst-x", score: scoreA, configuration: EXACT_ALPHA })],
      EXACT_ALPHA,
    );
    const b = makeSelection(
      [makeCell({ taskId, taskInstanceId: "inst-x", score: scoreB, configuration: EXACT_BETA })],
      EXACT_BETA,
    );
    return computePairedEvidence(pairedInput(a, b, { metric: "judged_score" }));
  }

  it("classifies a win when delta > epsilon", () => {
    const result = buildBoth(5, 2);
    expect(findDelta(result, "task-x").outcome).toBe("win");
    expect(result.coverage.wins).toBe(1);
  });

  it("classifies a loss when delta < -epsilon", () => {
    const result = buildBoth(1, 5);
    expect(findDelta(result, "task-x").outcome).toBe("loss");
    expect(result.coverage.losses).toBe(1);
  });

  it("classifies a tie when |delta| <= epsilon (default epsilon 0)", () => {
    const result = buildBoth(4, 4);
    expect(findDelta(result, "task-x").outcome).toBe("tie");
    expect(result.coverage.ties).toBe(1);
  });

  it("honors a custom epsilon: |delta| == epsilon is a tie", () => {
    const a = makeSelection(
      [
        makeCell({
          taskId: "task-x",
          taskInstanceId: "inst-x",
          score: 5,
          configuration: EXACT_ALPHA,
        }),
      ],
      EXACT_ALPHA,
    );
    const b = makeSelection(
      [
        makeCell({
          taskId: "task-x",
          taskInstanceId: "inst-x",
          score: 4,
          configuration: EXACT_BETA,
        }),
      ],
      EXACT_BETA,
    );
    const result = computePairedEvidence(pairedInput(a, b, { metric: "judged_score", epsilon: 1 }));
    expect(findDelta(result, "task-x").outcome).toBe("tie");
    expect(result.epsilon).toBe(1);
  });

  it("honors a custom epsilon: delta just above epsilon is a win", () => {
    const a = makeSelection(
      [
        makeCell({
          taskId: "task-x",
          taskInstanceId: "inst-x",
          score: 5.5,
          configuration: EXACT_ALPHA,
        }),
      ],
      EXACT_ALPHA,
    );
    const b = makeSelection(
      [
        makeCell({
          taskId: "task-x",
          taskInstanceId: "inst-x",
          score: 4,
          configuration: EXACT_BETA,
        }),
      ],
      EXACT_BETA,
    );
    const result = computePairedEvidence(pairedInput(a, b, { metric: "judged_score", epsilon: 1 }));
    expect(findDelta(result, "task-x").outcome).toBe("win");
  });

  it("aggregates wins/ties/losses across multiple shared tasks", () => {
    const a = makeSelection(
      [
        makeCell({ taskId: "t1", taskInstanceId: "i1", score: 5, configuration: EXACT_ALPHA }),
        makeCell({ taskId: "t2", taskInstanceId: "i2", score: 3, configuration: EXACT_ALPHA }),
        makeCell({ taskId: "t3", taskInstanceId: "i3", score: 1, configuration: EXACT_ALPHA }),
        makeCell({ taskId: "t4", taskInstanceId: "i4", score: 4, configuration: EXACT_ALPHA }),
      ],
      EXACT_ALPHA,
    );
    const b = makeSelection(
      [
        makeCell({ taskId: "t1", taskInstanceId: "i1", score: 2, configuration: EXACT_BETA }),
        makeCell({ taskId: "t2", taskInstanceId: "i2", score: 3, configuration: EXACT_BETA }),
        makeCell({ taskId: "t3", taskInstanceId: "i3", score: 4, configuration: EXACT_BETA }),
        makeCell({ taskId: "t4", taskInstanceId: "i4", score: 4, configuration: EXACT_BETA }),
      ],
      EXACT_BETA,
    );
    const result = computePairedEvidence(pairedInput(a, b, { metric: "judged_score" }));
    expect(result.coverage.wins).toBe(1); // t1: +3
    expect(result.coverage.ties).toBe(2); // t2, t4
    expect(result.coverage.losses).toBe(1); // t3: -3
    expect(result.coverage.comparableTaskCount).toBe(4);
  });
});

describe("computePairedEvidence — paired Task-level deltas", () => {
  it("computes valueA and valueB with hierarchical equal weighting within a task", () => {
    // A: two instances of the same version -> instance means (5, 3) -> version mean 4.
    // B: one instance -> 2.
    const a = makeSelection(
      [
        makeCell({
          taskId: "task-h",
          taskVersion: 1,
          taskInstanceId: "i-a",
          score: 5,
          configuration: EXACT_ALPHA,
        }),
        makeCell({
          taskId: "task-h",
          taskVersion: 1,
          taskInstanceId: "i-b",
          score: 3,
          configuration: EXACT_ALPHA,
        }),
      ],
      EXACT_ALPHA,
    );
    const b = makeSelection(
      [
        makeCell({
          taskId: "task-h",
          taskVersion: 1,
          taskInstanceId: "i-a",
          score: 2,
          configuration: EXACT_BETA,
        }),
      ],
      EXACT_BETA,
    );
    const result = computePairedEvidence(pairedInput(a, b, { metric: "judged_score" }));
    const delta = findDelta(result, "task-h");
    expect(delta.valueA).toBeCloseTo(4, 10);
    expect(delta.valueB).toBeCloseTo(2, 10);
    expect(delta.delta).toBeCloseTo(2, 10);
    expect(delta.outcome).toBe("win");
  });

  it("rolls up multiple versions with equal weight for the task-level metric", () => {
    // A: v1 score 2, v2 score 6 -> version means 2 and 6 -> task mean 4.
    const a = makeSelection(
      [
        makeCell({
          taskId: "task-h",
          taskVersion: 1,
          taskInstanceId: "i-a",
          score: 2,
          configuration: EXACT_ALPHA,
        }),
        makeCell({
          taskId: "task-h",
          taskVersion: 2,
          taskInstanceId: "i-b",
          score: 6,
          configuration: EXACT_ALPHA,
        }),
      ],
      EXACT_ALPHA,
    );
    const b = makeSelection(
      [
        makeCell({
          taskId: "task-h",
          taskVersion: 1,
          taskInstanceId: "i-a",
          score: 4,
          configuration: EXACT_BETA,
        }),
      ],
      EXACT_BETA,
    );
    const result = computePairedEvidence(pairedInput(a, b, { metric: "judged_score" }));
    const delta = findDelta(result, "task-h");
    expect(delta.valueA).toBeCloseTo(4, 10);
    expect(delta.valueB).toBeCloseTo(4, 10);
    expect(delta.delta).toBeCloseTo(0, 10);
    expect(delta.versionsA).toEqual([1, 2]);
    expect(delta.versionsB).toEqual([1]);
  });

  it("computes meanDelta over comparable tasks only", () => {
    const a = makeSelection(
      [
        makeCell({ taskId: "t1", taskInstanceId: "i1", score: 5, configuration: EXACT_ALPHA }),
        makeCell({ taskId: "t2", taskInstanceId: "i2", score: 3, configuration: EXACT_ALPHA }),
      ],
      EXACT_ALPHA,
    );
    const b = makeSelection(
      [
        makeCell({ taskId: "t1", taskInstanceId: "i1", score: 1, configuration: EXACT_BETA }),
        makeCell({ taskId: "t2", taskInstanceId: "i2", score: 3, configuration: EXACT_BETA }),
      ],
      EXACT_BETA,
    );
    const result = computePairedEvidence(pairedInput(a, b, { metric: "judged_score" }));
    // deltas: +4, 0 -> mean 2
    expect(result.meanDelta).toBeCloseTo(2, 10);
  });
});

describe("computePairedEvidence — missing cells handled and disclosed", () => {
  it("discloses instance asymmetry within a shared task", () => {
    // A has instances {a, b}; B has only {a}. b is missing in B.
    const a = makeSelection(
      [
        makeCell({
          taskId: "task-m",
          taskVersion: 1,
          taskInstanceId: "i-a",
          score: 5,
          configuration: EXACT_ALPHA,
        }),
        makeCell({
          taskId: "task-m",
          taskVersion: 1,
          taskInstanceId: "i-b",
          score: 3,
          configuration: EXACT_ALPHA,
        }),
      ],
      EXACT_ALPHA,
    );
    const b = makeSelection(
      [
        makeCell({
          taskId: "task-m",
          taskVersion: 1,
          taskInstanceId: "i-a",
          score: 2,
          configuration: EXACT_BETA,
        }),
      ],
      EXACT_BETA,
    );
    const result = computePairedEvidence(pairedInput(a, b, { metric: "judged_score" }));
    const delta = findDelta(result, "task-m");
    expect(delta.state).toBe("comparable");
    expect(delta.missingInstancesB).toContain("i-b");
    expect(delta.missingInstancesA).toEqual([]);
    expect(delta.disclosure).toBeTruthy();
    expect(result.disclosures.some((d) => d.toLowerCase().includes("missing"))).toBe(true);
  });

  it("counts missing-in-A and missing-in-B tasks in coverage", () => {
    const a = makeSelection(
      [
        makeCell({ taskId: "shared", taskInstanceId: "i-s", score: 5, configuration: EXACT_ALPHA }),
        makeCell({ taskId: "only-a", taskInstanceId: "i-a", score: 3, configuration: EXACT_ALPHA }),
      ],
      EXACT_ALPHA,
    );
    const b = makeSelection(
      [
        makeCell({ taskId: "shared", taskInstanceId: "i-s", score: 2, configuration: EXACT_BETA }),
        makeCell({ taskId: "only-b", taskInstanceId: "i-b", score: 1, configuration: EXACT_BETA }),
      ],
      EXACT_BETA,
    );
    const result = computePairedEvidence(pairedInput(a, b, { metric: "judged_score" }));
    expect(result.coverage.missingInB).toBe(1);
    expect(result.coverage.missingInA).toBe(1);
    expect(result.coverage.sharedTaskCount).toBe(1);
  });
});

describe("computePairedEvidence — changed task versions", () => {
  it("treats same task identity across versions as shared and discloses the version mismatch", () => {
    // A has task-transform v1, B has task-transform v2. Same task identity.
    const a = makeSelection(
      [
        makeCell({
          taskId: "task-c",
          taskVersion: 1,
          taskInstanceId: "i-a",
          score: 5,
          configuration: EXACT_ALPHA,
        }),
      ],
      EXACT_ALPHA,
    );
    const b = makeSelection(
      [
        makeCell({
          taskId: "task-c",
          taskVersion: 2,
          taskInstanceId: "i-b",
          score: 2,
          configuration: EXACT_BETA,
        }),
      ],
      EXACT_BETA,
    );
    const result = computePairedEvidence(pairedInput(a, b, { metric: "judged_score" }));
    const delta = findDelta(result, "task-c");
    expect(delta.state).toBe("comparable");
    expect(delta.changedTaskVersion).toBe(true);
    expect(delta.versionsA).toEqual([1]);
    expect(delta.versionsB).toEqual([2]);
    expect(delta.disclosure).toBeTruthy();
    expect(result.disclosures.some((d) => d.toLowerCase().includes("version"))).toBe(true);
  });

  it("does not flag changedTaskVersion when version sets match", () => {
    const a = makeSelection(
      [
        makeCell({
          taskId: "task-c",
          taskVersion: 1,
          taskInstanceId: "i-a",
          score: 5,
          configuration: EXACT_ALPHA,
        }),
      ],
      EXACT_ALPHA,
    );
    const b = makeSelection(
      [
        makeCell({
          taskId: "task-c",
          taskVersion: 1,
          taskInstanceId: "i-a",
          score: 2,
          configuration: EXACT_BETA,
        }),
      ],
      EXACT_BETA,
    );
    const result = computePairedEvidence(pairedInput(a, b, { metric: "judged_score" }));
    expect(findDelta(result, "task-c").changedTaskVersion).toBe(false);
  });
});

describe("computePairedEvidence — dependency-aware bootstrap assignment", () => {
  it("groups known-related tasks (same family) into one resampling unit, not independent", () => {
    // Two shared tasks in the same family -> one task_family_relation unit.
    const assignments = [
      {
        id: "asg-1",
        taskId: "t-rel-a",
        taskVersion: 1,
        familyId: "fam-rel",
        isPrimary: true,
        createdAt: T0,
        revision: 1,
        archivedAt: null,
      },
      {
        id: "asg-2",
        taskId: "t-rel-b",
        taskVersion: 1,
        familyId: "fam-rel",
        isPrimary: true,
        createdAt: T0,
        revision: 1,
        archivedAt: null,
      },
    ];
    const a = makeSelection(
      [
        makeCell({
          taskId: "t-rel-a",
          taskInstanceId: "i-a",
          score: 5,
          configuration: EXACT_ALPHA,
        }),
        makeCell({
          taskId: "t-rel-b",
          taskInstanceId: "i-b",
          score: 5,
          configuration: EXACT_ALPHA,
        }),
      ],
      EXACT_ALPHA,
    );
    const b = makeSelection(
      [
        makeCell({ taskId: "t-rel-a", taskInstanceId: "i-a", score: 1, configuration: EXACT_BETA }),
        makeCell({ taskId: "t-rel-b", taskInstanceId: "i-b", score: 1, configuration: EXACT_BETA }),
      ],
      EXACT_BETA,
    );
    const result = computePairedEvidence(
      pairedInput(
        a,
        b,
        { metric: "judged_score" },
        {
          taskFamilyAssignments: assignments,
        },
      ),
    );
    expect(result.uncertaintyResolution).not.toBeNull();
    const res = result.uncertaintyResolution!;
    // Both tasks in one family -> one unit (not two independent).
    expect(res.unitCount).toBe(1);
    expect(res.units.every((u) => u.kind === "task_family_relation")).toBe(true);
    expect(res.units[0]!.taskIds).toEqual(["t-rel-a", "t-rel-b"]);
    // One unit < 5 -> insufficient bootstrap coverage.
    expect(result.bootstrap).not.toBeNull();
    expect(result.bootstrap!.coverageState.state).toBe("insufficient");
  });

  it("groups tasks linked by a declared family relation into one unit", () => {
    const assignments = [
      {
        id: "asg-1",
        taskId: "t-fam1",
        taskVersion: 1,
        familyId: "fam-one",
        isPrimary: true,
        createdAt: T0,
        revision: 1,
        archivedAt: null,
      },
      {
        id: "asg-2",
        taskId: "t-fam2",
        taskVersion: 1,
        familyId: "fam-two",
        isPrimary: true,
        createdAt: T0,
        revision: 1,
        archivedAt: null,
      },
    ];
    const relations: TaskFamilyRelation[] = [
      {
        id: "rel-1-2",
        fromFamilyId: "fam-one",
        toFamilyId: "fam-two",
        kind: "overlap",
        createdAt: T0,
      },
    ];
    const a = makeSelection(
      [
        makeCell({ taskId: "t-fam1", taskInstanceId: "i-a", score: 5, configuration: EXACT_ALPHA }),
        makeCell({ taskId: "t-fam2", taskInstanceId: "i-b", score: 5, configuration: EXACT_ALPHA }),
      ],
      EXACT_ALPHA,
    );
    const b = makeSelection(
      [
        makeCell({ taskId: "t-fam1", taskInstanceId: "i-a", score: 1, configuration: EXACT_BETA }),
        makeCell({ taskId: "t-fam2", taskInstanceId: "i-b", score: 1, configuration: EXACT_BETA }),
      ],
      EXACT_BETA,
    );
    const result = computePairedEvidence(
      pairedInput(
        a,
        b,
        { metric: "judged_score" },
        {
          taskFamilyAssignments: assignments,
          taskFamilyRelations: relations,
        },
      ),
    );
    expect(result.uncertaintyResolution!.unitCount).toBe(1);
  });

  it("uses task_identity fallback when no higher-order dependency metadata exists", () => {
    const a = makeSelection(
      [
        makeCell({ taskId: "t1", taskInstanceId: "i1", score: 5, configuration: EXACT_ALPHA }),
        makeCell({ taskId: "t2", taskInstanceId: "i2", score: 5, configuration: EXACT_ALPHA }),
      ],
      EXACT_ALPHA,
    );
    const b = makeSelection(
      [
        makeCell({ taskId: "t1", taskInstanceId: "i1", score: 1, configuration: EXACT_BETA }),
        makeCell({ taskId: "t2", taskInstanceId: "i2", score: 1, configuration: EXACT_BETA }),
      ],
      EXACT_BETA,
    );
    const result = computePairedEvidence(pairedInput(a, b, { metric: "judged_score" }));
    const res = result.uncertaintyResolution!;
    expect(res.units.every((u) => u.kind === "task_identity")).toBe(true);
    expect(res.unitCount).toBe(2);
    expect(res.fallbackAssumption).toBeTruthy();
  });

  it("bootstraps paired deltas with sufficient coverage for >=5 independent units", () => {
    // Five shared tasks, each in its own family -> five task_identity units.
    const assignments = [1, 2, 3, 4, 5].map((n) => ({
      id: `asg-${n}`,
      taskId: `t-${n}`,
      taskVersion: 1,
      familyId: `fam-${n}`,
      isPrimary: true,
      createdAt: T0,
      revision: 1,
      archivedAt: null,
    }));
    const a = makeSelection(
      [1, 2, 3, 4, 5].map((n) =>
        makeCell({
          taskId: `t-${n}`,
          taskInstanceId: `i-${n}`,
          score: 5,
          configuration: EXACT_ALPHA,
        }),
      ),
      EXACT_ALPHA,
    );
    const b = makeSelection(
      [1, 2, 3, 4, 5].map((n) =>
        makeCell({
          taskId: `t-${n}`,
          taskInstanceId: `i-${n}`,
          score: 1,
          configuration: EXACT_BETA,
        }),
      ),
      EXACT_BETA,
    );
    const result = computePairedEvidence(
      pairedInput(
        a,
        b,
        { metric: "judged_score" },
        {
          taskFamilyAssignments: assignments,
          resamples: 500,
        },
      ),
    );
    expect(result.uncertaintyResolution!.unitCount).toBe(5);
    expect(result.bootstrap).not.toBeNull();
    expect(result.bootstrap!.coverageState.state).toBe("sufficient");
    expect(result.bootstrap!.interval).not.toBeNull();
    // All deltas are +4 -> mean 4, interval should contain 4.
    expect(result.bootstrap!.interval!.lower).toBeLessThanOrEqual(4);
    expect(result.bootstrap!.interval!.upper).toBeGreaterThanOrEqual(4);
  });

  it("reports insufficient coverage and no interval below five units", () => {
    const a = makeSelection(
      [1, 2].map((n) =>
        makeCell({
          taskId: `t-${n}`,
          taskInstanceId: `i-${n}`,
          score: 5,
          configuration: EXACT_ALPHA,
        }),
      ),
      EXACT_ALPHA,
    );
    const b = makeSelection(
      [1, 2].map((n) =>
        makeCell({
          taskId: `t-${n}`,
          taskInstanceId: `i-${n}`,
          score: 1,
          configuration: EXACT_BETA,
        }),
      ),
      EXACT_BETA,
    );
    const result = computePairedEvidence(pairedInput(a, b, { metric: "judged_score" }));
    expect(result.bootstrap).not.toBeNull();
    expect(result.bootstrap!.coverageState.state).toBe("insufficient");
    expect(result.bootstrap!.interval).toBeNull();
    expect(result.disclosures.some((d) => d.toLowerCase().includes("insufficient"))).toBe(true);
  });

  it("skips bootstrap entirely when there are no comparable tasks", () => {
    // Shared task but incompatible cohort -> no comparable delta -> no bootstrap.
    const a = makeSelection(
      [
        makeCell({
          taskId: "t-x",
          taskInstanceId: "i-x",
          score: 5,
          rubric: RUBRIC_QUALITY,
          configuration: EXACT_ALPHA,
        }),
      ],
      EXACT_ALPHA,
    );
    const b = makeSelection(
      [
        makeCell({
          taskId: "t-x",
          taskInstanceId: "i-x",
          score: 2,
          rubric: RUBRIC_STYLE,
          configuration: EXACT_BETA,
        }),
      ],
      EXACT_BETA,
    );
    const result = computePairedEvidence(pairedInput(a, b, { metric: "judged_score" }));
    expect(result.bootstrap).toBeNull();
    expect(result.uncertaintyResolution).toBeNull();
    expect(result.meanDelta).toBeNull();
  });

  it("pins rule versions and assignment digest in the bootstrap receipt", () => {
    const assignments = [1, 2, 3, 4, 5].map((n) => ({
      id: `asg-${n}`,
      taskId: `t-${n}`,
      taskVersion: 1,
      familyId: `fam-${n}`,
      isPrimary: true,
      createdAt: T0,
      revision: 1,
      archivedAt: null,
    }));
    const a = makeSelection(
      [1, 2, 3, 4, 5].map((n) =>
        makeCell({
          taskId: `t-${n}`,
          taskInstanceId: `i-${n}`,
          score: 5,
          configuration: EXACT_ALPHA,
        }),
      ),
      EXACT_ALPHA,
    );
    const b = makeSelection(
      [1, 2, 3, 4, 5].map((n) =>
        makeCell({
          taskId: `t-${n}`,
          taskInstanceId: `i-${n}`,
          score: 1,
          configuration: EXACT_BETA,
        }),
      ),
      EXACT_BETA,
    );
    const result = computePairedEvidence(
      pairedInput(
        a,
        b,
        { metric: "judged_score" },
        {
          taskFamilyAssignments: assignments,
          resamples: 500,
        },
      ),
    );
    expect(result.bootstrap!.aggregationRuleVersion).toBe(QUERY_AGGREGATION_RULE_VERSION);
    expect(result.bootstrap!.uncertaintyRuleVersion).toBe(QUERY_UNCERTAINTY_RULE_VERSION);
    expect(result.bootstrap!.assignmentDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.bootstrap!.seed).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe("computePairedEvidence — determinism, purity, permutations", () => {
  it("produces identical output for identical input", () => {
    const a = makeSelection(
      [
        makeCell({ taskId: "t1", taskInstanceId: "i1", score: 5, configuration: EXACT_ALPHA }),
        makeCell({ taskId: "t2", taskInstanceId: "i2", score: 3, configuration: EXACT_ALPHA }),
      ],
      EXACT_ALPHA,
    );
    const b = makeSelection(
      [
        makeCell({ taskId: "t1", taskInstanceId: "i1", score: 2, configuration: EXACT_BETA }),
        makeCell({ taskId: "t2", taskInstanceId: "i2", score: 3, configuration: EXACT_BETA }),
      ],
      EXACT_BETA,
    );
    const r1 = computePairedEvidence(pairedInput(a, b, { metric: "judged_score" }));
    const r2 = computePairedEvidence(pairedInput(a, b, { metric: "judged_score" }));
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it("is permutation-invariant over cell ordering", () => {
    const aCells = [
      makeCell({ taskId: "t1", taskInstanceId: "i1", score: 5, configuration: EXACT_ALPHA }),
      makeCell({ taskId: "t2", taskInstanceId: "i2", score: 3, configuration: EXACT_ALPHA }),
      makeCell({ taskId: "t3", taskInstanceId: "i3", score: 1, configuration: EXACT_ALPHA }),
    ];
    const bCells = [
      makeCell({ taskId: "t1", taskInstanceId: "i1", score: 2, configuration: EXACT_BETA }),
      makeCell({ taskId: "t2", taskInstanceId: "i2", score: 3, configuration: EXACT_BETA }),
      makeCell({ taskId: "t3", taskInstanceId: "i3", score: 4, configuration: EXACT_BETA }),
    ];
    const base = computePairedEvidence(
      pairedInput(makeSelection(aCells, EXACT_ALPHA), makeSelection(bCells, EXACT_BETA), {
        metric: "judged_score",
      }),
    );
    const shuffled = computePairedEvidence(
      pairedInput(
        makeSelection(permute(aCells, 7), EXACT_ALPHA),
        makeSelection(permute(bCells, 11), EXACT_BETA),
        { metric: "judged_score" },
      ),
    );
    expect(JSON.stringify(base)).toBe(JSON.stringify(shuffled));
  });

  it("never mutates the input selections", () => {
    const a = makeSelection(
      [makeCell({ taskId: "t1", taskInstanceId: "i1", score: 5, configuration: EXACT_ALPHA })],
      EXACT_ALPHA,
    );
    const b = makeSelection(
      [makeCell({ taskId: "t1", taskInstanceId: "i1", score: 2, configuration: EXACT_BETA })],
      EXACT_BETA,
    );
    const aSnap = JSON.stringify(a);
    const bSnap = JSON.stringify(b);
    computePairedEvidence(pairedInput(a, b, { metric: "judged_score" }));
    expect(JSON.stringify(a)).toBe(aSnap);
    expect(JSON.stringify(b)).toBe(bSnap);
  });

  it("deterministically orders task deltas by taskId", () => {
    const a = makeSelection(
      [
        makeCell({ taskId: "t3", taskInstanceId: "i3", score: 5, configuration: EXACT_ALPHA }),
        makeCell({ taskId: "t1", taskInstanceId: "i1", score: 5, configuration: EXACT_ALPHA }),
        makeCell({ taskId: "t2", taskInstanceId: "i2", score: 5, configuration: EXACT_ALPHA }),
      ],
      EXACT_ALPHA,
    );
    const b = makeSelection(
      [
        makeCell({ taskId: "t3", taskInstanceId: "i3", score: 1, configuration: EXACT_BETA }),
        makeCell({ taskId: "t1", taskInstanceId: "i1", score: 1, configuration: EXACT_BETA }),
        makeCell({ taskId: "t2", taskInstanceId: "i2", score: 1, configuration: EXACT_BETA }),
      ],
      EXACT_BETA,
    );
    const result = computePairedEvidence(pairedInput(a, b, { metric: "judged_score" }));
    const ids = result.taskDeltas.map((d) => d.taskId);
    expect(ids).toEqual([...ids].sort());
  });
});

describe("computePairedEvidence — milestone A golden selection", () => {
  function goldenCorpus(): ProfileEvidenceCorpus {
    return {
      configurations: Object.values(MILESTONE_A_GOLDEN.configurations),
      observations: milestoneAObservations(),
      decisions: milestoneADecisions(),
      ledgerRows: milestoneALedgerRows(),
      facets: MILESTONE_A_GOLDEN.facets,
      missingCells: MILESTONE_A_GOLDEN.missingCells,
    };
  }

  function goldenSelection(cfgId: string): ProfileExactSelection {
    const query: ModelEvidenceQuery = {
      respondent: { kind: "model_configuration", modelConfigurationId: cfgId },
      observedFrom: null,
      observedTo: null,
      taskFamilyIds: [],
      facetFilters: [],
      evidenceClasses: [],
      allowedUses: ["within_model_profile", "paired_model_comparison"],
      comparabilityCohortIds: [],
      sourceKinds: [],
      rubricRefs: [],
      evaluatorFilters: [],
      includeUnknownVersion: false,
      eligibilityRuleVersion: QUERY_ELIGIBILITY_RULE_VERSION,
      aggregationRuleVersion: QUERY_AGGREGATION_RULE_VERSION,
      uncertaintyRuleVersion: QUERY_UNCERTAINTY_RULE_VERSION,
    };
    const result = selectProfileObservations(query, goldenCorpus());
    expect(result.kind).toBe("exact");
    if (result.kind !== "exact") throw new Error("expected exact selection");
    return result;
  }

  it("compares exact-alpha vs exact-beta on shared paired tasks only", () => {
    const a = goldenSelection(EXACT_ALPHA.id);
    const b = goldenSelection(EXACT_BETA.id);
    const result = computePairedEvidence(
      pairedInput(
        a,
        b,
        {
          metric: "judged_score",
          commensurateRubricMappings: MILESTONE_A_GOLDEN.familyAssignments ? [] : [],
        },
        {
          taskFamilyAssignments: MILESTONE_A_GOLDEN.familyAssignments,
        },
      ),
    );

    expect(result.empty).toBe(false);
    expect(result.configurationAId).toBe(EXACT_ALPHA.id);
    expect(result.configurationBId).toBe(EXACT_BETA.id);
    // Shared paired tasks: task-transform and task-verify (both have
    // paired_model_comparison on both sides).
    expect(result.coverage.sharedTaskCount).toBeGreaterThanOrEqual(2);
    expect(result.coverage.comparableTaskCount).toBeGreaterThanOrEqual(2);
    const transform = findDelta(result, "task-transform");
    expect(transform.state).toBe("comparable");
    // Alpha has versions {1,2}; beta has {1} -> changed task version.
    expect(transform.changedTaskVersion).toBe(true);
    // Alpha has instances {a, b, v2}; beta has {a} -> missing in B.
    expect(transform.missingInstancesB.length).toBeGreaterThan(0);
    const verify = findDelta(result, "task-verify");
    expect(verify.state).toBe("comparable");
    // Both shared tasks are in family-transform -> one dependency-aware unit
    // -> insufficient bootstrap coverage (known-related, not independent).
    expect(result.uncertaintyResolution!.unitCount).toBe(1);
    expect(result.bootstrap!.coverageState.state).toBe("insufficient");
  });

  it("discloses the dependency-aware fallback assumption for the golden corpus", () => {
    const a = goldenSelection(EXACT_ALPHA.id);
    const b = goldenSelection(EXACT_BETA.id);
    const result = computePairedEvidence(
      pairedInput(
        a,
        b,
        { metric: "judged_score" },
        {
          taskFamilyAssignments: MILESTONE_A_GOLDEN.familyAssignments,
        },
      ),
    );
    expect(result.uncertaintyResolution!.disclosures.length).toBeGreaterThan(0);
  });

  it("returns empty state for two configurations with no shared paired tasks", () => {
    // exact-alpha-tools shares no paired tasks with exact-beta in this corpus
    // slice (alpha-tools only has task-transform; beta has transform+verify).
    // Use alpha-tools vs a synthetic beta selection that lacks transform.
    const tools = goldenSelection(CFG.exactAlphaTools.id);
    const beta = goldenSelection(EXACT_BETA.id);
    // alpha-tools has only task-transform; beta has task-transform + task-verify.
    // Shared = task-transform. Confirm it is NOT empty (sanity), then build a
    // truly disjoint pair to assert the empty path.
    const disjointB = makeSelection(
      [
        makeCell({
          taskId: "task-z",
          taskInstanceId: "inst-z",
          score: 1,
          configuration: EXACT_BETA,
        }),
      ],
      EXACT_BETA,
    );
    const result = computePairedEvidence(pairedInput(tools, disjointB, { metric: "judged_score" }));
    expect(result.empty).toBe(true);
    // Sanity: tools vs beta is not empty (task-transform shared).
    const nonEmpty = computePairedEvidence(pairedInput(tools, beta, { metric: "judged_score" }));
    expect(nonEmpty.empty).toBe(false);
  });
});

describe("computePairedEvidence — rule version and shape", () => {
  it("exposes the paired comparison rule version", () => {
    expect(PAIRED_COMPARISON_RULE_VERSION).toBe(QUERY_AGGREGATION_RULE_VERSION);
  });

  it("produces a result with the configured metric and epsilon", () => {
    const a = makeSelection(
      [makeCell({ taskId: "t1", taskInstanceId: "i1", score: 5, configuration: EXACT_ALPHA })],
      EXACT_ALPHA,
    );
    const b = makeSelection(
      [makeCell({ taskId: "t1", taskInstanceId: "i1", score: 2, configuration: EXACT_BETA })],
      EXACT_BETA,
    );
    const result = computePairedEvidence(
      pairedInput(a, b, { metric: "judged_score", epsilon: 0.5 }),
    );
    expect(result.metric).toBe("judged_score");
    expect(result.epsilon).toBe(0.5);
    expect(result.ruleVersion).toBe(PAIRED_COMPARISON_RULE_VERSION);
  });

  it("type-narrows PairedTaskState and PairedOutcome", () => {
    const a = makeSelection(
      [makeCell({ taskId: "t1", taskInstanceId: "i1", score: 5, configuration: EXACT_ALPHA })],
      EXACT_ALPHA,
    );
    const b = makeSelection(
      [makeCell({ taskId: "t1", taskInstanceId: "i1", score: 2, configuration: EXACT_BETA })],
      EXACT_BETA,
    );
    const result = computePairedEvidence(pairedInput(a, b, { metric: "judged_score" }));
    const delta = findDelta(result, "t1");
    const state: PairedTaskState = delta.state;
    const outcome: PairedOutcome = delta.outcome!;
    expect(state).toBe("comparable");
    expect(outcome).toBe("win");
    const metric: PairedMetricKind = result.metric;
    expect(metric).toBe("judged_score");
  });
});
// ---------------------------------------------------------------------------
// R4: paired cohort isolation — never combine >1 compatible cohort in a Task
// ---------------------------------------------------------------------------

describe("computePairedEvidence — cohort isolation (R4)", () => {
  function findDeltasByTask(result: PairedComparisonResult, taskId: string): PairedTaskDelta[] {
    return result.taskDeltas.filter((d) => d.taskId === taskId);
  }

  it("(a) never combines multiple compatible cohorts on the same Task into one scalar", () => {
    // task-x is observed under TWO compatible cohorts (distinct rubrics, same
    // protocol + evaluator) on BOTH configurations. Each cohort is individually
    // compatible, but they must NOT be pooled into one paired delta / mean.
    const a = makeSelection(
      [
        makeCell({
          taskId: "task-x",
          taskInstanceId: "i-a-q",
          score: 5,
          rubric: RUBRIC_QUALITY,
          protocol: PROTOCOL_A,
          evaluator: JUDGE_A,
          configuration: EXACT_ALPHA,
        }),
        makeCell({
          taskId: "task-x",
          taskInstanceId: "i-a-s",
          score: 1,
          rubric: RUBRIC_STYLE,
          protocol: PROTOCOL_A,
          evaluator: JUDGE_A,
          configuration: EXACT_ALPHA,
        }),
      ],
      EXACT_ALPHA,
    );
    const b = makeSelection(
      [
        makeCell({
          taskId: "task-x",
          taskInstanceId: "i-b-q",
          score: 2,
          rubric: RUBRIC_QUALITY,
          protocol: PROTOCOL_A,
          evaluator: JUDGE_A,
          configuration: EXACT_BETA,
        }),
        makeCell({
          taskId: "task-x",
          taskInstanceId: "i-b-s",
          score: 0,
          rubric: RUBRIC_STYLE,
          protocol: PROTOCOL_A,
          evaluator: JUDGE_A,
          configuration: EXACT_BETA,
        }),
      ],
      EXACT_BETA,
    );

    const result = computePairedEvidence(pairedInput(a, b, { metric: "judged_score" }));

    const comparable = findDeltasByTask(result, "task-x").filter((d) => d.state === "comparable");
    // Two cohorts => two stratified comparable deltas, NOT one pooled scalar.
    expect(comparable.length).toBe(2);
    expect(new Set(comparable.map((d) => d.cohortId)).size).toBe(2);
    // No delta mixes the two cohorts (pooled mean would be (3 - 1) = 2).
    for (const d of comparable) {
      expect(d.delta).not.toBe(2);
    }
    // The two cohort-stratified results are reported separately.
    expect(result.cohortResults.length).toBe(2);
    expect(new Set(result.cohortResults.map((c) => c.cohortId)).size).toBe(2);
    // No cross-cohort synthetic scalar at the top level.
    expect(result.meanDelta).toBeNull();
    expect(result.bootstrap).toBeNull();
  });

  it("(b) never combines Task deltas from different compatible cohorts into one mean/W-T-L", () => {
    // task-1 is assessed under rubric QUALITY on both sides; task-2 under
    // rubric STYLE on both sides. Each task is individually compatible, but
    // the two tasks belong to DIFFERENT cohorts. Their deltas must not be
    // combined into one top-level mean / bootstrap / W-T-L.
    const a = makeSelection(
      [
        makeCell({
          taskId: "task-1",
          taskInstanceId: "i-1",
          score: 5,
          rubric: RUBRIC_QUALITY,
          protocol: PROTOCOL_A,
          evaluator: JUDGE_A,
          configuration: EXACT_ALPHA,
        }),
        makeCell({
          taskId: "task-2",
          taskInstanceId: "i-2",
          score: 1,
          rubric: RUBRIC_STYLE,
          protocol: PROTOCOL_A,
          evaluator: JUDGE_A,
          configuration: EXACT_ALPHA,
        }),
      ],
      EXACT_ALPHA,
    );
    const b = makeSelection(
      [
        makeCell({
          taskId: "task-1",
          taskInstanceId: "i-1",
          score: 2,
          rubric: RUBRIC_QUALITY,
          protocol: PROTOCOL_A,
          evaluator: JUDGE_A,
          configuration: EXACT_BETA,
        }),
        makeCell({
          taskId: "task-2",
          taskInstanceId: "i-2",
          score: 0,
          rubric: RUBRIC_STYLE,
          protocol: PROTOCOL_A,
          evaluator: JUDGE_A,
          configuration: EXACT_BETA,
        }),
      ],
      EXACT_BETA,
    );

    const result = computePairedEvidence(pairedInput(a, b, { metric: "judged_score" }));

    // Two distinct cohort-stratified results (one per cohort).
    expect(result.cohortResults.length).toBe(2);
    // No cross-cohort top-level mean / bootstrap.
    expect(result.meanDelta).toBeNull();
    expect(result.bootstrap).toBeNull();
    // Each cohort result carries its own mean delta (3 and 1), not a pooled 2.
    const means = result.cohortResults.map((c) => c.meanDelta).sort();
    expect(means).toEqual([1, 3]);
  });

  it("still reports a single top-level scalar when only one cohort is involved", () => {
    // Single cohort: existing behavior preserved — top-level mean/bootstrap/W-T-L.
    const a = makeSelection(
      [
        makeCell({ taskId: "t1", taskInstanceId: "i1", score: 5, configuration: EXACT_ALPHA }),
        makeCell({ taskId: "t2", taskInstanceId: "i2", score: 3, configuration: EXACT_ALPHA }),
      ],
      EXACT_ALPHA,
    );
    const b = makeSelection(
      [
        makeCell({ taskId: "t1", taskInstanceId: "i1", score: 1, configuration: EXACT_BETA }),
        makeCell({ taskId: "t2", taskInstanceId: "i2", score: 3, configuration: EXACT_BETA }),
      ],
      EXACT_BETA,
    );
    const result = computePairedEvidence(pairedInput(a, b, { metric: "judged_score" }));
    expect(result.cohortResults.length).toBe(1);
    expect(result.meanDelta).toBeCloseTo(2, 10);
    expect(result.bootstrap).not.toBeNull();
    expect(result.coverage.wins).toBe(1);
    expect(result.coverage.ties).toBe(1);
  });
});
