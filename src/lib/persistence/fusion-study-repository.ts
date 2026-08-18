// =============================================================================
// RSemble AI — Fusion Study repository (in-memory methodology substrate)
//
// REV-6 (Child 06 T12): the Dexie-backed Fusion Study repository phenotype was
// removed — the seven legacy Fusion stores were deleted in schema v13 and the
// Research Lab owns canonical study authority now. The only remaining export
// beyond the hard type/shape reference (the `FusionStudyRepository` interface)
// and the `validateTrialAttemptLink` helper is `InMemoryFusionStudyRepository`,
// the allowlisted in-memory substrate consumed by the Policy Study adapter
// (`src/lib/studies/policy/policy-study-adapter.ts`) to run the staged
// methodology behind canonical Lab authority.
//
// The staged methodology (stage A/B/C, pair-screening, MPID, holdout,
// pool-adequacy, recipe-sensitivity, confirmation, cost, retry/recovery,
// blindness, playbook) is REUSED, not rewritten. `sealTrial` is the single
// terminal transition for a trial; it runs the anti-circularity check
// in-process — loading the referenced recipe so the holdout judge can be
// compared against BOTH the development judge and the synthesizer — and
// rejects with a conflict naming the violation (spec §5.3, §6.3). Seals are
// final: no mutation path touches a sealed trial.
// =============================================================================

import { StorageError } from "./database";
import {
  isEvaluationObservation,
  isFusionAttempt,
  isFusionPlaybook,
  isFusionRecipeVersion,
  isFusionStudy,
  isFusionTrial,
  isPoolManifestVersion,
  type EvaluationObservation,
  type FusionAttempt,
  type FusionPlaybook,
  type FusionRecipeVersion,
  type FusionStudy,
  type FusionTrial,
  type PoolManifestVersion,
} from "../evaluations/fusion-study-types";
import { findJudgeCircularityConflict } from "../evaluations/fusion-study-validation";
import type { CriticRef } from "../providers/types";

export interface FusionStudyRepository {
  // Recipes — immutable versions, create-only.
  createRecipe(recipe: FusionRecipeVersion): Promise<void>;
  getRecipe(id: string, version: number): Promise<FusionRecipeVersion | null>;
  getLatestRecipe(id: string): Promise<FusionRecipeVersion | null>;
  listRecipes(): Promise<FusionRecipeVersion[]>;

  // Pool manifests — immutable versions, create-only.
  createPoolManifest(manifest: PoolManifestVersion): Promise<void>;
  getPoolManifest(id: string, version: number): Promise<PoolManifestVersion | null>;
  getLatestPoolManifest(id: string): Promise<PoolManifestVersion | null>;
  listPoolManifests(): Promise<PoolManifestVersion[]>;

  // Studies — revision-guarded mutable aggregate.
  createStudy(study: FusionStudy): Promise<void>;
  updateStudy(study: FusionStudy, expectedRevision: number): Promise<number>;
  getStudy(id: string): Promise<FusionStudy | null>;
  listStudies(suiteId?: string): Promise<FusionStudy[]>;

  // Trials — created in_progress, links assembled via updateTrialLinks,
  // terminal transition via sealTrial only.
  createTrial(trial: FusionTrial): Promise<void>;
  getTrial(id: string): Promise<FusionTrial | null>;
  listTrials(studyId: string): Promise<FusionTrial[]>;
  updateTrialLinks(trial: FusionTrial, expectedRevision: number): Promise<number>;
  sealTrial(trialId: string, expectedRevision: number, sealedAt: number): Promise<number>;

  // Attempt links — immutable treatment-change lineage.
  recordTrialAttempt(attempt: FusionAttempt): Promise<void>;
  listTrialAttempts(studyId: string): Promise<FusionAttempt[]>;

  // Observations — immutable, terminal-state-only; attaching appends the
  // observation id to the parent trial in the same transaction.
  addObservation(
    observation: EvaluationObservation,
    expectedTrialRevision: number,
  ): Promise<number>;
  getObservation(id: string): Promise<EvaluationObservation | null>;
  listObservations(trialId: string): Promise<EvaluationObservation[]>;

  // Playbooks — immutable deliverables.
  createPlaybook(playbook: FusionPlaybook): Promise<void>;
  getPlaybook(id: string): Promise<FusionPlaybook | null>;
}

/**
 * Validates a trial-attempt link (spec §6.2): both trials must exist in the
 * same study, the successor must carry sampleIndex = predecessor + 1, and the
 * treatment spec (suite, pool, judges, recipe, stage, candidates) must be
 * identical — a recipe change is a new trial, never an attempt.
 */
export function validateTrialAttemptLink(
  attempt: FusionAttempt,
  fromTrial: FusionTrial | null,
  toTrial: FusionTrial | null,
): string | null {
  if (!fromTrial) return `Predecessor trial ${attempt.fromTrialId} not found.`;
  if (!toTrial) return `Successor trial ${attempt.toTrialId} not found.`;
  if (fromTrial.studyId !== attempt.studyId || toTrial.studyId !== attempt.studyId) {
    return "Attempt links must stay within one study.";
  }
  if (toTrial.sampleIndex !== fromTrial.sampleIndex + 1) {
    return (
      `A treatment-changing attempt must increment sampleIndex ` +
      `(${fromTrial.sampleIndex} → ${toTrial.sampleIndex}).`
    );
  }
  const sameTreatment =
    JSON.stringify(fromTrial.suiteRef) === JSON.stringify(toTrial.suiteRef) &&
    JSON.stringify(fromTrial.poolRef) === JSON.stringify(toTrial.poolRef) &&
    JSON.stringify(fromTrial.judge1) === JSON.stringify(toTrial.judge1) &&
    JSON.stringify(fromTrial.judge2) === JSON.stringify(toTrial.judge2) &&
    JSON.stringify(fromTrial.recipe) === JSON.stringify(toTrial.recipe) &&
    JSON.stringify(fromTrial.synthesizer) === JSON.stringify(toTrial.synthesizer) &&
    JSON.stringify(fromTrial.candidateConfig) === JSON.stringify(toTrial.candidateConfig) &&
    fromTrial.policy === toTrial.policy &&
    fromTrial.stage === toTrial.stage;
  if (!sameTreatment) {
    return (
      "Attempt links require an identical treatment spec — a recipe, judge, pool, " +
      "or candidate change is a new trial, not an attempt."
    );
  }
  return null;
}

// --- In-memory implementation -----------------------------------------------------
//
// The allowlisted in-memory FusionStudyRepository. Consumed by the Policy
// Study adapter (`policy-study-adapter.ts`) to run the staged methodology
// behind canonical Research Lab authority, and by the methodology/tests that
// pin its validation and conflict semantics. No Dexie phenotype remains.

/**
 * In-memory FusionStudyRepository with the validation and conflict semantics
 * the staged methodology depends on. Used by the Policy Study adapter and by
 * unit tests of the methodology.
 */
export class InMemoryFusionStudyRepository implements FusionStudyRepository {
  private recipes = new Map<string, FusionRecipeVersion>();
  private manifests = new Map<string, PoolManifestVersion>();
  private studies = new Map<string, FusionStudy>();
  private trials = new Map<string, FusionTrial>();
  private attempts = new Map<string, FusionAttempt>();
  private observations = new Map<string, EvaluationObservation>();
  private playbooks = new Map<string, FusionPlaybook>();

  private static versionedKey(id: string, version: number): string {
    return `${id}@${version}`;
  }

  async createRecipe(recipe: FusionRecipeVersion): Promise<void> {
    if (!isFusionRecipeVersion(recipe))
      throw new StorageError("validation", "Invalid fusion recipe");
    const key = InMemoryFusionStudyRepository.versionedKey(recipe.id, recipe.version);
    if (this.recipes.has(key)) {
      throw new StorageError(
        "conflict",
        `Recipe ${recipe.id} v${recipe.version} already exists — recipes are immutable.`,
      );
    }
    this.recipes.set(key, recipe);
  }

  async getRecipe(id: string, version: number): Promise<FusionRecipeVersion | null> {
    return this.recipes.get(InMemoryFusionStudyRepository.versionedKey(id, version)) ?? null;
  }

  async getLatestRecipe(id: string): Promise<FusionRecipeVersion | null> {
    const matches = [...this.recipes.values()].filter((r) => r.id === id);
    matches.sort((a, b) => b.version - a.version);
    return matches[0] ?? null;
  }

  async listRecipes(): Promise<FusionRecipeVersion[]> {
    return [...this.recipes.values()].sort(
      (a, b) => a.id.localeCompare(b.id) || a.version - b.version,
    );
  }

  async createPoolManifest(manifest: PoolManifestVersion): Promise<void> {
    if (!isPoolManifestVersion(manifest)) {
      throw new StorageError("validation", "Invalid pool manifest");
    }
    const key = InMemoryFusionStudyRepository.versionedKey(manifest.id, manifest.version);
    if (this.manifests.has(key)) {
      throw new StorageError(
        "conflict",
        `Pool manifest ${manifest.id} v${manifest.version} already exists — manifests are immutable.`,
      );
    }
    this.manifests.set(key, manifest);
  }

  async getPoolManifest(id: string, version: number): Promise<PoolManifestVersion | null> {
    return this.manifests.get(InMemoryFusionStudyRepository.versionedKey(id, version)) ?? null;
  }

  async getLatestPoolManifest(id: string): Promise<PoolManifestVersion | null> {
    const matches = [...this.manifests.values()].filter((m) => m.id === id);
    matches.sort((a, b) => b.version - a.version);
    return matches[0] ?? null;
  }

  async listPoolManifests(): Promise<PoolManifestVersion[]> {
    return [...this.manifests.values()].sort(
      (a, b) => a.id.localeCompare(b.id) || a.version - b.version,
    );
  }

  async createStudy(study: FusionStudy): Promise<void> {
    if (!isFusionStudy(study)) throw new StorageError("validation", "Invalid fusion study");
    if (this.studies.has(study.id)) {
      throw new StorageError("conflict", `Fusion study ${study.id} already exists`);
    }
    this.studies.set(study.id, study);
  }

  async updateStudy(study: FusionStudy, expectedRevision: number): Promise<number> {
    if (!isFusionStudy(study)) throw new StorageError("validation", "Invalid fusion study");
    const existing = this.studies.get(study.id);
    if (!existing) throw new StorageError("conflict", `Fusion study ${study.id} not found`);
    if (existing.revision !== expectedRevision) {
      throw new StorageError(
        "conflict",
        `Stale revision: expected ${expectedRevision}, got ${existing.revision}`,
      );
    }
    const newRevision = expectedRevision + 1;
    this.studies.set(study.id, { ...study, revision: newRevision });
    return newRevision;
  }

  async getStudy(id: string): Promise<FusionStudy | null> {
    return this.studies.get(id) ?? null;
  }

  async listStudies(suiteId?: string): Promise<FusionStudy[]> {
    return [...this.studies.values()]
      .filter((s) => suiteId === undefined || s.suiteRef.suiteId === suiteId)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async createTrial(trial: FusionTrial): Promise<void> {
    if (!isFusionTrial(trial)) throw new StorageError("validation", "Invalid fusion trial");
    if (trial.status !== "in_progress") {
      throw new StorageError(
        "validation",
        "Trials are created in_progress and sealed via sealTrial",
      );
    }
    if (this.trials.has(trial.id)) {
      throw new StorageError("conflict", `Fusion trial ${trial.id} already exists`);
    }
    this.trials.set(trial.id, trial);
  }

  async getTrial(id: string): Promise<FusionTrial | null> {
    return this.trials.get(id) ?? null;
  }

  async listTrials(studyId: string): Promise<FusionTrial[]> {
    return [...this.trials.values()]
      .filter((t) => t.studyId === studyId)
      .sort((a, b) => a.createdAt - b.createdAt || a.sampleIndex - b.sampleIndex);
  }

  async updateTrialLinks(trial: FusionTrial, expectedRevision: number): Promise<number> {
    if (!isFusionTrial(trial)) throw new StorageError("validation", "Invalid fusion trial");
    const existing = this.trials.get(trial.id);
    if (!existing) throw new StorageError("conflict", `Fusion trial ${trial.id} not found`);
    if (existing.revision !== expectedRevision) {
      throw new StorageError(
        "conflict",
        `Stale revision: expected ${expectedRevision}, got ${existing.revision}`,
      );
    }
    if (existing.status === "sealed") {
      throw new StorageError("conflict", `Fusion trial ${trial.id} is sealed — seals are final.`);
    }
    if (trial.status === "sealed") {
      throw new StorageError(
        "validation",
        "Trials seal via sealTrial only — the anti-circularity check cannot be bypassed.",
      );
    }
    const newRevision = expectedRevision + 1;
    this.trials.set(trial.id, { ...trial, revision: newRevision });
    return newRevision;
  }

  async sealTrial(trialId: string, expectedRevision: number, sealedAt: number): Promise<number> {
    const existing = this.trials.get(trialId);
    if (!existing) throw new StorageError("conflict", `Fusion trial ${trialId} not found`);
    if (existing.revision !== expectedRevision) {
      throw new StorageError(
        "conflict",
        `Stale revision: expected ${expectedRevision}, got ${existing.revision}`,
      );
    }
    if (existing.status === "sealed") {
      throw new StorageError(
        "conflict",
        `Fusion trial ${trialId} is already sealed — seals are final.`,
      );
    }
    // Fuse trials reference a stored recipe (provenance must resolve); the
    // effective synthesizer is the trial's, else the recipe's.
    let recipeSynthesizer: CriticRef | null = null;
    if (existing.recipe !== null) {
      const recipe = await this.getRecipe(existing.recipe.id, existing.recipe.version);
      if (!recipe) {
        throw new StorageError(
          "validation",
          `Recipe ${existing.recipe.id} v${existing.recipe.version} referenced by trial ${trialId} not found.`,
        );
      }
      recipeSynthesizer = recipe.synthesizer;
    }
    const conflict = findJudgeCircularityConflict(
      existing.judge1,
      existing.judge2,
      existing.synthesizer ?? recipeSynthesizer,
    );
    if (conflict) throw new StorageError("conflict", conflict);
    const newRevision = expectedRevision + 1;
    this.trials.set(trialId, {
      ...existing,
      revision: newRevision,
      status: "sealed",
      sealedAt,
      updatedAt: sealedAt,
    });
    return newRevision;
  }

  async recordTrialAttempt(attempt: FusionAttempt): Promise<void> {
    if (!isFusionAttempt(attempt)) throw new StorageError("validation", "Invalid fusion attempt");
    if (this.attempts.has(attempt.id)) {
      throw new StorageError(
        "conflict",
        `Fusion attempt ${attempt.id} already exists — attempts are immutable.`,
      );
    }
    const problem = validateTrialAttemptLink(
      attempt,
      this.trials.get(attempt.fromTrialId) ?? null,
      this.trials.get(attempt.toTrialId) ?? null,
    );
    if (problem) throw new StorageError("validation", problem);
    this.attempts.set(attempt.id, attempt);
  }

  async listTrialAttempts(studyId: string): Promise<FusionAttempt[]> {
    return [...this.attempts.values()]
      .filter((a) => a.studyId === studyId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  async addObservation(
    observation: EvaluationObservation,
    expectedTrialRevision: number,
  ): Promise<number> {
    if (!isEvaluationObservation(observation)) {
      throw new StorageError("validation", "Invalid evaluation observation");
    }
    if (this.observations.has(observation.id)) {
      throw new StorageError(
        "conflict",
        `Observation ${observation.id} already exists — observations are immutable.`,
      );
    }
    const trial = this.trials.get(observation.trialId);
    if (!trial) throw new StorageError("conflict", `Fusion trial ${observation.trialId} not found`);
    if (trial.revision !== expectedTrialRevision) {
      throw new StorageError(
        "conflict",
        `Stale revision: expected ${expectedTrialRevision}, got ${trial.revision}`,
      );
    }
    if (trial.status === "sealed") {
      throw new StorageError(
        "conflict",
        `Fusion trial ${trial.id} is sealed — observations attach while in_progress.`,
      );
    }
    this.observations.set(observation.id, observation);
    const newRevision = expectedTrialRevision + 1;
    this.trials.set(trial.id, {
      ...trial,
      revision: newRevision,
      observationIds: [...trial.observationIds, observation.id],
      updatedAt: Date.now(),
    });
    return newRevision;
  }

  async getObservation(id: string): Promise<EvaluationObservation | null> {
    return this.observations.get(id) ?? null;
  }

  async listObservations(trialId: string): Promise<EvaluationObservation[]> {
    return [...this.observations.values()]
      .filter((o) => o.trialId === trialId)
      .sort((a, b) => a.finishedAt - b.finishedAt);
  }

  async createPlaybook(playbook: FusionPlaybook): Promise<void> {
    if (!isFusionPlaybook(playbook)) {
      throw new StorageError("validation", "Invalid fusion playbook");
    }
    if (this.playbooks.has(playbook.id)) {
      throw new StorageError(
        "conflict",
        `Playbook ${playbook.id} already exists — playbooks are immutable.`,
      );
    }
    this.playbooks.set(playbook.id, playbook);
  }

  async getPlaybook(id: string): Promise<FusionPlaybook | null> {
    return this.playbooks.get(id) ?? null;
  }
}
