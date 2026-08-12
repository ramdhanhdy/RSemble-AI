// =============================================================================
// RSemble AI — Ad-hoc evaluation config (Compare workspace)
//
// Spec §9.3: Compare can choose holistic judgment, a pinned saved rubric,
// or one-off custom criteria. This type replaces the old RubricCriterion[].
// =============================================================================

import type {
  EvaluationRubric,
  RubricVersionRef,
  RubricSnapshot,
} from "./evaluation-types";

export type AdHocEvaluationConfig =
  | { kind: "holistic" }
  | { kind: "profile"; ref: RubricVersionRef; profile: RubricSnapshot }
  | { kind: "custom"; profile: RubricSnapshot };

/** Convenience constant for the default holistic evaluation. */
export const HOLISTIC_EVALUATION: AdHocEvaluationConfig = { kind: "holistic" };

/**
 * Resolve the evaluation rubric snapshot for the Judge, or null for holistic.
 * Candidate generation never receives this — only the Judge and (optionally)
 * Fusion.
 */
export function resolveEvaluationRubric(
  config: AdHocEvaluationConfig,
): RubricSnapshot | null {
  if (config.kind === "holistic") return null;
  return config.profile;
}

/**
 * Deep-copy an AdHocEvaluationConfig so later command edits cannot mutate
 * the frozen run snapshot.
 */
export function deepCopyEvaluationConfig(config: AdHocEvaluationConfig): AdHocEvaluationConfig {
  if (config.kind === "holistic") return { kind: "holistic" };
  return {
    kind: config.kind,
    ref: config.kind === "profile" ? { ...config.ref } : undefined,
    profile: JSON.parse(JSON.stringify(config.profile)) as EvaluationRubric,
  } as AdHocEvaluationConfig;
}
