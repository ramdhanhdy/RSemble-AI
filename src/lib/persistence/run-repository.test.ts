// =============================================================================
// RSemble AI — Run repository tests
//
// Exercises both the Dexie-backed repository and the InMemoryRunRepository
// against the same behavioral contract. Covers the 15 persistence requirements
// from the evaluation-workspaces implementation plan Task 1.2.
// =============================================================================

import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RSembleEvaluationDB, type RunDetailRow } from "./database";
import { LEASE_KEY, type LeaseInfo } from "../execution-lease";
import { createRunRepository, InMemoryRunRepository, type RunRepository } from "./run-repository";
import { exportWorkbenchArchive, importWorkbenchArchive, type WorkbenchArchiveV1 } from "./archive";
import type { FullRunSummaryV2, LegacyRunSummary, RunArchiveV1, RunRecordV2 } from "./run-types";

// ---------------------------------------------------------------------------
// Valid baselines (mirrors run-types.test.ts so records pass validators)
// ---------------------------------------------------------------------------

function makeRunRecord(id: string, overrides: Partial<RunRecordV2> = {}): RunRecordV2 {
  return {
    schemaVersion: 2,
    id,
    revision: 0,
    execution: { ownerId: "owner", fence: 1 },
    createdAt: 1,
    updatedAt: 2,
    completedAt: null,
    status: "running",
    mode: "rank",
    source: { kind: "adhoc" },
    task: { title: "Task " + id, prompt: "p", systemPrompt: "s", temperature: 0 },
    evaluation: {
      profile: null,
      candidateMessages: [{ role: "user", content: "hi" }],
    },
    candidates: [],
    judge: {
      status: "idle",
      acceptedAttemptId: null,
      report: null,
      consensus: null,
      attempts: [],
    },
    fusion: { status: "idle", acceptedAttemptId: null, attempts: [] },
    winnerKeys: [],
    ...overrides,
  };
}

function makeFullSummary(
  id: string,
  createdAt: number,
  overrides: Partial<FullRunSummaryV2> = {},
): FullRunSummaryV2 {
  return {
    kind: "full",
    schemaVersion: 2,
    id,
    revision: 0,
    createdAt,
    completedAt: null,
    status: "running",
    mode: "rank",
    source: { kind: "adhoc" },
    taskTitle: "Task " + id,
    taskExcerpt: "excerpt-" + id,
    modelKeys: ["openrouter:foo"],
    winnerKeys: ["openrouter:foo"],
    scoresByModelKey: { "openrouter:foo": 5 },
    judgeModelKey: null,
    evaluationProfileId: null,
    evaluationProfileVersion: null,
    detailAvailable: true,
    searchText: "excerpt-" + id,
    ...overrides,
  };
}

function makeLegacySummary(id: string, createdAt: number): LegacyRunSummary {
  return {
    kind: "legacy",
    schemaVersion: "1-import",
    id,
    createdAt,
    taskExcerpt: "legacy-" + id,
    modelKeys: ["legacy-model"],
    winnerKeys: ["legacy-model"],
    scoresByModelKey: { "legacy-model": 3 },
    detailAvailable: false,
    searchText: "legacy-" + id,
  };
}

// Test seam: force the DB lifecycle state for blocked/versionchange tests.
function setDbState(
  db: RSembleEvaluationDB,
  state: "ready" | "blocked" | "versionchange" | "unavailable",
): void {
  db.setState(state);
}

// ---------------------------------------------------------------------------
// Shared test suite — parameterized over Dexie and InMemory implementations
// ---------------------------------------------------------------------------

function runRepositorySuite(
  label: string,
  factory: () => Promise<{
    repo: RunRepository;
    cleanup?: () => Promise<void>;
    db?: RSembleEvaluationDB;
  }>,
) {
  describe(label, () => {
    let repo: RunRepository;
    let cleanup: (() => Promise<void>) | undefined;

    beforeEach(async () => {
      const ctx = await factory();
      repo = ctx.repo;
      cleanup = ctx.cleanup;
    });

    afterEach(async () => {
      if (cleanup) await cleanup();
    });

    // 1. create writes summary and detail atomically
    it("create writes summary and detail atomically", async () => {
      const record = makeRunRecord("r1");
      const summary = makeFullSummary("r1", 100);
      await repo.create(record, summary);

      const got = await repo.get("r1");
      expect(got).not.toBeNull();
      expect(got!.id).toBe("r1");
      expect(got!.revision).toBe(0);
    });

    // 2. list returns summaries newest first
    it("list returns summaries newest first", async () => {
      await repo.create(makeRunRecord("old"), makeFullSummary("old", 100));
      await repo.create(makeRunRecord("mid"), makeFullSummary("mid", 200));
      await repo.create(makeRunRecord("new"), makeFullSummary("new", 300));

      const list = await repo.list({});
      expect(list).toHaveLength(3);
      expect(list[0].id).toBe("new");
      expect(list[1].id).toBe("mid");
      expect(list[2].id).toBe("old");
    });

    // 3. list does not load detail records
    it("list does not load detail records", async () => {
      await repo.create(makeRunRecord("r1"), makeFullSummary("r1", 100));
      const list = await repo.list({});
      expect(list).toHaveLength(1);
      // Summaries must NOT carry the detail-only fields of RunRecordV2.
      expect("candidates" in list[0]).toBe(false);
      expect("judge" in list[0]).toBe(false);
      expect("fusion" in list[0]).toBe(false);
      // But they DO carry summary-specific fields.
      expect("detailAvailable" in list[0]).toBe(true);
    });

    // 4. combined model/status/mode/source filters work
    it("combined model/status/mode/source filters work", async () => {
      await repo.create(
        makeRunRecord("rA", { status: "completed" }),
        makeFullSummary("rA", 100, {
          status: "completed",
          mode: "rank",
          modelKeys: ["openrouter:foo"],
        }),
      );
      await repo.create(
        makeRunRecord("rB", { status: "failed" }),
        makeFullSummary("rB", 200, {
          status: "failed",
          mode: "fuse",
          modelKeys: ["gemini:bar"],
        }),
      );
      await repo.create(
        makeRunRecord("rC", { status: "completed" }),
        makeFullSummary("rC", 300, {
          status: "completed",
          mode: "fuse",
          modelKeys: ["gemini:bar"],
        }),
      );

      // Filter by model
      expect((await repo.list({ modelKey: "gemini:bar" })).map((s) => s.id).sort()).toEqual([
        "rB",
        "rC",
      ]);
      // Filter by status
      expect((await repo.list({ status: "completed" })).map((s) => s.id).sort()).toEqual([
        "rA",
        "rC",
      ]);
      // Filter by mode
      expect((await repo.list({ mode: "fuse" })).map((s) => s.id).sort()).toEqual(["rB", "rC"]);
      // Filter by source adhoc
      expect((await repo.list({ source: "adhoc" })).map((s) => s.id).sort()).toEqual([
        "rA",
        "rB",
        "rC",
      ]);
      // Combined model + status + mode
      expect(
        (await repo.list({ modelKey: "gemini:bar", status: "completed", mode: "fuse" })).map(
          (s) => s.id,
        ),
      ).toEqual(["rC"]);
    });

    // 5. text query matches normalized title/excerpt/model search text
    it("text query matches normalized title/excerpt/model search text", async () => {
      await repo.create(
        makeRunRecord("r1"),
        makeFullSummary("r1", 100, {
          taskTitle: "Alpha Beta Gamma",
          taskExcerpt: "Delta epsilon",
          modelKeys: ["openrouter:Zeta"],
        }),
      );
      await repo.create(
        makeRunRecord("r2"),
        makeFullSummary("r2", 200, {
          taskTitle: "Unrelated",
          taskExcerpt: "nothing here",
          modelKeys: ["gemini:other"],
        }),
      );

      // Match on title (case-insensitive)
      expect((await repo.list({ text: "alpha beta" })).map((s) => s.id)).toEqual(["r1"]);
      // Match on excerpt
      expect((await repo.list({ text: "delta" })).map((s) => s.id)).toEqual(["r1"]);
      // Match on model key
      expect((await repo.list({ text: "zeta" })).map((s) => s.id)).toEqual(["r1"]);
      // No match returns empty
      expect((await repo.list({ text: "nonexistent" })).map((s) => s.id)).toEqual([]);
    });

    // 6. update requires expectedRevision, increments atomically, rejects stale/illegal regressions
    it("update requires expectedRevision, increments atomically, rejects stale/illegal regressions", async () => {
      const record = makeRunRecord("r1", { status: "running" });
      const summary = makeFullSummary("r1", 100, { status: "running" });
      await repo.create(record, summary);

      // Update with correct expectedRevision 0 → returns 1
      const rev1 = await repo.update(
        makeRunRecord("r1", { status: "completed", revision: 0 }),
        makeFullSummary("r1", 100, { status: "completed" }),
        0,
      );
      expect(rev1).toBe(1);

      // Stale revision 0 again → conflict
      await expect(
        repo.update(
          makeRunRecord("r1", { status: "failed" }),
          makeFullSummary("r1", 100, { status: "failed" }),
          0,
        ),
      ).rejects.toThrow();

      // Illegal regression: terminal status (completed) → running
      await expect(
        repo.update(
          makeRunRecord("r1", { status: "running" }),
          makeFullSummary("r1", 100, { status: "running" }),
          1,
        ),
      ).rejects.toThrow();
    });

    // 7. importLegacySummary writes only a discriminated summary
    it("importLegacySummary writes only a discriminated summary", async () => {
      const result = await repo.importLegacySummary(makeLegacySummary("leg1", 100));
      expect(result).toBe("created");

      // No detail exists for legacy
      const got = await repo.get("leg1");
      expect(got).toBeNull();

      // But summary is listable
      const list = await repo.list({});
      expect(list).toHaveLength(1);
      expect(list[0].kind).toBe("legacy");
      expect(list[0].detailAvailable).toBe(false);
    });

    // 8. same-ID create is rejected
    it("same-ID create is rejected", async () => {
      await repo.create(makeRunRecord("dup"), makeFullSummary("dup", 100));
      await expect(
        repo.create(makeRunRecord("dup"), makeFullSummary("dup", 100)),
      ).rejects.toThrow();
    });

    // 9. create rejects mismatched record/summary IDs
    it("create rejects mismatched record/summary IDs", async () => {
      await expect(
        repo.create(makeRunRecord("id-a"), makeFullSummary("id-b", 100)),
      ).rejects.toThrow();
    });

    // 10. update persists new revision in the record
    it("update persists new revision in the record", async () => {
      await repo.create(makeRunRecord("r1"), makeFullSummary("r1", 100));

      const rev1 = await repo.update(
        makeRunRecord("r1", { status: "completed" }),
        makeFullSummary("r1", 100, { status: "completed" }),
        0,
      );
      expect(rev1).toBe(1);

      const got1 = await repo.get("r1");
      expect(got1!.revision).toBe(1);

      const rev2 = await repo.update(
        makeRunRecord("r1", { status: "failed" }),
        makeFullSummary("r1", 100, { status: "failed" }),
        1,
      );
      expect(rev2).toBe(2);

      const got2 = await repo.get("r1");
      expect(got2!.revision).toBe(2);
    });

    // 12. filtering before pagination
    it("filtering is applied before pagination", async () => {
      // Create 55 runs; the target has the lowest createdAt so it falls
      // beyond the default 50-item page in descending order. Filtering must
      // run first so the single match is still returned.
      for (let i = 1; i <= 54; i++) {
        const id = "run-" + i;
        await repo.create(
          makeRunRecord(id),
          makeFullSummary(id, 1000 + i, {
            taskTitle: "ordinary",
            taskExcerpt: "ordinary",
          }),
        );
      }
      // Target: lowest createdAt, unique marker.
      await repo.create(
        makeRunRecord("target"),
        makeFullSummary("target", 1, {
          taskTitle: "UNIQUE_MARKER_PAGINATION",
          taskExcerpt: "UNIQUE_MARKER_PAGINATION",
        }),
      );

      const results = await repo.list({ text: "unique_marker_pagination" });
      expect(results.map((s) => s.id)).toEqual(["target"]);
    });

    // 13. subscribe notifies once after committed mutation
    it("subscribe notifies once after committed mutation", async () => {
      const listener = vi.fn();
      const unsub = repo.subscribe(listener);
      await repo.create(makeRunRecord("r1"), makeFullSummary("r1", 100));
      expect(listener).toHaveBeenCalledTimes(1);
      unsub();
      await repo.create(makeRunRecord("r2"), makeFullSummary("r2", 200));
      expect(listener).toHaveBeenCalledTimes(1);
    });

    // 15. importArchive pairs records with same-ID summaries
    it("importArchive pairs records with same-ID summaries", async () => {
      const archive: RunArchiveV1 = {
        schemaVersion: 1,
        exportedAt: 1000,
        runs: [
          makeRunRecord("match-1"),
          makeRunRecord("orphan-1"), // record with no matching summary
        ],
        summaries: [makeFullSummary("match-1", 100), makeLegacySummary("legacy-1", 200)],
      };

      const result = await repo.importArchive(archive);
      expect(result.imported).toBe(2); // match-1 (full run) + legacy-1
      expect(result.skipped).toBe(0);
      // orphan-1 has no matching summary → error
      expect(result.errors.length).toBe(1);

      // Verify matching pair persisted
      const got = await repo.get("match-1");
      expect(got).not.toBeNull();
      expect(got!.id).toBe("match-1");

      // Verify orphan detail was not imported
      const orphanDetail = await repo.get("orphan-1");
      expect(orphanDetail).toBeNull();

      const list = await repo.list({});
      expect(list.map((s) => s.id).sort()).toEqual(["legacy-1", "match-1"]);
    });
  });
}

// ---------------------------------------------------------------------------
// Dexie-backed-only tests (transaction failure + blocked state need DB access)
// ---------------------------------------------------------------------------

describe("Dexie-backed RunRepository — transaction + state guards", () => {
  let db: RSembleEvaluationDB;

  beforeEach(() => {
    db = new RSembleEvaluationDB("test-" + Math.random().toString(36).slice(2));
  });

  afterEach(async () => {
    db.close();
  });

  // 11. transaction failure writes neither summary nor detail
  it("transaction failure writes neither summary nor detail", async () => {
    const repo = createRunRepository(db);
    // Seed one valid run so the detail table is non-empty baseline.
    await repo.create(makeRunRecord("seed"), makeFullSummary("seed", 100));

    // Force runDetails.put to fail for the "boom" id mid-transaction.
    const originalPut = db.runDetails.put.bind(db.runDetails);
    db.runDetails.put = vi.fn(async (row: RunDetailRow) => {
      if (row.id === "boom") throw new Error("forced transaction failure");
      return originalPut(row);
    }) as unknown as typeof db.runDetails.put;

    await expect(
      repo.create(makeRunRecord("boom"), makeFullSummary("boom", 200)),
    ).rejects.toThrow();

    // Restore before reads.
    db.runDetails.put = originalPut as unknown as typeof db.runDetails.put;

    // Neither summary nor detail for "boom" should exist (transaction rolled back).
    const summaryRow = await db.runSummaries.get("boom");
    expect(summaryRow).toBeUndefined();
    const detailRow = await db.runDetails.get("boom");
    expect(detailRow).toBeUndefined();
    // Seed record untouched.
    expect(await repo.get("seed")).not.toBeNull();
  });

  it("rejects create and update when an exact fence was superseded or expired", async () => {
    const repo = createRunRepository(db, { now: () => 100 });
    const oldFence = { ownerId: "tab-a", fence: 1, leaseId: "lease-a", checkedAt: 100 };
    const currentLease: LeaseInfo = {
      ownerId: "tab-b",
      fence: 2,
      leaseId: "lease-b",
      acquiredAt: 90,
      heartbeatAt: 90,
      expiresAt: 1_000,
    };
    await db.storageMeta.put({ key: LEASE_KEY, value: currentLease });

    await expect(
      repo.create(
        makeRunRecord("superseded-create", {
          execution: { ownerId: "tab-a", fence: 1, leaseId: "lease-a" },
        }),
        makeFullSummary("superseded-create", 100),
        oldFence,
      ),
    ).rejects.toThrow(/token mismatch/i);
    expect(await repo.get("superseded-create")).toBeNull();

    await repo.create(
      makeRunRecord("superseded-update"),
      makeFullSummary("superseded-update", 100),
    );
    await expect(
      repo.update(
        makeRunRecord("superseded-update", {
          status: "completed",
          completedAt: 100,
          execution: { ownerId: "tab-a", fence: 1, leaseId: "lease-a" },
        }),
        makeFullSummary("superseded-update", 100, { status: "completed", completedAt: 100 }),
        0,
        oldFence,
      ),
    ).rejects.toThrow(/token mismatch/i);
    expect((await repo.get("superseded-update"))!.status).toBe("running");

    const expiredLease: LeaseInfo = {
      ...currentLease,
      ownerId: "tab-a",
      fence: 1,
      leaseId: "lease-a",
      expiresAt: 99,
    };
    await db.storageMeta.put({ key: LEASE_KEY, value: expiredLease });
    await expect(
      repo.create(
        makeRunRecord("expired-create", {
          execution: { ownerId: "tab-a", fence: 1, leaseId: "lease-a" },
        }),
        makeFullSummary("expired-create", 100),
        oldFence,
      ),
    ).rejects.toThrow(/expired/i);
    expect(await repo.get("expired-create")).toBeNull();
  });

  // 14. blocked/version-change states stop writes
  it("blocked state stops writes with a retryable error", async () => {
    const repo = createRunRepository(db);
    setDbState(db, "blocked");

    await expect(
      repo.create(makeRunRecord("blocked"), makeFullSummary("blocked", 100)),
    ).rejects.toThrow(/blocked/i);

    // Restore writability.
    setDbState(db, "ready");
    await repo.create(makeRunRecord("after"), makeFullSummary("after", 100));
    expect(await repo.get("after")).not.toBeNull();
  });

  it("versionchange state stops writes", async () => {
    const repo = createRunRepository(db);
    setDbState(db, "versionchange");

    await expect(repo.create(makeRunRecord("vc"), makeFullSummary("vc", 100))).rejects.toThrow();

    setDbState(db, "ready");
  });
});

// ---------------------------------------------------------------------------
// Run the shared suite for both implementations
// ---------------------------------------------------------------------------

runRepositorySuite("InMemoryRunRepository", async () => ({
  repo: new InMemoryRunRepository(),
}));

runRepositorySuite("createRunRepository (Dexie + fake-indexeddb)", async () => {
  const db = new RSembleEvaluationDB("test-" + Math.random().toString(36).slice(2));
  return {
    repo: createRunRepository(db),
    db,
    cleanup: async () => {
      db.close();
    },
  };
});

// A record written by the previous validator can have immutable attempts but
// stale accepted pointers after a candidate replacement. It must be repaired,
// not discarded, when read, exported, updated, or imported.
function staleEvidenceRun(id: string): RunRecordV2 {
  return makeRunRecord(id, {
    revision: 1,
    status: "completed",
    completedAt: 2,
    candidates: [
      {
        candidateId: "c-1",
        slotId: "s-1",
        modelKey: "openrouter:foo",
        providerId: "openrouter",
        model: "Foo",
        slug: "foo",
        acceptedAttemptId: "removed-attempt",
        attempts: [],
      },
    ],
    winnerKeys: ["openrouter:foo"],
  });
}

function emptyWorkbenchArchive(details: RunRecordV2[], summary: FullRunSummaryV2): WorkbenchArchiveV1 {
  return {
    schemaVersion: 1,
    exportedAt: 10,
    runs: { summaries: [summary], details },
    profiles: { identities: [], versions: [] },
    suites: [],
    experiments: [],
  };
}

describe("persisted run compatibility repair", () => {
  it("repairs stale evidence across the in-memory public repository boundary", async () => {
    const stale = staleEvidenceRun("stale-memory");
    const summary = makeFullSummary(stale.id, 1, { revision: 1, status: "completed" });
    const details = new Map([[stale.id, stale]]);
    const summaries = new Map<string, FullRunSummaryV2>([[summary.id, summary]]);
    const repo = new InMemoryRunRepository({ details, summaries });

    const repaired = await repo.get(stale.id);
    expect(repaired?.candidates[0]?.acceptedAttemptId).toBeNull();
    expect(repaired?.winnerKeys).toEqual([]);
    expect((await repo.exportAll()).runs[0]?.candidates[0]?.acceptedAttemptId).toBeNull();
    await expect(
      repo.update(stale, { ...summary, revision: 1 }, 1),
    ).resolves.toBe(2);
  });

  it("repairs stale evidence through Dexie get/export/update and workbench import", async () => {
    const db = new RSembleEvaluationDB("compat-" + Math.random().toString(36).slice(2));
    const repo = createRunRepository(db);
    const stale = staleEvidenceRun("stale-dexie");
    const summary = makeFullSummary(stale.id, 1, { revision: 1, status: "completed" });
    await db.runSummaries.put({
      kind: "full",
      summary,
      id: summary.id,
      revision: summary.revision,
      createdAt: summary.createdAt,
      completedAt: summary.completedAt,
      status: summary.status,
      mode: summary.mode,
      sourceKind: "adhoc",
      sourceProtocolFingerprint: null,
      sourceExperimentTaskAttemptId: null,
      modelKeys: summary.modelKeys,
    });
    await db.runDetails.put({
      id: stale.id,
      record: stale,
      revision: stale.revision,
      createdAt: stale.createdAt,
      status: stale.status,
    });

    const repaired = await repo.get(stale.id);
    expect(repaired?.candidates[0]?.acceptedAttemptId).toBeNull();
    expect((await repo.exportAll()).runs).toHaveLength(1);
    await expect(repo.update(stale, summary, 1)).resolves.toBe(2);

    const importedDb = new RSembleEvaluationDB("compat-import-" + Math.random().toString(36).slice(2));
    const imported = await importWorkbenchArchive(
      importedDb,
      emptyWorkbenchArchive([staleEvidenceRun("stale-import")], makeFullSummary("stale-import", 1, { revision: 1, status: "completed" })),
    );
    expect(imported.created).toContain("stale-import");
    const importedArchive = await exportWorkbenchArchive(importedDb);
    expect(importedArchive.runs.details[0]?.candidates[0]?.acceptedAttemptId).toBeNull();

    db.close();
    importedDb.close();
  });
});
