// =============================================================================
// RSemble AI — Common study envelopes (spec §4.2, §4.3)
//
// Pure validators for the generic first-party study substrate. These envelopes
// own identity, lifecycle, lineage, exact costs, artifact references, schema
// versions, and prohibited-field scanning. Registered type validators own
// specialized payload semantics (see ./policy/policy-study-types.ts).
//
// Invariants enforced here:
//  - exactly one registered kind (`policy`) — no Routing/Judge/Workflow
//    placeholders;
//  - unknown kind/schema version, malformed discriminant, arbitrary JSON, and
//    recursive prohibited fields are rejected;
//  - draft CAS revision is a non-negative integer;
//  - start sealing: a sealed trial carries sealedAt, an in-progress one does not;
//  - completed immutability: a completed record carries a report ref, a draft
//    does not;
//  - archive rules: an archived record carries archivedAt, a non-archived one
//    does not;
//  - delete-only-untouched-draft: only drafts are deletable; started evidence
//    is archive-only;
//  - treatment-changing Trial/Attempt vs measurement-only Observation: an
//    Attempt links two distinct trials; an Observation references one trial;
//  - exploration/confirmation linkage: confirmed records carry confirmationOf,
//    exploratory records do not.
// =============================================================================

import { isNonBlankString, isRecord } from "../persistence/run-types";
import { isStudyFingerprint } from "./study-fingerprint";

// --- Registered kind / status / claim level -----------------------------------

/**
 * The single registered study kind. Exactly one kind is registered at child
 * completion — `policy`. No Routing/Judge/Workflow placeholders are encoded.
 */
export type StudyKind = "policy";

export type StudyStatus = "draft" | "in_progress" | "completed" | "failed" | "archived";

export const STUDY_STATUSES: readonly StudyStatus[] = [
  "draft",
  "in_progress",
  "completed",
  "failed",
  "archived",
];

export type StudyClaimLevel = "exploratory" | "confirmed";

export const STUDY_CLAIM_LEVELS: readonly StudyClaimLevel[] = ["exploratory", "confirmed"];

// --- Prohibited keys (credential/transport leak) ------------------------------

/**
 * Keys that must never appear in a persisted study record at any depth. Mirrors
 * the sibling evidence/fusion prohibited-key vocabulary so the workbench
 * rejects credential-shaped fields uniformly.
 */
export const STUDY_PROHIBITED_KEYS: ReadonlySet<string> = new Set([
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
export function hasProhibitedStudyKeys(v: unknown): boolean {
  if (Array.isArray(v)) {
    return v.some(hasProhibitedStudyKeys);
  }
  if (!isRecord(v)) return false;
  for (const key of Object.keys(v)) {
    if (STUDY_PROHIBITED_KEYS.has(key)) return true;
    if (hasProhibitedStudyKeys(v[key])) return true;
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

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(isNonEmptyString);
}

// --- TokenCost / artifact ref --------------------------------------------------

export interface TokenCost {
  tokensIn: number;
  tokensOut: number;
}

export function isTokenCost(v: unknown): v is TokenCost {
  return (
    isRecord(v) &&
    isFiniteNumber(v.tokensIn) &&
    v.tokensIn >= 0 &&
    isFiniteNumber(v.tokensOut) &&
    v.tokensOut >= 0
  );
}

export interface StudyArtifactRef {
  runId: string;
  attemptId: string;
  contentHash: string;
}

export function isStudyArtifactRef(v: unknown): v is StudyArtifactRef {
  return (
    isRecord(v) &&
    isNonEmptyString(v.runId) &&
    isNonEmptyString(v.attemptId) &&
    isStudyFingerprint(v.contentHash)
  );
}

function isStudyArtifactRefArray(v: unknown): v is StudyArtifactRef[] {
  return Array.isArray(v) && v.every(isStudyArtifactRef);
}

// --- StudyRecord (spec §4.2) ---------------------------------------------------

export interface StudyRecord<Definition> {
  id: string;
  /** CAS revision for draft definitions; incremented on each draft edit. */
  revision: number;
  kind: StudyKind;
  title: string;
  status: StudyStatus;
  claimLevel: StudyClaimLevel;
  definitionSchemaVersion: number;
  definitionFingerprint: string;
  definition: Definition;
  reportRef: string | null;
  /** Non-null only for confirmation studies linking their exploration parent. */
  confirmationOf: string | null;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
}

/**
 * Structural validator for the common StudyRecord envelope. Validates every
 * field except `definition` (typed as `unknown`); registered type validators
 * compose this guard with their specialized definition validator.
 */
export function isStudyRecordEnvelope(v: unknown): v is StudyRecord<unknown> {
  if (!isRecord(v) || hasProhibitedStudyKeys(v)) return false;
  if (!isNonEmptyString(v.id)) return false;
  if (!isNonNegativeInteger(v.revision)) return false;
  if (v.kind !== "policy") return false;
  if (!isNonBlankString(v.title)) return false;
  if (!isStudyStatus(v.status)) return false;
  if (!isStudyClaimLevel(v.claimLevel)) return false;
  if (!isPositiveInteger(v.definitionSchemaVersion)) return false;
  if (!isStudyFingerprint(v.definitionFingerprint)) return false;
  // reportRef: completed records must carry one; drafts must not.
  if (v.reportRef !== null && !isNonEmptyString(v.reportRef)) return false;
  if (v.status === "completed" && v.reportRef === null) return false;
  if (v.status === "draft" && v.reportRef !== null) return false;
  // confirmationOf: confirmed records must link; exploratory must not.
  if (v.confirmationOf !== null && !isNonEmptyString(v.confirmationOf)) return false;
  if (v.claimLevel === "confirmed" && v.confirmationOf === null) return false;
  if (v.claimLevel === "exploratory" && v.confirmationOf !== null) return false;
  if (!isFiniteNumber(v.createdAt) || v.createdAt < 0) return false;
  if (!isFiniteNumber(v.updatedAt) || v.updatedAt < 0) return false;
  if (v.updatedAt < v.createdAt) return false;
  // archivedAt: archived records must carry one; non-archived must not.
  if (v.archivedAt !== null) {
    if (!isFiniteNumber(v.archivedAt) || v.archivedAt < 0) return false;
    if (v.archivedAt < v.createdAt) return false;
  }
  if (v.status === "archived" && v.archivedAt === null) return false;
  if (v.status !== "archived" && v.archivedAt !== null) return false;
  return true;
}

// --- StudyTrial (spec §4.3) ----------------------------------------------------

export interface StudyTrial<Payload> {
  id: string;
  studyId: string;
  payloadKind: "policy";
  payloadSchemaVersion: number;
  payloadFingerprint: string;
  payload: Payload;
  status: "in_progress" | "sealed";
  sampleIndex: number;
  artifactRefs: StudyArtifactRef[];
  observationIds: string[];
  policyCost: TokenCost;
  experimentalCost: TokenCost;
  createdAt: number;
  sealedAt: number | null;
}

export function isStudyTrialEnvelope(v: unknown): v is StudyTrial<unknown> {
  if (!isRecord(v) || hasProhibitedStudyKeys(v)) return false;
  if (!isNonEmptyString(v.id) || !isNonEmptyString(v.studyId)) return false;
  if (v.payloadKind !== "policy") return false;
  if (!isPositiveInteger(v.payloadSchemaVersion)) return false;
  if (!isStudyFingerprint(v.payloadFingerprint)) return false;
  if (v.status !== "in_progress" && v.status !== "sealed") return false;
  if (!isNonNegativeInteger(v.sampleIndex)) return false;
  if (!isStudyArtifactRefArray(v.artifactRefs)) return false;
  if (!isStringArray(v.observationIds)) return false;
  if (!isTokenCost(v.policyCost) || !isTokenCost(v.experimentalCost)) return false;
  if (!isFiniteNumber(v.createdAt) || v.createdAt < 0) return false;
  // start sealing: sealed ⇒ sealedAt set; in_progress ⇒ sealedAt null.
  if (v.sealedAt !== null) {
    if (!isFiniteNumber(v.sealedAt) || v.sealedAt < 0) return false;
    if (v.sealedAt < v.createdAt) return false;
  }
  if (v.status === "sealed" && v.sealedAt === null) return false;
  if (v.status === "in_progress" && v.sealedAt !== null) return false;
  return true;
}

// --- StudyAttempt (spec §4.3) --------------------------------------------------

export interface StudyAttempt {
  id: string;
  studyId: string;
  /** Trial whose treatment was replaced. */
  fromTrialId: string;
  /** Successor trial carrying the new treatment (sampleIndex incremented). */
  toTrialId: string;
  reason: string;
  createdAt: number;
}

export function isStudyAttempt(v: unknown): v is StudyAttempt {
  if (!isRecord(v) || hasProhibitedStudyKeys(v)) return false;
  if (!isNonEmptyString(v.id) || !isNonEmptyString(v.studyId)) return false;
  if (!isNonEmptyString(v.fromTrialId) || !isNonEmptyString(v.toTrialId)) return false;
  // a treatment change creates a NEW trial — from and to must differ.
  if (v.fromTrialId === v.toTrialId) return false;
  if (!isNonBlankString(v.reason)) return false;
  if (!isFiniteNumber(v.createdAt) || v.createdAt < 0) return false;
  return true;
}

// --- StudyObservation (spec §4.3) ----------------------------------------------

export interface StudyObservation<Payload> {
  id: string;
  studyId: string;
  trialId: string;
  payloadKind: "policy_measurement";
  payloadSchemaVersion: number;
  payload: Payload;
  status: "completed" | "failed";
  sourceRunId: string | null;
  createdAt: number;
  finishedAt: number;
}

export function isStudyObservationEnvelope(v: unknown): v is StudyObservation<unknown> {
  if (!isRecord(v) || hasProhibitedStudyKeys(v)) return false;
  if (!isNonEmptyString(v.id) || !isNonEmptyString(v.studyId)) return false;
  if (!isNonEmptyString(v.trialId)) return false;
  if (v.payloadKind !== "policy_measurement") return false;
  if (!isPositiveInteger(v.payloadSchemaVersion)) return false;
  if (v.status !== "completed" && v.status !== "failed") return false;
  if (v.sourceRunId !== null && !isNonEmptyString(v.sourceRunId)) return false;
  if (!isFiniteNumber(v.createdAt) || v.createdAt < 0) return false;
  if (!isFiniteNumber(v.finishedAt) || v.finishedAt < 0) return false;
  if (v.finishedAt < v.createdAt) return false;
  return true;
}

// --- Lifecycle eligibility (spec §4.2) ----------------------------------------

/**
 * Only untouched drafts may be permanently deleted. Any study that started
 * paid execution is archive-only. Draft status is the signal that no paid
 * execution has started.
 */
export function isDeletableStudyRecord(record: StudyRecord<unknown>): boolean {
  return record.status === "draft";
}

/**
 * Started evidence is archive-only: any non-draft, non-archived record may be
 * archived but not deleted through normal repository APIs.
 */
export function isArchiveOnlyStudyRecord(record: StudyRecord<unknown>): boolean {
  return record.status !== "draft" && record.status !== "archived";
}

// --- Status / claim level guards ----------------------------------------------

export function isStudyStatus(v: unknown): v is StudyStatus {
  return isString(v) && (STUDY_STATUSES as readonly string[]).includes(v);
}

export function isStudyClaimLevel(v: unknown): v is StudyClaimLevel {
  return isString(v) && (STUDY_CLAIM_LEVELS as readonly string[]).includes(v);
}
