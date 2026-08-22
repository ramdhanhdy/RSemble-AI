// =============================================================================
// RSemble AI — Study fingerprint (spec §4.1, §4.2)
//
// Canonical serialization and content fingerprint for registered study
// definitions and payloads. Reuses the shared sorted-key JSON serializer and
// SHA-256 content hash from ../evaluations/protocol-fingerprint so every
// study hash in the workbench comes from one implementation.
//
// Invariants:
//  - stable under object-key permutation (canonical JSON sorts keys recursively);
//  - array order is preserved (policies, recipe refs, supporting ids are
//    semantically ordered);
//  - changed by every material field (every field participates in the
//    canonical JSON input);
//  - fingerprint shape is `sha256:<64 lowercase hex>`.
// =============================================================================

import { canonicalJsonString, hashArtifactContent } from "../evaluations/protocol-fingerprint";

/** Canonical fingerprint shape for study definitions and payloads. */
export const STUDY_FINGERPRINT_RE = /^sha256:[0-9a-f]{64}$/;

/** Type guard for the canonical study fingerprint shape. */
export function isStudyFingerprint(v: unknown): v is string {
  return typeof v === "string" && STUDY_FINGERPRINT_RE.test(v);
}

/**
 * Canonical JSON for a study value: object keys sorted recursively, array
 * order preserved. Identical values produce identical strings regardless of
 * key insertion order.
 */
export function canonicalStudyJson(value: unknown): string {
  return canonicalJsonString(value);
}

/**
 * Content fingerprint of a study value: `sha256:<hex>` over the canonical JSON.
 * Stable under key permutation and changed by every material field.
 */
export function fingerprintStudyValue(value: unknown): string {
  return hashArtifactContent(canonicalStudyJson(value));
}
