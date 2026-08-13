// =============================================================================
// RSemble AI — Exact Task reference resolution
//
// Child 02 (Canonical Tasks) Milestone D, Task 9.
//
// Resolves current Suite and historical Experiment coordinates through exact
// migration crosswalks. Never selects the latest Task Version as a fallback.
// Incomplete definitions, absent/corrupt crosswalks, and metadata-only
// instances stay explicit. Secret-shaped text is never copied into the
// read model.
// =============================================================================

import type {
  EvaluationSuite,
  EvaluationTask,
  ExperimentRecord,
} from "../evaluations/evaluation-types";
import {
  computeLegacyExecutableDefinitionDigest,
  resolveLegacyDefinitionStatus,
  type LegacyExecutableDefinition,
} from "./legacy-task-inventory";
import { CREDENTIAL_LIKE_VALUE } from "./task-validation";
import type {
  TaskInstance,
  TaskOrigin,
  TaskRecord,
  TaskVersion,
} from "./task-types";

/** Stored legacy → canonical crosswalk (spec §6.2). */
export interface TaskMigrationCrosswalk {
  legacyScopeKey: string;
  taskId: string;
  taskVersion: number;
}

export interface ParsedLegacyCrosswalkKey {
  suiteId: string;
  suiteVersion: number;
  taskId: string;
  definitionDigest: string;
}

export interface TaskReferenceSources {
  task: TaskRecord;
  versions: TaskVersion[];
  crosswalks: TaskMigrationCrosswalk[];
  suites: EvaluationSuite[];
  experiments: ExperimentRecord[];
  instances: TaskInstance[];
  /** False when current suites/experiments were not read for this model. */
  liveScanAvailable: boolean;
  /** Explicit unresolved inventory keys from the migration marker. */
  unresolvedInventoryKeys?: string[];
}

export type TaskReferenceResolutionState = "resolved" | "unresolved";
export type TaskInstanceReferenceState = "resolved" | "metadata_only" | "incomplete";

export interface TaskSuiteReference {
  suiteId: string;
  suiteVersion: number;
  suiteName: string | null;
  legacyTaskId: string;
  taskVersion: number | null;
  state: TaskReferenceResolutionState;
  limitation: string | null;
}

export interface TaskExperimentReference {
  experimentId: string;
  suiteId: string;
  suiteVersion: number;
  legacyTaskId: string;
  taskVersion: number | null;
  state: TaskReferenceResolutionState;
  limitation: string | null;
}

export interface TaskInstanceReference {
  id: string;
  taskVersion: number;
  inputDigestAbbreviation: string;
  sourceKind: TaskInstance["sourceRef"]["kind"];
  createdAt: number;
  state: TaskInstanceReferenceState;
  useCount: null;
}

export interface TaskUnresolvedDefinition {
  key: string;
  suiteId: string;
  suiteVersion: number | null;
  legacyTaskId: string;
  taskVersion: null;
  state: "unresolved";
  limitation: string;
}

export interface TaskReferenceCounts {
  currentSuites: number;
  experiments: number;
  instancesComplete: number;
  instancesMetadataOnly: number;
  instancesIncomplete: number;
  unresolvedDefinitions: number;
  absentOrCorruptCrosswalks: number;
  archivedReferencedVersions: number;
  total: number;
}

export interface TaskReferenceReadModel {
  taskId: string;
  task: TaskRecord;
  origin: TaskOrigin;
  originLimitation: string;
  currentSuites: TaskSuiteReference[];
  experiments: TaskExperimentReference[];
  instances: TaskInstanceReference[];
  unresolvedDefinitions: TaskUnresolvedDefinition[];
  counts: TaskReferenceCounts;
}

export interface TaskReferenceSummary {
  total: number;
  unresolved: number;
}

const CROSSWALK_KEY =
  /^(.+)::v(\d+)::(.+)::(sha256:[0-9a-f]+)$/i;
const SCOPE_KEY = /^(.+)::(.+)$/;
const INVENTORY_KEY = /^(.+)::(.+)::v(\d+)$/;
const UNRECONSTRUCTABLE =
  "The historical definition cannot reconstruct an executable Task Version.";

/** Parse the suite/version/task/digest authority coordinate. Never guesses. */
export function parseLegacyCrosswalkKey(key: string): ParsedLegacyCrosswalkKey | null {
  const match = CROSSWALK_KEY.exec(key);
  if (!match) return null;
  return {
    suiteId: match[1],
    suiteVersion: Number(match[2]),
    taskId: match[3],
    definitionDigest: match[4],
  };
}

/** First eight hex characters of a `sha256:<hex>` digest. Never the full value. */
export function abbreviateInputDigest(digest: string): string {
  if (digest.startsWith("sha256:") && digest.length >= 15) {
    return digest.slice(7, 15);
  }
  return digest.slice(0, 8);
}

function safeLabel(value: string | null | undefined): string | null {
  if (value == null || value === "") return null;
  if (CREDENTIAL_LIKE_VALUE.test(value)) return null;
  return value;
}

function parseScopeKey(key: string | null | undefined): { suiteId: string; taskId: string } | null {
  if (key == null || key === "") return null;
  const match = SCOPE_KEY.exec(key);
  if (!match) return null;
  return { suiteId: match[1], taskId: match[2] };
}

function parseInventoryKey(
  key: string,
): { suiteId: string; taskId: string; suiteVersion: number } | null {
  const match = INVENTORY_KEY.exec(key);
  if (!match) return null;
  return { suiteId: match[1], taskId: match[2], suiteVersion: Number(match[3]) };
}

function executableDefinition(task: EvaluationTask): LegacyExecutableDefinition {
  return {
    title: task.title,
    objective: task.prompt,
    candidateInstruction: task.systemPrompt,
    defaultContextManifest: [],
    responseContract: null,
    taskVerifierRef: task.verification ?? null,
    evaluation: task.evaluation,
  };
}

function scopeToken(suiteId: string, taskId: string): string {
  return `${suiteId}::${taskId}`;
}

function collectScopes(sources: TaskReferenceSources): Set<string> {
  const scopes = new Set<string>();
  for (const version of sources.versions) {
    const parsed = parseScopeKey(version.source.legacyScopeKey);
    if (parsed) scopes.add(scopeToken(parsed.suiteId, parsed.taskId));
  }
  for (const crosswalk of sources.crosswalks) {
    if (crosswalk.taskId !== sources.task.id) continue;
    const parsed = parseLegacyCrosswalkKey(crosswalk.legacyScopeKey);
    if (parsed) scopes.add(scopeToken(parsed.suiteId, parsed.taskId));
  }
  return scopes;
}

function resolveExactVersion(
  sources: TaskReferenceSources,
  suiteId: string,
  suiteVersion: number,
  legacyTaskId: string,
  digest: string,
): { taskVersion: number | null; state: TaskReferenceResolutionState; limitation: string | null } {
  const versions = new Set(sources.versions.map((version) => version.version));
  const matches = sources.crosswalks.filter((crosswalk) => {
    if (crosswalk.taskId !== sources.task.id) return false;
    const parsed = parseLegacyCrosswalkKey(crosswalk.legacyScopeKey);
    if (!parsed) return false;
    return (
      parsed.suiteId === suiteId &&
      parsed.suiteVersion === suiteVersion &&
      parsed.taskId === legacyTaskId &&
      parsed.definitionDigest === digest
    );
  });
  if (matches.length === 0) {
    return {
      taskVersion: null,
      state: "unresolved",
      limitation: "Migration crosswalk is absent for this exact suite version.",
    };
  }
  const match = matches[0];
  if (!versions.has(match.taskVersion)) {
    return {
      taskVersion: null,
      state: "unresolved",
      limitation: "Migration crosswalk is corrupt for this exact suite version.",
    };
  }
  return { taskVersion: match.taskVersion, state: "resolved", limitation: null };
}

function originLimitation(sources: TaskReferenceSources): string {
  const parts: string[] = [];
  if (sources.task.origin === "legacy-task-set") {
    parts.push(
      "Legacy origin is namespaced to one suite task identity and does not imply identity across suites.",
    );
  }
  if (!sources.liveScanAvailable) {
    parts.push(
      "Current suite and experiment history was not scanned or is unavailable; counts reflect stored instances and explicit unresolved records only.",
    );
  }
  if (parts.length === 0) {
    return "References bind only to exact stored versions and instances.";
  }
  return parts.join(" ");
}

function compareSuiteRefs(a: TaskSuiteReference, b: TaskSuiteReference): number {
  return a.suiteId.localeCompare(b.suiteId) || a.suiteVersion - b.suiteVersion;
}

function compareExperimentRefs(a: TaskExperimentReference, b: TaskExperimentReference): number {
  return a.experimentId.localeCompare(b.experimentId);
}

function instanceState(completeness: TaskInstance["inputCompleteness"]): TaskInstanceReferenceState {
  if (completeness === "complete") return "resolved";
  return completeness;
}

/** Deterministic grouped read model. Never falls back to latestVersion. */
export function buildTaskReferenceReadModel(
  sources: TaskReferenceSources,
): TaskReferenceReadModel {
  const scopes = collectScopes(sources);
  const currentSuites: TaskSuiteReference[] = [];
  const experiments: TaskExperimentReference[] = [];
  const unresolvedDefinitions: TaskUnresolvedDefinition[] = [];
  const unresolvedKeys = new Set<string>();
  let absentOrCorruptCrosswalks = 0;

  for (const suite of sources.suites) {
    for (const rawTask of suite.tasks ?? []) {
      const legacyTaskId = typeof rawTask.id === "string" ? rawTask.id : "";
      if (legacyTaskId === "") continue;
      if (scopes.size > 0 && !scopes.has(scopeToken(suite.id, legacyTaskId))) continue;
      const status = resolveLegacyDefinitionStatus(rawTask);
      if (status === "incomplete") {
        const key = `${suite.id}::${legacyTaskId}::v${suite.version}`;
        if (unresolvedKeys.has(key)) continue;
        unresolvedKeys.add(key);
        unresolvedDefinitions.push({
          key,
          suiteId: suite.id,
          suiteVersion: suite.version,
          legacyTaskId,
          taskVersion: null,
          state: "unresolved",
          limitation: UNRECONSTRUCTABLE,
        });
        continue;
      }
      const digest = computeLegacyExecutableDefinitionDigest(executableDefinition(rawTask));
      const resolved = resolveExactVersion(
        sources,
        suite.id,
        suite.version,
        legacyTaskId,
        digest,
      );
      if (resolved.state === "unresolved") absentOrCorruptCrosswalks += 1;
      currentSuites.push({
        suiteId: suite.id,
        suiteVersion: suite.version,
        suiteName: safeLabel(suite.name),
        legacyTaskId,
        taskVersion: resolved.taskVersion,
        state: resolved.state,
        limitation: resolved.limitation,
      });
    }
  }

  for (const experiment of sources.experiments) {
    const snapshot = experiment.snapshot;
    if (!snapshot || !Array.isArray(snapshot.tasks)) continue;
    for (const rawTask of snapshot.tasks) {
      let legacyTaskId = "";
      if (typeof rawTask === "object" && rawTask !== null && "id" in rawTask) {
        const maybeId = (rawTask as { id?: unknown }).id;
        if (typeof maybeId === "string") legacyTaskId = maybeId;
      }
      if (legacyTaskId === "") continue;
      if (scopes.size > 0 && !scopes.has(scopeToken(snapshot.suiteId, legacyTaskId))) continue;
      const status = resolveLegacyDefinitionStatus(rawTask);
      if (status === "incomplete") {
        const key = `${snapshot.suiteId}::${legacyTaskId}::v${snapshot.suiteVersion}`;
        if (unresolvedKeys.has(key)) continue;
        unresolvedKeys.add(key);
        unresolvedDefinitions.push({
          key,
          suiteId: snapshot.suiteId,
          suiteVersion: snapshot.suiteVersion,
          legacyTaskId,
          taskVersion: null,
          state: "unresolved",
          limitation: UNRECONSTRUCTABLE,
        });
        continue;
      }
      const digest = computeLegacyExecutableDefinitionDigest(
        executableDefinition(rawTask as EvaluationTask),
      );
      const resolved = resolveExactVersion(
        sources,
        snapshot.suiteId,
        snapshot.suiteVersion,
        legacyTaskId,
        digest,
      );
      if (resolved.state === "unresolved") absentOrCorruptCrosswalks += 1;
      experiments.push({
        experimentId: experiment.id,
        suiteId: snapshot.suiteId,
        suiteVersion: snapshot.suiteVersion,
        legacyTaskId,
        taskVersion: resolved.taskVersion,
        state: resolved.state,
        limitation: resolved.limitation,
      });
    }
  }

  for (const key of sources.unresolvedInventoryKeys ?? []) {
    const parsed = parseInventoryKey(key);
    if (!parsed) continue;
    if (scopes.size > 0 && !scopes.has(scopeToken(parsed.suiteId, parsed.taskId))) continue;
    if (unresolvedKeys.has(key)) continue;
    unresolvedKeys.add(key);
    unresolvedDefinitions.push({
      key,
      suiteId: parsed.suiteId,
      suiteVersion: parsed.suiteVersion,
      legacyTaskId: parsed.taskId,
      taskVersion: null,
      state: "unresolved",
      limitation: UNRECONSTRUCTABLE,
    });
  }

  currentSuites.sort(compareSuiteRefs);
  experiments.sort(compareExperimentRefs);
  unresolvedDefinitions.sort((a, b) => a.key.localeCompare(b.key));

  const instances: TaskInstanceReference[] = sources.instances
    .map((row) => ({
      id: row.id,
      taskVersion: row.taskVersion,
      inputDigestAbbreviation: abbreviateInputDigest(row.inputDigest),
      sourceKind: row.sourceRef.kind,
      createdAt: row.createdAt,
      state: instanceState(row.inputCompleteness),
      useCount: null,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const instancesComplete = instances.filter((row) => row.state === "resolved").length;
  const instancesMetadataOnly = instances.filter((row) => row.state === "metadata_only").length;
  const instancesIncomplete = instances.filter((row) => row.state === "incomplete").length;
  const resolvedVersionRefs =
    currentSuites.filter((row) => row.state === "resolved").length +
    experiments.filter((row) => row.state === "resolved").length;

  const counts: TaskReferenceCounts = {
    currentSuites: currentSuites.length,
    experiments: experiments.length,
    instancesComplete,
    instancesMetadataOnly,
    instancesIncomplete,
    unresolvedDefinitions: unresolvedDefinitions.length,
    absentOrCorruptCrosswalks,
    archivedReferencedVersions:
      sources.task.archivedAt !== null ? resolvedVersionRefs : 0,
    total:
      currentSuites.length +
      experiments.length +
      instancesComplete +
      instancesMetadataOnly +
      instancesIncomplete +
      unresolvedDefinitions.length,
  };

  return {
    taskId: sources.task.id,
    task: sources.task,
    origin: sources.task.origin,
    originLimitation: originLimitation(sources),
    currentSuites,
    experiments,
    instances,
    unresolvedDefinitions,
    counts,
  };
}

export function summarizeTaskReferences(model: TaskReferenceReadModel): TaskReferenceSummary {
  return {
    total: model.counts.total,
    unresolved: model.counts.unresolvedDefinitions + model.counts.absentOrCorruptCrosswalks,
  };
}
