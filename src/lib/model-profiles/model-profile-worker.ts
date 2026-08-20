// =============================================================================
// RSemble AI — model-profile-worker.ts (Child 07 Task 8 — long-task repair)
//
// Off-main-thread seam for the exact-profile computation. The Run 27 T8
// benchmark (`.omp/rlm/scratch/run27-t8-benchmark.json`) measured the uncached
// synchronous exact-profile computation as a single ~800ms main-thread block
// over the 4,120-Observation acceptance corpus, with three atomic
// imported-module calls each independently exceeding the 50ms long-task
// ceiling (selectProfileObservations 57ms, aggregateFamilyEvidence 98ms,
// computePairedEvidence 153ms). Those calls live in non-owned pure modules,
// so loader-level chunked yielding cannot break them. The only owned-path fix
// is to offload the entire synchronous computation to a Web Worker.
//
// This module is the smallest such seam:
//
//  - `computeProfileSync(input)` — the pure, deterministic, permutation-
//    invariant synchronous computation extracted verbatim from the loader
//    (model-profile-loader.ts lines 128-432 + 475-484 + 532-619). It performs
//    NO repository I/O and NO network access; every byte of input is supplied
//    by the caller. Exported so tests and the worker entry share one truth
//    function.
//
//  - `runProfileComputation(input, options)` — dispatches the computation to a
//    module Web Worker (`new Worker(new URL(..., import.meta.url))`) when the
//    Worker constructor is available, and falls back to an in-process call to
//    `computeProfileSync` only when no Worker can be constructed (Node /
//    happy-dom vitest, SSR). Supports progress events and cancellation
//    (AbortSignal / `cancel()`). The worker is terminated on cancel or after
//    the result is received, so an orphaned computation cannot keep consuming
//    a CPU core.
//
//  - Worker entry — when this file is loaded as a DedicatedWorkerGlobalScope,
//    `self.onmessage` runs `computeProfileSync` and posts progress + result
//    back. The bootstrap is guarded so importing this module on a main thread
//    or in Node never installs the handler.
//
// Determinism / authority contract (spec §8, §11):
//  - Worker input/output is deterministic and permutation-invariant (the pure
//    modules already guarantee input-order independence; verified by the T8
//    benchmark over seeds 101/202/303).
//  - The worker holds NO state and is never a second truth source. It is
//    derived and disposable: every output is recomputable from the supplied
//    input, which the loader assembles fresh from canonical repositories.
//  - The input is keyed (by the loader) by query fingerprint + source-evidence
//    revision + aggregation-rule version + uncertainty-rule version /
//    assignment digest, all of which are carried in the input. The worker
//    itself does not cache.
//  - Worker output is omitted from archive authority: the loader returns a
//    `ProfileData` view model exactly as before; nothing about the canonical
//    stores changes.
// =============================================================================

import type {
  EligibilityDecision,
  ModelConfigurationSnapshot,
  Observation,
} from "../evidence/evidence-types";
import type {
  TaskFacetAnnotation,
  TaskFamilyAssignment,
  TaskFamilyRelation,
} from "../tasks/task-types";
import {
  QUERY_AGGREGATION_RULE_VERSION,
  QUERY_ELIGIBILITY_RULE_VERSION,
  QUERY_UNCERTAINTY_RULE_VERSION,
  fingerprintModelEvidenceQuery,
  type ModelEvidenceQuery,
} from "./model-evidence-query";
import {
  selectProfileObservations,
  type ProfileEvidenceCorpus,
} from "./profile-observation-selection";
import { buildCoverageSummary } from "./coverage-summary";
import {
  aggregateFamilyEvidence,
  buildJudgedScoreCohortId,
  buildPassRateCohortId,
} from "./family-aggregation";
import {
  resolveUncertaintyUnits,
  partitionUncertaintyUnits,
  type PartitionInput,
} from "./uncertainty-unit-resolver";
import { bootstrapTaskClusters } from "./cluster-bootstrap";
import {
  buildProfileClaim,
  formatBoundaryRef,
  type ClaimResult,
  type ClaimSentence,
} from "./profile-claims";
import { computePairedEvidence } from "./paired-comparison";
import type { ProfileData, ProfileIdentity } from "../../workspaces/models/ModelEvidenceProfile";
import type { CohortInterval } from "../../workspaces/models/CohortBlock";
import type { VerifiedOutcome } from "../../workspaces/models/VerifiedOutcomes";
import type { EvidenceTableRow } from "../../workspaces/models/EvidenceTable";
import type { ComparatorCandidate } from "../../workspaces/models/ComparatorPicker";
import type { PairedComparatorIdentity } from "../../workspaces/models/PairedComparisonSection";
import type { VersionStatus } from "../../workspaces/models/VersionStatusChip";

/**
 * Keep the worker dependency graph free of React-bearing workspace modules.
 * Importing ModelList.tsx here makes Vite inject the React Refresh runtime into
 * the module Worker, where `window` does not exist. The profile computation only
 * needs this small deterministic formatter, so keep its worker copy local.
 */
function formatModelWindow(from: number, to: number): string {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return "window unavailable";
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const start = new Date(from);
  const end = new Date(to);
  const startMonth = months[start.getUTCMonth()] ?? "—";
  const endMonth = months[end.getUTCMonth()] ?? "—";
  const startYear = start.getUTCFullYear();
  const endYear = end.getUTCFullYear();
  if (startYear === endYear && start.getUTCMonth() === end.getUTCMonth()) {
    return `${startMonth} ${startYear}`;
  }
  if (startYear === endYear) return `${startMonth}–${endMonth} ${startYear}`;
  return `${startMonth} ${startYear}–${endMonth} ${endYear}`;
}

// --- Input / output contract --------------------------------------------------

/**
 * Pre-comparator corpus bundle for one model configuration. The loader
 * assembles this from canonical repositories (async I/O, out of the
 * computation budget per spec §11) and hands it to the worker; the worker
 * performs no I/O of its own.
 */
export interface ProfileWorkerSubjectCorpus {
  readonly config: ModelConfigurationSnapshot;
  readonly observations: readonly Observation[];
  readonly decisions: readonly EligibilityDecision[];
  readonly facets: readonly TaskFacetAnnotation[];
}

/**
 * Optional comparator corpus for the paired-comparison section. Loaded by the
 * loader on the main thread (async I/O) when a comparator is selected.
 */
export interface ProfileWorkerComparatorCorpus {
  readonly config: ModelConfigurationSnapshot;
  readonly observations: readonly Observation[];
  readonly decisions: readonly EligibilityDecision[];
}

/**
 * Deterministic, serializable input to the exact-profile computation.
 *
 * Keyed by query fingerprint + rule versions + assignment digest (carried
 * inside the input via the corpus and the rule-version constants the worker
 * pins), so a caller can decide whether two inputs are equivalent without
 * re-running the computation. The worker itself does not cache.
 */
export interface ProfileWorkerInput {
  readonly modelConfigurationId: string;
  readonly subjectCorpus: ProfileWorkerSubjectCorpus;
  /** familyId → display name, resolved by the loader from `listTaskFamilies()`. */
  readonly familyNames: Readonly<Record<string, string>>;
  readonly taskFamilyRelations: readonly TaskFamilyRelation[];
  readonly taskFamilyAssignments: readonly TaskFamilyAssignment[];
  /** Pre-computed comparator candidates (loader-computed via async I/O). */
  readonly candidates: readonly ComparatorCandidate[];
  readonly selectedComparatorId: string | null;
  readonly comparatorCorpus: ProfileWorkerComparatorCorpus | null;
  /**
   * Captured by the loader at dispatch time so the worker is fully
   * deterministic and its output is byte-identical to the in-process path for
   * the same instant. Defaults to `Date.now()` when omitted (worker entry).
   */
  readonly generatedAt: number;
}

/** Result of the synchronous exact-profile computation. */
export type ProfileWorkerOutput = ProfileData;

/** Progress phase emitted by the worker before each major synchronous step. */
export type ProfileWorkerPhase =
  | "select"
  | "coverage"
  | "aggregate"
  | "uncertainty"
  | "family_loop"
  | "evidence_rows"
  | "paired"
  | "identity"
  | "done";

export interface ProfileWorkerProgress {
  readonly kind: "progress";
  readonly phase: ProfileWorkerPhase;
}

export interface ProfileWorkerResultMessage {
  readonly kind: "result";
  readonly data: ProfileWorkerOutput;
}

export interface ProfileWorkerErrorMessage {
  readonly kind: "error";
  readonly message: string;
}

export type ProfileWorkerOutboundMessage =
  ProfileWorkerProgress | ProfileWorkerResultMessage | ProfileWorkerErrorMessage;

// --- Helpers (mirrors model-profile-loader.ts private helpers) ----------------

function completenessToVersionStatus(
  completeness: ModelConfigurationSnapshot["identityCompleteness"],
): VersionStatus {
  if (completeness === "rolling_alias") return "rolling_alias";
  if (completeness === "partial") return "partial_identity";
  return "exact";
}

function missingDimensionFor(config: ModelConfigurationSnapshot): string | undefined {
  if (config.identityCompleteness === "partial") {
    if (config.resolvedVersion === null) return "no resolved version";
    if (config.resolvedModel === null) return "no resolved model";
    return "incomplete identity";
  }
  return undefined;
}

// --- Synchronous exact-profile computation ------------------------------------

/**
 * Pure, deterministic, permutation-invariant exact-profile computation.
 *
 * Faithful extraction of `model-profile-loader.ts` lines 128-432 + 475-484 +
 * 532-619 (the synchronous block measured by the T8 benchmark). Performs no
 * I/O. Exported so the worker entry and tests share one truth function; the
 * loader delegates here via `runProfileComputation`.
 */
export function computeProfileSync(input: ProfileWorkerInput): ProfileWorkerOutput {
  const {
    modelConfigurationId,
    subjectCorpus,
    familyNames,
    taskFamilyRelations,
    taskFamilyAssignments,
    candidates,
    selectedComparatorId,
    comparatorCorpus,
    generatedAt,
  } = input;

  const config = subjectCorpus.config;
  const observations = subjectCorpus.observations;
  const decisions = subjectCorpus.decisions;
  const facets = subjectCorpus.facets;

  const corpus: ProfileEvidenceCorpus = {
    configurations: [config],
    observations,
    decisions,
    facets,
  };

  const query: ModelEvidenceQuery = {
    respondent: { kind: "model_configuration", modelConfigurationId },
    observedFrom: null,
    observedTo: null,
    taskFamilyIds: [],
    facetFilters: [],
    evidenceClasses: [],
    allowedUses: [],
    comparabilityCohortIds: [],
    sourceKinds: [],
    rubricRefs: [],
    evaluatorFilters: [],
    includeUnknownVersion: true,
    eligibilityRuleVersion: QUERY_ELIGIBILITY_RULE_VERSION,
    aggregationRuleVersion: QUERY_AGGREGATION_RULE_VERSION,
    uncertaintyRuleVersion: QUERY_UNCERTAINTY_RULE_VERSION,
  };

  const queryFingerprint = fingerprintModelEvidenceQuery(query);
  const selection = selectProfileObservations(query, corpus);
  if (selection.kind !== "exact") {
    // Mirrors the loader: a non-exact selection yields no profile. The worker
    // returns a sentinel via the dispatcher; here we throw so the dispatcher
    // can convert it to a null result uniformly.
    throw new ProfileSelectionNotExactError();
  }

  const coverage = buildCoverageSummary(selection, corpus);
  const familyResult = aggregateFamilyEvidence(selection);
  const overallUncertainty = resolveUncertaintyUnits({
    selection,
    query,
    taskFamilyRelations,
    taskFamilyAssignments,
  });

  const claims: ClaimResult[] = [];
  const narrativeSentences: ClaimSentence[] = [];
  const cohortIntervals: Record<string, CohortInterval> = {};
  const verifiedOutcomes: VerifiedOutcome[] = [];

  for (const family of familyResult.families) {
    const familyAreaLabel = family.familyId
      ? (familyNames[family.familyId] ?? family.familyId)
      : "general";

    // 1. Judged scores
    for (const scoreMetric of family.judgedScores) {
      const cohortCells = selection.cells.filter(
        (c) =>
          c.active.observation.taskFamilyId === family.familyId &&
          buildJudgedScoreCohortId(c.active.observation, selection.modelConfiguration) ===
            scoreMetric.cohortId,
      );
      const cohortRows: PartitionInput[] = cohortCells.map((c) => ({
        protocolFingerprint: c.active.observation.protocolFingerprint,
        sourceResultId: c.active.observation.sourceResultId,
        taskId: c.taskId,
        observationId: c.active.observation.id,
        cellKey: c.cellKey,
      }));
      const cohortResolution = partitionUncertaintyUnits(
        cohortRows,
        taskFamilyRelations,
        taskFamilyAssignments,
      );

      const unitValues = new Map<string, number>();
      for (const unit of cohortResolution.units) {
        const unitCells = cohortCells.filter((c) => unit.cellKeys.includes(c.cellKey));
        const scores: number[] = [];
        for (const cell of unitCells) {
          if (cell.active.observation.outcome.overallScore !== null) {
            scores.push(cell.active.observation.outcome.overallScore);
          }
        }
        if (scores.length > 0) {
          unitValues.set(unit.unitId, scores.reduce((a, b) => a + b, 0) / scores.length);
        }
      }

      const boot = bootstrapTaskClusters({
        resolution: cohortResolution,
        config: {
          queryFingerprint,
          aggregationRuleVersion: QUERY_AGGREGATION_RULE_VERSION,
          uncertaintyRuleVersion: QUERY_UNCERTAINTY_RULE_VERSION,
          assignmentDigest: cohortResolution.assignmentDigest,
        },
        unitValues,
      });

      const interval: CohortInterval = boot.interval
        ? {
            state: "available",
            level: boot.interval.level * 100,
            lower: boot.interval.lower,
            upper: boot.interval.upper,
            unitCount: boot.unitCount,
            unitKind: cohortResolution.units[0]?.kind ?? "task_identity",
          }
        : {
            state: "insufficient",
            unitCount: boot.unitCount,
            unitKind: cohortResolution.units[0]?.kind ?? "task_identity",
            reason:
              boot.coverageState.state === "insufficient"
                ? boot.coverageState.reason
                : "No bootstrap interval is available.",
          };
      const intervalKey = `${family.familyId ?? ""}:${scoreMetric.cohortId}`;
      cohortIntervals[intervalKey] = interval;
      cohortIntervals[scoreMetric.cohortId] = interval;

      const boundary = null;

      const pointVal =
        scoreMetric.value.state === "available" || scoreMetric.value.state === "limited"
          ? scoreMetric.value.value
          : null;

      const claim = buildProfileClaim({
        metric: "judged_score",
        cohortId: scoreMetric.cohortId,
        areaLabel: familyAreaLabel,
        pointValue: pointVal,
        eligibleInterval: boot.interval
          ? { lower: boot.interval.lower, upper: boot.interval.upper }
          : null,
        resolvedUnitCount: boot.unitCount,
        boundary,
        hasUndisclosedMissingness: false,
        cohortDisagreement: false,
        incompatibleCohortCount: family.judgedScores.length,
        verifiedFailures: 0,
        verifiedTotal: family.taskCount,
      });
      claims.push(claim);
      narrativeSentences.push(...claim.sentences);
    }

    // 2. Pass rates
    for (const passMetric of family.passRates) {
      const cohortCells = selection.cells.filter(
        (c) =>
          c.active.observation.taskFamilyId === family.familyId &&
          buildPassRateCohortId(c.active.observation, selection.modelConfiguration) ===
            passMetric.cohortId,
      );
      const cohortRows: PartitionInput[] = cohortCells.map((c) => ({
        protocolFingerprint: c.active.observation.protocolFingerprint,
        sourceResultId: c.active.observation.sourceResultId,
        taskId: c.taskId,
        observationId: c.active.observation.id,
        cellKey: c.cellKey,
      }));
      const cohortResolution = partitionUncertaintyUnits(
        cohortRows,
        taskFamilyRelations,
        taskFamilyAssignments,
      );

      const unitValues = new Map<string, number>();
      for (const unit of cohortResolution.units) {
        const unitCells = cohortCells.filter((c) => unit.cellKeys.includes(c.cellKey));
        const passes: number[] = [];
        for (const cell of unitCells) {
          if (cell.active.observation.outcome.verifierPassed !== null) {
            passes.push(cell.active.observation.outcome.verifierPassed ? 1 : 0);
          }
        }
        if (passes.length > 0) {
          unitValues.set(unit.unitId, passes.reduce((a, b) => a + b, 0) / passes.length);
        }
      }

      const boot = bootstrapTaskClusters({
        resolution: cohortResolution,
        config: {
          queryFingerprint,
          aggregationRuleVersion: QUERY_AGGREGATION_RULE_VERSION,
          uncertaintyRuleVersion: QUERY_UNCERTAINTY_RULE_VERSION,
          assignmentDigest: cohortResolution.assignmentDigest,
        },
        unitValues,
      });

      const interval: CohortInterval = boot.interval
        ? {
            state: "available",
            level: boot.interval.level * 100,
            lower: boot.interval.lower,
            upper: boot.interval.upper,
            unitCount: boot.unitCount,
            unitKind: cohortResolution.units[0]?.kind ?? "task_identity",
          }
        : {
            state: "insufficient",
            unitCount: boot.unitCount,
            unitKind: cohortResolution.units[0]?.kind ?? "task_identity",
            reason:
              boot.coverageState.state === "insufficient"
                ? boot.coverageState.reason
                : "No bootstrap interval is available.",
          };
      const intervalKey = `${family.familyId ?? ""}:${passMetric.cohortId}`;
      cohortIntervals[intervalKey] = interval;
      cohortIntervals[passMetric.cohortId] = interval;

      const verifierRef =
        cohortCells.find((c) => c.active.observation.verifierSnapshot?.verifierRef)?.active
          .observation.verifierSnapshot?.verifierRef ?? null;
      const boundary = null;

      const pointVal =
        passMetric.value.state === "available" || passMetric.value.state === "limited"
          ? passMetric.value.value
          : null;

      let failures = 0;
      let totalVerified = 0;
      for (const c of cohortCells) {
        if (c.active.observation.outcome.verifierPassed !== null) {
          totalVerified += 1;
          if (!c.active.observation.outcome.verifierPassed) failures += 1;
        }
      }

      const claim = buildProfileClaim({
        metric: "pass_rate",
        cohortId: passMetric.cohortId,
        areaLabel: familyAreaLabel,
        pointValue: pointVal,
        eligibleInterval: boot.interval
          ? { lower: boot.interval.lower, upper: boot.interval.upper }
          : null,
        resolvedUnitCount: boot.unitCount,
        boundary,
        hasUndisclosedMissingness: false,
        cohortDisagreement: false,
        incompatibleCohortCount: family.passRates.length,
        verifiedFailures: failures,
        verifiedTotal: totalVerified || family.taskCount,
      });
      claims.push(claim);
      narrativeSentences.push(...claim.sentences);

      if (totalVerified > 0) {
        const passedCount = totalVerified - failures;
        verifiedOutcomes.push({
          cohortRef: verifierRef ? formatBoundaryRef(verifierRef) : passMetric.cohortId.slice(0, 8),
          verifiedTasks: `${passedCount} of ${totalVerified}`,
          passRate: passMetric.value,
          interval,
          failureCount: failures,
          resolverVersion: `v${cohortResolution.uncertaintyRuleVersion}`,
          digest: cohortResolution.assignmentDigest.slice(0, 8),
        });
      }
    }
  }

  const evidenceRows: EvidenceTableRow[] = selection.cells.map((cell) => {
    const obs = cell.active.observation;
    const dec = cell.active.decision;
    const outcomeText = obs.verifierSnapshot
      ? obs.outcome.verifierPassed === true
        ? "pass"
        : obs.outcome.verifierPassed === false
          ? "fail"
          : "unavailable"
      : obs.outcome.overallScore !== null
        ? String(obs.outcome.overallScore)
        : "unavailable";

    const isSupporting =
      obs.outcome.verifierPassed === true ||
      (obs.outcome.overallScore !== null && obs.outcome.overallScore >= 70);
    const isContradicting =
      obs.outcome.verifierPassed === false ||
      (obs.outcome.overallScore !== null && obs.outcome.overallScore < 70);

    return {
      observationId: obs.id,
      taskId: obs.taskId,
      version: obs.taskVersion,
      instanceId: obs.taskInstanceId,
      familyId: obs.taskFamilyId ?? undefined,
      familyName: obs.taskFamilyId
        ? (familyNames[obs.taskFamilyId] ?? obs.taskFamilyId)
        : undefined,
      outcome: outcomeText,
      evidenceClass: dec ? dec.evidenceClass : "exploratory",
      eligibility: dec ? dec.status : "provisional",
      eligibilityReason: dec?.reasonCodes?.join(", "),
      observedDate: new Date(obs.observedAt).toISOString().slice(0, 10),
      sourceKind: obs.sourceKind,
      supporting: isSupporting,
      contradicting: isContradicting,
    };
  });

  let pairedComparator: PairedComparatorIdentity | null = null;
  let pairedResult: ReturnType<typeof computePairedEvidence> | null = null;
  if (selectedComparatorId && comparatorCorpus) {
    const compConfig = comparatorCorpus.config;
    const compCorpus: ProfileEvidenceCorpus = {
      configurations: [compConfig],
      observations: comparatorCorpus.observations,
      decisions: comparatorCorpus.decisions,
      facets,
    };
    const compQuery: ModelEvidenceQuery = {
      ...query,
      respondent: {
        kind: "model_configuration",
        modelConfigurationId: selectedComparatorId,
      },
    };
    const compSelection = selectProfileObservations(compQuery, compCorpus);
    if (compSelection.kind === "exact") {
      pairedResult = computePairedEvidence({
        selectionA: selection,
        selectionB: compSelection,
        options: { metric: "judged_score" },
        uncertainty: {
          taskFamilyAssignments,
          taskFamilyRelations,
          queryFingerprint,
        },
      });
      pairedComparator = {
        id: compConfig.id,
        providerId: compConfig.providerId,
        requestedModel: compConfig.requestedModel,
        resolvedVersion: compConfig.resolvedVersion,
      };
    }
  }

  const rubricMap = new Map<string, number>();
  for (const obs of observations) {
    if (obs.rubricRef) {
      const ref = formatBoundaryRef(obs.rubricRef);
      rubricMap.set(ref, (rubricMap.get(ref) ?? 0) + 1);
    }
  }
  const protocolCohorts = [...rubricMap.entries()].map(([ref, count]) => ({
    ref,
    taskCount: count,
  }));

  const evalMap = new Map<
    string,
    { kind: string; modelRef?: string; instructionDigest?: string; count: number }
  >();
  for (const obs of observations) {
    const key = `${obs.evaluatorSnapshot.kind}:${obs.evaluatorSnapshot.model ?? ""}:${obs.evaluatorSnapshot.instructionDigest ?? ""}`;
    const existing = evalMap.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      evalMap.set(key, {
        kind: obs.evaluatorSnapshot.kind,
        modelRef: obs.evaluatorSnapshot.model ?? undefined,
        instructionDigest: obs.evaluatorSnapshot.instructionDigest ?? undefined,
        count: 1,
      });
    }
  }
  const evaluatorConfigs = [...evalMap.values()].map((e) => ({
    kind: e.kind,
    modelRef: e.modelRef,
    instructionDigest: e.instructionDigest,
    observationCount: e.count,
  }));

  const status = completenessToVersionStatus(config.identityCompleteness);
  const windowText = formatModelWindow(config.observedFrom, config.observedTo);
  const missingDim = missingDimensionFor(config);

  const identity: ProfileIdentity = {
    modelConfigurationId: config.id,
    providerId: config.providerId,
    requestedModel: config.requestedModel,
    resolvedModel: config.resolvedModel,
    resolvedVersion: config.resolvedVersion,
    versionStatus: status,
    versionWindow: status === "rolling_alias" ? windowText : undefined,
    missingDimension: missingDim,
    reasoningRequested: config.reasoningRequested,
    reasoningEffective: config.reasoningEffective,
    toolScaffoldSignature: config.toolScaffoldSignature,
    observedFrom: config.observedFrom,
    observedTo: config.observedTo,
    rubricVersionCount: rubricMap.size,
    evaluatorConfigCount: evalMap.size,
    comparabilityCohortCount:
      coverage.comparabilityCohorts.state === "available" ? coverage.comparabilityCohorts.value : 0,
    queryFingerprint,
    generatedAt,
    aggregationRuleVersion: QUERY_AGGREGATION_RULE_VERSION,
    uncertaintyRuleVersion: QUERY_UNCERTAINTY_RULE_VERSION,
    eligibilityRuleVersion: QUERY_ELIGIBILITY_RULE_VERSION,
  };

  const isExploratoryOnly =
    (coverage.inMetricsEvidenceClassSplit.comparable ?? 0) === 0 &&
    (coverage.inMetricsEvidenceClassSplit.verified ?? 0) === 0 &&
    (coverage.inMetricsEvidenceClassSplit.benchmark_anchor ?? 0) === 0;

  const isUnknownVersion =
    config.identityCompleteness === "rolling_alias" || config.resolvedVersion === null;
  const isInsufficientEverywhere = overallUncertainty.unitCount < 5;

  const limitations: { code: string; reason: string }[] = [];
  if (isUnknownVersion) {
    limitations.push({
      code: "unknown_version",
      reason: "Provider version was not reported for observations from this window.",
    });
  }
  for (const [code, count] of Object.entries(coverage.limitationReasons)) {
    if (count !== undefined && count > 0) {
      limitations.push({
        code,
        reason: `${count} observation(s) carry limitation reason ${code}.`,
      });
    }
  }

  const profileData: ProfileData = {
    identity,
    coverage,
    narrative: narrativeSentences.slice(0, 5),
    claims,
    families: familyResult.families,
    familyNames,
    cohortIntervals,
    verifiedOutcomes,
    evidenceRows,
    protocolCohorts,
    evaluatorConfigs,
    uncertaintyReceipt: {
      unitKind: overallUncertainty.units[0]?.kind ?? "task_identity",
      resolvedCount: overallUncertainty.unitCount,
      fallbackAssumption:
        overallUncertainty.fallbackAssumption ??
        "Task identity is the explicit fallback assumption.",
      resolverVersion: `v${overallUncertainty.uncertaintyRuleVersion}`,
      aggregationVersion: `v${familyResult.aggregationRuleVersion}`,
      seed: queryFingerprint.slice(0, 16),
      assignmentDigest: overallUncertainty.assignmentDigest,
      resamples: 2000,
    },
    limitations,
    isExploratoryOnly,
    isUnknownVersion,
    isInsufficientEverywhere,
    paired: {
      candidates,
      comparator: pairedComparator,
      result: pairedResult,
    },
  };

  return profileData;
}

/**
 * Sentinel thrown by `computeProfileSync` when the selection is not `exact`,
 * mirroring the loader's `return null` path. The dispatcher converts it to a
 * `null` result so the loader's `Promise<ProfileData | null>` contract holds.
 */
export class ProfileSelectionNotExactError extends Error {
  constructor() {
    super("Profile selection was not exact; no profile can be computed.");
    this.name = "ProfileSelectionNotExactError";
  }
}

// --- Dispatcher ---------------------------------------------------------------

/**
 * Options for dispatching the exact-profile computation.
 */
export interface RunProfileComputationOptions {
  /**
   * Abort the computation. When aborted, the worker (if any) is terminated and
   * the returned promise rejects with an `AbortError`; the heavy synchronous
   * compute does not continue consuming a core.
   */
  readonly signal?: AbortSignal;
  /** Receives progress phase events from the worker. */
  readonly onProgress?: (phase: ProfileWorkerPhase) => void;
  /**
   * Test/SSR override: force the in-process fallback (`computeProfileSync` on
   * the current thread) even when a `Worker` constructor is present. Used by
   * tests that need the compute to run synchronously on the calling thread.
   */
  readonly forceInProcess?: boolean;
}

/**
 * Dispatches the exact-profile computation to a Web Worker when constructible,
 * falling back to an in-process call only when no Worker can be built (Node /
 * happy-dom vitest, SSR) or `forceInProcess` is set.
 *
 * Returns the loader's `Promise<ProfileData | null>` contract: resolves to
 * `null` when the selection is not exact (the worker's
 * `ProfileSelectionNotExactError` is converted here), and rejects on abort or
 * unexpected worker error.
 */
export function runProfileComputation(
  input: ProfileWorkerInput,
  options: RunProfileComputationOptions = {},
): Promise<ProfileData | null> {
  const { signal, onProgress, forceInProcess } = options;

  if (signal?.aborted) {
    return Promise.reject(new AbortError("Profile computation aborted before start."));
  }

  const workerConstructor = pickWorkerConstructor();

  if (forceInProcess || workerConstructor === null) {
    // No Worker constructible (Node / happy-dom / SSR) or forced in-process.
    // The compute runs on the calling thread; progress is emitted synchronously
    // so progress/cancel observers still fire in a deterministic order.
    try {
      if (onProgress) {
        for (const phase of PROGRESS_PHASES) onProgress(phase);
      }
      const data = computeProfileSync(input);
      return Promise.resolve(data);
    } catch (err) {
      if (err instanceof ProfileSelectionNotExactError) return Promise.resolve(null);
      return Promise.reject(err);
    }
  }

  return runInWorker(workerConstructor, input, { signal, onProgress });
}

const PROGRESS_PHASES: readonly ProfileWorkerPhase[] = [
  "select",
  "coverage",
  "aggregate",
  "uncertainty",
  "family_loop",
  "evidence_rows",
  "paired",
  "identity",
  "done",
];

interface WorkerLike {
  new (
    scriptURL: URL,
    options?: { type?: "classic" | "module" },
  ): {
    postMessage(message: unknown): void;
    terminate(): void;
    addEventListener(type: "message", listener: (ev: MessageEvent) => void): void;
    addEventListener(type: "error", listener: (ev: ErrorEvent) => void): void;
    removeEventListener(type: "message", listener: (ev: MessageEvent) => void): void;
    removeEventListener(type: "error", listener: (ev: ErrorEvent) => void): void;
  };
}

function pickWorkerConstructor(): WorkerLike | null {
  // Only construct a Worker from a Vite-resolvable module URL when the global
  // Worker constructor exists AND import.meta.url is a real http/blob URL the
  // browser can fetch. In Node/happy-dom vitest there is no Worker constructor
  // (or it cannot resolve import.meta.url), so we fall back to in-process.
  const globalScope = globalThis as unknown as { Worker?: unknown };
  const ctor = globalScope.Worker;
  if (typeof ctor !== "function") return null;
  return ctor as WorkerLike;
}

function workerScriptUrl(): URL {
  return new URL("./model-profile-worker.ts", import.meta.url);
}

function runInWorker(
  WorkerCtor: WorkerLike,
  input: ProfileWorkerInput,
  options: {
    signal?: AbortSignal;
    onProgress?: (phase: ProfileWorkerPhase) => void;
  },
): Promise<ProfileData | null> {
  return new Promise<ProfileData | null>((resolve, reject) => {
    let worker: InstanceType<WorkerLike> | null = null;
    let settled = false;

    const cleanup = () => {
      if (worker) {
        try {
          worker.terminate();
        } catch {
          /* ignore */
        }
        worker = null;
      }
      if (options.signal) {
        options.signal.removeEventListener("abort", onAbort);
      }
    };

    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new AbortError("Profile computation aborted."));
    };

    if (options.signal) {
      options.signal.addEventListener("abort", onAbort);
      if (options.signal.aborted) {
        onAbort();
        return;
      }
    }

    const onMessage = (ev: MessageEvent) => {
      const msg = ev.data as ProfileWorkerOutboundMessage | undefined;
      if (!msg || typeof msg !== "object" || typeof msg.kind !== "string") return;
      if (msg.kind === "progress") {
        options.onProgress?.(msg.phase);
        return;
      }
      if (msg.kind === "result") {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(msg.data);
        return;
      }
      if (msg.kind === "error") {
        if (settled) return;
        settled = true;
        cleanup();
        if (msg.message === PROFILE_SELECTION_NOT_EXACT_MARKER) {
          resolve(null);
          return;
        }
        reject(new Error(msg.message));
        return;
      }
    };

    const onError = (ev: ErrorEvent) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(ev.message || "Profile worker error."));
    };

    try {
      worker = new WorkerCtor(workerScriptUrl(), { type: "module" });
    } catch (err) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
      return;
    }

    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    worker.postMessage(input);
  });
}

/** Abort error class so callers can distinguish cancellation from failure. */
export class AbortError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AbortError";
  }
}

const PROFILE_SELECTION_NOT_EXACT_MARKER = "__profile_selection_not_exact__";

// --- Worker entry (DedicatedWorkerGlobalScope only) ---------------------------
//
// Guarded so importing this module on a main thread, in Node, or in happy-dom
// never installs the handler. In a real browser worker, `Window` is undefined
// and `self.postMessage` is a function, so the bootstrap runs.
interface WorkerGlobalScopeLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (ev: MessageEvent) => void): void;
}

declare const self: WorkerGlobalScopeLike;

function isDedicatedWorkerScope(): boolean {
  if (typeof self === "undefined") return false;
  if (typeof Window !== "undefined" && self instanceof Window) return false;
  const s = self as unknown as { postMessage?: unknown; addEventListener?: unknown };
  return typeof s.postMessage === "function" && typeof s.addEventListener === "function";
}

if (isDedicatedWorkerScope()) {
  self.addEventListener("message", (ev: MessageEvent) => {
    const input = ev.data as ProfileWorkerInput | undefined;
    if (!input || typeof input !== "object" || typeof input.modelConfigurationId !== "string") {
      return;
    }
    try {
      const data = computeProfileSync(input);
      const out: ProfileWorkerResultMessage = { kind: "result", data };
      self.postMessage(out);
    } catch (err) {
      if (err instanceof ProfileSelectionNotExactError) {
        const out: ProfileWorkerErrorMessage = {
          kind: "error",
          message: PROFILE_SELECTION_NOT_EXACT_MARKER,
        };
        self.postMessage(out);
        return;
      }
      const out: ProfileWorkerErrorMessage = {
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      };
      self.postMessage(out);
    }
  });
}
