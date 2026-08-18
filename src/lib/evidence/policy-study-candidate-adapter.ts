// =============================================================================
// RSemble AI — Policy Study candidate observation adapter (spec §9)
//
// Bridges Research Lab Policy Studies to the canonical Child 04 Observation
// pipeline.
//
// Invariants enforced here (spec §9):
//  - StudyObservation is Lab-owned policy evidence. It NEVER enters model
//    evidence profiles directly.
//  - Underlying single-model candidate responses qualify as canonical Task
//    Observations only when all ordinary requirements pass (exact canonical Task
//    Version and Task Instance, complete digest-addressed response, exact Model
//    Configuration, unambiguous accepted attempt/assessment, complete rubric/
//    verifier provenance, and deterministic eligibility classification).
//  - The eligibility adapter reads underlying candidate Run/attempt evidence,
//    NOT Policy Study scores.
//  - Referencing the same candidate in multiple trials or studies yields ONE
//    immutable source Observation identity. Reuse, never duplicate; no
//    attempt/trial/study-weighted inflation.
//  - Rank selections, Fusion Results, Refined Results, policy rows, playbook
//    scores, recipe comparisons, and study conclusions remain policy evidence.
//    They are never attributed wholly, fractionally, or collectively to
//    participating model profiles.
// =============================================================================

import {
  type AssessmentRef,
  type EligibilityDecision,
  type EvaluatorSnapshot,
  type ModelConfigurationSnapshot,
  type Observation,
  type ObservationOutcome,
  OBSERVATION_SCHEMA_VERSION,
} from "./evidence-types";
import { isCohortFingerprint, observationIdFor } from "./evidence-validation";
import { canonicalizeModelConfiguration } from "./model-configuration";
import { buildComparabilityCohort } from "./comparability-cohort";
import { classifyEligibility } from "./evidence-eligibility";
import { hashArtifactContent, canonicalJsonString } from "../evaluations/protocol-fingerprint";
import type { RunRecordV2 } from "../persistence/run-types";
import {
  defaultModelConfigurationResolver,
  deriveObservationsForSource,
  type DerivationDeps,
  type EvaluationSourceResolver,
  type ModelConfigurationResolver,
  type ResolvedTaskIdentity,
  type TaskIdentityResolver,
  type VerifierOutcomeResolver,
} from "./derive-observations";
import type { EvidenceRepository } from "../persistence/evidence-repository";
import type { StudyRepository } from "../persistence/study-repository";
import {
  isStudyObservationEnvelope,
  isStudyRecordEnvelope,
  isStudyTrialEnvelope,
} from "../studies/study-types";

/** Error thrown when a policy output is incorrectly submitted as model evidence. */
export class PolicyOutputEvidenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyOutputEvidenceError";
  }
}

/** Check if a payload is a Lab-owned policy output rather than candidate evidence. */
export function isPolicyOutputEvidence(payload: unknown): boolean {
  if (payload === null || typeof payload !== "object") return false;
  const rec = payload as Record<string, unknown>;

  // Direct Study envelopes
  if (rec.payloadKind === "policy_measurement" || isStudyObservationEnvelope(payload)) return true;
  if (rec.payloadKind === "policy" || isStudyTrialEnvelope(payload)) return true;
  if (rec.kind === "policy" || isStudyRecordEnvelope(payload)) return true;

  // Policy report / Playbook
  if ("reportSchemaVersion" in rec && "definitionFingerprint" in rec && "rows" in rec) return true;
  if ("policy" in rec && "meanOutcome" in rec && "lift" in rec && "costMultiplier" in rec)
    return true;
  if ("recommendation" in rec && "supportingTrialIds" in rec) return true;

  // Rank selection winner
  if ("winnerCandidateId" in rec && rec.policy === "rank") return true;

  // Fusion or Refined synthesis artifact
  if ("fusionAttemptId" in rec && ("runId" in rec || "contentHash" in rec)) return true;
  if (rec.policy === "fuse" || rec.policy === "refine") {
    if ("contentHash" in rec || "fusionAttemptId" in rec) return true;
  }

  return false;
}

/** Reject policy outputs from entering model evidence profiles. */
export function assertNotPolicyOutput(payload: unknown): void {
  if (isPolicyOutputEvidence(payload)) {
    throw new PolicyOutputEvidenceError("Policy outputs cannot become model evidence.");
  }
}

export interface QualifyStudyCandidateInput {
  candidateRun: RunRecordV2;
  candidateId: string;
  identity?: ResolvedTaskIdentity | null;
  identityResolver?: TaskIdentityResolver;
  resolveModelConfiguration?: ModelConfigurationResolver;
  resolveVerifierOutcomes?: VerifierOutcomeResolver;
  now?: () => number;
}

export type QualifyStudyCandidateResult =
  | {
      ok: true;
      observation: Observation;
      decision: EligibilityDecision;
      snapshot: ModelConfigurationSnapshot;
    }
  | {
      ok: false;
      reason: string;
      limitationCode?: string;
    };

/** Extract normalized criterion values from candidate evaluation report. */
function extractCriterionValues(
  run: RunRecordV2,
  candidateId: string,
): ObservationOutcome["criterionValues"] {
  const evalReport = run.judge.report?.evaluationsById[candidateId];
  if (!evalReport) return [];
  const values: ObservationOutcome["criterionValues"] = [];
  for (const score of evalReport.criterionScores) {
    if (score.kind === "binary" && typeof score.value === "boolean") {
      values.push({ criterionId: score.criterionId, value: score.value });
    } else if (typeof score.score === "number" && Number.isFinite(score.score)) {
      values.push({ criterionId: score.criterionId, value: score.score });
    }
  }
  values.sort((a, b) => a.criterionId.localeCompare(b.criterionId));
  return values;
}

/**
 * Qualify one underlying single-model candidate response from a Policy Study candidate run.
 * Follows strict Child 04 validation and eligibility rules without score inflation.
 */
export function qualifyStudyCandidateObservation(
  input: QualifyStudyCandidateInput,
): QualifyStudyCandidateResult {
  const { candidateRun, candidateId } = input;

  if (isPolicyOutputEvidence(candidateRun)) {
    return {
      ok: false,
      reason: "Policy outputs cannot become model evidence.",
      limitationCode: "source_corrupt",
    };
  }

  // 1. Candidate must exist and have an accepted attempt
  const candidate = candidateRun.candidates.find((c) => c.candidateId === candidateId);
  if (!candidate) {
    return {
      ok: false,
      reason: `Candidate ${candidateId} not found in run ${candidateRun.id}.`,
      limitationCode: "candidate_missing_or_failed",
    };
  }

  if (!candidate.acceptedAttemptId) {
    return {
      ok: false,
      reason: `Candidate ${candidateId} has no accepted attempt.`,
      limitationCode: "candidate_missing_or_failed",
    };
  }

  const attempt = candidate.attempts.find((a) => a.attemptId === candidate.acceptedAttemptId);
  if (
    !attempt ||
    attempt.status !== "completed" ||
    !attempt.output ||
    attempt.output.trim().length === 0
  ) {
    return {
      ok: false,
      reason: `Candidate attempt ${candidate.acceptedAttemptId} is incomplete or failed.`,
      limitationCode: "candidate_missing_or_failed",
    };
  }

  // 2. Canonical Task identity resolution
  let resolvedIdentity: ResolvedTaskIdentity | null = null;
  if (input.identity !== undefined) {
    resolvedIdentity = input.identity;
  } else {
    // Attempt fallback from run facts if no full experiment snapshot was provided
    if (candidateRun.source.kind === "experiment") {
      const prompt = candidateRun.task.prompt.trim();
      const systemPrompt = candidateRun.task.systemPrompt.trim();
      resolvedIdentity = {
        taskId: candidateRun.source.taskId,
        taskVersion: candidateRun.source.suiteVersion,
        taskInstanceId: `inst:${hashArtifactContent(
          canonicalJsonString([
            candidateRun.source.taskId,
            candidateRun.source.suiteVersion,
            prompt,
            systemPrompt,
          ]),
        )}`,
        taskFamilyId: null,
        inputComplete: prompt.length > 0,
      };
    }
  }

  if (!resolvedIdentity) {
    return {
      ok: false,
      reason: "Canonical task identity could not be resolved.",
      limitationCode: "canonical_task_unresolved",
    };
  }

  if (!resolvedIdentity.inputComplete) {
    return {
      ok: false,
      reason: "Task instance input is incomplete (empty prompt).",
      limitationCode: "instance_input_incomplete",
    };
  }

  // 3. Judge assessment
  const acceptedJudgeAttemptId = candidateRun.judge.acceptedAttemptId;
  if (!acceptedJudgeAttemptId) {
    return {
      ok: false,
      reason: "No accepted judge attempt for candidate run.",
      limitationCode: "assessment_missing_or_failed",
    };
  }

  const jAttempt = candidateRun.judge.attempts.find((a) => a.attemptId === acceptedJudgeAttemptId);
  if (!jAttempt || jAttempt.status !== "completed" || !jAttempt.report) {
    return {
      ok: false,
      reason: "Accepted judge attempt is missing or failed.",
      limitationCode: "assessment_missing_or_failed",
    };
  }

  const evalReport = jAttempt.report.evaluationsById[candidateId];
  if (!evalReport) {
    return {
      ok: false,
      reason: `No judge evaluation report found for candidate ${candidateId}.`,
      limitationCode: "assessment_missing_or_failed",
    };
  }

  // 4. Rubric & verifier provenance
  const rubricSnapshot = candidateRun.evaluation.profile;
  const rubricRef =
    rubricSnapshot && rubricSnapshot.id && rubricSnapshot.version
      ? { id: rubricSnapshot.id, version: rubricSnapshot.version }
      : null;
  const rubricResolved = rubricRef !== null;

  // 5. Model configuration facts
  const modelConfigResolver = input.resolveModelConfiguration ?? defaultModelConfigurationResolver;
  const facts = modelConfigResolver({ run: candidateRun, candidate });

  const observedAt = candidateRun.completedAt ?? candidateRun.updatedAt;
  const modelConfigResult = canonicalizeModelConfiguration({
    providerId: candidate.providerId,
    requestedModel: candidate.model,
    resolvedModel: facts.resolvedModel,
    resolvedVersion: facts.resolvedVersion,
    toolScaffoldSignature: null,
    reasoningRequested: null,
    reasoningEffective: null,
    runtimeSettings: {},
    observedAt,
  });

  if (!modelConfigResult.ok) {
    return {
      ok: false,
      reason: modelConfigResult.reason,
      limitationCode: "model_configuration_incomplete",
    };
  }

  const snapshot = modelConfigResult.snapshot;

  // 6. Protocol fingerprint
  const rawProtocolFingerprint =
    candidateRun.source.kind === "experiment" ? candidateRun.source.protocolFingerprint : "";
  const protocolComplete = isCohortFingerprint(rawProtocolFingerprint);
  const protocolFingerprint = protocolComplete
    ? rawProtocolFingerprint
    : `sha256:${hashArtifactContent(canonicalJsonString([candidateRun.id, observedAt]))}`;

  // 7. Evaluator Snapshot
  const evaluatorSnapshot: EvaluatorSnapshot = {
    kind: "model_judge",
    providerId: jAttempt.providerId,
    model: jAttempt.model,
    resolvedVersion: null,
    instructionDigest: `sha256:${hashArtifactContent(jAttempt.instruction)}`,
    reasoningEffort: null,
    toolScaffoldSignature: null,
  };

  // 8. Comparability cohort
  const comparabilityCohort = buildComparabilityCohort({
    taskId: resolvedIdentity.taskId,
    taskVersion: resolvedIdentity.taskVersion,
    taskInstanceId: resolvedIdentity.taskInstanceId,
    rubricRef,
    verifierRef: null,
    verifierKind: null,
    verifierConfigurationDigest: null,
    protocolFingerprint,
    responseMode: null,
    evaluator: evaluatorSnapshot,
    reasoningRequested: snapshot.reasoningRequested,
    reasoningEffective: snapshot.reasoningEffective,
    toolScaffoldSignature: snapshot.toolScaffoldSignature,
    providerId: snapshot.providerId,
    resolvedModel: snapshot.resolvedModel ?? snapshot.requestedModel,
    resolvedVersion: snapshot.resolvedVersion,
  });

  // 9. AssessmentRef & Outcome
  const assessmentRef: AssessmentRef = {
    judgeAttemptId: jAttempt.attemptId,
    judgeProviderId: jAttempt.providerId,
    judgeModel: jAttempt.model,
    blindLabelMapping: jAttempt.blindLabelToCandidateId ?? {},
    candidateAttemptIdsByCandidateId: jAttempt.candidateAttemptIdsByCandidateId ?? {
      [candidateId]: candidate.acceptedAttemptId,
    },
    rubricRef,
    verifierRef: null,
    verifierOutcome: null,
  };

  const outcome: ObservationOutcome = {
    judgeAccepted: true,
    overallScore: evalReport.overallScore ?? null,
    criterionValues: extractCriterionValues(candidateRun, candidateId),
    verifierPassed: null,
  };

  const sourceTaskCellId =
    candidateRun.source.kind === "experiment"
      ? `cell:${candidateRun.source.experimentId}:${candidateRun.source.taskId}:${candidate.modelKey}`
      : `cell:${candidateRun.id}:${candidate.modelKey}`;

  const executionLineageId =
    candidateRun.source.kind === "experiment"
      ? `eval:${candidateRun.source.experimentId}:${candidateRun.source.taskId}`
      : `run:${candidateRun.id}`;

  const observationUnkeyed: Omit<Observation, "id"> = {
    sourceKind: "evaluation",
    sourceResultId: candidateRun.id,
    executionLineageId,
    runId: candidateRun.id,
    sourceTaskCellId,
    taskId: resolvedIdentity.taskId,
    taskVersion: resolvedIdentity.taskVersion,
    taskInstanceId: resolvedIdentity.taskInstanceId,
    taskFamilyId: resolvedIdentity.taskFamilyId,
    modelConfigurationId: snapshot.id,
    candidateAttemptId: candidate.acceptedAttemptId,
    assessmentRef,
    protocolFingerprint,
    rubricRef,
    evaluatorSnapshot,
    verifierSnapshot: null,
    outcome,
    observedAt,
    observationSchemaVersion: OBSERVATION_SCHEMA_VERSION,
  };

  const id = observationIdFor(observationUnkeyed as Observation);
  const observation: Observation = { ...observationUnkeyed, id };

  // 10. Eligibility decision
  const decision = classifyEligibility({
    observation,
    canonicalTaskResolved: true,
    candidateInputComplete: true,
    candidateSelectedCompleted: true,
    assessmentSelectedCompleted: true,
    verifierState: "not_declared",
    frozenVerifierVersion: false,
    humanVerificationAuthorized: false,
    rubricResolved,
    protocolComplete,
    configurationState:
      snapshot.identityCompleteness === "exact"
        ? "exact"
        : snapshot.identityCompleteness === "rolling_alias"
          ? "rolling_alias"
          : "partial",
    fullPairCoverage: true,
    fullTaskSetCoverage: true,
    reusedCandidateAssessment: false,
    undeclaredRepeat: false,
    sourceCorrupt: false,
    sourceLegacyLimited: false,
    anchorDesignated: false,
    comparabilityCohortId: comparabilityCohort.id,
    decidedAt: observedAt,
  });

  return {
    ok: true,
    observation,
    decision,
    snapshot,
  };
}

export interface AdaptStudyCandidateRunInput {
  candidateRunId: string;
  revision?: number;
  studyId?: string;
  trialIds?: string[];
}

export interface AdaptStudyCandidateRunResult {
  status: "complete" | "error";
  observationCount: number;
  gapCount: number;
  limitationCount: number;
  integrityIssues: string[];
  reusedCount: number;
  errorKind: string | null;
  errorMessage: string | null;
}

/**
 * Adapt one underlying candidate run from a Policy Study.
 * Uses exact six-part source key derivation to prevent inflation.
 */
export async function adaptStudyCandidateRun(
  deps: DerivationDeps,
  input: AdaptStudyCandidateRunInput,
): Promise<AdaptStudyCandidateRunResult> {
  const run = await deps.resolver.getRun(input.candidateRunId);
  if (!run) {
    return {
      status: "error",
      observationCount: 0,
      gapCount: 0,
      limitationCount: 0,
      integrityIssues: [],
      reusedCount: 0,
      errorKind: "source-missing",
      errorMessage: `Candidate run ${input.candidateRunId} could not be resolved.`,
    };
  }

  assertNotPolicyOutput(run);

  // Check how many observations existed before derivation
  const beforeObs = await deps.evidenceRepo.listObservationsBySource("evaluation", run.id);
  const existingCount = beforeObs.length;

  const derivation = await deriveObservationsForSource(deps, {
    sourceKind: "evaluation",
    sourceResultId: run.id,
    sourceRevision: input.revision ?? run.revision,
  });

  if (derivation.status !== "complete") {
    return {
      status: "error",
      observationCount: 0,
      gapCount: derivation.gapCount,
      limitationCount: derivation.limitationCount,
      integrityIssues: derivation.integrityIssues,
      reusedCount: 0,
      errorKind: derivation.errorKind,
      errorMessage: derivation.errorMessage,
    };
  }

  const afterObs = await deps.evidenceRepo.listObservationsBySource("evaluation", run.id);
  const newlyCreated = Math.max(0, afterObs.length - existingCount);
  const reused = derivation.observationCount - newlyCreated;

  return {
    status: "complete",
    observationCount: derivation.observationCount,
    gapCount: derivation.gapCount,
    limitationCount: derivation.limitationCount,
    integrityIssues: derivation.integrityIssues,
    reusedCount: reused,
    errorKind: null,
    errorMessage: null,
  };
}

export interface AdaptPolicyStudyOptions {
  studyId: string;
  studyRepo: StudyRepository;
  evidenceRepo: EvidenceRepository;
  resolver: EvaluationSourceResolver;
  identity?: TaskIdentityResolver;
  resolveVerifierOutcomes?: DerivationDeps["resolveVerifierOutcomes"];
  resolveModelConfiguration?: DerivationDeps["resolveModelConfiguration"];
  now?: () => number;
}

export interface AdaptPolicyStudyResult {
  status: "complete" | "error";
  candidateRunsProcessed: number;
  candidateRunsSkipped: number;
  observationsCreated: number;
  observationsReused: number;
  limitations: number;
  policyOutputsSkipped: number;
  errors: string[];
}

/**
 * Adapt all underlying candidate runs referenced by a Policy Study.
 * Extracts only underlying single-model candidate runs; skips all policy measurements and outputs.
 */
export async function adaptPolicyStudy(
  options: AdaptPolicyStudyOptions,
): Promise<AdaptPolicyStudyResult> {
  const { studyId, studyRepo, evidenceRepo, resolver } = options;
  const study = await studyRepo.getStudy(studyId);
  if (!study) {
    return {
      status: "error",
      candidateRunsProcessed: 0,
      candidateRunsSkipped: 0,
      observationsCreated: 0,
      observationsReused: 0,
      limitations: 0,
      policyOutputsSkipped: 0,
      errors: [`Study ${studyId} not found.`],
    };
  }

  const trials = await studyRepo.listTrials(studyId);
  let policyOutputsSkipped = 0;
  const candidateRunIds = new Set<string>();

  // Count and skip Lab-owned policy measurements for the entire study
  const studyObsList = await studyRepo.listObservations(studyId);
  for (const obs of studyObsList) {
    if (isPolicyOutputEvidence(obs)) {
      policyOutputsSkipped += 1;
    }
  }

  for (const trial of trials) {
    // Extract underlying candidate run IDs from artifactRefs
    for (const ref of trial.artifactRefs) {
      if (ref.runId) {
        candidateRunIds.add(ref.runId);
      }
    }
  }

  let candidateRunsProcessed = 0;
  const candidateRunsSkipped = 0;
  let observationsCreated = 0;
  let observationsReused = 0;
  let limitations = 0;
  const errors: string[] = [];

  const derivationDeps: DerivationDeps = {
    evidenceRepo,
    resolver,
    identity: options.identity,
    resolveVerifierOutcomes: options.resolveVerifierOutcomes,
    resolveModelConfiguration: options.resolveModelConfiguration,
    now: options.now,
  };

  for (const runId of candidateRunIds) {
    const existing = await evidenceRepo.listObservationsBySource("evaluation", runId);
    const existingCount = existing.length;

    const res = await adaptStudyCandidateRun(derivationDeps, {
      candidateRunId: runId,
      studyId,
    });

    if (res.status === "complete") {
      candidateRunsProcessed += 1;
      limitations += res.limitationCount;
      if (existingCount > 0) {
        observationsReused += res.observationCount;
      } else {
        observationsCreated += res.observationCount;
      }
    } else {
      errors.push(`${runId}: ${res.errorMessage ?? res.errorKind}`);
    }
  }

  return {
    status: errors.length === 0 ? "complete" : "error",
    candidateRunsProcessed,
    candidateRunsSkipped,
    observationsCreated,
    observationsReused,
    limitations,
    policyOutputsSkipped,
    errors,
  };
}
