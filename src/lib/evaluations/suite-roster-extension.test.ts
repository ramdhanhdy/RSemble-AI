// =============================================================================
// suite-roster-extension.test.ts — suite sync service contracts (plan 001, E3).
// =============================================================================

import { describe, expect, it } from "vitest";
import { appendModelToSuite } from "./suite-roster-extension";
import { InMemoryEvaluationRepository } from "../persistence/evaluation-repository";
import { InMemoryTaskSetRepository } from "../persistence/in-memory-task-set-repository";
import { StorageError } from "../persistence/database";
import { suiteToTaskSetRecord, suiteToTaskSetVersion } from "./suite-compat";
import type { EvaluationSuite } from "./evaluation-types";
import type { ModelSlot } from "../../studio-data";

function makeSuite(overrides: Partial<EvaluationSuite> = {}): EvaluationSuite {
  return {
    id: "suite-1",
    revision: 1,
    version: 3,
    name: "My Suite",
    description: "original description",
    tasks: [
      {
        id: "t1",
        title: "Task 1",
        prompt: "prompt",
        systemPrompt: "",
        evaluation: { kind: "inherit" },
        judgeInstructionOverride: "",
        order: 0,
      },
    ],
    modelSlots: [
      {
        id: "s1",
        providerId: "openrouter",
        provider: "OpenRouter",
        model: "m1",
        slug: "org/m1",
        enabled: true,
      },
      {
        id: "s2",
        providerId: "gemini",
        provider: "Gemini",
        model: "m2",
        slug: "m2",
        enabled: true,
      },
    ],
    defaultJudge: { providerId: "openrouter", model: "org/judge" },
    defaultEvaluation: { kind: "holistic" },
    createdAt: 1000,
    updatedAt: 2000,
    archivedAt: null,
    ...overrides,
  };
}

const NEW_SLOT: ModelSlot = {
  id: "slot-new",
  providerId: "deepseek",
  provider: "DeepSeek",
  model: "deepseek-chat",
  slug: "deepseek-chat",
  enabled: true,
};

async function seededRepo(suite: EvaluationSuite): Promise<InMemoryEvaluationRepository> {
  const repo = new InMemoryEvaluationRepository();
  // saveSuite validates and bumps revision: seed revision 1 from 0.
  await repo.saveSuite({ ...suite, revision: 0 }, 0);
  return repo;
}

describe("appendModelToSuite", () => {
  it("appends the exact slot identity and increments version and revision", async () => {
    const repo = await seededRepo(makeSuite());
    const result = await appendModelToSuite(repo, {
      suiteId: "suite-1",
      slot: NEW_SLOT,
      now: 5000,
    });

    expect(result).toEqual({ ok: true, suiteVersion: 4 });

    const saved = await repo.getSuite("suite-1");
    expect(saved).not.toBeNull();
    expect(saved!.modelSlots).toHaveLength(3);
    // Same stable slot id and semantic fields as the experiment extension.
    expect(saved!.modelSlots[2]).toEqual({ ...NEW_SLOT, provider: NEW_SLOT.provider });
    expect(saved!.modelSlots[2].id).toBe(NEW_SLOT.id);
    expect(saved!.version).toBe(4);
    expect(saved!.revision).toBe(2);
    expect(saved!.updatedAt).toBe(5000);
  });

  it("never rewrites tasks, judge, evaluation pins, description, creation time, or archive state", async () => {
    const original = makeSuite();
    const repo = await seededRepo(original);
    const result = await appendModelToSuite(repo, {
      suiteId: "suite-1",
      slot: NEW_SLOT,
      now: 5000,
    });
    expect(result.ok).toBe(true);

    const saved = await repo.getSuite("suite-1");
    expect(saved!.tasks).toEqual(original.tasks);
    expect(saved!.defaultJudge).toEqual(original.defaultJudge);
    expect(saved!.defaultEvaluation).toEqual(original.defaultEvaluation);
    expect(saved!.name).toBe(original.name);
    expect(saved!.description).toBe(original.description);
    expect(saved!.createdAt).toBe(original.createdAt);
    expect(saved!.archivedAt).toBeNull();
  });

  it("rejects an archived suite with a results-only message and never saves", async () => {
    const repo = await seededRepo(makeSuite({ archivedAt: 1500 }));
    const result = await appendModelToSuite(repo, {
      suiteId: "suite-1",
      slot: NEW_SLOT,
      now: 5000,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("archived");
      expect(result.message).toMatch(/results only/i);
    }
    const saved = await repo.getSuite("suite-1");
    expect(saved!.modelSlots).toHaveLength(2);
    expect(saved!.version).toBe(3);
  });

  it("rejects a duplicate key and never saves", async () => {
    const repo = await seededRepo(makeSuite());
    const dup: ModelSlot = { ...NEW_SLOT, providerId: "openrouter", slug: "org/m1", model: "m1" };
    const result = await appendModelToSuite(repo, { suiteId: "suite-1", slot: dup, now: 5000 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("duplicate");
      expect(result.message).toMatch(/results only/i);
    }
    const saved = await repo.getSuite("suite-1");
    expect(saved!.modelSlots).toHaveLength(2);
    expect(saved!.version).toBe(3);
  });

  it("reports a stale CAS as the exact conflict message", async () => {
    const repo = await seededRepo(makeSuite());
    // Simulate another tab writing between load and save.
    const originalSave = repo.saveSuite.bind(repo);
    repo.saveSuite = async () => {
      throw new StorageError("conflict", "Stale revision: expected 1, got 2");
    };
    const result = await appendModelToSuite(repo, {
      suiteId: "suite-1",
      slot: NEW_SLOT,
      now: 5000,
    });
    repo.saveSuite = originalSave;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("conflict");
      expect(result.message).toBe(
        "Suite was modified elsewhere — the model was added to these results only.",
      );
    }
  });

  it("reports a missing suite as results-only", async () => {
    const repo = new InMemoryEvaluationRepository();
    const result = await appendModelToSuite(repo, {
      suiteId: "suite-missing",
      slot: NEW_SLOT,
      now: 5000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("not-found");
      expect(result.message).toMatch(/results only/i);
    }
  });

  it("reports a generic storage failure as results-only and never throws", async () => {
    const repo = await seededRepo(makeSuite());
    repo.getSuite = async () => {
      throw new StorageError("unavailable", "IndexedDB blocked");
    };
    const result = await appendModelToSuite(repo, {
      suiteId: "suite-1",
      slot: NEW_SLOT,
      now: 5000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("storage");
      expect(result.message).toMatch(/unavailable/i);
      expect(result.message).toMatch(/results only/i);
    }
  });

  it("reports a save-time storage failure as results-only", async () => {
    const repo = await seededRepo(makeSuite());
    repo.saveSuite = async () => {
      throw new StorageError("quota", "QuotaExceededError");
    };
    const result = await appendModelToSuite(repo, {
      suiteId: "suite-1",
      slot: NEW_SLOT,
      now: 5000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("storage");
      expect(result.message).toMatch(/full/i);
    }
  });
});

describe("appendModelToSuite — canonical Task Set sync (spec 7.9)", () => {
  it("appends a new Task Set Version with the added slot when the Task Set is canonical", async () => {
    const suite = makeSuite({ version: 1 });
    const repo = await seededRepo(suite);
    const taskSetRepo = new InMemoryTaskSetRepository();
    // Seed the canonical Task Set record + v1 for the same suite id.
    const record = suiteToTaskSetRecord(suite);
    const { version } = suiteToTaskSetVersion(suite);
    await taskSetRepo.createTaskSet({ ...record, latestVersion: 1 }, { ...version, version: 1 });

    const result = await appendModelToSuite(repo, {
      suiteId: "suite-1",
      slot: NEW_SLOT,
      now: 5000,
      taskSetRepository: taskSetRepo,
    });

    expect(result).toEqual({ ok: true, suiteVersion: 2 });

    // A new Task Set Version row exists with the appended slot identity.
    const v2 = await taskSetRepo.getTaskSetVersion("suite-1", 2);
    expect(v2).not.toBeNull();
    expect(v2!.defaultModelSlots).toHaveLength(3);
    expect(v2!.defaultModelSlots[2].id).toBe(NEW_SLOT.id);
    expect(v2!.defaultModelSlots[2].slug).toBe(NEW_SLOT.slug);
    // Members are preserved untouched.
    expect(v2!.members).toHaveLength(1);
    expect(v2!.members[0].id).toBe("t1");

    // The legacy Suite compatibility write also landed.
    const saved = await repo.getSuite("suite-1");
    expect(saved).not.toBeNull();
    expect(saved!.modelSlots).toHaveLength(3);
    expect(saved!.version).toBe(2);
    expect(saved!.revision).toBe(2);
  });

  it("reports a canonical sync conflict as results-only without creating a Task Set Version", async () => {
    const suite = makeSuite({ version: 1 });
    const repo = await seededRepo(suite);
    const taskSetRepo = new InMemoryTaskSetRepository();
    const record = suiteToTaskSetRecord(suite);
    const { version } = suiteToTaskSetVersion(suite);
    await taskSetRepo.createTaskSet({ ...record, latestVersion: 1 }, { ...version, version: 1 });

    // A stale revision makes the atomic save conflict.
    repo.saveSuiteAndTaskSetVersion = async () => {
      throw new StorageError("conflict", "Stale revision");
    };
    const result = await appendModelToSuite(repo, {
      suiteId: "suite-1",
      slot: NEW_SLOT,
      now: 5000,
      taskSetRepository: taskSetRepo,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("conflict");
    expect(await taskSetRepo.getTaskSetVersion("suite-1", 2)).toBeNull();
    expect(await taskSetRepo.getTaskSetRecord("suite-1")).toMatchObject({ latestVersion: 1 });
  });
});
