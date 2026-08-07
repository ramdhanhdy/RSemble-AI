# Plan 004: Restore run integrity and make Compare preflight truthful

> **Executor instructions**: Execute after Plan 003. This phase repairs
> reproducibility, usage/cost provenance, readiness, candidate cardinality,
> attachment failure reporting, and dead Compare controls. Preserve the existing
> Rank/Fuse pipeline and persistence schema unless a schema change is explicitly
> justified by a failing invariant test.
>
> **Drift check (run first)**:
>
> ```bash
> git diff --stat 8f22a6e..HEAD -- \
>   src/rsemble.tsx src/studio-engine.ts src/lib/run-controller.ts \
>   src/lib/run-executor.ts src/lib/pipeline.ts src/lib/cost.ts \
>   src/lib/persistence src/ui src/workspaces/evaluations
> git status --short
> ```
>
> Reconcile this plan if reasoning-policy capture, multipart content handling,
> readiness aggregation, profile actions, or attachment state changed.

## Status

**DONE — owner validation pending**

Deterministic implementation and verification are complete in the Plan 004
checkpoint commit. Live provider behavior, provider-reported media usage, and
owner browser validation remain on the owner-PC checklist; Plan 005 follows
only after this checkpoint.

- **Priority**: P0
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: Plan 003
- **Blocks**: Plan 005
- **Category**: correctness
- **Planned at**: commit `8f22a6e`, 2026-08-06

## Goal

Ensure that every paid Compare run starts only when it can complete the intended
pipeline, every retry uses the frozen protocol it claims to use, every displayed
usage/cost value has defensible provenance, every readiness indicator reflects
actual providers, and every visible action performs a real operation.

## Invariants

1. Compare starts with at least two enabled, ready candidate slots and one ready
   Judge.
2. The generation/Judge reasoning policy is frozen at fanout start and reused by
   candidate retry, Judge retry, and Fusion retry.
3. Multipart message content is never coerced through JavaScript's default array
   string conversion.
4. Media usage/cost is `reported`, a named provider-specific estimate, or
   `unknown`; never fabricated from `[object Object]` or raw byte count alone.
5. Global connection state includes every registered provider.
6. Attachment `reading` and `error` are separate preflight states.
7. Every visible control has an observable effect or is absent.
8. Persistent evidence records requested and effective execution settings
   consistently with in-memory retry behavior.

## Workstream A — Freeze complete run context

1. Add a regression test around `FANOUT_START` proving `reasoningPolicy` is deep
   copied into `runContext`.
2. Update the reducer to copy both candidate and Judge effort fields.
3. Audit all context construction sites in `run-controller.ts` and experiment
   execution for omission or live-state fallback.
4. Ensure candidate retry, Judge retry, and Fusion retry read the frozen context.
5. Decide which fields intentionally remain live (for example, a deliberate
   re-Fuse setting) and document them; do not allow accidental live behavior.
6. Add persistence assertions that requested/effective effort matches the actual
   adapter request after command-pane changes.
7. Test reset/new-run replacement so stale context cannot cross runs.

## Workstream B — Replace unsafe content estimation

1. Introduce or reuse one provider-neutral content normalization helper for text
   accounting. It must traverse:
   - plain strings;
   - text parts;
   - extracted document text;
   - image/file parts without converting objects to default strings.
2. Replace `messages.map(m => m.content).join("")` in every fallback estimator.
3. Define an explicit estimator result:

```ts
interface UsageEstimate {
  inputTokens: number | null;
  outputTokens: number | null;
  method: "text-heuristic" | "provider-specific" | "unknown";
  note?: string;
}
```

4. For mixed native-media content:
   - estimate the textual portion only when useful;
   - do not call the total authoritative;
   - keep media contribution unknown unless an adapter-specific estimator exists;
   - produce unknown cost when exact total input tokens are required.
5. Preserve provider-reported usage/cost as highest authority.
6. Ensure cost provenance badges and exports distinguish reported, estimated,
   partial-text estimate, and unknown.
7. Add tests with text + image, PDF/file, multiple text parts, and empty arrays.

## Workstream C — Make readiness registry-driven

1. Replace the hand-written `apiKeyPresent` OR chain with registry-derived
   readiness:

```ts
const anyProviderReady = listProviders().some(
  provider => readinessMap[provider.id] === true,
);
```

2. Verify 9Router-only and ChatGPT/Codex-only configurations show Ready.
3. Ensure `NoKeyBanner` copy names provider connection generally rather than an
   incomplete provider list.
4. Keep `checking` distinct from `offline` until the first complete probe cycle.
5. Add tests that a cancelled probe cycle does not regress readiness.
6. Ensure slot/Judge-specific readiness errors remain more specific than the
   global header state.

## Workstream D — Enforce two-candidate Compare preflight

1. Replace `enabledSlots.length > 0` with the Plan 002 minimum.
2. Derive a structured preflight result instead of scattered booleans:

```ts
type ComparePreflight =
  | { ok: true }
  | { ok: false; code: CompareBlockCode; message: string; details?: unknown };
```

3. Preflight order should be stable and user-actionable:
   - active execution conflict;
   - missing task;
   - candidate count;
   - unavailable candidate provider/model;
   - unavailable Judge;
   - attachment reading;
   - attachment failure;
   - attachment/model capability mismatch;
   - transport-size limit.
4. Use the same preflight function for button, keyboard shortcut, focus strip,
   mobile drawer, and final controller guard.
5. Controller guard must still reject races and emit an audit event without paid
   calls.
6. Add a provider-call spy test proving one candidate causes zero calls.
7. Preserve evaluation experiments' explicit single-model policies; do not apply
   Compare cardinality globally.

## Workstream E — Truthful attachment failure UX

1. Derive separate sets for `reading`, `ready`, and `error` attachments.
2. An error must show:
   - filename;
   - extraction/read error;
   - Remove;
   - Retry only if the extraction layer can safely retry the original in-memory
     file handle/blob.
3. Never display `Waiting for attachments...` for a terminal error.
4. Ensure a failed attachment blocks execution until removed or successfully
   retried.
5. Preserve metadata-only persistence; do not persist attachment bytes to enable
   retry after reload.
6. Add accessibility tests for status announcement and reachable actions.

## Workstream F — Eliminate dead actions

Audit at minimum:

- `rsemble:save-profile`
- `rsemble:select-profile`
- `rsemble:add-criterion`

For each action choose exactly one outcome:

1. wire to an existing editor/dialog/navigation flow;
2. implement the missing minimal flow;
3. remove the control and command-palette entry until supported.

Preferred behavior:

- **Saved profile…** opens a real profile selector backed by the evaluation
  repository and pins an immutable profile version.
- **Save as profile** opens a named draft flow and persists a new profile/version
  without mutating Compare unexpectedly.
- **Add evaluation criterion** opens Custom criteria and focuses a newly added
  criterion row.

Do not retain global custom events when a typed callback/context can express the
interaction more reliably. If events remain for shell decoupling, centralize
names and test listener registration.

## Workstream G — Validate persisted evidence coherence

1. Add end-to-end unit/integration scenarios:
   - start with reasoning Medium;
   - complete candidates;
   - change command pane to High;
   - retry Judge;
   - assert request and persisted provenance remain Medium.
2. Repeat for candidate retry and re-Fuse.
3. Verify displayed cost source matches stored cost source.
4. Verify unknown media usage remains missing rather than zero.
5. Verify exports reproduce the same requested/effective reasoning fields shown
   in Run Detail.

## Scope

**In scope**:

- `src/rsemble.tsx`
- `src/studio-engine.ts`
- `src/lib/run-controller.ts`
- `src/lib/run-executor.ts`
- provider-neutral content/cost helpers
- relevant run persistence/Run Detail/export code
- attachment chips/input/hooks and tests
- Compare evaluation disclosure/profile action wiring
- command palette action wiring

**Out of scope**:

- bridge security already handled by Plan 003;
- direct-provider timeout infrastructure;
- cross-tab leases;
- broad file splitting;
- bundle optimization;
- changing Judge scoring semantics.

## Verification commands

```bash
npm test -- \
  src/studio-engine.test.ts \
  src/lib/run-controller.test.ts \
  src/lib/run-executor.test.ts \
  src/lib/cost.test.ts \
  src/ui/ConnectionsModal.test.tsx \
  src/ui/AttachmentChips.test.tsx \
  src/ui/CommandPalette.test.tsx \
  src/workspaces/runs/RunDetail.test.tsx
npm run typecheck:web
npm run typecheck:server
npm run check
git diff --check
```

Add deterministic browser QA for the one-candidate block, 9Router-only readiness,
attachment failure, and profile actions if component tests cannot establish the
integrated result.

## Acceptance criteria

- `runContext.reasoningPolicy` is frozen and used by all retries.
- No fallback token estimator produces `[object Object]`.
- Media usage/cost provenance is honest and visibly labeled.
- 9Router-only readiness is Ready, not Offline.
- Compare with fewer than two candidates performs zero paid calls.
- Attachment errors are terminal, specific, and removable/retriable.
- No visible Compare/profile/criterion action is inert.
- Existing Rank and Fuse happy paths remain behaviorally unchanged.

## STOP conditions

Stop if:

- a retry is intentionally meant to adopt live reasoning policy but the specs do
  not describe that treatment change;
- provider-specific media estimation would be presented as universal;
- profile selection requires mutable references instead of pinned versions;
- fixing dead controls would expand scope into a new profile-management product.

## Handoff to Plan 005

Plan 005 may assume Compare preflight is centralized and deterministic, run
context is complete, provider errors are sanitized, and cost provenance is
honest. It will add time and concurrency boundaries without changing these
semantics.
