// =============================================================================
// RSemble AI — Fusion Study controller
//
// Trial/Attempt lifecycle enforcing the spec §6.2 rule programmatically:
//
//   Holdout failure                    → new EvaluationObservation, same trial
//   Regrade F with another judge       → new EvaluationObservation, same trial
//   Rerun synthesis with same inputs   → new trial (sampleIndex + 1) + attempt link
//   Regenerate a candidate             → new trial (sampleIndex + 1) + attempt link
//   Change recipe                      → new trial (new treatment, no link)
//
// Retry storms never inflate sample counts: observations attach to the same
// trial and only treatment-changing reruns increment sampleIndex — via
// rerunTreatment, which is the ONLY path that does so.
//
// Cost accounting (spec §6.4): every call edge rolls into the trial's cost
// with a countsTowardPolicy flag; policy cost (clean execution) is reported
// separately from experimental cost (observed, including retries/failures).
//
// The controller never touches providers — stage drivers inject a
// FusionPolicyExecutor (mock in tests, live provider-backed in production).
// =============================================================================

import type { CriticRef, ChatMessage } from "../providers/types";
import type { BlindCandidate, ConsensusBreakdown, JudgeReport, ModelSlot } from "../../studio-data";
import type {
  EvaluationObservation,
  FusionArtifactRef,
  FusionAttemptReason,
  FusionCandidateConfig,
  FusionPolicyKind,
  FusionRecipeRef,
  FusionStage,
  FusionStudy,
  FusionTrial,
  FusionTrialChildren,
  FusionTrialCost,
  PoolManifestRef,
} from "./fusion-study-types";
import type { EvaluationProfileSnapshot, EvaluationTask } from "./evaluation-types";
import type { FusionStudyRepository } from "../persistence/fusion-study-repository";

// --- Executor port ------------------------------------------------------------------

export interface TokenCost {
  tokensIn: number;
  tokensOut: number;
}

export interface PoolSweepOutput {
  slot: ModelSlot;
  modelKey: string;
  candidateId: string;
  text: string;
  cost: TokenCost;
}

export interface PoolSweepResult {
  taskId: string;
  outputs: PoolSweepOutput[];
}

export interface DevJudgeResult {
  report: JudgeReport;
  consensus: ConsensusBreakdown;
  cost: TokenCost;
}

/** Shared blocked evidence: one candidate generation set + one Judge-1 pass. */
export interface BlockedRunResult {
  blindCandidates: BlindCandidate[];
  report: JudgeReport;
  consensus: ConsensusBreakdown;
  /** Frozen lineage shared by every policy derived from this block. */
  candidateAttemptIdsByCandidateId: Record<string, string>;
  judgeAttemptId: string;
  candidateRunId: string | null;
  devJudgeRunId: string | null;
  /** Per-candidate generation costs (policy cost each). */
  candidateCosts: Record<string, TokenCost>;
  judgeCost: TokenCost;
}

export interface SynthesisResult {
  text: string;
  cost: TokenCost;
}

export interface HoldoutArtifact {
  /** Policy-identifying key, e.g. "rank", "fuse:BlindRaw", "refine". */
  key: string;
  text: string;
}

export interface HoldoutResult {
  scoresByKey: Record<string, number>;
  cost: TokenCost;
}

export interface FusionPolicyExecutor {
  /** One generation per model for the screening sweep. */
  runPoolSweep(task: EvaluationTask, slots: ModelSlot[]): Promise<PoolSweepResult>;
  /** Judge-1 scoring of sweep outputs for one task. */
  judgePool(
    task: EvaluationTask,
    profile: EvaluationProfileSnapshot | null,
    judge1: CriticRef,
    outputs: PoolSweepOutput[],
  ): Promise<DevJudgeResult>;
  /** Candidates + Judge 1 for one pair on one task (shared by all finishes). */
  runBlockedEvidence(
    task: EvaluationTask,
    profile: EvaluationProfileSnapshot | null,
    pair: [ModelSlot, ModelSlot],
    judge1: CriticRef,
  ): Promise<BlockedRunResult>;
  /** Synthesizer / reviser call with prepared messages. */
  runSynthesis(synthesizer: CriticRef, messages: ChatMessage[]): Promise<SynthesisResult>;
  /** Holdout judge evaluates policy artifacts blind and randomized. */
  runHoldout(
    task: EvaluationTask,
    profile: EvaluationProfileSnapshot | null,
    judge2: CriticRef,
    artifacts: HoldoutArtifact[],
  ): Promise<HoldoutResult>;
}

// --- Cost rollup ------------------------------------------------------------------------

export interface FusionCostEdgeInput extends TokenCost {
  /** False for retry/failure edges a clean execution would not incur. */
  countsTowardPolicy: boolean;
}

export function zeroTrialCost(): FusionTrialCost {
  return {
    policy: { tokensIn: 0, tokensOut: 0 },
    experimental: { tokensIn: 0, tokensOut: 0 },
  };
}

/**
 * Roll one call edge into a trial's cost. Policy cost counts only clean-path
 * edges; experimental cost counts everything (spec §6.4).
 */
export function rollCostInto(total: FusionTrialCost, edge: FusionCostEdgeInput): FusionTrialCost {
  return {
    policy: edge.countsTowardPolicy
      ? {
          tokensIn: total.policy.tokensIn + edge.tokensIn,
          tokensOut: total.policy.tokensOut + edge.tokensOut,
        }
      : total.policy,
    experimental: {
      tokensIn: total.experimental.tokensIn + edge.tokensIn,
      tokensOut: total.experimental.tokensOut + edge.tokensOut,
    },
  };
}

// --- Controller --------------------------------------------------------------------------

export interface CreateTrialInput {
  study: FusionStudy;
  poolRef: PoolManifestRef;
  candidateConfig: FusionCandidateConfig;
  policy: FusionPolicyKind;
  recipe: FusionRecipeRef | null;
  synthesizer: CriticRef | null;
  stage: FusionStage;
  sampleIndex: number;
}

export interface FusionControllerDeps {
  repo: FusionStudyRepository;
  generateId?: () => string;
  now?: () => number;
}

export interface FusionStudyController {
  createTrial(input: CreateTrialInput): Promise<FusionTrial>;
  attachChildren(trialId: string, children: Partial<FusionTrialChildren>): Promise<FusionTrial>;
  /** Roll a cost edge into the trial (spec §6.4). */
  addCostEdge(trialId: string, edge: FusionCostEdgeInput): Promise<FusionTrial>;
  /**
   * Measurement-only event: attach a terminal holdout observation to the SAME
   * trial (artifact preserved, reused). Never increments sampleIndex.
   */
  addHoldoutObservation(
    trialId: string,
    observation: Omit<EvaluationObservation, "id" | "trialId">,
  ): Promise<{ trial: FusionTrial; observation: EvaluationObservation }>;
  /**
   * Treatment-changing rerun (synthesis rerun / candidate regeneration):
   * creates the successor trial with sampleIndex + 1 and the immutable
   * attempt link. This is the only sampleIndex-incrementing path.
   */
  rerunTreatment(trialId: string, reason: FusionAttemptReason): Promise<FusionTrial>;
  /** Recipe change: a NEW trial (new treatment), sampleIndex restarts at 0. */
  changeRecipe(
    trialId: string,
    recipe: FusionRecipeRef,
    synthesizer: CriticRef,
  ): Promise<FusionTrial>;
  /** Terminal transition — runs the anti-circularity check in-transaction. */
  seal(trialId: string): Promise<FusionTrial>;
  /** Attach a completed stage result to the study (revision-guarded). */
  updateStudy(study: FusionStudy): Promise<FusionStudy>;
}

export function createFusionStudyController(deps: FusionControllerDeps): FusionStudyController {
  const generateId = deps.generateId ?? (() => crypto.randomUUID());
  const now = deps.now ?? Date.now;
  const { repo } = deps;

  async function requireTrial(trialId: string): Promise<FusionTrial> {
    const trial = await repo.getTrial(trialId);
    if (!trial) throw new Error(`Fusion trial ${trialId} not found`);
    return trial;
  }

  async function createTrial(input: CreateTrialInput): Promise<FusionTrial> {
    const timestamp = now();
    const trial: FusionTrial = {
      id: generateId(),
      revision: 0,
      studyId: input.study.id,
      suiteRef: input.study.suiteRef,
      poolRef: input.poolRef,
      candidateConfig: input.candidateConfig,
      judge1: input.study.judge1,
      judge2: input.study.judge2,
      policy: input.policy,
      recipe: input.recipe,
      synthesizer: input.synthesizer,
      stage: input.stage,
      sampleIndex: input.sampleIndex,
      children: { candidateRunId: null, devJudgeRunId: null, synthesisArtifact: null },
      observationIds: [],
      cost: zeroTrialCost(),
      status: "in_progress",
      sealedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await repo.createTrial(trial);
    return trial;
  }

  async function attachChildren(
    trialId: string,
    children: Partial<FusionTrialChildren>,
  ): Promise<FusionTrial> {
    const trial = await requireTrial(trialId);
    const updated: FusionTrial = {
      ...trial,
      children: { ...trial.children, ...children },
      updatedAt: now(),
    };
    const revision = await repo.updateTrialLinks(updated, trial.revision);
    return { ...updated, revision };
  }

  async function addCostEdge(trialId: string, edge: FusionCostEdgeInput): Promise<FusionTrial> {
    const trial = await requireTrial(trialId);
    const updated: FusionTrial = {
      ...trial,
      cost: rollCostInto(trial.cost, edge),
      updatedAt: now(),
    };
    const revision = await repo.updateTrialLinks(updated, trial.revision);
    return { ...updated, revision };
  }

  async function addHoldoutObservation(
    trialId: string,
    observation: Omit<EvaluationObservation, "id" | "trialId">,
  ): Promise<{ trial: FusionTrial; observation: EvaluationObservation }> {
    const trial = await requireTrial(trialId);
    if (trial.status === "sealed") {
      throw new Error(`Fusion trial ${trialId} is sealed — observations attach while in_progress.`);
    }
    const full: EvaluationObservation = { ...observation, id: generateId(), trialId };
    const revision = await repo.addObservation(full, trial.revision);
    const updated = (await repo.getTrial(trialId))!;
    return { trial: { ...updated, revision }, observation: full };
  }

  async function rerunTreatment(
    trialId: string,
    reason: FusionAttemptReason,
  ): Promise<FusionTrial> {
    const trial = await requireTrial(trialId);
    const timestamp = now();
    const successor: FusionTrial = {
      ...trial,
      id: generateId(),
      revision: 0,
      sampleIndex: trial.sampleIndex + 1,
      children: { candidateRunId: null, devJudgeRunId: null, synthesisArtifact: null },
      observationIds: [],
      cost: zeroTrialCost(),
      status: "in_progress",
      sealedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await repo.createTrial(successor);
    await repo.recordTrialAttempt({
      id: generateId(),
      studyId: trial.studyId,
      fromTrialId: trial.id,
      toTrialId: successor.id,
      reason,
      createdAt: timestamp,
    });
    return successor;
  }

  async function changeRecipe(
    trialId: string,
    recipe: FusionRecipeRef,
    synthesizer: CriticRef,
  ): Promise<FusionTrial> {
    const trial = await requireTrial(trialId);
    const timestamp = now();
    // New treatment: new trial, no attempt link, sampleIndex restarts.
    const fresh: FusionTrial = {
      ...trial,
      id: generateId(),
      revision: 0,
      policy: "fuse",
      recipe,
      synthesizer,
      sampleIndex: 0,
      children: { candidateRunId: null, devJudgeRunId: null, synthesisArtifact: null },
      observationIds: [],
      cost: zeroTrialCost(),
      status: "in_progress",
      sealedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await repo.createTrial(fresh);
    return fresh;
  }

  async function seal(trialId: string): Promise<FusionTrial> {
    const trial = await requireTrial(trialId);
    await repo.sealTrial(trialId, trial.revision, now());
    return requireTrial(trialId);
  }

  async function updateStudy(study: FusionStudy): Promise<FusionStudy> {
    const revision = await repo.updateStudy({ ...study, updatedAt: now() }, study.revision);
    return { ...study, revision, updatedAt: now() };
  }

  return {
    createTrial,
    attachChildren,
    addCostEdge,
    addHoldoutObservation,
    rerunTreatment,
    changeRecipe,
    seal,
    updateStudy,
  };
}

/** Build the content-addressed synthesis artifact ref (spec §6.3). */
export function synthesisArtifactRef(
  runId: string,
  fusionAttemptId: string,
  contentHash: string,
): FusionArtifactRef {
  return { runId, fusionAttemptId, contentHash };
}
