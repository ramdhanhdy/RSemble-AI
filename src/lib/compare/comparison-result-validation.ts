// =============================================================================
// RSemble AI — Comparison Result index runtime validators
//
// Child 05 (Contextual Compare Results) Milestone A — Task 1.
//
// Guards and detailed validators for the summary-only ComparisonResultIndex.
// Reuses the project's confirmed validation idioms (probe-P1 patterns):
//
//  - `EVIDENCE_PROHIBITED_KEYS` / `EVIDENCE_CONTENT_FIELDS` deep scan from
//    `../evidence/evidence-validation` — secret-shaped keys and raw
//    candidate-output / judge-rationale fields are rejected anywhere in an
//    index (spec §3, §13);
//  - `CREDENTIAL_LIKE_VALUE` + `ID_PATTERN` from `../tasks/task-validation` —
//    credential-shaped identifiers are rejected on every id-shaped field;
//  - `{ok, errors}` detailed validators plus boolean `is*` guards for the
//    persistence boundary. No unchecked casts: the validated value is rebuilt
//    field-by-field after every check passes.
//
// The index is exact-field: unknown keys are rejected so raw outputs or judge
// rationale can never ride along under a foreign field name. RunRecordV2
// remains the exact result authority; this module only validates the summary.
// =============================================================================

import {
  collectProhibitedFieldPaths,
  EVIDENCE_CONTENT_FIELDS,
  EVIDENCE_PROHIBITED_KEYS,
} from "../evidence/evidence-validation";
import { isRunStatus } from "../persistence/run-types";
import { CREDENTIAL_LIKE_VALUE, ID_PATTERN } from "../tasks/task-validation";
import type {
  ComparisonLineage,
  ComparisonMode,
  ComparisonResultIndex,
  ComparisonTaskBinding,
  PolicyPlaybookAttachment,
} from "./comparison-result-types";
/** Exact ComparisonResultIndex field set (spec §3) — no free-form fields. */
const COMPARISON_INDEX_FIELDS: ReadonlySet<string> = new Set([
  "id",
  "runId",
  "createdAt",
  "updatedAt",
  "status",
  "mode",
  "title",
  "taskBinding",
  "taskInstanceId",
  "activeObservationIds",
  "evidenceReceiptRevision",
  "lineage",
  "policyPlaybook",
  "revision",
]);

/** Exact ad-hoc binding field set (spec §3). */
const AD_HOC_BINDING_FIELDS: ReadonlySet<string> = new Set(["kind", "inputSnapshotRef"]);

/** Exact canonical binding field set (spec §3). */
const CANONICAL_BINDING_FIELDS: ReadonlySet<string> = new Set(["kind", "taskId", "taskVersion"]);

/** Exact lineage field set (spec §9). */
const LINEAGE_FIELDS: ReadonlySet<string> = new Set(["repeatedFrom"]);

const COMPARISON_MODES: readonly ComparisonMode[] = ["rank", "fuse"];

export interface ComparisonValidationError {
  field: string;
  message: string;
}

export type ComparisonValidationResult<T> =
  { ok: true; value: T } | { ok: false; errors: ComparisonValidationError[] };

function failed(errors: ComparisonValidationError[]): {
  ok: false;
  errors: ComparisonValidationError[];
} {
  return { ok: false, errors };
}

// --- primitive guards -------------------------------------------------------

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isNumber(v: unknown): v is number {
  return typeof v === "number" && !Number.isNaN(v);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isPositiveInteger(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1;
}

function isNonNegativeInteger(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

/** Opaque, non-secret identifier: non-empty, ID_PATTERN, never credential-shaped. */
function isSafeIdentifier(v: unknown): v is string {
  return isString(v) && v.length > 0 && ID_PATTERN.test(v) && !CREDENTIAL_LIKE_VALUE.test(v);
}

// --- component guards -------------------------------------------------------

export function isComparisonMode(v: unknown): v is ComparisonMode {
  return isString(v) && (COMPARISON_MODES as readonly string[]).includes(v);
}

// --- {ok, errors} validators ------------------------------------------------

export function validateComparisonTaskBinding(
  v: unknown,
): ComparisonValidationResult<ComparisonTaskBinding> {
  const errors: ComparisonValidationError[] = [];
  if (!isRecord(v)) {
    return failed([{ field: "taskBinding", message: "taskBinding must be an object." }]);
  }
  if (v.kind === "ad_hoc") {
    for (const key of Object.keys(v)) {
      if (!AD_HOC_BINDING_FIELDS.has(key)) {
        errors.push({
          field: `taskBinding.${key}`,
          message: `unknown field "${key}" on ad_hoc binding.`,
        });
      }
    }
    if (!isSafeIdentifier(v.inputSnapshotRef)) {
      errors.push({
        field: "taskBinding.inputSnapshotRef",
        message: "ad_hoc binding requires a safe opaque inputSnapshotRef.",
      });
    }
  } else if (v.kind === "canonical") {
    for (const key of Object.keys(v)) {
      if (!CANONICAL_BINDING_FIELDS.has(key)) {
        errors.push({
          field: `taskBinding.${key}`,
          message: `unknown field "${key}" on canonical binding.`,
        });
      }
    }
    if (!isSafeIdentifier(v.taskId)) {
      errors.push({
        field: "taskBinding.taskId",
        message: "canonical binding requires a safe opaque taskId.",
      });
    }
    if (!isPositiveInteger(v.taskVersion)) {
      errors.push({
        field: "taskBinding.taskVersion",
        message: "taskVersion must be a positive integer.",
      });
    }
  } else {
    errors.push({
      field: "taskBinding.kind",
      message: 'kind must be "ad_hoc" or "canonical".',
    });
  }
  if (errors.length > 0) return failed(errors);
  if (v.kind === "ad_hoc") {
    return { ok: true, value: { kind: "ad_hoc", inputSnapshotRef: v.inputSnapshotRef as string } };
  }
  return {
    ok: true,
    value: {
      kind: "canonical",
      taskId: v.taskId as string,
      taskVersion: v.taskVersion as number,
    },
  };
}

export function validateComparisonLineage(
  v: unknown,
): ComparisonValidationResult<ComparisonLineage> {
  const errors: ComparisonValidationError[] = [];
  if (!isRecord(v)) {
    return failed([{ field: "lineage", message: "lineage must be an object." }]);
  }
  for (const key of Object.keys(v)) {
    if (!LINEAGE_FIELDS.has(key)) {
      errors.push({ field: `lineage.${key}`, message: `unknown field "${key}" on lineage.` });
    }
  }
  if (v.repeatedFrom !== null && !isSafeIdentifier(v.repeatedFrom)) {
    errors.push({
      field: "lineage.repeatedFrom",
      message: "repeatedFrom must be null or a safe opaque comparison id.",
    });
  }
  if (errors.length > 0) return failed(errors);
  return { ok: true, value: { repeatedFrom: v.repeatedFrom as string | null } };
}

export function validateComparisonResultIndex(
  v: unknown,
): ComparisonValidationResult<ComparisonResultIndex> {
  const errors: ComparisonValidationError[] = [];
  if (!isRecord(v)) {
    return failed([{ field: "", message: "ComparisonResultIndex must be an object." }]);
  }

  for (const key of Object.keys(v)) {
    if (!COMPARISON_INDEX_FIELDS.has(key)) {
      errors.push({ field: key, message: `unknown field "${key}" on ComparisonResultIndex.` });
    }
  }

  if (!isSafeIdentifier(v.id)) {
    errors.push({ field: "id", message: "id must be a safe opaque identifier." });
  }
  if (!isSafeIdentifier(v.runId)) {
    errors.push({ field: "runId", message: "runId must be a safe opaque identifier." });
  }
  if (isSafeIdentifier(v.id) && isSafeIdentifier(v.runId) && v.id !== v.runId) {
    errors.push({
      field: "runId",
      message: "id must equal runId (comparisonId == runId, spec §3).",
    });
  }

  if (!isNumber(v.createdAt)) {
    errors.push({ field: "createdAt", message: "createdAt must be a number." });
  }
  if (!isNumber(v.updatedAt)) {
    errors.push({ field: "updatedAt", message: "updatedAt must be a number." });
  }
  if (!isRunStatus(v.status)) {
    errors.push({ field: "status", message: "status must be a valid RunStatus." });
  }
  if (!isComparisonMode(v.mode)) {
    errors.push({ field: "mode", message: 'mode must be "rank" or "fuse".' });
  }
  if (!isString(v.title)) {
    errors.push({ field: "title", message: "title must be a string." });
  }

  const binding = validateComparisonTaskBinding(v.taskBinding);
  if (!binding.ok) errors.push(...binding.errors);

  if (v.taskInstanceId !== null && !isSafeIdentifier(v.taskInstanceId)) {
    errors.push({
      field: "taskInstanceId",
      message: "taskInstanceId must be null or a safe opaque identifier.",
    });
  }
  if (isRecord(v.taskBinding) && v.taskBinding.kind === "ad_hoc" && v.taskInstanceId !== null) {
    errors.push({
      field: "taskInstanceId",
      message: "ad_hoc comparisons must not carry a taskInstanceId.",
    });
  }

  if (!Array.isArray(v.activeObservationIds)) {
    errors.push({
      field: "activeObservationIds",
      message: "activeObservationIds must be an array.",
    });
  } else {
    const seen = new Set<string>();
    v.activeObservationIds.forEach((id, index) => {
      if (!isSafeIdentifier(id)) {
        errors.push({
          field: `activeObservationIds[${index}]`,
          message: "observation ids must be safe opaque identifiers.",
        });
      } else if (seen.has(id)) {
        errors.push({
          field: `activeObservationIds[${index}]`,
          message: `duplicate observation id "${id}".`,
        });
      } else {
        seen.add(id);
      }
    });
  }

  if (!isNonNegativeInteger(v.evidenceReceiptRevision)) {
    errors.push({
      field: "evidenceReceiptRevision",
      message: "evidenceReceiptRevision must be a non-negative integer.",
    });
  }

  const lineage = validateComparisonLineage(v.lineage);
  if (!lineage.ok) errors.push(...lineage.errors);
  if (
    isRecord(v.lineage) &&
    isSafeIdentifier(v.id) &&
    isSafeIdentifier(v.lineage.repeatedFrom) &&
    v.lineage.repeatedFrom === v.id
  ) {
    errors.push({
      field: "lineage.repeatedFrom",
      message: "a comparison cannot repeat from itself.",
    });
  }
  if ("policyPlaybook" in v && v.policyPlaybook !== null && v.policyPlaybook !== undefined) {
    if (!isRecord(v.policyPlaybook)) {
      errors.push({
        field: "policyPlaybook",
        message: "policyPlaybook must be an object or null.",
      });
    } else {
      if (!isSafeIdentifier(v.policyPlaybook.playbookId)) {
        errors.push({
          field: "policyPlaybook.playbookId",
          message: "playbookId must be a safe identifier.",
        });
      }
      if (!isSafeIdentifier(v.policyPlaybook.studyId)) {
        errors.push({
          field: "policyPlaybook.studyId",
          message: "studyId must be a safe identifier.",
        });
      }
      if (typeof v.policyPlaybook.definitionFingerprint !== "string") {
        errors.push({
          field: "policyPlaybook.definitionFingerprint",
          message: "definitionFingerprint must be a string.",
        });
      }
      if (!isRecord(v.policyPlaybook.compatibility)) {
        errors.push({
          field: "policyPlaybook.compatibility",
          message: "compatibility must be an object.",
        });
      }
    }
  }

  if (!isNonNegativeInteger(v.revision)) {
    errors.push({ field: "revision", message: "revision must be a non-negative integer." });
  }

  // Deep prohibited-content scan (evidence idiom): secret-bearing keys and
  // raw candidate-output / judge-rationale field names are rejected anywhere
  // in the tree, defense-in-depth on top of the exact-field checks above.
  const paths: string[] = [];
  collectProhibitedFieldPaths(v, "", paths);
  for (const path of paths) errors.push({ field: "", message: path });

  if (errors.length > 0) return failed(errors);
  // Unreachable in practice (any failed component pushed errors above), but
  // required for TypeScript to narrow both component results to their ok arm.
  if (!binding.ok || !lineage.ok) return failed(errors);
  return {
    ok: true,
    value: {
      id: v.id as string,
      runId: v.runId as string,
      createdAt: v.createdAt as number,
      updatedAt: v.updatedAt as number,
      status: v.status as ComparisonResultIndex["status"],
      mode: v.mode as ComparisonMode,
      title: v.title as string,
      taskBinding: binding.value,
      taskInstanceId: v.taskInstanceId as string | null,
      activeObservationIds: [...(v.activeObservationIds as string[])],
      evidenceReceiptRevision: v.evidenceReceiptRevision as number,
      lineage: lineage.value,
      policyPlaybook: (v.policyPlaybook as PolicyPlaybookAttachment | null) ?? null,
      revision: v.revision as number,
    },
  };
}

// --- boolean guards ---------------------------------------------------------

export function isComparisonTaskBinding(v: unknown): v is ComparisonTaskBinding {
  return validateComparisonTaskBinding(v).ok;
}

export function isComparisonLineage(v: unknown): v is ComparisonLineage {
  return validateComparisonLineage(v).ok;
}

export function isComparisonResultIndex(v: unknown): v is ComparisonResultIndex {
  return validateComparisonResultIndex(v).ok;
}

// --- shared idiom exports ---------------------------------------------------

/** Secret-bearing keys the index rejects (evidence superset, spec §13). */
export const COMPARISON_PROHIBITED_KEYS = EVIDENCE_PROHIBITED_KEYS;

/** Raw candidate-output / judge-rationale field names the index rejects. */
export const COMPARISON_CONTENT_FIELDS = EVIDENCE_CONTENT_FIELDS;
