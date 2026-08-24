// =============================================================================
// RSemble AI — Observation derivation service + post-commit local queue
// (spec §4, §11.1, §13; implementation plan Task 8)
//
// Derivation runs strictly AFTER the source transaction commits:
//
//  - the source run and experiment records are read-only inputs; a derivation
//    failure never rolls back or mutates the exact result and never calls a
//    provider;
//  - indexing errors become classified error markers on the per-source job
//    row (recoverable; reindex may repair later);
//  - every Observation is an immutable reference/index over the source — raw
//    candidate output, judge instructions, and full rationale never enter it;
//  - insertion is idempotent under the six-part source key, so duplicate
//    commit events and retries are exactly-once;
//  - the child-02 Fusion Study EvaluationObservation (fusionObservations
//    store) is a distinct study-owned entity and is NEVER an input here — this
//    module has no fusion dependency (spec §4).
//
// Canonical Task identity resolution is a seam: the default resolver reads
// the materialization-projected taskVersionRef from the frozen experiment
// snapshot and derives a content-addressed instance reference from the exact
// evaluation input facts — it never invents provenance. Unresolved identity
// yields an explicit indexed limitation, never a fabricated Observation.
// =============================================================================

import type { EvidenceRepository } from "../persistence/evidence-repository";
import {
  EVIDENCE_RULE_VERSION,
  classifyEligibility,
  type VerifierState,
} from "./evidence-eligibility";
import type { ExperimentRecord, EvaluationTask } from "../evaluations/evaluation-types";
import type { RunRecordV2, PersistedCandidate } from "../persistence/run-types";
import type { VersionRef } from "../tasks/task-types";
import {
  type AssessmentRef,
  type EligibilityDecision,
  type EvaluatorSnapshot,
  type ExecutedVerifierOutcome,
  type ModelConfigurationSnapshot,
  type Observation,
  type ObservationOutcome,
  type ObservationSourceKind,
  type VerifierSnapshot,
  OBSERVATION_SCHEMA_VERSION,
} from "./evidence-types";
import type { TaskVersionRef } from "../evaluations/task-set-types";
import {
  canonicalizeModelConfiguration,
  type ModelConfigurationResult,
} from "./model-configuration";
import { selectObservationSources } from "./observation-source";
import { buildComparabilityCohort } from "./comparability-cohort";
import { observationIdFor } from "./evidence-validation";
import { hashArtifactContent, canonicalJsonString } from "../evaluations/protocol-fingerprint";
import { classifyStorageError } from "../persistence/database";

// --- Source resolution seam -----------------------------------------------------

/** Narrow read-only view over the evaluation source records. */
export interface EvaluationSourceResolver {
  getExperiment(experimentId: string): Promise<ExperimentRecord | null>;
  getRun(runId: string): Promise<RunRecordV2 | null>;
}

// --- Canonical Task identity seam ------------------------------------------------

export interface ResolvedTaskIdentity {
  taskId: string;
  taskVersion: number;
  taskInstanceId: string;
  taskFamilyId: string | null;
  /** The concrete Task Instance input is reconstructable from stored facts. */
  inputComplete: boolean;
}

export interface TaskIdentityContext {
  experiment: ExperimentRecord;
  /** Experiment (suite-scoped) task id of the committed run. */
  taskId: string;
  run: RunRecordV2;
}

export type TaskIdentityResolver = (ctx: TaskIdentityContext) => ResolvedTaskIdentity | null;

/**
 * Default identity resolution over stored facts only:
 *  - canonical Task + version come from the frozen snapshot's
 *    materialization-projected `taskVersionRef` (child 03 scoped identity);
 *  - the instance reference is content-addressed over the exact evaluation
 *    input facts (canonical task version + prompt + system prompt). It is a
 *    reference, not a canonical TaskInstance record — nothing is invented;
 *  - no ref → null (unresolved canonical identity: the caller records an
 *    explicit indexed limitation, never a fabricated Observation).
 */
export function defaultTaskIdentityResolver(ctx: TaskIdentityContext): ResolvedTaskIdentity | null {
  const task = ctx.experiment.snapshot.tasks.find((t) => t.id === ctx.taskId);
  const ref = (task as (EvaluationTask & { taskVersionRef?: TaskVersionRef }) | undefined)
    ?.taskVersionRef;
  if (!ref || typeof ref.taskId !== "string" || ref.taskId.length === 0) return null;
  if (!Number.isInteger(ref.version) || ref.version <= 0) return null;
  const prompt = ctx.run.task.prompt.trim();
  const systemPrompt = ctx.run.task.systemPrompt.trim();
  const inputComplete = prompt.length > 0;
  const taskInstanceId = `inst:${hashArtifactContent(
    canonicalJsonString([ref.taskId, ref.version, prompt, systemPrompt]),
  )}`;
  return {
    taskId: ref.taskId,
    taskVersion: ref.version,
    taskInstanceId,
    taskFamilyId: null,
    inputComplete,
  };
}

// --- Persisted verifier-outcome resolution seam ----------------------------------

export interface VerifierOutcomeResolution {
  /** Execution lineage (run ids) of the derivation source. Outcomes outside
   *  this lineage never apply to the derivation (exact source scoping). */
  lineageRunIds: string[];
}

/**
 * Resolve persisted executed verifier outcomes for a derivation source. The
 * resolver is local evidence resolution ONLY: it reads a persisted store and
 * never executes a verifier or calls a provider. When no outcomes exist the
 * resolver returns [] and every cell stays `not_declared` — pass/fail is never
 * inferred (spec §3.4, §7.3).
 */
export type VerifierOutcomeResolver = (
  input: VerifierOutcomeResolution,
) => Promise<ExecutedVerifierOutcome[]>;

/** Repository-backed resolver: outcomes scoped to the exact source lineage. */
export function createRepositoryVerifierResolver(
  evidenceRepo: EvidenceRepository,
): VerifierOutcomeResolver {
  return (input) => evidenceRepo.listVerifierOutcomes({ runIds: input.lineageRunIds });
}

// --- Model-configuration fact resolution seam ------------------------------------

export interface ModelConfigurationFacts {
  resolvedModel: string | null;
  resolvedVersion: string | null;
}

export interface ModelConfigurationCellContext {
  run: RunRecordV2;
  candidate: PersistedCandidate;
}

/**
 * Resolve executed model identity facts for one cell from stored records. The
 * default is unknown (null): resolved identity is never inferred from the
 * requested model. A verifier execution path may supply provider-confirmed
 * facts; without them cells classify conservatively.
 */
export type ModelConfigurationResolver = (
  ctx: ModelConfigurationCellContext,
) => ModelConfigurationFacts;

export const defaultModelConfigurationResolver: ModelConfigurationResolver = () => ({
  resolvedModel: null,
  resolvedVersion: null,
});

/**
 * Production resolver: read only stored provider-confirmed identity facts
 * attached to the candidate. Requested model/slug is never used as resolved
 * identity. An incoherent version-without-model is treated as unknown.
 */
export function createStoredModelConfigurationResolver(): ModelConfigurationResolver {
  return ({ candidate }) => {
    const stored = (
      candidate as PersistedCandidate & {
        resolvedIdentity?: {
          resolvedModel?: string | null;
          resolvedVersion?: string | null;
        };
      }
    ).resolvedIdentity;
    if (stored === undefined || stored === null || typeof stored !== "object") {
      return { resolvedModel: null, resolvedVersion: null };
    }
    const resolvedModel =
      typeof stored.resolvedModel === "string" && stored.resolvedModel.trim().length > 0
        ? stored.resolvedModel.trim()
        : null;
    const resolvedVersion =
      typeof stored.resolvedVersion === "string" && stored.resolvedVersion.trim().length > 0
        ? stored.resolvedVersion.trim()
        : null;
    if (resolvedVersion !== null && resolvedModel === null) {
      return { resolvedModel: null, resolvedVersion: null };
    }
    return { resolvedModel, resolvedVersion };
  };
}

// --- Derivation ------------------------------------------------------------------

export interface DerivationSourceRef {
  sourceKind: ObservationSourceKind;
  sourceResultId: string;
  sourceRevision: number;
}

export interface DerivationDeps {
  evidenceRepo: EvidenceRepository;
  resolver: EvaluationSourceResolver;
  /** Canonical Task identity seam; defaults to stored-fact resolution. */
  identity?: TaskIdentityResolver;
  /** Persisted verifier-outcome resolution for the source lineage; local
   *  evidence resolution only — never reads fusion stores, never executes a
   *  verifier, never calls a provider. Missing outcomes stay not_declared. */
  resolveVerifierOutcomes?: VerifierOutcomeResolver;
  /** Executed model identity facts; defaults to unknown (never inferred). */
  resolveModelConfiguration?: ModelConfigurationResolver;
  now?: () => number;
}

export interface DerivationResult {
  status: "complete" | "error";
  observationCount: number;
  gapCount: number;
  limitationCount: number;
  integrityIssues: string[];
  errorKind: string | null;
  errorMessage: string | null;
}

function failed(kind: string, message: string): DerivationResult {
  return {
    status: "error",
    observationCount: 0,
    gapCount: 0,
    limitationCount: 0,
    integrityIssues: [],
    errorKind: kind,
    errorMessage: message,
  };
}

/**
 * Derive idempotent observations + eligibility decisions for one committed
 * evaluation source (a terminal run of an experiment task). Pure reads over
 * the source records; every write goes through the evidence repository.
 * Failures are reported in the result — this function never mutates the
 * source and never throws for indexing problems (storage errors included).
 */
export async function deriveObservationsForSource(
  deps: DerivationDeps,
  ref: DerivationSourceRef,
): Promise<DerivationResult> {
  try {
    if (ref.sourceKind !== "evaluation") {
      return failed(
        "source-not-evaluation",
        "Derivation accepts evaluation sources only; comparison sources go through backfill inventory.",
      );
    }
    const run = await deps.resolver.getRun(ref.sourceResultId);
    if (!run) {
      return failed("source-missing", `Run ${ref.sourceResultId} could not be resolved.`);
    }
    if (run.source.kind !== "experiment") {
      return failed(
        "source-not-evaluation",
        `Run ${run.id} is not an experiment execution source.`,
      );
    }
    const experiment = await deps.resolver.getExperiment(run.source.experimentId);
    if (!experiment) {
      return failed(
        "source-unresolvable",
        `Experiment ${run.source.experimentId} could not be resolved.`,
      );
    }
    const sourceTaskId = run.source.taskId;
    const taskState = experiment.tasks.find((t) => t.taskId === sourceTaskId);
    if (!taskState) {
      return failed(
        "source-unresolvable",
        `Task ${sourceTaskId} is not part of experiment ${experiment.id}.`,
      );
    }

    // Preload the task's execution lineage so source selection gets a sync
    // resolver over real stored records.
    const lineageRunIds = [
      ...new Set(taskState.attempts.map((a) => a.runId).filter((id): id is string => id !== null)),
    ];
    const lineageRuns = new Map<string, RunRecordV2 | null>();
    for (const id of lineageRunIds) {
      lineageRuns.set(id, id === run.id ? run : await deps.resolver.getRun(id));
    }
    const resolveRunRecord = (runId: string): RunRecordV2 | null => lineageRuns.get(runId) ?? null;

    // Persisted verifier outcomes for the exact source lineage (local read).
    const verifierOutcomes = deps.resolveVerifierOutcomes
      ? await deps.resolveVerifierOutcomes({ lineageRunIds })
      : [];

    const selection = selectObservationSources({
      experiment,
      taskId: run.source.taskId,
      resolveRunRecord,
      verifierOutcomes,
    });
    if (!selection.ok) {
      return failed("source-corrupt", selection.reason);
    }

    const identityResolver = deps.identity ?? defaultTaskIdentityResolver;
    const identity = identityResolver({ experiment, taskId: run.source.taskId, run });

    const limitations: string[] = [];
    const integrityIssues = [...selection.selection.integrityIssues];
    let observationCount = 0;
    const gapCount = selection.selection.gaps.length;
    const observedAt = run.completedAt ?? run.updatedAt;

    // Explicit gaps for uncovered roster cells and failed candidates.
    for (const gap of selection.selection.gaps) {
      limitations.push(`cell:${gap.modelKey}:gap:${gap.reason}`);
    }

    if (!identity) {
      // Unresolved canonical Task identity: every cell is an explicit indexed
      // limitation — legacy/imported provenance is never fabricated.
      for (const cell of selection.selection.cells) {
        limitations.push(`cell:${cell.modelKey}:canonical_task_unresolved`);
      }
    } else {
      const sourceCorrupt = selection.selection.integrityIssues.length > 0;
      const fullTaskSetCoverage = selection.selection.gaps.length === 0;
      for (const cell of selection.selection.cells) {
        const candidate = run.candidates.find((c) => c.candidateId === cell.candidateId);
        const cellOutcome = deriveCellObservation({
          run,
          experiment,
          identity,
          cell: { ...cell, candidate },
          observedAt,
          sourceCorrupt,
          fullTaskSetCoverage,
          resolveModelConfiguration:
            deps.resolveModelConfiguration ?? defaultModelConfigurationResolver,
        });
        if (cellOutcome.limitation !== null) {
          limitations.push(cellOutcome.limitation);
          continue;
        }
        await deps.evidenceRepo.putModelConfiguration(cellOutcome.snapshot);
        await deps.evidenceRepo.putObservation(cellOutcome.observation);
        await deps.evidenceRepo.putDecision(cellOutcome.decision);
        observationCount += 1;
      }
    }

    return {
      status: "complete",
      observationCount,
      gapCount,
      limitationCount: limitations.length,
      integrityIssues,
      errorKind: null,
      errorMessage: null,
    };
  } catch (err) {
    const classified = classifyStorageError(err);
    return failed(classified.kind, classified.message);
  }
}

// --- Cell assembly ---------------------------------------------------------------

interface DeriveCellInput {
  run: RunRecordV2;
  experiment: ExperimentRecord;
  identity: ResolvedTaskIdentity;
  cell: {
    sourceTaskCellId: string;
    modelKey: string;
    candidateId: string;
    candidateAttemptId: string;
    provenance: string;
    reusedOutput: boolean;
    judgeAssessment: {
      judgeAttemptId: string;
      providerId: string;
      model: string;
      blindLabelMapping: Record<string, string>;
      candidateAttemptIdsByCandidateId: Record<string, string>;
    } | null;
    verifier: ExecutedVerifierOutcome | null;
    candidate: PersistedCandidate | undefined;
  };
  observedAt: number;
  /** The source selection reported integrity issues (source corruption). */
  sourceCorrupt: boolean;
  /** Every declared roster cell has evidence. */
  fullTaskSetCoverage: boolean;
  /** Executed model identity facts for this cell (default: unknown). */
  resolveModelConfiguration: ModelConfigurationResolver;
}

type DeriveCellResult =
  | { limitation: string }
  | {
      limitation: null;
      observation: Observation;
      decision: EligibilityDecision;
      snapshot: ModelConfigurationSnapshot;
    };

function findJudgeAttempt(
  run: RunRecordV2,
  judgeAttemptId: string,
): { providerId: string; model: string; instruction: string } | null {
  const attempt = run.judge.attempts.find((a) => a.attemptId === judgeAttemptId);
  if (!attempt) return null;
  return { providerId: attempt.providerId, model: attempt.model, instruction: attempt.instruction };
}

function criterionValuesOf(
  run: RunRecordV2,
  candidateId: string,
): ObservationOutcome["criterionValues"] {
  const evaluation = run.judge.report?.evaluationsById[candidateId];
  if (!evaluation) return [];
  const values: ObservationOutcome["criterionValues"] = [];
  for (const score of evaluation.criterionScores) {
    if (score.kind === "binary" && typeof score.value === "boolean") {
      values.push({ criterionId: score.criterionId, value: score.value });
    } else if (typeof score.score === "number") {
      values.push({ criterionId: score.criterionId, value: score.score });
    }
  }
  return values;
}
const REUSE_PROVENANCES: Record<string, true> = {
  reused: true,
  repair_reused: true,
  roster_extension_reused: true,
};

function deriveCellObservation(input: DeriveCellInput): DeriveCellResult {
  const { run, experiment, identity, cell, observedAt } = input;
  const modelKey = cell.modelKey;
  if (!cell.judgeAssessment) {
    return { limitation: `cell:${modelKey}:assessment_missing_or_failed` };
  }
  if (!cell.candidate) {
    return { limitation: `cell:${modelKey}:candidate_unresolvable` };
  }
  if (run.source.kind !== "experiment") {
    return { limitation: `cell:${modelKey}:source_not_evaluation` };
  }
  const judgeAttempt = findJudgeAttempt(run, cell.judgeAssessment.judgeAttemptId);
  if (!judgeAttempt) {
    return { limitation: `cell:${modelKey}:assessment_unresolvable` };
  }

  // Model configuration from stored facts only — unknown resolved versions
  // stay unknown (spec §3.1). The executed identity facts come from the
  // resolution seam; nothing is inferred from the requested model.
  const reasoning = run.reasoning?.candidates[cell.candidateId];
  const facts = input.resolveModelConfiguration({ run, candidate: cell.candidate });
  const configResult: ModelConfigurationResult = canonicalizeModelConfiguration({
    providerId: cell.candidate.providerId,
    requestedModel: cell.candidate.model,
    resolvedModel: facts.resolvedModel,
    resolvedVersion: facts.resolvedVersion,
    reasoningRequested: reasoning?.requested ?? null,
    reasoningEffective: reasoning?.effective ?? null,
    toolScaffoldSignature: null,
    runtimeSettings: {},
    observedAt,
  });
  if (!configResult.ok) {
    return { limitation: `cell:${modelKey}:model_configuration_incomplete` };
  }
  const snapshot = configResult.snapshot;

  const rubricRef: VersionRef | null = run.evaluation.profile
    ? { id: run.evaluation.profile.id, version: run.evaluation.profile.version }
    : null;

  const evaluatorSnapshot: EvaluatorSnapshot = {
    kind: "model_judge",
    providerId: judgeAttempt.providerId,
    model: judgeAttempt.model,
    resolvedVersion: null,
    instructionDigest: hashArtifactContent(judgeAttempt.instruction),
    reasoningEffort: null,
    toolScaffoldSignature: null,
  };

  // Verifier contract declared by the frozen snapshot task, when present.
  const sourceTaskId = run.source.taskId;
  const snapshotTask = experiment.snapshot.tasks.find((t) => t.id === sourceTaskId);
  const verification = (
    snapshotTask as (EvaluationTask & { verification?: { kind: string } }) | undefined
  )?.verification;
  const hasVerifierContract = verification !== undefined && verification.kind !== "none";
  // The snapshot preserves the EXACT executed contract: kind, configuration
  // digest, and frozen contract ref come from the persisted outcome, never
  // from the declared contract alone (spec §3.4, §7.3).
  const verifierSnapshot: VerifierSnapshot | null = cell.verifier
    ? {
        verifierRef: cell.verifier.verifierRef,
        kind: cell.verifier.kind,
        configurationDigest: cell.verifier.configurationDigest,
      }
    : null;
  const verifierState: VerifierState = cell.verifier
    ? cell.verifier.passed
      ? "passed"
      : "failed"
    : "not_declared";
  const assessmentRef: AssessmentRef = {
    judgeAttemptId: cell.judgeAssessment.judgeAttemptId,
    judgeProviderId: cell.judgeAssessment.providerId,
    judgeModel: cell.judgeAssessment.model,
    blindLabelMapping: cell.judgeAssessment.blindLabelMapping,
    candidateAttemptIdsByCandidateId: cell.judgeAssessment.candidateAttemptIdsByCandidateId,
    rubricRef,
    verifierRef: cell.verifier?.verifierRef ?? null,
    verifierOutcome: cell.verifier
      ? {
          taskId: cell.verifier.taskId,
          modelKey: cell.verifier.modelKey,
          passed: cell.verifier.passed,
          executedAt: cell.verifier.executedAt,
        }
      : null,
  };

  const outcome: ObservationOutcome = {
    judgeAccepted: true,
    overallScore: run.judge.report?.evaluationsById[cell.candidateId]?.overallScore ?? null,
    criterionValues: criterionValuesOf(run, cell.candidateId),
    verifierPassed: cell.verifier ? cell.verifier.passed : null,
  };

  const observation: Observation = {
    id: "",
    sourceKind: "evaluation",
    sourceResultId: run.id,
    executionLineageId: `eval:${experiment.id}:${run.source.taskId}`,
    runId: run.id,
    sourceTaskCellId: cell.sourceTaskCellId,
    taskId: identity.taskId,
    taskVersion: identity.taskVersion,
    taskInstanceId: identity.taskInstanceId,
    taskFamilyId: identity.taskFamilyId,
    modelConfigurationId: snapshot.id,
    candidateAttemptId: cell.candidateAttemptId,
    assessmentRef,
    protocolFingerprint: run.source.protocolFingerprint,
    rubricRef,
    evaluatorSnapshot,
    verifierSnapshot,
    outcome,
    observedAt,
    observationSchemaVersion: OBSERVATION_SCHEMA_VERSION,
  };
  observation.id = observationIdFor(observation);

  const decision: EligibilityDecision = classifyEligibility({
    observation,
    canonicalTaskResolved: true,
    candidateInputComplete: identity.inputComplete,
    candidateSelectedCompleted: true,
    assessmentSelectedCompleted: true,
    verifierState,
    // Frozen iff the persisted outcome ran under a versioned verifier
    // contract (spec §7.3) — never hardcoded, never inferred from the
    // declared contract alone.
    frozenVerifierVersion: cell.verifier ? cell.verifier.verifierRef !== null : false,
    humanVerificationAuthorized: false,
    rubricResolved: rubricRef !== null,
    protocolComplete: true,
    configurationState: snapshot.identityCompleteness,
    fullPairCoverage: true,
    fullTaskSetCoverage: input.fullTaskSetCoverage,
    reusedCandidateAssessment: REUSE_PROVENANCES[cell.provenance] === true,
    undeclaredRepeat: false,
    sourceCorrupt: input.sourceCorrupt,
    sourceLegacyLimited: false,
    anchorDesignated: false,
    comparabilityCohortId: buildComparabilityCohort({
      taskId: identity.taskId,
      taskVersion: identity.taskVersion,
      taskInstanceId: identity.taskInstanceId,
      rubricRef,
      verifierRef: cell.verifier?.verifierRef ?? null,
      verifierKind: cell.verifier
        ? cell.verifier.kind
        : hasVerifierContract
          ? (verification!.kind as VerifierSnapshot["kind"])
          : null,
      verifierConfigurationDigest: cell.verifier?.configurationDigest ?? null,
      protocolFingerprint: observation.protocolFingerprint,
      responseMode: null,
      evaluator: evaluatorSnapshot,
      reasoningRequested: snapshot.reasoningRequested,
      reasoningEffective: snapshot.reasoningEffective,
      toolScaffoldSignature: snapshot.toolScaffoldSignature,
      providerId: snapshot.providerId,
      resolvedModel: snapshot.resolvedModel ?? snapshot.requestedModel,
      resolvedVersion: snapshot.resolvedVersion,
    }).id,
    decidedAt: observedAt,
  });

  return { limitation: null, observation, decision, snapshot };
}

// --- Post-commit local queue -------------------------------------------------------

export interface DerivationQueueOptions {
  scheduleDelayMs?: number;
  /**
   * Running jobs whose marker is at or past this age (updatedAt +
   * staleRunningTimeoutMs <= now) are considered stranded by a crashed tab
   * and recovered to "queued". Fresh markers (active owners) are never
   * stolen. Default 2 minutes.
   */
  staleRunningTimeoutMs?: number;
  /**
   * Cadence at which the running marker is refreshed while deriving, so an
   * active owner stays fresh past the stale timeout. Default 30 seconds.
   */
  heartbeatMs?: number;
  /**
   * Exclusive claim owner identity for this queue instance. Every tab/runtime
   * must use a distinct owner; defaults to a unique id per queue instance so
   * concurrent queues can never both claim the same source.
   */
  ownerId?: string;
}

export interface DrainSummary {
  processed: number;
  completed: number;
  failed: number;
}

export interface DerivationQueue {
  /**
   * Enqueue post-commit derivation for a committed evaluation run. Never
   * rejects: containment is absolute so the source commit path is unaffected.
   * Duplicate events at a fixed revision are no-ops (exactly-once).
   */
  enqueue(ref: DerivationSourceRef): Promise<void>;
  /** Process every queued job locally until the queue is empty. */
  drain(): Promise<DrainSummary>;
  dispose(): void;
}

/**
 * Post-commit derivation job queue over the shared evidence stores. Every
 * queue instance drains the same queued index jobs, so any tab with a live
 * queue can process jobs enqueued by any tab. Each queue carries a unique
 * claim owner: a queued source is claimed atomically and exclusively
 * (owner-scoped claim/heartbeat/finalize), so concurrent drains derive a
 * source exactly once per revision — idempotent six-part key writes are a
 * backstop, not the exclusivity mechanism. Enqueue runs after the source
 * committed and never inside the paid-execution owner or the experiment
 * unit of work.
 */
export function createDerivationQueue(
  deps: DerivationDeps,
  options: DerivationQueueOptions = {},
): DerivationQueue {
  const now = deps.now ?? (() => Date.now());
  const scheduleDelayMs = options.scheduleDelayMs ?? 0;
  const staleRunningTimeoutMs = options.staleRunningTimeoutMs ?? 120_000;
  const heartbeatMs = options.heartbeatMs ?? 30_000;
  let disposed = false;
  let chain: Promise<void> = Promise.resolve();
  const ownerId = options.ownerId ?? uniqueOwnerId();

  /** Re-queue jobs stranded in "running" by a crashed tab (exact once). */
  async function recoverStale(): Promise<void> {
    try {
      await deps.evidenceRepo.recoverStaleIndexJobs({
        staleTimeoutMs: staleRunningTimeoutMs,
        now: now(),
      });
    } catch {
      // Contained: the next drain/enqueue pass retries recovery.
    }
  }

  async function processOne(): Promise<{ handled: true; ok: boolean } | { handled: false }> {
    const queued = await deps.evidenceRepo.listIndexJobs({ status: "queued" });
    for (const candidate of queued) {
      // Atomic owner-scoped claim: exactly one queue wins a queued source;
      // concurrent drains find the row already claimed and move on.
      const claimed = await deps.evidenceRepo.claimIndexJob({
        sourceResultId: candidate.sourceResultId,
        ownerId,
        updatedAt: now(),
      });
      if (claimed === null) continue;
      const ref: DerivationSourceRef = {
        sourceKind: claimed.sourceKind,
        sourceResultId: claimed.sourceResultId,
        sourceRevision: claimed.sourceRevision,
      };

      // Owner-checked heartbeat: refresh the running marker so a concurrent
      // recovery never steals an active owner; stop as soon as ownership is
      // lost. Containment is absolute; the owner-checked finalize keeps a
      // stale heartbeat from regressing anything.
      const heartbeat =
        heartbeatMs > 0
          ? setInterval(() => {
              void deps.evidenceRepo
                .heartbeatIndexJob({
                  sourceResultId: ref.sourceResultId,
                  ownerId,
                  updatedAt: now(),
                })
                .then((held) => {
                  if (!held && heartbeat !== null) clearInterval(heartbeat);
                })
                .catch(() => {});
            }, heartbeatMs)
          : null;
      let result;
      try {
        result = await deriveObservationsForSource(deps, ref);
      } finally {
        if (heartbeat !== null) clearInterval(heartbeat);
      }
      const ok = result.status === "complete";
      const finalized = await deps.evidenceRepo.finalizeIndexJob({
        sourceResultId: ref.sourceResultId,
        ownerId,
        job: ok
          ? {
              ...claimed,
              status: "complete",
              updatedAt: now(),
              errorKind: null,
              errorMessage: null,
              summary: {
                observationCount: result.observationCount,
                gapCount: result.gapCount,
                limitationCount: result.limitationCount,
                integrityIssues: result.integrityIssues,
              },
            }
          : {
              ...claimed,
              status: "error",
              updatedAt: now(),
              errorKind: result.errorKind ?? "indexing-failed",
              errorMessage: result.errorMessage ?? "Derivation failed.",
              summary: null,
            },
      });
      if (finalized === "lost") {
        // A successor recovered and re-derived this source; it owns the
        // outcome. End the drain rather than double-processing.
        return { handled: false };
      }
      return { handled: true, ok };
    }
    return { handled: false };
  }

  function schedule(): void {
    if (disposed) return;
    const delay =
      scheduleDelayMs > 0
        ? new Promise<void>((resolve) => setTimeout(resolve, scheduleDelayMs))
        : Promise.resolve();
    chain = chain.then(async () => {
      await delay;
      if (disposed) return;
      try {
        await recoverStale();
        let done = false;
        while (!disposed && !done) {
          const outcome = await processOne();
          done = !outcome.handled;
        }
      } catch {
        // Contained: a later enqueue/drain retries the queued job. Job-level
        // failures were already recorded on the job row by processOne.
      }
    });
  }

  return {
    async enqueue(ref: DerivationSourceRef): Promise<void> {
      try {
        const put = await deps.evidenceRepo.putIndexJob({
          sourceResultId: ref.sourceResultId,
          sourceKind: ref.sourceKind,
          status: "queued",
          ruleVersion: EVIDENCE_RULE_VERSION,
          sourceRevision: ref.sourceRevision,
          updatedAt: now(),
          errorKind: null,
          errorMessage: null,
          summary: null,
        });
        if (put !== "unchanged") schedule();
      } catch {
        // Containment: enqueue never rejects. A failed enqueue leaves the
        // source unindexed; the reindex sweep repairs it later.
      }
    },
    async drain(): Promise<DrainSummary> {
      await chain;
      const summary: DrainSummary = { processed: 0, completed: 0, failed: 0 };
      try {
        await recoverStale();
        let outcome = await processOne();
        while (outcome.handled) {
          summary.processed += 1;
          if (outcome.ok) summary.completed += 1;
          else summary.failed += 1;
          outcome = await processOne();
        }
      } catch {
        // Contained — report what was processed so far.
      }
      return summary;
    },
    dispose(): void {
      disposed = true;
    },
  };
}

/** A genuinely unique claim-owner identity per queue instance. Overridable
 *  via `DerivationQueueOptions.ownerId` for deterministic tests. */
function uniqueOwnerId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `evidence-owner-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
