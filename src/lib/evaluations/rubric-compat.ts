// =============================================================================
// RSemble AI — Rubric terminology compatibility surface
//
// Explicit deprecated re-export surface for the legacy "evaluation profile"
// terminology that preceded the canonical Rubric domain names introduced in
// `evaluation-types.ts` and `evaluation-rubric.ts`.
//
// New domain code MUST import canonical names directly:
//   - types/guards: `EvaluationRubric`, `RubricRecord`, `RubricVersionRef`,
//     `RubricSnapshot`, `isEvaluationRubric`, `isRubricRecord`,
//     `isRubricVersionRef` from `./evaluation-types`
//   - scoring helpers: `validateRubric`, `isComplianceOnlyRubric`, etc. from
//     `./evaluation-rubric`
//
// The legacy names re-exported here exist only to keep existing consumers
// compiling during the staged terminology migration (rubric-terminology spec
// §3.2/§7). Persisted field and store names (`evaluationProfileId`, `profiles`,
// `profileVersions`, archive v1 `profiles`) are frozen and unchanged — these
// aliases are domain-name bridges only, never serialization identifiers.
//
// Removal: delete this module once every consumer imports canonical names.
// =============================================================================

export type {
  EvaluationProfile,
  EvaluationProfileSnapshot,
  ProfileRecord,
  EvaluationProfileRef,
} from "./evaluation-types";

export {
  isEvaluationProfile,
  isProfileRecord,
  isEvaluationProfileRef,
} from "./evaluation-types";

export {
  validateProfile,
  isComplianceOnlyProfile,
} from "./evaluation-rubric";
