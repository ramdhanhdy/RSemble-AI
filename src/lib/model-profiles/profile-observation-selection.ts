// =============================================================================
// RSemble AI — profile-observation-selection.ts (Child 07 Task 3, GREEN)
//
// Pure selector over Child 04 Observations, EligibilityDecisions, and
// EvidenceLedgerRows. One active accepted assessment per
// execution-lineage / task / model cell. Only evidence authorized for
// `within_model_profile` under the requested eligibility rule version
// participates in profile metrics.
//
// Contract (Child 07 spec §6.1, plan Task 3):
//  - Resolve the requested exact ModelConfigurationSnapshot.
//  - Resolve EligibilityDecision under the requested rule version.
//  - Retries and reused outputs do not inflate independent evidence.
//  - Declared replicates stay identifiable inside a Task Instance.
//  - Undeclared repeats stay visible and are not labeled independent
//    replicates.
//  - Preserve evidence-class, comparability-cohort, Rubric, evaluator, and
//    protocol boundaries — filters restrict, they never pool.
//  - Deterministic and permutation-invariant.
//  - Never mutate source Observations, decisions, or ledger rows.
//  - Model Rollups stay stratified_only: per-member exact selections, never
//    a pooled synthetic respondent.
//
// This module does not implement coverage aggregation, bootstrap, paired
// comparison, claims, UI, or a rollup store.
// =============================================================================

import type { EvidenceLedgerRow } from "../evidence/evidence-counting";
import type {
  EligibilityDecision,
  ModelConfigurationSnapshot,
  Observation,
} from "../evidence/evidence-types";
import type { TaskFacetAnnotation, VersionRef } from "../tasks/task-types";
import {
  isModelEvidenceQuery,
  isProfileRespondent,
  validateModelEvidenceQuery,
  type EvaluatorFilter,
  type FacetFilter,
  type ModelEvidenceQuery,
  type RollupVersionResolver,
} from "./model-evidence-query";

// --- Corpus / result types ----------------------------------------------------

/** Explicit coverage gap. Missing cells are never invented Observations. */
export interface ProfileCoverageGap {
  readonly taskId: string;
  readonly taskVersion: number;
  readonly taskInstanceId: string;
  readonly modelConfigurationId: string;
  readonly reason: string;
}

/**
 * In-memory evidence corpus for a pure profile query. Ledger rows and
 * missing-cell gaps live off Observation (Child 04); they are supplied here
 * rather than invented as Observation fields.
 */
export interface ProfileEvidenceCorpus {
  readonly configurations: readonly ModelConfigurationSnapshot[];
  readonly observations: readonly Observation[];
  readonly decisions: readonly EligibilityDecision[];
  readonly ledgerRows?: readonly EvidenceLedgerRow[];
  readonly facets?: readonly TaskFacetAnnotation[];
  readonly missingCells?: readonly ProfileCoverageGap[];
}

export interface ProfileSelectedRecord {
  readonly observation: Observation;
  readonly decision: EligibilityDecision;
  readonly ledger: EvidenceLedgerRow | null;
}

export interface ProfileSelectedCell {
  readonly cellKey: string;
  readonly executionLineageId: string;
  readonly taskId: string;
  readonly taskVersion: number;
  readonly taskInstanceId: string;
  readonly modelConfigurationId: string;
  readonly active: ProfileSelectedRecord;
  readonly supersededAssessments: readonly ProfileSelectedRecord[];
}

export interface DeclaredReplicateGroup {
  readonly taskId: string;
  readonly taskVersion: number;
  readonly taskInstanceId: string;
  readonly records: readonly ProfileSelectedRecord[];
}

export type ProfileUnauthorizedReason =
  "use_not_authorized" | "no_decision_for_rule_version" | "unknown_version_excluded";

export interface ProfileUnauthorizedRecord {
  readonly observation: Observation;
  readonly decision: EligibilityDecision | null;
  readonly ledger: EvidenceLedgerRow | null;
  readonly reason: ProfileUnauthorizedReason;
}

export interface ProfileExactSelection {
  readonly kind: "exact";
  readonly modelConfiguration: ModelConfigurationSnapshot;
  readonly eligibilityRuleVersion: number;
  readonly cells: readonly ProfileSelectedCell[];
  readonly unauthorized: readonly ProfileUnauthorizedRecord[];
  readonly declaredReplicateGroups: readonly DeclaredReplicateGroup[];
  readonly undeclaredRepeats: readonly ProfileSelectedRecord[];
}

export interface ProfileStratifiedSelection {
  readonly kind: "stratified_only";
  readonly memberConfigurationIds: readonly string[];
  readonly members: readonly ProfileExactSelection[];
}

export interface ProfileUnresolvedSelection {
  readonly kind: "unresolved";
  readonly reason: "configuration_not_found" | "rollup_unresolved" | "invalid_query";
  readonly detail: string;
}

export type ProfileObservationSelection =
  ProfileExactSelection | ProfileStratifiedSelection | ProfileUnresolvedSelection;

// --- Cell identity (Child 07 §6.1, not Child 04 lineageCellKey) ---------------

/** executionLineageId × taskId × modelConfigurationId. */
export function profileLineageCellKey(
  executionLineageId: string,
  taskId: string,
  modelConfigurationId: string,
): string {
  return `${executionLineageId}\u0000${taskId}\u0000${modelConfigurationId}`;
}

// --- Matching helpers ---------------------------------------------------------

function rubricKey(ref: VersionRef | null): string | null {
  return ref === null ? null : `${ref.id}@${ref.version}`;
}

function observationInWindow(observation: Observation, query: ModelEvidenceQuery): boolean {
  if (query.observedFrom !== null && observation.observedAt < query.observedFrom) return false;
  if (query.observedTo !== null && observation.observedAt > query.observedTo) return false;
  return true;
}

function observationMatchesFamily(observation: Observation, familyIds: readonly string[]): boolean {
  if (familyIds.length === 0) return true;
  return observation.taskFamilyId !== null && familyIds.includes(observation.taskFamilyId);
}

function observationMatchesSource(
  observation: Observation,
  sourceKinds: readonly Observation["sourceKind"][],
): boolean {
  return sourceKinds.length === 0 || sourceKinds.includes(observation.sourceKind);
}

function observationMatchesRubric(
  observation: Observation,
  rubricRefs: readonly VersionRef[],
): boolean {
  if (rubricRefs.length === 0) return true;
  const key = rubricKey(observation.rubricRef);
  if (key === null) return false;
  for (const ref of rubricRefs) {
    if (`${ref.id}@${ref.version}` === key) return true;
  }
  return false;
}

function observationMatchesEvaluator(
  observation: Observation,
  filters: readonly EvaluatorFilter[],
): boolean {
  if (filters.length === 0) return true;
  const snap = observation.evaluatorSnapshot;
  for (const filter of filters) {
    if (filter.evaluatorKind !== null && filter.evaluatorKind !== snap.kind) continue;
    if (filter.providerId !== null && filter.providerId !== snap.providerId) continue;
    if (filter.model !== null && filter.model !== snap.model) continue;
    if (filter.instructionDigest !== null && filter.instructionDigest !== snap.instructionDigest) {
      continue;
    }
    return true;
  }
  return false;
}

function observationMatchesFacets(
  observation: Observation,
  filters: readonly FacetFilter[],
  facets: readonly TaskFacetAnnotation[],
): boolean {
  if (filters.length === 0) return true;
  const applicable: TaskFacetAnnotation[] = [];
  for (const facet of facets) {
    if (facet.taskId !== observation.taskId) continue;
    if (facet.taskVersion !== null && facet.taskVersion !== observation.taskVersion) continue;
    applicable.push(facet);
  }
  for (const filter of filters) {
    let matched = false;
    for (const facet of applicable) {
      if (facet.facetId !== filter.facetId) continue;
      if (filter.valueIds.length === 0 || filter.valueIds.includes(facet.valueId)) {
        matched = true;
        break;
      }
    }
    if (!matched) return false;
  }
  return true;
}

function structurallyInScope(
  observation: Observation,
  query: ModelEvidenceQuery,
  facets: readonly TaskFacetAnnotation[],
): boolean {
  return (
    observationInWindow(observation, query) &&
    observationMatchesFamily(observation, query.taskFamilyIds) &&
    observationMatchesSource(observation, query.sourceKinds) &&
    observationMatchesRubric(observation, query.rubricRefs) &&
    observationMatchesEvaluator(observation, query.evaluatorFilters) &&
    observationMatchesFacets(observation, query.facetFilters, facets)
  );
}

function decisionMatchesQueryFilters(
  decision: EligibilityDecision,
  query: ModelEvidenceQuery,
): boolean {
  if (query.evidenceClasses.length > 0 && !query.evidenceClasses.includes(decision.evidenceClass)) {
    return false;
  }
  if (
    query.comparabilityCohortIds.length > 0 &&
    !query.comparabilityCohortIds.includes(decision.comparabilityCohortId)
  ) {
    return false;
  }
  return true;
}

function findLedger(
  observation: Observation,
  ledgerRows: readonly EvidenceLedgerRow[] | undefined,
): EvidenceLedgerRow | null {
  if (ledgerRows === undefined || ledgerRows.length === 0) return null;
  let found: EvidenceLedgerRow | null = null;
  for (const row of ledgerRows) {
    if (row.modelConfigurationId !== observation.modelConfigurationId) continue;
    if (row.taskId !== observation.taskId) continue;
    if (row.taskVersion !== observation.taskVersion) continue;
    if (row.taskInstanceId !== observation.taskInstanceId) continue;
    if (row.candidateAttemptId !== observation.candidateAttemptId) continue;
    if (row.assessmentEventId !== observation.assessmentRef.judgeAttemptId) continue;
    if (
      found === null ||
      row.sequence > found.sequence ||
      (row.sequence === found.sequence &&
        (row.assessmentEventId ?? "").localeCompare(found.assessmentEventId ?? "") < 0)
    ) {
      found = row;
    }
  }
  return found;
}

function compareSelectedRecords(a: ProfileSelectedRecord, b: ProfileSelectedRecord): number {
  const seqA = a.ledger?.sequence;
  const seqB = b.ledger?.sequence;
  if (seqA !== undefined && seqB !== undefined && seqA !== seqB) return seqB - seqA;
  if (seqA !== undefined && seqB === undefined) return -1;
  if (seqA === undefined && seqB !== undefined) return 1;
  if (a.observation.observedAt !== b.observation.observedAt) {
    return b.observation.observedAt - a.observation.observedAt;
  }
  return a.observation.id.localeCompare(b.observation.id);
}

function compareSuperseded(a: ProfileSelectedRecord, b: ProfileSelectedRecord): number {
  const seqA = a.ledger?.sequence ?? Number.POSITIVE_INFINITY;
  const seqB = b.ledger?.sequence ?? Number.POSITIVE_INFINITY;
  if (seqA !== seqB) return seqA - seqB;
  return a.observation.id.localeCompare(b.observation.id);
}

function compareCells(a: ProfileSelectedCell, b: ProfileSelectedCell): number {
  return a.cellKey.localeCompare(b.cellKey);
}

function unknownVersionExcluded(
  configuration: ModelConfigurationSnapshot,
  includeUnknownVersion: boolean,
): boolean {
  if (includeUnknownVersion) return false;
  return (
    configuration.identityCompleteness === "rolling_alias" || configuration.resolvedVersion === null
  );
}

function profileUseRequested(query: ModelEvidenceQuery): boolean {
  return query.allowedUses.length === 0 || query.allowedUses.includes("within_model_profile");
}

// --- Exact selection ----------------------------------------------------------

function selectExactConfiguration(
  query: ModelEvidenceQuery,
  corpus: ProfileEvidenceCorpus,
  modelConfigurationId: string,
): ProfileExactSelection | ProfileUnresolvedSelection {
  let modelConfiguration: ModelConfigurationSnapshot | null = null;
  for (const cfg of corpus.configurations) {
    if (cfg.id === modelConfigurationId) {
      modelConfiguration = cfg;
      break;
    }
  }
  if (modelConfiguration === null) {
    return {
      kind: "unresolved",
      reason: "configuration_not_found",
      detail: `No ModelConfigurationSnapshot ${modelConfigurationId} in the corpus.`,
    };
  }

  const decisionsByKey = new Map<string, EligibilityDecision>();
  for (const decision of corpus.decisions) {
    if (decision.ruleVersion !== query.eligibilityRuleVersion) continue;
    decisionsByKey.set(`${decision.observationId}#${decision.ruleVersion}`, decision);
  }

  const facets = corpus.facets ?? [];
  const authorized: ProfileSelectedRecord[] = [];
  const unauthorized: ProfileUnauthorizedRecord[] = [];
  const excludeUnknown = unknownVersionExcluded(modelConfiguration, query.includeUnknownVersion);
  const useRequested = profileUseRequested(query);

  for (const observation of corpus.observations) {
    if (observation.modelConfigurationId !== modelConfiguration.id) continue;
    if (!structurallyInScope(observation, query, facets)) continue;

    const decision =
      decisionsByKey.get(`${observation.id}#${query.eligibilityRuleVersion}`) ?? null;
    const ledger = findLedger(observation, corpus.ledgerRows);

    if (decision !== null && !decisionMatchesQueryFilters(decision, query)) continue;

    if (decision === null) {
      unauthorized.push({
        observation,
        decision: null,
        ledger,
        reason: "no_decision_for_rule_version",
      });
      continue;
    }

    if (!useRequested || !decision.allowedUses.includes("within_model_profile")) {
      unauthorized.push({
        observation,
        decision,
        ledger,
        reason: "use_not_authorized",
      });
      continue;
    }

    if (excludeUnknown) {
      unauthorized.push({
        observation,
        decision,
        ledger,
        reason: "unknown_version_excluded",
      });
      continue;
    }

    authorized.push({ observation, decision, ledger });
  }

  const byCell = new Map<string, ProfileSelectedRecord[]>();
  for (const record of authorized) {
    const key = profileLineageCellKey(
      record.observation.executionLineageId,
      record.observation.taskId,
      record.observation.modelConfigurationId,
    );
    const bucket = byCell.get(key);
    if (bucket) bucket.push(record);
    else byCell.set(key, [record]);
  }

  const cells: ProfileSelectedCell[] = [];
  for (const [cellKey, records] of byCell) {
    const ranked = [...records].sort(compareSelectedRecords);
    const active = ranked[0];
    const supersededAssessments = ranked.slice(1).sort(compareSuperseded);
    cells.push({
      cellKey,
      executionLineageId: active.observation.executionLineageId,
      taskId: active.observation.taskId,
      taskVersion: active.observation.taskVersion,
      taskInstanceId: active.observation.taskInstanceId,
      modelConfigurationId: active.observation.modelConfigurationId,
      active,
      supersededAssessments,
    });
  }
  cells.sort(compareCells);

  const replicateBuckets = new Map<string, ProfileSelectedRecord[]>();
  for (const cell of cells) {
    if (cell.active.ledger?.declaredReplicate !== true) continue;
    const key = `${cell.taskId}\u0000${cell.taskVersion}\u0000${cell.taskInstanceId}`;
    const bucket = replicateBuckets.get(key);
    if (bucket) bucket.push(cell.active);
    else replicateBuckets.set(key, [cell.active]);
  }
  const declaredReplicateGroups: DeclaredReplicateGroup[] = [];
  for (const records of replicateBuckets.values()) {
    const first = records[0];
    declaredReplicateGroups.push({
      taskId: first.observation.taskId,
      taskVersion: first.observation.taskVersion,
      taskInstanceId: first.observation.taskInstanceId,
      records: [...records].sort((a, b) => a.observation.id.localeCompare(b.observation.id)),
    });
  }
  declaredReplicateGroups.sort((a, b) => {
    const task = a.taskId.localeCompare(b.taskId);
    if (task !== 0) return task;
    if (a.taskVersion !== b.taskVersion) return a.taskVersion - b.taskVersion;
    return a.taskInstanceId.localeCompare(b.taskInstanceId);
  });

  const undeclaredRepeats = cells
    .map((cell) => cell.active)
    .filter((record) => record.decision.reasonCodes.includes("undeclared_repeat"))
    .sort((a, b) => a.observation.id.localeCompare(b.observation.id));

  unauthorized.sort((a, b) => a.observation.id.localeCompare(b.observation.id));

  return {
    kind: "exact",
    modelConfiguration,
    eligibilityRuleVersion: query.eligibilityRuleVersion,
    cells,
    unauthorized,
    declaredReplicateGroups,
    undeclaredRepeats,
  };
}

// --- Public selector ----------------------------------------------------------

/**
 * Select the active authorized observation per execution-lineage / task /
 * model cell for one profile query. Pure: reads the supplied corpus and
 * returns wrappers around the original records. Never writes or mutates.
 */
export function selectProfileObservations(
  query: ModelEvidenceQuery,
  corpus: ProfileEvidenceCorpus,
  resolver?: RollupVersionResolver,
): ProfileObservationSelection {
  if (isProfileRespondent(query.respondent) && query.respondent.kind === "model_rollup") {
    if (!isModelEvidenceQuery(query)) {
      return {
        kind: "unresolved",
        reason: "invalid_query",
        detail: "ModelEvidenceQuery failed structural validation.",
      };
    }
    const validated = validateModelEvidenceQuery(query, resolver);
    if (!validated.ok) {
      return {
        kind: "unresolved",
        reason: "rollup_unresolved",
        detail: validated.errors.join(" "),
      };
    }
    if (validated.resolvedRespondent.kind !== "model_rollup") {
      return {
        kind: "unresolved",
        reason: "invalid_query",
        detail: "Rollup query did not resolve to a rollup manifest.",
      };
    }
    // Consume the manifest resolved by validation exactly once. The receipt
    // manifest and the executed member set cannot diverge because selection
    // never re-resolves the rollup.
    const manifest = validated.resolvedRespondent.manifest;
    const members: ProfileExactSelection[] = [];
    for (const memberId of manifest.memberConfigurationIds) {
      const memberQuery: ModelEvidenceQuery = {
        ...query,
        respondent: { kind: "model_configuration", modelConfigurationId: memberId },
      };
      const member = selectExactConfiguration(memberQuery, corpus, memberId);
      if (member.kind === "exact") members.push(member);
    }
    members.sort((a, b) => a.modelConfiguration.id.localeCompare(b.modelConfiguration.id));
    return {
      kind: "stratified_only",
      memberConfigurationIds: [...manifest.memberConfigurationIds],
      members,
    };
  }

  const validated = validateModelEvidenceQuery(query);
  if (!validated.ok) {
    return {
      kind: "unresolved",
      reason: "invalid_query",
      detail: validated.errors.join(" "),
    };
  }
  if (query.respondent.kind !== "model_configuration") {
    return {
      kind: "unresolved",
      reason: "invalid_query",
      detail: "Respondent is not an exact model configuration.",
    };
  }
  return selectExactConfiguration(query, corpus, query.respondent.modelConfigurationId);
}
