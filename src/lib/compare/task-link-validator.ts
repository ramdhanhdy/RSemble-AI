// =============================================================================
// RSemble AI — Task Link Validator pure rules (spec §7.3, §7.4)
//
// Child 05 (Contextual Compare Results) Milestone D — Task 8.
//
// Pure validator and exact-normalized match comparator for promoting/linking
// ad hoc comparisons to canonical Task Versions:
//   - Exact normalized match validation over candidateInstruction,
//     defaultContextManifest, and responseContract;
//   - No semantic similarity identity (spec §7.4): similarity never creates identity;
//   - Exact match candidate discovery for user review;
//   - Historical input completeness assessment (instance_input_incomplete);
//   - Zero provider calls / pure function contract.
// =============================================================================

import type { ContextManifestEntry, ResponseContract, TaskVersion } from "../tasks/task-types";
import { canonicalJsonString } from "../evaluations/protocol-fingerprint";

export interface ComparisonExecutableInput {
  prompt: string;
  contextManifest?: ContextManifestEntry[];
  responseContract?: ResponseContract | null;
}

export type TaskLinkMismatchField = "instruction" | "context_manifest" | "response_contract";

export interface TaskLinkMismatch {
  field: TaskLinkMismatchField;
  expected: unknown;
  actual: unknown;
  message: string;
}

export type TaskLinkValidationResult =
  | {
      ok: true;
      matchType: "exact";
    }
  | {
      ok: false;
      matchType: "mismatch";
      mismatches: TaskLinkMismatch[];
      message: string;
    };

export interface InputCompletenessAssessment {
  isMissingInput: boolean;
  completeness: "complete" | "incomplete" | "metadata_only";
  reason: "instance_input_incomplete" | null;
  details?: string;
}

/**
 * Normalizes instruction text by converting CRLF/CR line endings to LF and
 * trimming leading/trailing whitespace.
 */
export function normalizeInstruction(text: string): string {
  if (!text) return "";
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

/**
 * Normalizes context manifest entries for deterministic comparison.
 */
export function normalizeContextManifest(
  manifest?: ContextManifestEntry[] | null,
): ContextManifestEntry[] {
  if (!manifest || manifest.length === 0) return [];
  return manifest.map((entry) => ({
    role: entry.role,
    artifactId: entry.artifactId ?? null,
    externalRef: entry.externalRef ?? null,
    metadataDigest: entry.metadataDigest ?? null,
    mediaType: entry.mediaType ?? null,
    byteCount: entry.byteCount ?? null,
  }));
}

/**
 * Normalizes a ResponseContract for deterministic comparison.
 */
export function normalizeResponseContract(
  contract?: ResponseContract | null,
): ResponseContract | null {
  if (!contract) return null;
  return {
    format: contract.format,
    constraints: [...(contract.constraints || [])],
    maxLength: contract.maxLength ?? null,
  };
}

/**
 * Validates that an ad hoc comparison's executable input matches the stored
 * executable content of an existing Task Version (spec §7.3, §7.4).
 *
 * Checks:
 * 1. Normalized candidate-visible instruction text equality;
 * 2. Exact context manifest equality (order, roles, digests, metadata);
 * 3. Exact response contract equality (format, constraints, maxLength).
 *
 * Rejects semantic similarity: only exact normalized matches pass.
 */
export function validateTaskVersionLink(
  comparisonInput: ComparisonExecutableInput,
  taskVersion: TaskVersion,
): TaskLinkValidationResult {
  const mismatches: TaskLinkMismatch[] = [];

  // 1. Instruction match
  const inputInstruction = normalizeInstruction(comparisonInput.prompt);
  const versionInstruction = normalizeInstruction(taskVersion.candidateInstruction);

  if (inputInstruction !== versionInstruction) {
    mismatches.push({
      field: "instruction",
      expected: versionInstruction,
      actual: inputInstruction,
      message: `Candidate instruction does not match Task Version ${taskVersion.version} instruction.`,
    });
  }

  // 2. Context manifest match
  const inputManifest = normalizeContextManifest(comparisonInput.contextManifest);
  const versionManifest = normalizeContextManifest(taskVersion.defaultContextManifest);

  if (canonicalJsonString(inputManifest) !== canonicalJsonString(versionManifest)) {
    mismatches.push({
      field: "context_manifest",
      expected: versionManifest,
      actual: inputManifest,
      message: `Context manifest does not match Task Version ${taskVersion.version} context manifest.`,
    });
  }

  // 3. Response contract match
  const inputContract = normalizeResponseContract(comparisonInput.responseContract);
  const versionContract = normalizeResponseContract(taskVersion.responseContract);

  if (canonicalJsonString(inputContract) !== canonicalJsonString(versionContract)) {
    mismatches.push({
      field: "response_contract",
      expected: versionContract,
      actual: inputContract,
      message: `Response contract does not match Task Version ${taskVersion.version} response contract.`,
    });
  }

  if (mismatches.length > 0) {
    const summary = mismatches.map((m) => m.message).join(" ");
    return {
      ok: false,
      matchType: "mismatch",
      mismatches,
      message: summary,
    };
  }

  return {
    ok: true,
    matchType: "exact",
  };
}

/**
 * Pure helper to discover all exact-matching Task Versions from a candidate pool.
 * Only exact normalized matches are returned; semantic similarity is never used.
 */
export function findExactTaskMatches(
  comparisonInput: ComparisonExecutableInput,
  candidateVersions: TaskVersion[],
): TaskVersion[] {
  return candidateVersions.filter(
    (version) => validateTaskVersionLink(comparisonInput, version).ok,
  );
}

/**
 * Evaluates whether required historical input content is complete or missing
 * (spec §7.3). If historical input is missing, linking may be recorded for
 * navigation but evidence remains limited with `instance_input_incomplete`.
 */
export function assessInputCompleteness(
  comparisonInput: ComparisonExecutableInput,
  availableArtifactBytes?: Map<string, Uint8Array>,
): InputCompletenessAssessment {
  const trimmed = normalizeInstruction(comparisonInput.prompt);
  if (!trimmed) {
    return {
      isMissingInput: true,
      completeness: "incomplete",
      reason: "instance_input_incomplete",
      details: "Comparison prompt / candidate instruction is empty or missing.",
    };
  }

  const manifest = comparisonInput.contextManifest ?? [];
  if (manifest.length > 0 && availableArtifactBytes) {
    for (const entry of manifest) {
      if (entry.artifactId && !availableArtifactBytes.has(entry.artifactId)) {
        return {
          isMissingInput: true,
          completeness: "incomplete",
          reason: "instance_input_incomplete",
          details: `Context artifact "${entry.artifactId}" content bytes are not available.`,
        };
      }
    }
  }

  return {
    isMissingInput: false,
    completeness: "complete",
    reason: null,
  };
}
