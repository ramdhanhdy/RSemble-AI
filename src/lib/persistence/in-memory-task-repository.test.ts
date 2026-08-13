// =============================================================================
// RSemble AI — In-memory Task repository parity tests
//
// Child 02 (Canonical Tasks) Milestone B — Task 3 (RED first).
//
// The shared contract suite lives in `./task-repository.test.ts` and is
// imported here so the in-memory parity implementation runs the exact same
// public contract as the Dexie-backed implementation. This file additionally
// exercises in-memory-specific edge cases that do not apply to the Dexie
// implementation (no schema upgrade path).
// =============================================================================

import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";

import { InMemoryTaskRepository } from "./in-memory-task-repository";
import { repositorySuite } from "./task-repository.test";

import { buildTaskArtifact, computeInstanceInputDigest } from "../tasks/task-instance";
import { buildInitialTaskRecord, buildNextVersion } from "../tasks/task-versioning";
import type { TaskRecord, TaskVersion } from "../tasks/task-types";

// Re-run the shared contract suite against the in-memory implementation.
// `repositorySuite` is exported from the Dexie test module; importing it here
// keeps both implementations under the same contract without duplication.
repositorySuite("InMemoryTaskRepository (parity)", () => new InMemoryTaskRepository());

const NOW = 1_000;
const TEXT_BYTES = new TextEncoder().encode("hello world");

function record(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return buildInitialTaskRecord({ id: "task-1", createdAt: NOW, origin: "authored", ...overrides });
}
function version(overrides: Partial<TaskVersion> = {}): TaskVersion {
  return {
    taskId: "task-1",
    version: 1,
    title: "Summarize a report",
    objective: "Produce a faithful summary.",
    candidateInstruction: "Summarize the following report in 3 bullets.",
    defaultContextManifest: [],
    responseContract: null,
    taskVerifierRef: null,
    source: { kind: "authored", legacyScopeKey: null, note: null },
    createdAt: NOW,
    ...overrides,
  };
}

describe("InMemoryTaskRepository additional parity edge cases", () => {
  it("isolates state between instances (no shared global store)", async () => {
    const a = new InMemoryTaskRepository();
    const b = new InMemoryTaskRepository();
    await a.createTask(record(), version());
    expect(await b.getTaskRecord("task-1")).toBeNull();
  });

  it("getOrCreateTaskInstance recomputes completeness from available bytes", async () => {
    const repo = new InMemoryTaskRepository();
    await repo.createTask(record(), version());
    const artifact = buildTaskArtifact({
      id: "art-1",
      bytes: TEXT_BYTES,
      mediaType: "text/plain",
      storageRef: "blob://art-1",
      createdAt: NOW,
    });
    await repo.putTaskArtifact(artifact, TEXT_BYTES);
    // Candidate claims "complete" but no bytes are available → repository must
    // downgrade to metadata_only/incomplete based on real bytes.
    const candidate = {
      id: "inst-1",
      taskId: "task-1",
      taskVersion: 1,
      normalizedInput: { text: "x", artifactIds: ["art-1"], metadata: {} },
      contextManifest: [],
      inputDigest: "sha256:" + "0".repeat(64), // placeholder; recomputed below
      inputCompleteness: "complete" as const,
      createdAt: NOW,
      sourceRef: { kind: "authored" as const, legacyScopeKey: null, originId: null },
    };
    candidate.inputDigest = computeInstanceInputDigest(candidate);
    const { instance } = await repo.getOrCreateTaskInstance(
      candidate,
      new Map<string, Uint8Array>(),
    );
    expect(instance.inputCompleteness).not.toBe("complete");
  });

  it("appendTaskVersion rejects a draft whose taskId differs from the record", async () => {
    const repo = new InMemoryTaskRepository();
    await repo.createTask(record({ id: "task-1" }), version({ taskId: "task-1" }));
    const rec = (await repo.getTaskRecord("task-1"))!;
    const draft = buildNextVersion({
      latestVersion: rec.latestVersion,
      taskId: "task-1",
      draft: { ...version(), title: "v2" },
      createdAt: 2_000,
      source: { kind: "authored", legacyScopeKey: null, note: null },
    });
    // Pass a record with a mismatched id.
    await expect(
      repo.appendTaskVersion({ ...rec, id: "task-other" }, draft, rec.revision),
    ).rejects.toThrow(/mismatch/);
  });
});
