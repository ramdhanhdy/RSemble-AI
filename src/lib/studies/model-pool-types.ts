// =============================================================================
// RSemble AI — Model Pool types (spec §6.2)
//
// Stable ModelPoolRecord plus immutable ModelPoolVersion. A version preserves
// exact configuration members, core/challenger roles, diversity checklist,
// rationale, supersession, canonical serialized payload, and digest.
//
// Invariants enforced here:
//  - record: stable metadata (name, purpose, archive state, latest version
//    pointer, CAS revision);
//  - version: immutable on creation, content-addressed via canonical payload
//    and digest;
//  - digest is `sha256:<64 lowercase hex>` over the canonical JSON of the
//    version's material fields;
//  - canonicalPayload must match the material fields recomputed from the
//    version (tamper detection);
//  - NO aggregation or synthetic respondent semantics: the prohibited-key set
//    includes aggregation/synthetic fields (aggregatedScore,
//    syntheticRespondent, mergedEvidence, collectiveScore, aggregatedEvidence,
//    syntheticAnswer) rejected at any depth;
//  - prohibited credential/transport keys rejected at any depth.
//
// Pools do not merge model evidence, create a synthetic respondent, or imply
// comparability. They are experimental selection manifests.
//
// No persistence, provider, or UI lives here.
// =============================================================================

import type { ModelSlot } from "../../studio-data";
import { isModelSlot } from "../evaluations/evaluation-types";
import { canonicalStudyJson } from "./study-fingerprint";
import { hashArtifactContent } from "../evaluations/protocol-fingerprint";
import { isNonBlankString, isRecord } from "../persistence/run-types";

// --- Schema version -----------------------------------------------------------

export const MODEL_POOL_VERSION_SCHEMA_VERSION = 1;

// --- Prohibited keys (credential/transport + aggregation/synthetic) -----------

/**
 * Keys that must never appear in a persisted Model Pool at any depth.
 *
 * Includes two layers:
 *  1. Credential/transport vocabulary (mirrors the sibling study/evidence
 *     prohibited-key set) — prevents leaking secrets.
 *  2. Aggregation / synthetic-respondent vocabulary — enforces the spec
 *     constraint that pools never aggregate model evidence, create a
 *     synthetic respondent, or imply comparability (spec §6.2).
 */
export const MODEL_POOL_PROHIBITED_KEYS: ReadonlySet<string> = new Set([
  // credential / transport
  "apiKey",
  "authorization",
  "bearer",
  "cookie",
  "cookies",
  "credential",
  "credentials",
  "env",
  "headers",
  "password",
  "proxyUrl",
  "secret",
  "token",
  // aggregation / synthetic respondent — spec §6.2
  "aggregatedScore",
  "aggregatedEvidence",
  "collectiveScore",
  "mergedEvidence",
  "syntheticRespondent",
  "syntheticAnswer",
]);

/** Recursively deep-scan a value for prohibited pool keys. */
export function hasProhibitedPoolKeys(v: unknown): boolean {
  if (Array.isArray(v)) {
    return v.some(hasProhibitedPoolKeys);
  }
  if (!isRecord(v)) return false;
  for (const key of Object.keys(v)) {
    if (MODEL_POOL_PROHIBITED_KEYS.has(key)) return true;
    if (hasProhibitedPoolKeys(v[key])) return true;
  }
  return false;
}

// --- Shared value guards -------------------------------------------------------

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isNonNegativeInteger(v: unknown): v is number {
  return isFiniteNumber(v) && v >= 0 && Number.isInteger(v);
}

function isPositiveInteger(v: unknown): v is number {
  return isFiniteNumber(v) && v > 0 && Number.isInteger(v);
}

function isNonEmptyStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(isNonEmptyString);
}

// --- Canonical payload / digest -----------------------------------------------

/** Material content fields that define a pool version's identity. */
export interface ModelPoolContent {
  core: ModelSlot[];
  challengers: ModelSlot[];
  diversityChecklist: string[];
  rationale: string;
  supersedesVersion: number | null;
}

/**
 * Canonical JSON serialization of a pool version's material fields. Object
 * keys are sorted recursively; array order is preserved. Identical content
 * produces identical strings regardless of key insertion order.
 */
export function canonicalPoolPayload(content: ModelPoolContent): string {
  return canonicalStudyJson({
    core: content.core,
    challengers: content.challengers,
    diversityChecklist: content.diversityChecklist,
    rationale: content.rationale,
    supersedesVersion: content.supersedesVersion,
  });
}

/**
 * Content digest of a pool version: `sha256:<hex>` over the canonical JSON.
 * Stable under key permutation and changed by every material field.
 */
export function poolDigest(content: ModelPoolContent): string {
  return hashArtifactContent(canonicalPoolPayload(content));
}

// --- ModelPoolRecord (spec §6.2) ----------------------------------------------

/**
 * Stable record owning name, purpose, archive state, and latest version
 * pointer. Mutable only through CAS revision (append version, archive).
 */
export interface ModelPoolRecord {
  id: string;
  name: string;
  purpose: string;
  latestVersion: number;
  revision: number;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
}

export function isModelPoolRecord(v: unknown): v is ModelPoolRecord {
  if (!isRecord(v) || hasProhibitedPoolKeys(v)) return false;
  if (!isNonEmptyString(v.id)) return false;
  if (!isNonBlankString(v.name)) return false;
  if (!isNonBlankString(v.purpose)) return false;
  if (!isPositiveInteger(v.latestVersion)) return false;
  if (!isNonNegativeInteger(v.revision)) return false;
  if (!isFiniteNumber(v.createdAt) || v.createdAt < 0) return false;
  if (!isFiniteNumber(v.updatedAt) || v.updatedAt < 0) return false;
  if (v.updatedAt < v.createdAt) return false;
  if (v.archivedAt !== null) {
    if (!isFiniteNumber(v.archivedAt) || v.archivedAt < 0) return false;
    if (v.archivedAt < v.createdAt) return false;
  }
  return true;
}

// --- ModelPoolVersion (spec §6.2) ---------------------------------------------

/**
 * Immutable version of a Model Pool. Preserves exact configuration members,
 * core/challenger roles, diversity checklist, rationale, supersession,
 * canonical serialized payload, and digest. A referenced version cannot be
 * mutated or deleted; archived records remain resolvable from studies.
 */
export interface ModelPoolVersion {
  poolId: string;
  version: number;
  core: ModelSlot[];
  challengers: ModelSlot[];
  diversityChecklist: string[];
  rationale: string;
  supersedesVersion: number | null;
  canonicalPayload: string;
  digest: string;
  createdAt: number;
}

export function isModelPoolVersion(v: unknown): v is ModelPoolVersion {
  if (!isRecord(v) || hasProhibitedPoolKeys(v)) return false;
  if (!isNonEmptyString(v.poolId)) return false;
  if (!isPositiveInteger(v.version)) return false;
  if (!Array.isArray(v.core) || v.core.length === 0 || !v.core.every(isModelSlot)) return false;
  if (!Array.isArray(v.challengers) || !v.challengers.every(isModelSlot)) return false;
  if (!isNonEmptyStringArray(v.diversityChecklist) || v.diversityChecklist.length === 0)
    return false;
  if (!isNonBlankString(v.rationale)) return false;
  if (v.supersedesVersion !== null) {
    if (!isPositiveInteger(v.supersedesVersion)) return false;
  }
  if (!isNonEmptyString(v.canonicalPayload)) return false;
  if (!isNonEmptyString(v.digest)) return false;
  if (!/^sha256:[0-9a-f]{64}$/.test(v.digest)) return false;
  if (!isFiniteNumber(v.createdAt) || v.createdAt < 0) return false;
  // Tamper detection: canonicalPayload must match the material fields.
  const expectedPayload = canonicalPoolPayload({
    core: v.core,
    challengers: v.challengers,
    diversityChecklist: v.diversityChecklist,
    rationale: v.rationale,
    supersedesVersion: v.supersedesVersion,
  });
  if (v.canonicalPayload !== expectedPayload) return false;
  // Digest must match the canonical payload.
  if (v.digest !== hashArtifactContent(v.canonicalPayload)) return false;
  return true;
}
