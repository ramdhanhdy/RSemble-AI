// =============================================================================
// RSemble AI — model-profile-loader.ts (Child 07 Milestone C Repair + Task 8)
//
// Real local-only route loader and orchestrator for:
//  - /models/:modelConfigurationId (profile dossier view model)
//  - /models/:modelConfigurationId/evidence/:observationId (drilldown view model)
//  - Paired comparison computation on comparator selection
//
// Loads exact configuration evidence from local repositories (EvidenceRepository,
// TaskRepository) and invokes the pure T4–T7 modules to build immutable view
// models. Zero network/provider egress.
//
// Task 8 (Run 27 T8 long-task repair): the heavy synchronous exact-profile
// computation (selectProfileObservations → coverage → aggregation →
// uncertainty → bootstrap → claims → evidence rows → paired comparison) is
// offloaded to a Web Worker via `runProfileComputation` so the ~800ms
// main-thread block measured over the 4,120-Observation acceptance corpus no
// longer violates the 50ms long-task ceiling. `loadProfileData` keeps its
// existing `Promise<ProfileData | null>` contract; the offload is transparent
// to Milestone C callers. Repository I/O stays on the main thread (out of the
// computation budget per spec §11); only the synchronous compute moves off.
// =============================================================================

import type { EvidenceRepository } from "../../lib/persistence/evidence-repository";
import type {
  TaskFamilyRelationRepository,
  TaskRepository,
} from "../../lib/persistence/task-repository";
import type { EligibilityDecision } from "../../lib/evidence/evidence-types";
import { formatBoundaryRef } from "../../lib/model-profiles/profile-claims";
import type { PairedComparisonResult } from "../../lib/model-profiles/paired-comparison";
import {
  runProfileComputation,
  runPairedComparisonComputation,
  type ComparatorWorkerInput,
  type ProfileWorkerInput,
  type ProfileWorkerPhase,
} from "../../lib/model-profiles/model-profile-worker";
import type { ProfileData } from "./ModelEvidenceProfile";
import type { ComparatorCandidate } from "./ComparatorPicker";
import type { PairedComparatorIdentity } from "./PairedComparisonSection";
import type { ObservationDrilldownData, ObservationOutcomeView } from "./ObservationDrilldown";

function supportsTaskFamilyRelations(
  repo: TaskRepository,
): repo is TaskRepository & TaskFamilyRelationRepository {
  return "listTaskFamilyRelations" in repo && typeof repo.listTaskFamilyRelations === "function";
}

export interface LoadProfileDataOptions {
  modelConfigurationId: string;
  evidenceRepo: EvidenceRepository;
  taskRepo?: TaskRepository | null;
  selectedComparatorId?: string | null;
  /**
   * Aborts the offloaded computation. When aborted, the worker is terminated
   * and the returned promise rejects with an `AbortError`; the heavy sync
   * compute does not keep consuming a core. Optional — existing callers that
   * omit it behave exactly as before.
   */
  signal?: AbortSignal;
  /** Optional progress observer for the offloaded computation phases. */
  onProgress?: (phase: ProfileWorkerPhase) => void;
}

/**
 * Assembles the deterministic, serializable input for the offloaded
 * exact-profile computation. Performs all repository I/O on the main thread
 * (out of the computation budget per spec §11) and returns `null` when the
 * model configuration does not exist. Exported so the loader's focused
 * integration tests can prove the worker compute output is identical to the
 * loader path for the same input.
 */
export async function assembleProfileWorkerInput(
  options: LoadProfileDataOptions,
): Promise<ProfileWorkerInput | null> {
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

  let comparatorCorpus: ProfileWorkerInput["comparatorCorpus"] = null;
  if (selectedComparatorId) {
    const compConfig = allConfigs.find((c) => c.id === selectedComparatorId);
    if (compConfig) {
      const compObs = await evidenceRepo.listObservationsByModelConfiguration(selectedComparatorId);
      const compDecs = (
        await Promise.all(compObs.map((o) => evidenceRepo.getActiveDecision(o.id)))
      ).filter((d): d is EligibilityDecision => d !== null);
      comparatorCorpus = {
        config: compConfig,
        observations: compObs,
        decisions: compDecs,
      };
    }
  }

  return {
    modelConfigurationId,
    subjectCorpus: { config, observations, decisions, facets },
    familyNames,
    taskFamilyRelations,
    taskFamilyAssignments,
    candidates,
    selectedComparatorId: selectedComparatorId ?? null,
    comparatorCorpus,
    generatedAt: Date.now(),
  };
}

/**
 * Loads the exact-profile dossier view model for one model configuration.
 *
 * Repository I/O runs on the main thread; the heavy synchronous exact-profile
 * computation is offloaded to a Web Worker via `runProfileComputation` (Task 8
 * long-task repair). The `Promise<ProfileData | null>` contract is unchanged:
 * resolves to `null` when the configuration is missing or the selection is not
 * exact, and rejects on abort/worker error. Existing Milestone C callers need
 * no edit.
 */
export async function loadProfileData(
  options: LoadProfileDataOptions,
): Promise<ProfileData | null> {
  const input = await assembleProfileWorkerInput(options);
  if (!input) {
    return null;
  }
  return runProfileComputation(input, {
    signal: options.signal,
    onProgress: options.onProgress,
  });
}

export interface LoadPairedComparisonOptions {
  subjectConfigurationId: string;
  comparatorId: string;
  evidenceRepo: EvidenceRepository;
  taskRepo?: TaskRepository | null;
  /**
   * Aborts the offloaded comparator computation. When aborted, the worker is
   * terminated and the returned promise rejects with an `AbortError`.
   */
  signal?: AbortSignal;
  /** Optional progress observer for the offloaded computation phases. */
  onProgress?: (phase: ProfileWorkerPhase) => void;
}

/**
 * Assembles the deterministic, serializable input for the offloaded paired
 * comparison. Performs only repository I/O on the main thread (out of the
 * computation budget per spec §11); the selection and paired-evidence
 * statistics run inside the Worker via `computeComparatorSync`. Returns
 * `null` when either configuration does not exist.
 */
export async function assembleComparatorWorkerInput(
  options: LoadPairedComparisonOptions,
): Promise<ComparatorWorkerInput | null> {
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

  return {
    subjectConfigurationId,
    comparatorId,
    configA,
    configB,
    observationsA: obsA,
    observationsB: obsB,
    decisionsA: decsA,
    decisionsB: decsB,
    facets,
    taskFamilyAssignments,
    taskFamilyRelations,
  };
}

/**
 * Loads the paired comparison for one comparator selection. Repository I/O
 * stays on the main thread; the heavy synchronous selection +
 * `computePairedEvidence` statistics are offloaded to the Worker via
 * `runPairedComparisonComputation` (Run 28 T8 long-task repair). Resolves to
 * `null` when a configuration is missing or either selection is not exact,
 * and rejects on abort/worker error.
 */
export async function loadPairedComparison(
  options: LoadPairedComparisonOptions,
): Promise<{ comparator: PairedComparatorIdentity; result: PairedComparisonResult } | null> {
  const input = await assembleComparatorWorkerInput(options);
  if (!input) {
    return null;
  }
  return runPairedComparisonComputation(input, {
    signal: options.signal,
    onProgress: options.onProgress,
  });
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
