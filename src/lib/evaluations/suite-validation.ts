// =============================================================================
// RSemble AI — Suite validation (spec §10.2)
//
// Validates suites before execution. Incomplete drafts can be saved, but
// execution requires: name, ≥2 enabled unique model keys, ≥1 valid task,
// ready Judge, and resolved evaluation selection.
// =============================================================================

import type { EvaluationSuite } from "./evaluation-types";
import { modelKey } from "../history-cache";

export interface SuiteValidationResult {
  valid: boolean;
  errors: SuiteValidationError[];
}

export interface SuiteValidationError {
  field: string;
  message: string;
}

/**
 * Full execution validation — blocks Run until all fields pass.
 * Drafts can be saved without passing this (suite save validation is separate).
 */
export function validateSuiteForExecution(suite: EvaluationSuite): SuiteValidationResult {
  const errors: SuiteValidationError[] = [];

  // Name
  if (!suite.name.trim()) {
    errors.push({ field: "name", message: "Suite name is required." });
  }

  // Tasks
  if (suite.tasks.length === 0) {
    errors.push({ field: "tasks", message: "At least one task is required." });
  }
  for (const task of suite.tasks) {
    if (!task.title.trim()) {
      errors.push({ field: `task.${task.id}.title`, message: `Task ${task.id}: title is required.` });
    }
    if (!task.prompt.trim()) {
      errors.push({ field: `task.${task.id}.prompt`, message: `Task ${task.id}: prompt is required.` });
    }
  }

  // Model roster: ≥2 enabled, unique opaque keys
  const enabledSlots = suite.modelSlots.filter((s) => s.enabled);
  if (enabledSlots.length < 2) {
    errors.push({ field: "modelSlots", message: "At least two enabled candidate models are required to run." });
  }
  const keys = enabledSlots.map((s) => modelKey(s.providerId, s.slug));
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) {
      errors.push({ field: "modelSlots", message: `Duplicate model key "${key}" — enabled models must have unique providerId:modelSlug.` });
      break;
    }
    seen.add(key);
  }

  // Judge
  if (!suite.defaultJudge.model.trim()) {
    errors.push({ field: "defaultJudge", message: "Judge model is required." });
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Suite save validation — allows incomplete drafts but validates basic structure.
 * Does not require ≥2 models or valid tasks.
 */
export function validateSuiteForSave(suite: EvaluationSuite): SuiteValidationResult {
  const errors: SuiteValidationError[] = [];

  if (!suite.name.trim()) {
    errors.push({ field: "name", message: "Suite name is required." });
  }

  // Check for duplicate model keys even on save (spec: duplicates rejected before provider calls)
  const enabledSlots = suite.modelSlots.filter((s) => s.enabled);
  const keys = enabledSlots.map((s) => modelKey(s.providerId, s.slug));
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) {
      errors.push({ field: "modelSlots", message: `Duplicate model key "${key}".` });
      break;
    }
    seen.add(key);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Check if a suite has unsaved changes by comparing semantic content.
 */
export function isSuiteDirty(
  persisted: EvaluationSuite,
  draft: EvaluationSuite,
): boolean {
  return JSON.stringify(stripMutable(persisted)) !== JSON.stringify(stripMutable(draft));
}

function stripMutable(suite: EvaluationSuite): Omit<EvaluationSuite, "revision" | "createdAt" | "updatedAt" | "archivedAt"> {
  const { revision, createdAt, updatedAt, archivedAt, ...rest } = suite;
  return rest;
}
