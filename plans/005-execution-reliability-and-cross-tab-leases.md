# Plan 005: Add execution deadlines and cross-tab coordination

> **Executor instructions**: Execute after Plan 004. Add reliability boundaries
> around the now-truthful execution contract without changing evaluation
> semantics, scoring, retry provenance, or provider credential handling. Build
> pure deadline and lease components first, then integrate Compare and provider
> adapters.
>
> **Drift check (run first)**:
>
> ```bash
> git diff --stat 8f22a6e..HEAD -- \
>   src/lib/providers src/lib/run-executor.ts src/lib/run-controller.ts \
>   src/lib/execution-owner* src/lib/evaluations src/lib/persistence \
>   src/rsemble.tsx src/ui/GlobalExecutionStrip.tsx
> git status --short
> ```

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: Plan 004
- **Blocks**: Plan 006
- **Category**: reliability
- **Planned at**: commit `8f22a6e`, 2026-08-06

## Goal

Prevent stalled network operations and conflicting paid executions from leaving
RSemble indefinitely active, double-spending across tabs, or misclassifying live
work as stale. Preserve long-running reasoning requests when they continue to
make progress.

## Reliability model

### Deadlines

Use separate clocks:

- **connect deadline**: request dispatch until response headers;
- **inactivity deadline**: time since last valid stream event/byte;
- **overall ceiling**: optional, provider/stage configurable, generous;
- **user abort**: explicit and never reported as timeout.

Errors are structured:

```ts
type ExecutionTimeoutKind =
  | "connect_timeout"
  | "stream_inactivity_timeout"
  | "overall_timeout";
```

Each error carries provider, model, stage, configured duration, and elapsed time,
but no request body or credential.

### Cross-tab coordination

Keep the in-tab `ExecutionOwnerRegistry` for immediate UI reactivity. Add a
persisted `ExecutionLease` for cross-tab exclusion:

```ts
interface ExecutionLeaseRecord {
  leaseId: string;
  ownerId: string;
  kind: "compare" | "experiment";
  executionId: string;
  acquiredAt: number;
  heartbeatAt: number;
  expiresAt: number;
  fence: number;
}
```

Acquisition must be atomic through IndexedDB/CAS semantics. The fence prevents a
stale owner from committing after another tab reclaims an expired lease.

## Workstream A — Deadline primitives

1. Add a small provider-neutral deadline module with injected clock/timers for
   deterministic tests.
2. Support composing the caller abort signal with deadline abort controllers.
3. Preserve abort reason classification across environments that do not expose
   `AbortSignal.reason` consistently.
4. Add a stream watchdog API whose timer resets only on valid progress—not on
   arbitrary loop iterations.
5. Ensure cleanup removes listeners and timers on success, failure, and abort.
6. Add fake-timer tests for races at deadline boundaries.

## Workstream B — Direct provider integration

1. Apply connect deadlines to OpenRouter, Gemini, DeepSeek, CommandCode, and
   other browser-direct adapters.
2. Apply inactivity deadlines to SSE/stream readers.
3. Keep bridge upstream timeout behavior aligned, but do not kill healthy SSE
   streams after headers merely because the connect timer elapsed.
4. Centralize default durations by stage/provider class; avoid hard-coded values
   in every adapter.
5. Allow explicit test overrides.
6. Ensure catalog probes keep their existing shorter bounded policy.
7. Map timeout errors into sanitized persisted errors and visible stage-specific
   copy.

Recommended initial defaults must be documented, not treated as universal facts.
Favor conservative values suitable for reasoning models.

## Workstream C — Execution lease repository

1. Reuse the experiment lease implementation if its contract is general enough;
   otherwise extract a shared lease repository without weakening experiment
   fencing.
2. Define atomic acquire, heartbeat, release, inspect, and reclaim operations.
3. Generate one stable `ownerId` per browser tab/session.
4. Verify:
   - only one tab can acquire a live lease;
   - expired leases can be reclaimed;
   - fence increments on acquisition/reclaim;
   - stale release cannot delete a new owner's lease;
   - stale heartbeat cannot extend a reclaimed lease.
5. Add storage-unavailable behavior. Paid execution must fail closed or require an
   explicitly documented degraded mode; do not silently pretend cross-tab safety.

## Workstream D — Integrate Compare

1. Run centralized preflight from Plan 004.
2. Acquire the in-tab owner.
3. Acquire the cross-tab lease before creating paid attempts or calling providers.
4. Persist the lease/fence association with the run where needed for recovery.
5. Start heartbeat only after successful acquisition.
6. Release on normal completion, terminal failure, user abort, and controlled
   teardown.
7. Let expiration handle crashes; never release a lease merely because React
   unmounted during route navigation if execution still belongs to the mounted
   root controller.
8. Show a precise blocked state when another tab owns execution, including kind
   and age but no sensitive task details.

## Workstream E — Align experiments and recovery

1. Verify Compare and experiments share one exclusion domain if simultaneous
   execution would oversubscribe the same local bridge/upstreams.
2. Preserve experiment-specific pause, fence, and atomic commit behavior.
3. Update startup recovery so a live lease in another tab is not marked stale.
4. Ensure a reclaimed stale execution cannot commit with an obsolete fence.
5. Test Compare-vs-Compare, Compare-vs-experiment, and experiment-vs-Compare
   races using two repository/controller instances.
6. Update `GlobalExecutionStrip` to represent cross-tab ownership honestly.

## Workstream F — Failure UX and observability

1. Distinguish user abort, connect timeout, stalled stream, provider HTTP error,
   and execution conflict.
2. Add bounded diagnostic events with durations and timeout kind.
3. Never include prompts, attachments, credentials, or raw upstream bodies.
4. Make retry guidance stage-specific:
   - connect timeout: verify provider/bridge and retry;
   - stream inactivity: retry candidate/stage;
   - conflict: open owning execution or wait for lease expiry;
   - overall timeout: consider lower effort/provider defaults only as guidance.

## Scope

**In scope**:

- provider request/stream deadline helpers
- direct adapters and shared SSE readers
- shared execution lease persistence
- Compare controller/root integration
- experiment lease alignment where required
- startup recovery and global execution UI
- deterministic concurrency and timeout tests

**Out of scope**:

- changing candidate count or cost semantics;
- credential-store changes;
- model-specific performance tuning;
- arbitrary parallel execution configuration;
- background service workers;
- general controller refactoring beyond lease extraction.

## Verification commands

```bash
npm test -- \
  src/lib/providers \
  src/lib/execution-owner.test.ts \
  src/lib/evaluations/experiment-lease.test.ts \
  src/lib/run-controller.test.ts \
  src/lib/evaluations/experiment-controller.test.ts \
  src/ui/GlobalExecutionStrip.test.tsx
npm run typecheck:web
npm run typecheck:server
npm run check
git diff --check
```

Add deterministic two-tab browser QA using separate pages/contexts backed by the
same browser storage. No live provider calls are allowed in QA.

## Acceptance criteria

- Requests that never produce headers terminate with `connect_timeout`.
- Streams that stop making progress terminate with
  `stream_inactivity_timeout`.
- Active long-running streams do not time out solely because of total duration,
  unless an explicit overall ceiling applies.
- User abort is never mislabeled as timeout.
- Two tabs cannot begin conflicting paid executions.
- A stale tab cannot heartbeat, release, or commit after lease reclamation.
- Recovery respects live work in another tab.
- Existing experiment fencing remains intact.

## STOP conditions

Stop if:

- the proposed shared lease weakens experiment CAS/fence guarantees;
- browser storage cannot provide atomic acquisition under the current repository;
- a provider cannot expose stream progress in a way that supports inactivity
  detection without false positives;
- timeout defaults would break known healthy reasoning workloads.

## Handoff to Plan 006

Plan 006 may assume security, run integrity, time bounds, and cross-tab execution
coordination are enforced. It will make these guarantees repeatable in CI and
reconcile public documentation with the hardened implementation.
