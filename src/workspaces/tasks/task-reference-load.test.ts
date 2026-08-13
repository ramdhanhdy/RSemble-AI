// =============================================================================
// RSemble AI — Task reference loader tests (RED)
//
// Child 02 (Canonical Tasks) Milestone D, Task 9 repair.
//
// Proves the production load path discloses persisted unresolved migration
// keys even when the live suite/experiment scan is absent.
// =============================================================================

import { describe, expect, it } from "vitest";

import { InMemoryTaskRepository } from "../../lib/persistence/in-memory-task-repository";
import type { TaskRepository } from "../../lib/persistence/task-repository";
import type { TaskRecord, TaskVersion } from "../../lib/tasks/task-types";
import { loadTaskReferenceReadModel } from "./task-reference-load";

const NOW = 1_700_000_000_000;
const UNRESOLVED_KEY = "suite-gone::broken::v3";

interface MigrationMarkerSeed {
  kind: "canonical-task-migration";
  version: 1;
  completedAt: number;
  unresolvedKeys: string[];
}

type TaskRepositoryWithMarker = TaskRepository & {
  putCanonicalTaskMigrationMarker?(marker: MigrationMarkerSeed): Promise<void>;
};

async function seedLegacyTask(repo: TaskRepository): Promise<TaskRecord> {
  const version: TaskVersion = {
    taskId: "legacy-task-1",
    version: 1,
    title: "Historical task",
    objective: "Keep unresolved history visible.",
    candidateInstruction: "Do not invent a latest version.",
    defaultContextManifest: [],
    responseContract: null,
    taskVerifierRef: null,
    source: { kind: "legacy-task-set", legacyScopeKey: "suite-gone::broken", note: null },
    createdAt: NOW,
  };
  const record: TaskRecord = {
    id: "legacy-task-1",
    latestVersion: 1,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    origin: "legacy-task-set",
    revision: 0,
  };
  await repo.createTask(record, version);
  return record;
}

describe("loadTaskReferenceReadModel — unresolved migration marker", () => {
  it("discloses a persisted unresolved key when the live suite/experiment is absent", async () => {
    const repo = new InMemoryTaskRepository() as TaskRepositoryWithMarker;
    const task = await seedLegacyTask(repo);
    expect(repo.putCanonicalTaskMigrationMarker).toEqual(expect.any(Function));
    await repo.putCanonicalTaskMigrationMarker!({
      kind: "canonical-task-migration",
      version: 1,
      completedAt: NOW,
      unresolvedKeys: [UNRESOLVED_KEY, "not-a-key", "suite-other::task::v1"],
    });

    const model = await loadTaskReferenceReadModel(repo, task, null);

    expect(model.unresolvedDefinitions.map((row) => row.key)).toContain(UNRESOLVED_KEY);
    expect(model.unresolvedDefinitions.find((row) => row.key === UNRESOLVED_KEY)).toMatchObject({
      suiteId: "suite-gone",
      suiteVersion: 3,
      legacyTaskId: "broken",
      taskVersion: null,
      state: "unresolved",
    });
    expect(model.counts.unresolvedDefinitions).toBeGreaterThanOrEqual(1);
    expect(model.currentSuites).toEqual([]);
    expect(model.experiments).toEqual([]);
  });
});
