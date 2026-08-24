// =============================================================================
// RSemble AI — First-party study registry (spec §4.1)
//
// The study system uses an internal first-party registry. At child completion
// exactly one registration exists — kind = "policy". Unknown/unregistered
// kinds are rejected before persistence, execution, import, or route
// rendering. This is not a user-authored JSON-schema system or plugin SDK.
//
// No Routing/Judge/Workflow placeholders are registered.
// =============================================================================

import { policyStudyRegistration } from "./policy/policy-study-types";

// --- Registration interface (spec §4.1) ---------------------------------------

export interface StudyTypeRegistration<
  Definition,
  TrialPayload,
  ObservationPayload,
  ReportPayload,
> {
  readonly kind: string;
  readonly schemaVersion: number;
  validateDefinition(value: unknown): value is Definition;
  validateTrialPayload(value: unknown): value is TrialPayload;
  validateObservationPayload(value: unknown): value is ObservationPayload;
  validateReportPayload(value: unknown): value is ReportPayload;
  fingerprintDefinition(value: Definition): string;
}

/**
 * Type-erased registration view for registry storage and lookup. Concrete
 * registrations (e.g. the policy registration) are structurally assignable
 * because interface methods are bivariant and type predicates are covariant.
 */
export type AnyStudyTypeRegistration = StudyTypeRegistration<unknown, unknown, unknown, unknown>;

// --- Registry -----------------------------------------------------------------

const REGISTRY: Readonly<Record<string, AnyStudyTypeRegistration>> = {
  policy: policyStudyRegistration,
};

/** The full registry, keyed by kind. */
export const STUDY_REGISTRY: Readonly<Record<string, AnyStudyTypeRegistration>> = REGISTRY;

/** Every registered study kind, in registration order. */
export const REGISTERED_STUDY_KINDS: readonly string[] = Object.keys(REGISTRY);

/**
 * Look up a study type registration by kind. Returns null for unknown kinds.
 */
export function getStudyTypeRegistration(kind: string): AnyStudyTypeRegistration | null {
  return REGISTRY[kind] ?? null;
}

/** True when `kind` is a registered study kind. */
export function isRegisteredStudyKind(kind: unknown): boolean {
  return typeof kind === "string" && kind in REGISTRY;
}
