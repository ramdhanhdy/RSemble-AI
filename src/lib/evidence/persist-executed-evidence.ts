// =============================================================================
// RSemble AI — Production persist of executed evidence facts (Wave A leftover)
//
// After an exact Evaluation source commits, this is the write half of Wave A:
// persist executed verifier outcomes into the evidence store so derivation
// can resolve them locally. Derivation never executes a verifier and never
// infers a pass from a declared contract.
//
// This module:
//  - writes only supplied executed outcomes for the committed source lineage;
//  - is idempotent under the existing composite identity;
//  - treats conflicting same-identity data as corruption;
//  - never mutates the source run/experiment;
//  - never calls a provider;
//  - never invents a pass/fail from verification.kind alone.
// =============================================================================

import type { ExperimentRecord } from "../evaluations/evaluation-types";
import type { EvidenceRepository } from "../persistence/evidence-repository";
import type { RunRecordV2 } from "../persistence/run-types";
import { isExecutedVerifierOutcome } from "./evidence-validation";
import type { ExecutedVerifierOutcome } from "./evidence-types";

export interface PersistExecutedEvidenceResult {
  created: number;
  existing: number;
}

/**
 * Official production writer for executed verifier outcomes. Callers must
 * supply outcomes that actually ran; this function does not execute a
 * verifier.
 */
export async function persistExecutedVerifierOutcomes(
  evidenceRepo: EvidenceRepository,
  outcomes: readonly ExecutedVerifierOutcome[],
): Promise<PersistExecutedEvidenceResult> {
  let created = 0;
  let existing = 0;
  for (const outcome of outcomes) {
    if (!isExecutedVerifierOutcome(outcome)) {
      throw new Error("Invalid ExecutedVerifierOutcome.");
    }
    const result = await evidenceRepo.putVerifierOutcome(outcome);
    if (result === "created") created += 1;
    else existing += 1;
  }
  return { created, existing };
}

export interface PersistCommittedSourceInput {
  evidenceRepo: EvidenceRepository;
  run: RunRecordV2;
  experiment: ExperimentRecord | null;
  /**
   * Executed outcomes captured for this committed source. Outcomes whose
   * `runId` is not this source's run are ignored (lineage isolation). A
   * declared verification contract on the snapshot is never enough.
   */
  executedOutcomes?: readonly ExecutedVerifierOutcome[];
}

/**
 * Persist executed verifier facts for one committed source. Missing or
 * lineage-foreign outcomes produce a silent zero write — pass/fail is never
 * inferred from the declared task verification kind.
 */
export async function persistExecutedEvidenceForCommittedSource(
  input: PersistCommittedSourceInput,
): Promise<PersistExecutedEvidenceResult> {
  const supplied = input.executedOutcomes ?? [];
  const scoped = supplied.filter((outcome) => outcome.runId === input.run.id);
  if (scoped.length === 0) {
    return { created: 0, existing: 0 };
  }
  return persistExecutedVerifierOutcomes(input.evidenceRepo, scoped);
}
