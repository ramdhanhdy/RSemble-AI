// =============================================================================
// RSemble AI — Lab Recipe types (spec §6.1)
//
// Stable LabRecipeRecord plus immutable LabRecipeVersion. A version uses
// kind: "fusion" and preserves recipe family, prompt version, Judge-analysis
// mode, Rubric access, verification, exact synthesizer, canonical serialized
// payload, and digest.
//
// Invariants enforced here:
//  - exactly one recipe kind (`fusion`) — no Routing/Judge/Workflow
//    placeholders;
//  - record: stable metadata (name, description, archive state, latest version
//    pointer, CAS revision);
//  - version: immutable on creation, content-addressed via canonical payload
//    and digest;
//  - digest is `sha256:<64 lowercase hex>` over the canonical JSON of the
//    version's material fields — stable under key permutation, changed by
//    every material field;
//  - canonicalPayload must match the material fields recomputed from the
//    version (tamper detection);
//  - prohibited credential/transport keys rejected at any depth.
//
// No persistence, provider, or UI lives here.
// =============================================================================

import type { CriticRef } from "../providers/types";
import {
  type FusionRecipeFamily,
  type JudgeAnalysisMode,
  FUSION_RECIPE_FAMILIES,
  JUDGE_ANALYSIS_MODES,
} from "../evaluations/fusion-study-types";
import { isCriticRef, isModelSlot } from "../evaluations/evaluation-types";
import { canonicalStudyJson } from "./study-fingerprint";
import { hashArtifactContent } from "../evaluations/protocol-fingerprint";
import { isNonBlankString, isRecord } from "../persistence/run-types";

// --- Recipe kind --------------------------------------------------------------

/**
 * The single Lab Recipe kind. Only `fusion` is defined — synthesis is the one
 * reusable recipe domain. No Routing/Judge/Workflow placeholders.
 */
export type LabRecipeKind = "fusion";

export const LAB_RECIPE_KINDS: readonly LabRecipeKind[] = ["fusion"];

export const LAB_RECIPE_VERSION_SCHEMA_VERSION = 1;

export function isLabRecipeKind(v: unknown): v is LabRecipeKind {
  return typeof v === "string" && (LAB_RECIPE_KINDS as readonly string[]).includes(v);
}

// --- Prohibited keys (credential/transport leak) ------------------------------

/**
 * Keys that must never appear in a persisted Lab Recipe at any depth. Mirrors
 * the sibling study/evidence/fusion prohibited-key vocabulary.
 */
export const LAB_RECIPE_PROHIBITED_KEYS: ReadonlySet<string> = new Set([
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
]);

/** Recursively deep-scan a value for prohibited credential/transport keys. */
export function hasProhibitedRecipeKeys(v: unknown): boolean {
  if (Array.isArray(v)) {
    return v.some(hasProhibitedRecipeKeys);
  }
  if (!isRecord(v)) return false;
  for (const key of Object.keys(v)) {
    if (LAB_RECIPE_PROHIBITED_KEYS.has(key)) return true;
    if (hasProhibitedRecipeKeys(v[key])) return true;
  }
  return false;
}

// --- Shared value guards -------------------------------------------------------
function isString(v: unknown): v is string {
  return typeof v === "string";
}

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

function isBoolean(v: unknown): v is boolean {
  return typeof v === "boolean";
}

// --- Canonical payload / digest -----------------------------------------------

/** Material content fields that define a recipe version's identity. */
export interface LabRecipeContent {
  recipeFamily: FusionRecipeFamily;
  promptVersion: string;
  judgeAnalysisMode: JudgeAnalysisMode;
  rubricAccess: boolean;
  verification: boolean;
  synthesizer: CriticRef;
}

/**
 * Canonical JSON serialization of a recipe version's material fields. Object
 * keys are sorted recursively; array order is preserved. Identical content
 * produces identical strings regardless of key insertion order.
 */
export function canonicalRecipePayload(content: LabRecipeContent): string {
  return canonicalStudyJson({
    recipeFamily: content.recipeFamily,
    promptVersion: content.promptVersion,
    judgeAnalysisMode: content.judgeAnalysisMode,
    rubricAccess: content.rubricAccess,
    verification: content.verification,
    synthesizer: content.synthesizer,
  });
}

/**
 * Content digest of a recipe version: `sha256:<hex>` over the canonical JSON.
 * Stable under key permutation and changed by every material field.
 */
export function recipeDigest(content: LabRecipeContent): string {
  return hashArtifactContent(canonicalRecipePayload(content));
}

// --- LabRecipeRecord (spec §6.1) ----------------------------------------------

/**
 * Stable record owning name, description, archive state, latest version
 * pointer, and kind. Mutable only through CAS revision (append version,
 * archive). The latest version pointer advances when a new version is
 * appended; it never retreats.
 */
export interface LabRecipeRecord {
  id: string;
  kind: LabRecipeKind;
  name: string;
  description: string;
  latestVersion: number;
  revision: number;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
}

export function isLabRecipeRecord(v: unknown): v is LabRecipeRecord {
  if (!isRecord(v) || hasProhibitedRecipeKeys(v)) return false;
  if (!isNonEmptyString(v.id)) return false;
  if (!isLabRecipeKind(v.kind)) return false;
  if (!isNonBlankString(v.name)) return false;
  if (typeof v.description !== "string") return false;
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

// --- LabRecipeVersion (spec §6.1) ---------------------------------------------

/**
 * Immutable version of a Lab Recipe. Preserves recipe family, prompt version,
 * Judge-analysis mode, Rubric access, verification, exact synthesizer,
 * canonical serialized payload, and digest. A referenced version cannot be
 * mutated or deleted; archived records remain resolvable from studies.
 */
export interface LabRecipeVersion {
  recipeId: string;
  version: number;
  kind: LabRecipeKind;
  recipeFamily: FusionRecipeFamily;
  promptVersion: string;
  judgeAnalysisMode: JudgeAnalysisMode;
  rubricAccess: boolean;
  verification: boolean;
  synthesizer: CriticRef;
  canonicalPayload: string;
  digest: string;
  createdAt: number;
}

export function isLabRecipeVersion(v: unknown): v is LabRecipeVersion {
  if (!isRecord(v) || hasProhibitedRecipeKeys(v)) return false;
  if (!isNonEmptyString(v.recipeId)) return false;
  if (!isPositiveInteger(v.version)) return false;
  if (!isLabRecipeKind(v.kind)) return false;
  if (v.kind !== "fusion") return false;
  if (
    !isString(v.recipeFamily) ||
    !(FUSION_RECIPE_FAMILIES as readonly string[]).includes(v.recipeFamily)
  )
    return false;
  if (!isNonEmptyString(v.promptVersion)) return false;
  if (
    !isString(v.judgeAnalysisMode) ||
    !(JUDGE_ANALYSIS_MODES as readonly string[]).includes(v.judgeAnalysisMode)
  )
    return false;
  if (!isBoolean(v.rubricAccess)) return false;
  if (!isBoolean(v.verification)) return false;
  if (!isCriticRef(v.synthesizer)) return false;
  if (!isNonEmptyString(v.canonicalPayload)) return false;
  if (!isNonEmptyString(v.digest)) return false;
  if (!/^sha256:[0-9a-f]{64}$/.test(v.digest)) return false;
  if (!isFiniteNumber(v.createdAt) || v.createdAt < 0) return false;
  // Tamper detection: canonicalPayload must match the material fields.
  const expectedPayload = canonicalRecipePayload({
    recipeFamily: v.recipeFamily as FusionRecipeFamily,
    promptVersion: v.promptVersion,
    judgeAnalysisMode: v.judgeAnalysisMode as JudgeAnalysisMode,
    rubricAccess: v.rubricAccess,
    verification: v.verification,
    synthesizer: v.synthesizer as CriticRef,
  });
  if (v.canonicalPayload !== expectedPayload) return false;
  // Digest must match the canonical payload.
  if (v.digest !== hashArtifactContent(v.canonicalPayload)) return false;
  return true;
}

// --- Re-exported guards for convenience ---------------------------------------

export { isModelSlot };
