// =============================================================================
// RSemble AI — Execution lease tests
//
// Covers the cross-tab execution lease contract from the workspaces plan
// (§5.6 / tests 1–6, 8–10): acquisition, heartbeat renewal, expiry, recovery of
// interrupted runs, monotonic fencing, simultaneous-acquisition single-winner,
// and BroadcastChannel loss with IndexedDB remaining authoritative.
//
// Time-dependent behavior is driven by an injectable `now` clock + a tiny `ttl`
// rather than vitest fake timers: Dexie transactions schedule on real
// microtasks/setTimeout, which fake timers suspend, deadlocking the DB. The
// InMemoryExecutionLease (pure, no Dexie) is additionally exercised with fake
// timers since it has no such constraint.
// =============================================================================

import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RSembleEvaluationDB } from "./persistence/database";
import { createRunRepository, InMemoryRunRepository } from "./persistence/run-repository";
import type { RunRepository } from "./persistence/run-repository";
import type { FullRunSummaryV2, RunRecordV2 } from "./persistence/run-types";
import {
  createExecutionLease,
  HEARTBEAT_INTERVAL,
  InMemoryExecutionLease,
  LEASE_KEY,
  LEASE_TTL,
  LeaseError,
} from "./execution-lease";

// ---------------------------------------------------------------------------
// Stubs: crypto.randomUUID and BroadcastChannel may be absent in the test env.
// ---------------------------------------------------------------------------

let uuidCounter = 0;
const stubUuid = () => `uuid-${++uuidCounter}`;

class MockBroadcastChannel {
  static instances: MockBroadcastChannel[] = [];
  private listeners: ((ev: { data: unknown }) => void)[] = [];
  readonly name: string;
  constructor(name: string) {
    this.name = name;
    MockBroadcastChannel.instances.push(this);
  }
  postMessage(data: unknown): void {
    for (const ch of MockBroadcastChannel.instances) {
      if (ch === this || ch.name !== this.name) continue;
      for (const l of [...ch.listeners]) l({ data });
    }
  }
  set onmessage(fn: ((ev: { data: unknown }) => void) | null) {
    if (fn) this.listeners.push(fn);
  }
  get onmessage(): ((ev: { data: unknown }) => void) | null {
    return this.listeners[this.listeners.length - 1] ?? null;
  }
  close(): void {
    this.listeners = [];
  }
}

// ---------------------------------------------------------------------------
// Test fixtures
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

async function seedRunningRun(
  repo: RunRepository,
  id: string,
  ownerId: string,
  fence: number,
): Promise<void> {
  await repo.create(
    makeRunRecord(id, { execution: { ownerId, fence } }),
    makeFullSummary(id, 1000),
  );
}

/** A controllable clock for time-dependent lease tests. */
function makeClock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    set: (ms: number) => {
      t = ms;
    },
  };
}

// ---------------------------------------------------------------------------
// Environment setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  uuidCounter = 0;
  MockBroadcastChannel.instances = [];
  const cryptoObj = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (cryptoObj) {
    vi.spyOn(cryptoObj, "randomUUID").mockImplementation(stubUuid);
  } else {
    Object.defineProperty(globalThis, "crypto", {
      value: { randomUUID: stubUuid },
      configurable: true,
    });
  }
  (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = MockBroadcastChannel;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests 1–6, 8–10 against the Dexie-backed lease.
// ---------------------------------------------------------------------------

describe("createExecutionLease (Dexie-backed)", () => {
  let db: RSembleEvaluationDB;

  beforeEach(async () => {
    db = new RSembleEvaluationDB(`test-lease-${Date.now()}-${Math.random()}`);
    await db.open();
  });

  afterEach(async () => {
    db.close();
  });

  // Test 1: acquire / heartbeat / broadcast
  it("acquires a lease with a random owner-id via storageMeta transaction, renews by revisioned transaction, and broadcasts status", async () => {
    const clock = makeClock();
    const lease = createExecutionLease(db, { now: clock.now, ttl: LEASE_TTL });
    const states: { status: string }[] = [];
    const unsub = lease.subscribe((s) => states.push(s));

    const acquired = await lease.acquire();
    expect(acquired.ownerId).toBe("uuid-1");
    expect(acquired.fence).toBe(1);
    expect(acquired.expiresAt).toBe(clock.now() + LEASE_TTL);

    // Persisted in storageMeta atomically.
    const row = await db.storageMeta.get(LEASE_KEY);
    expect(row?.value).toEqual(acquired);

    // verify / isOwner agree.
    expect(await lease.isOwner()).toBe(true);
    expect(await lease.verify()).toEqual(acquired);

    // Heartbeat renewal extends the expiry and preserves owner + fence.
    clock.advance(HEARTBEAT_INTERVAL);
    const renewed = await lease.renew();
    expect(renewed.ownerId).toBe(acquired.ownerId);
    expect(renewed.fence).toBe(acquired.fence);
    expect(renewed.expiresAt).toBeGreaterThan(acquired.expiresAt);

    expect(states.some((s) => s.status === "owned")).toBe(true);
    unsub();
  });

  // Test 2: a live second tab cannot acquire; it sees contested/read-only.
  it("rejects acquisition by a second tab while the first lease is live and exposes the current (contested) lease read-only", async () => {
    const clock = makeClock();
    const tabA = createExecutionLease(db, { now: clock.now });
    const tabB = createExecutionLease(db, { now: clock.now });

    await tabA.acquire();
    await expect(tabB.acquire()).rejects.toBeInstanceOf(LeaseError);

    const err = await tabB.acquire().catch((e) => e);
    expect(err).toBeInstanceOf(LeaseError);
    expect((err as LeaseError).kind).toBe("contested");
    expect((err as LeaseError).lease?.ownerId).toBe("uuid-1"); // tabA's live lease

    // tabB can read the live lease (read-only) but does not own it.
    const current = await tabB.getCurrent();
    expect(current).not.toBeNull();
    expect(current?.ownerId).toBe("uuid-1");
    expect(await tabB.isOwner()).toBe(false);
  });

  // Test 3: expired lease can be acquired; never silently resumes paid work.
  it("allows takeover once the lease has expired, with an incremented fence", async () => {
    const clock = makeClock();
    const lease = createExecutionLease(db, { now: clock.now, ttl: LEASE_TTL });
    const acquired = await lease.acquire();
    expect(acquired.fence).toBe(1);

    // Advance past TTL so the lease is expired (but still persisted).
    clock.advance(LEASE_TTL + 1);
    expect(await lease.verify()).toBeNull();
    expect(await lease.getCurrent()).toBeNull();

    // A fresh acquisition wins with an incremented fence.
    const taken = await lease.acquire();
    expect(taken.fence).toBe(2);
    expect(taken.ownerId).not.toBe(acquired.ownerId);
  });

  // Test 4: only the lease owner converts stale "running" runs to "interrupted".
  it("recovers running runs whose owner is not the current lease holder to interrupted", async () => {
    const clock = makeClock();
    const repo = createRunRepository(db);
    const lease = createExecutionLease(db, { now: clock.now });

    const acquired = await lease.acquire();
    const currentOwner = acquired.ownerId;
    const currentFence = acquired.fence;

    // Run owned by a *different* (stale) owner — interruptible.
    await seedRunningRun(repo, "run-stale", "old-tab", currentFence - 1);
    // Run owned by the current owner under the current fence — left alone.
    await seedRunningRun(repo, "run-live", currentOwner, currentFence);

    const count = await lease.recoverInterruptedRuns(repo);
    expect(count).toBe(1);

    const stale = await repo.get("run-stale");
    expect(stale?.status).toBe("interrupted");
    const live = await repo.get("run-live");
    expect(live?.status).toBe("running");
  });

  // Test 5: terminal runs are unchanged by recovery.
  it("leaves completed/failed/aborted records untouched", async () => {
    const clock = makeClock();
    const repo = createRunRepository(db);
    const lease = createExecutionLease(db, { now: clock.now });
    await lease.acquire();

    const terminalStatuses = ["completed", "failed", "aborted"] as const;
    for (const status of terminalStatuses) {
      await repo.create(
        makeRunRecord(`run-${status}`, {
          status,
          completedAt: 5000,
          execution: { ownerId: "old-tab", fence: 0 },
        }),
        makeFullSummary(`run-${status}`, 1000, { status }),
      );
    }

    const count = await lease.recoverInterruptedRuns(repo);
    expect(count).toBe(0);
    for (const status of terminalStatuses) {
      const got = await repo.get(`run-${status}`);
      expect(got?.status).toBe(status);
    }
  });

  // Test 6: recovery is idempotent.
  it("is idempotent — a second sweep recovers nothing new", async () => {
    const clock = makeClock();
    const repo = createRunRepository(db);
    const lease = createExecutionLease(db, { now: clock.now });
    await lease.acquire();

    await seedRunningRun(repo, "run-a", "old-tab", 0);
    await seedRunningRun(repo, "run-b", "old-tab", 0);

    const first = await lease.recoverInterruptedRuns(repo);
    expect(first).toBe(2);
    const second = await lease.recoverInterruptedRuns(repo);
    expect(second).toBe(0);

    expect((await repo.get("run-a"))?.status).toBe("interrupted");
    expect((await repo.get("run-b"))?.status).toBe("interrupted");
  });

  // Test 8: heartbeat keeps a lease alive; stopping heartbeats allows crash takeover.
  it("heartbeat keeps a live lease alive; stopping heartbeats lets a crash takeover occur after TTL", async () => {
    const clock = makeClock();
    const tabA = createExecutionLease(db, { now: clock.now, ttl: LEASE_TTL });
    const tabB = createExecutionLease(db, { now: clock.now, ttl: LEASE_TTL });

    const a = await tabA.acquire();
    expect(a.fence).toBe(1);

    // Heartbeat well within TTL keeps tabA as owner.
    clock.advance(HEARTBEAT_INTERVAL);
    const renewed = await tabA.renew();
    expect(renewed.ownerId).toBe(a.ownerId);
    expect(await tabA.isOwner()).toBe(true);
    expect(await tabB.isOwner()).toBe(false);

    // tabA "crashes" — no further heartbeats. After TTL, tabB takes over.
    clock.advance(LEASE_TTL + 1);
    expect(await tabA.verify()).toBeNull();

    const b = await tabB.acquire();
    expect(b.ownerId).not.toBe(a.ownerId);
    expect(b.fence).toBe(a.fence + 1); // monotonic fence increments
    expect(await tabB.isOwner()).toBe(true);
  });

  // Test 8b: simultaneous acquisition has exactly one winner.
  it("concurrent acquisitions from two tabs yield exactly one winner (Dexie transaction serialization)", async () => {
    const clock = makeClock();
    const tabA = createExecutionLease(db, { now: clock.now });
    const tabB = createExecutionLease(db, { now: clock.now });

    const [a, b] = await Promise.allSettled([tabA.acquire(), tabB.acquire()]);
    const winners = [a, b].filter((r) => r.status === "fulfilled");
    const losers = [a, b].filter((r) => r.status === "rejected");
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect((losers[0] as PromiseRejectedResult).reason).toBeInstanceOf(LeaseError);

    // The persisted lease matches the single winner.
    const winner = (winners[0] as PromiseFulfilledResult<unknown>).value as {
      ownerId: string;
      fence: number;
    };
    const row = await db.storageMeta.get(LEASE_KEY);
    expect((row?.value as { ownerId: string }).ownerId).toBe(winner.ownerId);
  });

  // Test 9: BroadcastChannel loss/delay does not permit a second owner.
  it("remains authoritative via IndexedDB when BroadcastChannel is unavailable", async () => {
    const saved = (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;
    delete (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;

    const clock = makeClock();
    const tabA = createExecutionLease(db, { now: clock.now });
    const tabB = createExecutionLease(db, { now: clock.now });
    await tabA.acquire();
    await expect(tabB.acquire()).rejects.toBeInstanceOf(LeaseError);

    (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = saved;
  });

  // Test 10: takeover increments a monotonic fence; stale-owner renewal rejected.
  it("increments a monotonic fence across takeovers and rejects stale-owner renewals", async () => {
    const clock = makeClock();
    const tabA = createExecutionLease(db, { now: clock.now, ttl: LEASE_TTL });
    const tabB = createExecutionLease(db, { now: clock.now, ttl: LEASE_TTL });

    const a = await tabA.acquire();
    expect(a.fence).toBe(1);

    // tabA expires; tabB takes over with fence 2.
    clock.advance(LEASE_TTL + 1);
    const b = await tabB.acquire();
    expect(b.fence).toBe(2);

    // tabA (stale owner) cannot renew — its ownership is gone.
    const renewErr = await tabA.renew().catch((e) => e);
    expect(renewErr).toBeInstanceOf(LeaseError);
    expect((renewErr as LeaseError).kind).toBe("expired");
  });

  // Test 10b: release frees the lease for immediate takeover with incremented fence.
  it("release voluntarily surrenders ownership so another tab can acquire immediately with an incremented fence", async () => {
    const clock = makeClock();
    const tabA = createExecutionLease(db, { now: clock.now });
    const tabB = createExecutionLease(db, { now: clock.now });

    const a = await tabA.acquire();
    await tabA.release();
    expect(await tabA.isOwner()).toBe(false);

    const row = await db.storageMeta.get(LEASE_KEY);
    expect(row).toBeUndefined();

    const b = await tabB.acquire();
    expect(b.ownerId).not.toBe(a.ownerId);
    expect(b.fence).toBe(a.fence + 1); // fence persists across release
  });
});

// ---------------------------------------------------------------------------
// InMemoryExecutionLease — shared-store multi-tab simulation.
// ---------------------------------------------------------------------------

describe("InMemoryExecutionLease", () => {
  it("shares contention over one store so only one tab holds the lease at a time", async () => {
    const store = { lease: null as null | { ownerId: string; fence: number; expiresAt: number }, fence: 0 };
    const tabA = new InMemoryExecutionLease(store);
    const tabB = new InMemoryExecutionLease(store);

    const a = await tabA.acquire();
    expect(a.fence).toBe(1);
    await expect(tabB.acquire()).rejects.toBeInstanceOf(LeaseError);

    // After release, tabB takes over with an incremented fence.
    await tabA.release();
    const b = await tabB.acquire();
    expect(b.fence).toBe(2);
    expect(b.ownerId).not.toBe(a.ownerId);
  });

  it("recovers interrupted runs using the shared store", async () => {
    const store = { lease: null as null | { ownerId: string; fence: number; expiresAt: number }, fence: 0 };
    const lease = new InMemoryExecutionLease(store);
    const repo = new InMemoryRunRepository();
    const acquired = await lease.acquire();

    await seedRunningRun(repo, "stale", "other-tab", acquired.fence - 1);
    await seedRunningRun(repo, "live", acquired.ownerId, acquired.fence);

    const count = await lease.recoverInterruptedRuns(repo);
    expect(count).toBe(1);
    expect((await repo.get("stale"))?.status).toBe("interrupted");
    expect((await repo.get("live"))?.status).toBe("running");

    // Idempotent.
    expect(await lease.recoverInterruptedRuns(repo)).toBe(0);
  });

  // Fake timers are safe here: InMemoryExecutionLease has no Dexie dependency.
  it("expires and allows takeover with a monotonic fence under fake timers", async () => {
    vi.useFakeTimers();
    const store = { lease: null as null | { ownerId: string; fence: number; expiresAt: number }, fence: 0 };
    const tabA = new InMemoryExecutionLease(store);
    const tabB = new InMemoryExecutionLease(store);

    const a = await tabA.acquire();
    vi.advanceTimersByTime(LEASE_TTL + 1);
    expect(await tabA.verify()).toBeNull();

    const b = await tabB.acquire();
    expect(b.fence).toBe(a.fence + 1);
    vi.useRealTimers();
  });

  it("does not own a lease held by another tab (isOwner false, getCurrent returns it)", async () => {
    const store = { lease: null as null | { ownerId: string; fence: number; expiresAt: number }, fence: 0 };
    const tabA = new InMemoryExecutionLease(store);
    const tabB = new InMemoryExecutionLease(store);

    await tabA.acquire();
    expect(await tabB.isOwner()).toBe(false);
    const current = await tabB.getCurrent();
    expect(current).not.toBeNull();
  });
});
