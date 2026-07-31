// =============================================================================
// RSemble AI — Fusion Study validation
//
// Execution-time validation for fusion recipes, pool manifests, judge pairs,
// and studies, mirroring suite-validation.ts. The anti-circularity rule
// (spec §5.3) lives here as a pure check consumed both at study-creation time
// and inside the sealTrial transaction.
// =============================================================================

import type { CriticRef } from "../providers/types";
import { modelKey } from "../history-cache";
import {
  FAMILY_ANALYSIS_MODE,
  type FusionRecipeVersion,
  type FusionStudy,
  type PoolManifestVersion,
} from "./fusion-study-types";

export interface FusionValidationError {
  field: string;
  message: string;
}

export interface FusionValidationResult {
  valid: boolean;
  errors: FusionValidationError[];
}

function result(errors: FusionValidationError[]): FusionValidationResult {
  return { valid: errors.length === 0, errors };
}

function criticKey(ref: CriticRef): string {
  return `${ref.providerId}:${ref.model}`;
}

/**
 * Anti-circularity check (spec §5.3): the holdout judge must differ from the
 * development judge AND from the synthesizer. Returns a message naming the
 * conflict, or null when the configuration is sound. sealTrial rejects on any
 * non-null result.
 */
export function findJudgeCircularityConflict(
  judge1: CriticRef,
  judge2: CriticRef,
  synthesizer: CriticRef,
): string | null {
  if (criticKey(judge2) === criticKey(judge1)) {
    return (
      `Anti-circularity violation: holdout judge ${criticKey(judge2)} equals ` +
      `development judge ${criticKey(judge1)} — the judge that informs synthesis ` +
      `must never evaluate its product.`
    );
  }
  if (criticKey(judge2) === criticKey(synthesizer)) {
    return (
      `Anti-circularity violation: holdout judge ${criticKey(judge2)} equals ` +
      `synthesizer ${criticKey(synthesizer)} — the synthesizer must never evaluate ` +
      `its own output.`
    );
  }
  return null;
}

/** Judge-pair well-formedness, including the anti-circularity rule. */
export function validateJudgePair(
  judge1: CriticRef,
  judge2: CriticRef,
  synthesizer: CriticRef,
): FusionValidationResult {
  const errors: FusionValidationError[] = [];
  if (!judge1.model.trim()) {
    errors.push({ field: "judge1", message: "Development judge model is required." });
  }
  if (!judge2.model.trim()) {
    errors.push({ field: "judge2", message: "Holdout judge model is required." });
  }
  const conflict = findJudgeCircularityConflict(judge1, judge2, synthesizer);
  if (conflict) {
    errors.push({ field: "judge2", message: conflict });
  }
  return result(errors);
}

/**
 * Pool manifest bounds (spec §5.6): core 6–8, challengers 0–2, active pool
 * ≤ 10, unique enabled providerId:slug keys across core + challengers.
 */
export function validatePoolManifest(manifest: PoolManifestVersion): FusionValidationResult {
  const errors: FusionValidationError[] = [];

  if (manifest.core.length < 6 || manifest.core.length > 8) {
    errors.push({
      field: "core",
      message: `Core pool must contain 6–8 models (got ${manifest.core.length}).`,
    });
  }
  if (manifest.challengers.length > 2) {
    errors.push({
      field: "challengers",
      message: `At most 2 suite challengers are allowed (got ${manifest.challengers.length}).`,
    });
  }
  if (manifest.core.length + manifest.challengers.length > 10) {
    errors.push({
      field: "core",
      message: "Active pool must not exceed 10 models.",
    });
  }

  const enabled = [...manifest.core, ...manifest.challengers].filter((s) => s.enabled);
  const keys = enabled.map((s) => modelKey(s.providerId, s.slug));
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) {
      errors.push({
        field: "core",
        message: `Duplicate pool model key ${key} — pool entries must be unique.`,
      });
      break;
    }
    seen.add(key);
  }

  if (manifest.diversityChecklist.length === 0) {
    errors.push({
      field: "diversityChecklist",
      message: "The diversity checklist must document at least one failure-mode axis.",
    });
  }
  if (!manifest.rationale.trim()) {
    errors.push({ field: "rationale", message: "Pool rationale is required." });
  }
  if (
    manifest.supersedesVersion !== null &&
    (!Number.isInteger(manifest.supersedesVersion) ||
      manifest.supersedesVersion < 1 ||
      manifest.supersedesVersion >= manifest.version)
  ) {
    errors.push({
      field: "supersedesVersion",
      message: "supersedesVersion must be a positive integer below this manifest's version.",
    });
  }
  return result(errors);
}

/**
 * Recipe required-fields validation (spec §5.2). The family determines the
 * judge-analysis mode — a mismatch means the record is internally inconsistent.
 */
export function validateRecipe(recipe: FusionRecipeVersion): FusionValidationResult {
  const errors: FusionValidationError[] = [];
  if (!recipe.id.trim()) {
    errors.push({ field: "id", message: "Recipe id is required." });
  }
  if (!Number.isInteger(recipe.version) || recipe.version < 1) {
    errors.push({ field: "version", message: "Recipe version must be a positive integer." });
  }
  if (!recipe.promptVersion.trim()) {
    errors.push({ field: "promptVersion", message: "Prompt version is required." });
  }
  const expectedMode = FAMILY_ANALYSIS_MODE[recipe.recipeFamily];
  if (recipe.judgeAnalysisMode !== expectedMode) {
    errors.push({
      field: "judgeAnalysisMode",
      message:
        `Recipe family ${recipe.recipeFamily} requires judgeAnalysisMode "${expectedMode}" ` +
        `(got "${recipe.judgeAnalysisMode}") — the family IS the ablation over judge analysis.`,
    });
  }
  if (!recipe.synthesizer.model.trim()) {
    errors.push({ field: "synthesizer", message: "Synthesizer model is required." });
  }
  return result(errors);
}

/**
 * Study validation: refs well-formed, at least one recipe, development and
 * holdout judges distinct, and confirmation linkage consistent with the study
 * kind (confirmation studies never re-select — spec §7.5).
 */
export function validateStudy(study: FusionStudy): FusionValidationResult {
  const errors: FusionValidationError[] = [];
  if (study.recipeRefs.length === 0) {
    errors.push({ field: "recipeRefs", message: "At least one recipe is required." });
  }
  if (criticKey(study.judge1) === criticKey(study.judge2)) {
    errors.push({
      field: "judge2",
      message:
        `Anti-circularity violation: holdout judge ${criticKey(study.judge2)} equals ` +
        `development judge ${criticKey(study.judge1)}.`,
    });
  }
  if (study.kind === "confirmation" && study.confirmationOf === null) {
    errors.push({
      field: "confirmationOf",
      message: "A confirmation study must reference the exploratory study it confirms.",
    });
  }
  if (study.kind === "exploration" && study.confirmationOf !== null) {
    errors.push({
      field: "confirmationOf",
      message: "An exploration study cannot reference a confirmation source.",
    });
  }
  if (study.kind === "exploration" && study.claimLevel !== "exploratory") {
    errors.push({
      field: "claimLevel",
      message: "Exploration studies always carry the exploratory claim level.",
    });
  }
  return result(errors);
}
