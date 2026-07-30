// =============================================================================
// RSemble AI — Ad-hoc evaluation config (Compare workspace)
//
// Spec §9.3: Compare can choose holistic judgment, a pinned saved profile,
// or one-off custom criteria. This type replaces the old RubricCriterion[].
// =============================================================================

import type {
  EvaluationProfile,
  EvaluationProfileRef,
  EvaluationProfileSnapshot,
} from "./evaluation-types";

export type AdHocEvaluationConfig =
  | { kind: "holistic" }
  | { kind: "profile"; ref: EvaluationProfileRef; profile: EvaluationProfileSnapshot }
  | { kind: "custom"; profile: EvaluationProfileSnapshot };

/** Convenience constant for the default holistic evaluation. */
export const HOLISTIC_EVALUATION: AdHocEvaluationConfig = { kind: "holistic" };

/**
 * Resolve the evaluation profile snapshot for the Judge, or null for holistic.
 * Candidate generation never receives this — only the Judge and (optionally)
 * Fusion.
 */
export function resolveEvaluationProfile(
  config: AdHocEvaluationConfig,
): EvaluationProfileSnapshot | null {
  if (config.kind === "holistic") return null;
  return config.profile;
}

/**
 * Deep-copy an AdHocEvaluationConfig so later command edits cannot mutate
 * the frozen run snapshot.
 */
export function deepCopyEvaluationConfig(
  config: AdHocEvaluationConfig,
): AdHocEvaluationConfig {
  if (config.kind === "holistic") return { kind: "holistic" };
  return {
    kind: config.kind,
    ref: config.kind === "profile" ? { ...config.ref } : undefined,
    profile: JSON.parse(JSON.stringify(config.profile)) as EvaluationProfile,
  } as AdHocEvaluationConfig;
}
