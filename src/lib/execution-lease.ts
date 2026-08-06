// =============================================================================
// RSemble AI — Cross-tab execution lease
//
// Coordinates which browser tab owns paid (model-invoking) execution. A tab must
// hold the lease before it launches a run; the lease is renewed by a periodic
// heartbeat and expires if the owning tab crashes or is closed. Other tabs see
// read-only execution controls and may take over only after expiry.
//
// Authoritative state lives in the `storageMeta` table:
//   - "execution-lease"       — the active LeaseInfo, or absent when free.
//   - "execution-lease-fence" — the high-water fence counter, monotonic and
//     never reset, so takeovers (including after a voluntary release) always
//     issue a strictly-greater fence. A delayed write carrying an old owner or
//     old fence is rejected transactionally.
//
// Both keys are written inside Dexie transactions so simultaneous acquisitions
// from multiple tabs have exactly one winner. BroadcastChannel is a fast
// notification path only — IndexedDB remains the source of truth, so a
// lost/delayed broadcast can never permit a second owner.
// =============================================================================

import type { RSembleEvaluationDB, StorageMetaRow } from "./persistence/database";
import type { RunRepository } from "./persistence/run-repository";
import type { RunRecordV2 } from "./persistence/run-types";

// --- Constants ----------------------------------------------------------------

/** Lease time-to-live in ms. A lease is stale once `expiresAt` is in the past. */
export const LEASE_TTL = 10_000;
/** Recommended heartbeat interval in ms. Renew well before the TTL elapses. */
export const HEARTBEAT_INTERVAL = 3_000;
/** storageMeta key under which the active lease is persisted. */
export const LEASE_KEY = "execution-lease";
/** storageMeta key holding the monotonic high-water fence counter. */
export const FENCE_KEY = "execution-lease-fence";
/** BroadcastChannel name used for fast cross-tab lease notifications. */
export const LEASE_CHANNEL = "rsemble-lease";
/** DB polling fallback interval used when BroadcastChannel is unavailable. */
const POLL_FALLBACK_INTERVAL = 2_000;

// --- Types --------------------------------------------------------------------

export type LeaseKind = "compare" | "experiment";

export interface LeaseInfo {
  /** Unique acquisition token; stale owners cannot act with an old token. */
  leaseId?: string;
  /** Stable browser-tab/session identity. */
  ownerId: string;
  kind?: LeaseKind;
  executionId?: string;
  acquiredAt?: number;
  heartbeatAt?: number;
  fence: number;
  expiresAt: number;
}

export type LeaseState =
  | { status: "owned"; lease: LeaseInfo }
  | { status: "contested"; lease: LeaseInfo }
  | { status: "free" };

export type LeaseErrorKind = "contested" | "expired" | "unavailable";

export class LeaseError extends Error {
  readonly kind: LeaseErrorKind;
  readonly lease: LeaseInfo | null;
  constructor(kind: LeaseErrorKind, message: string, lease: LeaseInfo | null = null) {
    super(message);
    this.name = "LeaseError";
    this.kind = kind;
    this.lease = lease;
  }
}

export interface ExecutionLease {
  /** Acquire ownership. Returns the lease info or throws if contested. */
  acquire(options?: { kind?: LeaseKind; executionId?: string }): Promise<LeaseInfo>;
  /** Renew the lease (heartbeat). Must be called periodically while active.
   * When a token is supplied, renewal is fenced to that exact acquisition.
   * This prevents a delayed heartbeat from reviving/replacing a newer lease. */
  renew(token?: LeaseInfo): Promise<LeaseInfo>;
  /** Release ownership voluntarily. A supplied token makes release stale-safe. */
  release(token?: LeaseInfo): Promise<void>;
  /** Verify the current lease is still valid and owned by us. */
  verify(token?: LeaseInfo): Promise<LeaseInfo | null>;
  /** Check if we are the current owner. */
  isOwner(): Promise<boolean>;
  /** Get the current lease info (may be owned by another tab). */
  getCurrent(): Promise<LeaseInfo | null>;
  /** Subscribe to lease state changes. Returns unsubscribe. */
  subscribe(listener: (state: LeaseState) => void): () => void;
  /** Recover stale "running" runs whose owner is no longer active. */
  recoverInterruptedRuns(runRepo: RunRepository): Promise<number>;
  /** Best-effort idempotent cleanup for route teardown/tests. */
  dispose?: () => Promise<void> | void;
}

/** Options for constructing a Dexie-backed lease. */
export interface LeaseOptions {
  /** Override the TTL (ms). Defaults to LEASE_TTL. */
  ttl?: number;
  /** Override the wall clock. Defaults to Date.now. */
  now?: () => number;
  /** Override the poll fallback interval (ms). Defaults to 2_000. */
  pollInterval?: number;
  /** Stable owner identity for deterministic tab/session injection. */
  ownerId?: string;
  /** Default lease metadata for a repository instance. */
  kind?: LeaseKind;
  executionId?: string;
}

// --- Shared helpers -----------------------------------------------------------

interface BroadcastLike {
  postMessage(message: unknown): void;
  close(): void;
  set onmessage(handler: ((ev: { data: unknown }) => void) | null);
  get onmessage(): ((ev: { data: unknown }) => void) | null;
}

/** Type guard: a lease is live if it exists and has not expired. */
function isLive(lease: LeaseInfo | null, now: number): lease is LeaseInfo {
  return lease !== null && lease.expiresAt > now;
}

/**
 * Match an acquisition token, not merely an owner identity. ownerId alone is
 * deliberately insufficient: the same tab can acquire again after expiry and
 * a delayed callback from the previous controller must not touch the new run.
 */
function matchesToken(
  lease: LeaseInfo | null,
  token: { ownerId: string; fence?: number; leaseId?: string } | null,
): lease is LeaseInfo {
  if (!lease || !token) return false;
  return (
    lease.ownerId === token.ownerId &&
    (token.fence === undefined || lease.fence === token.fence) &&
    (token.leaseId === undefined || lease.leaseId === token.leaseId)
  );
}

/** Generate a random owner ID, falling back when crypto.randomUUID is absent. */
function newOwnerId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return "owner-" + Math.random().toString(36).slice(2) + "-" + Date.now().toString(36);
}

function newLeaseId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return "lease-" + Math.random().toString(36).slice(2) + "-" + Date.now().toString(36);
}

/** Open a BroadcastChannel if available in this environment, else null. */
function openChannel(): BroadcastLike | null {
  if (typeof globalThis.BroadcastChannel !== "function") return null;
  try {
    // DOM BroadcastChannel is structurally compatible; the cast reconciles the
    // narrower MessageEvent payload type with our minimal listener shape.
    return new globalThis.BroadcastChannel(LEASE_CHANNEL) as unknown as BroadcastLike;
  } catch {
    return null;
  }
}

interface StoredFence {
  value: number;
}

/** Read the active lease from storageMeta. */
async function readLease(db: RSembleEvaluationDB): Promise<LeaseInfo | null> {
  const row = await db.storageMeta.get(LEASE_KEY);
  return (row?.value as LeaseInfo | undefined) ?? null;
}

/** Read the monotonic high-water fence, defaulting to 0. */
async function readFence(db: RSembleEvaluationDB): Promise<number> {
  const row = await db.storageMeta.get(FENCE_KEY);
  const v = (row?.value as StoredFence | undefined)?.value;
  return typeof v === "number" ? v : 0;
}

/**
 * Sweep "running" runs and convert those not owned by the current lease holder
 * to "interrupted". Shared by both implementations; the caller must already
 * hold the lease (verified before invoking).
 */
async function sweepInterrupted(runRepo: RunRepository, lease: LeaseInfo, now: () => number = () => Date.now()): Promise<number> {
  const summaries = await runRepo.list({
    status: "running",
    limit: Number.MAX_SAFE_INTEGER,
  });
  if (summaries.length === 0) return 0;

  let recovered = 0;
  for (const summary of summaries) {
    if (summary.kind !== "full") continue;
    const record = await runRepo.get(summary.id);
    if (!record || record.status !== "running") continue;
    // Experiment task runs have their own unit-of-work recovery and fence
    // semantics; the shared ad-hoc sweep must not mark them stale.
    if (record.source.kind !== "adhoc") continue;

    // A run is interruptible if its execution fence was written by a different
    // owner than the current lease holder, or (defensively) if the run predates
    // the current lease fence entirely. Runs written by the current owner under
    // the current fence are left alone — the owning tab may still be live.
    const ownedByCurrent = record.execution.ownerId === lease.ownerId;
    const exactCurrentFence = record.execution.fence === lease.fence;
    if (ownedByCurrent && exactCurrentFence) continue;

    const timestamp = now();
    const interrupted: RunRecordV2 = {
      ...record,
      status: "interrupted",
      updatedAt: timestamp,
      completedAt: timestamp,
    };
    const summaryUpdate = {
      ...summary,
      status: "interrupted" as const,
      completedAt: timestamp,
    };
    try {
      // The lease may be reclaimed while the sweep is in progress. Pass the
      // current fence into the repository so the state transition itself is
      // rejected transactionally if this recovery controller went stale.
      await runRepo.update(interrupted, summaryUpdate, record.revision, {
        ownerId: lease.ownerId,
        fence: lease.fence,
        ...(lease.leaseId ? { leaseId: lease.leaseId } : {}),
        checkedAt: timestamp,
      });
      recovered++;
    } catch {
      // Stale revision or validation error: another tab likely touched it.
      // Skip; recovery is idempotent and retried on the next sweep.
    }
  }
  return recovered;
}

// --- Dexie-backed implementation ---------------------------------------------

export function createExecutionLease(
  db: RSembleEvaluationDB,
  options: LeaseOptions = {},
): ExecutionLease {
  const ttl = options.ttl ?? LEASE_TTL;
  const now = options.now ?? (() => Date.now());
  const pollInterval = options.pollInterval ?? POLL_FALLBACK_INTERVAL;
  const tabOwnerId = options.ownerId ?? newOwnerId();
  const listeners = new Set<(state: LeaseState) => void>();

  function emit(state: LeaseState): void {
    for (const l of listeners) {
      try {
        l(state);
      } catch {
        // listener errors must not break the lease
      }
    }
  }

  // The ownerId this lease instance most recently acquired, so we can
  // distinguish "owned by us" from "contested by another tab".
  let currentOwner: string | null = null;
  let currentLeaseId: string | null = null;

  /** Re-read the DB and emit the current state to all subscribers. */
  async function refreshAndEmit(): Promise<void> {
    let current: LeaseInfo | null;
    try {
      current = await readLease(db);
    } catch {
      // DB may be closed (e.g. after a test tears down); stay quiet.
      return;
    }
    const t = now();
    if (isLive(current, t)) {
      if (current.ownerId === currentOwner) {
        emit({ status: "owned", lease: current });
      } else {
        emit({ status: "contested", lease: current });
      }
    } else {
      emit({ status: "free" });
    }
  }

  const channel: BroadcastLike | null = openChannel();
  if (channel) {
    channel.onmessage = () => {
      void refreshAndEmit();
    };
  }

  let pollTimer: ReturnType<typeof setInterval> | null = null;
  function ensurePolling(): void {
    if (pollTimer) return;
    pollTimer = setInterval(() => {
      void refreshAndEmit().catch(() => {
        // swallow — polling must never throw unhandled rejections
      });
    }, pollInterval);
    // Don't keep the Node process alive solely for lease polling.
    if (typeof pollTimer.unref === "function") pollTimer.unref();
  }

  function broadcast(message: unknown): void {
    if (!channel) return;
    try {
      channel.postMessage(message);
    } catch {
      // broadcast is best-effort
    }
  }

  async function acquire(acquireOptions: { kind?: LeaseKind; executionId?: string } = {}): Promise<LeaseInfo> {
    db.assertWritable();
    const lease = await db.transaction("rw", db.storageMeta, async () => {
      const t = now();
      const existing = await readLease(db);
      if (isLive(existing, t)) {
        throw new LeaseError(
          "contested",
          `Lease is held by ${existing.ownerId} (fence ${existing.fence}) until ${existing.expiresAt}`,
          existing,
        );
      }
      // Monotonic fence: always one greater than the persisted high-water mark,
      // independent of whether the prior lease was released or merely expired.
      const highWater = await readFence(db);
      const fence = highWater + 1;
      const acquired: LeaseInfo = {
        leaseId: newLeaseId(),
        ownerId: tabOwnerId,
        kind: acquireOptions.kind ?? options.kind ?? "compare",
        executionId: acquireOptions.executionId ?? options.executionId ?? "unknown",
        acquiredAt: t,
        heartbeatAt: t,
        fence,
        expiresAt: t + ttl,
      };
      await db.storageMeta.put({ key: LEASE_KEY, value: acquired } satisfies StorageMetaRow);
      await db.storageMeta.put({
        key: FENCE_KEY,
        value: { value: fence } satisfies StoredFence,
      } satisfies StorageMetaRow);
      return acquired;
    });
    currentOwner = lease.ownerId;
    currentLeaseId = lease.leaseId ?? null;
    broadcast({ type: "acquired", lease });
    emit({ status: "owned", lease });
    ensurePolling();
    return lease;
  }

  async function renew(token?: LeaseInfo): Promise<LeaseInfo> {
    db.assertWritable();
    const expected = token ?? (currentOwner && currentLeaseId
      ? { ownerId: currentOwner, leaseId: currentLeaseId }
      : null);
    const lease = await db.transaction("rw", db.storageMeta, async () => {
      const t = now();
      const existing = await readLease(db);
      // An expired token is no longer allowed to revive itself. A takeover may
      // happen immediately after this check, so this check and the write stay
      // in one IndexedDB transaction.
      if (!matchesToken(existing, expected) || !isLive(existing, t)) {
        throw new LeaseError("expired", "Cannot renew: lease token is no longer current", existing);
      }
      const renewed: LeaseInfo = { ...existing, heartbeatAt: t, expiresAt: t + ttl };
      await db.storageMeta.put({ key: LEASE_KEY, value: renewed } satisfies StorageMetaRow);
      return renewed;
    });
    // Only update local ownership if this was still the instance's current
    // token. A delayed heartbeat from an old controller must not clobber a new
    // controller's token or timer state.
    if (!token || (currentOwner === token.ownerId && currentLeaseId === token.leaseId)) {
      currentOwner = lease.ownerId;
      currentLeaseId = lease.leaseId ?? null;
    }
    broadcast({ type: "renewed", lease });
    emit({ status: "owned", lease });
    return lease;
  }

  async function release(token?: LeaseInfo): Promise<void> {
    db.assertWritable();
    const expected = token ?? (currentOwner && currentLeaseId
      ? { ownerId: currentOwner, leaseId: currentLeaseId }
      : null);
    let released = false;
    await db.transaction("rw", db.storageMeta, async () => {
      const existing = await readLease(db);
      if (!matchesToken(existing, expected)) return; // stale token cannot release a newer lease
      // Remove the active lease but keep the monotonic fence counter so the
      // next acquisition still issues a strictly-greater fence.
      await db.storageMeta.delete(LEASE_KEY);
      released = true;
    });
    if (released && (!token || currentLeaseId === token.leaseId)) {
      currentOwner = null;
      currentLeaseId = null;
    }
    if (released) {
      broadcast({ type: "released" });
      emit({ status: "free" });
    }
  }

  async function verify(token?: LeaseInfo): Promise<LeaseInfo | null> {
    const existing = await readLease(db);
    const t = now();
    if (!isLive(existing, t)) return null;
    if (token) return matchesToken(existing, token) ? existing : null;
    if (currentOwner === null || currentLeaseId === null) return null;
    return matchesToken(existing, { ownerId: currentOwner, leaseId: currentLeaseId }) ? existing : null;
  }

  async function isOwner(): Promise<boolean> {
    return (await verify()) !== null;
  }

  async function getCurrent(): Promise<LeaseInfo | null> {
    const existing = await readLease(db);
    const t = now();
    return isLive(existing, t) ? existing : null;
  }

  function subscribe(listener: (state: LeaseState) => void): () => void {
    listeners.add(listener);
    ensurePolling();
    void refreshAndEmit();
    return () => {
      listeners.delete(listener);
    };
  }

  async function recoverInterruptedRuns(runRepo: RunRepository): Promise<number> {
    let acquiredForRecovery = false;
    if (!(await verify())) {
      try {
        await acquire();
        acquiredForRecovery = true;
      } catch {
        // Another tab owns execution; defer recovery to it.
        return 0;
      }
    }
    try {
      const lease = await verify();
      if (!lease) return 0;
      return await sweepInterrupted(runRepo, lease, now);
    } finally {
      if (acquiredForRecovery) await release();
    }
  }

  async function dispose(): Promise<void> {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    channel?.close();
    listeners.clear();
  }

  return {
    acquire,
    renew,
    release,
    verify,
    isOwner,
    getCurrent,
    subscribe,
    recoverInterruptedRuns,
    dispose,
  };
}

// =============================================================================
// In-memory execution lease — for test injection (no Dexie dependency)
// =============================================================================

/**
 * Pure in-memory lease for tests that do not need IndexedDB. Multiple instances
 * sharing the same store behave like multiple tabs contending for one lease.
 */
export class InMemoryExecutionLease implements ExecutionLease {
  private store: { lease: LeaseInfo | null; fence: number };
  private listeners = new Set<(state: LeaseState) => void>();
  private currentOwner: string | null = null;
  private currentLeaseId: string | null = null;
  private readonly ownerId: string;
  private channel: BroadcastLike | null;
  private readonly ttl: number;
  private readonly now: () => number;

  /**
   * @param store shared mutable store so multiple instances simulate multiple
   * tabs. Create one store and pass it to each lease instance.
   * @param channel optional shared broadcast channel for cross-instance notify.
   */
  constructor(
    store: { lease: LeaseInfo | null; fence: number } = { lease: null, fence: 0 },
    channel?: BroadcastLike | null,
    options: LeaseOptions = {},
  ) {
    this.store = store;
    this.channel = channel ?? openChannel();
    this.ttl = options.ttl ?? LEASE_TTL;
    this.now = options.now ?? (() => Date.now());
    this.ownerId = options.ownerId ?? newOwnerId();
    if (this.channel) this.channel.onmessage = () => this.emitCurrent();
  }

  private emit(state: LeaseState): void {
    for (const l of this.listeners) {
      try {
        l(state);
      } catch {
        // ignore
      }
    }
  }

  private emitCurrent(): void {
    const t = this.now();
    const lease = this.store.lease;
    if (isLive(lease, t)) {
      if (lease.ownerId === this.currentOwner && lease.leaseId === this.currentLeaseId) {
        this.emit({ status: "owned", lease });
      } else {
        this.emit({ status: "contested", lease });
      }
    } else {
      this.emit({ status: "free" });
    }
  }

  private notify(): void {
    this.emitCurrent();
    if (this.channel) {
      try {
        this.channel.postMessage({ type: "changed" });
      } catch {
        // best-effort
      }
    }
  }

  async acquire(acquireOptions: { kind?: LeaseKind; executionId?: string } = {}): Promise<LeaseInfo> {
    const t = this.now();
    const existing = this.store.lease;
    if (isLive(existing, t)) {
      throw new LeaseError(
        "contested",
        `Lease is held by ${existing.ownerId} (fence ${existing.fence})`,
        existing,
      );
    }
    // Monotonic fence: always strictly greater than the high-water mark.
    const fence = this.store.fence + 1;
    const lease: LeaseInfo = {
      leaseId: newLeaseId(), ownerId: this.ownerId,
      kind: acquireOptions.kind ?? "compare", executionId: acquireOptions.executionId ?? "unknown",
      acquiredAt: t, heartbeatAt: t, fence, expiresAt: t + this.ttl,
    };
    this.store.lease = lease;
    this.store.fence = fence;
    this.currentOwner = this.ownerId;
    this.currentLeaseId = lease.leaseId ?? null;
    this.notify();
    return lease;
  }

  async renew(token?: LeaseInfo): Promise<LeaseInfo> {
    const t = this.now();
    const existing = this.store.lease;
    const expected = token ?? (this.currentOwner && this.currentLeaseId
      ? { ownerId: this.currentOwner, leaseId: this.currentLeaseId }
      : null);
    if (!matchesToken(existing, expected) || !isLive(existing, t)) {
      throw new LeaseError("expired", "Cannot renew: lease token is no longer current", existing);
    }
    const renewed: LeaseInfo = { ...existing, heartbeatAt: t, expiresAt: t + this.ttl };
    this.store.lease = renewed;
    if (!token || this.currentLeaseId === token.leaseId) {
      this.currentOwner = renewed.ownerId;
      this.currentLeaseId = renewed.leaseId ?? null;
    }
    this.notify();
    return renewed;
  }

  async release(token?: LeaseInfo): Promise<void> {
    const existing = this.store.lease;
    const expected = token ?? (this.currentOwner && this.currentLeaseId
      ? { ownerId: this.currentOwner, leaseId: this.currentLeaseId }
      : null);
    if (!matchesToken(existing, expected)) return;
    this.store.lease = null;
    // fence counter persists for monotonic takeover.
    if (!token || this.currentLeaseId === token.leaseId) {
      this.currentOwner = null;
      this.currentLeaseId = null;
    }
    this.notify();
  }

  async verify(token?: LeaseInfo): Promise<LeaseInfo | null> {
    const existing = this.store.lease;
    const t = this.now();
    if (!isLive(existing, t)) return null;
    if (token) return matchesToken(existing, token) ? existing : null;
    if (this.currentOwner === null || this.currentLeaseId === null) return null;
    return matchesToken(existing, { ownerId: this.currentOwner, leaseId: this.currentLeaseId }) ? existing : null;
  }

  async isOwner(): Promise<boolean> {
    return (await this.verify()) !== null;
  }

  async getCurrent(): Promise<LeaseInfo | null> {
    const existing = this.store.lease;
    const t = this.now();
    return isLive(existing, t) ? existing : null;
  }

  subscribe(listener: (state: LeaseState) => void): () => void {
    this.listeners.add(listener);
    this.notify();
    return () => {
      this.listeners.delete(listener);
    };
  }

  async recoverInterruptedRuns(runRepo: RunRepository): Promise<number> {
    let acquiredForRecovery = false;
    if (!(await this.verify())) {
      try {
        await this.acquire();
        acquiredForRecovery = true;
      } catch {
        return 0;
      }
    }
    try {
      const lease = await this.verify();
      if (!lease) return 0;
      return await sweepInterrupted(runRepo, lease, this.now);
    } finally {
      if (acquiredForRecovery) await this.release();
    }
  }

  dispose(): void {
    this.channel?.close();
    this.channel = null;
    this.listeners.clear();
  }
}
