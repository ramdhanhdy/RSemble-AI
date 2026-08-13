import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";

import type { TaskVersion } from "../tasks/task-types";
import { RSembleEvaluationDB } from "./database";
import {
  canonicalTaskMigrationMarkerKey,
  legacyTaskCrosswalkKey,
  migrateEmbeddedLegacyTasks,
} from "./canonical-task-migration";

const dbs: RSembleEvaluationDB[] = [];
afterEach(async () => {
  while (dbs.length) {
    const db = dbs.pop()!;
    db.close();
    await db.delete();
  }
});

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    title: "Summarize",
    prompt: "Summarize the passage.",
    systemPrompt: "Use three bullets.",
    evaluation: { kind: "inherit" },
    judgeInstructionOverride: "Judge clarity.",
    order: 0,
    ...overrides,
  };
}

function suite(overrides: Record<string, unknown> = {}) {
  return {
    id: "suite-1", revision: 1, version: 2, name: "Suite", description: "",
    tasks: [task()], modelSlots: [], defaultJudge: { providerId: "openrouter", model: "judge" },
    defaultEvaluation: { kind: "holistic" }, createdAt: 10, updatedAt: 20, archivedAt: null,
    ...overrides,
  };
}

function experiment(overrides: Record<string, unknown> = {}) {
  const snapshot = {
    suiteId: "suite-1", suiteVersion: 1, tasks: [task({ prompt: "Older prompt." })],
    modelSlots: [], defaultJudge: { providerId: "openrouter", model: "judge" },
    defaultEvaluation: { kind: "holistic" }, profiles: [], protocolFingerprint: "sha256:fp", createdAt: 15,
  };
  return {
    id: "exp-1", revision: 1, suiteId: "suite-1", suiteVersion: 1, protocolFingerprint: "sha256:fp",
    status: "completed", execution: null, snapshot, tasks: [], createdAt: 15, updatedAt: 15,
    ...overrides,
  };
}
async function seed(
  db: RSembleEvaluationDB,
  suites: Array<Record<string, unknown>>,
  experiments: Array<Record<string, unknown>>,
) {
  for (const item of suites) {
    await db.suites.put({
      id: item.id as string,
      suite: item,
      revision: 1,
      version: item.version as number,
      updatedAt: 20,
      archivedAt: null,
    });
  }
  for (const item of experiments) {
    await db.experiments.put({
      id: item.id as string,
      experiment: item,
      revision: 1,
      suiteId: item.suiteId as string,
      suiteVersion: item.suiteVersion as number,
      protocolFingerprint: "sha256:fp",
      createdAt: 15,
      status: "completed",
    });
  }
}
async function makeDb() {
  const db = new RSembleEvaluationDB(`canonical-migration-${crypto.randomUUID()}`);
  dbs.push(db);
  await db.open();
  return db;
}

describe("migrateEmbeddedLegacyTasks", () => {
  it("creates namespaced immutable versions and every historical crosswalk without changing source evidence", async () => {
    const db = await makeDb();
    const sourceSuite = suite();
    const sourceExperiment = experiment();
    const before = JSON.stringify({ sourceSuite, sourceExperiment });
    await seed(db, [sourceSuite], [sourceExperiment]);

    const result = await migrateEmbeddedLegacyTasks(db);

    expect(result).toMatchObject({ migratedScopes: 1, unresolvedDefinitions: 0, complete: true });
    expect(await db.tasks.count()).toBe(1);
    expect(await db.taskVersions.count()).toBe(2);
    expect(await db.taskMigrationCrosswalk.count()).toBe(2);
    const [migratedTask] = await db.tasks.toArray();
    expect(migratedTask).toBeDefined();
    const latestVersionRow = await db.taskVersions.get([migratedTask!.id, 2]);
    expect(latestVersionRow).toBeDefined();
    const latestVersion = latestVersionRow!.version_ as TaskVersion;
    expect(latestVersion.source.note).toContain('legacy-evaluation:{"kind":"inherit"}');
    expect(await db.storageMeta.get(canonicalTaskMigrationMarkerKey)).toBeDefined();
    expect(JSON.stringify({ sourceSuite, sourceExperiment })).toBe(before);
    expect((await db.suites.get("suite-1"))?.suite).toEqual(sourceSuite);
    expect((await db.experiments.get("exp-1"))?.experiment).toEqual(sourceExperiment);
    expect(await db.taskArtifacts.count()).toBe(0);
    expect(await db.taskArtifactBytes.count()).toBe(0);
    expect(await db.taskInstances.count()).toBe(0);
  });

  it("resumes committed crosswalks, repairs corrupt ones, and repeated startup creates no duplicates", async () => {
    const db = await makeDb();
    await seed(db, [suite()], [experiment()]);
    const first = await migrateEmbeddedLegacyTasks(db);
    const initialTasks = await db.tasks.count();
    const initialVersions = await db.taskVersions.count();
    const crosswalk = (await db.taskMigrationCrosswalk.toArray())[0];
    await db.taskMigrationCrosswalk.put({ ...crosswalk, taskVersion: 999 });

    const resumed = await migrateEmbeddedLegacyTasks(db);
    const repeated = await migrateEmbeddedLegacyTasks(db);

    expect(first.complete).toBe(true);
    expect(resumed.complete).toBe(true);
    expect(repeated.complete).toBe(true);
    expect(await db.tasks.count()).toBe(initialTasks);
    expect(await db.taskVersions.count()).toBe(initialVersions);
    expect((await db.taskMigrationCrosswalk.get(crosswalk.legacyScopeKey))?.taskVersion).not.toBe(999);
  });

  it("does not merge identical text across suite scopes and leaves unresolved definitions explicit", async () => {
    const db = await makeDb();
    const incomplete = task({ id: "broken", evaluation: { kind: "profile" } });
    await seed(db, [
      suite({ id: "suite-a", tasks: [task()] }),
      suite({ id: "suite-b", tasks: [task()] }),
      suite({ id: "suite-c", tasks: [incomplete] }),
    ], []);

    const result = await migrateEmbeddedLegacyTasks(db);

    expect(result).toMatchObject({ migratedScopes: 2, unresolvedDefinitions: 1, complete: true });
    expect(await db.tasks.count()).toBe(2);
    expect(await db.taskMigrationCrosswalk.count()).toBe(2);
    expect(await db.taskArtifacts.count()).toBe(0);
    expect(await db.taskInstances.count()).toBe(0);
  });

  it("uses suite/version/task/digest crosswalk authority", () => {
    expect(legacyTaskCrosswalkKey("suite-1", 4, "task-1", "sha256:" + "a".repeat(64)))
      .not.toBe(legacyTaskCrosswalkKey("suite-2", 4, "task-1", "sha256:" + "a".repeat(64)));
  });
});
