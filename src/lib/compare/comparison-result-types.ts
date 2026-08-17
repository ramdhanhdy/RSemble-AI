// =============================================================================
// RSemble AI — Comparison Result index domain types
//
// Child 05 (Contextual Compare Results) Milestone A — Task 1.
//
// The ComparisonResultIndex is a summary-only read model (spec §3): one index
// per full Compare run, keyed `comparisonId == runId`. It NEVER copies
// candidate outputs, judge reports/rationale, or fused documents —
// RunRecordV2 remains the exact result authority. Runtime validators live in
// ./comparison-result-validation.
// =============================================================================

import type { RunStatus } from "../persistence/run-types";

/** Execution mode of the source comparison run (spec §3). */
export type ComparisonMode = "rank" | "fuse";

/**
 * Task binding of a comparison (spec §3, §7).
 *
 * - `ad_hoc` references the immutable input snapshot persisted before any
 *   paid call (spec §5). No canonical identity is claimed.
 * - `canonical` pins an exact Task Version; the run's Task Instance is stored
 *   separately in `ComparisonResultIndex.taskInstanceId`.
 */
export type ComparisonTaskBinding =
  | { kind: "ad_hoc"; inputSnapshotRef: string }
  | { kind: "canonical"; taskId: string; taskVersion: number };

/**
 * Recovery lineage (spec §9). `repeatedFrom` is the comparison id (== run id)
 * of the deliberate "Run again as new comparison" source. It is a link only:
 * a repeated comparison is never declared an independent replicate unless a
 * protocol explicitly says so.
 */
export interface ComparisonLineage {
  repeatedFrom: string | null;
}

/**
 * Summary-only comparison result index (spec §3). Exact output content stays
 * in the source RunRecordV2; this index carries identity, lifecycle, task
 * linkage, evidence pointers, and lineage only.
 */
export interface ComparisonResultIndex {
  /** Comparison id — always equal to the source run id (`comparisonId == runId`). */
  id: string;
  runId: string;
  createdAt: number;
  updatedAt: number;
  status: RunStatus;
  mode: ComparisonMode;
  title: string;
  taskBinding: ComparisonTaskBinding;
  taskInstanceId: string | null;
  activeObservationIds: string[];
  evidenceReceiptRevision: number;
  lineage: ComparisonLineage;
  /** CAS revision for binding/lineage updates (compare-and-swap). */
  revision: number;
}
