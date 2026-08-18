// =============================================================================
// RSemble AI — Policy Study candidate observation adapter (spec §9)
//
// Bridges Research Lab Policy Studies to the canonical Child 04 Observation
// pipeline.
//
// Invariants enforced here (spec §9):
//  - StudyObservation is Lab-owned policy evidence. It NEVER enters Model
//    Evidence Profiles directly.
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

import type {
  EligibilityDecision,
  ModelConfigurationSnapshot,
  Observation,
} from "./evidence-types";
import type { RunRecordV2 } from "../persistence/run-types";
import type {
  DerivationDeps,
  EvaluationSourceResolver,
  ResolvedTaskIdentity,
  TaskIdentityResolver,
} from "./derive-observations";
import type { EvidenceRepository } from "../persistence/evidence-repository";
import type { StudyRepository } from "../persistence/study-repository";

/** Error thrown when a policy output is incorrectly submitted as model evidence. */
export class PolicyOutputEvidenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyOutputEvidenceError";
  }
}

/** Check if a payload is a Lab-owned policy output rather than candidate evidence. */
export function isPolicyOutputEvidence(payload: unknown): boolean {
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
  resolveModelConfiguration?: DerivationDeps["resolveModelConfiguration"];
  resolveVerifierOutcomes?: DerivationDeps["resolveVerifierOutcomes"];
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

export function qualifyStudyCandidateObservation(
  input: QualifyStudyCandidateInput,
): QualifyStudyCandidateResult {
  return { ok: false, reason: "stub" };
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

export async function adaptStudyCandidateRun(
  deps: DerivationDeps,
  input: AdaptStudyCandidateRunInput,
): Promise<AdaptStudyCandidateRunResult> {
  return {
    status: "error",
    observationCount: 0,
    gapCount: 0,
    limitationCount: 0,
    integrityIssues: [],
    reusedCount: 0,
    errorKind: "stub",
    errorMessage: "stub",
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

export async function adaptPolicyStudy(
  options: AdaptPolicyStudyOptions,
): Promise<AdaptPolicyStudyResult> {
  return {
    status: "error",
    candidateRunsProcessed: 0,
    candidateRunsSkipped: 0,
    observationsCreated: 0,
    observationsReused: 0,
    limitations: 0,
    policyOutputsSkipped: 0,
    errors: ["stub"],
  };
}
