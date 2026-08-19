// =============================================================================
// RSemble AI — Milestone A golden corpus (Child 07 Task 0)
//
// Reviewed fixtures for query / identity / coverage. FIXTURES ONLY — this
// module does not implement model-profile queries, catalogs, or selection.
//
// Live types this corpus represents (inspect the cited modules, not memory):
//   ModelConfigurationSnapshot, Observation, AssessmentRef, EvaluatorSnapshot,
//     VerifierSnapshot, EligibilityDecision, EvidenceUse, EvidenceClass
//     — src/lib/evidence/evidence-types.ts
//   classifyEligibility / EligibilityInput / EVIDENCE_RULE_VERSION
//     — src/lib/evidence/evidence-eligibility.ts
//   ComparabilityCohortInput / buildComparabilityCohort
//     — src/lib/evidence/comparability-cohort.ts
//   EvidenceLedgerRow (declared replicates, retries, attempt ids)
//     — src/lib/evidence/evidence-counting.ts
//   ObservationSourceGap (missing cells are gaps, never invented Observations)
//     — src/lib/evidence/observation-source.ts
//   TaskRecord / TaskVersion / TaskInstance / TaskFamily /
//     TaskFamilyAssignment / TaskFacetAnnotation / VersionRef
//     — src/lib/tasks/task-types.ts
//
// Child 04 already persists Observations + EligibilityDecisions + exact
// ModelConfigurationSnapshots. Declared-replicate / attempt-count / missing-
// cell facts live on the counting ledger and source-selection gaps, not as
// extra Observation fields. The corpus therefore carries those companion
// records so T1–T3 can implement Child 07 §5.1 / §6.1 without inventing
// storage.
//
// No secrets. No real provider keys. No paid provider calls.
// =============================================================================

import { buildComparabilityCohort } from "../../evidence/comparability-cohort";
import {
  EVIDENCE_RULE_VERSION,
  classifyEligibility,
  type ConfigurationState,
  type EligibilityInput,
  type VerifierState,
} from "../../evidence/evidence-eligibility";
import { canonicalizeModelConfiguration } from "../../evidence/model-configuration";
import type { EvidenceLedgerRow } from "../../evidence/evidence-counting";
import type { ObservationSourceGap } from "../../evidence/observation-source";
import type {
  AssessmentRef,
  EligibilityDecision,
  EvaluatorSnapshot,
  ModelConfigurationSnapshot,
  Observation,
  ObservationOutcome,
  VerifierSnapshot,
} from "../../evidence/evidence-types";
import { OBSERVATION_SCHEMA_VERSION } from "../../evidence/evidence-types";
import { observationIdFor } from "../../evidence/evidence-validation";
import type {
  TaskFacetAnnotation,
  TaskFamily,
  TaskFamilyAssignment,
  TaskInstance,
  TaskRecord,
  TaskVersion,
  VersionRef,
} from "../../tasks/task-types";

// --- Required Milestone A coverage keys (assignment + Child 07 §§4–6.1) ------

export const MILESTONE_A_REQUIRED_COVERAGE = [
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
] as const;

export type MilestoneACoverageKey = (typeof MILESTONE_A_REQUIRED_COVERAGE)[number];

// --- Companion records (Child 04 stores these off-Observation) ---------------

/** EligibilityInput flags used to produce the stored decision. Not on Observation. */
export type MilestoneAClassificationFacts = Omit<
  EligibilityInput,
  "observation" | "comparabilityCohortId" | "decidedAt"
>;

/** Explicit coverage gap. Live type: ObservationSourceGap + the cell it belongs to. */
export interface MilestoneAMissingCell {
  taskId: string;
  taskVersion: number;
  taskInstanceId: string;
  modelConfigurationId: string;
  modelKey: string;
  reason: ObservationSourceGap["reason"];
}

export interface MilestoneAObservationRow {
  /** Stable fixture key for coverage indexes and later golden tests. */
  key: string;
  observation: Observation;
  decision: EligibilityDecision;
  classification: MilestoneAClassificationFacts;
  /** Counting-ledger row. Live type: EvidenceLedgerRow. */
  ledger: EvidenceLedgerRow;
  coverage: MilestoneACoverageKey[];
}

export interface MilestoneAGoldenCorpus {
  /** Canonicalized via canonicalizeModelConfiguration (live identity rules). */
  configurations: Record<string, ModelConfigurationSnapshot>;
  tasks: TaskRecord[];
  versions: TaskVersion[];
  instances: TaskInstance[];
  families: TaskFamily[];
  familyAssignments: TaskFamilyAssignment[];
  facets: TaskFacetAnnotation[];
  rows: MilestoneAObservationRow[];
  missingCells: MilestoneAMissingCell[];
  /** Declared paired cells for EvidenceCountInput.declaredPairs. */
  declaredPairs: Array<{ taskId: string; a: string; b: string }>;
}

// --- Fixed clocks / fingerprints (not secrets) -------------------------------

const T0 = 1_704_067_200_000;

function sha(ch: string): string {
  return `sha256:${ch.repeat(64)}`;
}

const PROTOCOL_A = sha("a");
const PROTOCOL_B = sha("b");
const RUBRIC_QUALITY: VersionRef = { id: "rub-quality", version: 3 };
const RUBRIC_STYLE: VersionRef = { id: "rub-style", version: 1 };
const VERIFIER_REF: VersionRef = { id: "ver-exact-match", version: 2 };

const EVAL_JUDGE_A: EvaluatorSnapshot = {
  kind: "model_judge",
  providerId: "openrouter",
  model: "org/judge",
  resolvedVersion: "2026-01-01",
  instructionDigest: sha("3"),
  reasoningEffort: "high",
  toolScaffoldSignature: null,
};

const EVAL_JUDGE_B: EvaluatorSnapshot = {
  kind: "model_judge",
  providerId: "openrouter",
  model: "org/judge-holdout",
  resolvedVersion: "2026-03-01",
  instructionDigest: sha("4"),
  reasoningEffort: "medium",
  toolScaffoldSignature: "eval-tools:v1",
};

const EVAL_HUMAN: EvaluatorSnapshot = {
  kind: "human_authorized",
  providerId: "local",
  model: "human-reviewer",
  resolvedVersion: "1",
  instructionDigest: sha("5"),
  reasoningEffort: null,
  toolScaffoldSignature: null,
};

const VERIFIER_SNAP: VerifierSnapshot = {
  verifierRef: VERIFIER_REF,
  kind: "exact_match",
  configurationDigest: sha("7"),
};

// --- Configurations (live ModelConfigurationSnapshot) ------------------------
// Identity = provider + requested/resolved model/version + reasoning policy +
// tool-scaffold signature + sanitized runtime settings. Windows are not
// identity. Completeness is derived: exact / rolling_alias / partial.

function mustConfig(
  input: Parameters<typeof canonicalizeModelConfiguration>[0],
): ModelConfigurationSnapshot {
  const result = canonicalizeModelConfiguration(input);
  if (!result.ok) throw new Error(`golden config rejected: ${result.reason}`);
  return result.snapshot;
}

const CFG_EXACT_ALPHA = mustConfig({
  providerId: "openrouter",
  requestedModel: "org/alpha",
  resolvedModel: "org/alpha",
  resolvedVersion: "2026-01-15",
  reasoningRequested: "high",
  reasoningEffective: "high",
  toolScaffoldSignature: null,
  runtimeSettings: { temperature: 0, maxTokens: 2048 },
  observedAt: T0,
});

const CFG_EXACT_ALPHA_LOW_REASONING = mustConfig({
  providerId: "openrouter",
  requestedModel: "org/alpha",
  resolvedModel: "org/alpha",
  resolvedVersion: "2026-01-15",
  reasoningRequested: "low",
  reasoningEffective: "low",
  toolScaffoldSignature: null,
  runtimeSettings: { temperature: 0, maxTokens: 2048 },
  observedAt: T0 + 1_000,
});

const CFG_EXACT_ALPHA_TOOLS = mustConfig({
  providerId: "openrouter",
  requestedModel: "org/alpha",
  resolvedModel: "org/alpha",
  resolvedVersion: "2026-01-15",
  reasoningRequested: "high",
  reasoningEffective: "high",
  toolScaffoldSignature: "scaffold:json-tools:v1",
  runtimeSettings: { temperature: 0, maxTokens: 2048 },
  observedAt: T0 + 2_000,
});

const CFG_EXACT_BETA = mustConfig({
  providerId: "anthropic",
  requestedModel: "claude-x",
  resolvedModel: "claude-x",
  resolvedVersion: "2026-02-01",
  reasoningRequested: "high",
  reasoningEffective: "high",
  toolScaffoldSignature: null,
  runtimeSettings: { temperature: 0 },
  observedAt: T0 + 3_000,
});

const CFG_ROLLING_ALPHA = mustConfig({
  providerId: "openrouter",
  requestedModel: "org/alpha-latest",
  resolvedModel: "org/alpha",
  resolvedVersion: null,
  reasoningRequested: "high",
  reasoningEffective: "high",
  toolScaffoldSignature: null,
  runtimeSettings: { temperature: 0 },
  observedAt: T0 + 4_000,
});

const CFG_PARTIAL_LEGACY = mustConfig({
  providerId: "openai",
  requestedModel: "gpt-legacy",
  resolvedModel: null,
  resolvedVersion: null,
  reasoningRequested: null,
  reasoningEffective: null,
  toolScaffoldSignature: null,
  runtimeSettings: {},
  observedAt: T0 + 5_000,
});

const CONFIGURATIONS = {
  exactAlpha: CFG_EXACT_ALPHA,
  exactAlphaLowReasoning: CFG_EXACT_ALPHA_LOW_REASONING,
  exactAlphaTools: CFG_EXACT_ALPHA_TOOLS,
  exactBeta: CFG_EXACT_BETA,
  rollingAlpha: CFG_ROLLING_ALPHA,
  partialLegacy: CFG_PARTIAL_LEGACY,
} as const;

// --- Tasks / versions / instances / families / facets ------------------------

const TASKS: TaskRecord[] = [
  {
    id: "task-transform",
    latestVersion: 2,
    createdAt: T0 - 10_000,
    updatedAt: T0 - 1_000,
    archivedAt: null,
    origin: "authored",
    revision: 2,
  },
  {
    id: "task-write",
    latestVersion: 1,
    createdAt: T0 - 9_000,
    updatedAt: T0 - 9_000,
    archivedAt: null,
    origin: "authored",
    revision: 1,
  },
  {
    id: "task-math",
    latestVersion: 1,
    createdAt: T0 - 8_000,
    updatedAt: T0 - 8_000,
    archivedAt: null,
    origin: "authored",
    revision: 1,
  },
  {
    id: "task-verify",
    latestVersion: 1,
    createdAt: T0 - 7_000,
    updatedAt: T0 - 7_000,
    archivedAt: null,
    origin: "authored",
    revision: 1,
  },
  {
    id: "task-orphan",
    latestVersion: 1,
    createdAt: T0 - 6_000,
    updatedAt: T0 - 6_000,
    archivedAt: null,
    origin: "imported",
    revision: 1,
  },
];

function taskVersion(
  taskId: string,
  version: number,
  title: string,
  verifier: VersionRef | null = null,
): TaskVersion {
  return {
    taskId,
    version,
    title,
    objective: `${title} objective`,
    candidateInstruction: `Complete: ${title}.`,
    defaultContextManifest: [],
    responseContract: { format: "text", constraints: [], maxLength: 2000 },
    taskVerifierRef: verifier,
    source: { kind: "authored", legacyScopeKey: null, note: null },
    createdAt: T0 - 5_000 + version,
  };
}

const VERSIONS: TaskVersion[] = [
  taskVersion("task-transform", 1, "Transform v1"),
  taskVersion("task-transform", 2, "Transform v2"),
  taskVersion("task-write", 1, "Write v1"),
  taskVersion("task-math", 1, "Math v1"),
  taskVersion("task-verify", 1, "Verify v1", VERIFIER_REF),
  taskVersion("task-orphan", 1, "Orphan v1"),
];

function instance(
  id: string,
  taskId: string,
  taskVersionNumber: number,
  digestChar: string,
  text: string,
): TaskInstance {
  return {
    id,
    taskId,
    taskVersion: taskVersionNumber,
    normalizedInput: { text, artifactIds: [], metadata: {} },
    contextManifest: [],
    inputDigest: sha(digestChar),
    inputCompleteness: "complete",
    createdAt: T0 - 4_000,
    sourceRef: { kind: "authored", legacyScopeKey: null, originId: null },
  };
}

const INSTANCES: TaskInstance[] = [
  instance("inst-transform-a", "task-transform", 1, "1", "Rename the helper."),
  instance("inst-transform-b", "task-transform", 1, "2", "Extract a constant."),
  instance("inst-transform-v2", "task-transform", 2, "3", "Rename with types."),
  instance("inst-write-a", "task-write", 1, "4", "Write a one-line summary."),
  instance("inst-math-a", "task-math", 1, "5", "Add the two integers."),
  instance("inst-verify-a", "task-verify", 1, "6", "Return the exact token."),
  instance("inst-orphan-a", "task-orphan", 1, "8", "Imported prompt."),
];

const FAMILIES: TaskFamily[] = [
  {
    id: "family-transform",
    name: "Code transformation",
    description: "Local rewrite tasks.",
    parentFamilyId: null,
    createdAt: T0 - 20_000,
    updatedAt: T0 - 20_000,
    archivedAt: null,
    revision: 1,
  },
  {
    id: "family-write",
    name: "Short writing",
    description: "Brief prose tasks.",
    parentFamilyId: null,
    createdAt: T0 - 19_000,
    updatedAt: T0 - 19_000,
    archivedAt: null,
    revision: 1,
  },
];

const FAMILY_ASSIGNMENTS: TaskFamilyAssignment[] = [
  {
    id: "assign-transform",
    taskId: "task-transform",
    taskVersion: 1,
    familyId: "family-transform",
    isPrimary: true,
    createdAt: T0 - 15_000,
    revision: 1,
    archivedAt: null,
  },
  {
    id: "assign-math",
    taskId: "task-math",
    taskVersion: 1,
    familyId: "family-transform",
    isPrimary: true,
    createdAt: T0 - 14_000,
    revision: 1,
    archivedAt: null,
  },
  {
    id: "assign-verify",
    taskId: "task-verify",
    taskVersion: 1,
    familyId: "family-transform",
    isPrimary: true,
    createdAt: T0 - 13_000,
    revision: 1,
    archivedAt: null,
  },
  {
    id: "assign-write",
    taskId: "task-write",
    taskVersion: 1,
    familyId: "family-write",
    isPrimary: true,
    createdAt: T0 - 12_000,
    revision: 1,
    archivedAt: null,
  },
];

const FACETS: TaskFacetAnnotation[] = [
  {
    id: "facet-transform-form",
    taskId: "task-transform",
    taskVersion: null,
    facetId: "task-form",
    valueId: "rewrite",
    source: "authored",
    authorKind: "user",
    confidence: 1,
    taxonomyVersion: 1,
    createdAt: T0 - 11_000,
    supersedesId: null,
  },
  {
    id: "facet-write-domain",
    taskId: "task-write",
    taskVersion: 1,
    facetId: "domain",
    valueId: "prose",
    source: "authored",
    authorKind: "user",
    confidence: 1,
    taxonomyVersion: 1,
    createdAt: T0 - 11_000,
    supersedesId: null,
  },
];

// --- Observation / decision / ledger builders --------------------------------

function modelKeyOf(cfg: ModelConfigurationSnapshot): string {
  return `${cfg.providerId}:${cfg.requestedModel}`;
}

function healthyClassification(
  cfg: ModelConfigurationSnapshot,
  overrides: Partial<MilestoneAClassificationFacts> = {},
): MilestoneAClassificationFacts {
  return {
    canonicalTaskResolved: true,
    candidateInputComplete: true,
    candidateSelectedCompleted: true,
    assessmentSelectedCompleted: true,
    verifierState: "not_declared",
    frozenVerifierVersion: false,
    humanVerificationAuthorized: false,
    rubricResolved: true,
    protocolComplete: true,
    configurationState: cfg.identityCompleteness as ConfigurationState,
    fullPairCoverage: true,
    fullTaskSetCoverage: true,
    reusedCandidateAssessment: false,
    undeclaredRepeat: false,
    sourceCorrupt: false,
    sourceLegacyLimited: false,
    anchorDesignated: false,
    ...overrides,
  };
}

interface BuildRowInput {
  key: string;
  cfg: ModelConfigurationSnapshot;
  taskId: string;
  taskVersion: number;
  taskInstanceId: string;
  taskFamilyId: string | null;
  sourceKind?: Observation["sourceKind"];
  sourceResultId: string;
  executionLineageId: string;
  runId: string;
  candidateAttemptId: string;
  judgeAttemptId: string;
  protocolFingerprint?: string;
  rubricRef?: VersionRef | null;
  evaluator?: EvaluatorSnapshot;
  verifierSnapshot?: VerifierSnapshot | null;
  outcome?: ObservationOutcome;
  observedAt?: number;
  sequence?: number;
  reusedCandidateOutput?: boolean;
  declaredReplicate?: boolean;
  attemptIds?: string[];
  priorJudgeAttemptIds?: string[];
  classification?: Partial<MilestoneAClassificationFacts>;
  coverage: MilestoneACoverageKey[];
}

function buildRow(input: BuildRowInput): MilestoneAObservationRow {
  const cfg = input.cfg;
  const modelKey = modelKeyOf(cfg);
  const sourceTaskCellId = `${input.sourceResultId}:${input.taskId}:${modelKey}`;
  const candidateId = `cand-${input.candidateAttemptId}`;
  const rubricRef = input.rubricRef === undefined ? RUBRIC_QUALITY : input.rubricRef;
  const evaluator = input.evaluator ?? EVAL_JUDGE_A;
  const verifierSnapshot = input.verifierSnapshot ?? null;
  const outcome: ObservationOutcome = input.outcome ?? {
    judgeAccepted: true,
    overallScore: 4,
    criterionValues: [{ criterionId: "c-quality", value: 4 }],
    verifierPassed: null,
  };

  const assessmentRef: AssessmentRef = {
    judgeAttemptId: input.judgeAttemptId,
    judgeProviderId: evaluator.providerId,
    judgeModel: evaluator.model,
    blindLabelMapping: { A: candidateId },
    candidateAttemptIdsByCandidateId: { [candidateId]: input.candidateAttemptId },
    rubricRef,
    verifierRef: verifierSnapshot?.verifierRef ?? null,
    verifierOutcome:
      outcome.verifierPassed === null
        ? null
        : {
            taskId: input.taskId,
            modelKey,
            passed: outcome.verifierPassed,
            executedAt: input.observedAt ?? T0,
          },
  };

  const observationBase: Observation = {
    id: "",
    sourceKind: input.sourceKind ?? "evaluation",
    sourceResultId: input.sourceResultId,
    executionLineageId: input.executionLineageId,
    runId: input.runId,
    sourceTaskCellId,
    taskId: input.taskId,
    taskVersion: input.taskVersion,
    taskInstanceId: input.taskInstanceId,
    taskFamilyId: input.taskFamilyId,
    modelConfigurationId: cfg.id,
    candidateAttemptId: input.candidateAttemptId,
    assessmentRef,
    protocolFingerprint: input.protocolFingerprint ?? PROTOCOL_A,
    rubricRef,
    evaluatorSnapshot: evaluator,
    verifierSnapshot,
    outcome,
    observedAt: input.observedAt ?? T0,
    observationSchemaVersion: OBSERVATION_SCHEMA_VERSION,
  };
  const observation: Observation = {
    ...observationBase,
    id: observationIdFor(observationBase),
  };

  const classification = healthyClassification(cfg, input.classification);
  const cohort = buildComparabilityCohort({
    taskId: observation.taskId,
    taskVersion: observation.taskVersion,
    taskInstanceId: observation.taskInstanceId,
    rubricRef: observation.rubricRef,
    verifierRef: observation.verifierSnapshot?.verifierRef ?? null,
    verifierKind: observation.verifierSnapshot?.kind ?? null,
    verifierConfigurationDigest: observation.verifierSnapshot?.configurationDigest ?? null,
    protocolFingerprint: observation.protocolFingerprint,
    responseMode: "text",
    evaluator: observation.evaluatorSnapshot,
    reasoningRequested: cfg.reasoningRequested,
    reasoningEffective: cfg.reasoningEffective,
    toolScaffoldSignature: cfg.toolScaffoldSignature,
    providerId: cfg.providerId,
    resolvedModel: cfg.resolvedModel ?? cfg.requestedModel,
    resolvedVersion: cfg.resolvedVersion,
  });

  const decision = classifyEligibility({
    observation,
    ...classification,
    comparabilityCohortId: cohort.id,
    decidedAt: observation.observedAt + 1,
  });

  const ledger: EvidenceLedgerRow = {
    lineageCellKey: `${sourceTaskCellId}::${cfg.id}`,
    taskId: observation.taskId,
    taskVersion: observation.taskVersion,
    taskInstanceId: observation.taskInstanceId,
    modelConfigurationId: cfg.id,
    sequence: input.sequence ?? 1,
    candidateAttemptId: observation.candidateAttemptId,
    reusedCandidateOutput: input.reusedCandidateOutput ?? false,
    declaredReplicate: input.declaredReplicate ?? false,
    assessmentEventId: input.judgeAttemptId,
    attemptIds: input.attemptIds ?? [input.candidateAttemptId],
  };

  return {
    key: input.key,
    observation,
    decision,
    classification,
    ledger,
    coverage: input.coverage,
  };
}

// --- Reviewed rows -----------------------------------------------------------
// One connected world: six configurations, five tasks, mixed cohorts,
// selection/counting companions. Comments cite the live type each row is for.

const ROWS: MilestoneAObservationRow[] = [
  // Live: ModelConfigurationSnapshot.identityCompleteness === "exact"
  // + EligibilityDecision.status eligible + allowedUses includes within_model_profile.
  buildRow({
    key: "exact-alpha-transform-v1-a",
    cfg: CFG_EXACT_ALPHA,
    taskId: "task-transform",
    taskVersion: 1,
    taskInstanceId: "inst-transform-a",
    taskFamilyId: "family-transform",
    sourceResultId: "exp-transform-base",
    executionLineageId: "eval:exp-transform-base:task-transform",
    runId: "run-transform-base",
    candidateAttemptId: "att-alpha-transform-a",
    judgeAttemptId: "j-alpha-transform-a",
    coverage: [
      "exact_configuration",
      "eligible_decision",
      "within_model_profile_allowed",
      "mixed_comparability_cohorts",
      "mixed_rubric_evaluator_protocol",
    ],
  }),

  // Live: reasoningRequested / reasoningEffective are identity fields
  // (model-configuration.ts). Distinct snapshot from exact-alpha.
  buildRow({
    key: "exact-alpha-low-reason-transform-v1-a",
    cfg: CFG_EXACT_ALPHA_LOW_REASONING,
    taskId: "task-transform",
    taskVersion: 1,
    taskInstanceId: "inst-transform-a",
    taskFamilyId: "family-transform",
    sourceResultId: "exp-transform-reason",
    executionLineageId: "eval:exp-transform-reason:task-transform",
    runId: "run-transform-reason",
    candidateAttemptId: "att-alpha-low-transform-a",
    judgeAttemptId: "j-alpha-low-transform-a",
    coverage: ["reasoning_policy_difference"],
  }),

  // Live: toolScaffoldSignature is an identity field. Distinct snapshot.
  buildRow({
    key: "exact-alpha-tools-transform-v1-a",
    cfg: CFG_EXACT_ALPHA_TOOLS,
    taskId: "task-transform",
    taskVersion: 1,
    taskInstanceId: "inst-transform-a",
    taskFamilyId: "family-transform",
    sourceResultId: "exp-transform-tools",
    executionLineageId: "eval:exp-transform-tools:task-transform",
    runId: "run-transform-tools",
    candidateAttemptId: "att-alpha-tools-transform-a",
    judgeAttemptId: "j-alpha-tools-transform-a",
    coverage: ["tool_scaffold_difference"],
  }),

  // Live: providerId + requested/resolved model/version + runtimeSettings.
  // Also the paired counterpart of exact-alpha on task-transform.
  buildRow({
    key: "exact-beta-transform-v1-a",
    cfg: CFG_EXACT_BETA,
    taskId: "task-transform",
    taskVersion: 1,
    taskInstanceId: "inst-transform-a",
    taskFamilyId: "family-transform",
    sourceResultId: "exp-transform-base",
    executionLineageId: "eval:exp-transform-base:task-transform",
    runId: "run-transform-base",
    candidateAttemptId: "att-beta-transform-a",
    judgeAttemptId: "j-beta-transform-a",
    coverage: ["provider_runtime_identity_difference", "mixed_comparability_cohorts"],
  }),

  // Live: identityCompleteness rolling_alias (resolvedModel set, version null).
  // classifyEligibility: comparable + provisional + within_model_profile kept.
  buildRow({
    key: "rolling-alpha-transform-v1-a",
    cfg: CFG_ROLLING_ALPHA,
    taskId: "task-transform",
    taskVersion: 1,
    taskInstanceId: "inst-transform-a",
    taskFamilyId: "family-transform",
    sourceResultId: "exp-transform-rolling",
    executionLineageId: "eval:exp-transform-rolling:task-transform",
    runId: "run-transform-rolling",
    candidateAttemptId: "att-rolling-transform-a",
    judgeAttemptId: "j-rolling-transform-a",
    coverage: [
      "rolling_alias_unknown_resolved_version",
      "provisional_decision",
      "within_model_profile_allowed",
    ],
  }),

  // Live: identityCompleteness partial. classifyEligibility → exploratory,
  // only task_descriptive — within_model_profile is NOT allowed.
  buildRow({
    key: "partial-legacy-transform-v1-a",
    cfg: CFG_PARTIAL_LEGACY,
    taskId: "task-transform",
    taskVersion: 1,
    taskInstanceId: "inst-transform-a",
    taskFamilyId: "family-transform",
    sourceResultId: "exp-transform-legacy",
    executionLineageId: "eval:exp-transform-legacy:task-transform",
    runId: "run-transform-legacy",
    candidateAttemptId: "att-partial-transform-a",
    judgeAttemptId: "j-partial-transform-a",
    sourceKind: "comparison",
    coverage: ["partial_identity", "within_model_profile_not_allowed", "provisional_decision"],
  }),

  // Live: Observation.taskVersion = 2 of the same Task identity.
  buildRow({
    key: "exact-alpha-transform-v2",
    cfg: CFG_EXACT_ALPHA,
    taskId: "task-transform",
    taskVersion: 2,
    taskInstanceId: "inst-transform-v2",
    taskFamilyId: "family-transform",
    sourceResultId: "exp-transform-v2",
    executionLineageId: "eval:exp-transform-v2:task-transform",
    runId: "run-transform-v2",
    candidateAttemptId: "att-alpha-transform-v2",
    judgeAttemptId: "j-alpha-transform-v2",
    observedAt: T0 + 20_000,
    coverage: ["multiple_task_versions"],
  }),

  // Live: Observation.taskInstanceId distinct under the same Task Version.
  buildRow({
    key: "exact-alpha-transform-v1-b",
    cfg: CFG_EXACT_ALPHA,
    taskId: "task-transform",
    taskVersion: 1,
    taskInstanceId: "inst-transform-b",
    taskFamilyId: "family-transform",
    sourceResultId: "exp-transform-inst-b",
    executionLineageId: "eval:exp-transform-inst-b:task-transform",
    runId: "run-transform-inst-b",
    candidateAttemptId: "att-alpha-transform-b",
    judgeAttemptId: "j-alpha-transform-b",
    observedAt: T0 + 8_000,
    coverage: ["multiple_task_instances"],
  }),

  // Live: EvidenceLedgerRow.declaredReplicate = true. Two planned executions
  // of the same Task Instance keep distinct executionLineageId / sourceTaskCellId
  // so Child 07 §6.1 can group them without Child 04 countEvidence collapsing
  // them (that helper keys by source-task-cell × configuration).
  buildRow({
    key: "exact-alpha-write-rep-1",
    cfg: CFG_EXACT_ALPHA,
    taskId: "task-write",
    taskVersion: 1,
    taskInstanceId: "inst-write-a",
    taskFamilyId: "family-write",
    sourceResultId: "exp-write-rep-1",
    executionLineageId: "eval:exp-write-rep-1:task-write",
    runId: "run-write-rep-1",
    candidateAttemptId: "att-write-r1",
    judgeAttemptId: "j-write-r1",
    declaredReplicate: true,
    attemptIds: ["att-write-r1"],
    observedAt: T0 + 30_000,
    coverage: ["declared_replicates"],
  }),
  buildRow({
    key: "exact-alpha-write-rep-2",
    cfg: CFG_EXACT_ALPHA,
    taskId: "task-write",
    taskVersion: 1,
    taskInstanceId: "inst-write-a",
    taskFamilyId: "family-write",
    sourceResultId: "exp-write-rep-2",
    executionLineageId: "eval:exp-write-rep-2:task-write",
    runId: "run-write-rep-2",
    candidateAttemptId: "att-write-r2",
    judgeAttemptId: "j-write-r2",
    declaredReplicate: true,
    attemptIds: ["att-write-r2"],
    observedAt: T0 + 31_000,
    coverage: ["declared_replicates"],
  }),

  // Live: EligibilityInput.undeclaredRepeat → reason code undeclared_repeat.
  // Not labeled an independent replicate (ledger.declaredReplicate stays false).
  buildRow({
    key: "exact-alpha-orphan-first",
    cfg: CFG_EXACT_ALPHA,
    taskId: "task-orphan",
    taskVersion: 1,
    taskInstanceId: "inst-orphan-a",
    taskFamilyId: null,
    sourceResultId: "exp-orphan-1",
    executionLineageId: "eval:exp-orphan-1:task-orphan",
    runId: "run-orphan-1",
    candidateAttemptId: "att-orphan-1",
    judgeAttemptId: "j-orphan-1",
    observedAt: T0 + 40_000,
    coverage: ["undeclared_repeats"],
  }),
  buildRow({
    key: "exact-alpha-orphan-undeclared",
    cfg: CFG_EXACT_ALPHA,
    taskId: "task-orphan",
    taskVersion: 1,
    taskInstanceId: "inst-orphan-a",
    taskFamilyId: null,
    sourceResultId: "exp-orphan-2",
    executionLineageId: "eval:exp-orphan-2:task-orphan",
    runId: "run-orphan-2",
    candidateAttemptId: "att-orphan-2",
    judgeAttemptId: "j-orphan-2",
    observedAt: T0 + 41_000,
    classification: { undeclaredRepeat: true },
    coverage: ["undeclared_repeats"],
  }),

  // Live: ObservationSource CellProvenance retry_success + EvidenceLedgerRow.attemptIds
  // listing the failed retry as audit. Active observation uses the selected attempt.
  // Unequal attempt counts: this Task carries three attempt ids vs one on transform.
  buildRow({
    key: "exact-alpha-math-retry",
    cfg: CFG_EXACT_ALPHA,
    taskId: "task-math",
    taskVersion: 1,
    taskInstanceId: "inst-math-a",
    taskFamilyId: "family-transform",
    sourceResultId: "exp-math-retry",
    executionLineageId: "eval:exp-math-retry:task-math",
    runId: "run-math-retry",
    candidateAttemptId: "att-math-ok",
    judgeAttemptId: "j-math-1",
    attemptIds: ["att-math-fail", "att-math-retry", "att-math-ok"],
    observedAt: T0 + 50_000,
    // Mixed Rubric / evaluator / protocol vs the transform-quality cohort.
    protocolFingerprint: PROTOCOL_B,
    rubricRef: RUBRIC_STYLE,
    evaluator: EVAL_JUDGE_B,
    classification: { fullPairCoverage: false, fullTaskSetCoverage: false },
    coverage: [
      "candidate_retry_reuse",
      "unequal_attempt_counts_across_tasks",
      "mixed_rubric_evaluator_protocol",
      "mixed_comparability_cohorts",
      "provisional_decision",
      "within_model_profile_allowed",
    ],
  }),

  // Live: AssessmentRef — second judge event on the same candidateAttemptId /
  // execution lineage / task / model cell. Source key includes assessment
  // identity, so this is a second Observation; countEvidence keeps one active
  // (highest sequence). reusedCandidateAssessment disclosure.
  buildRow({
    key: "exact-alpha-math-rejudge",
    cfg: CFG_EXACT_ALPHA,
    taskId: "task-math",
    taskVersion: 1,
    taskInstanceId: "inst-math-a",
    taskFamilyId: "family-transform",
    sourceResultId: "exp-math-retry",
    executionLineageId: "eval:exp-math-retry:task-math",
    runId: "run-math-retry",
    candidateAttemptId: "att-math-ok",
    judgeAttemptId: "j-math-2",
    sequence: 2,
    reusedCandidateOutput: true,
    attemptIds: ["att-math-ok"],
    observedAt: T0 + 51_000,
    protocolFingerprint: PROTOCOL_B,
    rubricRef: RUBRIC_STYLE,
    evaluator: EVAL_HUMAN,
    classification: {
      reusedCandidateAssessment: true,
      fullPairCoverage: false,
      fullTaskSetCoverage: false,
    },
    coverage: [
      "multiple_assessments_one_cell",
      "candidate_retry_reuse",
      "mixed_rubric_evaluator_protocol",
    ],
  }),

  // Live: VerifierSnapshot + outcome.verifierPassed true + frozenVerifierVersion.
  // classifyEligibility → evidenceClass "verified".
  buildRow({
    key: "exact-alpha-verify-pass",
    cfg: CFG_EXACT_ALPHA,
    taskId: "task-verify",
    taskVersion: 1,
    taskInstanceId: "inst-verify-a",
    taskFamilyId: "family-transform",
    sourceResultId: "exp-verify",
    executionLineageId: "eval:exp-verify:task-verify",
    runId: "run-verify",
    candidateAttemptId: "att-alpha-verify",
    judgeAttemptId: "j-alpha-verify",
    verifierSnapshot: VERIFIER_SNAP,
    outcome: {
      judgeAccepted: true,
      overallScore: 5,
      criterionValues: [{ criterionId: "c-correct", value: true }],
      verifierPassed: true,
    },
    observedAt: T0 + 60_000,
    classification: { verifierState: "passed" as VerifierState, frozenVerifierVersion: true },
    coverage: ["verified_pass", "eligible_decision"],
  }),

  // Live: verifierPassed false. classifyEligibility stays comparable + provisional
  // (valid negative evidence; never a Verified class).
  buildRow({
    key: "exact-beta-verify-fail",
    cfg: CFG_EXACT_BETA,
    taskId: "task-verify",
    taskVersion: 1,
    taskInstanceId: "inst-verify-a",
    taskFamilyId: "family-transform",
    sourceResultId: "exp-verify",
    executionLineageId: "eval:exp-verify:task-verify",
    runId: "run-verify",
    candidateAttemptId: "att-beta-verify",
    judgeAttemptId: "j-beta-verify",
    verifierSnapshot: VERIFIER_SNAP,
    outcome: {
      judgeAccepted: true,
      overallScore: 1,
      criterionValues: [{ criterionId: "c-correct", value: false }],
      verifierPassed: false,
    },
    observedAt: T0 + 60_000,
    classification: { verifierState: "failed" },
    coverage: ["verified_fail", "provisional_decision"],
  }),

  // Live: EligibilityDecision.status excluded (source_corrupt → no uses).
  buildRow({
    key: "exact-alpha-transform-corrupt",
    cfg: CFG_EXACT_ALPHA,
    taskId: "task-transform",
    taskVersion: 1,
    taskInstanceId: "inst-transform-a",
    taskFamilyId: "family-transform",
    sourceResultId: "exp-transform-corrupt",
    executionLineageId: "eval:exp-transform-corrupt:task-transform",
    runId: "run-transform-corrupt",
    candidateAttemptId: "att-alpha-corrupt",
    judgeAttemptId: "j-alpha-corrupt",
    observedAt: T0 + 70_000,
    classification: { sourceCorrupt: true },
    coverage: ["excluded_decision", "within_model_profile_not_allowed"],
  }),
];

const MISSING_CELLS: MilestoneAMissingCell[] = [
  {
    taskId: "task-math",
    taskVersion: 1,
    taskInstanceId: "inst-math-a",
    modelConfigurationId: CFG_EXACT_BETA.id,
    modelKey: modelKeyOf(CFG_EXACT_BETA),
    reason: "missing_cell",
  },
  {
    taskId: "task-verify",
    taskVersion: 1,
    taskInstanceId: "inst-verify-a",
    modelConfigurationId: CFG_ROLLING_ALPHA.id,
    modelKey: modelKeyOf(CFG_ROLLING_ALPHA),
    reason: "missing_cell",
  },
];

const DECLARED_PAIRS: MilestoneAGoldenCorpus["declaredPairs"] = [
  { taskId: "task-transform", a: CFG_EXACT_ALPHA.id, b: CFG_EXACT_BETA.id },
  { taskId: "task-math", a: CFG_EXACT_ALPHA.id, b: CFG_EXACT_BETA.id },
  { taskId: "task-verify", a: CFG_EXACT_ALPHA.id, b: CFG_EXACT_BETA.id },
];

export const MILESTONE_A_GOLDEN: MilestoneAGoldenCorpus = {
  configurations: CONFIGURATIONS,
  tasks: TASKS,
  versions: VERSIONS,
  instances: INSTANCES,
  families: FAMILIES,
  familyAssignments: FAMILY_ASSIGNMENTS,
  facets: FACETS,
  rows: ROWS,
  missingCells: MISSING_CELLS,
  declaredPairs: DECLARED_PAIRS,
};

/** Coverage key → fixture row keys and/or missing-cell markers. */
export const MILESTONE_A_COVERAGE_INDEX: Record<MilestoneACoverageKey, string[]> = (() => {
  const index = Object.fromEntries(
    MILESTONE_A_REQUIRED_COVERAGE.map((key) => [key, [] as string[]]),
  ) as Record<MilestoneACoverageKey, string[]>;
  for (const row of ROWS) {
    for (const key of row.coverage) index[key].push(row.key);
  }
  index.missing_cells.push(
    ...MISSING_CELLS.map((gap) => `gap:${gap.taskId}:${gap.modelConfigurationId}`),
  );
  return index;
})();

export function milestoneAObservations(): Observation[] {
  return MILESTONE_A_GOLDEN.rows.map((row) => row.observation);
}

export function milestoneADecisions(): EligibilityDecision[] {
  return MILESTONE_A_GOLDEN.rows.map((row) => row.decision);
}

export function milestoneALedgerRows(): EvidenceLedgerRow[] {
  return MILESTONE_A_GOLDEN.rows.map((row) => row.ledger);
}

export const MILESTONE_A_EVIDENCE_RULE_VERSION = EVIDENCE_RULE_VERSION;
