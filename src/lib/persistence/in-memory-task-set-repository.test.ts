// =============================================================================
// RSemble AI — In-memory Task Set repository parity tests
//
// Child 03 (Task Sets and Context-Owned Evaluation Results) Milestone A —
// Task 3 (RED first).
//
// The shared contract suite lives in `./task-set-repository.test.ts` and is
// imported here so the in-memory parity implementation runs the exact same
// public contract as the Dexie-backed implementation. This file additionally
// exercises in-memory-specific edge cases that do not apply to the Dexie
// implementation (no schema upgrade path).
// =============================================================================

import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";

import { InMemoryTaskSetRepository } from "./in-memory-task-set-repository";
import { repositorySuite } from "./task-set-repository.test";
import type {
  JudgeSnapshot,
  TaskSetMember,
  TaskSetRecord,
  TaskSetVersion,
} from "../evaluations/task-set-types";
import type { ModelSlot } from "../../studio-data";

// Re-run the shared contract suite against the in-memory implementation.
repositorySuite("InMemoryTaskSetRepository (parity)", () => new InMemoryTaskSetRepository());

const NOW = 1_000;

function makeSlot(
  id: string,
  slug: string,
  providerId: ModelSlot["providerId"] = "openrouter",
): ModelSlot {
  return {
    id,
    providerId,
    provider: providerId,
    model: `org/${slug}`,
    slug,
    enabled: true,
  };
}

function makeJudge(): JudgeSnapshot {
  return { providerId: "openrouter", model: "org/judge" };
}

function makeMember(overrides: Partial<TaskSetMember> = {}): TaskSetMember {
  return {
    id: "mem-1",
    taskVersionRef: { taskId: "task-1", version: 1 },
    order: 0,
    role: "organic",
    stratum: null,
    weight: 1,
    rubricOverrideRef: null,
    executionOverrides: null,
    unresolved: null,
    ...overrides,
  };
}

function record(overrides: Partial<TaskSetRecord> = {}): TaskSetRecord {
  return {
    id: "set-1",
    latestVersion: 1,
    name: "My Task Set",
    description: "A canonical task set.",
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    revision: 0,
    origin: "authored",
    ...overrides,
  };
}

function version(overrides: Partial<TaskSetVersion> = {}): TaskSetVersion {
  return {
    taskSetId: "set-1",
    version: 1,
    members: [makeMember()],
    defaultRubricRef: { id: "rubric-1", version: 1 },
    defaultModelSlots: [makeSlot("s1", "m1"), makeSlot("s2", "m2")],
    defaultJudge: makeJudge(),
    repeatPolicy: { kind: "none" },
    missingnessPolicy: { kind: "allow-repair" },
    protocolDefaults: {},
    createdAt: NOW,
    ...overrides,
  };
}

describe("InMemoryTaskSetRepository additional parity edge cases", () => {
  it("isolates state between instances (no shared global store)", async () => {
    const a = new InMemoryTaskSetRepository();
    const b = new InMemoryTaskSetRepository();
    await a.createTaskSet(record(), version());
    expect(await b.getTaskSetRecord("set-1")).toBeNull();
  });

  it("appendTaskSetVersion rejects a draft whose taskSetId differs from the record", async () => {
    const repo = new InMemoryTaskSetRepository();
    await repo.createTaskSet(record({ id: "set-1" }), version({ taskSetId: "set-1" }));
    const rec = (await repo.getTaskSetRecord("set-1"))!;
    await expect(
      repo.appendTaskSetVersion({ ...rec, id: "set-other" }, version({ version: 2 }), rec.revision),
    ).rejects.toThrow(/mismatch/);
  });
});
