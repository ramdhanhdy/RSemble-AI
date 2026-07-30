// =============================================================================
// RSemble AI — Dexie-backed run recorder regression tests
//
// Production bug (real app, every run failed before any provider call):
// loadAndMutate passed the POST-mutation record.revision as expectedRevision
// to repo.update. Against Dexie — where repo.get returns a structured-clone
// copy and the stored row keeps its old revision — every CAS check failed
// with "Stale revision" and the executor's catch swallowed the rejection,
// so zero provider calls were made and runs stuck at "running".
//
// InMemoryRunRepository masked this: create() stores the record object BY
// REFERENCE, so the builder's in-memory revision bump leaked into the
// "stored" object and the CAS passed. These tests run the recorder against
// the REAL Dexie repository (fake-indexeddb) so the production path is
// covered.
// =============================================================================

import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RSembleEvaluationDB } from "./database";
import { createRunRepository, type RunRepository } from "./run-repository";
import { createRunRecorder, type RunRecorder } from "./run-recorder";
import type { FanoutStartInput } from "./run-record-builder";
import { candidateIdForSlot } from "../pipeline";
import type { ModelSlot } from "../../studio-data";

const SLOT: ModelSlot = {
  id: "slot-1",
  providerId: "openrouter",
  provider: "Z-AI",
  model: "GLM 5.2",
  slug: "z-ai/glm-5.2",
  enabled: true,
};

function fanoutInput(runId: string): FanoutStartInput {
  return {
    runId,
    source: { kind: "adhoc" },
    mode: "rank",
    task: { title: "t", prompt: "p", systemPrompt: "", temperature: 0.7 },
    evaluation: { profile: null, candidateMessages: [] },
    slots: [SLOT],
    fence: { ownerId: "tab-1", fence: 1 },
  };
}

describe("RunRecorder against the real Dexie repository", () => {
  let db: RSembleEvaluationDB;
  let repo: RunRepository;
  let recorder: RunRecorder;

  beforeEach(async () => {
    db = new RSembleEvaluationDB("test-recorder-dexie-" + Math.random().toString(36).slice(2));
    await db.open();
    repo = createRunRepository(db);
    recorder = createRunRecorder(repo);
  });

  afterEach(async () => {
    db.close();
    await db.delete();
  });

  it("beginCandidateAttempt persists the attempt (CAS uses the pre-mutation revision)", async () => {
    const runId = await recorder.begin(fanoutInput("run-dx-1"));
    const candidateId = candidateIdForSlot(SLOT.id);

    // This threw StorageError "Stale revision" against Dexie before the fix.
    await recorder.beginCandidateAttempt(runId, candidateId, "att-1", {
      attemptId: "att-1",
      messages: [{ role: "user", content: "p" }],
      startedAt: 1000,
    });

    const record = await recorder.getRecord(runId);
    expect(record).not.toBeNull();
    const candidate = record!.candidates.find((c) => c.candidateId === candidateId);
    expect(candidate?.attempts).toHaveLength(1);
    expect(candidate?.attempts[0].attemptId).toBe("att-1");
    expect(candidate?.attempts[0].status).toBe("running");
  });

  it("sequential stage writes all succeed and advance the revision monotonically", async () => {
    const runId = await recorder.begin(fanoutInput("run-dx-2"));
    const candidateId = candidateIdForSlot(SLOT.id);

    await recorder.beginCandidateAttempt(runId, candidateId, "att-1", {
      attemptId: "att-1",
      messages: [],
      startedAt: 1000,
    });
    await recorder.finishCandidateAttempt(runId, candidateId, "att-1", {
      status: "completed",
      output: "answer",
      tokensIn: 10,
      tokensOut: 20,
      error: null,
      finishedAt: 2000,
    });
    await recorder.saveFanout(runId, { candidates: [] });

    const record = await recorder.getRecord(runId);
    expect(record!.revision).toBeGreaterThanOrEqual(4);
    expect(record!.candidates[0].attempts[0].status).toBe("completed");
    expect(record!.candidates[0].attempts[0].output).toBe("answer");
  });
});
