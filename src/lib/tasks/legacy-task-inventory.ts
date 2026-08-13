// =============================================================================
// RSemble AI — Legacy Task inventory
//
// Child 02 (Canonical Tasks) Milestone A — Task 4.
//
// Deterministic read-only inventory of legacy Task definitions from current
// EvaluationSuite records and immutable historical ExperimentRecord snapshots
// (spec §6.1, §6.2).
//
// Key properties (§6.2):
//   - deterministic migration scope `(legacySuiteId, legacyTaskId)` (§6.2 #1);
//   - one entry per distinct complete executable-definition digest within a
//     scope — deduplication is by exact digest, never by semantic text
//     inference (§9 non-goal: no automatic semantic deduplication);
//   - historical definitions sorted by explicit execution/suite chronology
//     with deterministic tie-breaks on experiment creation time and id
//     (§6.2 #3);
//   - the latest suite definition is included even when unexecuted (§6.2 #6);
//   - never auto-merged across different suite scopes (§6.2 #7, §4.2);
//   - missing/corrupt definitions stay explicit as `incomplete`; nothing is
//     ever fabricated into a complete definition (§6.4).
//
// Complete executable-definition digest: `sha256:<hex>` over the canonical
// JSON of the executable-definition slice — title, objective, candidate
// instruction, default context manifest, response contract, and the legacy
// verifier configuration — reusing `canonicalJsonString` and
// `hashArtifactContent` from `../evaluations/protocol-fingerprint`. Evaluation
// selection / judge instruction override stay inside the digest because §6.1
// names verifier/evaluation task definitions as required to reconstruct
// executable meaning. The context manifest is empty and the response contract
// is null for legacy tasks: embedded EvaluationTask objects have no separate
// response-contract field; the verifier configuration IS the legacy
// correctness contract.
//
// Pure/read-only domain logic only: no Dexie writes, no source-record
// mutation, no provider calls.
// =============================================================================

import {
  isEvaluationTask,
  isTaskVerification,
  type EvaluationTask,
  type EvaluationSuite,
  type ExperimentRecord,
} from "../evaluations/evaluation-types";
import { canonicalJsonString, hashArtifactContent } from "../evaluations/protocol-fingerprint";

// --- inventory types --------------------------------------------------------

/** Deterministic legacy migration scope (spec §6.2 #1). */
export interface LegacyScope {
  suiteId: string;
  taskId: string;
}

/**
 * Explicit chronology for one legacy definition observation (spec §6.2 #3).
 * `suiteVersion` is the primary explicit chronology coordinate; `executedAt`
 * is the snapshot creation time for experimental evidence, or null for a
 * suite edit that has never been executed (kept explicit per §6.2 #6).
 */
export interface LegacyChronology {
  suiteVersion: number;
  executedAt: number | null;
  experimentId: string | null;
}

/** Whether the observed definition could be reconstructed completely. */
export type LegacyDefinitionStatus = "complete" | "incomplete";

/**
 * Row family: `current` when the task still exists in the latest suite
 * definition; `orphaned-snapshot` when the only evidence of this scope now
 * lives in one or more historical experiment snapshots.
 */
export type LegacyInventoryFamily = "current" | "orphaned-snapshot";

/** Source of an observation for one inventory entry. */
export type LegacyInventorySource = "current-suite" | "experiment-snapshot";

/** A single most-recent observation of a legacy definition. */
export interface LegacyInventoryEntry {
  /** Deterministic inventory key: `<suiteId>::<taskId>::v<suiteVersion>`. */
  key: string;
  scope: LegacyScope;
  /** Origin the canonical Task will carry when migrated (spec §6.2 #2). */
  origin: "legacy-task-set";
  status: LegacyDefinitionStatus;
  /** `sha256:<hex>` complete executable-definition digest; null when the
   *  definition is missing/corrupt and must stay explicit (§6.4). */
  definitionDigest: string | null;
  /** Where this definition was observed, sorted. */
  sources: LegacyInventorySource[];
  family: LegacyInventoryFamily;
  /** Number of experiment snapshots that carried this exact definition. */
  executions: number;
  /** Latest known suite version for this scope. */
  latestSuiteVersion: number;
  /** Whether the task is still present in the current suite. */
  presentInCurrentSuite: boolean;
  /** Explicit chronological coordinates for this observation. */
  chronology: LegacyChronology;
  /** Snapshot of the complete executable definition slice, or null when the
   *  definition is incomplete/corrupt. */
  definition: LegacyExecutableDefinition | null;
}

/**
 * Full executable-definition slice used for digesting. Field names mirror the
 * canonical TaskVersion task-defining fields (§3.2) plus the legacy verifier
 * configuration which §6.1 requires to reconstruct executable meaning.
 */
export interface LegacyExecutableDefinition {
  title: string;
  objective: string;
  candidateInstruction: string;
  defaultContextManifest: never[];
  responseContract: null;
  taskVerifierRef: EvaluationTask["verification"] | null;
  evaluation: EvaluationTask["evaluation"];
  judgeInstructionOverride: string;
}

export interface LegacyTaskInventoryInput {
  suites: EvaluationSuite[];
  experiments: ExperimentRecord[];
}

export interface LegacyTaskInventory {
  entries: LegacyInventoryEntry[];
}

// --- status resolution ---------------------------------------------------------

/**
 * Classify one candidate legacy task definition.
 *
 * A definition is `complete` only when every field that contributes to the
 * executable meaning is present and valid. Missing or malformed fields keep
 * the row explicit (`incomplete`) and prevent any fabrication (§6.4).
 */
export function resolveLegacyDefinitionStatus(task: unknown): LegacyDefinitionStatus {
  if (typeof task !== "object" || task === null) return "incomplete";
  const partial = task as Partial<EvaluationTask>;
  if (typeof partial.id !== "string" || partial.id.length === 0) return "incomplete";
  if (typeof partial.title !== "string" || partial.title.length === 0) return "incomplete";
  if (typeof partial.prompt !== "string" || partial.prompt.length === 0) return "incomplete";
  if (typeof partial.systemPrompt !== "string") return "incomplete";
  if (typeof partial.judgeInstructionOverride !== "string") return "incomplete";
  if (partial.evaluation === undefined || partial.evaluation === null) return "incomplete";
  if (
    partial.evaluation.kind !== "inherit" &&
    partial.evaluation.kind !== "holistic" &&
    partial.evaluation.kind !== "profile"
  ) {
    return "incomplete";
  }
  if (partial.verification !== undefined && !isTaskVerification(partial.verification)) {
    return "incomplete";
  }
  return "complete";
}

// --- digest ---------------------------------------------------------------------

/**
 * Deterministic `sha256:<hex>` digest over the complete executable-definition
 * slice, reusing the repo's existing canonical JSON + artifact digest
 * primitives. Digests are integrity aids, not semantic identity (§4.1).
 */
export function computeLegacyExecutableDefinitionDigest(
  definition: LegacyExecutableDefinition,
): string {
  return hashArtifactContent(canonicalJsonString(definition));
}

// --- chronology and key helpers ---------------------------------------------------

export function legacyScopeKey(scope: LegacyScope, suiteVersion: number): string {
  return `${scope.suiteId}::${scope.taskId}::v${suiteVersion}`;
}

function compareScopes(a: LegacyScope, b: LegacyScope): number {
  if (a.suiteId !== b.suiteId) return a.suiteId < b.suiteId ? -1 : 1;
  if (a.taskId !== b.taskId) return a.taskId < b.taskId ? -1 : 1;
  return 0;
}

function compareNullableStrings(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

/**
 * Deterministic chronology comparison:
 *  1. suiteVersion ascending (explicit chronology, §6.2 #3);
 *  2. numeric executedAt before null (unexecuted latest suite edit always
 *     ends the chain, §6.2 #6);
 *  3. executedAt ascending;
 *  4. experimentId ascending as the final deterministic tie-break.
 */
function compareChronology(a: LegacyChronology, b: LegacyChronology): number {
  if (a.suiteVersion !== b.suiteVersion) return a.suiteVersion - b.suiteVersion;
  if (a.executedAt === null && b.executedAt !== null) return 1;
  if (a.executedAt !== null && b.executedAt === null) return -1;
  if (a.executedAt !== null && b.executedAt !== null && a.executedAt !== b.executedAt) {
    return a.executedAt - b.executedAt;
  }
  return compareNullableStrings(a.experimentId, b.experimentId);
}

function compareEntries(a: LegacyInventoryEntry, b: LegacyInventoryEntry): number {
  const byScope = compareScopes(a.scope, b.scope);
  if (byScope !== 0) return byScope;
  return compareChronology(a.chronology, b.chronology);
}

// --- accumulation ---------------------------------------------------------------

interface Accumulator {
  scope: LegacyScope;
  status: LegacyDefinitionStatus;
  definition: LegacyExecutableDefinition | null;
  digest: string | null;
  sources: Set<LegacyInventorySource>;
  executions: number;
  latestSuiteVersion: number;
  chronology: LegacyChronology[];
}

function toAccumulator(
  scope: LegacyScope,
  status: LegacyDefinitionStatus,
  chronology: LegacyChronology,
): Accumulator {
  return {
    scope,
    status,
    definition: null,
    digest: null,
    sources: new Set(),
    executions: 0,
    latestSuiteVersion: chronology.suiteVersion,
    chronology: [chronology],
  };
}

function emitAccumulator(
  acc: Accumulator,
  family: LegacyInventoryFamily,
  presentInCurrentSuite: boolean,
): LegacyInventoryEntry {
  const chronological = [...acc.chronology].sort(compareChronology)[0];
  return {
    key: legacyScopeKey(acc.scope, chronological.suiteVersion),
    scope: acc.scope,
    origin: "legacy-task-set" as const,
    status: acc.status,
    definitionDigest: acc.digest,
    sources: [...acc.sources].sort(),
    family,
    executions: acc.executions,
    latestSuiteVersion: acc.latestSuiteVersion,
    presentInCurrentSuite,
    chronology: chronological,
    definition: acc.definition,
  };
}

export function buildLegacyTaskInventory(
  input: LegacyTaskInventoryInput,
): LegacyTaskInventory {
  // Bucket per legacy scope, then per definition digest inside each scope.
  interface ScopeBucket {
    scope: LegacyScope;
    accumulatorsByDigest: Map<string, Accumulator>;
    incomplete: Accumulator[];
  }

  const buckets = new Map<string, ScopeBucket>();
  const presentInCurrentSuite = new Map<string, Set<string>>();

  function bucketFor(scope: LegacyScope): ScopeBucket {
    const k = `${scope.suiteId}\u0000${scope.taskId}`;
    let bucket = buckets.get(k);
    if (!bucket) {
      bucket = { scope, accumulatorsByDigest: new Map(), incomplete: [] };
      buckets.set(k, bucket);
    }
    return bucket;
  }

  // 1. Current suites — include the latest definition even when unexecuted.
  for (const suite of input.suites ?? []) {
    for (const task of suite.tasks ?? []) {
      const scope: LegacyScope = { suiteId: suite.id, taskId: task.id };
      const bucket = bucketFor(scope);
      const chronology: LegacyChronology = {
        suiteVersion: suite.version,
        executedAt: null,
        experimentId: null,
      };
      const status = resolveLegacyDefinitionStatus(task);

      if (status === "incomplete") {
        const acc = toAccumulator(scope, "incomplete", chronology);
        acc.sources.add("current-suite");
        bucket.incomplete.push(acc);
      } else {
        const definition: LegacyExecutableDefinition = {
          title: task.title,
          objective: task.prompt,
          candidateInstruction: task.systemPrompt,
          defaultContextManifest: [],
          responseContract: null,
          taskVerifierRef: task.verification ?? null,
          evaluation: task.evaluation,
          judgeInstructionOverride: task.judgeInstructionOverride,
        };
        const digest = computeLegacyExecutableDefinitionDigest(definition);
        let acc = bucket.accumulatorsByDigest.get(digest);
        if (!acc) {
          acc = toAccumulator(scope, "complete", chronology);
          acc.definition = definition;
          acc.digest = digest;
          bucket.accumulatorsByDigest.set(digest, acc);
        }
        acc.sources.add("current-suite");
        acc.chronology.push(chronology);
        acc.latestSuiteVersion = Math.max(acc.latestSuiteVersion, suite.version);
      }

      let tasks = presentInCurrentSuite.get(suite.id);
      if (!tasks) {
        tasks = new Set<string>();
        presentInCurrentSuite.set(suite.id, tasks);
      }
      tasks.add(task.id);
    }
  }

  // 2. Historical experiment snapshots — deterministic execution chronology.
  for (const experiment of input.experiments ?? []) {
    const snapshot = experiment.snapshot;
    if (!snapshot || !Array.isArray(snapshot.tasks)) continue;
    for (const rawTask of snapshot.tasks) {
      let taskId = "<unknown>";
      if (typeof rawTask === "object" && rawTask !== null && "id" in rawTask) {
        const maybeId = rawTask.id;
        if (typeof maybeId === "string" && maybeId.length > 0) taskId = maybeId;
      }
      const scope: LegacyScope = { suiteId: snapshot.suiteId, taskId };
      const bucket = bucketFor(scope);
      const chronology: LegacyChronology = {
        suiteVersion: snapshot.suiteVersion,
        executedAt: snapshot.createdAt,
        experimentId: experiment.id,
      };
      const status = resolveLegacyDefinitionStatus(rawTask);

      if (status === "incomplete") {
        const acc = toAccumulator(scope, "incomplete", chronology);
        acc.sources.add("experiment-snapshot");
        acc.executions = 1;
        bucket.incomplete.push(acc);
        continue;
      }

      const task = rawTask as EvaluationTask;
      const definition: LegacyExecutableDefinition = {
        title: task.title,
        objective: task.prompt,
        candidateInstruction: task.systemPrompt,
        defaultContextManifest: [],
        responseContract: null,
        taskVerifierRef: task.verification ?? null,
        evaluation: task.evaluation,
        judgeInstructionOverride: task.judgeInstructionOverride,
      };
      const digest = computeLegacyExecutableDefinitionDigest(definition);
      let acc = bucket.accumulatorsByDigest.get(digest);
      if (!acc) {
        acc = toAccumulator(scope, "complete", chronology);
        acc.definition = definition;
        acc.digest = digest;
        bucket.accumulatorsByDigest.set(digest, acc);
      }
      acc.sources.add("experiment-snapshot");
      acc.executions += 1;
      acc.chronology.push(chronology);
      acc.latestSuiteVersion = Math.max(acc.latestSuiteVersion, snapshot.suiteVersion);
    }
  }

  // 3. Assemble final entries.
  const entries: LegacyInventoryEntry[] = [];
  for (const bucket of buckets.values()) {
    const taskIds = presentInCurrentSuite.get(bucket.scope.suiteId) ?? new Set<string>();
    const isPresent = taskIds.has(bucket.scope.taskId);
    const family: LegacyInventoryFamily = isPresent ? "current" : "orphaned-snapshot";

    for (const acc of bucket.accumulatorsByDigest.values()) {
      entries.push(emitAccumulator(acc, family, isPresent));
    }
    for (const acc of bucket.incomplete) {
      entries.push(emitAccumulator(acc, family, isPresent));
    }
  }

  entries.sort(compareEntries);
  return { entries };
}

// Re-export the existing runtime validator so consumers do not need a second
// reach into the evaluation domain for the same structural guard.
export { isEvaluationTask };
