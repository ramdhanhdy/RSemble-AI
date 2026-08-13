// Conservative, resumable migration of embedded suite Tasks into canonical Tasks.
import { hashArtifactContent } from "../evaluations/protocol-fingerprint";
import {
  buildLegacyTaskInventory,
  type LegacyChronology,
  type LegacyExecutableDefinition,
  type LegacyInventoryEntry,
} from "../tasks/legacy-task-inventory";
import type { EvaluationSuite, ExperimentRecord } from "../evaluations/evaluation-types";
import type { TaskRecord, TaskVersion } from "../tasks/task-types";
import { type RSembleEvaluationDB, StorageError, classifyStorageError } from "./database";

export const canonicalTaskMigrationMarkerKey = "canonical-task-migration:v1";

export interface CanonicalTaskMigrationResult {
  migratedScopes: number;
  createdVersions: number;
  crosswalksWritten: number;
  unresolvedDefinitions: number;
  complete: boolean;
}

interface CompleteObservation {
  entry: LegacyInventoryEntry;
  chronology: LegacyChronology;
  digest: string;
  definition: LegacyExecutableDefinition;
}

interface ExpectedVersion {
  digest: string;
  definition: LegacyExecutableDefinition;
  createdAt: number;
}

/** The complete historical authority coordinate. */
export function legacyTaskCrosswalkKey(
  suiteId: string,
  suiteVersion: number,
  taskId: string,
  definitionDigest: string,
): string {
  return `${suiteId}::v${suiteVersion}::${taskId}::${definitionDigest}`;
}

function compareObservations(a: CompleteObservation, b: CompleteObservation): number {
  if (a.chronology.suiteVersion !== b.chronology.suiteVersion) {
    return a.chronology.suiteVersion - b.chronology.suiteVersion;
  }
  if (a.chronology.executedAt === null && b.chronology.executedAt !== null) return 1;
  if (a.chronology.executedAt !== null && b.chronology.executedAt === null) return -1;
  if (
    a.chronology.executedAt !== null &&
    b.chronology.executedAt !== null &&
    a.chronology.executedAt !== b.chronology.executedAt
  ) return a.chronology.executedAt - b.chronology.executedAt;
  return (a.chronology.experimentId ?? "").localeCompare(b.chronology.experimentId ?? "");
}

function taskIdForScope(scopeKey: string): string {
  return `legacy-task-${hashArtifactContent(scopeKey).slice(7, 30)}`;
}

function taskRecord(taskId: string, createdAt: number): TaskRecord {
  return {
    id: taskId, latestVersion: 1, createdAt, updatedAt: createdAt,
    archivedAt: null, origin: "legacy-task-set", revision: 0,
  };
}

function taskVersion(
  taskId: string,
  version: number,
  scopeKey: string,
  expected: ExpectedVersion,
): TaskVersion {
  return {
    taskId,
    version,
    title: expected.definition.title,
    objective: expected.definition.objective,
    candidateInstruction: expected.definition.candidateInstruction,
    defaultContextManifest: [],
    responseContract: null,
    taskVerifierRef: null,
    // Legacy verifier configurations are not versioned canonical references.
    source: {
      kind: "legacy-task-set",
      legacyScopeKey: scopeKey,
      note: `legacy-definition:${expected.digest};legacy-verifier:${JSON.stringify(expected.definition.taskVerifierRef)}`,
    },
    createdAt: expected.createdAt,
  };
}

async function inventoryFromDatabase(db: RSembleEvaluationDB) {
  const [suiteRows, experimentRows] = await Promise.all([db.suites.toArray(), db.experiments.toArray()]);
  const suites = suiteRows
    .map((row) => row.suite)
    .filter((value): value is EvaluationSuite => {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
      if (!("id" in value) || !("version" in value) || !("tasks" in value)) return false;
      return typeof value.id === "string" && typeof value.version === "number" && Array.isArray(value.tasks);
    });
  const experiments = experimentRows
    .map((row) => row.experiment)
    .filter((value): value is ExperimentRecord => {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
      if (!("id" in value) || !("snapshot" in value)) return false;
      const snapshot = value.snapshot;
      if (typeof snapshot !== "object" || snapshot === null || Array.isArray(snapshot)) return false;
      if (!("suiteId" in snapshot) || !("suiteVersion" in snapshot) || !("tasks" in snapshot) || !("createdAt" in snapshot)) return false;
      return (
        typeof value.id === "string" &&
        typeof snapshot.suiteId === "string" &&
        typeof snapshot.suiteVersion === "number" &&
        Array.isArray(snapshot.tasks) &&
        typeof snapshot.createdAt === "number"
      );
    });
  return buildLegacyTaskInventory({ suites, experiments });
}

function collectObservations(entries: LegacyInventoryEntry[]): CompleteObservation[] {
  const result: CompleteObservation[] = [];
  for (const entry of entries) {
    if (entry.status !== "complete" || entry.definition === null || entry.definitionDigest === null) continue;
    for (const chronology of entry.observations) {
      result.push({ entry, chronology, digest: entry.definitionDigest, definition: entry.definition });
    }
  }
  return result.sort(compareObservations);
}

function distinctVersions(observations: CompleteObservation[]): ExpectedVersion[] {
  const result: ExpectedVersion[] = [];
  let prior: string | null = null;
  for (const observation of observations) {
    if (observation.digest !== prior) {
      result.push({
        digest: observation.digest,
        definition: observation.definition,
        createdAt: observation.chronology.executedAt ?? Date.now(),
      });
      prior = observation.digest;
    }
  }
  return result;
}

/**
 * Write canonical Task records, immutable versions, and crosswalks per scope.
 * Source suite and experiment records are never included in a write transaction.
 * A marker follows only after every source coordinate resolves to a stored version.
 */
export async function migrateEmbeddedLegacyTasks(
  db: RSembleEvaluationDB,
): Promise<CanonicalTaskMigrationResult> {
  db.assertWritable();
  try {
    const inventory = await inventoryFromDatabase(db);
    const unresolved = inventory.entries.filter((entry) => entry.status === "incomplete");
    const observationsByScope = new Map<string, CompleteObservation[]>();
    for (const observation of collectObservations(inventory.entries)) {
      const scopeKey = `${observation.entry.scope.suiteId}::${observation.entry.scope.taskId}`;
      const observations = observationsByScope.get(scopeKey) ?? [];
      observations.push(observation);
      observationsByScope.set(scopeKey, observations);
    }

    let createdVersions = 0;
    let crosswalksWritten = 0;
    for (const [scopeKey, observations] of observationsByScope) {
      const expectedVersions = distinctVersions(observations);
      const id = taskIdForScope(scopeKey);
      await db.transaction("rw", db.tasks, db.taskVersions, db.taskMigrationCrosswalk, async () => {
        let task = await db.tasks.get(id);
        if (!task) {
          const record = taskRecord(id, expectedVersions[0].createdAt);
          await db.tasks.put({
            id: record.id, record, latestVersion: record.latestVersion,
            createdAt: record.createdAt, updatedAt: record.updatedAt,
            archivedAt: record.archivedAt, origin: record.origin, revision: record.revision,
          });
          task = await db.tasks.get(id);
        }
        if (!task) throw new StorageError("unavailable", "Task migration could not create a Task");

        const existingVersions = await db.taskVersions.where("taskId").equals(id).sortBy("version");
        if (existingVersions.length > expectedVersions.length) {
          throw new StorageError("validation", "Task migration found an inconsistent version history");
        }
        for (let index = 0; index < existingVersions.length; index += 1) {
          const expected = expectedVersions[index];
          const actual = existingVersions[index].version_ as TaskVersion;
          if (
            existingVersions[index].version !== index + 1 ||
            actual.source.legacyScopeKey !== scopeKey ||
            actual.source.note !== `legacy-definition:${expected.digest};legacy-verifier:${JSON.stringify(expected.definition.taskVerifierRef)}`
          ) {
            throw new StorageError("validation", "Task migration found an inconsistent version history");
          }
        }
        for (let index = existingVersions.length; index < expectedVersions.length; index += 1) {
          const version = taskVersion(id, index + 1, scopeKey, expectedVersions[index]);
          await db.taskVersions.put({ taskId: id, version: version.version, version_: version, createdAt: version.createdAt });
          createdVersions += 1;
        }
        if (task.latestVersion !== expectedVersions.length) {
          const record = {
            ...(task.record as TaskRecord), latestVersion: expectedVersions.length,
            updatedAt: Date.now(), revision: task.revision + 1,
          };
          await db.tasks.put({
            ...task, record, latestVersion: record.latestVersion,
            updatedAt: record.updatedAt, revision: record.revision,
          });
        }

        let prior: string | null = null;
        let version = 0;
        for (const observation of observations) {
          if (observation.digest !== prior) version += 1;
          prior = observation.digest;
          const key = legacyTaskCrosswalkKey(
            observation.entry.scope.suiteId,
            observation.chronology.suiteVersion,
            observation.entry.scope.taskId,
            observation.digest,
          );
          const crosswalk = await db.taskMigrationCrosswalk.get(key);
          if (!crosswalk || crosswalk.taskId !== id || crosswalk.taskVersion !== version) {
            await db.taskMigrationCrosswalk.put({ legacyScopeKey: key, taskId: id, taskVersion: version });
            crosswalksWritten += 1;
          }
        }
      });
    }

    for (const observation of collectObservations(inventory.entries)) {
      const key = legacyTaskCrosswalkKey(
        observation.entry.scope.suiteId,
        observation.chronology.suiteVersion,
        observation.entry.scope.taskId,
        observation.digest,
      );
      const crosswalk = await db.taskMigrationCrosswalk.get(key);
      if (!crosswalk || !(await db.taskVersions.get([crosswalk.taskId, crosswalk.taskVersion]))) {
        throw new StorageError("validation", "Task migration crosswalk verification failed");
      }
    }
    await db.storageMeta.put({
      key: canonicalTaskMigrationMarkerKey,
      value: {
        kind: "canonical-task-migration", version: 1, completedAt: Date.now(),
        unresolvedKeys: unresolved.map((entry) => entry.key).sort(),
      },
    });
    return {
      migratedScopes: observationsByScope.size,
      createdVersions,
      crosswalksWritten,
      unresolvedDefinitions: unresolved.length,
      complete: true,
    };
  } catch (error) {
    if (error instanceof StorageError) throw error;
    throw classifyStorageError(error);
  }
}
