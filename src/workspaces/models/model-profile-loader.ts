// =============================================================================
// RSemble AI — model-profile-loader.ts (Child 07 Milestone C Repair)
//
// Real local-only route loader and orchestrator for:
//  - /models/:modelConfigurationId (profile dossier view model)
//  - /models/:modelConfigurationId/evidence/:observationId (drilldown view model)
//  - Paired comparison computation on comparator selection
//
// Loads exact configuration evidence from local repositories (EvidenceRepository,
// TaskRepository) and invokes the pure T4–T7 modules (selection, coverage,
// aggregation, uncertainty partitioning, bootstrap, claims, paired comparison)
// to build immutable view models. Zero network/provider egress.
// =============================================================================

import type { EvidenceRepository } from "../../lib/persistence/evidence-repository";
import type {
  TaskFamilyRelationRepository,
  TaskRepository,
} from "../../lib/persistence/task-repository";
import type {
  EligibilityDecision,
  IdentityCompleteness,
  ModelConfigurationSnapshot,
} from "../../lib/evidence/evidence-types";
import {
  QUERY_AGGREGATION_RULE_VERSION,
  QUERY_ELIGIBILITY_RULE_VERSION,
  QUERY_UNCERTAINTY_RULE_VERSION,
  fingerprintModelEvidenceQuery,
  type ModelEvidenceQuery,
} from "../../lib/model-profiles/model-evidence-query";
import {
  selectProfileObservations,
  type ProfileEvidenceCorpus,
} from "../../lib/model-profiles/profile-observation-selection";
import { buildCoverageSummary } from "../../lib/model-profiles/coverage-summary";
import {
  aggregateFamilyEvidence,
  buildJudgedScoreCohortId,
  buildPassRateCohortId,
} from "../../lib/model-profiles/family-aggregation";
import {
  resolveUncertaintyUnits,
  partitionUncertaintyUnits,
  type PartitionInput,
} from "../../lib/model-profiles/uncertainty-unit-resolver";
import { bootstrapTaskClusters } from "../../lib/model-profiles/cluster-bootstrap";
import {
  buildProfileClaim,
  formatBoundaryRef,
  type ClaimResult,
  type ClaimSentence,
} from "../../lib/model-profiles/profile-claims";
import { computePairedEvidence } from "../../lib/model-profiles/paired-comparison";
import type { ProfileData, ProfileIdentity } from "./ModelEvidenceProfile";
import type { CohortInterval } from "./CohortBlock";
import type { VerifiedOutcome } from "./VerifiedOutcomes";
import type { EvidenceTableRow } from "./EvidenceTable";
import type { ComparatorCandidate } from "./ComparatorPicker";
import type { PairedComparatorIdentity } from "./PairedComparisonSection";
import type { ObservationDrilldownData, ObservationOutcomeView } from "./ObservationDrilldown";
import type { VersionStatus } from "./VersionStatusChip";
import { formatModelWindow } from "./ModelList";

function supportsTaskFamilyRelations(
  repo: TaskRepository,
): repo is TaskRepository & TaskFamilyRelationRepository {
  return "listTaskFamilyRelations" in repo && typeof repo.listTaskFamilyRelations === "function";
}

function completenessToVersionStatus(completeness: IdentityCompleteness): VersionStatus {
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

export interface LoadProfileDataOptions {
  modelConfigurationId: string;
  evidenceRepo: EvidenceRepository;
  taskRepo?: TaskRepository | null;
  selectedComparatorId?: string | null;
}

export async function loadProfileData(
  options: LoadProfileDataOptions,
): Promise<ProfileData | null> {
  const { modelConfigurationId, evidenceRepo, taskRepo, selectedComparatorId } = options;

  const config = await evidenceRepo.getModelConfiguration(modelConfigurationId);
  if (!config) {
    return null;
  }

  const observations =
    await evidenceRepo.listObservationsByModelConfiguration(modelConfigurationId);
  const decisions = (
    await Promise.all(observations.map((obs) => evidenceRepo.getActiveDecision(obs.id)))
  ).filter((d): d is EligibilityDecision => d !== null);

  const families = taskRepo ? await taskRepo.listTaskFamilies() : [];
  const familyNames: Record<string, string> = {};
  for (const fam of families) {
    familyNames[fam.id] = fam.name;
  }
  const taskFamilyRelations =
    taskRepo && supportsTaskFamilyRelations(taskRepo)
      ? await taskRepo.listTaskFamilyRelations()
      : [];
  const taskIds = [...new Set(observations.map((o) => o.taskId))];

  const taskFamilyAssignments = taskRepo
    ? (await Promise.all(taskIds.map((tid) => taskRepo.listTaskFamilyAssignments(tid)))).flat()
    : [];

  const facets = taskRepo
    ? (await Promise.all(taskIds.map((tid) => taskRepo.listTaskFacetAnnotations(tid)))).flat()
    : [];

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
    return null;
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

  const allConfigs = await evidenceRepo.listModelConfigurations();
  const otherConfigs = allConfigs.filter((c) => c.id !== modelConfigurationId);
  const candidates: ComparatorCandidate[] = [];
  for (const c of otherConfigs) {
    const otherObs = await evidenceRepo.listObservationsByModelConfiguration(c.id);
    const otherTaskIds = new Set(otherObs.map((o) => o.taskId));
    const sharedCount = taskIds.filter((t) => otherTaskIds.has(t)).length;
    candidates.push({
      id: c.id,
      label: `${c.providerId} · ${c.requestedModel}`,
      sharedTaskCount: sharedCount,
    });
  }
  candidates.sort(
    (a, b) => b.sharedTaskCount - a.sharedTaskCount || a.label.localeCompare(b.label),
  );

  let pairedComparator: PairedComparatorIdentity | null = null;
  let pairedResult: ReturnType<typeof computePairedEvidence> | null = null;
  if (selectedComparatorId) {
    const compConfig = allConfigs.find((c) => c.id === selectedComparatorId);
    if (compConfig) {
      const compObs = await evidenceRepo.listObservationsByModelConfiguration(selectedComparatorId);
      const compDecs = (
        await Promise.all(compObs.map((o) => evidenceRepo.getActiveDecision(o.id)))
      ).filter((d): d is EligibilityDecision => d !== null);
      const compCorpus: ProfileEvidenceCorpus = {
        configurations: [compConfig],
        observations: compObs,
        decisions: compDecs,
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
    generatedAt: Date.now(),
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

export interface LoadPairedComparisonOptions {
  subjectConfigurationId: string;
  comparatorId: string;
  evidenceRepo: EvidenceRepository;
  taskRepo?: TaskRepository | null;
}

export async function loadPairedComparison(options: LoadPairedComparisonOptions): Promise<{
  comparator: PairedComparatorIdentity;
  result: ReturnType<typeof computePairedEvidence>;
} | null> {
  const { subjectConfigurationId, comparatorId, evidenceRepo, taskRepo } = options;

  const configA = await evidenceRepo.getModelConfiguration(subjectConfigurationId);
  const configB = await evidenceRepo.getModelConfiguration(comparatorId);
  if (!configA || !configB) return null;

  const obsA = await evidenceRepo.listObservationsByModelConfiguration(subjectConfigurationId);
  const obsB = await evidenceRepo.listObservationsByModelConfiguration(comparatorId);

  const decsA = (await Promise.all(obsA.map((o) => evidenceRepo.getActiveDecision(o.id)))).filter(
    (d): d is EligibilityDecision => d !== null,
  );
  const decsB = (await Promise.all(obsB.map((o) => evidenceRepo.getActiveDecision(o.id)))).filter(
    (d): d is EligibilityDecision => d !== null,
  );

  const taskIds = [...new Set([...obsA.map((o) => o.taskId), ...obsB.map((o) => o.taskId)])];
  const taskFamilyAssignments = taskRepo
    ? (await Promise.all(taskIds.map((tid) => taskRepo.listTaskFamilyAssignments(tid)))).flat()
    : [];
  const taskFamilyRelations =
    taskRepo && supportsTaskFamilyRelations(taskRepo)
      ? await taskRepo.listTaskFamilyRelations()
      : [];
  const facets = taskRepo
    ? (await Promise.all(taskIds.map((tid) => taskRepo.listTaskFacetAnnotations(tid)))).flat()
    : [];

  const corpusA: ProfileEvidenceCorpus = {
    configurations: [configA],
    observations: obsA,
    decisions: decsA,
    facets,
  };
  const corpusB: ProfileEvidenceCorpus = {
    configurations: [configB],
    observations: obsB,
    decisions: decsB,
    facets,
  };

  const queryA: ModelEvidenceQuery = {
    respondent: { kind: "model_configuration", modelConfigurationId: subjectConfigurationId },
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

  const queryB: ModelEvidenceQuery = {
    ...queryA,
    respondent: { kind: "model_configuration", modelConfigurationId: comparatorId },
  };

  const selectionA = selectProfileObservations(queryA, corpusA);
  const selectionB = selectProfileObservations(queryB, corpusB);

  if (selectionA.kind !== "exact" || selectionB.kind !== "exact") {
    return null;
  }

  const result = computePairedEvidence({
    selectionA,
    selectionB,
    options: { metric: "judged_score" },
    uncertainty: {
      taskFamilyAssignments,
      taskFamilyRelations,
      queryFingerprint: fingerprintModelEvidenceQuery(queryA),
    },
  });

  const comparator: PairedComparatorIdentity = {
    id: configB.id,
    providerId: configB.providerId,
    requestedModel: configB.requestedModel,
    resolvedVersion: configB.resolvedVersion,
  };

  return { comparator, result };
}

export interface LoadObservationDrilldownOptions {
  observationId: string;
  modelConfigurationId?: string;
  evidenceRepo: EvidenceRepository;
  taskRepo?: TaskRepository | null;
}

export async function loadObservationDrilldown(
  options: LoadObservationDrilldownOptions,
): Promise<ObservationDrilldownData | null> {
  const { observationId, modelConfigurationId, evidenceRepo, taskRepo } = options;

  const obs = await evidenceRepo.getObservation(observationId);
  if (!obs) return null;

  if (modelConfigurationId && obs.modelConfigurationId !== modelConfigurationId) {
    return null;
  }

  const config = await evidenceRepo.getModelConfiguration(obs.modelConfigurationId);
  const decision = await evidenceRepo.getActiveDecision(obs.id);

  let familyName: string | undefined;
  if (obs.taskFamilyId && taskRepo) {
    const families = await taskRepo.listTaskFamilies();
    const found = families.find((f) => f.id === obs.taskFamilyId);
    if (found) familyName = found.name;
  }

  const outcome: ObservationOutcomeView = obs.verifierSnapshot
    ? {
        kind: "verifier",
        passed: obs.outcome.verifierPassed,
        verifierRef: obs.verifierSnapshot.verifierRef
          ? formatBoundaryRef(obs.verifierSnapshot.verifierRef)
          : null,
        verifierDigest: obs.verifierSnapshot.configurationDigest,
      }
    : {
        kind: "judged",
        score: obs.outcome.overallScore,
        rubricRef: obs.rubricRef ? formatBoundaryRef(obs.rubricRef) : null,
        cohortId: decision?.comparabilityCohortId ?? null,
      };

  const data: ObservationDrilldownData = {
    observationId: obs.id,
    observedAt: obs.observedAt,
    evidenceClass: decision ? decision.evidenceClass : "exploratory",
    eligibility: decision ? decision.status : "provisional",
    eligibilityReasons: decision?.reasonCodes ?? [],
    taskId: obs.taskId,
    taskVersion: obs.taskVersion,
    taskInstanceId: obs.taskInstanceId,
    familyId: obs.taskFamilyId,
    familyName: familyName ?? obs.taskFamilyId ?? undefined,
    outcome,
    replicateLabel: null,
    evaluator: {
      kind: obs.evaluatorSnapshot.kind,
      model: obs.evaluatorSnapshot.model ?? undefined,
      instructionDigest: obs.evaluatorSnapshot.instructionDigest ?? undefined,
    },
    assessmentLineage: "active",
    sourceKind: obs.sourceKind,
    sourceResultId: obs.sourceResultId,
    sourceHref:
      obs.sourceKind === "comparison"
        ? `/compare/results/${obs.sourceResultId}`
        : `/evaluations/results/${obs.sourceResultId}`,
    confidenceLabel: obs.evaluatorSnapshot.kind === "human_authorized" ? "authorized" : "model",
    recordHref: `/records/observation/${obs.id}`,
    configurationId: obs.modelConfigurationId,
    configurationLabel: config
      ? `${config.providerId} · ${config.requestedModel}`
      : obs.modelConfigurationId,
  };

  return data;
}
