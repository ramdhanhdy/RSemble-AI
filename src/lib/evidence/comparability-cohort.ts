// =============================================================================
// RSemble AI — Comparability cohorts (spec §9)
//
// Cohort identity is a canonical fingerprint over:
//
//   - task relation (exact version/instance for direct comparison);
//   - rubric/version or verifier contract;
//   - protocol fingerprint and response mode;
//   - evaluator kind/model/version/configuration;
//   - tool/scaffold and reasoning policy;
//   - material provider/model-version identity.
//
// The builder returns the fingerprint plus disclosure fields, and a pure
// comparator produces human-readable split reasons between two cohort inputs.
// Incompatible cohorts may appear adjacent with disclosure but are never
// silently pooled: pooling is allowed only when fingerprints are equal.
// =============================================================================

import { canonicalJsonString, hashArtifactContent } from "../evaluations/protocol-fingerprint";
import type { VersionRef } from "../tasks/task-types";
import type { EvaluatorSnapshot } from "./evidence-types";

export interface ComparabilityCohortInput {
  taskId: string;
  taskVersion: number;
  taskInstanceId: string;
  rubricRef: VersionRef | null;
  verifierRef: VersionRef | null;
  protocolFingerprint: string;
  /** Expected response contract format (e.g. "json", "text"); null when unknown. */
  responseMode: string | null;
  evaluator: EvaluatorSnapshot;
  reasoningRequested: string | null;
  reasoningEffective: string | null;
  toolScaffoldSignature: string | null;
  providerId: string;
  resolvedModel: string;
  resolvedVersion: string | null;
}

export interface ComparabilityCohort {
  /** Canonical fingerprint: `sha256:<hex>` over the sorted cohort input. */
  id: string;
  canonicalJson: string;
  /** Disclosure: the resolved model version is known on this side. */
  versionKnown: boolean;
}

/**
 * Canonical serialization of the cohort input. Keys are recursively sorted and
 * the evaluator is pinned field-by-field, so property order and extra input
 * fields can never change the fingerprint.
 */
export function canonicalCohortJson(input: ComparabilityCohortInput): string {
  return canonicalJsonString({
    taskId: input.taskId,
    taskVersion: input.taskVersion,
    taskInstanceId: input.taskInstanceId,
    rubricRef: input.rubricRef,
    verifierRef: input.verifierRef,
    protocolFingerprint: input.protocolFingerprint,
    responseMode: input.responseMode,
    evaluator: {
      kind: input.evaluator.kind,
      providerId: input.evaluator.providerId,
      model: input.evaluator.model,
      resolvedVersion: input.evaluator.resolvedVersion,
      instructionDigest: input.evaluator.instructionDigest,
      reasoningEffort: input.evaluator.reasoningEffort,
      toolScaffoldSignature: input.evaluator.toolScaffoldSignature,
    },
    reasoningRequested: input.reasoningRequested,
    reasoningEffective: input.reasoningEffective,
    toolScaffoldSignature: input.toolScaffoldSignature,
    providerId: input.providerId,
    resolvedModel: input.resolvedModel,
    resolvedVersion: input.resolvedVersion,
  });
}

/** Build the cohort fingerprint plus disclosure fields (spec §9). */
export function buildComparabilityCohort(input: ComparabilityCohortInput): ComparabilityCohort {
  const canonicalJson = canonicalCohortJson(input);
  return {
    id: hashArtifactContent(canonicalJson),
    canonicalJson,
    versionKnown: input.resolvedVersion !== null,
  };
}

/** Pooling is allowed only for identical fingerprints — never silently. */
export function cohortsComparable(aCohortId: string, bCohortId: string): boolean {
  return aCohortId === bCohortId;
}

// --- Split reasons --------------------------------------------------------------

function fmtVersionRef(ref: VersionRef | null): string {
  return ref === null ? "none" : `${ref.id}@${ref.version}`;
}

function fmtNullable(v: string | null): string {
  return v === null ? "unknown" : `"${v}"`;
}

function diff(label: string, a: unknown, b: unknown): string | null {
  return a === b ? null : label;
}

/**
 * Human-readable reasons why two cohort inputs cannot be pooled, one line per
 * differing dimension. Deterministic: dimensions are compared in a fixed
 * order and only factual identities/hashes are embedded, never source content.
 */
export function cohortSplitReasons(
  a: ComparabilityCohortInput,
  b: ComparabilityCohortInput,
): string[] {
  const reasons: string[] = [];
  const push = (label: string, av: unknown, bv: unknown): void => {
    const reason = diff(label, av, bv);
    if (reason !== null) reasons.push(reason);
  };

  push(`Task identity differs (${JSON.stringify(a.taskId)} vs ${JSON.stringify(b.taskId)})`, a.taskId, b.taskId);
  push(`Task version differs (v${a.taskVersion} vs v${b.taskVersion})`, a.taskVersion, b.taskVersion);
  push(
    `Task instance differs (${JSON.stringify(a.taskInstanceId)} vs ${JSON.stringify(b.taskInstanceId)})`,
    a.taskInstanceId,
    b.taskInstanceId,
  );
  push(`Rubric differs (${fmtVersionRef(a.rubricRef)} vs ${fmtVersionRef(b.rubricRef)})`, fmtVersionRef(a.rubricRef), fmtVersionRef(b.rubricRef));
  push(
    `Verifier contract differs (${fmtVersionRef(a.verifierRef)} vs ${fmtVersionRef(b.verifierRef)})`,
    fmtVersionRef(a.verifierRef),
    fmtVersionRef(b.verifierRef),
  );
  push("Protocol fingerprint differs", a.protocolFingerprint, b.protocolFingerprint);
  push(
    `Response mode differs (${fmtNullable(a.responseMode)} vs ${fmtNullable(b.responseMode)})`,
    a.responseMode,
    b.responseMode,
  );
  push(
    `Evaluator kind differs (${JSON.stringify(a.evaluator.kind)} vs ${JSON.stringify(b.evaluator.kind)})`,
    a.evaluator.kind,
    b.evaluator.kind,
  );
  push(
    `Evaluator provider differs (${JSON.stringify(a.evaluator.providerId)} vs ${JSON.stringify(b.evaluator.providerId)})`,
    a.evaluator.providerId,
    b.evaluator.providerId,
  );
  push(
    `Evaluator model differs (${JSON.stringify(a.evaluator.model)} vs ${JSON.stringify(b.evaluator.model)})`,
    a.evaluator.model,
    b.evaluator.model,
  );
  push(
    `Evaluator version differs (${fmtNullable(a.evaluator.resolvedVersion)} vs ${fmtNullable(b.evaluator.resolvedVersion)})`,
    a.evaluator.resolvedVersion,
    b.evaluator.resolvedVersion,
  );
  push("Evaluator configuration differs", a.evaluator.instructionDigest, b.evaluator.instructionDigest);
  push(
    `Evaluator reasoning policy differs (${fmtNullable(a.evaluator.reasoningEffort)} vs ${fmtNullable(b.evaluator.reasoningEffort)})`,
    a.evaluator.reasoningEffort,
    b.evaluator.reasoningEffort,
  );
  push(
    "Evaluator tool scaffold differs",
    a.evaluator.toolScaffoldSignature,
    b.evaluator.toolScaffoldSignature,
  );
  push(
    `Reasoning policy differs (requested ${fmtNullable(a.reasoningRequested)} vs ${fmtNullable(b.reasoningRequested)})`,
    a.reasoningRequested,
    b.reasoningRequested,
  );
  push(
    `Reasoning policy differs (effective ${fmtNullable(a.reasoningEffective)} vs ${fmtNullable(b.reasoningEffective)})`,
    a.reasoningEffective,
    b.reasoningEffective,
  );
  push(
    "Tool scaffold differs",
    a.toolScaffoldSignature,
    b.toolScaffoldSignature,
  );
  push(
    `Provider differs (${JSON.stringify(a.providerId)} vs ${JSON.stringify(b.providerId)})`,
    a.providerId,
    b.providerId,
  );
  push(
    `Resolved model differs (${JSON.stringify(a.resolvedModel)} vs ${JSON.stringify(b.resolvedModel)})`,
    a.resolvedModel,
    b.resolvedModel,
  );
  push(
    `Resolved model version differs (${fmtNullable(a.resolvedVersion)} vs ${fmtNullable(b.resolvedVersion)})`,
    a.resolvedVersion,
    b.resolvedVersion,
  );

  return reasons;
}
