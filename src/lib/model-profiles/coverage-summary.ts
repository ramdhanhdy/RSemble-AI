// =============================================================================
// RSemble AI — coverage-summary.ts (Child 07 Task 3, GREEN)
//
// Honest coverage over a selected exact-configuration profile. Reports
// separate quantities and never a single misleading n. Attempt count is an
// audit quantity, never sample size. If a requested count cannot be derived
// from existing canonical records it is unavailable or limited — never
// estimated.
//
// Contract (Child 07 spec §5.1–5.2, plan Task 3):
//  - unique Tasks, Task Versions, Task Instances, active Observations
//  - accepted candidate responses where Observation.candidateAttemptId exists
//  - attempts / planned replicates where EvidenceLedgerRow is present
//  - comparability cohorts, Rubric versions, evaluator configurations
//  - earliest / latest observation
//  - evidence-class, eligibility-status, and source splits
//  - missing cells only from supplied gaps
//  - resolved independent uncertainty units stay unavailable in Milestone A
//  - no pooled rollup coverage
//  - pure: never mutates the selection or source records
// =============================================================================

import { LIMITATION_REASON_CODES } from "../evidence/evidence-eligibility";
import {
  ELIGIBILITY_STATUSES,
  EVIDENCE_CLASSES,
  OBSERVATION_SOURCE_KINDS,
  type EligibilityStatus,
  type EvidenceClass,
  type EvidenceReasonCode,
  type IdentityCompleteness,
  type ObservationSourceKind,
} from "../evidence/evidence-types";
import type {
  ProfileEvidenceCorpus,
  ProfileExactSelection,
  ProfileSelectedRecord,
  ProfileUnauthorizedRecord,
} from "./profile-observation-selection";

export type HonestQuantity<T = number> =
  | { readonly state: "available"; readonly value: T }
  | {
      readonly state: "limited";
      readonly value: T;
      readonly unresolved: number;
      readonly reason: string;
    }
  | { readonly state: "unavailable"; readonly reason: string };

export interface ProfileCoverageSummary {
  readonly uniqueTasks: HonestQuantity;
  readonly taskVersions: HonestQuantity;
  readonly taskInstances: HonestQuantity;
  readonly activeObservations: HonestQuantity;
  readonly acceptedCandidateResponses: HonestQuantity;
  readonly attempts: HonestQuantity;
  readonly plannedReplicates: HonestQuantity;
  readonly resolvedIndependentUncertaintyUnits: HonestQuantity;
  readonly uncertaintyUnitKind: HonestQuantity<string>;
  readonly uncertaintyAssumption: HonestQuantity<string>;
  readonly comparabilityCohorts: HonestQuantity;
  readonly rubricVersions: HonestQuantity;
  readonly evaluatorConfigurations: HonestQuantity;
  readonly earliestObservation: HonestQuantity;
  readonly latestObservation: HonestQuantity;
  readonly missingCells: HonestQuantity;
  readonly inMetricsEvidenceClassSplit: Readonly<Record<EvidenceClass, number>>;
  readonly consideredEvidenceClassSplit: Readonly<Record<EvidenceClass, number>>;
  readonly inMetricsEligibilityStatusSplit: Readonly<Record<EligibilityStatus, number>>;
  readonly consideredEligibilityStatusSplit: Readonly<Record<EligibilityStatus, number>>;
  readonly sourceKindSplit: Readonly<Record<ObservationSourceKind, number>>;
  readonly identityCompleteness: IdentityCompleteness;
  readonly limitationReasons: Readonly<Partial<Record<EvidenceReasonCode, number>>>;
}

const UNCERTAINTY_UNAVAILABLE =
  "resolved independent uncertainty units are not assigned in Milestone A";

function emptyClassSplit(): Record<EvidenceClass, number> {
  const split = {} as Record<EvidenceClass, number>;
  for (const evidenceClass of EVIDENCE_CLASSES) split[evidenceClass] = 0;
  return split;
}

function emptyStatusSplit(): Record<EligibilityStatus, number> {
  const split = {} as Record<EligibilityStatus, number>;
  for (const status of ELIGIBILITY_STATUSES) split[status] = 0;
  return split;
}

function emptySourceSplit(): Record<ObservationSourceKind, number> {
  const split = {} as Record<ObservationSourceKind, number>;
  for (const kind of OBSERVATION_SOURCE_KINDS) split[kind] = 0;
  return split;
}

function evaluatorIdentity(record: ProfileSelectedRecord): string {
  const snap = record.observation.evaluatorSnapshot;
  return [
    snap.kind,
    snap.providerId,
    snap.model,
    snap.resolvedVersion ?? "",
    snap.instructionDigest,
    snap.reasoningEffort ?? "",
    snap.toolScaffoldSignature ?? "",
  ].join("\u0000");
}

function consideredRecords(
  selection: ProfileExactSelection,
): Array<ProfileSelectedRecord | ProfileUnauthorizedRecord> {
  const records: Array<ProfileSelectedRecord | ProfileUnauthorizedRecord> = [];
  for (const cell of selection.cells) {
    records.push(cell.active);
    for (const superseded of cell.supersededAssessments) records.push(superseded);
  }
  for (const unauthorized of selection.unauthorized) records.push(unauthorized);
  return records;
}

function countAttempts(
  records: ReadonlyArray<ProfileSelectedRecord | ProfileUnauthorizedRecord>,
): HonestQuantity {
  if (records.length === 0) {
    return { state: "available", value: 0 };
  }
  const attemptIds = new Set<string>();
  let unresolved = 0;
  for (const record of records) {
    if (record.ledger === null) {
      unresolved += 1;
      continue;
    }
    for (const attemptId of record.ledger.attemptIds) attemptIds.add(attemptId);
  }
  if (unresolved === records.length) {
    return {
      state: "unavailable",
      reason: "attempt ids live on EvidenceLedgerRow and no in-scope observation has a ledger row",
    };
  }
  if (unresolved > 0) {
    return {
      state: "limited",
      value: attemptIds.size,
      unresolved,
      reason:
        "attempt ids live on EvidenceLedgerRow; some in-scope observations have no ledger row",
    };
  }
  return { state: "available", value: attemptIds.size };
}

function countPlannedReplicates(selection: ProfileExactSelection): HonestQuantity {
  const actives = selection.cells.map((cell) => cell.active);
  if (actives.length === 0) return { state: "available", value: 0 };
  let declared = 0;
  let unresolved = 0;
  for (const record of actives) {
    if (record.ledger === null) {
      unresolved += 1;
      continue;
    }
    if (record.ledger.declaredReplicate) declared += 1;
  }
  if (unresolved === actives.length) {
    return {
      state: "unavailable",
      reason:
        "declared replicates live on EvidenceLedgerRow and no active observation has a ledger row",
    };
  }
  if (unresolved > 0) {
    return {
      state: "limited",
      value: declared,
      unresolved,
      reason:
        "declared replicates live on EvidenceLedgerRow; some active observations have no ledger row",
    };
  }
  return { state: "available", value: declared };
}

function countMissingCells(
  selection: ProfileExactSelection,
  corpus: Pick<ProfileEvidenceCorpus, "ledgerRows" | "missingCells"> | undefined,
): HonestQuantity {
  if (corpus?.missingCells === undefined) {
    return {
      state: "unavailable",
      reason: "missing cells are ObservationSourceGap records and were not supplied",
    };
  }
  let count = 0;
  for (const gap of corpus.missingCells) {
    if (gap.modelConfigurationId === selection.modelConfiguration.id) count += 1;
  }
  return { state: "available", value: count };
}

/**
 * Build a coverage summary for one exact-configuration selection. Throws if
 * called with a stratified rollup — member profiles are not pooled.
 */
export function buildCoverageSummary(
  selection: ProfileExactSelection,
  corpus?: Pick<ProfileEvidenceCorpus, "ledgerRows" | "missingCells">,
): ProfileCoverageSummary {
  if (selection.kind !== "exact") {
    throw new Error(
      "Coverage is defined only for an exact configuration selection; stratified rollups are not pooled.",
    );
  }

  const tasks = new Set<string>();
  const versions = new Set<string>();
  const instances = new Set<string>();
  const responses = new Set<string>();
  const cohorts = new Set<string>();
  const rubrics = new Set<string>();
  const evaluators = new Set<string>();
  const inMetricsClass = emptyClassSplit();
  const inMetricsStatus = emptyStatusSplit();
  const sourceSplit = emptySourceSplit();

  let earliest = Number.POSITIVE_INFINITY;
  let latest = Number.NEGATIVE_INFINITY;

  for (const cell of selection.cells) {
    const observation = cell.active.observation;
    const decision = cell.active.decision;
    tasks.add(observation.taskId);
    versions.add(`${observation.taskId}@${observation.taskVersion}`);
    instances.add(observation.taskInstanceId);
    responses.add(observation.candidateAttemptId);
    cohorts.add(decision.comparabilityCohortId);
    if (observation.rubricRef !== null) {
      rubrics.add(`${observation.rubricRef.id}@${observation.rubricRef.version}`);
    }
    evaluators.add(evaluatorIdentity(cell.active));
    inMetricsClass[decision.evidenceClass] += 1;
    inMetricsStatus[decision.status] += 1;
    sourceSplit[observation.sourceKind] += 1;
    if (observation.observedAt < earliest) earliest = observation.observedAt;
    if (observation.observedAt > latest) latest = observation.observedAt;
  }

  const consideredClass = emptyClassSplit();
  const consideredStatus = emptyStatusSplit();
  const limitationReasons: Partial<Record<EvidenceReasonCode, number>> = {};
  for (const record of consideredRecords(selection)) {
    if (record.decision === null) continue;
    consideredClass[record.decision.evidenceClass] += 1;
    consideredStatus[record.decision.status] += 1;
    for (const code of record.decision.reasonCodes) {
      if (LIMITATION_REASON_CODES[code] !== true) continue;
      limitationReasons[code] = (limitationReasons[code] ?? 0) + 1;
    }
  }

  const recency: {
    earliestObservation: HonestQuantity;
    latestObservation: HonestQuantity;
  } =
    selection.cells.length === 0
      ? {
          earliestObservation: {
            state: "unavailable",
            reason: "no active authorized observations in this selection",
          },
          latestObservation: {
            state: "unavailable",
            reason: "no active authorized observations in this selection",
          },
        }
      : {
          earliestObservation: { state: "available", value: earliest },
          latestObservation: { state: "available", value: latest },
        };

  return {
    uniqueTasks: { state: "available", value: tasks.size },
    taskVersions: { state: "available", value: versions.size },
    taskInstances: { state: "available", value: instances.size },
    activeObservations: { state: "available", value: selection.cells.length },
    acceptedCandidateResponses: { state: "available", value: responses.size },
    attempts: countAttempts(consideredRecords(selection)),
    plannedReplicates: countPlannedReplicates(selection),
    resolvedIndependentUncertaintyUnits: {
      state: "unavailable",
      reason: UNCERTAINTY_UNAVAILABLE,
    },
    uncertaintyUnitKind: { state: "unavailable", reason: UNCERTAINTY_UNAVAILABLE },
    uncertaintyAssumption: { state: "unavailable", reason: UNCERTAINTY_UNAVAILABLE },
    comparabilityCohorts: { state: "available", value: cohorts.size },
    rubricVersions: { state: "available", value: rubrics.size },
    evaluatorConfigurations: { state: "available", value: evaluators.size },
    earliestObservation: recency.earliestObservation,
    latestObservation: recency.latestObservation,
    missingCells: countMissingCells(selection, corpus),
    inMetricsEvidenceClassSplit: inMetricsClass,
    consideredEvidenceClassSplit: consideredClass,
    inMetricsEligibilityStatusSplit: inMetricsStatus,
    consideredEligibilityStatusSplit: consideredStatus,
    sourceKindSplit: sourceSplit,
    identityCompleteness: selection.modelConfiguration.identityCompleteness,
    limitationReasons,
  };
}
