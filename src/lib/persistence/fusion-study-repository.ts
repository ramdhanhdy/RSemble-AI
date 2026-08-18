// =============================================================================
// RSemble AI — Fusion Study repository (Dexie-backed + in-memory)
//
// Stores for the Fusion Study domain model: versioned recipes and pool
// manifests (immutable), studies (revision-guarded), trials (sealable),
// treatment-changing attempt links and measurement-only observations (both
// immutable on creation), and playbooks (immutable).
//
// sealTrial is the single terminal transition for a trial. It runs the
// anti-circularity check in-transaction — loading the referenced recipe so the
// holdout judge can be compared against BOTH the development judge and the
// synthesizer — and rejects with a conflict naming the violation (spec §5.3,
// §6.3). Seals are final: no mutation path touches a sealed trial.
// =============================================================================

import {
  type RSembleEvaluationDB,
  type FusionRecipeRow,
  type PoolManifestRow,
  type FusionStudyRow,
  type FusionTrialRow,
  type FusionAttemptRow,
  type FusionObservationRow,
  type FusionPlaybookRow,
  StorageError,
  classifyStorageError,
} from "./database";
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

// --- Dexie implementation -------------------------------------------------------

export function createFusionStudyRepository(db: RSembleEvaluationDB): FusionStudyRepository {
  function getTable<T, Key>(tableName: string) {
    if (!db.tables.some((t) => t.name === tableName)) {
      throw new StorageError(
        "unavailable",
        `Legacy fusion store '${tableName}' was deleted in schema v13; use canonical study stores.`,
      );
    }
    return db.table<T, Key>(tableName);
  }

  async function createRecipe(recipe: FusionRecipeVersion): Promise<void> {
    if (!isFusionRecipeVersion(recipe)) {
      throw new StorageError("validation", "Invalid fusion recipe");
    }
    db.assertWritable();
    const tbl = getTable<FusionRecipeRow, [string, number]>("fusionRecipes");
    try {
      await db.transaction("rw", tbl, async () => {
        const existing = await tbl.get([recipe.id, recipe.version]);
        if (existing) {
          throw new StorageError(
            "conflict",
            `Recipe ${recipe.id} v${recipe.version} already exists — recipes are immutable.`,
          );
        }
        await tbl.put({
          id: recipe.id,
          version: recipe.version,
          recipe,
          createdAt: Date.now(),
        });
      });
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function getRecipe(id: string, version: number): Promise<FusionRecipeVersion | null> {
    try {
      const tbl = getTable<FusionRecipeRow, [string, number]>("fusionRecipes");
      const row = await tbl.get([id, version]);
      if (!row) return null;
      return isFusionRecipeVersion(row.recipe) ? row.recipe : null;
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function getLatestRecipe(id: string): Promise<FusionRecipeVersion | null> {
    try {
      const tbl = getTable<FusionRecipeRow, [string, number]>("fusionRecipes");
      const rows = await tbl.where("id").equals(id).toArray();
      const recipes = rows
        .map((r) => r.recipe)
        .filter((r): r is FusionRecipeVersion => isFusionRecipeVersion(r));
      recipes.sort((a, b) => b.version - a.version);
      return recipes[0] ?? null;
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function listRecipes(): Promise<FusionRecipeVersion[]> {
    try {
      const tbl = getTable<FusionRecipeRow, [string, number]>("fusionRecipes");
      const rows = await tbl.toArray();
      return rows
        .map((r) => r.recipe)
        .filter((r): r is FusionRecipeVersion => isFusionRecipeVersion(r))
        .sort((a, b) => a.id.localeCompare(b.id) || a.version - b.version);
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function createPoolManifest(manifest: PoolManifestVersion): Promise<void> {
    if (!isPoolManifestVersion(manifest)) {
      throw new StorageError("validation", "Invalid pool manifest");
    }
    db.assertWritable();
    const tbl = getTable<PoolManifestRow, [string, number]>("poolManifests");
    try {
      await db.transaction("rw", tbl, async () => {
        const existing = await tbl.get([manifest.id, manifest.version]);
        if (existing) {
          throw new StorageError(
            "conflict",
            `Pool manifest ${manifest.id} v${manifest.version} already exists — manifests are immutable.`,
          );
        }
        await tbl.put({
          id: manifest.id,
          version: manifest.version,
          manifest,
          createdAt: manifest.createdAt,
        });
      });
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function getPoolManifest(id: string, version: number): Promise<PoolManifestVersion | null> {
    try {
      const tbl = getTable<PoolManifestRow, [string, number]>("poolManifests");
      const row = await tbl.get([id, version]);
      if (!row) return null;
      return isPoolManifestVersion(row.manifest) ? row.manifest : null;
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function getLatestPoolManifest(id: string): Promise<PoolManifestVersion | null> {
    try {
      const tbl = getTable<PoolManifestRow, [string, number]>("poolManifests");
      const rows = await tbl.where("id").equals(id).toArray();
      const manifests = rows
        .map((r) => r.manifest)
        .filter((m): m is PoolManifestVersion => isPoolManifestVersion(m));
      manifests.sort((a, b) => b.version - a.version);
      return manifests[0] ?? null;
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function listPoolManifests(): Promise<PoolManifestVersion[]> {
    try {
      const tbl = getTable<PoolManifestRow, [string, number]>("poolManifests");
      const rows = await tbl.toArray();
      return rows
        .map((r) => r.manifest)
        .filter((m): m is PoolManifestVersion => isPoolManifestVersion(m))
        .sort((a, b) => a.id.localeCompare(b.id) || a.version - b.version);
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function createStudy(study: FusionStudy): Promise<void> {
    if (!isFusionStudy(study)) throw new StorageError("validation", "Invalid fusion study");
    db.assertWritable();
    const tbl = getTable<FusionStudyRow, string>("fusionStudies");
    try {
      await db.transaction("rw", tbl, async () => {
        const existing = await tbl.get(study.id);
        if (existing) throw new StorageError("conflict", `Fusion study ${study.id} already exists`);
        await tbl.put({
          id: study.id,
          study,
          revision: study.revision,
          suiteId: study.suiteRef.suiteId,
          suiteVersion: study.suiteRef.suiteVersion,
          status: study.status,
          updatedAt: study.updatedAt,
        });
      });
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function updateStudy(study: FusionStudy, expectedRevision: number): Promise<number> {
    if (!isFusionStudy(study)) throw new StorageError("validation", "Invalid fusion study");
    db.assertWritable();
    const newRevision = expectedRevision + 1;
    const tbl = getTable<FusionStudyRow, string>("fusionStudies");
    try {
      await db.transaction("rw", tbl, async () => {
        const existing = await tbl.get(study.id);
        if (!existing) throw new StorageError("conflict", `Fusion study ${study.id} not found`);
        if (existing.revision !== expectedRevision) {
          throw new StorageError(
            "conflict",
            `Stale revision: expected ${expectedRevision}, got ${existing.revision}`,
          );
        }
        await tbl.put({
          id: study.id,
          study: { ...study, revision: newRevision },
          revision: newRevision,
          suiteId: study.suiteRef.suiteId,
          suiteVersion: study.suiteRef.suiteVersion,
          status: study.status,
          updatedAt: study.updatedAt,
        });
      });
      return newRevision;
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function getStudy(id: string): Promise<FusionStudy | null> {
    try {
      const tbl = getTable<FusionStudyRow, string>("fusionStudies");
      const row = await tbl.get(id);
      if (!row) return null;
      return isFusionStudy(row.study) ? row.study : null;
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function listStudies(suiteId?: string): Promise<FusionStudy[]> {
    try {
      const tbl = getTable<FusionStudyRow, string>("fusionStudies");
      const rows = suiteId
        ? await tbl.where("suiteId").equals(suiteId).toArray()
        : await tbl.toArray();
      return rows
        .map((r) => r.study)
        .filter((s): s is FusionStudy => isFusionStudy(s))
        .sort((a, b) => b.updatedAt - a.updatedAt);
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function createTrial(trial: FusionTrial): Promise<void> {
    if (!isFusionTrial(trial)) throw new StorageError("validation", "Invalid fusion trial");
    if (trial.status !== "in_progress") {
      throw new StorageError(
        "validation",
        "Trials are created in_progress and sealed via sealTrial",
      );
    }
    db.assertWritable();
    const tbl = getTable<FusionTrialRow, string>("fusionTrials");
    try {
      await db.transaction("rw", tbl, async () => {
        const existing = await tbl.get(trial.id);
        if (existing) throw new StorageError("conflict", `Fusion trial ${trial.id} already exists`);
        await tbl.put({
          id: trial.id,
          trial,
          revision: trial.revision,
          studyId: trial.studyId,
          stage: trial.stage,
          status: trial.status,
          createdAt: trial.createdAt,
        });
      });
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function getTrial(id: string): Promise<FusionTrial | null> {
    try {
      const tbl = getTable<FusionTrialRow, string>("fusionTrials");
      const row = await tbl.get(id);
      if (!row) return null;
      return isFusionTrial(row.trial) ? row.trial : null;
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function listTrials(studyId: string): Promise<FusionTrial[]> {
    try {
      const tbl = getTable<FusionTrialRow, string>("fusionTrials");
      const rows = await tbl.where("studyId").equals(studyId).toArray();
      return rows
        .map((r) => r.trial)
        .filter((t): t is FusionTrial => isFusionTrial(t))
        .sort((a, b) => a.createdAt - b.createdAt || a.sampleIndex - b.sampleIndex);
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function updateTrialLinks(trial: FusionTrial, expectedRevision: number): Promise<number> {
    if (!isFusionTrial(trial)) throw new StorageError("validation", "Invalid fusion trial");
    db.assertWritable();
    const newRevision = expectedRevision + 1;
    const tbl = getTable<FusionTrialRow, string>("fusionTrials");
    try {
      await db.transaction("rw", tbl, async () => {
        const existing = await tbl.get(trial.id);
        if (!existing) throw new StorageError("conflict", `Fusion trial ${trial.id} not found`);
        if (existing.revision !== expectedRevision) {
          throw new StorageError(
            "conflict",
            `Stale revision: expected ${expectedRevision}, got ${existing.revision}`,
          );
        }
        const current = isFusionTrial(existing.trial) ? existing.trial : null;
        if (!current) throw new StorageError("validation", "Invalid trial data");
        if (current.status === "sealed") {
          throw new StorageError(
            "conflict",
            `Fusion trial ${trial.id} is sealed — seals are final.`,
          );
        }
        if (trial.status === "sealed") {
          throw new StorageError(
            "validation",
            "Trials seal via sealTrial only — the anti-circularity check cannot be bypassed.",
          );
        }
        await tbl.put({
          id: trial.id,
          trial: { ...trial, revision: newRevision },
          revision: newRevision,
          studyId: trial.studyId,
          stage: trial.stage,
          status: trial.status,
          createdAt: trial.createdAt,
        });
      });
      return newRevision;
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function sealTrial(
    trialId: string,
    expectedRevision: number,
    sealedAt: number,
  ): Promise<number> {
    db.assertWritable();
    const newRevision = expectedRevision + 1;
    const trialsTbl = getTable<FusionTrialRow, string>("fusionTrials");
    const recipesTbl = getTable<FusionRecipeRow, [string, number]>("fusionRecipes");
    try {
      await db.transaction("rw", trialsTbl, recipesTbl, async () => {
        const existing = await trialsTbl.get(trialId);
        if (!existing) throw new StorageError("conflict", `Fusion trial ${trialId} not found`);
        if (existing.revision !== expectedRevision) {
          throw new StorageError(
            "conflict",
            `Stale revision: expected ${expectedRevision}, got ${existing.revision}`,
          );
        }
        const trial = isFusionTrial(existing.trial) ? existing.trial : null;
        if (!trial) throw new StorageError("validation", "Invalid trial data");
        if (trial.status === "sealed") {
          throw new StorageError(
            "conflict",
            `Fusion trial ${trialId} is already sealed — seals are final.`,
          );
        }
        // Fuse trials reference a stored recipe (provenance must resolve);
        // the effective synthesizer is the trial's, else the recipe's.
        let recipeSynthesizer: CriticRef | null = null;
        if (trial.recipe !== null) {
          const recipeRow = await recipesTbl.get([trial.recipe.id, trial.recipe.version]);
          const recipe =
            recipeRow && isFusionRecipeVersion(recipeRow.recipe) ? recipeRow.recipe : null;
          if (!recipe) {
            throw new StorageError(
              "validation",
              `Recipe ${trial.recipe.id} v${trial.recipe.version} referenced by trial ${trialId} not found.`,
            );
          }
          recipeSynthesizer = recipe.synthesizer;
        }
        const synthesizer = trial.synthesizer ?? recipeSynthesizer;
        const conflict = findJudgeCircularityConflict(trial.judge1, trial.judge2, synthesizer);
        if (conflict) {
          throw new StorageError("conflict", conflict);
        }
        const sealed: FusionTrial = {
          ...trial,
          revision: newRevision,
          status: "sealed",
          sealedAt,
          updatedAt: sealedAt,
        };
        await trialsTbl.put({
          id: trial.id,
          trial: sealed,
          revision: newRevision,
          studyId: sealed.studyId,
          stage: sealed.stage,
          status: sealed.status,
          createdAt: sealed.createdAt,
        });
      });
      return newRevision;
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function recordTrialAttempt(attempt: FusionAttempt): Promise<void> {
    if (!isFusionAttempt(attempt)) throw new StorageError("validation", "Invalid fusion attempt");
    db.assertWritable();
    const attemptsTbl = getTable<FusionAttemptRow, string>("fusionAttempts");
    const trialsTbl = getTable<FusionTrialRow, string>("fusionTrials");
    try {
      await db.transaction("rw", attemptsTbl, trialsTbl, async () => {
        const existing = await attemptsTbl.get(attempt.id);
        if (existing) {
          throw new StorageError(
            "conflict",
            `Fusion attempt ${attempt.id} already exists — attempts are immutable.`,
          );
        }
        const [fromRow, toRow] = await Promise.all([
          trialsTbl.get(attempt.fromTrialId),
          trialsTbl.get(attempt.toTrialId),
        ]);
        const fromTrial = fromRow && isFusionTrial(fromRow.trial) ? fromRow.trial : null;
        const toTrial = toRow && isFusionTrial(toRow.trial) ? toRow.trial : null;
        const problem = validateTrialAttemptLink(attempt, fromTrial, toTrial);
        if (problem) throw new StorageError("validation", problem);
        await attemptsTbl.put({
          id: attempt.id,
          attempt,
          studyId: attempt.studyId,
          createdAt: attempt.createdAt,
        });
      });
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function listTrialAttempts(studyId: string): Promise<FusionAttempt[]> {
    try {
      const tbl = getTable<FusionAttemptRow, string>("fusionAttempts");
      const rows = await tbl.where("studyId").equals(studyId).toArray();
      return rows
        .map((r) => r.attempt)
        .filter((a): a is FusionAttempt => isFusionAttempt(a))
        .sort((a, b) => a.createdAt - b.createdAt);
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function addObservation(
    observation: EvaluationObservation,
    expectedTrialRevision: number,
  ): Promise<number> {
    if (!isEvaluationObservation(observation)) {
      throw new StorageError("validation", "Invalid evaluation observation");
    }
    db.assertWritable();
    try {
      let newRevision = expectedTrialRevision + 1;
      const obsTbl = getTable<FusionObservationRow, string>("fusionObservations");
      const trialsTbl = getTable<FusionTrialRow, string>("fusionTrials");
      await db.transaction("rw", obsTbl, trialsTbl, async () => {
        const existingObs = await obsTbl.get(observation.id);
        if (existingObs) {
          throw new StorageError(
            "conflict",
            `Observation ${observation.id} already exists — observations are immutable.`,
          );
        }
        const trialRow = await trialsTbl.get(observation.trialId);
        if (!trialRow) {
          throw new StorageError("conflict", `Fusion trial ${observation.trialId} not found`);
        }
        if (trialRow.revision !== expectedTrialRevision) {
          throw new StorageError(
            "conflict",
            `Stale revision: expected ${expectedTrialRevision}, got ${trialRow.revision}`,
          );
        }
        const trial = isFusionTrial(trialRow.trial) ? trialRow.trial : null;
        if (!trial) throw new StorageError("validation", "Invalid trial data");
        if (trial.status === "sealed") {
          throw new StorageError(
            "conflict",
            `Fusion trial ${trial.id} is sealed — observations attach while in_progress.`,
          );
        }
        newRevision = trialRow.revision + 1;
        const updated: FusionTrial = {
          ...trial,
          revision: newRevision,
          observationIds: [...trial.observationIds, observation.id],
          updatedAt: Date.now(),
        };
        await obsTbl.put({
          id: observation.id,
          observation,
          trialId: observation.trialId,
          createdAt: observation.finishedAt,
        });
        await trialsTbl.put({
          ...trialRow,
          trial: updated,
          revision: newRevision,
        });
      });
      return newRevision;
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function getObservation(id: string): Promise<EvaluationObservation | null> {
    try {
      const tbl = getTable<FusionObservationRow, string>("fusionObservations");
      const row = await tbl.get(id);
      if (!row) return null;
      return isEvaluationObservation(row.observation) ? row.observation : null;
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function listObservations(trialId: string): Promise<EvaluationObservation[]> {
    try {
      const tbl = getTable<FusionObservationRow, string>("fusionObservations");
      const rows = await tbl.where("trialId").equals(trialId).toArray();
      return rows
        .map((r) => r.observation)
        .filter((o): o is EvaluationObservation => isEvaluationObservation(o))
        .sort((a, b) => a.finishedAt - b.finishedAt);
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function createPlaybook(playbook: FusionPlaybook): Promise<void> {
    if (!isFusionPlaybook(playbook)) {
      throw new StorageError("validation", "Invalid fusion playbook");
    }
    db.assertWritable();
    const tbl = getTable<FusionPlaybookRow, string>("fusionPlaybooks");
    try {
      await db.transaction("rw", tbl, async () => {
        const existing = await tbl.get(playbook.id);
        if (existing) {
          throw new StorageError(
            "conflict",
            `Playbook ${playbook.id} already exists — playbooks are immutable.`,
          );
        }
        await tbl.put({
          id: playbook.id,
          playbook,
          studyId: playbook.studyId,
          createdAt: playbook.createdAt,
        });
      });
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function getPlaybook(id: string): Promise<FusionPlaybook | null> {
    try {
      const tbl = getTable<FusionPlaybookRow, string>("fusionPlaybooks");
      const row = await tbl.get(id);
      if (!row) return null;
      return isFusionPlaybook(row.playbook) ? row.playbook : null;
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  return {
    createRecipe,
    getRecipe,
    getLatestRecipe,
    listRecipes,
    createPoolManifest,
    getPoolManifest,
    getLatestPoolManifest,
    listPoolManifests,
    createStudy,
    updateStudy,
    getStudy,
    listStudies,
    createTrial,
    getTrial,
    listTrials,
    updateTrialLinks,
    sealTrial,
    recordTrialAttempt,
    listTrialAttempts,
    addObservation,
    getObservation,
    listObservations,
    createPlaybook,
    getPlaybook,
  };
}

// --- In-memory implementation -----------------------------------------------------

/**
 * In-memory FusionStudyRepository with identical validation and conflict
 * semantics to the Dexie implementation. Used by unit tests and non-persisted
 * orchestration.
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
